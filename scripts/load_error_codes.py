"""Charge les JSON de db/code_erreurs par numéro de catalogue ; PostgreSQL attribue les ID."""

import argparse
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.fault import ErrorCode
from app.services.error_code_document_service import directory, lock_catalog, read_documents
from app.services.error_code_service import _apply


DEMO_CODES = {
    1: ("E42", "Capteur de rétention de carte ne répond pas", 1),
    2: ("E43", "Moteur du lecteur de carte bloqué", 1),
    3: ("E67", "Distributeur de billets : bourrage détecté", 2),
}


def load_error_codes(db: Session, folder: Path, *, replace_demo: bool = False) -> int:
    lock_catalog(db)
    documents = read_documents(folder)
    if replace_demo:
        for identifier, (code, description, fault_id) in DEMO_CODES.items():
            row = db.get(ErrorCode, identifier)
            if row is None or row.code != code:
                continue
            if row.description != description or row.fault_id != fault_id or row.documentation:
                raise ValueError(f"Le code {code} a été modifié : suppression automatique refusée.")
            referenced = db.execute(text(
                "SELECT count(*) FROM proposition_solution WHERE error_code_id = :id"
            ), {"id": identifier}).scalar_one()
            if referenced:
                raise ValueError(f"Le code de démo {code} est référencé : remplacement refusé.")
            db.delete(row)
        db.flush()
    for document in documents:
        row = db.query(ErrorCode).filter(ErrorCode.catalog_number == document.catalog_number).first()
        duplicate = db.query(ErrorCode).filter(
            text("upper(code) = upper(:code)"), ErrorCode.catalog_number != document.catalog_number,
        ).params(code=document.code).first()
        if duplicate is not None or (row is not None and row.code.upper() != document.code.upper()):
            raise ValueError(f"Conflit de numéro ou de code pour {document.catalog_number}.json ({document.code}).")
        if row is None:
            row = ErrorCode(catalog_number=document.catalog_number)
            db.add(row)
        _apply(row, document)
    db.flush()
    return len(documents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=directory())
    parser.add_argument("--replace-demo", action="store_true", help="Supprime uniquement E42/E43/E67 de la démo connue.")
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        count = load_error_codes(db, arguments.directory, replace_demo=arguments.replace_demo)
    print(f"{count} codes d'erreur chargés depuis les JSON.")


if __name__ == "__main__":
    main()
