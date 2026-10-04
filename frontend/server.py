"""Serve the frontend and proxy API requests to the FastAPI backend.

Sert aussi la synthèse vocale française (/tts) : les voix installées dans le
navigateur sont souvent absentes ou américaines (ex. Windows sans pack
français), alors que edge-tts fournit des voix neuronales fr-FR, homme et
femme, identiques quel que soit le navigateur. Si edge-tts n'est pas
installé ou injoignable, le frontend se rabat sur les voix du navigateur.
"""

import asyncio
import json
import os
import threading
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
# The container must listen on every interface so Docker can publish its port.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5173"))
# Le backend interroge un LLM : le premier appel (chargement du modèle) peut dépasser 1 minute.
PROXY_TIMEOUT_SECONDS = int(os.environ.get("PROXY_TIMEOUT_SECONDS", "180"))
FRONTEND_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRECTORY = os.path.join(FRONTEND_DIRECTORY, "public")

# Certaines routes FastAPI sont DÉJÀ déclarées sous /api (routeurs chat et
# error_code) : on les relaie telles quelles. Les autres (/health, /catalog,
# /interventions) n'ont pas ce préfixe : on retire alors le /api du proxy.
BACKEND_PATHS_WITH_API_PREFIX = ("/api/chat", "/api/error_code")

# ---------- Synthèse vocale (edge-tts) ----------
try:
    import edge_tts
except ImportError:  # dépendance facultative : repli sur les voix du navigateur
    edge_tts = None

TTS_MAX_TEXT_LENGTH = 1500
TTS_TIMEOUT_SECONDS = int(os.environ.get("TTS_TIMEOUT_SECONDS", "20"))
TTS_CACHE_SIZE = 64

# Voix françaises connues, utilisées si la liste en ligne est indisponible.
# Ordre = ordre de préférence (fr-FR d'abord) pour le choix automatique.
FALLBACK_FRENCH_VOICES = [
    {"id": "fr-FR-DeniseNeural", "name": "Denise", "gender": "female", "locale": "fr-FR"},
    {"id": "fr-FR-HenriNeural", "name": "Henri", "gender": "male", "locale": "fr-FR"},
    {"id": "fr-FR-VivienneMultilingualNeural", "name": "Vivienne", "gender": "female", "locale": "fr-FR"},
    {"id": "fr-FR-RemyMultilingualNeural", "name": "Rémy", "gender": "male", "locale": "fr-FR"},
    {"id": "fr-FR-EloiseNeural", "name": "Eloise", "gender": "female", "locale": "fr-FR"},
]
_voices_cache = None
_voices_lock = threading.Lock()
_audio_cache = OrderedDict()
_audio_lock = threading.Lock()


def _voice_display_name(short_name):
    """fr-FR-RemyMultilingualNeural -> Remy."""
    name = short_name.split("-", 2)[-1]
    for suffix in ("MultilingualNeural", "Neural"):
        name = name.removesuffix(suffix)
    return {"Remy": "Rémy", "Gerard": "Gérard"}.get(name, name)


def list_tts_voices():
    """Voix françaises edge-tts (mises en cache), ou la liste de secours."""
    global _voices_cache
    with _voices_lock:
        if _voices_cache is not None:
            return _voices_cache
    try:
        raw = asyncio.run(asyncio.wait_for(edge_tts.list_voices(), TTS_TIMEOUT_SECONDS))
        order = {voice["id"]: index for index, voice in enumerate(FALLBACK_FRENCH_VOICES)}
        voices = [
            {
                "id": voice["ShortName"],
                "name": _voice_display_name(voice["ShortName"]),
                "gender": "male" if voice.get("Gender") == "Male" else "female",
                "locale": voice["Locale"],
            }
            for voice in raw
            if voice.get("Locale", "").startswith("fr-")
        ]
        voices.sort(key=lambda voice: (order.get(voice["id"], 99), voice["locale"] != "fr-FR", voice["id"]))
    except Exception as error:  # réseau indisponible : la synthèse sera tentée quand même
        # Mise en cache aussi : sinon chaque /tts referait un appel lent qui échoue.
        print(f"[frontend] Liste des voix edge-tts indisponible ({type(error).__name__}), liste de secours utilisée.")
        voices = []
    with _voices_lock:
        _voices_cache = voices or FALLBACK_FRENCH_VOICES
        return _voices_cache


async def _synthesize(text, voice_id):
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice_id).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


def synthesize_speech(text, voice_id):
    """MP3 de `text` lu par `voice_id` (mis en cache : "Réécouter" ne refait pas l'appel)."""
    key = (voice_id, text)
    with _audio_lock:
        if key in _audio_cache:
            _audio_cache.move_to_end(key)
            return _audio_cache[key]
    audio = asyncio.run(asyncio.wait_for(_synthesize(text, voice_id), TTS_TIMEOUT_SECONDS))
    if not audio:
        raise RuntimeError("Aucun audio généré.")
    with _audio_lock:
        _audio_cache[key] = audio
        while len(_audio_cache) > TTS_CACHE_SIZE:
            _audio_cache.popitem(last=False)
    return audio


