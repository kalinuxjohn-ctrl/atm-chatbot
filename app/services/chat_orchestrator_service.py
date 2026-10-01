"""
Coordination du endpoint POST /api/chat (spec §14).

Ce fichier ORCHESTRE seulement : il n'implémente ni la recherche de cas
(case_retrieval_service, nouveau), ni la génération de texte (llm_service,
inchangé), ni le stockage (conversation_service), ni la résolution de
références (context_service).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.services import case_retrieval_service, context_service, conversation_service, llm_service


def handle_chat_message(
    db: Session,
    conversation_id: int | None,
    technician_id: int,
    message: str,
    device_type: str | None = None,
) -> dict:
    conversation = conversation_service.get_or_create_conversation(db, conversation_id, technician_id)
    trace(
        "REQUEST",
        "Conversation prête pour le traitement",
        conversation_id=conversation.conversation_id,
    )
    context = context_service.get_context(db, conversation.conversation_id)
    trace(
        "CONTEXT",
        "Contexte de conversation chargé",
        conversation_id=conversation.conversation_id,
        has_previous_search=bool(context.get("last_search")),
    )

    if device_type is not None:
        context["device_type"] = device_type  # mémorisé une fois, réutilisé les tours suivants

    conversation_service.save_message(db, conversation.conversation_id, "user", message)
    trace(
        "PROCESSING",
        "Analyse du message utilisateur",
        conversation_id=conversation.conversation_id,
    )
    reply = _route_message(db, context, message)
    conversation_service.save_message(db, conversation.conversation_id, "assistant", reply)

    context_service.save_context(db, conversation.conversation_id, context)
    db.commit()
    trace(
        "RESPONSE",
        "Réponse et contexte persistés",
        conversation_id=conversation.conversation_id,
    )

    return {"conversation_id": conversation.conversation_id, "reply": reply}


def _route_message(db: Session, context: dict, message: str) -> str:
    position = context_service.resolve_position_reference(message)

    if position is not None and context.get("last_search"):
        return _handle_result_detail_request(db, context, position, message)

    if _looks_like_symptom_description(message):
        return _handle_symptom_search(db, context, message)

    return llm_service.generate_reply(
        "Tu es un assistant pour techniciens de maintenance ATM. Réponds brièvement "
        f"au message suivant, sans inventer de données techniques : « {message} »"
    )


def _looks_like_symptom_description(message: str) -> bool:
    texte = message.strip().lower()
    mots_de_suivi = ("pourquoi", "quelle action", "et le résultat", "plus de détail", "plus de précision")
    if any(mot in texte for mot in mots_de_suivi):
        return False
    return len(texte) >= 15


def _handle_symptom_search(db: Session, context: dict, message: str) -> str:
    device_type = context.get("device_type")
    cases = case_retrieval_service.find_similar_cases(db, raw_text=message, device_type=device_type)

    results = [
        {"position": index + 1, "kind": "case", "intervention_id": case["intervention_id"]}
        for index, case in enumerate(cases)
    ]
    context_service.record_last_search(context, query=message, results=results)
    context["intent"] = "diagnostic"
    trace(
        "CONTEXT",
        "Contexte de diagnostic préparé",
        result_count=len(results),
        device_type=device_type,
    )

    return _summarize_cases(message, cases)


def _handle_result_detail_request(db: Session, context: dict, position: int, message: str) -> str:
    resultat = context_service.select_result_by_position(context, position)
    if resultat is None:
        return f"Je n'ai pas de résultat en position {position} dans la dernière recherche."

    kind = resultat.get("kind") or _infer_legacy_kind(resultat)

    if kind == "case":
        case = case_retrieval_service.build_case(
            db, resultat["intervention_id"], device_type=context.get("device_type")
        )
        if case is None:
            return "Ce cas ne semble plus disponible en base."
        prompt = (
            "Tu es un assistant pour techniciens de maintenance ATM. Voici le cas que le "
            f"technicien approfondit :\n{_format_case(case)}\n\n"
            f"Le technicien demande : « {message} ». Réponds UNIQUEMENT à partir de ces informations, "
            "sans en inventer d'autres."
        )
        return llm_service.generate_reply(prompt)

    # Rétrocompatibilité : conversations dont le contexte a été enregistré
    # avant l'ajout de la recherche par cas (ancien format {symptom_id, action_id}).
    return "Ce résultat vient d'une ancienne recherche et n'est plus détaillable dans ce format -- relance une nouvelle recherche."


def _infer_legacy_kind(resultat: dict) -> str:
    return "case" if "intervention_id" in resultat else "stat"


def _summarize_cases(raw_text: str, cases: list[dict]) -> str:
    if not cases:
        return "Aucun cas similaire trouvé dans l'historique."

    lignes = "\n".join(_format_case(case, index + 1) for index, case in enumerate(cases))

    prompt = (
        "Tu es un assistant pour techniciens de maintenance ATM. "
        f"Un technicien décrit ce symptôme : « {raw_text} ».\n"
        "Voici des cas réels déjà enregistrés, du plus au moins pertinent :\n"
        f"{lignes}\n\n"
        "Résume ces cas en langage naturel pour le technicien, en les distinguant clairement "
        "(garde l'ordre Cas 1 / Cas 2...). N'invente AUCUNE information absente de la liste ci-dessus."
    )
    trace(
        "CONTEXT",
        "Contexte LLM préparé à partir des cas similaires",
        case_count=len(cases),
        prompt_length=len(prompt),
    )
    return llm_service.generate_reply(prompt)


def _format_case(case: dict, index: int | None = None) -> str:
    """
    Formate un cas en une ligne de texte, réutilisée à la fois pour le
    résumé de plusieurs cas et pour le détail d'un seul -- pour ne pas
    dupliquer la mise en forme à deux endroits.
    """
    actions_txt = " puis ".join(a["description"] for a in case["actions"]) or "aucune action enregistrée"
    fiabilite = (
        f" (fiabilité connue : {case['confidence']['accuracy_score']:.0%} sur {case['confidence']['attempts']} cas)"
        if case.get("confidence")
        else ""
    )
    prefixe = f"Cas {index}" if index is not None else "Cas"
    return (
        f"{prefixe} ({case['technician_name']}, {case['device_label']}) : symptôme « {case['matched_symptom_text']} », "
        f"actions tentées : {actions_txt}, résultat : {case['final_outcome_status']}{fiabilite}."
    )