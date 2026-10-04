"""
Contexte actif d'une conversation : chargement, sauvegarde, et résolution
DÉTERMINISTE des références relatives ("le deuxième", "cette solution"...).

Principe clé (spec §10) : ce fichier décide que "deuxième" = position 2 =
tel intervention_symptom_id, en code normal -- jamais en demandant un ID
au LLM. Pas besoin du LLM ici du tout : une table de correspondance
d'ordinaux suffit et reste 100% prévisible.
"""

from __future__ import annotations

import copy
import re

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.conversation import ConversationContext

# Table volontairement simple plutôt qu'un parseur NLP : suffisant pour
# "le premier/deuxième/troisième", extensible en ajoutant une ligne si un
# nouveau tour de phrase apparaît en usage réel. Formes féminines
# ("la première solution") et "second(e)" incluses.
_ORDINAL_PATTERNS: dict[str, int] = {
    r"\bpremi(?:er|[eè]re)\b": 1,
    r"\b1(?:er|[eè]re)\b": 1,
    r"\bdeuxi[eè]me\b": 2,
    r"\b2(?:[eè]me|nde?)\b": 2,
    r"\bseconde?\b": 2,
    r"\btroisi[eè]me\b": 3,
    r"\b3[eè]me\b": 3,
    r"\bquatri[eè]me\b": 4,
    r"\b4[eè]me\b": 4,
}


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


def resolve_position_reference(message: str) -> int | None:
    """
    Extrait une position ("le deuxième" -> 2) si le message en contient
    une, sinon None. Ne regarde que le texte -- ne sait rien du contexte,
    donc ne peut jamais halluciner une position sans recherche existante
    (c'est à l'appelant de vérifier last_search avant d'utiliser le résultat).
    """
    texte = message.lower()
    for motif, position in _ORDINAL_PATTERNS.items():
        if re.search(motif, texte):
            return position
    return None


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


def record_last_search(context: dict, query: str, results: list[dict]) -> None:
    """
    Enregistre une nouvelle recherche (mutation en place). `results` doit
    déjà être une liste de {"position": int, "kind": "case" | "stat", ...}.
    Une nouvelle recherche invalide forcément l'ancienne sélection.
    """
    context["last_search"] = {"query": query, "results": results}
    context.pop("selected_result", None)