"""
Générateur d'embeddings pour la recherche sémantique.

Le modèle d'embedding transforme un texte en vecteur numérique.
La recherche sémantique compare ensuite ces vecteurs avec pgvector.

Structuré en interface (EmbeddingProvider) + implémentation (VoyageProvider),
même principe que LLMProvider dans llm_service.py : un futur changement de
fournisseur se fait en ajoutant une classe ici, sans toucher à
retrieval_service.py, case_retrieval_service.py ou seed_demo_data.py -- ils
n'appellent jamais un provider directement, seulement generate_embedding()
(ou generate_embeddings_batch() pour plusieurs textes d'un coup), dont les
signatures ne changent pas.
"""

from __future__ import annotations

import logging
import re
import time
from abc import ABC, abstractmethod
from functools import lru_cache
from time import perf_counter
from typing import Sequence

import requests

from app.core.config import settings
from app.core.errors import ExternalServiceUnavailableError
from app.core.tracing import trace


logger = logging.getLogger(__name__)


DEFAULT_VOYAGE_MODEL_NAME = "voyage-3-large"

# Palier gratuit Voyage sans moyen de paiement = 3 requêtes/minute (vérifié
# dans la doc Voyage). Sur un 429, on attend puis on réessaie plutôt que
# d'abandonner tout de suite -- utile pour le seed (plusieurs textes à la
# suite) comme en usage réel (deux recherches rapprochées).
_MAX_RETRIES_ON_RATE_LIMIT = 3
_RETRY_WAIT_SECONDS = 22  # un peu plus que 60s/3RPM, marge de sécurité
# Erreurs serveur passagères (5xx) : on réessaie aussi, mais sans attendre
# aussi longtemps qu'après un 429.
_RETRY_WAIT_SECONDS_ON_SERVER_ERROR = 2

# Nombre de vecteurs de RECHERCHE gardés en mémoire : une même phrase est
# souvent vectorisée plusieurs fois au cours d'une seule requête
# (cas similaires puis repli sur les stats, rattachement au catalogue...),
# et chaque appel compte dans le quota Voyage.
_QUERY_CACHE_SIZE = 256


class EmbeddingUnavailableError(ExternalServiceUnavailableError):
    """
    Impossible d'obtenir un embedding (réseau, clé, quota...). Hérite de
    RuntimeError (via ExternalServiceUnavailableError) : les appelants qui
    attrapaient déjà RuntimeError continuent de fonctionner.
    """


def _clean_text(raw_text: str | None) -> str:
    """Nettoie et normalise un texte avant sa vectorisation."""
    if raw_text is None:
        return ""
    return re.sub(r"\s+", " ", raw_text).strip()


