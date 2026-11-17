"""Administration du catalogue des modèles d'équipement."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.models.device import DeviceModel, DeviceModelVersion, Manufacturer

ADMIN_KEY = "device-model-catalog-test-key"
client = TestClient(app)


@pytest.fixture
def equipment_catalog_db(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Manufacturer.__table__.create(engine)
    DeviceModel.__table__.create(engine)
    DeviceModelVersion.__table__.create(engine)
    db = Session(engine)
    monkeypatch.setattr(settings, "admin_api_key", ADMIN_KEY)
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.pop(get_db, None)
    db.close()
    engine.dispose()


def test_device_model_catalog_requires_admin_key(equipment_catalog_db):
    assert client.get("/api/admin/device_models").status_code == 403
    assert client.post(
        "/api/admin/device_models",
        json={"device_type": "gab", "manufacturer_name": "NCR", "model_name": "SelfServ 22"},
        headers={"X-Admin-Key": "wrong-key"},
    ).status_code == 403


def test_admin_can_create_model_manufacturer_and_version(equipment_catalog_db):
    response = client.post(
        "/api/admin/device_models",
        json={
            "device_type": "gab",
            "manufacturer_name": " NCR ",
            "model_name": " SelfServ 22 ",
            "release_year": 2024,
            "version_label": "3.2.1",
            "hardware_rev": "Rev. B",
            "notes": "Version de test",
        },
        headers={"X-Admin-Key": ADMIN_KEY},
    )

    assert response.status_code == 201
    assert response.json() == {
        "model_id": 1,
        "device_type": "gab",
        "manufacturer_name": "NCR",
        "model_name": "SelfServ 22",
        "release_year": 2024,
        "versions": [{
            "version_id": 1,
            "version_label": "3.2.1",
            "hardware_rev": "Rev. B",
            "notes": "Version de test",
        }],
    }
    assert client.get(
        "/api/admin/device_models",
        headers={"X-Admin-Key": ADMIN_KEY},
    ).json() == [response.json()]
    assert equipment_catalog_db.query(Manufacturer).count() == 1


def test_same_model_cannot_be_added_twice_for_manufacturer_and_type(equipment_catalog_db):
    body = {"device_type": "tpe", "manufacturer_name": "Ingenico", "model_name": "Move 5000"}
    headers = {"X-Admin-Key": ADMIN_KEY}

    assert client.post("/api/admin/device_models", json=body, headers=headers).status_code == 201
    duplicate = client.post("/api/admin/device_models", json=body, headers=headers)

    assert duplicate.status_code == 409
    assert equipment_catalog_db.query(DeviceModel).count() == 1


def test_version_details_require_a_version_label(equipment_catalog_db):
    response = client.post(
        "/api/admin/device_models",
        json={
            "device_type": "tpe",
            "manufacturer_name": "Ingenico",
            "model_name": "Move 5000",
            "hardware_rev": "Rev. A",
        },
        headers={"X-Admin-Key": ADMIN_KEY},
    )

    assert response.status_code == 422
