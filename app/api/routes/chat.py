"""
Route HTTP pour la recherche de symptôme (le point d'entrée du flux du
technicien) :
- POST /chat/search-symptom : le technicien décrit ce qu'il observe sur un
  GAB ou un TPE, l'API renvoie les solutions déjà connues, classées par
  accuracy décroissante.

Aucune logique métier ici : tout est délégué à retrieval_service.py.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.chat_schema import SymptomSearchRequest, SymptomSearchResponse
from app.services.retrieval_service import find_ranked_solutions
from app.services.llm_service import summarize_solutions

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/search-symptom", response_model=SymptomSearchResponse)
def rechercher_symptome(payload: SymptomSearchRequest, db: Session = Depends(get_db)) -> SymptomSearchResponse:
    """
    Retrouve les symptômes catalogués les plus proches de la description du
    technicien (recherche vectorielle, restreinte au même device_type), puis
    renvoie les actions déjà tentées pour ces symptômes, classées par
    accuracy décroissante -- aucun résultat n'est masqué.
    """

    result = find_ranked_solutions(db, raw_text=payload.raw_text, device_type=payload.device_type)
    resume = summarize_solutions(payload.raw_text, result["solutions"])
    return SymptomSearchResponse(**result, summary=resume)


