"""
Générateur d'embeddings pour la recherche sémantique.

Le modèle d'embedding transforme un texte en vecteur numérique.
La recherche sémantique compare ensuite ces vecteurs avec pgvector.

Le modèle est configurable afin de pouvoir changer de modèle sans modifier
les services qui utilisent generate_embedding().
"""

from __future__ import annotations

import logging
import re 
from time import perf_counter
from functools import lru_cache
from typing import Sequence

from app.core.config import settings
from app.core.tracing import trace


logger = logging.getLogger(__name__)


# Modèle utilisé si aucun modèle n'est défini dans la configuration.
DEFAULT_MODEL_NAME = "OrdalieTech/Solon-embeddings-base-0.1"

# Préfixe utilisé par Solon pour les textes soumis comme requêtes.
QUERY_PREFIX = "query : "


def _clean_text(raw_text: str | None) -> str:
    """Nettoie et normalise un texte avant sa vectorisation."""
    if raw_text is None:
        return ""

    return re.sub(r"\s+", " ", raw_text).strip()


@lru_cache(maxsize=4)
def _get_encoder(model_name: str):
    """
    Charge un modèle d'embedding une seule fois par nom.

    Le modèle reste ensuite en mémoire afin d'éviter de recharger ses poids
    à chaque recherche.
    """
    logger.info("[EMBEDDING] Chargement du modèle : %s", model_name)

    from sentence_transformers import SentenceTransformer

    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        device = "cpu"

    logger.info("[EMBEDDING] Appareil utilisé : %s", device)

    try:
        encoder = SentenceTransformer(model_name, device=device)
    except Exception as error:
        trace(
            "ERROR",
            "Impossible de charger le modèle d'embedding",
            model=model_name,
            error_type=type(error).__name__,
        )
        logger.error(
            "[EMBEDDING][ERREUR] Impossible de charger le modèle : %s",
            model_name,
        )
        raise RuntimeError(
            f"Impossible de charger le modèle d'embedding '{model_name}'."
        ) from error

    logger.info(
        "[EMBEDDING] Modèle chargé avec succès : %s",
        model_name,
    )

    return encoder


def _get_model_name(model_name: str | None) -> str:
    """Retourne le modèle configuré ou le modèle par défaut."""
    return model_name or settings.embedding_model_name or DEFAULT_MODEL_NAME


def _validate_dimensions(
    vector: Sequence[float],
    expected_dimensions: int,
) -> None:
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
        logger.error(
            "[EMBEDDING][ERREUR] Dimension incorrecte : "
            "attendu=%s, obtenu=%s",
            expected_dimensions,
            actual_dimensions,
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
    Génère un embedding normalisé pour un texte.

    is_query=True ajoute le préfixe attendu par les modèles utilisant
    une distinction entre requêtes et documents.

    Une erreur du moteur d'embedding est propagée afin de ne pas masquer
    une panne ou une mauvaise configuration derrière un faux embedding.
    """
    logger.info("[EMBEDDING] Réception du texte à vectoriser")

    vector_dimensions = dimensions or settings.embedding_dimensions or 1024
    cleaned_text = _clean_text(raw_text)
    trace(
        "PROCESSING",
        "Texte préparé pour l'embedding",
        input_length=len(raw_text) if raw_text is not None else 0,
        cleaned_length=len(cleaned_text),
    )

    if not cleaned_text:
        logger.warning(
            "[EMBEDDING] Texte vide : génération d'un vecteur nul"
        )
        vector = [0.0] * vector_dimensions
        trace(
            "EMBEDDING",
            "Vecteur nul généré pour un texte vide",
            dimensions=len(vector),
        )
        return vector

    logger.info(
        "[EMBEDDING] Texte préparé - longueur : %s caractères",
        len(cleaned_text),
    )

    if is_query:
        cleaned_text = f"{QUERY_PREFIX}{cleaned_text}"
        logger.info("[EMBEDDING] Mode recherche activé")

    selected_model = _get_model_name(model_name)

    logger.info(
        "[EMBEDDING] Modèle sélectionné : %s",
        selected_model,
    )

    logger.info(
        "[EMBEDDING] Génération de l'embedding..."
    )
    trace(
        "EMBEDDING",
        "Génération de l'embedding démarrée",
        model=selected_model,
        is_query=is_query,
    )

    encoder = _get_encoder(selected_model)
    started_at = perf_counter()

    try:
        vector = encoder.encode(
            cleaned_text,
            normalize_embeddings=True,
        )
    except Exception as error:
        trace(
            "ERROR",
            "Échec de la génération de l'embedding",
            model=selected_model,
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
            error_type=type(error).__name__,
        )
        logger.error(
            "[EMBEDDING][ERREUR] Échec de la génération avec le modèle : %s",
            selected_model,
        )

        raise RuntimeError(
            f"Impossible de générer l'embedding avec le modèle "
            f"'{selected_model}'."
        ) from error

    vector = vector.tolist()

    _validate_dimensions(vector, vector_dimensions)

    logger.info(
        "[EMBEDDING] Embedding généré avec succès - dimensions : %s",
        len(vector),
    )
    trace(
        "EMBEDDING",
        "Embedding généré",
        dimensions=len(vector),
        model=selected_model,
        duration_ms=round((perf_counter() - started_at) * 1000, 2),
    )

    return vector


# Alias conservé pour les appels existants.
embed_text = generate_embedding