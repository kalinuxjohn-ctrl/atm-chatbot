"""
Persistance des conversations et de leur historique de messages -- du CRUD
pur, aucune logique d'interprétation. Cette logique-là vit dans
context_service.py et chat_orchestrator_service.py, pour que ce fichier
reste stable même si elle change.
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import ReferenceNotFoundError
from app.models.conversation import Conversation, ConversationMessage
from app.models.technician import Technician


def get_or_create_conversation(db: Session, conversation_id: int | None, technician_id: int) -> Conversation:
    """
    Récupère la conversation existante, ou en crée une si conversation_id
    est absent/invalide. Lève ReferenceNotFoundError (-> 404) si le
    technicien n'existe pas, plutôt qu'une erreur de clé étrangère (500).
    """
    if conversation_id is not None:
        conversation = db.get(Conversation, conversation_id)
        # Une conversation n'est reprise que par SON technicien : un autre
        # technicien qui enverrait ce conversation_id n'y a pas accès.
        if conversation is not None and conversation.technician_id == technician_id:
            return conversation
        # ID fourni mais introuvable (ou appartenant à un autre technicien) :
        # on ne bloque pas le technicien, on repart simplement sur une
        # nouvelle conversation.

    if db.get(Technician, technician_id) is None:
        raise ReferenceNotFoundError(f"Technicien {technician_id} introuvable.")

    conversation = Conversation(technician_id=technician_id)
    db.add(conversation)
    db.flush()  # attribue conversation_id sans attendre le commit de la requête
    return conversation


def mark_conversation_active(conversation: Conversation) -> None:
    """
    Date la dernière activité de la conversation (updated_at). La colonne
    n'a pas de mise à jour automatique en base : sans cet appel, elle
    resterait figée à la date de création.
    """
    conversation.updated_at = func.now()


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
        # message_id en second critère : les messages d'une même requête
        # partagent le même created_at (now() = début de transaction).
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.message_id.desc())
        .limit(limit)
        .all()[::-1]
    )