"""
Logique métier du catalogue d'actions : proposer des candidats similaires
avant qu'un technicien n'ajoute une nouvelle action, puis appliquer sa
décision (nouvelle entrée, ou fusion avec une entrée existante).
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.catalog import Action
from app.models.intervention import InterventionAction
from app.schemas.catalog_schema import ResolveActionRequest
from app.services.embeddings_service import generate_embedding
from app.services.retrieval_service import cosine_similarity
from app.services.stats_service import recompute_stats


def find_similar_actions(db: Session, raw_text: str, limit: int = 5) -> list[dict]:
    """
    Compare un texte au catalogue d'actions existant, pour aider un
    technicien à juger si sa solution est vraiment nouvelle.

    Le catalogue reste petit (vocabulaire contrôlé) : on calcule les
    embeddings à la volée à chaque appel plutôt que de les stocker en base
    -- pas besoin d'une colonne/migration dédiée pour ça.
    """
    texte_recherche = generate_embedding(raw_text, is_query=True)
    catalogue = db.execute(text("SELECT action_id, canonical_text FROM action")).mappings().all()

    candidats = []
    for entree in catalogue:
        vecteur_entree = generate_embedding(entree["canonical_text"], is_query=False)
        distance = 1.0 - cosine_similarity(texte_recherche, vecteur_entree)
        candidats.append({"action_id": entree["action_id"], "canonical_text": entree["canonical_text"], "distance": distance})

    candidats.sort(key=lambda candidat: candidat["distance"])
    return candidats[:limit]


def create_action_in_catalog(db: Session, canonical_text: str, component_id: int | None = None) -> Action:
    """Ajoute une nouvelle entrée au catalogue d'actions."""
    nouvelle_action = Action(canonical_text=canonical_text, component_id=component_id)
    db.add(nouvelle_action)
    db.commit()
    db.refresh(nouvelle_action)
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

    if payload.decision == "new":
        action_cataloguee = create_action_in_catalog(db, payload.canonical_text, payload.component_id)
        action_intervention.action_id = action_cataloguee.action_id
    else:
        action_intervention.action_id = payload.existing_action_id

    db.commit()
    db.refresh(action_intervention)
    recompute_stats(db)

    return action_intervention