"""
Contrats de données pour l'endpoint de recherche de symptôme (/chat) :
- Ce que le technicien envoie : une description libre du symptôme + le type
  d'appareil concerné (gab ou tpe).
- Ce que l'API renvoie : les solutions déjà connues pour ce symptôme,
  classées par accuracy décroissante, sans rien cacher.
"""

from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.device_type import DeviceType, NonEmptyStr


class SymptomSearchRequest(BaseModel):
    """Symptôme décrit en langage libre par le technicien, sur un appareil donné."""

    raw_text: NonEmptyStr = Field(..., description="Formulation exacte du technicien.")
    device_type: DeviceType


class SolutionSuggestion(BaseModel):
    """Une action déjà tentée pour un symptôme catalogué, avec son historique."""

    symptom_id: int
    symptom_text: str
    action_id: int
    action_text: str
    attempts: int
    successes: int
    accuracy_score: float

    model_config = {"from_attributes": True}


class SymptomSearchResponse(BaseModel):
    matched_symptom_ids: list[int] = Field(
        default_factory=list,
        description="Symptômes catalogués retrouvés par similarité, à l'origine des solutions ci-dessous.",
    )
    solutions: list[SolutionSuggestion] = Field(default_factory=list)
    summary: str = ""  # reformulation en langage naturel des solutions ci-dessus (via Ollama)