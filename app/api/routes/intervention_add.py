"""
Routes du technicien pour ajouter une intervention :
- POST /api/intervention_add                        : demander l'ajout (en attente de validation)
- GET  /api/intervention_add?technician_id=         : ses demandes et leur statut
- GET  /api/intervention_add/{id}?technician_id=    : relire une de ses demandes

Rien n'est visible dans la recherche avant l'approbation d'un administrateur
(voir admin_intervention_add.py). Logique métier : intervention_add_service.py.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.intervention_add_schema import InterventionAddOut, InterventionAddRequest
from app.services import intervention_add_service

router = APIRouter(prefix="/api/intervention_add", tags=["intervention_add"])


@router.post("", response_model=InterventionAddOut, status_code=201)
def demander_ajout_intervention(payload: InterventionAddRequest, db: Session = Depends(get_db)) -> InterventionAddOut:
    intervention_add = intervention_add_service.submit_intervention_add(db, payload)
    return InterventionAddOut(**intervention_add_service.describe_intervention_add(db, intervention_add))


@router.get("", response_model=list[InterventionAddOut])
def lister_mes_ajouts(
    technician_id: int = Query(...),
    status: Optional[Literal["pending", "approved", "rejected"]] = Query(None),
    db: Session = Depends(get_db),
) -> list[InterventionAddOut]:
    return [
        InterventionAddOut(**intervention_add_service.describe_intervention_add(db, intervention_add))
        for intervention_add in intervention_add_service.list_intervention_adds(db, status=status, technician_id=technician_id)
    ]


@router.get("/{intervention_add_id}", response_model=InterventionAddOut)
def lire_mon_ajout(intervention_add_id: int, technician_id: int = Query(...), db: Session = Depends(get_db)) -> InterventionAddOut:
    intervention_add = intervention_add_service.get_intervention_add_for_technician(db, intervention_add_id, technician_id)
    return InterventionAddOut(**intervention_add_service.describe_intervention_add(db, intervention_add))