def build_backend_path(request_path):
    """/api/chat -> /api/chat ; /api/health -> /health."""
    for prefix in BACKEND_PATHS_WITH_API_PREFIX:
        if request_path == prefix or request_path.startswith(f"{prefix}/"):
            return request_path
    return request_path[len("/api"):]


class FrontendRequestHandler(SimpleHTTPRequestHandler):
    """Serve static assets and relay /api requests to the backend."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIRECTORY, **kwargs)

    def end_headers(self):
        # Oblige le navigateur à revalider HTML/CSS/JS à chaque chargement :
        # après une reconstruction Docker, la nouvelle interface s'affiche
        # sans devoir vider le cache (une réponse 304 reste possible).
        if not self.path.startswith(("/api/", "/tts")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy_api_request()
            return
        if urlsplit(self.path).path == "/tts/voices":
            self._handle_tts_voices()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            self._proxy_api_request()
            return
        super().do_HEAD()

    def do_POST(self):
        if urlsplit(self.path).path == "/tts":
            self._handle_tts()
            return
        self._proxy_api_request()

    def _handle_tts_voices(self):
        if edge_tts is None:
            self._send_json_error(503, "Synthèse vocale serveur indisponible (edge-tts non installé).")
            return
        body = json.dumps({"voices": list_tts_voices()}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_tts(self):
        if edge_tts is None:
            self._send_json_error(503, "Synthèse vocale serveur indisponible (edge-tts non installé).")
            return
        try:
            body_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(body_length) or b"{}")
            text = str(payload.get("text", "")).strip()
            voice_id = str(payload.get("voice", ""))
        except (ValueError, TypeError):
            self._send_json_error(400, "Requête de synthèse invalide.")
            return

        # Seules les voix françaises connues sont acceptées.
        if not voice_id.startswith("fr-") or voice_id not in {voice["id"] for voice in list_tts_voices()}:
            self._send_json_error(400, "Voix inconnue.")
            return
        if not text or len(text) > TTS_MAX_TEXT_LENGTH:
            self._send_json_error(400, f"Texte vide ou trop long (max {TTS_MAX_TEXT_LENGTH} caractères).")
            return

        try:
            audio = synthesize_speech(text, voice_id)
        except Exception as error:
            self.log_error("Synthèse vocale impossible : %s", type(error).__name__)
            self._send_json_error(502, "Synthèse vocale indisponible pour le moment.")
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def do_PUT(self):
        self._proxy_api_request()

    def do_PATCH(self):
        self._proxy_api_request()

    def do_DELETE(self):
        self._proxy_api_request()

    def _send_json_error(self, status_code, message):
        response_body = json.dumps({"detail": message}).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(response_body)

    def _proxy_api_request(self):
        if not self.path.startswith("/api/"):
            self._send_json_error(405, "Méthode non autorisée.")
            return

        request_path = urlsplit(self.path)
        query = f"?{request_path.query}" if request_path.query else ""
        target_url = f"{API_BASE_URL}{build_backend_path(request_path.path)}{query}"
        body_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(body_length) if body_length else None
        request_headers = {
            header: self.headers[header]
            for header in ("Accept", "Content-Type")
            if self.headers.get(header)
        }
        api_request = Request(
            target_url,
            data=request_body,
            headers=request_headers,
            method=self.command,
        )

        try:
            with urlopen(api_request, timeout=PROXY_TIMEOUT_SECONDS) as api_response:
                self._send_api_response(api_response.status, api_response.headers, api_response.read())
        except HTTPError as error:
            self._send_api_response(error.code, error.headers, error.read())
        except (TimeoutError, URLError) as error:
            reason = error.reason if isinstance(error, URLError) else error
            if isinstance(reason, TimeoutError):
                self.log_error("Délai d'attente dépassé pour l'API (%s).", target_url)
                self._send_json_error(504, "Le backend a mis trop de temps à répondre. Réessayez.")
                return
            self.log_error("Impossible de joindre l'API (%s): %s", target_url, reason)
            self._send_json_error(
                502,
                f"API inaccessible à {API_BASE_URL}. Vérifiez que le backend est démarré.",
            )

    def _send_api_response(self, status_code, headers, response_body):
        self.send_response(status_code)
        self.send_header(
            "Content-Type",
            headers.get("Content-Type", "application/json; charset=utf-8"),
        )
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(response_body)

    def log_message(self, format_string, *args):
        print(f"[frontend] {self.address_string()} - {format_string % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), FrontendRequestHandler)
    print(f"Frontend à l'écoute sur {HOST}:{PORT}")
    print(f"API configurée sur {API_BASE_URL}")
    print("Synthèse vocale française : " + ("edge-tts activé" if edge_tts else "edge-tts absent, voix du navigateur"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur frontend.")
    finally:
        server.server_close()
