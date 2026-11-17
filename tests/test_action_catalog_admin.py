"""Administration du catalogue d'actions et rattachement manuel."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.models.catalog import Action, Component
from app.schemas.catalog_schema import ActionCatalogAdminCreate
from app.services.catalog_service import create_catalog_action
from scripts.load_action_catalog import load_action_catalog

ADMIN_KEY = "action-catalog-test-key"
client = TestClient(app)


@pytest.fixture
def catalogue_db(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Component.__table__.create(engine)
    Action.__table__.create(engine)
    db = Session(engine)
    monkeypatch.setattr(settings, "admin_api_key", ADMIN_KEY)
    monkeypatch.setattr(settings, "action_catalog_documents_dir", str(tmp_path / "actions"))
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.pop(get_db, None)
    db.close()
    engine.dispose()


def test_catalogue_actions_requires_admin_key(catalogue_db):
    assert client.get("/api/admin/action_catalog").status_code == 403
    assert client.post(
        "/api/admin/action_catalog",
        json={"canonical_text": "Nettoyer le lecteur"},
        headers={"X-Admin-Key": "wrong-key"},
    ).status_code == 403


def test_admin_can_create_and_list_catalog_action(catalogue_db):
    created = client.post(
        "/api/admin/action_catalog",
        json={"canonical_text": "  Nettoyer le lecteur de carte  ", "device_type": "gab"},
        headers={"X-Admin-Key": ADMIN_KEY},
    )

    assert created.status_code == 201
    assert created.json()["canonical_text"] == "Nettoyer le lecteur de carte"
    assert created.json()["device_type"] == "gab"
    assert client.get("/api/admin/action_catalog", headers={"X-Admin-Key": ADMIN_KEY}).json() == [created.json()]
    document = settings.action_catalog_documents_dir
    with open(f"{document}/1.json", encoding="utf-8") as action_file:
        assert json.load(action_file) == {
            "catalog_number": 1,
            "canonical_text": "Nettoyer le lecteur de carte",
            "device_type": "gab",
        }


def test_catalog_json_is_removed_if_database_commit_fails(catalogue_db, monkeypatch):
    def fail_commit():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(catalogue_db, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="database unavailable"):
        create_catalog_action(
            catalogue_db,
            ActionCatalogAdminCreate(canonical_text="Nettoyer le lecteur", device_type="tpe"),
        )

    assert not list(Path(settings.action_catalog_documents_dir).glob("*.json"))
    assert catalogue_db.query(Action).count() == 0


def test_action_json_import_is_idempotent(catalogue_db, tmp_path):
    folder = tmp_path / "seed"
    folder.mkdir()
    catalogue_db.add(Action(canonical_text="Équipement de la caisse"))
    catalogue_db.commit()
    (folder / "1.json").write_text(
        '{"catalog_number": 1, "canonical_text": "équipement de la caisse", "device_type": "tpe"}',
        encoding="utf-8",
    )

    assert load_action_catalog(catalogue_db, folder) == 1
    assert load_action_catalog(catalogue_db, folder) == 1
    assert catalogue_db.query(Action).count() == 1
    assert catalogue_db.query(Action).one().device_type == "tpe"


def test_admin_cannot_create_duplicate_catalog_action(catalogue_db):
    headers = {"X-Admin-Key": ADMIN_KEY}
    assert client.post(
        "/api/admin/action_catalog",
        json={"canonical_text": "Équipement de la caisse"},
        headers=headers,
    ).status_code == 201
    duplicate = client.post(
        "/api/admin/action_catalog",
        json={"canonical_text": "équipement de la caisse"},
        headers=headers,
    )

    assert duplicate.status_code == 409


def test_catalog_action_must_not_be_blank(catalogue_db):
    response = client.post(
        "/api/admin/action_catalog",
        json={"canonical_text": "   "},
        headers={"X-Admin-Key": ADMIN_KEY},
    )

    assert response.status_code == 422
