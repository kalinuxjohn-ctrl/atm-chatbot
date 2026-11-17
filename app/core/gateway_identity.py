"""
Identité du technicien transmise par le gateway de l'Espace techniciens.

Sans configuration (ATM_CHATBOT_GATEWAY_SHARED_SECRET vide), rien ne change : le
chatbot croit le `technician_id` envoyé par le frontend, comme avant (chatbot
utilisé seul, connexion simulée).

Avec ATM_CHATBOT_GATEWAY_SHARED_SECRET défini (déploiement avec l'Espace techniciens) :

1. le gateway a vérifié la session de l'utilisateur (auth_request vers main-app-auth) ;
2. il ajoute deux en-têtes à la requête, en écrasant ceux qu'un client aurait envoyés :
     X-Atm-Chatbot-Gateway-Secret      le secret partagé (prouve que la requête vient du gateway)
     X-Authenticated-Technician-Id le n° du technicien connecté ;
3. ce module refuse (401) toute requête sans ces en-têtes valides, et les routes
   remplacent le `technician_id` reçu par celui du technicien connecté
   (effective_technician_id) : impossible de parler au nom d'un collègue.

Exceptions : /health (healthcheck), la documentation de l'API, et /api/admin/
(protégé par sa propre clé X-Admin-Key, voir app/api/routes/admin.py).
"""

import hmac
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.config import settings

GATEWAY_SECRET_HEADER = "X-Atm-Chatbot-Gateway-Secret"
AUTHENTICATED_TECHNICIAN_HEADER = "X-Authenticated-Technician-Id"

PATHS_WITHOUT_GATEWAY_IDENTITY = ("/health", "/docs", "/redoc", "/openapi.json")
PATH_PREFIXES_WITHOUT_GATEWAY_IDENTITY = ("/api/admin/", "/docs/")


def gateway_identity_is_required() -> bool:
    return bool(settings.atm_chatbot_gateway_shared_secret)


def _path_is_exempt(path: str) -> bool:
    return path in PATHS_WITHOUT_GATEWAY_IDENTITY or path.startswith(PATH_PREFIXES_WITHOUT_GATEWAY_IDENTITY)


def _read_authenticated_technician_id(request: Request) -> Optional[int]:
    """N° du technicien si le secret du gateway est correct, sinon None."""
    received_secret = request.headers.get(GATEWAY_SECRET_HEADER, "")
    expected_secret = settings.atm_chatbot_gateway_shared_secret
    # compare_digest : temps constant, le secret ne se devine pas caractère par caractère.
    if not received_secret or not hmac.compare_digest(received_secret.encode("utf-8"), expected_secret.encode("utf-8")):
        return None
    technician_id_text = request.headers.get(AUTHENTICATED_TECHNICIAN_HEADER, "")
    return int(technician_id_text) if technician_id_text.isdigit() and int(technician_id_text) > 0 else None


async def require_gateway_identity(request: Request, call_next):
    """Middleware HTTP (enregistré dans app/main.py)."""
    request.state.authenticated_technician_id = None
    if not gateway_identity_is_required() or _path_is_exempt(request.url.path):
        return await call_next(request)

    authenticated_technician_id = _read_authenticated_technician_id(request)
    if authenticated_technician_id is None:
        return JSONResponse(
            status_code=401,
            content={"detail": "Connectez-vous à l'Espace techniciens pour utiliser l’ATM-Chatbot."},
        )
    request.state.authenticated_technician_id = authenticated_technician_id
    return await call_next(request)


def effective_technician_id(request: Request, claimed_technician_id: int) -> int:
    """Technicien connecté (vérifié par le gateway) s'il y en a un, sinon celui annoncé par le frontend."""
    # request peut être None quand une route est appelée directement (tests).
    authenticated_technician_id = getattr(getattr(request, "state", None), "authenticated_technician_id", None)
    return authenticated_technician_id if authenticated_technician_id is not None else claimed_technician_id
