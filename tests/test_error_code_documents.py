import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.config import settings
from app.core.errors import StateConflictError
from app.schemas.error_code_schema import ErrorCodeAdminIn, ErrorCodeDocument
from app.services.error_code_document_service import persist_document, read_documents


ROOT = Path(__file__).resolve().parents[1]


def test_documented_codes_are_concrete_and_catalog_numbers_are_sequential():
    documents = read_documents(ROOT / "db" / "code_erreurs")
    assert len(documents) == 68
    assert [document.catalog_number for document in documents] == list(range(1, 69))
    assert all("id" not in document.model_dump() for document in documents)
    codes = {document.code for document in documents}
    fixed = {"01", "05", "06", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17",
             "18", "19", "20", "21", "22", "23", "24", "25", "26", "28", "29", "70", "90", "91", "93", "95", "98", "B0", "C0"}
    assert codes == fixed | {f"{family}{cassette}" for family in range(3, 9) for cassette in range(1, 7)}
    for document in documents:
        assert document.device_type == "gab"
        assert document.documentation.module == "CMD-V4 (142, 153)"
        assert document.documentation.source == "CMD V4_ET_MAJ.pdf"
        assert 5 <= document.documentation.source_page <= 11
        assert document.reply and "CMD-V4" in document.reply
        if document.documentation.family:
            assert document.code == document.documentation.family.replace("x", str(document.documentation.cassette))
            assert f"cassette {document.documentation.cassette}" in document.reply


def test_empty_or_misnamed_documents_fail_explicitly(tmp_path):
    with pytest.raises(ValueError, match="Aucun JSON"):
        read_documents(tmp_path)
    (tmp_path / "2.json").write_text('{"catalog_number":1,"code":"01"}', encoding="utf-8")
    with pytest.raises(ValueError, match="doit se nommer"):
        read_documents(tmp_path)


def test_duplicate_codes_are_rejected(tmp_path):
    for identifier in (1, 2):
        (tmp_path / f"{identifier}.json").write_text(json.dumps({"catalog_number": identifier, "code": "01"}), encoding="utf-8")
    with pytest.raises(ValueError, match="double"):
        read_documents(tmp_path)


@pytest.mark.parametrize("cassette", [None, 5])
def test_admin_rejects_inconsistent_family_metadata(cassette):
    with pytest.raises(ValueError, match="famille"):
        ErrorCodeAdminIn(code="86", documentation={"family": "8x", "cassette": cassette})


def test_file_written_before_database_and_restored_on_commit_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "error_code_documents_dir", str(tmp_path))
    document = ErrorCodeDocument(catalog_number=1, code="01", label="Avant")
    with persist_document(document, create=True):
        assert json.loads((tmp_path / "1.json").read_text(encoding="utf-8"))["label"] == "Avant"
    previous = (tmp_path / "1.json").read_bytes()
    document.label = "Apres"
    with pytest.raises(RuntimeError, match="SQL"):
        with persist_document(document):
            raise RuntimeError("SQL commit failed")
    assert (tmp_path / "1.json").read_bytes() == previous
    with pytest.raises(RuntimeError):
        with persist_document(document, delete=True):
            assert not (tmp_path / "1.json").exists()
            raise RuntimeError("SQL commit failed")
    assert (tmp_path / "1.json").read_bytes() == previous


def test_failed_creation_leaves_no_json_and_does_not_overwrite_existing(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "error_code_documents_dir", str(tmp_path))
    document = ErrorCodeDocument(catalog_number=1, code="01")
    with pytest.raises(RuntimeError):
        with persist_document(document, create=True):
            raise RuntimeError("SQL commit failed")
    assert not list(tmp_path.iterdir())
    with persist_document(document, create=True):
        pass
    with pytest.raises(StateConflictError):
        with persist_document(document, create=True):
            pytest.fail("Existing JSON was overwritten")


def test_disk_failure_does_not_run_sql_commit(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "error_code_documents_dir", str(tmp_path))
    with patch("app.services.error_code_document_service._write", side_effect=OSError("Disk full")):
        with pytest.raises(OSError, match="Disk full"):
            with persist_document(ErrorCodeDocument(catalog_number=1, code="01"), create=True):
                pytest.fail("Database commit must not run when JSON cannot be saved")
