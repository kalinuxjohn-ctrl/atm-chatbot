"""
Recherche de CAS RÉELS similaires (un cas = une intervention passée), en
complément de retrieval_service.find_ranked_solutions qui, lui, répond au
niveau agrégé (symptom_id + action_id -> fiabilité moyenne tous cas
confondus).

Les deux coexistent volontairement, sans que l'un remplace l'autre :
- find_ranked_solutions (existant, inchangé) -> "qu'est-ce qui marche le
  mieux, statistiquement ?"
- find_similar_cases (ici)                   -> "montre-moi des
  interventions réelles similaires, chacune racontée individuellement."

Ce fichier NE duplique PAS la recherche vectorielle : il réutilise
retrieval_service.fetch_similar_symptoms (déjà publique, déjà filtrée par
device_type), puis regroupe ses résultats par intervention.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.models.intervention import Diagnosis, Intervention
from app.models.technician import Technician
from app.services.retrieval_service import fetch_similar_symptoms


def find_similar_cases(
    db: Session,
    raw_text: str,
    device_type: str,
    symptom_limit: int = 8,
    case_limit: int = 3,
    model_name: str | None = None,
) -> list[dict]:
    """
    Jusqu'à `case_limit` interventions passées similaires à `raw_text`,
    triées de la plus à la moins pertinente. Limitées aux appareils du
    modèle `model_name` s'il est fourni.

    symptom_limit > case_limit volontairement : plusieurs symptômes
    catalogués différents peuvent pointer vers la même intervention, donc
    on élargit la recherche en amont pour ne pas rater une intervention
    pertinente juste parce qu'un seul de ses symptômes a été retenu.
    """
    matched_symptoms = fetch_similar_symptoms(
        db, raw_text, device_type, limit=symptom_limit, model_name=model_name
    )
    if not matched_symptoms:
        trace("SEARCH", "Aucun cas similaire trouvé", count=0)
        return []

    best_per_intervention = _keep_best_match_per_intervention(matched_symptoms)
    ranked_ids = sorted(
        best_per_intervention, key=lambda iid: _rank_key(best_per_intervention[iid])
    )[:case_limit]

    cases = [
        case
        for case in (
            build_case(
                db,
                intervention_id,
                device_type=device_type,
                matched_symptom_text=best_per_intervention[intervention_id]["raw_text"],
            )
            for intervention_id in ranked_ids
        )
        if case is not None
    ]
    trace(
        "SEARCH",
        "Cas similaires préparés",
        matched_symptom_count=len(matched_symptoms),
        case_count=len(cases),
    )
    return cases


def build_case(
    db: Session,
    intervention_id: int,
    device_type: str | None = None,
    matched_symptom_text: str | None = None,
) -> dict | None:
    """
    Assemble le détail complet d'UNE intervention. Fonction publique à
    part entière (pas seulement un détail interne de find_similar_cases)
    car elle sert aussi au workflow "plus de détails sur le deuxième",
    où on connaît déjà l'intervention_id et on n'a pas besoin de
    re-rechercher par similarité.

    None si l'intervention n'existe plus (ex. supprimée depuis la recherche).
    """
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        return None

    technician = db.get(Technician, intervention.technician_id)
    device = intervention.device  # relation confirmée dans models/intervention.py
    diagnosis = db.query(Diagnosis).filter(Diagnosis.intervention_id == intervention_id).first()
    actions = sorted(intervention.actions, key=lambda a: a.sequence_order)

    return {
        "intervention_id": intervention_id,
        "technician_name": getattr(technician, "full_name", None) or "technicien inconnu",
        # `or` en cascade : un attribut présent mais NULL ne doit jamais s'afficher "None".
        "device_label": getattr(device, "site_name", None) or getattr(device, "serial_number", None) or "appareil non identifié",
        "opened_at": intervention.opened_at,
        "matched_symptom_text": matched_symptom_text,
        "actions": [
            {
                "description": a.raw_text,
                "outcome_status": a.outcome_status,
                "is_confirmed_solution": a.is_confirmed_solution,
            }
            for a in actions
        ],
        "diagnosis": diagnosis.description if diagnosis else None,
        "final_outcome_status": intervention.final_outcome_status,
        "confidence": _lookup_confidence(db, intervention, actions, device_type),
    }


def _keep_best_match_per_intervention(matched_symptoms: list[dict]) -> dict[int, dict]:
    """Une intervention peut matcher via plusieurs symptômes -- on ne garde que sa meilleure correspondance pour le classement."""
    best: dict[int, dict] = {}
    for row in matched_symptoms:
        intervention_id = row["intervention_id"]
        current = best.get(intervention_id)
        if current is None or _rank_key(row) < _rank_key(current):
            best[intervention_id] = row
    return best


def _rank_key(matched_row: dict) -> float:
    """
    `distance` (chemin pgvector, 0 = identique) si disponible, sinon
    `similarity` (chemin de repli Python, 1 = identique) inversée pour
    trier dans le même sens -- isolé ici pour ne pas dupliquer cette
    logique à chaque appel.
    """
    if "distance" in matched_row:
        return matched_row["distance"]
    return 1.0 - matched_row.get("similarity", 0.0)


def _lookup_confidence(db: Session, intervention: Intervention, actions: list, device_type: str | None) -> dict | None:
    """
    Rattache la fiabilité connue (symptom_action_outcome_stats, §7 du doc
    de conception) à l'action qui a confirmé résoudre CE cas -- réutilise
    la table existante sans y toucher. None si pas d'action confirmée, pas
    de device_type connu, ou pas de stats encore calculées pour cette paire.
    """
    confirmed = next((a for a in actions if a.is_confirmed_solution and a.action_id), None)
    if confirmed is None or device_type is None:
        return None

    symptom_id = _catalog_symptom_id_solved_by(confirmed, intervention.symptoms)
    if symptom_id is None:
        return None

    row = db.execute(
        text(
            """
            SELECT accuracy_score, attempts FROM symptom_action_outcome_stats
            WHERE symptom_id = :symptom_id AND action_id = :action_id AND device_type = :device_type
            """
        ),
        {"symptom_id": symptom_id, "action_id": confirmed.action_id, "device_type": device_type},
    ).mappings().first()
    return dict(row) if row else None


def _catalog_symptom_id_solved_by(confirmed_action, intervention_symptoms: list) -> int | None:
    """
    symptom_id catalogué que l'action confirmée a réellement résolu --
    c'est la clé sous laquelle symptom_action_outcome_stats range sa fiabilité.
    """
    # Cas 1 : le technicien a précisé quel symptôme l'action visait
    # (targets_symptom_id). Seul ce symptôme-là a des stats pour cette
    # action -- prendre un autre symptôme de l'intervention ne trouverait rien.
    # Si ce symptôme n'est pas encore catalogué (symptom_id NULL), l'action
    # n'a de stats sous AUCUN symptôme : on renvoie None plutôt que d'aller
    # chercher la fiabilité d'un autre symptôme qu'elle ne visait pas.
    if confirmed_action.targets_symptom_id is not None:
        targeted_symptom = next(
            (s for s in intervention_symptoms if s.intervention_symptom_id == confirmed_action.targets_symptom_id),
            None,
        )
        return targeted_symptom.symptom_id if targeted_symptom is not None else None

    # Cas 2 : action sans cible précise -- le recalcul des stats la compte
    # pour TOUS les symptômes de l'intervention, n'importe lequel convient.
    # Tri par ID : la relation ORM n'a pas d'ordre garanti, sans ce tri le
    # symptôme choisi (et donc la fiabilité affichée) pourrait varier d'un appel à l'autre.
    for symptom in sorted(intervention_symptoms, key=lambda s: s.intervention_symptom_id):
        if symptom.symptom_id is not None:
            return symptom.symptom_id
    return None