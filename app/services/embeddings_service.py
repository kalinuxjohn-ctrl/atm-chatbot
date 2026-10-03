"""
Générateur d'embeddings pour la recherche sémantique.

Le modèle d'embedding transforme un texte en vecteur numérique.
La recherche sémantique compare ensuite ces vecteurs avec pgvector.

Structuré en interface (EmbeddingProvider) + implémentation (VoyageProvider),
même principe que LLMProvider dans llm_service.py : un futur changement de
fournisseur se fait en ajoutant une classe ici, sans toucher à
retrieval_service.py, case_retrieval_service.py ou seed_demo_data.py -- ils
n'appellent jamais un provider directement, seulement generate_embedding(),
dont la signature ne change pas.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from time import perf_counter
from typing import Sequence

import requests

from app.core.config import settings
from app.core.tracing import trace


logger = logging.getLogger(__name__)


DEFAULT_VOYAGE_MODEL_NAME = "voyage-3-large"


def _clean_text(raw_text: str | None) -> str:
    """Nettoie et normalise un texte avant sa vectorisation."""
    if raw_text is None:
        return ""
    return re.sub(r"\s+", " ", raw_text).strip()


class EmbeddingProvider(ABC):
    """Interface commune à tout fournisseur d'embedding."""

    @abstractmethod
    def embed(self, cleaned_text: str, is_query: bool) -> list[float]:
        """Renvoie le vecteur d'embedding, ou lève une exception avec un message clair."""


class VoyageProvider(EmbeddingProvider):
    """
    Appelle l'API Voyage AI (fournisseur d'embeddings recommandé par
    Anthropic). output_dimension doit être une des valeurs supportées par
    le modèle choisi (256/512/1024/2048 pour voyage-3-large) -- doit
    correspondre à settings.embedding_dimensions / la colonne pgvector.
    """

    _ENDPOINT = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, api_key: str, model_name: str, output_dimension: int, timeout: int = 30):
        self.api_key = api_key
        self.model_name = model_name
        self.output_dimension = output_dimension
        self.timeout = timeout

    def embed(self, cleaned_text: str, is_query: bool) -> list[float]:
        if not self.api_key:
            raise RuntimeError("Aucune clé API Voyage configurée (VOYAGE_API_KEY).")

        try:
            response = requests.post(
                self._ENDPOINT,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={
                    "input": [cleaned_text],
                    "model": self.model_name,
                    "input_type": "query" if is_query else "document",
                    "output_dimension": self.output_dimension,
                },
                timeout=self.timeout,
            )
        except requests.ConnectionError as erreur:
            raise RuntimeError("Impossible de joindre l'API Voyage -- vérifiez la connexion réseau.") from erreur
        except requests.Timeout as erreur:
            raise RuntimeError(f"Voyage n'a pas répondu dans le délai imparti ({self.timeout}s).") from erreur

        if response.status_code == 401:
            raise RuntimeError("Clé API Voyage invalide ou expirée.")
        if response.status_code == 429:
            raise RuntimeError("Limite de requêtes Voyage atteinte -- réessayez plus tard.")
        try:
            response.raise_for_status()
        except requests.HTTPError as erreur:
            raise RuntimeError(f"Voyage a répondu avec une erreur ({response.status_code}).") from erreur

        payload = response.json()
        try:
            return payload["data"][0]["embedding"]
        except (KeyError, IndexError) as erreur:
            raise RuntimeError("Voyage n'a renvoyé aucun embedding exploitable pour cette requête.") from erreur


def _resolve_provider(model_name_override: str | None) -> tuple[EmbeddingProvider, str]:
    """
    Point d'extension unique : brancher un nouveau fournisseur d'embedding
    plus tard se fait ici (ajouter une classe + une branche), jamais en
    modifiant generate_embedding() ou ses appelants.

    Une valeur de settings.embedding_provider autre que "voyage" (ex. un
    vieux ".env" qui garde "solon") est une erreur de configuration
    explicite, pas un retour silencieux vers un comportement différent.
    """
    provider_name = settings.embedding_provider or "voyage"

    if provider_name != "voyage":
        raise RuntimeError(
            f"Fournisseur d'embedding inconnu ou plus supporté : '{provider_name}'. "
            f"Seule valeur valide : 'voyage'."
        )

    selected_model = model_name_override or settings.voyage_model or DEFAULT_VOYAGE_MODEL_NAME
    return (
        VoyageProvider(
            api_key=settings.voyage_api_key,
            model_name=selected_model,
            output_dimension=settings.embedding_dimensions,
        ),
        selected_model,
    )


def _validate_dimensions(vector: Sequence[float], expected_dimensions: int) -> None:
    """
    Vérifie que la dimension du vecteur correspond à celle attendue.

    Un embedding ne doit pas être complété ou tronqué artificiellement :
    une différence de dimension indique une incompatibilité de configuration.
    """
    actual_dimensions = len(vector)

    if actual_dimensions != expected_dimensions:
        trace(
            "ERROR",
            "Dimension d'embedding incompatible",
            expected_dimensions=expected_dimensions,
            actual_dimensions=actual_dimensions,
        )
        raise ValueError(
            "Dimension d'embedding incompatible : "
            f"le modèle produit {actual_dimensions} dimensions, "
            f"mais {expected_dimensions} sont configurées."
        )


def generate_embedding(
    raw_text: str | None,
    model_name: str | None = None,
    dimensions: int | None = None,
    is_query: bool = False,
) -> list[float]:
    """
    Génère un embedding normalisé pour un texte, via le fournisseur actif
    (settings.embedding_provider).

    is_query=True indique une requête de recherche plutôt qu'un document
    stocké (input_type="query" pour Voyage).

    Une erreur du moteur d'embedding est propagée afin de ne pas masquer
    une panne ou une mauvaise configuration derrière un faux embedding.
    """
    vector_dimensions = dimensions or settings.embedding_dimensions or 1024
    cleaned_text = _clean_text(raw_text)

    trace(
        "PROCESSING",
        "Texte préparé pour l'embedding",
        input_length=len(raw_text) if raw_text is not None else 0,
        cleaned_length=len(cleaned_text),
    )

    if not cleaned_text:
        logger.warning("[EMBEDDING] Texte vide : génération d'un vecteur nul")
        vector = [0.0] * vector_dimensions
        trace("EMBEDDING", "Vecteur nul généré pour un texte vide", dimensions=len(vector))
        return vector

    provider, selected_model = _resolve_provider(model_name)

    trace(
        "EMBEDDING",
        "Génération de l'embedding démarrée",
        provider=settings.embedding_provider,
        model=selected_model,
        is_query=is_query,
    )

    started_at = perf_counter()
    try:
        vector = provider.embed(cleaned_text, is_query)
    except Exception as error:
        trace(
            "ERROR",
            "Échec de la génération de l'embedding",
            provider=settings.embedding_provider,
            model=selected_model,
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
            error_type=type(error).__name__,
        )
        raise RuntimeError(f"Impossible de générer l'embedding avec le modèle '{selected_model}'.") from error

    _validate_dimensions(vector, vector_dimensions)

    trace(
        "EMBEDDING",
        "Embedding généré",
        dimensions=len(vector),
        provider=settings.embedding_provider,
        model=selected_model,
        duration_ms=round((perf_counter() - started_at) * 1000, 2),
    )

    return vector


# Alias conservé pour les appels existants.
embed_text = generate_embedding