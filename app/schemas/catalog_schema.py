"""Contrats de données pour consulter/enrichir le catalogue d'actions."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.device_type import NonEmptyStr


class SimilarActionCandidate(BaseModel):
    """Une action déjà cataloguée, proposée comme doublon potentiel."""

    action_id: int
    canonical_text: str
    distance: float  # 0 = identique, 2 = opposé (convention pgvector <=>)

    model_config = {"from_attributes": True}


class ActionCatalogAdminCreate(BaseModel):
    canonical_text: NonEmptyStr = Field(..., max_length=500)
    device_type: Optional[Literal["gab", "tpe"]] = None


class ActionCatalogDocument(BaseModel):
    catalog_number: int = Field(..., ge=1)
    canonical_text: NonEmptyStr = Field(..., max_length=500)
    device_type: Optional[Literal["gab", "tpe"]] = None


class ActionCatalogAdminOut(BaseModel):
    action_id: int
    canonical_text: str
    device_type: Optional[Literal["gab", "tpe"]] = None

    model_config = {"from_attributes": True}


class DeviceModelVersionAdminOut(BaseModel):
    version_id: int
    version_label: str
    hardware_rev: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class DeviceModelAdminCreate(BaseModel):
    device_type: Literal["gab", "tpe"]
    manufacturer_name: NonEmptyStr = Field(..., max_length=200)
    model_name: NonEmptyStr = Field(..., max_length=200)
    release_year: Optional[int] = Field(None, ge=1900, le=2200)
    version_label: Optional[NonEmptyStr] = Field(None, max_length=100)
    hardware_rev: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def version_details_need_a_label(self):
        if not self.version_label and (self.hardware_rev or self.notes):
            raise ValueError("Renseignez une version pour enregistrer sa révision ou ses notes.")
        return self


class DeviceModelAdminOut(BaseModel):
    model_id: int
    device_type: Optional[Literal["gab", "tpe"]] = None
    manufacturer_name: Optional[str] = None
    model_name: Optional[str] = None
    release_year: Optional[int] = None
    versions: list[DeviceModelVersionAdminOut] = Field(default_factory=list)


class ResolveActionRequest(BaseModel):
    """Décision du technicien après avoir vu les candidats similaires."""

    intervention_action_id: int
    decision: Literal["new", "merge"]
    canonical_text: Optional[NonEmptyStr] = None  # requis si decision="new"
    component_id: Optional[int] = None  # facultatif, seulement utile si decision="new"
    existing_action_id: Optional[int] = None  # requis si decision="merge"

    @model_validator(mode="after")
    def _verifier_champs_requis(self):
        if self.decision == "new" and not self.canonical_text:
            raise ValueError("canonical_text est requis quand decision='new'.")
        if self.decision == "merge" and self.existing_action_id is None:
            raise ValueError("existing_action_id est requis quand decision='merge'.")
        return self


class ResolveActionResponse(BaseModel):
    intervention_action_id: int
    action_id: int  # l'action_id final rattaché, nouveau ou existant

    model_config = {"from_attributes": True}