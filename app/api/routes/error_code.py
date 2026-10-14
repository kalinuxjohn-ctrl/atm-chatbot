"""
Routes HTTP des codes d'erreur -- indépendantes du pipeline vectoriel
(voir error_code_service.py) :

    GET /api/error_code?device_type=gab   menu « Codes d'erreur connus »
    GET /api/error_code/{id}/solution        réponse enregistrée d'un code
    GET /api/error_code/search?q=E4       recherche classique (ILIKE)
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tracing import trace
from app.schemas.device_type import DeviceType
from app.schemas.error_code_schema import ErrorCodeReplyOut, ErrorCodeSearchResponse, ErrorCodeSuggestionOut
from app.services.error_code_service import get_error_code_reply, list_error_codes_with_reply, search_error_codes

router = APIRouter(prefix="/api/error_code", tags=["error_code"])


@router.get("/search", response_model=ErrorCodeSearchResponse)
def rechercher_code_erreur(
    q: str = Query(..., min_length=1, description="Code recherché, exact ou partiel."),
    db: Session = Depends(get_db),
) -> ErrorCodeSearchResponse:
    """Recherche texte classique (ILIKE) -- aucun résultat renvoie une liste vide, jamais une erreur serveur."""
    trace(
        "REQUEST",
        "Recherche SQL de codes d'erreur reçue",
        endpoint="/api/error_code/search",
        query_length=len(q),
    )
    resultats = search_error_codes(db, q)
    trace(
        "RESPONSE",
        "Résultats de recherche des codes d'erreur prêts à retourner",
        count=len(resultats),
    )
    return ErrorCodeSearchResponse(query=q, results=resultats)


@router.get("", response_model=list[ErrorCodeSuggestionOut])
def lister_codes_erreur_connus(
    device_type: DeviceType = Query(..., description="gab ou tpe."),
    db: Session = Depends(get_db),
) -> list[ErrorCodeSuggestionOut]:
    """Codes ayant une réponse enregistrée pour cet équipement (liste vide s'il n'y en a aucun)."""
    codes = list_error_codes_with_reply(db, device_type)
    trace("RESPONSE", "Codes d'erreur connus prêts à retourner", device_type=device_type, count=len(codes))
    return codes


@router.get("/{error_code_id}/solution", response_model=ErrorCodeReplyOut)
def lire_reponse_code_erreur(error_code_id: int, db: Session = Depends(get_db)) -> ErrorCodeReplyOut:
    """Réponse enregistrée du code, lue en base : ni LLM, ni embedding."""
    trace("REQUEST", "Réponse enregistrée d'un code d'erreur demandée", error_code_id=error_code_id)
    return get_error_code_reply(db, error_code_id)
