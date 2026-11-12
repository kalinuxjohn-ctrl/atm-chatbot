"""
Schémas Pydantic pour POST /api/chat.

Fichier séparé de chat_schema.py (qui garde SymptomSearchRequest/Response
pour la recherche de symptômes déjà en place) pour ne pas toucher un
fichier existant utilisé par une fonctionnalité différente.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.device_type import DeviceType
from app.schemas.photo_schema import PhotoAttachment


class ChatRequest(BaseModel):
    conversation_id: Optional[int] = None  # absent -> nouvelle conversation
    technician_id: int  # TODO: remplacer par la dépendance d'auth existante si disponible
    # Peut être vide seulement si une photo est jointe (voir _message_or_photo).
    message: str = ""
    device_type: Optional[DeviceType] = None  # "gab" ou "tpe" uniquement ; requis par retrieval_service pour chercher ;
    # facultatif ici car mémorisé dans le contexte dès qu'il est fourni une première fois.
    # Photo de l'appareil, lue par Claude (photo_ocr_service.py). Jamais enregistrée.
    photo: Optional[PhotoAttachment] = None

    @model_validator(mode="after")
    def _message_or_photo(self):
        self.message = self.message.strip()
        if not self.message and self.photo is None:
            raise ValueError("Message vide : écris un message ou joins une photo.")
        return self


class ChatResponse(BaseModel):
    conversation_id: int
    reply: str
    detected_error_code: Optional[str] = None
    error_code_id: Optional[int] = None
    # True quand CE message a produit des solutions (nouvelle recherche avec
    # au moins un résultat) : le frontend affiche alors « Aucune de ces
    # solutions ne fonctionne ». Champ ajouté : les clients existants l'ignorent.
    solution_proposal_available: bool = False
    intervention_add_available: bool = False
    intervention_add_problem: Optional[str] = None


class SavedErrorCodeRequest(BaseModel):
    conversation_id: Optional[int] = None
    technician_id: int = Field(gt=0)
    device_type: DeviceType
    error_code_id: int = Field(gt=0)


class ConversationSummary(BaseModel):
    conversation_id: int
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationList(BaseModel):
    items: list[ConversationSummary]
    has_more: bool


class ConversationMessageOut(BaseModel):
    message_id: int
    role: Literal["user", "assistant"]
    content: str
    detected_error_code: Optional[str] = None
    error_code_id: Optional[int] = None
    created_at: datetime


class ConversationHistory(BaseModel):
    conversation_id: int
    device_type: DeviceType
    messages: list[ConversationMessageOut]