"""
Schémas des propositions de solution (routes /api/chat/conversations/... et
/api/admin/solution-proposals).

Le technicien n'envoie QUE ce qu'il est seul à savoir (son action, son
résultat) : aucun identifiant métier n'est accepté en entrée, ils sont tous
relus par le backend dans le contexte de la conversation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.device_type import NonEmptyStr

ProposalStatus = Literal["pending", "approved", "rejected"]
# Sous-ensemble de l'ENUM action_outcome : on ne propose que ce qui a (au moins en partie) marché.
ProposalOutcome = Literal["resolved", "partial"]


# ---------- Contexte affiché au technicien ----------

class ProposalContextIds(BaseModel):
    """Identifiants résolus par le backend : affichés, jamais renvoyés par le frontend."""

    intervention_id: Optional[int] = None
    intervention_symptom_id: Optional[int] = None
    symptom_id: Optional[int] = None
    component_id: Optional[int] = None
    device_id: Optional[int] = None
    device_type: str
    model_id: Optional[int] = None
    error_code_id: Optional[int] = None


class ProposalProblem(BaseModel):
    label: str  # libellé court : symptôme du catalogue, sinon problème reformulé
    description: str  # problème tel que reformulé lors de la recherche
    component_name: Optional[str] = None
    device_label: str  # ex. "GAB · MX5600"
    error_code: Optional[str] = None


class PreviousResult(BaseModel):
    position: int
    kind: Literal["case", "stat"]
    intervention_id: Optional[int] = None
    intervention_symptom_id: Optional[int] = None
    symptom_text: Optional[str] = None
    solution_text: Optional[str] = None  # solution proposée par le Copilote pour ce résultat


class ProposalContextResponse(BaseModel):
    conversation_id: int
    context: ProposalContextIds
    problem: ProposalProblem
    reference_position: Optional[int] = None  # résultat qui sert de cas de référence
    previous_results: list[PreviousResult] = Field(default_factory=list)


# ---------- Envoi par le technicien ----------

class SolutionProposalCreate(BaseModel):
    technician_id: int  # TODO: remplacer par la dépendance d'auth existante si disponible (comme ChatRequest)
    proposed_action: NonEmptyStr = Field(..., max_length=2000, description="Ce que le technicien a fait.")
    result_description: NonEmptyStr = Field(..., max_length=2000, description="Ce qui s'est passé ensuite.")
    outcome_status: ProposalOutcome = "resolved"


class SolutionProposalCreated(BaseModel):
    proposal_id: int
    status: ProposalStatus
    reply: str  # message affiché dans le fil, aussi enregistré dans l'historique


# ---------- Administration ----------

class SolutionProposalOut(BaseModel):
    proposal_id: int
    status: ProposalStatus
    created_at: datetime
    conversation_id: int
    technician_id: int
    technician_name: Optional[str] = None
    intervention_id: Optional[int] = None
    intervention_symptom_id: Optional[int] = None
    symptom_id: Optional[int] = None
    component_id: Optional[int] = None
    component_name: Optional[str] = None
    device_id: Optional[int] = None
    device_type: str
    model_name: Optional[str] = None
    error_code: Optional[str] = None
    problem_text: str
    problem_label: str
    proposed_action: str
    result_description: str
    outcome_status: str
    previous_results: list[PreviousResult] = Field(default_factory=list)
    conversation_context_snapshot: dict
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    admin_comment: Optional[str] = None
    approved_action_id: Optional[int] = None


class ProposalApproval(BaseModel):
    reviewed_by: NonEmptyStr = Field(..., max_length=200)
    admin_comment: Optional[str] = Field(None, max_length=2000)
    # Facultatif : l'administrateur rattache lui-même la proposition à une
    # action existante. Sinon la détection de doublon choisit.
    existing_action_id: Optional[int] = None
    # Facultatif : libellé officiel de l'action au catalogue (par défaut, le
    # texte du technicien). Sert aussi à la détection de doublon.
    canonical_text: Optional[str] = Field(None, max_length=500)


class ProposalRejection(BaseModel):
    reviewed_by: NonEmptyStr = Field(..., max_length=200)
    admin_comment: NonEmptyStr = Field(..., max_length=2000, description="Raison du rejet, conservée pour l'historique.")


class ProposalReviewResult(BaseModel):
    proposal: SolutionProposalOut
    # "action_created" | "existing_action_reused" | "existing_action_linked" | None (rejet)
    knowledge_integration: Optional[str] = None
    # intervention_action créée pour rattacher la solution au problème
    # (None : rejet, ou proposition sans cas de référence).
    attached_intervention_action_id: Optional[int] = None
    attached_intervention_id: Optional[int] = None
