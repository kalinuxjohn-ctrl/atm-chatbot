"""
Recherche classique (SQL, sans IA) de codes d'erreur, et réponses
enregistrées du menu « Codes d'erreur connus » du Copilote.

Volontairement indépendant de retrieval_service.py / embeddings_service.py
-- voir la feuille de route, "Recherche de code d'erreur" ne passe jamais
par le pipeline vectoriel (pas d'embedding, pas de pgvector, pas de LLM).
"""

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.errors import ReferenceNotFoundError, StateConflictError
from app.core.tracing import trace
from app.models.fault import ErrorCode
from app.schemas.error_code_schema import ErrorCodeAdminIn


def search_error_codes(db: Session, query: str) -> list[ErrorCode]:
    """
    Recherche par code, exacte ou partielle, insensible à la casse.

    ILIKE '%...%' couvre les trois cas demandés en une seule requête : une
    recherche exacte ('E42') est juste un cas particulier d'une recherche
    partielle qui matche tout. joinedload évite une requête supplémentaire
    par résultat pour charger la panne liée (fault).
    """
    recherche = (query or "").strip()
    if not recherche:
        # "   " passerait le min_length de la route : sans ce garde-fou, le
        # motif "%%" renverrait TOUTE la table.
        return []

    # % et _ sont des jokers pour ILIKE : on les échappe pour qu'une saisie
    # comme "E_4" cherche littéralement "E_4" et non "E" + n'importe quel caractère + "4".
    echappe = recherche.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    motif = f"%{echappe}%"
    trace("SEARCH", "Recherche SQL de codes d'erreur démarrée", strategy="sql_ilike")
    return (
        db.query(ErrorCode)
        .options(joinedload(ErrorCode.fault))
        .filter(ErrorCode.code.ilike(motif, escape="\\"))
        .order_by(ErrorCode.code)
        .all()
    )


def list_error_codes_with_reply(db: Session, device_type: str) -> list[ErrorCode]:
    """Codes du menu « Codes d'erreur connus » : ceux qui ont une réponse enregistrée pour cet équipement."""
    return (
        db.query(ErrorCode)
        .filter(ErrorCode.device_type == device_type, ErrorCode.reply.isnot(None), ErrorCode.reply != "")
        .order_by(ErrorCode.code)
        .all()
    )


def get_error_code_reply(db: Session, error_code_id: int) -> ErrorCode:
    """Le code et sa réponse enregistrée. 404 s'il n'existe pas ou n'a pas de réponse."""
    error_code = db.get(ErrorCode, error_code_id)
    if error_code is None or not error_code.reply:
        raise ReferenceNotFoundError(f"Aucune réponse enregistrée pour le code d'erreur {error_code_id}.")
    return error_code


# ---------- Administration (/api/admin/error_code) ----------

def list_all_error_codes(db: Session) -> list[ErrorCode]:
    """Tous les codes, avec ou sans réponse enregistrée : l'administrateur doit pouvoir tous les compléter."""
    return db.query(ErrorCode).options(joinedload(ErrorCode.fault)).order_by(ErrorCode.code).all()


def create_error_code(db: Session, payload: ErrorCodeAdminIn) -> ErrorCode:
    _ensure_code_available(db, payload.code)
    error_code = ErrorCode()
    _apply(error_code, payload)
    db.add(error_code)
    db.commit()
    db.refresh(error_code)
    trace("ADMIN", "Code d'erreur créé", error_code_id=error_code.error_code_id)
    return error_code


def update_error_code(db: Session, error_code_id: int, payload: ErrorCodeAdminIn) -> ErrorCode:
    """Modifie code, libellé, équipement et réponse. La panne rattachée (fault) n'est pas touchée."""
    error_code = _get_or_404(db, error_code_id)
    _ensure_code_available(db, payload.code, ignored_id=error_code_id)
    _apply(error_code, payload)
    db.commit()
    db.refresh(error_code)
    trace("ADMIN", "Code d'erreur modifié", error_code_id=error_code_id)
    return error_code


def delete_error_code(db: Session, error_code_id: int) -> None:
    error_code = _get_or_404(db, error_code_id)
    code = error_code.code  # lu avant le commit : après un rollback, l'objet est expiré
    db.delete(error_code)
    try:
        db.commit()
    except IntegrityError as error:
        # Référencé par une proposition de solution (solution_proposal.error_code_id).
        db.rollback()
        raise StateConflictError(
            f"Le code {code} est cité par des propositions de solution : il ne peut pas être supprimé. "
            "Videz plutôt sa réponse pour le retirer du Copilote."
        ) from error
    trace("ADMIN", "Code d'erreur supprimé", error_code_id=error_code_id)


def _get_or_404(db: Session, error_code_id: int) -> ErrorCode:
    error_code = db.get(ErrorCode, error_code_id)
    if error_code is None:
        raise ReferenceNotFoundError(f"Code d'erreur {error_code_id} introuvable.")
    return error_code


def _ensure_code_available(db: Session, code: str, ignored_id: int | None = None) -> None:
    """Même règle que l'index unique UPPER(code) de la migration 0007, avec un message clair (409)."""
    query = db.query(ErrorCode).filter(func.upper(ErrorCode.code) == code.upper())
    if ignored_id is not None:
        query = query.filter(ErrorCode.error_code_id != ignored_id)
    if query.first() is not None:
        raise StateConflictError(f"Le code {code} existe déjà.")


def _apply(error_code: ErrorCode, payload: ErrorCodeAdminIn) -> None:
    error_code.code = payload.code
    error_code.description = payload.label
    error_code.device_type = payload.device_type
    error_code.reply = payload.reply
