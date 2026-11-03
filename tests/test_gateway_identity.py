"""
Identité transmise par le gateway de l'Espace techniciens (app/core/gateway_identity.py).
Aucune base nécessaire : les routes utilisées ne la touchent pas.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.gateway_identity import effective_technician_id
from app.main import app

client = TestClient(app)
SECRET = "secret-de-test-du-gateway-0123456789"
ROUTE_WITHOUT_DATABASE = "/api/chat/photo-ocr"


@pytest.fixture
def secret_configure(monkeypatch):
    monkeypatch.setattr(settings, "copilot_gateway_shared_secret", SECRET)


def test_sans_secret_configure_rien_ne_change(monkeypatch):
    monkeypatch.setattr(settings, "copilot_gateway_shared_secret", "")
    assert client.get(ROUTE_WITHOUT_DATABASE).status_code == 200


def test_requete_sans_identite_refusee(secret_configure):
    response = client.get(ROUTE_WITHOUT_DATABASE)
    assert response.status_code == 401
    assert "Espace techniciens" in response.json()["detail"]


def test_mauvais_secret_refuse(secret_configure):
    headers = {"X-Copilot-Gateway-Secret": "devine", "X-Authenticated-Technician-Id": "7"}
    assert client.get(ROUTE_WITHOUT_DATABASE, headers=headers).status_code == 401


def test_bon_secret_sans_technicien_refuse(secret_configure):
    headers = {"X-Copilot-Gateway-Secret": SECRET, "X-Authenticated-Technician-Id": "abc"}
    assert client.get(ROUTE_WITHOUT_DATABASE, headers=headers).status_code == 401


def test_requete_du_gateway_acceptee(secret_configure):
    headers = {"X-Copilot-Gateway-Secret": SECRET, "X-Authenticated-Technician-Id": "7"}
    assert client.get(ROUTE_WITHOUT_DATABASE, headers=headers).status_code == 200


def test_sante_et_admin_ne_demandent_pas_l_identite(secret_configure, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", "cle-admin")
    assert client.get("/health").status_code == 200
    # /api/admin/ garde sa propre protection (clé X-Admin-Key) : 403, pas 401.
    assert client.get("/api/admin/error_code").status_code == 403


def test_le_technicien_de_la_session_remplace_celui_annonce():
    request_from_gateway = SimpleNamespace(state=SimpleNamespace(authenticated_technician_id=7))
    request_without_gateway = SimpleNamespace(state=SimpleNamespace(authenticated_technician_id=None))
    assert effective_technician_id(request_from_gateway, claimed_technician_id=99) == 7
    assert effective_technician_id(request_without_gateway, claimed_technician_id=99) == 99
