"""Contrat des problèmes usuels de référence non rattachés à une documentation constructeur."""

from pydantic import BaseModel, Field

from app.schemas.device_type import DeviceType, NonEmptyStr


class ExampleProblemDocument(BaseModel):
    source_key: NonEmptyStr = Field(pattern=r"^problem-reference-[a-z0-9-]+$", max_length=100)
    device_type: DeviceType
    label: NonEmptyStr = Field(max_length=300)
    reply: NonEmptyStr = Field(max_length=5000)
    display_order: int = Field(ge=0)

    model_config = {"extra": "forbid"}
