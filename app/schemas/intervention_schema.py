
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
    """Sympt?me tel que rapport? par le technicien."""

    raw_text: str = Field(..., description="Formulation exacte du technicien.")
    severity: Optional[str] = None


class InterventionCreate(BaseModel):
    """Payload attendu pour cr?er une intervention avec ses sympt?mes."""

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
