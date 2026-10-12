"""
Modèle ORM de solution_proposal (migration 0009) : une solution proposée par
un technicien, en attente de la décision d'un administrateur.
"""

from sqlalchemy import Column, Enum, ForeignKey, Integer, Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base

PROPOSAL_STATUSES = ("pending", "approved", "rejected")


class SolutionProposal(Base):
    __tablename__ = "solution_proposal"

    proposal_id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversation.conversation_id"), nullable=False)
    technician_id = Column(Integer, ForeignKey("technician.technician_id"), nullable=False)

    # Cas de référence retrouvé par la recherche (voir solution_proposal_service).
    intervention_id = Column(Integer, ForeignKey("intervention.intervention_id"))
    intervention_symptom_id = Column(Integer, ForeignKey("intervention_symptom.intervention_symptom_id"))
    symptom_id = Column(Integer, ForeignKey("symptom.symptom_id"))
    component_id = Column(Integer, ForeignKey("component.component_id"))
    device_id = Column(Integer, ForeignKey("device.device_id"))  # NULL tant que le chat n'a pas d'intervention en cours
    device_type = Column(Enum("gab", "tpe", name="device_type", create_type=False), nullable=False)
    model_id = Column(Integer, ForeignKey("device_model.model_id"))
    error_code_id = Column(Integer, ForeignKey("error_code.error_code_id"))

    problem_text = Column(Text, nullable=False)
    proposed_action = Column(Text, nullable=False)
    result_description = Column(Text, nullable=False)
    outcome_status = Column(
        Enum("resolved", "partial", "no_effect", "made_worse", "unknown", name="action_outcome", create_type=False),
        nullable=False,
        default="resolved",
    )
    conversation_context_snapshot = Column(JSONB, nullable=False)

    status = Column(
        Enum(*PROPOSAL_STATUSES, name="solution_proposal_status", create_type=False),
        nullable=False,
        default="pending",
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at = Column(TIMESTAMP(timezone=True))
    reviewed_by = Column(Text)
    admin_comment = Column(Text)
    approved_action_id = Column(Integer, ForeignKey("action.action_id"))
