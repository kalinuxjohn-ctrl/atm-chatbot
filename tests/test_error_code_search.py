"""
Tests de l'endpoint GET /api/error_code/search contre une vraie base
(DATABASE_URL de l'environnement de test), faute de convention de test
existante dans le projet à reprendre.
"""

from sqlalchemy import text

from app.core.database import SessionLocal
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _inserer_donnees_test(db):
    db.execute(text("INSERT INTO fault (fault_id, code, name) VALUES (9001, 'P001', 'Surchauffe moteur') ON CONFLICT DO NOTHING"))
    db.execute(text("""
        INSERT INTO error_code (error_code_id, code, description, fault_id)
        VALUES (9001, 'E42', 'Code test', 9001)
        ON CONFLICT DO NOTHING
    """))
    db.commit()


def _nettoyer_donnees_test(db):
    db.execute(text("DELETE FROM error_code WHERE error_code_id = 9001"))
    db.execute(text("DELETE FROM fault WHERE fault_id = 9001"))
    db.commit()


def test_recherche_exacte():
    db = SessionLocal()
    _inserer_donnees_test(db)
    try:
        response = client.get("/api/error_code/search", params={"q": "E42"})
        assert response.status_code == 200
        body = response.json()
        assert body["query"] == "E42"
        assert len(body["results"]) == 1
        assert body["results"][0]["code"] == "E42"
        assert body["results"][0]["fault"]["name"] == "Surchauffe moteur"
    finally:
        _nettoyer_donnees_test(db)
        db.close()


def test_recherche_partielle():
    db = SessionLocal()
    _inserer_donnees_test(db)
    try:
        response = client.get("/api/error_code/search", params={"q": "E4"})
        assert response.status_code == 200
        assert len(response.json()["results"]) == 1
    finally:
        _nettoyer_donnees_test(db)
        db.close()


def test_recherche_insensible_a_la_casse():
    db = SessionLocal()
    _inserer_donnees_test(db)
    try:
        response = client.get("/api/error_code/search", params={"q": "e42"})
        assert response.status_code == 200
        assert len(response.json()["results"]) == 1
    finally:
        _nettoyer_donnees_test(db)
        db.close()


def test_recherche_aucun_resultat_renvoie_liste_vide():
    response = client.get("/api/error_code/search", params={"q": "ZZZ999"})
    assert response.status_code == 200
    assert response.json()["results"] == []