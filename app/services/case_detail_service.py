"""
« Détaille le cas 2 » : réponse rédigée à partir du DOSSIER COMPLET du cas lu en base.

Pendant la recherche, le LLM ne reçoit qu'un résumé court de chaque cas
(case_retrieval_service.build_case : symptôme recoupé, actions, diagnostic).
Quand le technicien demande plus de détails sur UN cas, ce résumé ne suffit
pas : le backend retrouve l'intervention (Cas N -> intervention_id gardé dans
le contexte de la conversation), relit TOUTES ses tables, et demande au LLM
de développer à partir de ces faits.

    intervention          ticket, dates, bilan, résumé long (summary_text)
    technician            qui est intervenu
    device / device_model appareil, modèle, fabricant, site
    intervention_symptom  TOUS les symptômes du cas (et ceux qui ont recoupé la recherche)
    intervention_action   chaque action : ordre, heure, résultat détaillé, effet, symptôme visé
    diagnosis             cause, confirmée ou non, PIÈCE EN CAUSE

La recherche par symptôme n'est pas modifiée : ce fichier ne sert qu'au détail.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.models.catalog import Component
from app.models.device import DeviceModel, Manufacturer
from app.models.intervention import Diagnosis, Intervention
from app.services import case_retrieval_service, llm_service

_INTERVENTION_OUTCOME_LABELS = {
    "resolved": "résolue",
    "partially_resolved": "résolue en partie",
    "unresolved": "non résolue",
    "escalated": "escaladée",
}

_ACTION_OUTCOME_LABELS = {
    "resolved": "problème réglé",
    "partial": "réglé en partie",
    "no_effect": "sans effet",
    "made_worse": "a aggravé le problème",
    "unknown": "résultat inconnu",
}


def develop_case(
    db: Session,
    stored_result: dict,
    technician_question: str,
    device_type: str | None = None,
    problem_text: str | None = None,
) -> str | None:
    """
    Réponse détaillée sur un cas de la dernière recherche. `stored_result` :
    le résultat gardé dans le contexte (position, intervention_id, symptômes recoupés).

    None si le cas n'existe plus en base : l'appelant garde alors la réponse
    déjà rédigée par le LLM de compréhension.
    """
    dossier = build_case_dossier(db, stored_result, device_type)
    if dossier is None:
        trace("CASE_DETAIL", "Cas introuvable en base, détail non construit")
        return None

    prompt = (
        "Tu es un assistant pour techniciens de maintenance ATM. "
        f"{llm_service.device_type_instruction(device_type)}"
        f"Le technicien cherchait une solution à ce problème : « {problem_text or 'non précisé'} ».\n"
        f"Il demande maintenant plus de détails sur le Cas {stored_result.get('position')} : « {technician_question} ».\n\n"
        "Voici TOUT ce que la base de données contient sur ce cas (intervention réelle d'un technicien) :\n"
        f"{_format_dossier(dossier)}\n\n"
        "Développe ce cas pour répondre à sa question : ce qui a été observé, ce qui a été essayé dans "
        "l'ordre et avec quel résultat, ce qui a finalement réglé le problème et pourquoi, "
        "et ce qu'il peut en retenir pour sa propre panne.\n"
        f"{_root_cause_instruction(dossier)}"
        "Appuie-toi uniquement sur ces faits pour tout ce qui concerne l'historique : "
        "n'invente aucune action, pièce, date ou résultat absent du dossier. "
        "Si une information manque (ex. résultat non détaillé), dis-le simplement. "
        "Tu peux ajouter tes propres conseils, introduits par « En complément, voici mes conseils de chatbot : », "
        "en 2 à 4 pistes courtes, non destructives, sans code de maintenance inventé.\n"
        "Commence par **Cas "
        f"{stored_result.get('position')}**. Utilise du Markdown simple : titres, **gras** et listes courtes ; "
        "pas de bloc de code autour de la réponse."
    )
    trace(
        "CASE_DETAIL",
        "Dossier complet du cas envoyé au LLM",
        position=stored_result.get("position"),
        symptom_count=len(dossier["symptoms"]),
        action_count=len(dossier["actions"]),
        has_root_cause_component=bool(dossier["root_cause_component"]),
        has_summary=bool(dossier["summary_text"]),
        prompt_length=len(prompt),
    )
    return llm_service.generate_reply(prompt)


def build_case_dossier(db: Session, stored_result: dict, device_type: str | None = None) -> dict | None:
    """
    Toutes les informations d'un cas, table par table. Part du résumé de la
    recherche (build_case : nom du technicien, fiabilité, solutions ajoutées
    après coup) et ajoute ce que la recherche ne lit pas. None si l'intervention n'existe plus.
    """
    intervention_id = stored_result["intervention_id"]
    case = case_retrieval_service.build_case(
        db,
        intervention_id,
        device_type=device_type,
        matched_symptom_text=stored_result.get("matched_symptom_text"),
        matched_symptoms=stored_result.get("matched_symptoms"),
    )
    if case is None:
        return None

    intervention = db.get(Intervention, intervention_id)
    device = intervention.device
    model = db.get(DeviceModel, device.model_id) if device and device.model_id else None
    manufacturer = db.get(Manufacturer, model.manufacturer_id) if model and model.manufacturer_id else None
    diagnosis = db.query(Diagnosis).filter(Diagnosis.intervention_id == intervention_id).first()

    symptoms = sorted(intervention.symptoms, key=lambda s: s.intervention_symptom_id)
    # Numéro du symptôme dans CE cas, pour dire quelle action visait lequel.
    symptom_numbers = {s.intervention_symptom_id: number for number, s in enumerate(symptoms, start=1)}
    matched_texts = {m["raw_text"] for m in case["matched_symptoms"]} | {case.get("matched_symptom_text")}
    # Même ordre que build_case : les deux listes se correspondent une à une.
    actions = sorted(intervention.actions, key=lambda a: a.sequence_order)

    return {
        "technician_name": case["technician_name"],
        "ticket_reference": intervention.ticket_reference,
        "opened_at": intervention.opened_at,
        "closed_at": intervention.closed_at,
        "final_outcome_status": intervention.final_outcome_status,
        "summary_text": intervention.summary_text,
        "device": {
            "device_type": getattr(device, "device_type", None),
            "model_name": getattr(model, "model_name", None),
            "manufacturer": getattr(manufacturer, "name", None),
            "serial_number": getattr(device, "serial_number", None),
            "site_name": getattr(device, "site_name", None),
            "address": getattr(device, "address", None),
        },
        "symptoms": [
            {
                "number": symptom_numbers[s.intervention_symptom_id],
                "raw_text": s.raw_text,
                "severity": s.severity,
                "matched_search": s.raw_text in matched_texts,
            }
            for s in symptoms
        ],
        "actions": [
            {
                "sequence_order": a.sequence_order,
                "raw_text": a.raw_text,
                "performed_at": a.performed_at,
                "result_description": a.result_description,
                "outcome_status": a.outcome_status,
                "is_confirmed_solution": a.is_confirmed_solution,
                "targets_symptom_number": symptom_numbers.get(a.targets_symptom_id),
                "proposed_by": summary["proposed_by"],
            }
            for a, summary in zip(actions, case["actions"])
        ],
        "diagnosis": diagnosis.description if diagnosis else None,
        "diagnosis_confirmed": bool(diagnosis and diagnosis.confirmed),
        "root_cause_component": _root_cause_component(db, diagnosis),
        "confidence": case["confidence"],
    }


def _root_cause_component(db: Session, diagnosis: Diagnosis | None) -> str | None:
    """La pièce en cause : le texte libre, sinon le nom de la pièce du catalogue (anciennes données)."""
    if diagnosis is None:
        return None
    if (diagnosis.root_cause_component_text or "").strip():
        return diagnosis.root_cause_component_text.strip()
    component = db.get(Component, diagnosis.root_cause_component_id) if diagnosis.root_cause_component_id else None
    return getattr(component, "name", None)


def _root_cause_instruction(dossier: dict) -> str:
    """Consigne sur la pièce en cause : la citer si la base la donne, ne jamais l'inventer sinon."""
    if dossier["root_cause_component"]:
        return (
            f"La base de données indique que la pièce en cause est : « {dossier['root_cause_component']} ». "
            "Cite-la clairement dans ta réponse, en gras, comme pièce en cause selon l'historique.\n"
        )
    return (
        "La base de données ne précise pas la pièce en cause pour ce cas : dis-le, "
        "et ne présente aucune pièce comme cause enregistrée.\n"
    )


