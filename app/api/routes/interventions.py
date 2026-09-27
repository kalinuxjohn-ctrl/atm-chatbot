"""
Routes HTTP pour la partie "enregistrement des symptômes/actions" :
- POST /interventions                 : enregistrer une nouvelle intervention + ses symptômes
- GET  /interventions/{id}            : relire une intervention déjà enregistrée
- POST /interventions/{id}/actions    : enregistrer une action tentée + son résultat
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.intervention_schema import ActionInput, ActionOut, InterventionCreate, InterventionOut
from app.services.intervention_service import (
    add_action_to_intervention,
    create_intervention_with_symptoms,
    get_intervention_by_id,
)

router = APIRouter(prefix="/interventions", tags=["interventions"])


@router.post("", response_model=InterventionOut, status_code=201)
def enregistrer_intervention(payload: InterventionCreate, db: Session = Depends(get_db)) -> InterventionOut:
    """
    Enregistre une nouvelle intervention avec ses symptômes initiaux.

    Le technicien envoie ce qu'il a observé dans ses propres mots
    (`raw_text`) -- aucune normalisation n'est requise à ce stade, elle
    viendra dans une étape ultérieure (rattachement au catalogue `symptom`,
    puis recherche sémantique).
    """
    intervention = create_intervention_with_symptoms(db, payload)
    return intervention


@router.get("/{intervention_id}", response_model=InterventionOut)
def lire_intervention(intervention_id: int, db: Session = Depends(get_db)) -> InterventionOut:
    """Relit une intervention par son ID, avec tous ses symptômes et actions enregistrés."""
    intervention = get_intervention_by_id(db, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail=f"Intervention {intervention_id} introuvable.")
    return intervention


@router.post("/{intervention_id}/actions", response_model=ActionOut, status_code=201)
def enregistrer_action(
    intervention_id: int, payload: ActionInput, db: Session = Depends(get_db)
) -> ActionOut:
    """
    Enregistre une action tentée par le technicien sur une intervention déjà
    ouverte, avec son résultat. `is_confirmed_solution=true` est le signal
    qui alimentera plus tard le calcul d'accuracy (symptom_action_outcome_stats).
    """
    action = add_action_to_intervention(db, intervention_id, payload)
    if action is None:
        raise HTTPException(status_code=404, detail=f"Intervention {intervention_id} introuvable.")
    return action