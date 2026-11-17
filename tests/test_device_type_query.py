"""Validation HTTP de device_type sur les menus, sans acces a la base."""

from unittest.mock import Mock, sentinel

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import error_code, usual_problem
from app.core.database import get_db


@pytest.fixture(params=[
    (error_code, "list_error_codes_with_reply"),
    (usual_problem, "list_usual_problems"),
], ids=["error_code", "usual_problem"])
def menu(request, monkeypatch):
    module, service_name = request.param
    service = Mock(return_value=[])
    monkeypatch.setattr(module, service_name, service)
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[get_db] = lambda: sentinel.db
    with TestClient(app) as client:
        yield client, module.router.prefix, service


@pytest.mark.parametrize(("value", "normalized"), [
    ("gab", "gab"),
    ("tpe", "tpe"),
    ("GAB", "gab"),
    ("TPE", "tpe"),
    ("GaB", "gab"),
    ("TpE", "tpe"),
    (" GAB ", "gab"),
    ("\tTPE\n", "tpe"),
])
def test_device_type_normalise_avant_appel_service(menu, value, normalized):
    client, path, service = menu
    response = client.get(path, params={"device_type": value})
    assert response.status_code == 200
    assert response.json() == []
    service.assert_called_once_with(sentinel.db, normalized)


@pytest.mark.parametrize("value", ["xyz", "", "   ", "gab,tpe", "123"])
def test_device_type_invalide_refuse_sans_appel_service(menu, value):
    client, path, service = menu
    response = client.get(path, params={"device_type": value})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "device_type"]
    service.assert_not_called()


def test_device_type_requis(menu):
    client, path, service = menu
    response = client.get(path)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "device_type"]
    service.assert_not_called()


def test_device_type_contrat_openapi(menu):
    client, path, _ = menu
    parameters = client.get("/openapi.json").json()["paths"][path]["get"]["parameters"]
    parameter = next(item for item in parameters if item["name"] == "device_type")
    assert parameter["in"] == "query"
    assert parameter["required"] is True
    assert parameter["schema"]["enum"] == ["gab", "tpe"]
