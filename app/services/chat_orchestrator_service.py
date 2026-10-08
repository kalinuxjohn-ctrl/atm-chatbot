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

_DEVICE_TYPE_REQUIRED_REPLY = (
    "Je n'ai pas pu déterminer le type d'appareil concerné. Sélectionne GAB ou TPE "
    "(ou précise-le dans ton message), puis renvoie la description du problème."
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
        context["device_type"] = device_type  # choix de l'interface : prime sur ce que dit le message

    conversation_service.save_message(db, conversation.conversation_id, "user", message)

    understood = message_understanding_service.understand_message(message, device_type=context.get("device_type"))
    trace(
        "ROUTING",
        "Orientation du message selon son intention",
        conversation_id=conversation.conversation_id,
        intent=understood.intent,
    )
    reply = _route_message(db, context, message, understood)

    conversation_service.save_message(db, conversation.conversation_id, "assistant", reply)
    context_service.save_context(db, conversation.conversation_id, context)
    conversation_service.mark_conversation_active(conversation)
    db.commit()
    trace(
        "RESPONSE",
        "Messages et contexte persistés",
        conversation_id=conversation.conversation_id,
    )

    return {"conversation_id": conversation.conversation_id, "reply": reply}


def _route_message(db: Session, context: dict, message: str, understood: UnderstoodMessage) -> str:
    if understood.intent == "detail_request":
        last_search = context.get("last_search")
        last_results = (last_search or {}).get("results") or []
        position = context_service.resolve_position_reference(message)

        # Pas d'ordinal dans le message ("pourquoi ça a marché ?") : on
        # reste sur le résultat déjà sélectionné, ou sur l'unique résultat.
        if position is None and last_results:
            selected = context.get("selected_result")
            if selected and selected.get("position") is not None:
                position = selected["position"]
            elif len(last_results) == 1:
                position = last_results[0].get("position", 1)

        if position is not None and last_search:
            trace("ROUTING", "Demande de détail sur un résultat précédent", position=position)
            return _handle_result_detail_request(db, context, position, message)

        if last_results:
            trace("ROUTING", "Demande de détail ambiguë, précision demandée", result_count=len(last_results))
            return (
                f"La dernière recherche a donné {len(last_results)} résultats : lequel veux-tu détailler ? "
                "(par exemple « le premier » ou « le deuxième »)"
            )

        trace("ROUTING", "Demande de détail sans référence exploitable, réponse conversationnelle")
        return llm_service.generate_reply(
            "Tu es un assistant pour techniciens de maintenance ATM. "
            f"{llm_service.device_type_instruction(context.get('device_type'))}"
            "Le technicien semble demander "
            "un détail, mais aucune recherche récente n'est disponible. Invite-le à décrire son problème. "
            f"Message : « {message} »"
        )

    if understood.intent == "diagnostic":
        return _handle_symptom_search(db, context, understood, message)

    trace("ROUTING", "Réponse conversationnelle sans recherche vectorielle")
    # C'est ICI, et non dans le prompt de compréhension (qui ne renvoie que
    # du JSON), que se décide la réponse aux messages hors-sujet.
    return llm_service.generate_reply(
        "Tu es un assistant pour techniciens de maintenance ATM (GAB et TPE). Tu ne réponds "
        "qu'aux sujets liés à la maintenance de ces équipements.\n"
        f"{llm_service.device_type_instruction(context.get('device_type'))}"
        "- Salutation ou remerciement : réponds brièvement et poliment.\n"
        "- Message sans rapport avec la maintenance d'un GAB ou d'un TPE : réponds exactement "
        "« Désolé, je ne suis pas fait pour répondre à ce type de question. Voulez-vous de "
        "l'aide avec votre équipement à la place ? »\n"
        "N'invente aucune donnée technique.\n"
        f"Message du technicien : « {message} »"
    )


def _handle_symptom_search(
    db: Session, context: dict, understood: UnderstoodMessage, message: str | None = None
) -> str:
    # Repli sur le message brut : un LLM qui classe en "diagnostic" sans
    # remplir la reformulation ne doit pas lancer une recherche à vide.
    search_text = (understood.reformulated_problem_text or "").strip() or (message or "").strip()

    # Résolution déterministe, mémorisée dans le contexte. Les IDs résolus
    # (model_id, error_code_id) ne servent pas encore de filtre SQL : la
    # recherche filtre par device_type, et par NOM de modèle si le message
    # en cite un (voir model_name plus bas).
    resolved = technical_reference_resolver_service.resolve_technical_references(
        db,
        device_type_text=understood.device_type_text,
        model_name_text=understood.model_name_text,
        error_code_text=understood.error_code_text,
    )
    context.update({key: value for key, value in resolved.items() if key != "device_type"})

    # Le type choisi dans l'interface (déjà dans le contexte) PRIME sur celui
    # que le technicien mentionne. Le message ne sert que si aucun type n'a
    # été choisi -- et seulement une valeur VALIDÉE ("gab"/"tpe") par le
    # résolveur, jamais le texte brut du LLM.
    device_type = context.get("device_type") or resolved.get("device_type")
    if device_type:
        context["device_type"] = device_type

    trace(
        "PROCESSING",
        "Texte reformulé préparé pour le diagnostic",
        search_text_length=len(search_text),
        has_device_type=bool(device_type),
    )
    trace(
        "CONTEXT",
        "Références mémorisées, filtres de recherche : type d'appareil (+ modèle si cité)",
        reference_count=len(resolved),
        has_device_type=bool(device_type),
    )

    if not device_type:
        # Sans type d'appareil, la recherche (filtrée par device_type) ne
        # peut rien trouver : on le demande plutôt que de répondre à tort
        # "aucune intervention connue".
        trace("RESPONSE", "Type d'appareil inconnu, précision demandée au technicien")
        return _DEVICE_TYPE_REQUIRED_REPLY

    # Service d'embedding indisponible : EmbeddingUnavailableError remonte
    # telle quelle -> 503 « chatbot saturé » (app/main.py), cause précise
    # dans les journaux. Aucun message technique dans la conversation.
    # Modèle pris dans le JSON de CE message uniquement (pas dans le contexte) :
    # un modèle cité dans un message précédent ne doit pas filtrer celui-ci.
    # null -> aucun filtre modèle, seul device_type s'applique.
    model_name = (understood.model_name_text or "").strip() or None

    cases = case_retrieval_service.find_similar_cases(
        db, raw_text=search_text, device_type=device_type, model_name=model_name
    )

    if cases:
        results = [
            {
                "position": index + 1,
                "kind": "case",
                "intervention_id": case["intervention_id"],
                # Gardé en mémoire : c'est la recherche qui sait QUEL symptôme
                # a fait remonter ce cas -- sans lui, « détaille le deuxième »
                # ne pourrait plus l'afficher (voir _handle_result_detail_request).
                "matched_symptom_text": case.get("matched_symptom_text"),
            }
            for index, case in enumerate(cases)
        ]
        context_service.record_last_search(context, query=search_text, results=results)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Cas réels mémorisés pour le suivi", result_count=len(results))
        return _summarize_cases(search_text, cases, device_type)

    # Repli : aucun cas réel, mais peut-être des stats agrégées.
    trace("SEARCH", "Aucun cas réel, recherche de statistiques agrégées")
    aggregated = retrieval_service.find_ranked_solutions(
        db, raw_text=search_text, device_type=device_type, model_name=model_name
    )

    solutions = aggregated["solutions"]

    if solutions:
        results = [_stat_result(index + 1, s) for index, s in enumerate(solutions)]
        context_service.record_last_search(context, query=search_text, results=results)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Solutions agrégées mémorisées pour le suivi", result_count=len(results))
        return llm_service.summarize_solutions(search_text, solutions, device_type=device_type)

    context_service.record_last_search(context, query=search_text, results=[])
    trace("RESPONSE", "Aucun cas ni solution, réponse déterministe sans LLM de synthèse", has_model_filter=bool(model_name))
    if model_name:
        # Le filtre modèle a pu tout éliminer : on le dit explicitement, pour
        # que le technicien sache que la recherche portait sur CE modèle.
        return (
            f"Aucune intervention ni statistique connue pour ce symptôme sur un "
            f"{device_type.upper()} de modèle « {model_name} »."
        )
    return "Aucune intervention ni statistique connue pour ce symptôme dans l'historique."


def _stat_result(position: int, solution: dict) -> dict:
    """
    Résultat agrégé mémorisé dans le contexte (JSONB) : valeurs converties
    en types JSON simples (accuracy_score est un Decimal côté SQL, non
    sérialisable tel quel).
    """
    accuracy = solution.get("accuracy_score")
    return {
        "position": position,
        "kind": "stat",
        "symptom_id": solution.get("symptom_id"),
        "action_id": solution.get("action_id"),
        "symptom_text": solution.get("symptom_text"),
        "action_text": solution.get("action_text"),
        "attempts": solution.get("attempts"),
        "successes": solution.get("successes"),
        "accuracy_score": float(accuracy) if accuracy is not None else None,
    }


def _handle_result_detail_request(db: Session, context: dict, position: int, message: str) -> str:
    resultat = context_service.select_result_by_position(context, position)
    if resultat is None:
        trace("CONTEXT", "Position absente de la dernière recherche", position=position)
        return f"Je n'ai pas de résultat en position {position} dans la dernière recherche."

    kind = resultat.get("kind") or _infer_legacy_kind(resultat)

    if kind == "case":
        case = case_retrieval_service.build_case(
            db,
            resultat["intervention_id"],
            device_type=context.get("device_type"),
            # .get() : les recherches enregistrées avant ce champ ne l'ont pas
            # -- elles retombent simplement sur « non précisé », sans erreur.
            matched_symptom_text=resultat.get("matched_symptom_text"),
        )
        if case is None:
            trace("SEARCH", "Cas sélectionné indisponible", position=position)
            return "Ce cas ne semble plus disponible en base."
        case_text = _format_case(case)
        prompt = (
            "Tu es un assistant pour techniciens de maintenance ATM. "
            f"{llm_service.device_type_instruction(context.get('device_type'))}"
            "Voici le cas que le "
            f"technicien approfondit :\n{case_text}\n\n"
            f"Le technicien demande : « {message} ». Réponds UNIQUEMENT à partir de ces informations, "
            "sans en inventer d'autres."
        )
        trace("CONTEXT", "Contexte LLM préparé pour le détail d'un cas", position=position)
        return llm_service.generate_reply(prompt, fallback=case_text)

    if kind == "stat" and resultat.get("action_text"):
        trace("CONTEXT", "Détail d'un résultat agrégé", position=position)
        return _format_stat_result(resultat)

    trace("CONTEXT", "Résultat d'ancien format non détaillable", position=position)
    return "Ce résultat vient d'une ancienne recherche et n'est plus détaillable dans ce format -- relance une nouvelle recherche."


def _infer_legacy_kind(resultat: dict) -> str:
    return "case" if "intervention_id" in resultat else "stat"


def _format_stat_result(resultat: dict) -> str:
    fiabilite = ""
    if resultat.get("accuracy_score") is not None:
        fiabilite = (
            f", réussie {resultat.get('successes')}/{resultat.get('attempts')} fois "
            f"(fiabilité {resultat['accuracy_score']:.0%})"
        )
    return (
        f"Résultat {resultat['position']} : action « {resultat['action_text']} » "
        f"pour le symptôme « {resultat.get('symptom_text') or 'non précisé'} »{fiabilite}."
    )


def _summarize_cases(raw_text: str, cases: list[dict], device_type: str | None = None) -> str:
    if not cases:
        return "Aucun cas similaire trouvé dans l'historique."

    lignes = "\n".join(_format_case(case, index + 1) for index, case in enumerate(cases))

    prompt = (
        "Tu es un assistant pour techniciens de maintenance ATM. "
        f"{llm_service.device_type_instruction(device_type)}"
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
    # Si le LLM est indisponible, le technicien voit quand même les cas trouvés.
    return llm_service.generate_reply(prompt, fallback=f"Cas similaires trouvés dans l'historique :\n{lignes}")


def _format_case(case: dict, index: int | None = None) -> str:
    actions_txt = " puis ".join(a["description"] for a in case["actions"]) or "aucune action enregistrée"
    fiabilite = (
        f" (fiabilité connue : {case['confidence']['accuracy_score']:.0%} sur {case['confidence']['attempts']} cas)"
        if case.get("confidence")
        else ""
    )
    prefixe = f"Cas {index}" if index is not None else "Cas"
    return (
        f"{prefixe} ({case['technician_name']}, {case['device_label']}) : symptôme « {case.get('matched_symptom_text') or 'non précisé'} », "
        f"actions tentées : {actions_txt}, résultat : {case.get('final_outcome_status') or 'non renseigné'}{fiabilite}."
    )
