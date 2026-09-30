"""Simple similarity search helpers for symptom-level retrieval.


Moteur de recherche par similarité pour les symptômes.

Ce fichier permet de trouver les symptômes enregistrés qui ressemblent le plus à une recherche texte :
- Convertit la recherche en vecteur d'embedding.
- Exécute un SELECT optimisé dans PostgreSQL (pgvector) pour trouver les résultats les plus proches.
- Calcule la similarité à la main en Python (cosinus) si la BDD ne supporte pas l'extension vectorielle.
- Va ensuite chercher, pour les symptômes catalogués trouvés, les actions déjà
  connues classées par accuracy -- toujours pour le MÊME device_type (gab ou
  tpe), puisqu'une action validée sur un GAB n'a pas la même fiabilité sur un
  TPE (mécaniques différentes -- voir symptom_action_outcome_stats).
"""

import math
from typing import Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.types import Integer

from app.services.embeddings_service import generate_embedding


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0

    dot_product = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot_product / (left_norm * right_norm)


def fetch_similar_symptoms(db, raw_text: str, device_type: str, limit: int = 5):
    """Return the closest intervention symptoms for a text query.

    Restreint aux symptômes enregistrés sur le même device_type (jointure
    jusqu'à `device` via `intervention`) : un GAB et un TPE ne partagent pas
    la même mécanique, donc un symptôme "similaire en texte" observé sur
    l'un n'est pas forcément pertinent pour l'autre.
    """
    query_vector = generate_embedding(raw_text, is_query=True)

    try:
        rows = db.execute(
            text(
                """
                SELECT isym.intervention_symptom_id, isym.intervention_id,
                       isym.symptom_id, isym.raw_text,
                       isym.embedding <=> CAST(:query_vector AS vector) AS distance
                FROM intervention_symptom isym
                JOIN intervention iv ON iv.intervention_id = isym.intervention_id
                JOIN device d ON d.device_id = iv.device_id
                WHERE isym.embedding IS NOT NULL
                  AND d.device_type = :device_type
                ORDER BY isym.embedding <=> CAST(:query_vector AS vector)
                LIMIT :limit
                """
            ),
            {"query_vector": str(query_vector), "device_type": device_type, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]
    except Exception:
        # Repli si pgvector n'est pas disponible : on relit les embeddings
        # comme du texte brut (le type `vector` accepte cette lecture) et on
        # calcule la similarité cosinus à la main.
        # Indispensable : la requête précédente a échoué et a laissé la
        # transaction "avortée" côté Postgres -- toute nouvelle requête sur
        # la même session échouerait avec InFailedSqlTransaction tant qu'on
        # n'a pas annulé cette transaction.
        db.rollback()
        rows = db.execute(
            text(
                """
                SELECT isym.intervention_symptom_id, isym.intervention_id,
                       isym.symptom_id, isym.raw_text, isym.embedding::text AS embedding_text
                FROM intervention_symptom isym
                JOIN intervention iv ON iv.intervention_id = isym.intervention_id
                JOIN device d ON d.device_id = iv.device_id
                WHERE isym.embedding IS NOT NULL
                  AND d.device_type = :device_type
                """
            ),
            {"device_type": device_type},
        ).mappings().all()

        scored = []
        for row in rows:
            vector = [float(value) for value in row["embedding_text"].strip("[]").split(",")]
            score = cosine_similarity(query_vector, vector)
            scored.append({
                "intervention_symptom_id": row["intervention_symptom_id"],
                "intervention_id": row["intervention_id"],
                "symptom_id": row["symptom_id"],
                "raw_text": row["raw_text"],
                "similarity": score,
            })
        scored.sort(key=lambda item: item["similarity"], reverse=True)
        return scored[:limit]


retrieve_similar_symptoms = fetch_similar_symptoms


def find_best_catalog_match(db, raw_text: str, device_type: str) -> dict | None:
    """
    Cherche, parmi les symptômes DÉJÀ rattachés au catalogue (symptom_id non
    NULL) pour ce device_type, celui dont la formulation passée est la plus
    proche de raw_text.

    Renvoie {"symptom_id": ..., "distance": ...} si un candidat existe,
    sinon None. Ne décide PAS du seuil d'acceptation -- c'est à l'appelant
    (intervention_service.py) de comparer "distance" à
    settings.symptom_catalog_match_max_distance avant de s'en servir.
    """
    query_vector = generate_embedding(raw_text, is_query=True)

    try:
        row = db.execute(
            text(
                """
                SELECT isym.symptom_id,
                       isym.embedding <=> CAST(:query_vector AS vector) AS distance
                FROM intervention_symptom isym
                JOIN intervention iv ON iv.intervention_id = isym.intervention_id
                JOIN device d ON d.device_id = iv.device_id
                WHERE isym.embedding IS NOT NULL
                  AND isym.symptom_id IS NOT NULL
                  AND d.device_type = :device_type
                ORDER BY isym.embedding <=> CAST(:query_vector AS vector)
                LIMIT 1
                """
            ),
            {"query_vector": str(query_vector), "device_type": device_type},
        ).mappings().first()
        return dict(row) if row else None
    except Exception:
        db.rollback()
        rows = db.execute(
            text(
                """
                SELECT isym.symptom_id, isym.embedding::text AS embedding_text
                FROM intervention_symptom isym
                JOIN intervention iv ON iv.intervention_id = isym.intervention_id
                JOIN device d ON d.device_id = iv.device_id
                WHERE isym.embedding IS NOT NULL
                  AND isym.symptom_id IS NOT NULL
                  AND d.device_type = :device_type
                """
            ),
            {"device_type": device_type},
        ).mappings().all()

        best = None
        for row in rows:
            vector = [float(value) for value in row["embedding_text"].strip("[]").split(",")]
            distance = 1.0 - cosine_similarity(query_vector, vector)
            if best is None or distance < best["distance"]:
                best = {"symptom_id": row["symptom_id"], "distance": distance}
        return best


def store_symptom_embedding(db, intervention_symptom_id: int, vector: Sequence[float]) -> None:
    """
    Écrit l'embedding calculé pour un symptôme déjà enregistré.

    La colonne `embedding` n'est pas mappée dans le modèle ORM
    InterventionSymptom (voir app/models/intervention.py) -- son écriture
    passe donc par une requête SQL directe, comme sa lecture ailleurs dans
    ce fichier.
    """
    db.execute(
        text(
            "UPDATE intervention_symptom SET embedding = CAST(:vector AS vector) "
            "WHERE intervention_symptom_id = :intervention_symptom_id"
        ),
        {"vector": str(list(vector)), "intervention_symptom_id": intervention_symptom_id},
    )


def find_ranked_solutions(db, raw_text: str, device_type: str, symptom_limit: int = 5, solution_limit: int = 10):
    """Point d'entrée principal du flux de recherche (étapes 1-2 de la
    feuille de route) : à partir d'un symptôme décrit en langage libre par
    le technicien, retrouve les symptômes catalogués les plus proches, puis
    renvoie les actions déjà tentées pour ces symptômes, classées par
    accuracy décroissante -- sans rien cacher (le technicien voit tout le
    classement, pas juste le "meilleur" résultat).
    """
    similar = fetch_similar_symptoms(db, raw_text, device_type, limit=symptom_limit)

    symptom_ids = sorted({row["symptom_id"] for row in similar if row.get("symptom_id") is not None})

    if not symptom_ids:
        return {"matched_symptom_ids": [], "solutions": []}

    query = text(
        """
        SELECT stats.symptom_id, s.canonical_text AS symptom_text,
               stats.action_id, a.canonical_text AS action_text,
               stats.attempts, stats.successes, stats.accuracy_score
        FROM symptom_action_outcome_stats stats
        JOIN symptom s ON s.symptom_id = stats.symptom_id
        JOIN action a ON a.action_id = stats.action_id
        WHERE stats.symptom_id IN :symptom_ids
          AND stats.device_type = :device_type
        ORDER BY stats.accuracy_score DESC, stats.attempts DESC
        LIMIT :limit
        """
    ).bindparams(bindparam("symptom_ids", expanding=True, type_=Integer))

    rows = db.execute(
        query,
        {"symptom_ids": symptom_ids, "device_type": device_type, "limit": solution_limit},
    ).mappings().all()

    return {"matched_symptom_ids": symptom_ids, "solutions": [dict(row) for row in rows]}