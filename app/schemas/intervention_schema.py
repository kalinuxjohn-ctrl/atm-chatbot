"""
Ce fichier définit la forme des données qui entrent et sortent de l'API :
- Il vérifie que le JSON envoyé par l'utilisateur contient les bons champs et le bon format.
- Il filtre et organise les données renvoyées par le serveur.
- Il transforme automatiquement les données de la BDD en format JSON pour le client.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SymptomInput(BaseModel):
    """Symptôme tel que rapporté par le technicien."""

    raw_text: str = Field(..., description="Formulation exacte du technicien.")
    severity: Optional[str] = None


class InterventionCreate(BaseModel):
    """Payload attendu pour créer une intervention avec ses symptômes."""

    device_id: int
    technician_id: int
    ticket_reference: Optional[str] = None
    opened_at: Optional[datetime] = None
    symptoms: list[SymptomInput] = Field(..., min_length=1)


class SymptomOut(BaseModel):
    intervention_symptom_id: int
    raw_text: str
    severity: Optional[str] = None
    symptom_id: Optional[int] = None

    model_config = {"from_attributes": True}


class InterventionOut(BaseModel):
    intervention_id: int
    device_id: int
    technician_id: int
    ticket_reference: Optional[str] = None
    opened_at: datetime
    final_outcome_status: Optional[str] = None
    symptoms: list[SymptomOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ActionInput(BaseModel):
    """Action tentée par le technicien, telle que rapportée pour une intervention."""

    action_id: Optional[int] = None
    raw_text: str = Field(..., description="Description du technicien de ce qu'il a fait.")
    # sequence_order retiré du payload d'entrée : il est calculé côté serveur
    # (voir intervention_service.add_action_to_intervention) et n'a donc pas
    # à être fourni ni pris en compte quand il l'est.
    performed_at: Optional[datetime] = None
    result_description: str
    outcome_status: str = "unknown"
    is_confirmed_solution: bool = False
    targets_symptom_id: Optional[int] = None  # quel symptôme précis ça visait, si l'intervention en a plusieurs


class ActionOut(BaseModel):
    intervention_action_id: int
    intervention_id: int
    action_id: Optional[int] = None
    raw_text: str
    sequence_order: int
    performed_at: Optional[datetime] = None
    result_description: str
    outcome_status: str
    is_confirmed_solution: bool
    targets_symptom_id: Optional[int] = None  # quel symptôme précis ça visait, si l'intervention en a plusieurs

    model_config = {"from_attributes": True}