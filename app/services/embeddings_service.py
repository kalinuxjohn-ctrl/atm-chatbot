"""
Générateur d'embeddings (vectorisation de texte) pour la recherche sémantique.

Comment ça marche, en une phrase : un modèle de réseau de neurones
(SentenceTransformer) lit une phrase et la transforme en une liste de
nombres (un vecteur) telle que deux phrases proches en sens ont des vecteurs
proches géométriquement. C'est CE modèle qui fait tout le travail de
compréhension du langage -- retrieval_service.py ne fait ensuite qu'une
comparaison mathématique (cosinus) entre vecteurs, aucune compréhension du
texte ne s'y passe.

Le choix du modèle a donc un impact DIRECT sur la qualité de toute la
recherche par symptôme, indépendamment du reste du code :
- Un modèle entraîné sur la mauvaise langue rapprochera des phrases qui ne
  se ressemblent pas vraiment (et inversement), quelle que soit la qualité
  du SQL autour. Les techniciens écrivant en français, on utilise ici
  **Solon-embeddings-large-0.1** (OrdalieTech), un modèle spécialisé
  français : à ce jour l'un des meilleurs modèles d'embeddings open-source
  pour le français (meilleur score que CamemBERT-large ou même
  cohere/embed-multilingual-v3 sur les benchmarks français publiés par
  l'auteur), avec une fenêtre de contexte de 512 tokens (~350-400 mots),
  plus large que la plupart des alternatives -- utile si un technicien
  décrit un symptôme en plusieurs phrases plutôt qu'en une ligne. Modèle
  volumineux (560M paramètres, ~2.2 Go) : raisonnable en développement sur
  une machine puissante, à réévaluer si le déploiement prod tourne sur du
  matériel plus modeste (voir `embedding_model_name` dans
  app/core/config.py, modifiable sans toucher au code).
- Le modèle est mis en cache après le premier chargement (voir
  _get_encoder ci-dessous) : le charger à chaque appel rechargerait tous
  ses poids depuis le disque à chaque recherche, ce qui serait beaucoup
  trop lent pour un usage interactif.
- Solon suit la convention "asymétrique" utilisée par de nombreux modèles
  d'embeddings récents (famille E5) : le texte de RECHERCHE doit être
  préfixé par "query : " pour de meilleures performances, alors que les
  textes déjà enregistrés (les symptômes stockés en base) n'ont besoin
  d'aucun préfixe. C'est pour ça que `generate_embedding` prend un
  paramètre `is_query` -- retrieval_service.py l'active pour le texte tapé
  par le technicien, intervention_service.py et le seed ne l'activent pas
  pour les textes qu'ils enregistrent.

Ce fichier :
- Utilise ce modèle s'il est disponible (installé + poids téléchargeables).
- Génère automatiquement un vecteur "de secours" (sans réseau de neurones,
  juste un hash du texte) si l'IA plante ou est absente -- pour que le
  reste de l'application continue de fonctionner en dégradé plutôt que de
  planter.
- Harmonise la taille du vecteur pour la base de données (utile surtout
  pour le fallback ; avec Solon la taille correspond déjà nativement).
"""

import hashlib
import math
import re
from functools import lru_cache
from typing import Sequence

from app.core.config import settings

# Modèle par défaut si aucun n'est précisé en configuration (voir
# app/core/config.py, `embedding_model_name`) : Solon, spécialisé français
# -- voir l'explication en tête de fichier sur pourquoi ce choix.
DEFAULT_MODEL_NAME = "OrdalieTech/Solon-embeddings-large-0.1"

# Préfixe recommandé par Solon (convention de type E5) pour le texte de
# RECHERCHE uniquement -- jamais pour les textes déjà enregistrés en base.
QUERY_PREFIX = "query : "


def _clean_text(raw_text: str | None) -> str:
    if raw_text is None:
        return ""
    return re.sub(r"\s+", " ", raw_text).strip()


def _fit_size(vector: Sequence[float], target_size: int) -> list[float]:
    if len(vector) == target_size:
        return list(vector)
    if len(vector) < target_size:
        padded = list(vector) + [0.0] * (target_size - len(vector))
        return padded
    return list(vector[:target_size])


def _fallback_embedding(raw_text: str | None, vector_size: int) -> list[float]:
    cleaned = _clean_text(raw_text)
    tokens = re.findall(r"[a-z0-9]+", cleaned.lower())
    if not tokens:
        return [0.0] * vector_size

    values = [0.0] * vector_size
    for index, token in enumerate(tokens):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        weight = (int.from_bytes(digest[:8], "big") / float(2 ** 64 - 1)) * 2.0 - 1.0
        slot = (index * 17 + len(token)) % vector_size
        values[slot] += weight

    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return [0.0] * vector_size
    return [value / norm for value in values]


@lru_cache(maxsize=4)
def _get_encoder(model_name: str):
    """
    Charge le modèle de réseau de neurones UNE SEULE FOIS par nom de modèle,
    puis réutilise l'instance déjà chargée en mémoire pour tous les appels
    suivants (@lru_cache). Sans ce cache, chaque recherche de symptôme
    rechargerait les poids depuis le disque, ce qui serait beaucoup trop
    lent pour un usage interactif.

    Utilise le GPU (CUDA) s'il est détecté par torch -- pertinent ici avec
    de la VRAM disponible, sinon bascule automatiquement sur le CPU.
    """
    from sentence_transformers import SentenceTransformer

    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        device = "cpu"

    return SentenceTransformer(model_name, device=device)


def generate_embedding(
    raw_text: str | None,
    model_name: str | None = None,
    dimensions: int | None = None,
    is_query: bool = False,
) -> list[float]:
    """
    Return a deterministic vector for the text, with a model fallback when needed.

    is_query=True : à utiliser uniquement pour le texte tapé par le
    technicien au moment de la recherche (voir QUERY_PREFIX ci-dessus).
    Laisser à False pour tout texte qu'on enregistre en base (symptôme
    stocké dans une intervention) -- ce sont des "passages", pas des
    "queries", au sens de Solon.
    """
    vector_size = dimensions or settings.embedding_dimensions or 1024
    cleaned = _clean_text(raw_text)
    if not cleaned:
        return [0.0] * vector_size

    if is_query:
        cleaned = f"{QUERY_PREFIX}{cleaned}"

    try:
        chosen_model = model_name or settings.embedding_model_name or DEFAULT_MODEL_NAME
        encoder = _get_encoder(chosen_model)
        # normalize_embeddings=True : le modèle renvoie directement un
        # vecteur de norme 1, cohérent avec _fallback_embedding ci-dessus
        # et avec l'opérateur de similarité cosinus (<=>) utilisé côté
        # pgvector dans retrieval_service.py.
        vector = encoder.encode(cleaned, normalize_embeddings=True)
        return _fit_size(vector.tolist(), vector_size)
    except Exception:
        # L'application est conçue pour fonctionner sans service
        # d'embeddings externe/neuronal si besoin (modèle absent, erreur de
        # chargement, pas de réseau pour le télécharger la première fois...).
        return _fallback_embedding(cleaned, vector_size)


embed_text = generate_embedding