def _format_dossier(dossier: dict) -> str:
    """Le dossier en lignes lisibles ; les informations absentes sont dites, jamais laissées vides."""
    device = dossier["device"]
    device_parts = [
        (device["device_type"] or "").upper() or None,
        " ".join(part for part in (device["manufacturer"], device["model_name"]) if part) or None,
        f"n° de série {device['serial_number']}" if device["serial_number"] else None,
        device["site_name"],
        device["address"],
    ]
    lines = [
        f"- Technicien : {dossier['technician_name']}",
        f"- Appareil : {', '.join(part for part in device_parts if part) or 'non identifié'}",
        f"- Ticket : {dossier['ticket_reference'] or 'non renseigné'}",
        f"- Début : {_format_date(dossier['opened_at'])} ; fin : {_format_date(dossier['closed_at'])}",
        f"- Bilan de l'intervention : {_INTERVENTION_OUTCOME_LABELS.get(dossier['final_outcome_status'], 'non renseigné')}",
        f"- Résumé de l'intervention : {dossier['summary_text'] or 'non renseigné'}",
        "- Symptômes observés :",
    ]
    for symptom in dossier["symptoms"]:
        severity = f" (gravité : {symptom['severity']})" if symptom["severity"] else ""
        matched = " -- recoupe la recherche du technicien" if symptom["matched_search"] else ""
        lines.append(f"  {symptom['number']}. « {symptom['raw_text']} »{severity}{matched}")

    lines.append("- Actions, dans l'ordre :")
    for action in dossier["actions"]:
        target = (
            f" ; visait le symptôme {action['targets_symptom_number']}"
            if action["targets_symptom_number"]
            else ""
        )
        when = f" ; faite le {_format_date(action['performed_at'])}" if action["performed_at"] else ""
        solution = " ; C'EST CETTE ACTION QUI A RÉGLÉ LE PROBLÈME" if action["is_confirmed_solution"] else ""
        added = (
            f" ; ajoutée après la visite, proposée par {action['proposed_by']} et validée par un administrateur"
            if action["proposed_by"]
            else ""
        )
        lines.append(
            f"  {action['sequence_order']}. « {action['raw_text']} » -> résultat : "
            f"« {action['result_description'] or 'non détaillé'} » "
            f"({_ACTION_OUTCOME_LABELS.get(action['outcome_status'], 'résultat non renseigné')}{target}{when}{solution}{added})"
        )

    if dossier["diagnosis"]:
        status = "confirmée" if dossier["diagnosis_confirmed"] else "non confirmée"
        lines.append(f"- Cause identifiée ({status}) : {dossier['diagnosis']}")
    else:
        lines.append("- Cause identifiée : non renseignée")
    lines.append(f"- Pièce en cause : {dossier['root_cause_component'] or 'non renseignée'}")
    if dossier["confidence"]:
        lines.append(
            f"- Fiabilité connue de la solution : {dossier['confidence']['accuracy_score']:.0%} "
            f"sur {dossier['confidence']['attempts']} cas"
        )
    return "\n".join(lines)


def _format_date(value) -> str:
    return f"{value:%d/%m/%Y à %H:%M}" if hasattr(value, "strftime") else "non renseignée"
