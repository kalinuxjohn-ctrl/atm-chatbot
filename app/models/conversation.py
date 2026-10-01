"""
Modèles SQLAlchemy pour la mémoire conversationnelle : historique des
messages (persistant, jamais réécrit) et contexte actif (JSONB, réécrit à
chaque message -- voir app/services/context_service.py).
"""

from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Integer, Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base  # à ajuster si Base vit ailleurs


class Conversation(Base):
    __tablename__ = "conversation"

    conversation_id = Column(Integer, primary_key=True)
    technician_id = Column(Integer, ForeignKey("technician.technician_id"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    messages = relationship(
        "ConversationMessage", back_populates="conversation", cascade="all, delete-orphan"
    )
    context = relationship(
        "ConversationContext", back_populates="conversation", uselist=False, cascade="all, delete-orphan"
    )


class ConversationMessage(Base):
    __tablename__ = "conversation_message"

    message_id = Column(Integer, primary_key=True)
    conversation_id = Column(
        Integer, ForeignKey("conversation.conversation_id", ondelete="CASCADE"), nullable=False
    )
    role = Column(Text, nullable=False)  # "user" | "assistant" -- contraint en base (CHECK)
    content = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    conversation = relationship("Conversation", back_populates="messages")


class ConversationContext(Base):
    """
    Une ligne par conversation. `context` reste un JSONB libre -- voir
    context_service.py pour sa structure logique (intent, last_search,
    selected_result...). Pas de colonnes SQL typées pour ces champs afin
    de pouvoir faire évoluer leur forme sans migration (spec §5).
    """

    __tablename__ = "conversation_context"

    conversation_id = Column(
        Integer, ForeignKey("conversation.conversation_id", ondelete="CASCADE"), primary_key=True
    )
    context = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    conversation = relationship("Conversation", back_populates="context")