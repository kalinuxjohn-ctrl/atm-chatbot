"""Contrats de données pour la recherche classique de codes d'erreur (GET /api/error_code/search)."""

from pydantic import BaseModel, Field


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