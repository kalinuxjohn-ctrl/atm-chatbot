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

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class IdentifiedSymptom(BaseModel):
    """Un symptôme distinct cité par le technicien, numéroté à partir de 1."""

    model_config = ConfigDict(extra="ignore")

    number: int
    text: str


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
    # Chaque symptôme distinct du message, cherché SÉPARÉMENT en base (un
    # embedding par symptôme) : un problème à plusieurs symptômes peut ainsi
    # recouper plusieurs symptômes d'une même intervention passée.
    symptoms: list[IdentifiedSymptom] = []
    # Numéro (« Cas 2 » -> 2) du résultat de la dernière recherche dont parle
    # le technicien. Vérifié par le backend contre la dernière recherche.
    result_position: Optional[int] = None
    # Réponse au technicien, rédigée par le LLM (uniquement si intent == "conversation").
    reply: Optional[str] = None

    @field_validator("symptoms", mode="before")
    @classmethod
    def _normalize_symptoms(cls, value):
        """
        Tolère null et une simple liste de textes. Écarte les vides et les
        doublons, puis renumérote 1, 2, 3... dans l'ordre reçu : le backend ne
        dépend pas d'une numérotation parfaite du LLM.
        """
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("« symptoms » doit être une liste.")
        texts: list[str] = []
        for item in value:
            raw_text = item.get("text") if isinstance(item, dict) else item
            if not isinstance(raw_text, str):
                continue
            cleaned = " ".join(raw_text.split())
            if cleaned and cleaned.casefold() not in {known.casefold() for known in texts}:
                texts.append(cleaned)
        return [{"number": index + 1, "text": text} for index, text in enumerate(texts)]

    @model_validator(mode="after")
    def _reply_required_outside_diagnostic(self):
        # Sans réponse, le technicien n'aurait rien : réponse inexploitable (-> 503).
        if self.intent == "conversation" and not (self.reply or "").strip():
            raise ValueError("Réponse absente pour un message hors diagnostic.")
        return self