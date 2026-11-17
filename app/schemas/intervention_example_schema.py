"""Contrat des interventions de référence chargeables depuis des fichiers JSON."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.device_type import DeviceType, NonEmptyStr


class InterventionExampleSymptom(BaseModel):
    text: NonEmptyStr = Field(max_length=1000)
    severity: str | None = Field(default=None, max_length=50)

    model_config = {"extra": "forbid"}


class InterventionExampleAction(BaseModel):
    text: NonEmptyStr = Field(max_length=2000)
    result: NonEmptyStr = Field(max_length=2000)
    outcome_status: str = Field(pattern=r"^(resolved|partial|no_effect|made_worse|unknown)$")
    confirmed_solution: bool = False

    model_config = {"extra": "forbid"}


class InterventionExampleDiagnosis(BaseModel):
    description: NonEmptyStr = Field(max_length=2000)
    root_cause_component: str | None = Field(default=None, max_length=300)
    confirmed: bool = False

    model_config = {"extra": "forbid"}


class InterventionExampleDocument(BaseModel):
    source_key: NonEmptyStr = Field(pattern=r"^intervention-reference-[a-z0-9-]+$", max_length=100)
    device_type: DeviceType
    opened_at: datetime
    summary: NonEmptyStr = Field(max_length=2000)
    final_outcome_status: str = Field(pattern=r"^(resolved|partially_resolved|unresolved|escalated)$")
    symptoms: list[InterventionExampleSymptom] = Field(min_length=1, max_length=5)
    actions: list[InterventionExampleAction] = Field(min_length=1, max_length=8)
    diagnosis: InterventionExampleDiagnosis

    model_config = {"extra": "forbid"}
