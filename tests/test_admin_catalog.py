"""
Tests des routes d'administration des réponses enregistrées :
/api/admin/error_code et /api/admin/usual_problem (clé X-Admin-Key).
Contre une vraie base (DATABASE_URL), comme test_error_code_search.py.
"""

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
ADMIN_KEY = "cle-de-test"
HEADERS = {"X-Admin-Key": ADMIN_KEY}


@pytest.fixture(autouse=True)
def cle_admin_et_nettoyage(monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", ADMIN_KEY)
    yield
    db = SessionLocal()
    db.execute(text("DELETE FROM error_code WHERE code LIKE 'ZADM%'"))
    db.execute(text("DELETE FROM usual_problem WHERE label LIKE 'Panne admin test%'"))
    db.commit()
    db.close()


def test_cle_admin_obligatoire():
    assert client.get("/api/admin/error_code").status_code == 403
    assert client.get("/api/admin/usual_problem", headers={"X-Admin-Key": "mauvaise"}).status_code == 403


def test_cycle_complet_code_erreur():
    created = client.post(
        "/api/admin/error_code",
        json={"code": "ZADM1", "label": "Test admin", "device_type": "gab", "reply": "Étape 1\nÉtape 2"},
        headers=HEADERS,
    )
    assert created.status_code == 201
    error_code_id = created.json()["id"]

    # Visible dans le menu du Copilote, avec sa solution.
    assert "ZADM1" in [item["code"] for item in client.get("/api/error_code", params={"device_type": "gab"}).json()]
    assert client.get(f"/api/error_code/{error_code_id}/solution").json()["reply"] == "Étape 1\nÉtape 2"

    # Réponse vidée : le code sort du menu mais reste en base.
    updated = client.put(
        f"/api/admin/error_code/{error_code_id}",
        json={"code": "ZADM1", "label": "Test admin", "device_type": "gab", "reply": ""},
        headers=HEADERS,
    )
    assert updated.status_code == 200
    assert updated.json()["reply"] is None
    assert "ZADM1" not in [item["code"] for item in client.get("/api/error_code", params={"device_type": "gab"}).json()]

    assert client.delete(f"/api/admin/error_code/{error_code_id}", headers=HEADERS).json() == {"deleted": error_code_id}
    assert client.get(f"/api/error_code/{error_code_id}/solution").status_code == 404


def test_code_erreur_en_double_refuse():
    client.post("/api/admin/error_code", json={"code": "ZADM2"}, headers=HEADERS)
    assert client.post("/api/admin/error_code", json={"code": "zadm2"}, headers=HEADERS).status_code == 409


def test_reponse_sans_equipement_refusee():
    response = client.post("/api/admin/error_code", json={"code": "ZADM3", "reply": "x"}, headers=HEADERS)
    assert response.status_code == 422


def test_cycle_complet_panne_frequente():
    first = client.post(
        "/api/admin/usual_problem",
        json={"device_type": "tpe", "label": "Panne admin test 1", "reply": "R1"},
        headers=HEADERS,
    ).json()
    second = client.post(
        "/api/admin/usual_problem",
        json={"device_type": "tpe", "label": "Panne admin test 2", "reply": "R2"},
        headers=HEADERS,
    ).json()
    # Sans ordre précisé : ajoutée en fin de menu.
    assert second["display_order"] > first["display_order"]

    moved = client.put(
        f"/api/admin/usual_problem/{second['id']}",
        json={"device_type": "tpe", "label": "Panne admin test 2", "reply": "R2 modifiée", "display_order": 0},
        headers=HEADERS,
    )
    assert moved.status_code == 200
    labels = [item["label"] for item in client.get("/api/usual_problem", params={"device_type": "tpe"}).json()]
    assert labels.index("Panne admin test 2") < labels.index("Panne admin test 1")
    assert client.get(f"/api/usual_problem/{second['id']}/solution").json()["reply"] == "R2 modifiée"

    assert client.delete(f"/api/admin/usual_problem/{first['id']}", headers=HEADERS).status_code == 200
    assert client.delete(f"/api/admin/usual_problem/{first['id']}", headers=HEADERS).status_code == 404
