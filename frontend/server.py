"""Serve the frontend and proxy API requests to the FastAPI backend."""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
# The container must listen on every interface so Docker can publish its port.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5173"))
FRONTEND_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRECTORY = os.path.join(FRONTEND_DIRECTORY, "public")


class FrontendRequestHandler(SimpleHTTPRequestHandler):
    """Serve static assets and relay /api requests to the backend."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy_api_request()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            self._proxy_api_request()
            return
        super().do_HEAD()

    def do_POST(self):
        self._proxy_api_request()

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
        target_url = f"{API_BASE_URL}{request_path.path[4:]}?{request_path.query}"
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
            with urlopen(api_request, timeout=60) as api_response:
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur frontend.")
    finally:
        server.server_close()
