"""Contrats de données des routes /api/usual_problem (menu « Pannes fréquentes »)."""

from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.device_type import DeviceType, NonEmptyStr


class UsualProblemOut(BaseModel):
    id: int = Field(validation_alias="usual_problem_id")
    label: str

    model_config = {"from_attributes": True, "populate_by_name": True}


class UsualProblemReplyOut(UsualProblemOut):
    """Réponse enregistrée : un paragraphe par ligne."""

    reply: str


# ---------- Administration (/api/admin/usual_problem) ----------

class UsualProblemAdminIn(BaseModel):
    """Création ou modification d'une panne fréquente par un administrateur."""

    device_type: DeviceType
    label: NonEmptyStr = Field(max_length=300)
    reply: NonEmptyStr = Field(max_length=5000)
    # Absent à la création : la panne est ajoutée en fin de menu.
    display_order: Optional[int] = Field(default=None, ge=0)


class UsualProblemAdminOut(UsualProblemReplyOut):
    device_type: str
    display_order: int
