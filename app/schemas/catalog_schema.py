"""Contrats de données pour consulter/enrichir le catalogue d'actions."""

from typing import Literal, Optional

from pydantic import BaseModel, model_validator


class SimilarActionCandidate(BaseModel):
    """Une action déjà cataloguée, proposée comme doublon potentiel."""

    action_id: int
    canonical_text: str
    distance: float  # 0 = identique, 2 = opposé (convention pgvector <=>)

    model_config = {"from_attributes": True}


class ResolveActionRequest(BaseModel):
    """Décision du technicien après avoir vu les candidats similaires."""

    intervention_action_id: int
    decision: Literal["new", "merge"]
    canonical_text: Optional[str] = None  # requis si decision="new"
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