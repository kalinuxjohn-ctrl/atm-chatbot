"""
Schémas des demandes d'ajout d'intervention (routes /api/intervention_add et
/api/admin/intervention_add).

Deux niveaux de contenu, du moins au plus complet :
- SubmittedInterventionContent : ce que le technicien remplit (ses mots à lui) ;
- ReviewedInterventionContent  : la même chose + les choix de l'admin (rattachement
  au catalogue, composant en cause). C'est cette forme qui est stockée en JSONB
  et écrite dans les tables à l'approbation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.device_type import NonEmptyStr
from app.schemas.intervention_schema import ActionOutcome

InterventionAddStatus = Literal["pending", "approved", "rejected"]
# Valeurs de l'ENUM PostgreSQL intervention_outcome (migration 0001).
InterventionOutcome = Literal["resolved", "partially_resolved", "unresolved", "escalated"]

MAX_SYMPTOMS = 20
MAX_ACTIONS = 30


# ====================================================================
# Contenu rempli par le technicien
# ====================================================================

class SubmittedSymptom(BaseModel):
    """Un problème constaté → une ligne intervention_symptom."""

    text: NonEmptyStr = Field(..., max_length=1000, description="Le problème, dans les mots du technicien.")
    severity: Optional[str] = Field(None, max_length=50)


class SubmittedAction(BaseModel):
    """Une chose faite sur place, dans l'ordre de la liste → une ligne intervention_action."""

    text: NonEmptyStr = Field(..., max_length=1000, description="Ce que le technicien a fait.")
    result_description: NonEmptyStr = Field(..., max_length=2000, description="Ce qui s'est passé ensuite.")
    outcome_status: ActionOutcome = "unknown"
    # TRUE = c'est CETTE action qui a réglé le problème (compte comme réussite dans les stats).
    is_confirmed_solution: bool = False
    # Numéro du symptôme visé dans la liste `symptoms` (1 = le premier). Vide = tous les symptômes.
    targets_symptom_number: Optional[int] = Field(None, ge=1)


class SubmittedDiagnosis(BaseModel):
    """La cause trouvée → une ligne diagnosis."""

    description: NonEmptyStr = Field(..., max_length=2000)
    confirmed: bool = False


class SubmittedInterventionContent(BaseModel):
    # L'appareil : son ID, ou son numéro de série (le backend retrouve l'ID).
    device_id: Optional[int] = None
    device_serial_number: Optional[str] = Field(None, max_length=100)
    ticket_reference: Optional[str] = Field(None, max_length=100)
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    final_outcome_status: InterventionOutcome
    summary_text: Optional[str] = Field(None, max_length=2000)
    symptoms: list[SubmittedSymptom] = Field(..., min_length=1, max_length=MAX_SYMPTOMS)
    actions: list[SubmittedAction] = Field(..., min_length=1, max_length=MAX_ACTIONS)
    diagnosis: Optional[SubmittedDiagnosis] = None

    @model_validator(mode="after")
    def check_consistency(self):
        _check_intervention_consistency(self)
        return self


class InterventionAddRequest(SubmittedInterventionContent):
    """Corps de POST /api/intervention_add."""

    technician_id: int
    # Conversation d'où vient la demande (facultatif) : gardée pour l'historique.
    conversation_id: Optional[int] = None


# ====================================================================
# Contenu stocké et corrigé par l'administrateur
# ====================================================================

class ReviewedSymptom(SubmittedSymptom):
    # Choix de l'admin. Vide = automatique à l'approbation :
    # symptôme du catalogue le plus proche, sinon nouvelle entrée nommée catalog_text (ou text).
    catalog_symptom_id: Optional[int] = None
    catalog_text: Optional[str] = Field(None, max_length=500)


class ReviewedAction(SubmittedAction):
    # Même règle que ReviewedSymptom, avec le catalogue d'actions.
    catalog_action_id: Optional[int] = None
    catalog_text: Optional[str] = Field(None, max_length=500)


class ReviewedDiagnosis(SubmittedDiagnosis):
    root_cause_component_id: Optional[int] = None


class ReviewedInterventionContent(SubmittedInterventionContent):
    # Toujours connu une fois la demande enregistrée (le numéro de série est résolu à l'envoi).
    device_id: int
    symptoms: list[ReviewedSymptom] = Field(..., min_length=1, max_length=MAX_SYMPTOMS)
    actions: list[ReviewedAction] = Field(..., min_length=1, max_length=MAX_ACTIONS)
    diagnosis: Optional[ReviewedDiagnosis] = None


