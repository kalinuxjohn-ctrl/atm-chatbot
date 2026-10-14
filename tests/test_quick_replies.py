"""
Tests des réponses enregistrées des menus de suggestions (migration 0011) :
GET /api/error_code?device_type=..., /api/error_code/{id}/solution,
GET /api/usual_problem?device_type=..., /api/usual_problem/{id}/solution.
Contre une vraie base (DATABASE_URL), comme test_error_code_search.py.
"""

from sqlalchemy import text

from app.core.database import SessionLocal
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _inserer_donnees_test(db):
    db.execute(text("""
        INSERT INTO error_code (error_code_id, code, description, device_type, reply) VALUES
            (9101, 'ZT1', 'Code TPE test', 'tpe', 'Ligne 1\nLigne 2'),
            (9102, 'ZT2', 'Code TPE sans réponse', 'tpe', NULL)
        ON CONFLICT DO NOTHING
    """))
    db.execute(text("""
        INSERT INTO usual_problem (usual_problem_id, device_type, label, reply, display_order) VALUES
            (9101, 'tpe', 'Panne test B', 'Réponse B', 2),
            (9102, 'tpe', 'Panne test A', 'Réponse A', 1),
            (9103, 'gab', 'Panne test GAB', 'Réponse GAB', 1)
        ON CONFLICT DO NOTHING
    """))
    db.commit()


def _nettoyer_donnees_test(db):
    db.execute(text("DELETE FROM error_code WHERE error_code_id IN (9101, 9102)"))
    db.execute(text("DELETE FROM usual_problem WHERE usual_problem_id IN (9101, 9102, 9103)"))
    db.commit()


def _avec_donnees_test(test):
    def wrapper():
        db = SessionLocal()
        _inserer_donnees_test(db)
        try:
            test()
        finally:
            _nettoyer_donnees_test(db)
            db.close()
    return wrapper


@_avec_donnees_test
def test_codes_erreur_connus_filtres_par_equipement_et_reponse():
    response = client.get("/api/error_code", params={"device_type": "TPE"})
    assert response.status_code == 200
    codes = [item["code"] for item in response.json()]
    assert "ZT1" in codes
    assert "ZT2" not in codes  # pas de réponse enregistrée
    assert all(item["code"] not in ("ZT1", "ZT2") for item in client.get("/api/error_code", params={"device_type": "gab"}).json())


@_avec_donnees_test
def test_reponse_code_erreur():
    response = client.get("/api/error_code/9101/solution")
    assert response.status_code == 200
    assert response.json() == {"id": 9101, "code": "ZT1", "label": "Code TPE test", "reply": "Ligne 1\nLigne 2"}


@_avec_donnees_test
def test_reponse_code_erreur_absente_renvoie_404():
    assert client.get("/api/error_code/9102/solution").status_code == 404
    assert client.get("/api/error_code/999999/solution").status_code == 404


@_avec_donnees_test
def test_recherche_classique_toujours_disponible():
    response = client.get("/api/error_code/search", params={"q": "ZT"})
    assert response.status_code == 200
    assert {item["code"] for item in response.json()["results"]} >= {"ZT1", "ZT2"}


@_avec_donnees_test
def test_pannes_frequentes_dans_l_ordre_d_affichage():
    response = client.get("/api/usual_problem", params={"device_type": "tpe"})
    assert response.status_code == 200
    labels = [item["label"] for item in response.json()]
    assert labels.index("Panne test A") < labels.index("Panne test B")
    assert "Panne test GAB" not in labels


@_avec_donnees_test
def test_reponse_panne_frequente():
    response = client.get("/api/usual_problem/9102/solution")
    assert response.status_code == 200
    assert response.json() == {"id": 9102, "label": "Panne test A", "reply": "Réponse A"}
    assert client.get("/api/usual_problem/999999/solution").status_code == 404


def test_device_type_invalide_refuse():
    assert client.get("/api/usual_problem", params={"device_type": "xyz"}).status_code == 422
    assert client.get("/api/error_code").status_code == 422
