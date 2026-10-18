"""
Routes d'administration des demandes d'ajout d'intervention, protégées par la clé
ADMIN_API_KEY (en-tête X-Admin-Key) :

    GET  /api/admin/intervention_add?status=      liste
    GET  /api/admin/intervention_add/{id}         détail (contenu actuel + envoi d'origine)
    GET  /api/admin/intervention_add/{id}/preview ce que l'approbation écrira, table par table
    PUT  /api/admin/intervention_add/{id}         corriger le contenu avant décision
    POST /api/admin/intervention_add/{id}/approve écrire dans l'historique
    POST /api/admin/intervention_add/{id}/reject  refuser (commentaire obligatoire)

Aucune logique métier ici : tout est délégué à intervention_add_service.py.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.routes.admin import require_admin
from app.core.database import get_db
from app.schemas.intervention_add_schema import (
    InsertionPreview,
    InterventionAddOut,
    InterventionAddApproval,
    InterventionAddApprovalResult,
    InterventionAddEdit,
    InterventionAddRejection,
)
from app.services import intervention_add_service as service

router = APIRouter(
    prefix="/api/admin/intervention_add",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


def _out(db: Session, intervention_add) -> InterventionAddOut:
    return InterventionAddOut(**service.describe_intervention_add(db, intervention_add))


@router.get("", response_model=list[InterventionAddOut])
def lister_ajouts(
    status: Optional[Literal["pending", "approved", "rejected"]] = Query(None),
    db: Session = Depends(get_db),
) -> list[InterventionAddOut]:
    return [_out(db, intervention_add) for intervention_add in service.list_intervention_adds(db, status=status)]


@router.get("/{intervention_add_id}", response_model=InterventionAddOut)
def lire_ajout(intervention_add_id: int, db: Session = Depends(get_db)) -> InterventionAddOut:
    return _out(db, service.get_intervention_add(db, intervention_add_id))


@router.get("/{intervention_add_id}/preview", response_model=InsertionPreview)
def apercu_ecriture(intervention_add_id: int, db: Session = Depends(get_db)) -> InsertionPreview:
    return service.preview_intervention_add(db, intervention_add_id)


@router.put("/{intervention_add_id}", response_model=InterventionAddOut)
def corriger_ajout(intervention_add_id: int, payload: InterventionAddEdit, db: Session = Depends(get_db)) -> InterventionAddOut:
    return _out(db, service.update_intervention_add(db, intervention_add_id, payload))


@router.post("/{intervention_add_id}/approve", response_model=InterventionAddApprovalResult)
def approuver_ajout(intervention_add_id: int, payload: InterventionAddApproval, db: Session = Depends(get_db)) -> InterventionAddApprovalResult:
    intervention_add, written_plan, written = service.approve_intervention_add(db, intervention_add_id, payload)
    return InterventionAddApprovalResult(
        intervention_add=_out(db, intervention_add),
        written=written_plan,
        created_intervention_id=written.intervention_id,
        created_device_id=written.device_id if written.created_device else None,
        created_device_model_id=written_plan.device.model_id if written.created_model else None,
        created_intervention_symptom_ids=written.intervention_symptom_ids,
        created_intervention_action_ids=written.intervention_action_ids,
        created_diagnosis_id=written.diagnosis_id,
    )


@router.post("/{intervention_add_id}/reject", response_model=InterventionAddOut)
def rejeter_ajout(intervention_add_id: int, payload: InterventionAddRejection, db: Session = Depends(get_db)) -> InterventionAddOut:
    return _out(db, service.reject_intervention_add(db, intervention_add_id, payload))
