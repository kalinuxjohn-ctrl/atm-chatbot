"""
Routes HTTP pour la vérification anti-doublon du catalogue d'actions :
- GET  /catalog/actions/similar : candidats existants ressemblant à un texte
- POST /catalog/actions/resolve : décision du technicien (nouvelle entrée ou fusion)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.catalog_schema import ResolveActionRequest, ResolveActionResponse, SimilarActionCandidate
from app.services.catalog_service import find_similar_actions, resolve_action_catalog_link

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/actions/similar", response_model=list[SimilarActionCandidate])
def chercher_actions_similaires(
    text: str, limit: int = 5, db: Session = Depends(get_db)
) -> list[SimilarActionCandidate]:
    """Montre les actions déjà cataloguées les plus proches -- à charge au technicien de juger."""
    return find_similar_actions(db, text, limit)


@router.post("/actions/resolve", response_model=ResolveActionResponse)
def resoudre_action(payload: ResolveActionRequest, db: Session = Depends(get_db)) -> ResolveActionResponse:
    """Rattache une action non cataloguée au catalogue, selon la décision du technicien."""
    action_intervention = resolve_action_catalog_link(db, payload)
    if action_intervention is None:
        raise HTTPException(
            status_code=404,
            detail=f"Action d'intervention {payload.intervention_action_id} introuvable.",
        )
    return ResolveActionResponse(
        intervention_action_id=action_intervention.intervention_action_id,
        action_id=action_intervention.action_id,
    )