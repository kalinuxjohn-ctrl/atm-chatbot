"""
Routes d'administration des propositions de solution, toutes protégées par
la clé ADMIN_API_KEY (en-tête X-Admin-Key) :
- GET  /api/admin/solution-proposals            : liste (filtrable par statut)
- GET  /api/admin/solution-proposals/{id}       : détail
- POST /api/admin/solution-proposals/{id}/approve
- POST /api/admin/solution-proposals/{id}/reject

Un technicien n'a pas cette clé : il ne peut donc ni approuver ni rejeter,
y compris sa propre proposition.

Aucune logique métier ici : tout est délégué à solution_proposal_service.py.
"""

import hmac
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import AccessDeniedError
from app.schemas.solution_proposal_schema import (
    ProposalApproval,
    ProposalRejection,
    ProposalReviewResult,
    SolutionProposalOut,
)
from app.services import solution_proposal_service


def require_admin(x_admin_key: Optional[str] = Header(None)) -> None:
    expected = settings.admin_api_key
    if not expected:
        raise AccessDeniedError("Administration désactivée : définissez ADMIN_API_KEY côté serveur.")
    # compare_digest : temps de comparaison constant, la clé ne se devine pas caractère par caractère.
    if not x_admin_key or not hmac.compare_digest(x_admin_key.encode("utf-8"), expected.encode("utf-8")):
        raise AccessDeniedError("Clé administrateur invalide.")


router = APIRouter(
    prefix="/api/admin/solution-proposals",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[SolutionProposalOut])
def lister_propositions(
    status: Optional[Literal["pending", "approved", "rejected"]] = Query(None),
    db: Session = Depends(get_db),
) -> list[SolutionProposalOut]:
    return [
        SolutionProposalOut(**solution_proposal_service.describe_proposal(db, proposal))
        for proposal in solution_proposal_service.list_proposals(db, status=status)
    ]


@router.get("/{proposal_id}", response_model=SolutionProposalOut)
def lire_proposition(proposal_id: int, db: Session = Depends(get_db)) -> SolutionProposalOut:
    proposal = solution_proposal_service.get_proposal(db, proposal_id)
    return SolutionProposalOut(**solution_proposal_service.describe_proposal(db, proposal))


@router.post("/{proposal_id}/approve", response_model=ProposalReviewResult)
def approuver_proposition(
    proposal_id: int, payload: ProposalApproval, db: Session = Depends(get_db)
) -> ProposalReviewResult:
    proposal, integration, attached_action = solution_proposal_service.approve_proposal(db, proposal_id, payload)
    return ProposalReviewResult(
        proposal=SolutionProposalOut(**solution_proposal_service.describe_proposal(db, proposal)),
        knowledge_integration=integration,
        attached_intervention_action_id=getattr(attached_action, "intervention_action_id", None),
        attached_intervention_id=getattr(attached_action, "intervention_id", None),
    )


@router.post("/{proposal_id}/reject", response_model=ProposalReviewResult)
def rejeter_proposition(
    proposal_id: int, payload: ProposalRejection, db: Session = Depends(get_db)
) -> ProposalReviewResult:
    proposal = solution_proposal_service.reject_proposal(db, proposal_id, payload)
    return ProposalReviewResult(proposal=SolutionProposalOut(**solution_proposal_service.describe_proposal(db, proposal)))
