"""
Coordination du endpoint POST /api/chat.

ORCHESTRE seulement : message_understanding_service (Niveau 1, comprendre),
technical_reference_resolver_service (résoudre le texte en IDs réels),
context_service (mémoire + position), case_retrieval_service/
retrieval_service (recherche, inchangés), llm_service (Niveau 2, synthèse,
inchangé).

Le routage suit l'intention renvoyée par message_understanding_service --
chaque message passe par le LLM de compréhension (voir diagramme :
Technicien -> message -> Chat Orchestrator -> Niveau 1).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tracing import trace
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import (
    case_retrieval_service,
    context_service,
    conversation_service,
    llm_service,
    message_understanding_service,
    retrieval_service,
    technical_reference_resolver_service,
)


def handle_chat_message(
    db: Session,
    conversation_id: int | None,
    technician_id: int,
    message: str,
    device_type: str | None = None,
) -> dict:
    conversation = conversation_service.get_or_create_conversation(db, conversation_id, technician_id)
    context = context_service.get_context(db, conversation.conversation_id)
    trace(
        "CONTEXT",
        "Conversation et contexte chargés",
        conversation_id=conversation.conversation_id,
        has_previous_search=bool(context.get("last_search")),
    )

    if device_type is not None:
        context["device_type"] = device_type  # device_type explicite du frontend, prioritaire au départ

    conversation_service.save_message(db, conversation.conversation_id, "user", message)

    understood = message_understanding_service.understand_message(message)
    trace(
        "ROUTING",
        "Orientation du message selon son intention",
        conversation_id=conversation.conversation_id,
        intent=understood.intent,
    )
    reply = _route_message(db, context, message, understood)

    conversation_service.save_message(db, conversation.conversation_id, "assistant", reply)
    context_service.save_context(db, conversation.conversation_id, context)
    db.commit()
    trace(
        "RESPONSE",
        "Messages et contexte persistés",
        conversation_id=conversation.conversation_id,
    )

    return {"conversation_id": conversation.conversation_id, "reply": reply}


def _route_message(db: Session, context: dict, message: str, understood: UnderstoodMessage) -> str:
    if understood.intent == "detail_request":
        position = context_service.resolve_position_reference(message)
        if position is not None and context.get("last_search"):
            trace("ROUTING", "Demande de détail sur un résultat précédent", position=position)
            return _handle_result_detail_request(db, context, position, message)
        trace("ROUTING", "Demande de détail sans référence exploitable, réponse conversationnelle")
        return llm_service.generate_reply(
            "Tu es un assistant pour techniciens de maintenance ATM. Le technicien semble demander "
            f"un détail, mais aucune recherche récente n'est disponible. Message : « {message} »"
        )

    if understood.intent == "diagnostic":
        return _handle_symptom_search(db, context, understood)

    trace("ROUTING", "Réponse conversationnelle sans recherche vectorielle")
    return llm_service.generate_reply(
        "Tu es un assistant pour techniciens de maintenance ATM. Réponds brièvement "
        f"au message suivant, sans inventer de données techniques : « {message} »"
    )


def _handle_symptom_search(db: Session, context: dict, understood: UnderstoodMessage) -> str:
    search_text = understood.reformulated_problem_text or ""
    trace(
        "PROCESSING",
        "Texte reformulé préparé pour le diagnostic",
        search_text_length=len(search_text),
        has_device_type=bool(understood.device_type_text or context.get("device_type")),
    )

    device_type = understood.device_type_text or context.get("device_type")
    if device_type:
        context["device_type"] = device_type

    # Résolution déterministe -- mémorisée dans le contexte dès maintenant,
    # mais PAS ENCORE utilisée comme filtre SQL par case_retrieval_service/
    # retrieval_service (prochaine étape : pour l'instant device_type reste
    # le seul filtre réel appliqué à la recherche).
    resolved = technical_reference_resolver_service.resolve_technical_references(
        db,
        device_type_text=understood.device_type_text,
        model_name_text=understood.model_name_text,
        error_code_text=understood.error_code_text,
    )
    context.update({key: value for key, value in resolved.items() if key != "device_type"})
    trace(
        "CONTEXT",
        "Références mémorisées, filtre de recherche limité au type d'appareil",
        reference_count=len(resolved),
        has_device_type=bool(device_type),
    )

    cases = case_retrieval_service.find_similar_cases(db, raw_text=search_text, device_type=device_type)

    if cases:
        results = [
            {"position": index + 1, "kind": "case", "intervention_id": case["intervention_id"]}
            for index, case in enumerate(cases)
        ]
        context_service.record_last_search(context, query=search_text, results=results)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Cas réels mémorisés pour le suivi", result_count=len(results))
        return _summarize_cases(search_text, cases)

    # Repli : aucun cas réel, mais peut-être des stats agrégées.
    trace("SEARCH", "Aucun cas réel, recherche de statistiques agrégées")
    aggregated = retrieval_service.find_ranked_solutions(db, raw_text=search_text, device_type=device_type)
    solutions = aggregated["solutions"]

    if solutions:
        results = [
            {"position": index + 1, "symptom_id": s["symptom_id"], "action_id": s["action_id"]}
            for index, s in enumerate(solutions)
        ]
        context_service.record_last_search(context, query=search_text, results=results)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Solutions agrégées mémorisées pour le suivi", result_count=len(results))
        return llm_service.summarize_solutions(search_text, solutions)

    context_service.record_last_search(context, query=search_text, results=[])
    trace("RESPONSE", "Aucun cas ni solution, réponse déterministe sans LLM de synthèse")
    return "Aucune intervention ni statistique connue pour ce symptôme dans l'historique."


def _handle_result_detail_request(db: Session, context: dict, position: int, message: str) -> str:
    resultat = context_service.select_result_by_position(context, position)
    if resultat is None:
        trace("CONTEXT", "Position absente de la dernière recherche", position=position)
        return f"Je n'ai pas de résultat en position {position} dans la dernière recherche."

    kind = resultat.get("kind") or _infer_legacy_kind(resultat)

    if kind == "case":
        case = case_retrieval_service.build_case(
            db, resultat["intervention_id"], device_type=context.get("device_type")
        )
        if case is None:
            trace("SEARCH", "Cas sélectionné indisponible", position=position)
            return "Ce cas ne semble plus disponible en base."
        prompt = (
            "Tu es un assistant pour techniciens de maintenance ATM. Voici le cas que le "
            f"technicien approfondit :\n{_format_case(case)}\n\n"
            f"Le technicien demande : « {message} ». Réponds UNIQUEMENT à partir de ces informations, "
            "sans en inventer d'autres."
        )
        trace("CONTEXT", "Contexte LLM préparé pour le détail d'un cas", position=position)
        return llm_service.generate_reply(prompt)

    trace("CONTEXT", "Résultat agrégé ou ancien format non détaillable", position=position)
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
        "Contexte de synthèse préparé (LLM niveau 2)",
        case_count=len(cases),
        prompt_length=len(prompt),
    )
    return llm_service.generate_reply(prompt)


def _format_case(case: dict, index: int | None = None) -> str:
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