"""
Point d'entrée de l'application FastAPI.

Lancer en local avec :
    uvicorn app.main:app --reload

Puis tester sur http://localhost:8000/docs (documentation interactive
générée automatiquement par FastAPI).
"""

from fastapi import FastAPI

# Import volontairement inutilisé directement : le simple fait d'importer
# le package charge tous les modules de app/models/ (technician, device,
# catalog, intervention...) et enregistre leurs classes auprès de
# SQLAlchemy. Sans ça, une relationship() qui référence une autre classe
# par son NOM (ex: relationship("Device", ...)) ne peut pas la résoudre si
# cette classe n'a jamais été importée ailleurs dans l'app -- c'est
# exactement l'erreur "failed to locate a name ('Device')" rencontrée.
import app.models  # noqa: F401

from app.api.routes.interventions import router as interventions_router
from app.api.routes.chat import router as chat_router
from app.api.routes.catalog import router as catalog_router
from app.api.routes.error_code import router as error_codes_router

app = FastAPI(
    title="Device Maintenance Chatbot API",
    description="Enregistrement et recherche des interventions de maintenance ATM/GAB.",
    version="0.1.0",
)

app.include_router(interventions_router)
app.include_router(chat_router)
app.include_router(catalog_router)
app.include_router(error_codes_router)

@app.get("/health")
def verifier_sante() -> dict:
    """Endpoint simple pour vérifier que l'API répond (utile pour un healthcheck)."""
    return {"status": "ok"}

