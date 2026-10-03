"""
Sortie du Niveau 1 (message_understanding_service.understand_message) :
intention + texte brut présent dans le message. AUCUN champ ne se termine
en "_id" -- le LLM ne manipule que du texte et une intention, jamais un
identifiant interne. La résolution vers de vrais ID se fait uniquement
dans technical_reference_resolver_service.py, jamais ici.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class UnderstoodMessage(BaseModel):
    # extra="ignore" : si le LLM invente un champ en plus (ex. tente de
    # renvoyer un "model_id"), il est silencieusement ignoré plutôt que de
    # faire planter la validation ou, pire, d'être utilisé quelque part.
    model_config = ConfigDict(extra="ignore")

    intent: Literal["conversation", "detail_request", "diagnostic"]
    device_type_text: Optional[str] = None
    model_name_text: Optional[str] = None
    error_code_text: Optional[str] = None
    reformulated_problem_text: Optional[str] = None  # uniquement si intent == "diagnostic"