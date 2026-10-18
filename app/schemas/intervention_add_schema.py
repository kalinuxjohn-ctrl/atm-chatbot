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

from app.schemas.device_type import DeviceType, NonEmptyStr
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
    performed_at: Optional[datetime] = None


class SubmittedDiagnosis(BaseModel):
    """La cause trouvée → une ligne diagnosis."""

    description: NonEmptyStr = Field(..., max_length=2000)
    confirmed: bool = False


class SubmittedDevice(BaseModel):
    """
    L'appareil réparé → une ligne device. Le backend cherche d'abord un appareil
    existant (device_id, sinon serial_number, sinon type + modèle + site) ;
    sinon un NOUVEL appareil (et au besoin son modèle) sera créé à l'approbation,
    et device_type devient obligatoire.
    """

    device_id: Optional[int] = None
    serial_number: Optional[str] = Field(None, max_length=100)
    device_type: Optional[DeviceType] = None  # gab | tpe
    model_name: Optional[str] = Field(None, max_length=200)  # ex. "Opteva 720", cherché dans device_model
    site_name: Optional[str] = Field(None, max_length=200)
    address: Optional[str] = Field(None, max_length=500)


class SubmittedInterventionContent(BaseModel):
    device: SubmittedDevice
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


class ReviewedDevice(SubmittedDevice):
    # Ligne device_model trouvée à partir de model_name (modifiable par l'admin). Vide = modèle inconnu.
    model_id: Optional[int] = None

    @model_validator(mode="after")
    def check_new_device_has_a_type(self):
        if self.device_id is None and self.device_type is None:
            raise ValueError("Nouvel appareil : device_type (gab ou tpe) est obligatoire.")
        return self


class ReviewedInterventionContent(SubmittedInterventionContent):
    # device_id rempli si l'appareil existe déjà ; vide = nouvel appareil créé à l'approbation.
    device: ReviewedDevice
    symptoms: list[ReviewedSymptom] = Field(..., min_length=1, max_length=MAX_SYMPTOMS)
    actions: list[ReviewedAction] = Field(..., min_length=1, max_length=MAX_ACTIONS)
    diagnosis: Optional[ReviewedDiagnosis] = None


def _check_intervention_consistency(content: SubmittedInterventionContent) -> None:
    """Règles qui gardent les statistiques justes (sinon 422 avant tout enregistrement)."""
    device = content.device
    if device.device_id is None and not (device.serial_number or "").strip() and device.device_type is None:
        raise ValueError("Indiquez l'appareil : device_id, serial_number, ou device_type pour un nouvel appareil.")
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


class PlannedDevice(BaseModel):
    device_id: Optional[int] = None  # vide = nouvel appareil, créé à l'approbation
    is_new: bool
    device_type: str
    serial_number: Optional[str] = None
    model_id: Optional[int] = None
    model_name: Optional[str] = None
    is_new_model: bool = False  # modèle absent de device_model : créé à l'approbation
    site_name: Optional[str] = None
    address: Optional[str] = None


class PlannedIntervention(BaseModel):
    device_id: Optional[int] = None  # vide tant que le nouvel appareil n'est pas créé
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
    performed_at: Optional[datetime] = None
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
    device: PlannedDevice  # → table device (ligne existante, ou nouvelle)
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
    created_device_id: Optional[int] = None  # rempli seulement si un nouvel appareil a été créé
    created_device_model_id: Optional[int] = None  # rempli seulement si un nouveau modèle a été créé
    created_intervention_symptom_ids: list[int]
    created_intervention_action_ids: list[int]
    created_diagnosis_id: Optional[int] = None
