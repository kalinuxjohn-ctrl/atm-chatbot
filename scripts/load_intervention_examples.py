"""Charge ou retire les interventions de référence définies dans un JSON."""

import argparse
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.device import Device
from app.models.intervention import Diagnosis, Intervention, InterventionAction, InterventionSymptom
from app.schemas.intervention_example_schema import InterventionExampleDocument
from app.services.embeddings_service import generate_embeddings_batch


SOURCE_PREFIX = "intervention-reference-"
DEVICE_SOURCE_KEYS = {
    "gab": "intervention-reference-device-gab",
    "tpe": "intervention-reference-device-tpe",
}


def read_documents(path: Path) -> list[InterventionExampleDocument]:
    if not path.exists():
        return []
    raw_documents = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_documents, list):
        raise ValueError(f"{path} doit contenir une liste d'interventions.")
    documents = [InterventionExampleDocument.model_validate(item) for item in raw_documents]
    source_keys = [document.source_key for document in documents]
    if len(source_keys) != len(set(source_keys)):
        raise ValueError("Identifiant de source d'intervention en double.")
    return documents


def load_intervention_examples(db: Session, path: Path) -> int:
    documents = read_documents(path)
    existing = {
        row.source_key: row
        for row in db.query(Intervention).filter(Intervention.source_key.like(f"{SOURCE_PREFIX}%")).all()
    }
    document_keys = {document.source_key for document in documents}
    stale_rows = [row for key, row in existing.items() if key not in document_keys]
    if stale_rows:
        _delete_interventions(db, stale_rows)
        existing = {key: row for key, row in existing.items() if key in document_keys}

    new_documents = [document for document in documents if document.source_key not in existing]
    embeddings = generate_embeddings_batch(
        [document.symptoms[0].text for document in new_documents]
    ) if new_documents else []
    vectors = dict(zip((document.source_key for document in new_documents), embeddings))

    devices = {}
    for device_type in {document.device_type for document in documents}:
        source_key = DEVICE_SOURCE_KEYS[device_type]
        device = db.query(Device).filter(Device.source_key == source_key).first()
        if device is None:
            device = Device(
                source_key=source_key,
                device_type=device_type,
                site_name=f"Référentiel de dépannage {device_type.upper()}",
            )
            db.add(device)
            db.flush()
        devices[device_type] = device

    for document in documents:
        row = existing.get(document.source_key)
        if row is not None:
            if row.summary_text != document.summary or row.device.device_type != document.device_type:
                raise ValueError(
                    f"{document.source_key} existe avec un contenu différent; retire les exemples avant de les recharger."
                )
            continue

        row = Intervention(
            source_key=document.source_key,
            device_id=devices[document.device_type].device_id,
            technician_id=None,
            created_by_admin="Référentiel de dépannage",
            opened_at=document.opened_at.replace(tzinfo=None),
            summary_text=document.summary,
            final_outcome_status=document.final_outcome_status,
        )
        db.add(row)
        db.flush()

        symptom = document.symptoms[0]
        intervention_symptom = InterventionSymptom(
            intervention_id=row.intervention_id,
            raw_text=symptom.text,
            severity=symptom.severity,
        )
        db.add(intervention_symptom)
        db.flush()
        db.execute(
            text(
                "UPDATE symptome_intervention SET embedding = CAST(:embedding AS vector) "
                "WHERE intervention_symptom_id = :symptom_id"
            ),
            {"embedding": str(vectors[document.source_key]), "symptom_id": intervention_symptom.intervention_symptom_id},
        )

        for order, action in enumerate(document.actions, start=1):
            db.add(InterventionAction(
                intervention_id=row.intervention_id,
                raw_text=action.text,
                sequence_order=order,
                result_description=action.result,
                outcome_status=action.outcome_status,
                is_confirmed_solution=action.confirmed_solution,
            ))
        db.add(Diagnosis(
            intervention_id=row.intervention_id,
            description=document.diagnosis.description,
            root_cause_component_text=document.diagnosis.root_cause_component,
            confirmed=document.diagnosis.confirmed,
        ))

    db.flush()
    return len(documents)


def remove_intervention_examples(db: Session) -> int:
    rows = db.query(Intervention).filter(Intervention.source_key.like(f"{SOURCE_PREFIX}%")).all()
    if not rows:
        return 0
    return _delete_interventions(db, rows)


def _delete_interventions(db: Session, rows: list[Intervention]) -> int:
    identifiers = [row.intervention_id for row in rows]
    referenced = db.execute(
        text(
            "SELECT count(*) FROM proposition_solution "
            "WHERE intervention_id = ANY(:ids) OR intervention_symptom_id IN "
            "(SELECT intervention_symptom_id FROM symptome_intervention WHERE intervention_id = ANY(:ids))"
        ),
        {"ids": identifiers},
    ).scalar_one()
    approved_additions = db.execute(
        text("SELECT count(*) FROM ajout_intervention WHERE created_intervention_id = ANY(:ids)"),
        {"ids": identifiers},
    ).scalar_one()
    if referenced or approved_additions:
        raise ValueError("Certaines interventions de référence sont utilisées par des dossiers; suppression annulée.")

    for row in rows:
        db.query(Diagnosis).filter(Diagnosis.intervention_id == row.intervention_id).delete(synchronize_session=False)
        db.query(InterventionAction).filter(
            InterventionAction.intervention_id == row.intervention_id
        ).delete(synchronize_session=False)
        db.query(InterventionSymptom).filter(
            InterventionSymptom.intervention_id == row.intervention_id
        ).delete(synchronize_session=False)
        db.delete(row)
    db.flush()
    devices = db.query(Device).filter(Device.source_key.in_(DEVICE_SOURCE_KEYS.values())).all()
    for device in devices:
        used = db.query(Intervention).filter(Intervention.device_id == device.device_id).first()
        referenced = db.execute(
            text("SELECT count(*) FROM proposition_solution WHERE device_id = :device_id"),
            {"device_id": device.device_id},
        ).scalar_one()
        if used is None and not referenced:
            db.delete(device)
    db.flush()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=Path(settings.intervention_example_documents_file))
    parser.add_argument("--remove", action="store_true", help="Retire uniquement les interventions de référence.")
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        count = remove_intervention_examples(db) if arguments.remove else load_intervention_examples(db, arguments.file)
    verb = "retirées de la base" if arguments.remove else "chargées depuis le JSON"
    print(f"{count} interventions de référence {verb}.")


if __name__ == "__main__":
    main()
