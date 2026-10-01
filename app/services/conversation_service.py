"""
Persistance des conversations et de leur historique de messages -- du CRUD
pur, aucune logique d'interprétation. Cette logique-là vit dans
context_service.py et chat_orchestrator_service.py, pour que ce fichier
reste stable même si elle change.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationMessage


def get_or_create_conversation(db: Session, conversation_id: int | None, technician_id: int) -> Conversation:
    """Récupère la conversation existante, ou en crée une si conversation_id est absent/invalide."""
    if conversation_id is not None:
        conversation = db.get(Conversation, conversation_id)
        if conversation is not None:
            return conversation
        # ID fourni mais introuvable : on ne bloque pas le technicien, on
        # repart simplement sur une nouvelle conversation.

    conversation = Conversation(technician_id=technician_id)
    db.add(conversation)
    db.flush()  # attribue conversation_id sans attendre le commit de la requête
    return conversation


def save_message(db: Session, conversation_id: int, role: str, content: str) -> ConversationMessage:
    message = ConversationMessage(conversation_id=conversation_id, role=role, content=content)
    db.add(message)
    db.flush()
    return message


def get_recent_messages(db: Session, conversation_id: int, limit: int = 10) -> list[ConversationMessage]:
    """
    Les `limit` derniers messages, en ordre chronologique. Volontairement
    PAS l'historique complet (spec §3/§11) -- utile seulement si on veut un
    jour ajouter un peu de fil conversationnel brut en plus du contexte
    structuré, pas utilisé par le workflow actuel.
    """
    return (
        db.query(ConversationMessage)
        .filter(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.desc())
        .limit(limit)
        .all()[::-1]
    )