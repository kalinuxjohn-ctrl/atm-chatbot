"""
Photo jointe à un message du chat (POST /api/chat, champ "photo").

Elle sert UNIQUEMENT à lire le texte affiché sur l'appareil (OCR fait par
Claude, voir photo_ocr_service.py). Elle n'est jamais enregistrée : seul le
texte lu est conservé dans la conversation.
"""

from __future__ import annotations

import base64
import binascii
from typing import Literal

from pydantic import BaseModel, field_validator

from app.core.config import settings

# Formats d'image acceptés par l'API Claude.
PhotoMediaType = Literal["image/jpeg", "image/png", "image/webp", "image/gif"]


class PhotoAttachment(BaseModel):
    media_type: PhotoMediaType
    # Contenu de l'image en base64, SANS le préfixe « data:image/...;base64, ».
    data_base64: str

    @field_validator("data_base64")
    @classmethod
    def _check_image_content(cls, value: str) -> str:
        """Refuse (422) un contenu vide, qui n'est pas du base64 ou trop lourd."""
        value = value.strip()
        try:
            image_bytes = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Photo illisible : contenu base64 invalide.") from error
        if not image_bytes:
            raise ValueError("Photo vide.")
        if len(image_bytes) > settings.photo_max_bytes:
            raise ValueError(
                f"Photo trop lourde ({len(image_bytes) // 1000} Ko, maximum {settings.photo_max_bytes // 1000} Ko)."
            )
        return value
