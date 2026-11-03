"""
Réglages communs à tous les tests Python du chatbot.

Le chatbot lit le fichier .env (app/core/config.py). Si ce fichier contient
ATM_CHATBOT_GATEWAY_SHARED_SECRET (déploiement avec l'Espace techniciens), l'API
refuserait toute requête de test qui ne vient pas du gateway (401). Les tests
partent donc toujours SANS secret ; ceux qui vérifient ce mécanisme le
définissent eux-mêmes (tests/test_gateway_identity.py).
"""

import pytest

from app.core.config import settings


@pytest.fixture(autouse=True)
def api_without_gateway_secret(monkeypatch):
    monkeypatch.setattr(settings, "atm_chatbot_gateway_shared_secret", "")
