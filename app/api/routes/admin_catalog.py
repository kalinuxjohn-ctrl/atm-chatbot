"""
Routes d'administration des réponses enregistrées du Copilote, protégées par
la même clé que les propositions (ADMIN_API_KEY, en-tête X-Admin-Key) :

    GET    /api/admin/error_code            tous les codes (avec ou sans réponse)
    POST   /api/admin/error_code            ajout
    PUT    /api/admin/error_code/{id}       modification
    DELETE /api/admin/error_code/{id}       suppression

    GET    /api/admin/usual_problem         toutes les pannes fréquentes (GAB et TPE)
    POST   /api/admin/usual_problem         ajout
    PUT    /api/admin/usual_problem/{id}    modification
    DELETE /api/admin/usual_problem/{id}    suppression

Aucune logique métier ici : tout est délégué à error_code_service.py et
usual_problem_service.py.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.routes.admin import require_admin
from app.core.database import get_db
from app.schemas.error_code_schema import ErrorCodeAdminIn, ErrorCodeAdminOut
from app.schemas.usual_problem_schema import UsualProblemAdminIn, UsualProblemAdminOut
from app.services import error_code_service, usual_problem_service

error_code_router = APIRouter(
    prefix="/api/admin/error_code",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

usual_problem_router = APIRouter(
    prefix="/api/admin/usual_problem",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


# ---------- Codes d'erreur ----------

@error_code_router.get("", response_model=list[ErrorCodeAdminOut])
def lister_codes_erreur(db: Session = Depends(get_db)) -> list[ErrorCodeAdminOut]:
    return error_code_service.list_all_error_codes(db)


@error_code_router.post("", response_model=ErrorCodeAdminOut, status_code=201)
def ajouter_code_erreur(payload: ErrorCodeAdminIn, db: Session = Depends(get_db)) -> ErrorCodeAdminOut:
    return error_code_service.create_error_code(db, payload)


@error_code_router.put("/{error_code_id}", response_model=ErrorCodeAdminOut)
def modifier_code_erreur(error_code_id: int, payload: ErrorCodeAdminIn, db: Session = Depends(get_db)) -> ErrorCodeAdminOut:
    return error_code_service.update_error_code(db, error_code_id, payload)


@error_code_router.delete("/{error_code_id}")
def supprimer_code_erreur(error_code_id: int, db: Session = Depends(get_db)) -> dict:
    error_code_service.delete_error_code(db, error_code_id)
    # Corps JSON (pas de 204 vide) : le client HTTP du frontend lit toujours une réponse JSON.
    return {"deleted": error_code_id}


# ---------- Pannes fréquentes ----------

@usual_problem_router.get("", response_model=list[UsualProblemAdminOut])
def lister_pannes_frequentes(db: Session = Depends(get_db)) -> list[UsualProblemAdminOut]:
    return usual_problem_service.list_all_usual_problems(db)


@usual_problem_router.post("", response_model=UsualProblemAdminOut, status_code=201)
def ajouter_panne_frequente(payload: UsualProblemAdminIn, db: Session = Depends(get_db)) -> UsualProblemAdminOut:
    return usual_problem_service.create_usual_problem(db, payload)


@usual_problem_router.put("/{usual_problem_id}", response_model=UsualProblemAdminOut)
def modifier_panne_frequente(
    usual_problem_id: int, payload: UsualProblemAdminIn, db: Session = Depends(get_db)
) -> UsualProblemAdminOut:
    return usual_problem_service.update_usual_problem(db, usual_problem_id, payload)


@usual_problem_router.delete("/{usual_problem_id}")
def supprimer_panne_frequente(usual_problem_id: int, db: Session = Depends(get_db)) -> dict:
    usual_problem_service.delete_usual_problem(db, usual_problem_id)
    return {"deleted": usual_problem_id}
