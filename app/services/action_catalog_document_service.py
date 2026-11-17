"""JSON sources du catalogue d'actions, partagées par l'import et l'administration."""

import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.core.config import settings
from app.core.errors import StateConflictError
from app.schemas.catalog_schema import ActionCatalogDocument


def directory() -> Path:
    return Path(settings.action_catalog_documents_dir)


def read_documents(folder: Path) -> list[ActionCatalogDocument]:
    documents = []
    numbers = set()
    texts = set()
    for path in sorted(folder.glob("*.json")):
        document = ActionCatalogDocument.model_validate_json(path.read_text(encoding="utf-8"))
        if path.name != f"{document.catalog_number}.json":
            raise ValueError(f"{path.name} doit se nommer {document.catalog_number}.json.")
        text_key = document.canonical_text.casefold()
        if document.catalog_number in numbers or text_key in texts:
            raise ValueError(f"Action ou identifiant en double : {path.name}.")
        numbers.add(document.catalog_number)
        texts.add(text_key)
        documents.append(document)
    return sorted(documents, key=lambda document: document.catalog_number)


def next_catalog_number(folder: Path) -> int:
    documents = read_documents(folder)
    numbers = [document.catalog_number for document in documents]
    return max(numbers, default=0) + 1


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
def persist_document(document: ActionCatalogDocument):
    """Écrit le JSON avant le commit SQL et retire le fichier si la transaction échoue."""
    folder = directory()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{document.catalog_number}.json"
    if path.exists():
        raise StateConflictError(
            f"Le fichier {document.catalog_number}.json existe déjà : rechargez le catalogue avant de créer une action."
        )
    content = json.dumps(document.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    _write(path, content.encode("utf-8"))
    try:
        yield
    except BaseException:
        path.unlink(missing_ok=True)
        raise
