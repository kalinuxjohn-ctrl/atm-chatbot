"""
Modèle ORM de intervention_add (migration 0012) : une demande d'ajout
d'intervention envoyée par un technicien, en attente de validation admin.
"""

from sqlalchemy import Column, Enum, ForeignKey, Integer, Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base

INTERVENTION_ADD_STATUSES = ("pending", "approved", "rejected")


class InterventionAdd(Base):
    __tablename__ = "intervention_add"

    intervention_add_id = Column(Integer, primary_key=True)
    technician_id = Column(Integer, ForeignKey("technician.technician_id"), nullable=False)
    conversation_id = Column(Integer, ForeignKey("conversation.conversation_id"))

    # Forme des deux JSON : ReviewedInterventionContent (app/schemas/intervention_add_schema.py).
    submitted_content = Column(JSONB, nullable=False)  # envoi du technicien, jamais modifié
    content = Column(JSONB, nullable=False)  # version corrigée par l'admin, écrite à l'approbation

    status = Column(
        Enum(*INTERVENTION_ADD_STATUSES, name="intervention_add_status", create_type=False),
        nullable=False,
        default="pending",
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    last_edited_at = Column(TIMESTAMP(timezone=True))
    last_edited_by = Column(Text)
    reviewed_at = Column(TIMESTAMP(timezone=True))
    reviewed_by = Column(Text)
    admin_comment = Column(Text)
    created_intervention_id = Column(Integer, ForeignKey("intervention.intervention_id"))
