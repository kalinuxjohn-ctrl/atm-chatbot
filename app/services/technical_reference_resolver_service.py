"""
Résout le texte brut compris par message_understanding_service vers de
vrais identifiants PostgreSQL. Aucune fonction ici ne fait confiance à un
ID venant du LLM -- tout est retrouvé par requête SQL, jamais deviné.

Correspondance EXACTE (insensible casse/espaces), pas de fuzzy matching :
les fautes de frappe sont déjà corrigées en amont par le LLM
(message_understanding_service), donc une correspondance exacte suffit ici
et reste simple à auditer.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.schemas.device_type import normalize_device_type


def resolve_technical_references(
    db: Session, device_type_text: str | None, model_name_text: str | None, error_code_text: str | None
) -> dict:
    """
    Résout ce qui peut l'être parmi les textes fournis. Un champ non
    résolu est simplement absent du dict retourné (pas de null qui traîne).
    """
    trace(
        "REFERENCES",
        "Résolution des références techniques démarrée",
        has_device_type=bool(device_type_text),
        has_model_name=bool(model_name_text),
        has_error_code=bool(error_code_text),
    )
    resolved: dict = {}

    if device_type_text:
        normalized = normalize_device_type(device_type_text)
        if normalized:
            resolved["device_type"] = normalized

    if model_name_text:
        model_id = _resolve_model_id(db, model_name_text)
        if model_id is not None:
            resolved["model_id"] = model_id
            resolved["model_name"] = model_name_text  # gardé pour affichage ; l'ID reste la référence fiable

    if error_code_text:
        error_code_id = _resolve_error_code_id(db, error_code_text)
        if error_code_id is not None:
            resolved["error_code_id"] = error_code_id
            resolved["error_code"] = error_code_text

    trace(
        "REFERENCES",
        "Résolution des références techniques terminée",
        device_type_resolved="device_type" in resolved,
        model_resolved="model_id" in resolved,
        error_code_resolved="error_code_id" in resolved,
    )
    return resolved


def _resolve_model_id(db: Session, model_name_text: str) -> int | None:
    row = db.execute(
        text(
            "SELECT model_id FROM device_model "
            "WHERE UPPER(TRIM(model_name)) = UPPER(TRIM(:model_name_text)) LIMIT 1"
        ),
        {"model_name_text": model_name_text},
    ).first()
    return row[0] if row else None


def _resolve_error_code_id(db: Session, error_code_text: str) -> int | None:
    """Réutilise le même index que error_code_service (idx_error_code_code_ci, migration 0007)."""
    row = db.execute(
        text("SELECT error_code_id FROM error_code WHERE UPPER(code) = UPPER(:error_code_text) LIMIT 1"),
        {"error_code_text": error_code_text},
    ).first()
    return row[0] if row else None