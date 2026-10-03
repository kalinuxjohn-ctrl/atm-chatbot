"""Simple similarity search helpers for symptom-level retrieval.


Moteur de recherche par similarité pour les symptômes.

Ce fichier permet de trouver les symptômes enregistrés qui ressemblent le plus à une recherche texte :
- Convertit la recherche en vecteur d'embedding (via embeddings_service.generate_embedding --
  ce fichier ne sait RIEN du modèle utilisé derrière, local ou API externe demain).
- Exécute un SELECT optimisé dans PostgreSQL (pgvector) pour trouver les résultats les plus proches.
- Calcule la similarité à la main en Python (cosinus) si la BDD ne supporte pas l'extension vectorielle.
- Élimine les candidats pas assez pertinents (seuil configurable, voir settings.symptom_similarity_threshold)
  avant qu'ils puissent influencer la recherche de solutions.
- Va ensuite chercher, pour les symptômes catalogués jugés pertinents, les actions déjà
  connues classées par accuracy -- toujours pour le MÊME device_type (gab ou
  tpe), puisqu'une action validée sur un GAB n'a pas la même fiabilité sur un
  TPE (mécaniques différentes -- voir symptom_action_outcome_stats).

Convention de score : "similarity", score élevé = plus pertinent, dans les
DEUX chemins (pgvector et repli Python). pgvector renvoie nativement une
distance cosinus (0 = identique) ; elle est convertie en similarité
(1 - distance) directement dans la requête SQL, pour que le reste du
fichier -- et tout appelant externe -- n'ait jamais à connaître cette
différence de convention entre les deux moteurs.
"""

import math
from typing import Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.types import Integer

from app.core.config import settings
from app.core.tracing import trace
from app.services.embeddings_service import generate_embedding


# Garde-fou technique (pas un paramètre métier) : évite qu'un limit
# aberrant (ex. mal passé par un appelant) ne fasse remonter des milliers
# de lignes. Volontairement en dur -- contrairement au seuil de
# pertinence, ce n'est pas un réglage qu'on attend de faire varier.
MAX_SYMPTOM_LIMIT = 50
DEFAULT_SYMPTOM_LIMIT = 5


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0

    dot_product = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot_product / (left_norm * right_norm)


def _clean_search_text(raw_text: str | None) -> str:
    return (raw_text or "").strip()


def _clamp_limit(limit: int, default: int = DEFAULT_SYMPTOM_LIMIT) -> int:
    """Remplace un `limit` invalide par une valeur par défaut raisonnable, et plafonne les valeurs absurdes."""
    if not isinstance(limit, int) or limit <= 0:
        return default
    return min(limit, MAX_SYMPTOM_LIMIT)


def _apply_relevance_threshold(candidates: list[dict], threshold: float, method: str) -> list[dict]:
    """
    Filtre commun aux deux moteurs (pgvector et repli Python) -- c'est ICI,
    et seulement ici, que la notion de "suffisamment pertinent" est
    appliquée, pour qu'elle soit garantie identique quel que soit le
    chemin emprunté.
    """
    retained = [c for c in candidates if c["similarity"] >= threshold]
    eliminated_count = len(candidates) - len(retained)

    if retained:
        trace(
            "SEARCH",
            "Résultats retenus après seuil de pertinence",
            method=method,
            retained_count=len(retained),
            eliminated_count=eliminated_count,
            threshold=threshold,
            scores=[round(c["similarity"], 4) for c in retained],
        )
    else:
        trace(
            "SEARCH",
            "Aucun résultat suffisamment pertinent",
            method=method,
            candidate_count=len(candidates),
            threshold=threshold,
        )

    return retained


def _fallback_cosine_search(db, query_vector: Sequence[float], device_type: str, limit: int) -> list[dict]:
    """
    Repli quand pgvector est indisponible. Mêmes colonnes, même clé de
    score ("similarity", élevé = pertinent), même tri que le chemin
    pgvector -- ce n'est pas une deuxième logique, juste un calcul fait à
    la main plutôt que par l'extension SQL.
    """
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
        similarity = cosine_similarity(query_vector, vector)
        scored.append(
            {
                "intervention_symptom_id": row["intervention_symptom_id"],
                "intervention_id": row["intervention_id"],
                "symptom_id": row["symptom_id"],
                "raw_text": row["raw_text"],
                "similarity": similarity,
            }
        )
    scored.sort(key=lambda item: item["similarity"], reverse=True)
    return scored[:limit]


