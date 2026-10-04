"""
Schémas Pydantic pour POST /api/chat.

Fichier séparé de chat_schema.py (qui garde SymptomSearchRequest/Response
pour la recherche de symptômes déjà en place) pour ne pas toucher un
fichier existant utilisé par une fonctionnalité différente.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.schemas.device_type import DeviceType, NonEmptyStr


class ChatRequest(BaseModel):
    conversation_id: Optional[int] = None  # absent -> nouvelle conversation
    technician_id: int  # TODO: remplacer par la dépendance d'auth existante si disponible
    message: NonEmptyStr
    device_type: Optional[DeviceType] = None  # "gab" ou "tpe" uniquement ; requis par retrieval_service pour chercher ;
    # facultatif ici car mémorisé dans le contexte dès qu'il est fourni une première fois.


class ChatResponse(BaseModel):
    conversation_id: int
    reply: str


    