"""
Logique métier de l'enregistrement des symptômes, séparée des routes FastAPI
(app/api/routes/) pour rester testable indépendamment du framework web.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.intervention import Intervention, InterventionSymptom, InterventionAction
from app.schemas.intervention_schema import ActionInput, InterventionCreate


def create_intervention_with_symptoms(db: Session, payload: InterventionCreate) -> Intervention:
    """
    Crée une intervention et enregistre tous ses symptômes initiaux en une
    seule transaction : soit l'intervention ET tous ses symptômes sont
    enregistrés, soit rien ne l'est (pas de symptôme orphelin en cas
    d'erreur en cours de route).
    """
    nouvelle_intervention = Intervention(
        device_id=payload.device_id,
        technician_id=payload.technician_id,
        ticket_reference=payload.ticket_reference,
        # opened_at absent du payload -> on prend l'heure actuelle (UTC),
        # c'est le cas le plus courant (le technicien enregistre en direct).
        opened_at=payload.opened_at or datetime.now(timezone.utc),
    )

    # SQLAlchemy attribue automatiquement l'intervention_id une fois l'objet
    # ajouté à la session, ce qui permet de le référencer immédiatement dans
    # les symptômes ci-dessous sans requête supplémentaire.
    nouvelle_intervention.symptoms = [
        InterventionSymptom(raw_text=symptome.raw_text, severity=symptome.severity)
        for symptome in payload.symptoms
    ]

    db.add(nouvelle_intervention)
    db.commit()
    db.refresh(nouvelle_intervention)  # recharge les valeurs générées par la DB (IDs, etc.)

    return nouvelle_intervention


def get_intervention_by_id(db: Session, intervention_id: int) -> Intervention | None:
    """Récupère une intervention et ses symptômes/actions par son ID, ou None si absente."""
    return db.get(Intervention, intervention_id)


def add_action_to_intervention(
    db: Session, intervention_id: int, payload: ActionInput
) -> InterventionAction | None:
    """
    Enregistre une action tentée (et son résultat) sur une intervention déjà
    existante. Retourne None si l'intervention n'existe pas -- c'est à la
    route de traduire ça en 404, cette fonction ne connaît pas HTTP.
    """
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        return None

    # sequence_order = position de cette tentative dans l'ordre où elles ont
    # été essayées (1ère, 2ème...) -- calculé automatiquement à partir du
    # nombre d'actions déjà enregistrées, le technicien n'a pas à y penser.
    prochain_ordre = len(intervention.actions) + 1

    nouvelle_action = InterventionAction(
        intervention_id=intervention_id,
        action_id=payload.action_id,
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

    return nouvelle_action