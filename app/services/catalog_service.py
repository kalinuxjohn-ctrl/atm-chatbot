"""
Logique métier du catalogue d'actions : proposer des candidats similaires
avant qu'un technicien n'ajoute une nouvelle action, puis appliquer sa
décision (nouvelle entrée, ou fusion avec une entrée existante).
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import ReferenceNotFoundError
from app.models.catalog import Action, Component
from app.models.intervention import InterventionAction
from app.schemas.catalog_schema import ResolveActionRequest
from app.services.embeddings_service import generate_embedding, generate_embeddings_batch
from app.services.retrieval_service import MAX_SYMPTOM_LIMIT, cosine_similarity
from app.services.stats_service import recompute_stats_safely


def find_similar_actions(db: Session, raw_text: str, limit: int = 5) -> list[dict]:
    """
    Compare un texte au catalogue d'actions existant, pour aider un
    technicien à juger si sa solution est vraiment nouvelle.

    Le catalogue reste petit (vocabulaire contrôlé) : on calcule les
    embeddings à la volée à chaque appel plutôt que de les stocker en base
    -- pas besoin d'une colonne/migration dédiée pour ça. Tout le catalogue
    est vectorisé en UN seul appel groupé (et non un appel par action).
    """
    limit = max(1, min(limit, MAX_SYMPTOM_LIMIT))
    if not (raw_text or "").strip():
        return []

    catalogue = db.execute(text("SELECT action_id, canonical_text FROM action")).mappings().all()
    if not catalogue:
        return []

    texte_recherche = generate_embedding(raw_text, is_query=True)
    vecteurs_catalogue = generate_embeddings_batch([entree["canonical_text"] for entree in catalogue], is_query=False)

    candidats = []
    for entree, vecteur_entree in zip(catalogue, vecteurs_catalogue):
        distance = 1.0 - cosine_similarity(texte_recherche, vecteur_entree)
        candidats.append({"action_id": entree["action_id"], "canonical_text": entree["canonical_text"], "distance": distance})

    candidats.sort(key=lambda candidat: candidat["distance"])
    return candidats[:limit]


def create_action_in_catalog(db: Session, canonical_text: str, component_id: int | None = None) -> Action:
    """
    Ajoute une nouvelle entrée au catalogue d'actions. N'effectue qu'un
    flush (pas de commit) : c'est l'appelant qui valide la transaction, pour
    qu'une erreur ultérieure ne laisse pas une action orpheline au catalogue.
    """
    if component_id is not None and db.get(Component, component_id) is None:
        raise ReferenceNotFoundError(f"Composant {component_id} introuvable.")
    nouvelle_action = Action(canonical_text=canonical_text, component_id=component_id)
    db.add(nouvelle_action)
    db.flush()
    return nouvelle_action


def resolve_action_catalog_link(db: Session, payload: ResolveActionRequest) -> InterventionAction | None:
    """
    Applique la décision du technicien sur une action pas encore cataloguée :
    "new" crée une entrée catalogue, "merge" rattache à une entrée existante.
    C'est cette étape (pas l'enregistrement initial) qui rend l'action
    exploitable pour le classement par accuracy -- d'où le recalcul ici.
    """
    action_intervention = db.get(InterventionAction, payload.intervention_action_id)
    if action_intervention is None:
        return None

    try:
        if payload.decision == "new":
            action_cataloguee = create_action_in_catalog(db, payload.canonical_text, payload.component_id)
            action_intervention.action_id = action_cataloguee.action_id
        else:
            if db.get(Action, payload.existing_action_id) is None:
                raise ReferenceNotFoundError(f"Action {payload.existing_action_id} introuvable dans le catalogue.")
            action_intervention.action_id = payload.existing_action_id
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(action_intervention)
    recompute_stats_safely(db)
    db.refresh(action_intervention)

    return action_intervention
