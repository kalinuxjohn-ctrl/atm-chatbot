"""Charge les problèmes documentés dans db/problemes_officiels/*.json."""

import argparse
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.usual_problem import UsualProblem
from app.schemas.usual_problem_schema import OfficialProblemDocument


def directory() -> Path:
    return Path(settings.official_problem_documents_dir)


def read_documents(folder: Path) -> list[OfficialProblemDocument]:
    documents = []
    source_keys = set()
    for path in sorted(folder.glob("*.json")):
        document = OfficialProblemDocument.model_validate_json(path.read_text(encoding="utf-8"))
        if path.name != f"{document.source_key}.json":
            raise ValueError(f"{path.name} doit se nommer {document.source_key}.json.")
        if document.source_key in source_keys:
            raise ValueError(f"Identifiant de source en double : {document.source_key}.")
        source_keys.add(document.source_key)
        documents.append(document)
    if not documents:
        raise ValueError(f"Aucun problème documenté dans {folder}.")
    return documents


def load_official_problems(db: Session, folder: Path) -> int:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("LOCK TABLE panne_frequente IN SHARE ROW EXCLUSIVE MODE"))
    documents = read_documents(folder)
    for document in documents:
        row = db.query(UsualProblem).filter(UsualProblem.source_key == document.source_key).first()
        if row is None:
            row = UsualProblem(source_key=document.source_key)
            db.add(row)
        row.device_type = document.device_type
        row.label = document.label
        row.reply = document.reply
        row.display_order = document.display_order
        row.documentation = document.documentation.model_dump(mode="json")
    db.flush()
    return len(documents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=directory())
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        count = load_official_problems(db, arguments.directory)
    print(f"{count} problèmes officiels chargés depuis les JSON.")


if __name__ == "__main__":
    main()
