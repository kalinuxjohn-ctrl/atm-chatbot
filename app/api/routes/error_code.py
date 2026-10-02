"""
Route HTTP de recherche classique de codes d'erreur -- indépendante du
pipeline vectoriel (voir error_code_service.py).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.error_code_schema import ErrorCodeSearchResponse
from app.services.error_code_service import search_error_codes

router = APIRouter(prefix="/api/error_code", tags=["error_code"])


@router.get("/search", response_model=ErrorCodeSearchResponse)
def rechercher_code_erreur(
    q: str = Query(..., min_length=1, description="Code recherché, exact ou partiel."),
    db: Session = Depends(get_db),
) -> ErrorCodeSearchResponse:
    """Recherche texte classique (ILIKE) -- aucun résultat renvoie une liste vide, jamais une erreur serveur."""
    resultats = search_error_codes(db, q)
    return ErrorCodeSearchResponse(query=q, results=resultats)