def fetch_similar_symptoms(db, raw_text: str, device_type: str, limit: int = DEFAULT_SYMPTOM_LIMIT) -> list[dict]:
    """
    Les symptômes enregistrés les plus proches d'une recherche texte, DÉJÀ
    filtrés par le seuil de pertinence (settings.symptom_similarity_threshold)
    -- un appelant ne reçoit donc jamais un résultat jugé non pertinent
    simplement parce qu'il faisait partie du Top N.

    Restreint aux symptômes enregistrés sur le même device_type (jointure
    jusqu'à `device` via `intervention`) : un GAB et un TPE ne partagent pas
    la même mécanique, donc un symptôme "similaire en texte" observé sur
    l'un n'est pas forcément pertinent pour l'autre.

    Retourne [] si le texte est vide/inexploitable (aucune recherche
    vectorielle n'est lancée dans ce cas), ou si aucun candidat ne dépasse
    le seuil de pertinence.
    """
    cleaned_text = _clean_search_text(raw_text)
    trace("PROCESSING", "Texte de recherche nettoyé", cleaned_length=len(cleaned_text))
    if not cleaned_text:
        trace("SEARCH", "Texte de recherche vide, recherche vectorielle ignorée", device_type=device_type)
        return []

    limit = _clamp_limit(limit)
    threshold = settings.symptom_similarity_threshold

    trace(
        "SEARCH",
        "Recherche vectorielle démarrée",
        query_length=len(cleaned_text),
        device_type=device_type,
        limit=limit,
        threshold=threshold,
    )

    query_vector = generate_embedding(cleaned_text, is_query=True)

    try:
        rows = db.execute(
            text(
                """
                SELECT isym.intervention_symptom_id, isym.intervention_id,
                       isym.symptom_id, isym.raw_text,
                       1 - (isym.embedding <=> CAST(:query_vector AS vector)) AS similarity
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
        candidates = [dict(row) for row in rows]
        method = "pgvector"
    except Exception as error:
        trace(
            "SEARCH",
            "Recherche pgvector indisponible, utilisation du repli cosinus",
            error_type=type(error).__name__,
        )
        # Indispensable : la requête précédente a échoué et a laissé la
        # transaction "avortée" côté Postgres -- toute nouvelle requête sur
        # la même session échouerait avec InFailedSqlTransaction tant qu'on
        # n'a pas annulé cette transaction.
        db.rollback()
        candidates = _fallback_cosine_search(db, query_vector, device_type, limit)
        method = "python_cosine"

    trace("SEARCH", "Candidats vectoriels récupérés avant filtrage", count=len(candidates), method=method)
    return _apply_relevance_threshold(candidates, threshold, method)


retrieve_similar_symptoms = fetch_similar_symptoms


def find_best_catalog_match(db, raw_text: str, device_type: str) -> dict | None:
    """
    Cherche, parmi les symptômes DÉJÀ rattachés au catalogue (symptom_id non
    NULL) pour ce device_type, celui dont la formulation passée est la plus
    proche de raw_text.

    INCHANGÉE par ce refactor : cette fonction garde sa convention "distance"
    (plus bas = plus proche), utilisée ailleurs avec son propre seuil
    (settings.symptom_catalog_match_max_distance, dans du code non modifié
    ici) -- la faire basculer vers "similarity" casserait ce contrat sans
    visibilité sur son appelant.
    """
    cleaned_text = _clean_search_text(raw_text)
    if not cleaned_text:
        return None

    query_vector = generate_embedding(cleaned_text, is_query=True)

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


def find_ranked_solutions(
    db, raw_text: str, device_type: str, symptom_limit: int = DEFAULT_SYMPTOM_LIMIT, solution_limit: int = 10
) -> dict:
    """Point d'entrée principal du flux de recherche (étapes 1-2 de la
    feuille de route) : à partir d'un symptôme décrit en langage libre par
    le technicien, retrouve les symptômes catalogués les plus proches
    (déjà filtrés par pertinence -- voir fetch_similar_symptoms), puis
    renvoie les actions déjà tentées pour ces symptômes, classées par
    accuracy décroissante -- sans rien cacher (le technicien voit tout le
    classement, pas juste le "meilleur" résultat).

    Le classement des solutions reste piloté par les stats
    (accuracy_score, attempts), PAS par le score sémantique -- celui-ci ne
    sert qu'à décider quels symptômes entrent dans cette recherche. Il est
    cependant conservé et rattaché à chaque solution (clé
    "symptom_similarity"), pour que l'appelant sache à quel point le
    symptôme d'origine correspondait à la recherche.

    Renvoie {"matched_symptom_ids": [], "solutions": [], "no_relevant_match": True}
    si aucun symptôme suffisamment pertinent n'a été trouvé -- aucune
    solution n'est alors recherchée au hasard.
    """
    solution_limit = _clamp_limit(solution_limit, default=10)
    similar = fetch_similar_symptoms(db, raw_text, device_type, limit=symptom_limit)

    if not similar:
        return {"matched_symptom_ids": [], "solutions": [], "no_relevant_match": True}

    # Un même symptom_id catalogué peut apparaître via plusieurs lignes
    # (plusieurs interventions passées formulées différemment) -- on garde
    # sa MEILLEURE similarité, c'est elle qui doit accompagner la solution.
    best_similarity_by_symptom: dict[int, float] = {}
    for row in similar:
        symptom_id = row.get("symptom_id")
        if symptom_id is None:
            continue
        current_best = best_similarity_by_symptom.get(symptom_id)
        if current_best is None or row["similarity"] > current_best:
            best_similarity_by_symptom[symptom_id] = row["similarity"]

    symptom_ids = sorted(best_similarity_by_symptom)

    if not symptom_ids:
        # Candidats trouvés et pertinents, mais aucun rattaché au
        # catalogue (symptom_id NULL) -- rien à chercher dans
        # symptom_action_outcome_stats, qui est indexée sur symptom_id.
        trace(
            "SEARCH",
            "Candidats pertinents mais non catalogués, aucune solution possible",
            candidate_count=len(similar),
            device_type=device_type,
        )
        return {"matched_symptom_ids": [], "solutions": [], "no_relevant_match": True}

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

    solutions = [
        {**dict(row), "symptom_similarity": best_similarity_by_symptom[row["symptom_id"]]} for row in rows
    ]

    trace(
        "SEARCH",
        "Solutions classées récupérées",
        matched_symptom_count=len(symptom_ids),
        solution_count=len(solutions),
    )

    return {"matched_symptom_ids": symptom_ids, "solutions": solutions, "no_relevant_match": False}