"""JSON sources des codes d'erreur, partagées par l'import et l'administration."""

import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import StateConflictError
from app.schemas.error_code_schema import ErrorCodeDocument


def directory() -> Path:
    return Path(settings.error_code_documents_dir)


def lock_catalog(db: Session) -> None:
    # Sérialise les numéros de catalogue et les écritures JSON, pas les ID SQL.
    db.execute(text("LOCK TABLE code_erreur IN SHARE ROW EXCLUSIVE MODE"))


def read_documents(folder: Path) -> list[ErrorCodeDocument]:
    documents = []
    codes = set()
    ids = set()
    for path in sorted(folder.glob("*.json")):
        document = ErrorCodeDocument.model_validate_json(path.read_text(encoding="utf-8"))
        if path.name != f"{document.catalog_number}.json":
            raise ValueError(f"{path.name} doit se nommer {document.catalog_number}.json.")
        if document.catalog_number in ids or document.code.upper() in codes:
            raise ValueError(f"Code ou identifiant en double : {path.name}.")
        ids.add(document.catalog_number)
        codes.add(document.code.upper())
        documents.append(document)
    if not documents:
        raise ValueError(f"Aucun JSON de code d'erreur dans {folder}.")
    return sorted(documents, key=lambda document: document.catalog_number)


def describe_record(record) -> ErrorCodeDocument:
    return ErrorCodeDocument(
        catalog_number=record.catalog_number, code=record.code, label=record.description,
        device_type=record.device_type, reply=record.reply, documentation=record.documentation or {},
    )


def _write(path: Path, content: bytes) -> None:
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def persist_document(document: ErrorCodeDocument, *, create: bool = False, delete: bool = False):
    """Écrit avant le commit SQL et restaure le fichier si la transaction échoue."""
    folder = directory()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{document.catalog_number}.json"
    previous = path.read_bytes() if path.exists() else None
    if create and previous is not None:
        raise StateConflictError(f"Le fichier {document.catalog_number}.json existe déjà : rechargez le catalogue avant de créer un code.")
    if delete:
        path.unlink(missing_ok=True)
    else:
        content = json.dumps(document.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
        _write(path, content.encode("utf-8"))
    try:
        yield
    except BaseException:
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            _write(path, previous)
        raise
