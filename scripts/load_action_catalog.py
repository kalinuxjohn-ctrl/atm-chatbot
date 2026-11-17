"""Charge les actions de db/actions/*.json dans le catalogue SQL."""

import argparse
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.catalog import Action
from app.services.action_catalog_document_service import directory, read_documents


def load_action_catalog(db: Session, folder: Path) -> int:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("LOCK TABLE action IN SHARE ROW EXCLUSIVE MODE"))
    documents = read_documents(folder)
    existing_actions = {}
    for action in db.query(Action).all():
        existing_actions.setdefault(action.canonical_text.strip().casefold(), []).append(action)
    for document in documents:
        normalized_text = document.canonical_text.casefold()
        matches = existing_actions.get(normalized_text)
        if matches:
            for action in matches:
                action.device_type = document.device_type
        else:
            db.add(Action(
                canonical_text=document.canonical_text,
                device_type=document.device_type,
            ))
            existing_actions[normalized_text] = []
    db.flush()
    return len(documents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=directory())
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        count = load_action_catalog(db, arguments.directory)
    print(f"{count} actions chargées depuis les JSON.")


if __name__ == "__main__":
    main()
