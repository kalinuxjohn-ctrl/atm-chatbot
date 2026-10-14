"""Contrats de données des routes /api/error_code (recherche classique et réponses enregistrées)."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.device_type import DeviceType, NonEmptyStr


class FaultOut(BaseModel):
    # validation_alias : l'attribut ORM s'appelle fault_id, mais l'API
    # expose "id" (voir le format de réponse demandé).
    id: int = Field(validation_alias="fault_id")
    code: str | None = None
    name: str

    model_config = {"from_attributes": True, "populate_by_name": True}


class ErrorCodeOut(BaseModel):
    id: int = Field(validation_alias="error_code_id")
    code: str
    description: str | None = None
    fault: FaultOut | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ErrorCodeSearchResponse(BaseModel):
    query: str
    results: list[ErrorCodeOut]


class ErrorCodeSuggestionOut(BaseModel):
    """Une entrée du menu « Codes d'erreur connus » (GET /api/error_code?device_type=...)."""

    id: int = Field(validation_alias="error_code_id")
    code: str
    label: str | None = Field(default=None, validation_alias="description")

    model_config = {"from_attributes": True, "populate_by_name": True}


class ErrorCodeReplyOut(ErrorCodeSuggestionOut):
    """Réponse enregistrée d'un code (GET /api/error_code/{id}/solution) : un paragraphe par ligne."""

    reply: str


# ---------- Administration (/api/admin/error_code) ----------

class ErrorCodeAdminIn(BaseModel):
    """Création ou modification d'un code d'erreur par un administrateur."""

    code: NonEmptyStr = Field(max_length=50)
    label: Optional[str] = Field(default=None, max_length=500)
    device_type: Optional[DeviceType] = None
    reply: Optional[str] = Field(default=None, max_length=5000)

    @field_validator("label", "reply", mode="before")
    @classmethod
    def _vide_devient_none(cls, value):
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def _reponse_avec_equipement(self):
        # Sans device_type, la réponse ne s'afficherait dans aucun menu.
        if self.reply and not self.device_type:
            raise ValueError("Choisissez l'équipement (GAB ou TPE) pour que la réponse apparaisse dans le Copilote.")
        return self


class ErrorCodeAdminOut(BaseModel):
    id: int = Field(validation_alias="error_code_id")
    code: str
    label: str | None = Field(default=None, validation_alias="description")
    device_type: str | None = None
    reply: str | None = None
    fault: FaultOut | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}