def _check_intervention_consistency(content: SubmittedInterventionContent) -> None:
    """Règles qui gardent les statistiques justes (sinon 422 avant tout enregistrement)."""
    if content.device_id is None and not (content.device_serial_number or "").strip():
        raise ValueError("Indiquez l'appareil : device_id ou device_serial_number.")
    if content.opened_at and content.closed_at and content.closed_at < content.opened_at:
        raise ValueError("closed_at ne peut pas être avant opened_at.")

    for number, action in enumerate(content.actions, start=1):
        target = action.targets_symptom_number
        if target is not None and target > len(content.symptoms):
            raise ValueError(f"Action {number} : le symptôme n° {target} n'existe pas dans la liste.")
        if action.is_confirmed_solution and action.outcome_status != "resolved":
            raise ValueError(f"Action {number} : une solution confirmée doit avoir outcome_status = resolved.")

    has_confirmed_solution = any(action.is_confirmed_solution for action in content.actions)
    if content.final_outcome_status == "resolved" and not has_confirmed_solution:
        raise ValueError("Intervention résolue : indiquez quelle action a réglé le problème (is_confirmed_solution).")
    if has_confirmed_solution and content.final_outcome_status != "resolved":
        raise ValueError("Une action a réglé le problème : final_outcome_status doit valoir resolved.")


# ====================================================================
# Décisions de l'administrateur
# ====================================================================

class InterventionAddEdit(BaseModel):
    """Corps de PUT /api/admin/intervention_add/{id} : le contenu complet corrigé."""

    edited_by: NonEmptyStr = Field(..., max_length=200)
    content: ReviewedInterventionContent


class InterventionAddApproval(BaseModel):
    reviewed_by: NonEmptyStr = Field(..., max_length=200)
    admin_comment: Optional[str] = Field(None, max_length=2000)


class InterventionAddRejection(BaseModel):
    reviewed_by: NonEmptyStr = Field(..., max_length=200)
    admin_comment: NonEmptyStr = Field(..., max_length=2000, description="Raison du rejet, obligatoire.")


# ====================================================================
# Réponses
# ====================================================================

class InterventionAddOut(BaseModel):
    intervention_add_id: int
    status: InterventionAddStatus
    technician_id: int
    technician_name: Optional[str] = None
    conversation_id: Optional[int] = None
    device_label: Optional[str] = None  # ex. "GAB · Opteva 720 · Branch 14, Main St"
    created_at: Optional[datetime] = None
    last_edited_at: Optional[datetime] = None
    last_edited_by: Optional[str] = None
    edited_by_admin: bool = False  # content différent de submitted_content
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    admin_comment: Optional[str] = None
    created_intervention_id: Optional[int] = None
    content: ReviewedInterventionContent
    submitted_content: ReviewedInterventionContent


CatalogLink = Literal["chosen_by_admin", "matched_existing", "new_catalog_entry"]


class PlannedIntervention(BaseModel):
    device_id: int
    technician_id: int
    ticket_reference: Optional[str] = None
    opened_at: datetime
    closed_at: Optional[datetime] = None
    final_outcome_status: InterventionOutcome
    summary_text: Optional[str] = None


class PlannedSymptom(BaseModel):
    number: int  # position dans la demande (sert à targets_symptom_number)
    raw_text: str
    severity: Optional[str] = None
    symptom_id: Optional[int] = None  # NULL tant que la nouvelle entrée du catalogue n'est pas créée
    catalog_link: CatalogLink
    catalog_text: str
    match_distance: Optional[float] = None  # 0 = identique ; rempli pour matched_existing
    embedding: str = "calculé à l'approbation (vector(1024), Voyage AI)"


class PlannedAction(BaseModel):
    sequence_order: int
    raw_text: str
    result_description: str
    outcome_status: str
    is_confirmed_solution: bool
    targets_symptom_number: Optional[int] = None
    action_id: Optional[int] = None
    catalog_link: CatalogLink
    catalog_text: str
    match_distance: Optional[float] = None


class PlannedDiagnosis(BaseModel):
    description: str
    confirmed: bool
    root_cause_component_id: Optional[int] = None


class InsertionPreview(BaseModel):
    """Ce que l'approbation écrira, table par table (rien n'est écrit pour l'instant)."""

    intervention_add_id: int
    intervention: PlannedIntervention
    intervention_symptom: list[PlannedSymptom]
    intervention_action: list[PlannedAction]
    diagnosis: Optional[PlannedDiagnosis] = None
    new_catalog_symptoms: list[str] = Field(default_factory=list)  # → table symptom
    new_catalog_actions: list[str] = Field(default_factory=list)  # → table action
    recomputes_stats: bool = True  # symptom_action_outcome_stats est recalculée après l'écriture


class InterventionAddApprovalResult(BaseModel):
    intervention_add: InterventionAddOut
    written: InsertionPreview  # ce qui a été écrit, avec les ID définitifs
    created_intervention_id: int
    created_intervention_symptom_ids: list[int]
    created_intervention_action_ids: list[int]
    created_diagnosis_id: Optional[int] = None