class EmbeddingProvider(ABC):
    """Interface commune à tout fournisseur d'embedding."""

    @abstractmethod
    def embed(self, cleaned_text: str, is_query: bool) -> list[float]:
        """Renvoie le vecteur d'embedding d'un seul texte."""

    def embed_batch(self, cleaned_texts: list[str], is_query: bool) -> list[list[float]]:
        """
        Plusieurs textes en un coup. Par défaut, un appel par texte (marche
        pour n'importe quel provider sans effort) -- les providers qui
        supportent un vrai appel groupé (Voyage) redéfinissent cette
        méthode pour économiser des requêtes, ce qui compte énormément sur
        un palier à 3 requêtes/minute.
        """
        return [self.embed(text, is_query) for text in cleaned_texts]


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
        return self._request_embeddings([cleaned_text], is_query)[0]

    def embed_batch(self, cleaned_texts: list[str], is_query: bool) -> list[list[float]]:
        return self._request_embeddings(cleaned_texts, is_query)

    def _request_embeddings(self, texts: list[str], is_query: bool) -> list[list[float]]:
        if not self.api_key:
            raise RuntimeError("Aucune clé API Voyage configurée (VOYAGE_API_KEY).")

        for tentative in range(1, _MAX_RETRIES_ON_RATE_LIMIT + 1):
            try:
                response = requests.post(
                    self._ENDPOINT,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={
                        "input": texts,
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
            except requests.RequestException as erreur:
                raise RuntimeError(f"Erreur réseau lors de l'appel Voyage ({type(erreur).__name__}).") from erreur

            if response.status_code == 429:
                if tentative == _MAX_RETRIES_ON_RATE_LIMIT:
                    raise RuntimeError(
                        f"Limite de requêtes Voyage atteinte, {_MAX_RETRIES_ON_RATE_LIMIT} tentatives épuisées."
                    )
                trace(
                    "EMBEDDING",
                    "Limite Voyage atteinte, nouvelle tentative après attente",
                    attempt=tentative,
                    wait_seconds=_RETRY_WAIT_SECONDS,
                )
                time.sleep(_RETRY_WAIT_SECONDS)
                continue

            if response.status_code >= 500 and tentative < _MAX_RETRIES_ON_RATE_LIMIT:
                trace(
                    "EMBEDDING",
                    "Erreur serveur Voyage, nouvelle tentative",
                    attempt=tentative,
                    status_code=response.status_code,
                )
                time.sleep(_RETRY_WAIT_SECONDS_ON_SERVER_ERROR)
                continue

            if response.status_code == 401:
                raise RuntimeError("Clé API Voyage invalide ou expirée.")
            try:
                response.raise_for_status()
            except requests.HTTPError as erreur:
                raise RuntimeError(f"Voyage a répondu avec une erreur ({response.status_code}).") from erreur

            try:
                payload = response.json()
                # L'API renvoie les résultats dans "index" croissant --
                # trié explicitement pour garantir le même ordre que `texts`,
                # plutôt que de supposer que la réponse arrive déjà triée.
                ordered = sorted(payload["data"], key=lambda item: item["index"])
                vectors = [item["embedding"] for item in ordered]
            except (ValueError, KeyError, IndexError, TypeError) as erreur:
                raise RuntimeError("Voyage n'a renvoyé aucun embedding exploitable pour cette requête.") from erreur
            if len(vectors) != len(texts):
                raise RuntimeError(
                    f"Voyage a renvoyé {len(vectors)} embedding(s) pour {len(texts)} texte(s) envoyé(s)."
                )
            return vectors

        raise RuntimeError("Échec inattendu de l'appel Voyage.")  # ne devrait jamais être atteint


def _resolve_provider(model_name_override: str | None) -> tuple[EmbeddingProvider, str]:
    """
    Point d'extension unique : brancher un nouveau fournisseur d'embedding
    plus tard se fait ici (ajouter une classe + une branche), jamais en
    modifiant generate_embedding()/generate_embeddings_batch() ou leurs
    appelants.
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

    Pour plusieurs textes à la suite (ex. le seed de démonstration),
    préférer generate_embeddings_batch() : un seul appel réseau au lieu
    d'un par texte, ce qui compte énormément sur un palier gratuit limité
    en requêtes par minute.
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

    selected_model = model_name or settings.voyage_model or DEFAULT_VOYAGE_MODEL_NAME

    trace(
        "EMBEDDING",
        "Génération de l'embedding démarrée",
        provider=settings.embedding_provider,
        model=selected_model,
        is_query=is_query,
    )

    started_at = perf_counter()
    try:
        if is_query:
            # Copie : l'appelant ne doit jamais pouvoir modifier le vecteur gardé en cache.
            vector = list(_cached_query_embedding(cleaned_text, model_name))
        else:
            provider, _ = _resolve_provider(model_name)
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
        raise EmbeddingUnavailableError(
            f"Impossible de générer l'embedding avec le modèle '{selected_model}' : {error}"
        ) from error

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


def generate_embeddings_batch(
    raw_texts: list[str],
    model_name: str | None = None,
    dimensions: int | None = None,
    is_query: bool = False,
) -> list[list[float]]:
    """
    Même chose que generate_embedding(), mais pour plusieurs textes en UN
    SEUL appel réseau (quand le provider le permet -- voir
    EmbeddingProvider.embed_batch). Pensé pour le seed de démonstration et
    tout futur traitement par lot, pas pour une recherche technicien
    unitaire (qui reste generate_embedding()).
    """
    vector_dimensions = dimensions or settings.embedding_dimensions or 1024
    cleaned_texts = [_clean_text(text) for text in raw_texts]
    if not cleaned_texts:
        return []

    # Même règle que generate_embedding() : un texte vide donne un vecteur
    # nul, sans être envoyé au fournisseur (qui refuserait tout le lot).
    non_empty_positions = [index for index, text in enumerate(cleaned_texts) if text]
    if not non_empty_positions:
        return [[0.0] * vector_dimensions for _ in cleaned_texts]

    provider, selected_model = _resolve_provider(model_name)

    trace(
        "EMBEDDING",
        "Génération groupée d'embeddings démarrée",
        provider=settings.embedding_provider,
        model=selected_model,
        text_count=len(cleaned_texts),
        is_query=is_query,
    )

    started_at = perf_counter()
    try:
        computed = provider.embed_batch([cleaned_texts[index] for index in non_empty_positions], is_query)
    except Exception as error:
        trace(
            "ERROR",
            "Échec de la génération groupée d'embeddings",
            provider=settings.embedding_provider,
            model=selected_model,
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
            error_type=type(error).__name__,
        )
        raise EmbeddingUnavailableError(
            f"Impossible de générer les embeddings avec le modèle '{selected_model}' : {error}"
        ) from error

    vectors: list[list[float]] = [[0.0] * vector_dimensions for _ in cleaned_texts]
    for index, vector in zip(non_empty_positions, computed):
        vectors[index] = vector

    for vector in vectors:
        _validate_dimensions(vector, vector_dimensions)

    trace(
        "EMBEDDING",
        "Embeddings groupés générés",
        text_count=len(vectors),
        provider=settings.embedding_provider,
        model=selected_model,
        duration_ms=round((perf_counter() - started_at) * 1000, 2),
    )

    return vectors


@lru_cache(maxsize=_QUERY_CACHE_SIZE)
def _cached_query_embedding(cleaned_text: str, model_name: str | None) -> tuple[float, ...]:
    """
    Vecteur de recherche mis en cache (tuple immuable). Une exception n'est
    jamais mise en cache par lru_cache : un échec réseau sera bien retenté
    au prochain appel.
    """
    provider, _ = _resolve_provider(model_name)
    return tuple(provider.embed(cleaned_text, True))


# Alias conservé pour les appels existants.
embed_text = generate_embedding