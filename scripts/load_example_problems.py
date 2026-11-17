"""Charge ou retire les problèmes usuels de référence définis dans des JSON."""

import argparse
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.usual_problem import UsualProblem
from app.schemas.example_problem_schema import ExampleProblemDocument


SOURCE_PREFIX = "problem-reference-"


def directory() -> Path:
    return Path(settings.example_problem_documents_dir)


def read_documents(folder: Path) -> list[ExampleProblemDocument]:
    documents = []
    source_keys = set()
    for path in sorted(folder.glob("*.json")):
        document = ExampleProblemDocument.model_validate_json(path.read_text(encoding="utf-8"))
        if path.name != f"{document.source_key}.json":
            raise ValueError(f"{path.name} doit se nommer {document.source_key}.json.")
        if document.source_key in source_keys:
            raise ValueError(f"Identifiant de source en double : {document.source_key}.")
        source_keys.add(document.source_key)
        documents.append(document)
    return documents


def load_example_problems(db: Session, folder: Path) -> int:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("LOCK TABLE panne_frequente IN SHARE ROW EXCLUSIVE MODE"))
    documents = read_documents(folder)
    document_keys = {document.source_key for document in documents}
    stale_rows = db.query(UsualProblem).filter(
        UsualProblem.source_key.like(f"{SOURCE_PREFIX}%"),
        ~UsualProblem.source_key.in_(document_keys),
    ).all() if document_keys else db.query(UsualProblem).filter(
        UsualProblem.source_key.like(f"{SOURCE_PREFIX}%")
    ).all()
    for row in stale_rows:
        db.delete(row)
    for document in documents:
        row = db.query(UsualProblem).filter(UsualProblem.source_key == document.source_key).first()
        if row is None:
            row = UsualProblem(source_key=document.source_key)
            db.add(row)
        row.device_type = document.device_type
        row.label = document.label
        row.reply = document.reply
        row.display_order = document.display_order
        row.documentation = {
            "source_kind": "provisional_example",
            "note": "Exemple général à remplacer par une procédure validée pour le modèle concerné.",
        }
    db.flush()
    return len(documents)


def remove_example_problems(db: Session) -> int:
    rows = db.query(UsualProblem).filter(UsualProblem.source_key.like(f"{SOURCE_PREFIX}%")).all()
    for row in rows:
        db.delete(row)
    db.flush()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=directory())
    parser.add_argument("--remove", action="store_true", help="Retire uniquement les problèmes de référence.")
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        count = remove_example_problems(db) if arguments.remove else load_example_problems(db, arguments.directory)
    verb = "retirés de la base" if arguments.remove else "chargés depuis les JSON"
    print(f"{count} problèmes usuels {verb}.")


if __name__ == "__main__":
    main()
