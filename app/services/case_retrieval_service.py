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
retrieval_service.fetch_similar_symptoms_per_symptom (une recherche par
symptôme du technicien, déjà filtrée par device_type), puis regroupe ses
résultats par intervention.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.models.intervention import Diagnosis, Intervention
from app.models.solution_proposal import SolutionProposal
from app.models.technician import Technician
from app.services.retrieval_service import fetch_similar_symptoms_per_symptom


def find_similar_cases(
    db: Session,
    search_text: str,
    device_type: str,
    symptom_limit: int = 8,
    case_limit: int = 3,
    model_name: str | None = None,
    symptoms: list[dict] | None = None,
) -> list[dict]:
    """
    Jusqu'à `case_limit` interventions passées similaires au problème,
    triées de la plus à la moins pertinente. Limitées aux appareils du
    modèle `model_name` s'il est fourni.

    `symptoms` : symptômes numérotés du technicien ([{"number": 1, "text":
    ...}], voir UnderstoodMessage.symptoms), cherchés CHACUN séparément.
    Absent ou vide : `search_text` est cherché comme un seul symptôme.

    Une intervention qui recoupe plusieurs symptômes du technicien passe
    devant celles qui n'en recoupent qu'un ; à égalité, la meilleure
    similarité moyenne l'emporte. Chaque cas garde la liste de ses
    correspondances (matched_symptoms).

    symptom_limit > case_limit volontairement : plusieurs symptômes
    catalogués différents peuvent pointer vers la même intervention, donc
    on élargit la recherche en amont pour ne pas rater une intervention
    pertinente juste parce qu'un seul de ses symptômes a été retenu.
    """
    query_symptoms = [s for s in (symptoms or []) if (s.get("text") or "").strip()]
    if not query_symptoms:
        query_symptoms = [{"number": 1, "text": search_text}]

    rows_per_symptom = fetch_similar_symptoms_per_symptom(
        db, [s["text"] for s in query_symptoms], device_type, limit=symptom_limit, model_name=model_name
    )
    matches_by_intervention = _group_matches_by_intervention(query_symptoms, rows_per_symptom)
    if not matches_by_intervention:
        trace("SEARCH", "Aucun cas similaire trouvé", count=0, symptom_count=len(query_symptoms))
        return []

    ranked_ids = sorted(
        matches_by_intervention, key=lambda iid: _case_rank_key(matches_by_intervention[iid])
    )[:case_limit]

    cases = []
    for intervention_id in ranked_ids:
        matched_symptoms = matches_by_intervention[intervention_id]
        # Le symptôme le plus proche reste LA référence du cas (affichage
        # court, proposition de solution) ; les autres sont dans matched_symptoms.
        best_match = max(matched_symptoms, key=lambda m: m["similarity"])
        case = build_case(
            db,
            intervention_id,
            device_type=device_type,
            matched_symptom_text=best_match["raw_text"],
            matched_intervention_symptom_id=best_match["intervention_symptom_id"],
            matched_symptoms=matched_symptoms,
        )
        if case is not None:
            cases.append(case)
    trace(
        "SEARCH",
        "Cas similaires préparés",
        symptom_count=len(query_symptoms),
        matched_symptom_count=sum(len(rows) for rows in rows_per_symptom),
        case_count=len(cases),
        matched_symptoms_per_case=[len(case["matched_symptoms"]) for case in cases],
    )
    return cases


def build_case(
    db: Session,
    intervention_id: int,
    device_type: str | None = None,
    matched_symptom_text: str | None = None,
    matched_intervention_symptom_id: int | None = None,
    matched_symptoms: list[dict] | None = None,
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
        "matched_intervention_symptom_id": matched_intervention_symptom_id,
        "matched_symptoms": matched_symptoms or [],
        "actions": [
            {
                "description": a.raw_text,
                "outcome_status": a.outcome_status,
                "is_confirmed_solution": a.is_confirmed_solution,
                # Renseigné seulement pour une solution ajoutée après coup (proposition approuvée).
                "proposed_by": _proposer_name(db, a.source_proposal_id) if a.source_proposal_id else None,
            }
            for a in actions
        ],
        "diagnosis": diagnosis.description if diagnosis else None,
        "final_outcome_status": intervention.final_outcome_status,
        "confidence": _lookup_confidence(db, intervention, actions, device_type),
    }


def _proposer_name(db: Session, proposal_id: int) -> str:
    """Le technicien qui a proposé une solution ajoutée après validation."""
    proposal = db.get(SolutionProposal, proposal_id)
    technician = db.get(Technician, proposal.technician_id) if proposal is not None else None
    return getattr(technician, "full_name", None) or "un technicien"


def _group_matches_by_intervention(
    query_symptoms: list[dict], rows_per_symptom: list[list[dict]]
) -> dict[int, list[dict]]:
    """
    Pour chaque intervention, la meilleure correspondance de CHAQUE symptôme
    du technicien qui l'a trouvée : {intervention_id: [correspondance, ...]},
    triées par numéro de symptôme du technicien.
    """
    best: dict[int, dict[int, dict]] = {}
    for query_symptom, rows in zip(query_symptoms, rows_per_symptom):
        for row in rows:
            match = {
                "query_symptom_number": query_symptom["number"],
                "query_symptom_text": query_symptom["text"],
                "intervention_symptom_id": row.get("intervention_symptom_id"),
                "raw_text": row["raw_text"],
                "similarity": float(row["similarity"]),
            }
            per_symptom = best.setdefault(row["intervention_id"], {})
            current = per_symptom.get(query_symptom["number"])
            if current is None or match["similarity"] > current["similarity"]:
                per_symptom[query_symptom["number"]] = match
    return {
        intervention_id: [per_symptom[number] for number in sorted(per_symptom)]
        for intervention_id, per_symptom in best.items()
    }


def _case_rank_key(matched_symptoms: list[dict]) -> tuple[int, float]:
    """D'abord le nombre de symptômes du technicien recoupés, puis la similarité moyenne (tri croissant)."""
    mean_similarity = sum(m["similarity"] for m in matched_symptoms) / len(matched_symptoms)
    return (-len(matched_symptoms), -mean_similarity)


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