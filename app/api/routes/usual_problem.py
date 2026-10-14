"""
Routes HTTP du menu « Pannes fréquentes » -- lecture SQL simple, ni LLM ni
embedding (voir usual_problem_service.py) :

    GET /api/usual_problem?device_type=gab   liste du menu
    GET /api/usual_problem/{id}/solution        réponse enregistrée d'une panne
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tracing import trace
from app.schemas.device_type import DeviceType
from app.schemas.usual_problem_schema import UsualProblemOut, UsualProblemReplyOut
from app.services.usual_problem_service import get_usual_problem, list_usual_problems

router = APIRouter(prefix="/api/usual_problem", tags=["usual_problem"])


@router.get("", response_model=list[UsualProblemOut])
def lister_pannes_frequentes(
    device_type: DeviceType = Query(..., description="gab ou tpe."),
    db: Session = Depends(get_db),
) -> list[UsualProblemOut]:
    """Pannes fréquentes de cet équipement (liste vide s'il n'y en a aucune)."""
    pannes = list_usual_problems(db, device_type)
    trace("RESPONSE", "Pannes fréquentes prêtes à retourner", device_type=device_type, count=len(pannes))
    return pannes


@router.get("/{usual_problem_id}/solution", response_model=UsualProblemReplyOut)
def lire_reponse_panne_frequente(usual_problem_id: int, db: Session = Depends(get_db)) -> UsualProblemReplyOut:
    """Réponse enregistrée de la panne, lue en base : ni LLM, ni embedding."""
    trace("REQUEST", "Réponse enregistrée d'une panne fréquente demandée", usual_problem_id=usual_problem_id)
    return get_usual_problem(db, usual_problem_id)
