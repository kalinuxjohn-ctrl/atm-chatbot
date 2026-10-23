"""
Contexte actif d'une conversation : chargement, sauvegarde, dernière
recherche et résultat sélectionné.

Le LLM dit de quel résultat parle le technicien (« le cas 2 » -> 2, voir
message_understanding_service) ; ce fichier vérifie en code normal que ce
numéro existe dans la dernière recherche avant de le retenir -- jamais un ID
demandé au LLM.
"""

from __future__ import annotations

import copy

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.conversation import ConversationContext


def get_context(db: Session, conversation_id: int) -> dict:
    """Charge le contexte actif, ou {} si la conversation n'en a pas encore."""
    row = db.get(ConversationContext, conversation_id)
    if row is None or not isinstance(row.context, dict):
        return {}
    # Copie PROFONDE : le contexte est modifié en place par l'orchestrateur
    # (last_search, selected_result...) -- une copie superficielle
    # partagerait ces objets imbriqués avec l'état chargé par SQLAlchemy.
    return copy.deepcopy(row.context)


def save_context(db: Session, conversation_id: int, context: dict) -> None:
    """Upsert -- une ligne par conversation (voir migration 0006)."""
    row = db.get(ConversationContext, conversation_id)
    if row is None:
        db.add(ConversationContext(conversation_id=conversation_id, context=context))
    else:
        row.context = context
        # JSONB non "mutable" côté ORM : on signale explicitement la
        # modification pour garantir l'UPDATE (et la mise à jour d'updated_at).
        flag_modified(row, "context")
    db.flush()


def select_result_by_position(context: dict, position: int) -> dict | None:
    """
    Résout une position vers le résultat correspondant de la dernière
    recherche, et met à jour `selected_result` dans le contexte fourni
    (mutation + retour). None si pas de recherche récente, ou si la
    position n'existe pas parmi les résultats.
    """
    last_search = context.get("last_search")
    if not last_search:
        return None

    for resultat in last_search.get("results", []):
        if resultat.get("position") == position:
            context["selected_result"] = resultat
            return resultat

    return None


def record_last_search(context: dict, query: str, results: list[dict], symptoms: list[dict] | None = None) -> None:
    """
    Enregistre une nouvelle recherche (mutation en place). `results` doit
    déjà être une liste de {"position": int, "kind": "case" | "stat", ...}.
    `symptoms` : symptômes numérotés du technicien, cherchés séparément.
    Une nouvelle recherche invalide forcément l'ancienne sélection.
    """
    context["last_search"] = {"query": query, "results": results}
    if symptoms:
        context["last_search"]["symptoms"] = symptoms
    context.pop("selected_result", None)