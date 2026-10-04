"""
Logique métier de l'enregistrement des symptômes, séparée des routes FastAPI
(app/api/routes/) pour rester testable indépendamment du framework web.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import InvalidReferenceError, ReferenceNotFoundError
from app.models.catalog import Action
from app.models.device import Device
from app.models.intervention import Intervention, InterventionSymptom, InterventionAction
from app.models.technician import Technician
from app.schemas.intervention_schema import ActionInput, InterventionCreate
from app.services.embeddings_service import generate_embeddings_batch
from app.services.retrieval_service import find_best_catalog_match, store_symptom_embedding
from app.services.stats_service import recompute_stats_safely


def create_intervention_with_symptoms(db: Session, payload: InterventionCreate) -> Intervention:
    """
    Crée une intervention et enregistre tous ses symptômes initiaux en une
    seule transaction : soit l'intervention ET tous ses symptômes (avec
    leurs embeddings) sont enregistrés, soit rien ne l'est (pas de symptôme
    orphelin ni de symptôme sans vecteur en cas d'erreur en cours de route).

    En plus de l'enregistrement brut, chaque symptôme est :
    - vectorisé (embedding "passage", sans préfixe -- voir
      embeddings_service.py) et stocké, pour que les futures recherches
      puissent le retrouver ;
    - comparé aux symptômes DÉJÀ rattachés au catalogue (même device_type) :
      s'il y a un match assez proche (voir
      settings.symptom_catalog_match_max_distance), on rattache directement
      ce nouveau symptôme au même symptom_id -- sinon symptom_id reste NULL,
      comme avant (un symptôme non catalogué n'aide pas encore le
      classement par accuracy tant que personne ne l'a explicitement
      rattaché).

    Lève ReferenceNotFoundError (-> HTTP 404) si l'appareil ou le
    technicien n'existe pas, au lieu d'une erreur d'intégrité SQL (500).
    """
    device = db.get(Device, payload.device_id)
    if device is None:
        raise ReferenceNotFoundError(f"Appareil {payload.device_id} introuvable.")
    if db.get(Technician, payload.technician_id) is None:
        raise ReferenceNotFoundError(f"Technicien {payload.technician_id} introuvable.")

    # Deux appels groupés au fournisseur d'embedding, quel que soit le nombre
    # de symptômes (au lieu d'un appel par symptôme) -- important avec un
    # quota de quelques requêtes par minute. Deux versions du même texte
    # car Voyage vectorise différemment selon l'usage :
    # - "document" (is_query=False) : le vecteur STOCKÉ, que les futures recherches retrouveront ;
    # - "query" (is_query=True) : le vecteur qui sert à CHERCHER un symptôme déjà catalogué.
    textes_symptomes = [symptome.raw_text for symptome in payload.symptoms]
    vecteurs_a_stocker = generate_embeddings_batch(textes_symptomes, is_query=False)
    vecteurs_de_recherche = generate_embeddings_batch(textes_symptomes, is_query=True)

    nouvelle_intervention = Intervention(
        device_id=payload.device_id,
        technician_id=payload.technician_id,
        ticket_reference=payload.ticket_reference,
        opened_at=payload.opened_at or datetime.now(timezone.utc),
    )

    a_ecrire: list[tuple[InterventionSymptom, list[float]]] = []
    nouveaux_symptomes = []

    for symptome, vecteur_a_stocker, vecteur_de_recherche in zip(
        payload.symptoms, vecteurs_a_stocker, vecteurs_de_recherche
    ):
        symptom_id_trouve = None
        match = find_best_catalog_match(
            db, symptome.raw_text, device.device_type, query_vector=vecteur_de_recherche
        )
        if match is not None and match["distance"] <= settings.symptom_catalog_match_max_distance:
            symptom_id_trouve = match["symptom_id"]

        symptome_orm = InterventionSymptom(
            raw_text=symptome.raw_text,
            severity=symptome.severity,
            symptom_id=symptom_id_trouve,
        )
        nouveaux_symptomes.append(symptome_orm)
        a_ecrire.append((symptome_orm, vecteur_a_stocker))

    nouvelle_intervention.symptoms = nouveaux_symptomes

    try:
        db.add(nouvelle_intervention)
        db.flush()  # attribue les intervention_symptom_id sans encore valider la transaction

        for symptome_orm, vector in a_ecrire:
            store_symptom_embedding(db, symptome_orm.intervention_symptom_id, vector)
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(nouvelle_intervention)
    return nouvelle_intervention


def get_intervention_by_id(db: Session, intervention_id: int) -> Intervention | None:
    """Récupère une intervention et ses symptômes/actions par son ID, ou None si absente."""
    return db.get(Intervention, intervention_id)


def add_action_to_intervention(
    db: Session, intervention_id: int, payload: ActionInput
) -> InterventionAction | None:
    """
    Enregistre une action tentée (et son résultat) sur une intervention déjà
    existante. Retourne None si l'intervention n'existe pas.

    Lève ReferenceNotFoundError (-> 404) si action_id n'existe pas dans le
    catalogue, et InvalidReferenceError (-> 422) si targets_symptom_id ne
    désigne pas un symptôme de CETTE intervention -- sans ce contrôle,
    l'action serait comptée pour un symptôme d'une autre intervention dans
    les statistiques.
    """
    # FOR UPDATE : verrouille la ligne de l'intervention jusqu'au commit.
    # Deux actions envoyées en même temps sur la même intervention liraient
    # sinon le même sequence_order max et recevraient le même numéro ; avec
    # le verrou, la seconde requête attend la fin de la première puis lit
    # le bon max.
    intervention = (
        db.query(Intervention)
        .filter(Intervention.intervention_id == intervention_id)
        .with_for_update()
        .one_or_none()
    )
    if intervention is None:
        return None

    if payload.action_id is not None and db.get(Action, payload.action_id) is None:
        raise ReferenceNotFoundError(f"Action {payload.action_id} introuvable dans le catalogue.")

    if payload.targets_symptom_id is not None:
        ids_symptomes = {s.intervention_symptom_id for s in intervention.symptoms}
        if payload.targets_symptom_id not in ids_symptomes:
            raise InvalidReferenceError(
                f"Le symptôme {payload.targets_symptom_id} n'appartient pas à l'intervention {intervention_id}."
            )

    # max()+1 plutôt que len()+1 : reste correct même si une action a été
    # supprimée entre-temps (pas de doublon de sequence_order).
    prochain_ordre = max((a.sequence_order for a in intervention.actions), default=0) + 1

    nouvelle_action = InterventionAction(
        intervention_id=intervention_id,
        action_id=payload.action_id,
        targets_symptom_id=payload.targets_symptom_id,
        raw_text=payload.raw_text,
        sequence_order=prochain_ordre,
        performed_at=payload.performed_at or datetime.now(timezone.utc),
        result_description=payload.result_description,
        outcome_status=payload.outcome_status,
        is_confirmed_solution=payload.is_confirmed_solution,
    )

    db.add(nouvelle_action)
    db.commit()
    db.refresh(nouvelle_action)

    if nouvelle_action.action_id is not None:
        recompute_stats_safely(db)
        db.refresh(nouvelle_action)

    return nouvelle_action
