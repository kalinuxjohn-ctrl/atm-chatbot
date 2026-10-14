"""
Sortie de l'appel LLM de chaque message (message_understanding_service.understand_message) :
intention, texte brut présent dans le message et, hors diagnostic, la
réponse rédigée par le LLM. AUCUN champ ne se termine en "_id" -- le LLM ne
manipule que du texte, une intention et un numéro de résultat affiché,
jamais un identifiant interne. La résolution vers de vrais ID se fait uniquement
dans technical_reference_resolver_service.py, jamais ici.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator


class UnderstoodMessage(BaseModel):
    # extra="ignore" : si le LLM invente un champ en plus (ex. tente de
    # renvoyer un "model_id"), il est silencieusement ignoré plutôt que de
    # faire planter la validation ou, pire, d'être utilisé quelque part.
    model_config = ConfigDict(extra="ignore")

    # "diagnostic" : nouvelle panne à chercher en base ; "conversation" : tout
    # le reste (questions sur les résultats, suivi, questions générales...).
    intent: Literal["conversation", "diagnostic"]
    device_type_text: Optional[str] = None
    model_name_text: Optional[str] = None
    error_code_text: Optional[str] = None
    reformulated_problem_text: Optional[str] = None  # uniquement si intent == "diagnostic"
    # Numéro (« Cas 2 » -> 2) du résultat de la dernière recherche dont parle
    # le technicien. Vérifié par le backend contre la dernière recherche.
    result_position: Optional[int] = None
    # Réponse au technicien, rédigée par le LLM (uniquement si intent == "conversation").
    reply: Optional[str] = None

    @model_validator(mode="after")
    def _reply_required_outside_diagnostic(self):
        # Sans réponse, le technicien n'aurait rien : réponse inexploitable (-> 503).
        if self.intent == "conversation" and not (self.reply or "").strip():
            raise ValueError("Réponse absente pour un message hors diagnostic.")
        return self