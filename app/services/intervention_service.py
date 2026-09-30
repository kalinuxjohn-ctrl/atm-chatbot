"""
Logique métier de l'enregistrement des symptômes, séparée des routes FastAPI
(app/api/routes/) pour rester testable indépendamment du framework web.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.device import Device
from app.models.intervention import Intervention, InterventionSymptom, InterventionAction
from app.schemas.intervention_schema import ActionInput, InterventionCreate
from app.services.embeddings_service import generate_embedding
from app.services.retrieval_service import find_best_catalog_match, store_symptom_embedding
from app.services.stats_service import recompute_stats


def create_intervention_with_symptoms(db: Session, payload: InterventionCreate) -> Intervention:
    """
    Crée une intervention et enregistre tous ses symptômes initiaux en une
    seule transaction : soit l'intervention ET tous ses symptômes sont
    enregistrés, soit rien ne l'est (pas de symptôme orphelin en cas
    d'erreur en cours de route).

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
    """
    device = db.get(Device, payload.device_id)
    device_type = device.device_type if device is not None else None

    nouvelle_intervention = Intervention(
        device_id=payload.device_id,
        technician_id=payload.technician_id,
        ticket_reference=payload.ticket_reference,
        opened_at=payload.opened_at or datetime.now(timezone.utc),
    )

    a_ecrire: list[tuple[InterventionSymptom, list[float]]] = []
    nouveaux_symptomes = []

    for symptome in payload.symptoms:
        passage_vector = generate_embedding(symptome.raw_text, is_query=False)

        symptom_id_trouve = None
        if device_type is not None:
            match = find_best_catalog_match(db, symptome.raw_text, device_type)
            if match is not None and match["distance"] <= settings.symptom_catalog_match_max_distance:
                symptom_id_trouve = match["symptom_id"]

        symptome_orm = InterventionSymptom(
            raw_text=symptome.raw_text,
            severity=symptome.severity,
            symptom_id=symptom_id_trouve,
        )
        nouveaux_symptomes.append(symptome_orm)
        a_ecrire.append((symptome_orm, passage_vector))

    nouvelle_intervention.symptoms = nouveaux_symptomes

    db.add(nouvelle_intervention)
    db.commit()
    db.refresh(nouvelle_intervention)

    for symptome_orm, vector in a_ecrire:
        store_symptom_embedding(db, symptome_orm.intervention_symptom_id, vector)
    db.commit()
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
    """
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        return None

    prochain_ordre = len(intervention.actions) + 1

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
        recompute_stats(db)

    return nouvelle_action