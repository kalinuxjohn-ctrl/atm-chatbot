"""
Pannes fréquentes du menu « Pannes fréquentes » du Copilote : lecture SQL
simple de la table usual_problem -- ni LLM, ni embedding.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import ReferenceNotFoundError
from app.core.tracing import trace
from app.models.usual_problem import UsualProblem
from app.schemas.usual_problem_schema import UsualProblemAdminIn


def list_usual_problems(db: Session, device_type: str) -> list[UsualProblem]:
    """Pannes fréquentes de cet équipement, dans l'ordre d'affichage choisi par les administrateurs."""
    return (
        db.query(UsualProblem)
        .filter(UsualProblem.device_type == device_type)
        .order_by(UsualProblem.display_order, UsualProblem.usual_problem_id)
        .all()
    )


def get_usual_problem(db: Session, usual_problem_id: int) -> UsualProblem:
    usual_problem = db.get(UsualProblem, usual_problem_id)
    if usual_problem is None:
        raise ReferenceNotFoundError(f"Panne fréquente {usual_problem_id} introuvable.")
    return usual_problem


# ---------- Administration (/api/admin/usual_problem) ----------

def list_all_usual_problems(db: Session) -> list[UsualProblem]:
    return (
        db.query(UsualProblem)
        .order_by(UsualProblem.device_type, UsualProblem.display_order, UsualProblem.usual_problem_id)
        .all()
    )


def create_usual_problem(db: Session, payload: UsualProblemAdminIn) -> UsualProblem:
    usual_problem = UsualProblem()
    _apply(db, usual_problem, payload)
    db.add(usual_problem)
    db.commit()
    db.refresh(usual_problem)
    trace("ADMIN", "Panne fréquente créée", usual_problem_id=usual_problem.usual_problem_id)
    return usual_problem


def update_usual_problem(db: Session, usual_problem_id: int, payload: UsualProblemAdminIn) -> UsualProblem:
    usual_problem = get_usual_problem(db, usual_problem_id)
    _apply(db, usual_problem, payload)
    db.commit()
    db.refresh(usual_problem)
    trace("ADMIN", "Panne fréquente modifiée", usual_problem_id=usual_problem_id)
    return usual_problem


def delete_usual_problem(db: Session, usual_problem_id: int) -> None:
    db.delete(get_usual_problem(db, usual_problem_id))
    db.commit()
    trace("ADMIN", "Panne fréquente supprimée", usual_problem_id=usual_problem_id)


def _apply(db: Session, usual_problem: UsualProblem, payload: UsualProblemAdminIn) -> None:
    moved_to_other_device = usual_problem.device_type != payload.device_type
    usual_problem.device_type = payload.device_type
    usual_problem.label = payload.label
    usual_problem.reply = payload.reply
    if payload.display_order is not None:
        usual_problem.display_order = payload.display_order
    elif usual_problem.usual_problem_id is None or moved_to_other_device:
        # Pas d'ordre précisé : en fin du menu de cet équipement.
        last = db.query(func.max(UsualProblem.display_order)).filter(UsualProblem.device_type == payload.device_type).scalar()
        usual_problem.display_order = (last or 0) + 1
