"""Tests PostgreSQL : exécuter contre une base de validation, jamais la base active."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.fault import ErrorCode
from app.models.conversation import ConversationMessage, ConversationContext
from app.schemas.error_code_schema import ErrorCodeAdminIn
from app.services import error_code_service
from app.services import chat_orchestrator_service, llm_service
from scripts.load_error_codes import DEMO_CODES, load_error_codes


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def catalog(monkeypatch, tmp_path):
    assert "validation" in str(SessionLocal.kw["bind"].url.database), "Use an isolated validation database."
    monkeypatch.setattr(settings, "error_code_documents_dir", str(tmp_path))
    monkeypatch.setattr(settings, "admin_api_key", "catalog-test-key")
    with SessionLocal() as db:
        db.execute(text("DELETE FROM proposition_solution"))
        db.execute(text("DELETE FROM code_erreur"))
        db.execute(text("SELECT setval(pg_get_serial_sequence('code_erreur','error_code_id'), 1001, false)"))
        db.commit()
    yield tmp_path
    with SessionLocal() as db:
        db.execute(text("DELETE FROM proposition_solution"))
        db.execute(text("DELETE FROM code_erreur"))
        db.commit()


def test_import_matches_every_json_and_is_idempotent(catalog):
    with SessionLocal.begin() as db:
        assert load_error_codes(db, ROOT / "db/code_erreurs") == 68
    with SessionLocal.begin() as db:
        assert load_error_codes(db, ROOT / "db/code_erreurs") == 68
        rows = db.query(ErrorCode).order_by(ErrorCode.catalog_number).all()
        assert [row.catalog_number for row in rows] == list(range(1, 69))
        assert rows[0].error_code_id == 1001
        for row in rows:
            document = json.loads((ROOT / f"db/code_erreurs/{row.catalog_number}.json").read_text(encoding="utf-8"))
            assert row.code == document["code"]
            assert row.reply == document["reply"]
            assert row.documentation["source_page"] == document["documentation"]["source_page"]
        assert db.query(ErrorCode).filter(ErrorCode.code.in_(["3x", "4x", "E42", "E43", "E67", "00"])).count() == 0
    with SessionLocal() as db:
        added = error_code_service.create_error_code(db, ErrorCodeAdminIn(code="ADMIN-NEXT"))
        assert added.catalog_number == 69
        assert added.error_code_id > 1001
        assert json.loads((catalog / "69.json").read_text(encoding="utf-8"))["catalog_number"] == 69


def test_replacement_deletes_only_known_demo_codes(catalog):
    with SessionLocal.begin() as db:
        db.execute(text("INSERT INTO panne (fault_id,name) VALUES (1,'Demo 1'),(2,'Demo 2') ON CONFLICT DO NOTHING"))
        for identifier, (code, description, fault_id) in DEMO_CODES.items():
            db.add(ErrorCode(error_code_id=identifier, catalog_number=identifier, code=code, description=description, fault_id=fault_id))
        db.add(ErrorCode(error_code_id=100, catalog_number=100, code="REAL-KEEP", description="A conserver"))
    with SessionLocal.begin() as db:
        faults_before = db.execute(text("SELECT count(*) FROM panne")).scalar_one()
        load_error_codes(db, ROOT / "db/code_erreurs", replace_demo=True)
        assert db.query(ErrorCode).count() == 69
        assert db.get(ErrorCode, 100).code == "REAL-KEEP"
        assert db.execute(text("SELECT count(*) FROM panne")).scalar_one() == faults_before


def test_conflicting_import_rolls_back_without_removing_existing_data(catalog):
    with SessionLocal.begin() as db:
        db.add(ErrorCode(error_code_id=1, catalog_number=1, code="MY-REAL-CODE"))
    with pytest.raises(ValueError, match="Conflit"):
        with SessionLocal.begin() as db:
            load_error_codes(db, ROOT / "db/code_erreurs", replace_demo=True)
    with SessionLocal() as db:
        assert db.query(ErrorCode).count() == 1
        assert db.get(ErrorCode, 1).code == "MY-REAL-CODE"


def test_admin_crud_writes_json_before_sql_and_preserves_metadata(catalog):
    client = TestClient(app)
    headers = {"X-Admin-Key": "catalog-test-key"}
    assert client.post("/api/admin/error_code", json={"code": "TEST"}).status_code == 403
    created = client.post("/api/admin/error_code", headers=headers, json={
        "code": "TEST", "device_type": "gab", "reply": "Verifier",
        "documentation": {"module": "CMD-V4", "source": "Test", "source_page": 6},
    })
    assert created.status_code == 201
    identifier = created.json()["id"]
    assert identifier == 1001
    assert created.json()["catalog_number"] == 1
    path = catalog / "1.json"
    assert json.loads(path.read_text(encoding="utf-8"))["code"] == "TEST"
    updated = client.put(f"/api/admin/error_code/{identifier}", headers=headers, json={
        "code": "TEST-UPDATED", "device_type": "gab", "reply": "Suite",
    })
    assert updated.status_code == 200
    assert updated.json()["documentation"]["source"] == "Test"
    assert json.loads(path.read_text(encoding="utf-8"))["reply"] == "Suite"
    assert client.delete(f"/api/admin/error_code/{identifier}", headers=headers).status_code == 200
    assert not path.exists()


def test_disk_failure_prevents_database_write(catalog, monkeypatch):
    def fail(*args):
        raise OSError("Disk full")
    monkeypatch.setattr("app.services.error_code_document_service._write", fail)
    with SessionLocal() as db:
        with pytest.raises(OSError, match="Disk full"):
            error_code_service.create_error_code(db, ErrorCodeAdminIn(code="TEST"))
        db.rollback()
        assert db.query(ErrorCode).count() == 0


def test_sql_commit_failure_removes_new_json(catalog, monkeypatch):
    with SessionLocal() as db:
        def fail():
            raise RuntimeError("SQL commit failed")
        monkeypatch.setattr(db, "commit", fail)
        with pytest.raises(RuntimeError, match="SQL commit"):
            error_code_service.create_error_code(db, ErrorCodeAdminIn(code="TEST"))
        db.rollback()
        assert db.query(ErrorCode).count() == 0
        assert not list(catalog.glob("*.json"))


def test_concurrent_admin_creations_have_distinct_integer_ids(catalog):
    def create(index):
        with SessionLocal() as db:
            row = error_code_service.create_error_code(db, ErrorCodeAdminIn(code=f"TEST-{index}"))
            return row.error_code_id, row.catalog_number
    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(create, range(4)))
    assert sorted(identifier for identifier, _ in ids) == [1001, 1002, 1003, 1004]
    assert sorted(number for _, number in ids) == [1, 2, 3, 4]
    assert {path.name for path in catalog.glob("*.json")} == {"1.json", "2.json", "3.json", "4.json"}


@pytest.fixture
def technician(catalog):
    with SessionLocal.begin() as db:
        identifier = db.execute(text(
            "INSERT INTO technicien(full_name) VALUES ('Validation codes') RETURNING technician_id"
        )).scalar_one()
    yield identifier
    with SessionLocal.begin() as db:
        db.execute(text("DELETE FROM conversation WHERE technician_id=:id"), {"id": identifier})
        db.execute(text("DELETE FROM technicien WHERE technician_id=:id"), {"id": identifier})


@pytest.mark.parametrize("intent", ["diagnostic", "conversation"])
def test_detected_code_uses_database_reply_and_persists_reference(catalog, technician, monkeypatch, intent):
    with SessionLocal.begin() as db:
        load_error_codes(db, ROOT / "db/code_erreurs")
        known = db.query(ErrorCode).filter(ErrorCode.code == "01").one()
        identifier, reply = known.error_code_id, known.reply
    from unittest.mock import Mock
    generate = Mock(return_value=json.dumps({
        "intent": intent, "error_code_text": "01", "reply": None,
    }))
    monkeypatch.setattr(llm_service, "generate_chat_reply", generate)
    client = TestClient(app)
    response = client.post("/api/chat", json={
        "technician_id": technician, "device_type": "gab", "message": "Le GAB affiche le code 01",
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["reply"] == reply
    assert result["error_code_id"] == identifier
    assert result["detected_error_code"] == "01"
    assert not result["intervention_add_available"]
    assert not result["solution_proposal_available"]
    assert generate.call_count == 1
    conversation_id = result["conversation_id"]
    with SessionLocal() as db:
        messages = db.query(ConversationMessage).filter_by(conversation_id=conversation_id).all()
        assert len(messages) == 2
        assert all(m.error_code_id == identifier and m.detected_error_code == "01" for m in messages)
        context = db.get(ConversationContext, conversation_id).context
        assert context["error_code_id"] == identifier
        assert context["error_code_reference"]["catalog_number"] == 1
        assert reply in chat_orchestrator_service._describe_last_search(db, context)
    history = client.get(f"/api/chat/conversations/{conversation_id}", params={"technician_id": technician})
    assert all(m["error_code_id"] == identifier for m in history.json()["messages"])

    generate.return_value = json.dumps({"intent": "conversation", "reply": "Suite de la consigne."})
    followup = client.post("/api/chat", json={
        "technician_id": technician, "conversation_id": conversation_id,
        "device_type": "gab", "message": "Et ensuite ?",
    })
    assert followup.status_code == 200
    assert reply in generate.call_args.args[1][-1]["content"]
    assert generate.call_count == 2

    generate.return_value = json.dumps({"intent": "conversation", "error_code_text": "UNKNOWN", "reply": None})
    unknown = client.post("/api/chat", json={
        "technician_id": technician, "conversation_id": conversation_id,
        "device_type": "gab", "message": "Maintenant le code UNKNOWN",
    })
    assert unknown.status_code == 200
    assert unknown.json()["error_code_id"] is None
    assert "Aucune consigne" in unknown.json()["reply"]
    with SessionLocal() as db:
        context = db.get(ConversationContext, conversation_id).context
        assert "error_code_id" not in context
        assert "error_code_reference" not in context


def test_menu_selection_is_persistent_without_any_llm(catalog, technician, monkeypatch):
    with SessionLocal.begin() as db:
        load_error_codes(db, ROOT / "db/code_erreurs")
        known = db.query(ErrorCode).filter(ErrorCode.code == "86").one()
        identifier, reply = known.error_code_id, known.reply
    def forbidden(*args, **kwargs):
        pytest.fail("A saved code must never call Claude.")
    monkeypatch.setattr(llm_service, "generate_chat_reply", forbidden)
    client = TestClient(app)
    payload = {"technician_id": technician, "device_type": "tpe", "error_code_id": identifier}
    assert client.post("/api/chat/error-code", json=payload).status_code == 404
    payload["device_type"] = "gab"
    selected = client.post("/api/chat/error-code", json=payload)
    assert selected.status_code == 200, selected.text
    assert selected.json()["reply"] == reply
    history = client.get(
        f"/api/chat/conversations/{selected.json()['conversation_id']}", params={"technician_id": technician},
    ).json()
    assert [m["role"] for m in history["messages"]] == ["user", "assistant"]
    assert all(m["error_code_id"] == identifier for m in history["messages"])
