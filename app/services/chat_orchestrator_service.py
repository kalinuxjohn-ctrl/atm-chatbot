"""
Coordination du endpoint POST /api/chat.

ORCHESTRE seulement : text_validation_service (nettoyage et validation
locale, AVANT tout appel au LLM : le bruit ne coûte aucun jeton),
greeting_service (réponses locales aux salutations et présentations exactes),
message_understanding_service (un appel LLM : comprendre ET répondre hors
diagnostic), technical_reference_resolver_service (résoudre le texte en IDs
réels), context_service (mémoire de la conversation), case_retrieval_service/
retrieval_service (recherche en base), llm_service (synthèse d'un diagnostic).

Partage des rôles : hors formules locales exactes, le LLM gère le langage (comprendre, détailler
un résultat, répondre aux questions), avec toute la conversation sous les yeux ;
la base gère les données (historique des interventions, statistiques).
Seul un diagnostic déclenche une recherche en base.
"""

from __future__ import annotations

from typing import Callable
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ReferenceNotFoundError
from app.core.tracing import trace
from app.models.fault import ErrorCode
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.schemas.photo_schema import PhotoAttachment
from app.services import (
    case_detail_service,
    case_retrieval_service,
    context_service,
    conversation_memory_service,
    conversation_service,
    error_code_service,
    greeting_service,
    llm_service,
    message_understanding_service,
    photo_ocr_service,
    retrieval_service,
    technical_reference_resolver_service,
)
from app.services.text_validation_service import REFORMULATION_REPLY, validate_and_clean_message

# Résultat de chaque action d'un cas (ENUM action_outcome, migration 0002).
_OUTCOME_LABELS = {
    "resolved": "problème réglé",
    "partial": "réglé en partie",
    "no_effect": "sans effet",
    "made_worse": "a aggravé le problème",
    "unknown": "résultat inconnu",
}

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
    photo: PhotoAttachment | None = None,
    on_reply_delta: Callable[[str], None] | None = None,
) -> dict:
    has_streamed = False

    def emit_delta(text: str) -> None:
        nonlocal has_streamed
        if on_reply_delta is not None:
            on_reply_delta(text)
            has_streamed = has_streamed or bool(text)

    conversation = conversation_service.get_or_create_conversation(db, conversation_id, technician_id)
    context = context_service.get_context(db, conversation.conversation_id)
    trace(
        "CONTEXT",
        "Conversation et contexte chargés",
        conversation_id=conversation.conversation_id,
        has_previous_search=bool(context.get("last_search")),
    )

    if device_type is not None:
        if context.get("device_type") and context["device_type"] != device_type:
            for key in ("error_code", "error_code_id", "error_code_reference"):
                context.pop(key, None)
        context["device_type"] = device_type  # choix de l'interface : prime sur ce que dit le message

    # None si aucune photo n'est jointe ou si la fonctionnalité est désactivée.
    photo = photo_ocr_service.accept_photo(photo)

    validation = validate_and_clean_message(message)
    trace(
        "VALIDATION",
        "Message utilisateur évalué",
        conversation_id=conversation.conversation_id,
        valid=validation.valid,
        reason=validation.reason,
    )
    # Avec une photo, un texte vide ou inexploitable part quand même au LLM :
    # c'est la photo qui porte l'information.
    can_understand = validation.valid or photo is not None
    technician_text = validation.cleaned_text if validation.valid else photo_ocr_service.PHOTO_ONLY_MESSAGE
    local_reply = greeting_service.get_reply(technician_text) if validation.valid and photo is None else None

    # Comparé après le routage : record_last_search remplace l'objet, donc une
    # identité différente = une nouvelle recherche a eu lieu pendant CE message.
    search_before = context.get("last_search")
    detected_error_code = None
    detected_error_code_id = None

    # La compréhension appelle déjà le LLM : la validation doit la précéder.
    if local_reply is not None:
        conversation_service.save_message(db, conversation.conversation_id, "user", technician_text)
        reply = local_reply
        trace(
            "ROUTING", "Réponse locale, sans appel LLM ni recherche",
            conversation_id=conversation.conversation_id,
            intent="greeting",
        )
    elif can_understand:
        # Lu avant d'enregistrer le message courant, uniquement si le LLM est nécessaire.
        history = _load_history(db, conversation.conversation_id, context)
        understood = message_understanding_service.understand_message(
            technician_text,
            device_type=context.get("device_type"),
            history=history,
            search_results_text=_describe_last_search(db, context),
            photo=photo,
        )
        # Enregistré après la compréhension : avec une photo, le texte lu
        # dessus est gardé avec le message (la photo, elle, ne l'est pas).
        technician_text = photo_ocr_service.add_reading_to_message(technician_text, photo, understood)
        user_message = conversation_service.save_message(db, conversation.conversation_id, "user", technician_text)
        trace(
            "ROUTING",
            "Orientation du message selon son intention",
            conversation_id=conversation.conversation_id,
            intent=understood.intent,
        )
        with llm_service.stream_reply(emit_delta if on_reply_delta is not None else None):
            reply = _route_message(db, context, technician_text, understood)
        if isinstance(understood.error_code_text, str) and understood.error_code_text.strip():
            detected_error_code = understood.error_code_text.strip()
            detected_error_code_id = context.get("error_code_id")
            user_message.detected_error_code = detected_error_code
            user_message.error_code_id = detected_error_code_id
        # Pour un code, la consigne est exclusivement celle du catalogue :
        # on garde la lecture de la photo, pas une signification inventée par le LLM.
        photo_reading = understood.model_copy(update={"photo_meaning": None}) if detected_error_code else understood
        reply = photo_ocr_service.add_reading_to_reply(reply, photo, photo_reading)
    else:
        conversation_service.save_message(db, conversation.conversation_id, "user", validation.cleaned_text)
        reply = REFORMULATION_REPLY

    if on_reply_delta is not None and not has_streamed:
        emit_delta(reply)
    assistant_message = conversation_service.save_message(db, conversation.conversation_id, "assistant", reply)
    if detected_error_code:
        assistant_message.detected_error_code = detected_error_code
        assistant_message.error_code_id = detected_error_code_id
    context_service.save_context(db, conversation.conversation_id, context)
    conversation_service.mark_conversation_active(conversation)
    if on_reply_delta is not None:
        emit_delta("")  # Une déconnexion doit encore annuler l'écriture avant le commit.
    db.commit()
    trace(
        "RESPONSE",
        "Messages et contexte persistés",
        conversation_id=conversation.conversation_id,
    )

    search_after = context.get("last_search")
    new_search = search_after is not None and search_after is not search_before
    new_search_with_results = new_search and bool((search_after or {}).get("results"))
    # Le LLM peut aussi écarter tous les candidats : reconnaître les formules
    # imposées par les prompts, pas seulement une liste SQL vide.
    normalized_reply = " ".join(reply.replace("*", "").replace("’", "'").casefold().split())
    no_relevant_history = any(
        sentence in normalized_reply
        for sentence in (
            "aucune intervention correspondant à ce problème n'a été trouvée dans notre base de données",
            "aucune solution correspondant à ce problème n'a été trouvée dans notre base de données",
        )
    )
    intervention_add_available = new_search and (not new_search_with_results or no_relevant_history)
    return {
        "conversation_id": conversation.conversation_id,
        "reply": reply,
        "detected_error_code": detected_error_code,
        "error_code_id": detected_error_code_id,
        "solution_proposal_available": new_search_with_results and not intervention_add_available,
        "intervention_add_available": intervention_add_available,
        "intervention_add_problem": search_after.get("query") if intervention_add_available else None,
    }


def _record_error_code_context(context: dict, code: str, record: ErrorCode | None) -> None:
    for key in ("error_code_id", "error_code_reference", "last_search", "selected_result"):
        context.pop(key, None)
    context["error_code"] = code
    context["intent"] = "error_code"
    if record is not None:
        context["error_code_id"] = record.error_code_id
        context["error_code_reference"] = {
            "catalog_number": record.catalog_number, "code": record.code,
            "reply": record.reply, "documentation": record.documentation,
        }


def handle_error_code_selection(
    db: Session, conversation_id: int | None, technician_id: int, device_type: str, error_code_id: int,
) -> dict:
    record = error_code_service.get_error_code_reply(db, error_code_id)
    if record.device_type != device_type:
        raise ReferenceNotFoundError("Ce code n'est pas disponible pour cet équipement.")
    conversation = conversation_service.get_or_create_conversation(db, conversation_id, technician_id)
    context = context_service.get_context(db, conversation.conversation_id)
    context["device_type"] = device_type
    _record_error_code_context(context, record.code, record)
    for role, content in (("user", f"Code erreur {record.code}"), ("assistant", record.reply)):
        saved = conversation_service.save_message(db, conversation.conversation_id, role, content)
        saved.detected_error_code = record.code
        saved.error_code_id = record.error_code_id
    context_service.save_context(db, conversation.conversation_id, context)
    conversation_service.mark_conversation_active(conversation)
    db.commit()
    return {
        "conversation_id": conversation.conversation_id, "reply": record.reply,
        "detected_error_code": record.code, "error_code_id": record.error_code_id,
    }


def _route_message(db: Session, context: dict, message: str, understood: UnderstoodMessage) -> str:
    if isinstance(understood.error_code_text, str) and understood.error_code_text.strip():
        code = understood.error_code_text.strip()
        device_type = context.get("device_type")
        if not device_type:
            device_type = technical_reference_resolver_service.resolve_technical_references(
                db, understood.device_type_text, None, None,
            ).get("device_type")
        if device_type:
            context["device_type"] = device_type
        record = error_code_service.find_exact_error_code(db, code, device_type)
        trace(
            "REFERENCES", "Code détecté recherché dans le catalogue",
            found=record is not None, has_reply=bool(record and record.reply),
        )
        _record_error_code_context(context, code, record)
        if record is not None and record.reply:
            return record.reply
        return (
            f"Aucune consigne enregistrée pour le code « {code} »"
            f"{f' sur {device_type.upper()}' if device_type else ''}. "
            "Vérifie le code affiché et le type d’appareil, ou décris les symptômes pour rechercher une intervention."
        )

    if understood.intent == "diagnostic":
        return _handle_symptom_search(db, context, understood, message)

    # Tout le reste : le LLM a déjà rédigé sa réponse, avec la conversation et
    # les résultats de la dernière recherche sous les yeux. Le backend retient
    # seulement le résultat dont il parle (sert de référence à une proposition
    # de solution), après avoir vérifié qu'il existe vraiment.
    if understood.result_position is not None:
        selected = context_service.select_result_by_position(context, understood.result_position)
        trace("CONTEXT", "Résultat de la dernière recherche désigné", found=selected is not None)
        # « Détaille le cas 2 » : le détail est rédigé à partir du dossier
        # complet du cas relu en base, plus seulement de son résumé.
        if understood.case_detail_requested and selected is not None and _is_case(selected):
            detailed_reply = case_detail_service.develop_case(
                db,
                selected,
                technician_question=message,
                device_type=context.get("device_type"),
                problem_text=(context.get("last_search") or {}).get("query"),
            )
            if detailed_reply is not None:
                return detailed_reply
    trace("ROUTING", "Réponse rédigée par le LLM, sans recherche vectorielle")
    return understood.reply


def _is_case(resultat: dict) -> bool:
    """Un cas réel (intervention) et non une statistique agrégée : seul un cas a un dossier en base."""
    return (resultat.get("kind") or _infer_legacy_kind(resultat)) == "case"


def _load_history(db: Session, conversation_id: int, context: dict) -> list[dict]:
    return conversation_memory_service.prepare_history(
        db, conversation_id, context, settings.chat_history_max_messages,
    )


def _describe_last_search(db: Session, context: dict) -> str | None:
    """
    Détail, lu en base, des résultats de la dernière recherche : c'est ce que
    le LLM utilise pour répondre à « détaille le cas 2 », plus la dernière
    consigne de code connue. None sans recherche ni référence de code.
    """
    last_search = context.get("last_search") or {}
    descriptions = []
    reference = context.get("error_code_reference")
    if reference and reference.get("reply"):
        descriptions.append(
            f"Référence du catalogue pour le code {reference['code']} "
            f"(n° {reference['catalog_number']}, pas une intervention réalisée) :\n{reference['reply']}"
        )
    for resultat in last_search.get("results") or []:
        kind = resultat.get("kind") or _infer_legacy_kind(resultat)
        if kind == "case":
            case = case_retrieval_service.build_case(
                db,
                resultat["intervention_id"],
                device_type=context.get("device_type"),
                matched_symptom_text=resultat.get("matched_symptom_text"),
                matched_symptoms=resultat.get("matched_symptoms"),
            )
            if case is not None:  # intervention supprimée depuis la recherche
                descriptions.append(_format_case(case, resultat.get("position")))
        elif resultat.get("action_text"):
            descriptions.append(_format_stat_result(resultat))
    if not descriptions:
        return None
    if not last_search:
        return "\n".join(descriptions)
    query = last_search.get("query") or "non précisé"
    symptoms_txt = _format_query_symptoms(last_search.get("symptoms"))
    return "\n".join([f"Problème recherché : « {query} »", *([symptoms_txt] if symptoms_txt else []), *descriptions])


def _handle_symptom_search(
    db: Session, context: dict, understood: UnderstoodMessage, message: str | None = None
) -> str:
    for key in ("error_code", "error_code_id", "error_code_reference"):
        context.pop(key, None)
    # Repli sur le message brut : un LLM qui classe en "diagnostic" sans
    # remplir la reformulation ne doit pas lancer une recherche à vide.
    search_text = (understood.reformulated_problem_text or "").strip() or (message or "").strip()
    # Chaque symptôme identifié par le LLM est cherché séparément (un
    # embedding chacun). Liste vide : le texte complet sert de symptôme unique.
    query_symptoms = [symptom.model_dump() for symptom in understood.symptoms][: settings.max_symptoms_per_message]

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
        symptom_count=len(query_symptoms),
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
    # telle quelle -> 503 « service indisponible » (app/main.py), cause précise
    # dans les journaux. Aucun message technique dans la conversation.
    # Modèle pris dans le JSON de CE message uniquement (pas dans le contexte) :
    # un modèle cité dans un message précédent ne doit pas filtrer celui-ci.
    # null -> aucun filtre modèle, seul device_type s'applique.
    model_name = (understood.model_name_text or "").strip() or None

    cases = case_retrieval_service.find_similar_cases(
        db, search_text=search_text, device_type=device_type, model_name=model_name, symptoms=query_symptoms
    )

    if cases:
        results = [
            {
                "position": index + 1,
                "kind": "case",
                "intervention_id": case["intervention_id"],
                # Gardé en mémoire : c'est la recherche qui sait QUEL symptôme
                # a fait remonter ce cas -- sans lui, « détaille le deuxième »
                # ne pourrait plus l'afficher (voir _describe_last_search).
                "matched_symptom_text": case.get("matched_symptom_text"),
                # Son ID : permet à une proposition de solution de pointer le bon intervention_symptom.
                "matched_intervention_symptom_id": case.get("matched_intervention_symptom_id"),
                # Tous les symptômes du technicien que ce cas recoupe.
                "matched_symptoms": case.get("matched_symptoms") or [],
            }
            for index, case in enumerate(cases)
        ]
        context_service.record_last_search(context, query=search_text, results=results, symptoms=query_symptoms)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Cas réels mémorisés pour le suivi", result_count=len(results))
        return _summarize_cases(search_text, cases, device_type, query_symptoms)

    # Repli : aucun cas réel, mais peut-être des stats agrégées.
    trace("SEARCH", "Aucun cas réel, recherche de statistiques agrégées")
    aggregated = retrieval_service.find_ranked_solutions(
        db,
        search_text=search_text,
        device_type=device_type,
        model_name=model_name,
        symptom_texts=[symptom["text"] for symptom in query_symptoms],
    )

    solutions = aggregated["solutions"]

    if solutions:
        results = [_stat_result(index + 1, s) for index, s in enumerate(solutions)]
        context_service.record_last_search(context, query=search_text, results=results, symptoms=query_symptoms)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Solutions agrégées mémorisées pour le suivi", result_count=len(results))
        return llm_service.summarize_solutions(search_text, solutions, device_type=device_type)

    context_service.record_last_search(context, query=search_text, results=[], symptoms=query_symptoms)
    trace("RESPONSE", "Aucun cas ni solution, suggestions du chatbot demandées", has_model_filter=bool(model_name))
    suggestions = _summarize_cases(search_text, [], device_type, query_symptoms)
    if model_name:
        # Le filtre modèle a pu tout éliminer : on le dit explicitement, pour
        # que le technicien sache que la recherche portait sur CE modèle.
        return (
            f"Aucune intervention ni statistique connue pour ce symptôme sur un "
            f"{device_type.upper()} de modèle « {model_name} ».\n\n{suggestions}"
        )
    return suggestions


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


def _summarize_cases(
    problem_text: str, cases: list[dict], device_type: str | None = None, symptoms: list[dict] | None = None
) -> str:
    lignes = "\n".join(_format_case(case, index + 1) for index, case in enumerate(cases)) or "Aucun cas candidat."
    # Consigne ajoutée seulement s'il y a plusieurs symptômes : avec un seul,
    # le prompt reste identique à avant.
    multi_symptom_instruction = (
        f"{_format_query_symptoms(symptoms)}\n"
        "Chaque symptôme a été cherché séparément : un cas peut en recouper un seul ou plusieurs. "
        "Pour chaque cas présenté, indique quels symptômes il recoupe (par leur numéro) ; "
        "un cas qui en recoupe plusieurs est en général plus proche du problème. "
        "Si un symptôme n'est recoupé par aucun cas pertinent, dis-le.\n"
        if symptoms and len(symptoms) > 1
        else ""
    )

    turn_context = (
        f"{llm_service.device_type_instruction(device_type)}"
        f"Un technicien décrit ce symptôme : « {problem_text} ».\n"
        f"{multi_symptom_instruction}"
        "Voici des cas candidats issus d'une recherche vectorielle, classés par similarité. "
        "Leur présence dans cette liste ne garantit PAS leur pertinence technique :\n"
        f"{lignes}"
    )
    instructions = (
        "Tu es un assistant pour techniciens de maintenance ATM. "
        "Avant de répondre, vérifie si le sens du problème du technicien correspond réellement "
        "aux symptômes, diagnostics et résultats décrits dans chaque cas. "
        "Un même type d'appareil ou une panne générique ne suffit pas : conserve les précisions "
        "du problème, notamment le composant, les circonstances et la cause annoncée "
        "(sans considérer cette cause comme un diagnostic confirmé). "
        "N'invente aucun lien technique pour rendre un cas pertinent. "
        "Par exemple, un GAB hors service avec des piles mortes ne correspond pas, à lui seul, "
        "à une carte retenue ou à une imprimante bloquée ; une action générique comme un reset "
        "ne suffit pas non plus à établir ce lien.\n"
        "Présente uniquement les cas dont les informations fournies établissent un lien technique "
        "avec le problème. Écarte ceux sans lien établi ou qui le contredisent. "
        "Si aucun cas ne convient, indique : "
        "« Aucune intervention correspondant à ce problème n'a été trouvée dans notre base de données. » "
        "Ne présente pas les actions des cas écartés comme des solutions historiques pertinentes.\n"
        "Sinon, résume les seuls cas pertinents en langage naturel, en expliquant brièvement "
        "le lien avec le problème et les éventuelles limites. Conserve leurs numéros d'origine "
        "(par exemple Cas 2 reste Cas 2 si Cas 1 est écarté). "
        "N'invente AUCUNE information historique absente des cas fournis. "
        "Respecte l'origine indiquée : un ajout d'origine admin ne provient pas d'une visite de technicien. "
        "Tu peux présenter une piste indirecte dans une section **Pistes indirectes de l'historique**, "
        "uniquement si les détails fournis établissent un lien de composant ou de fonction précis ; "
        "explique les différences de symptômes et ne la présente pas comme une correspondance directe. "
        "Par exemple, une réinitialisation de lecteur ayant rétabli l'acceptation des cartes peut être "
        "une piste indirecte pour des cartes rejetées, même si le symptôme initial était une carte retenue.\n"
        "Que des cas conviennent ou non, propose si possible 2 à 4 vérifications adaptées au problème "
        "en les introduisant simplement par : "
        "« Néanmoins, en tant que chatbot d'aide à la maintenance, je peux te conseiller ces vérifications : » "
        "si aucun cas ne convient ; sinon utilise « En complément, voici mes conseils de chatbot : ». "
        "Cette introduction suffit à distinguer tes conseils des faits de la base : "
        "n'ajoute pas de long avertissement, de titre « hors base de données » ni de formule « Notez bien ». "
        "Présente-les comme des pistes à vérifier, pas comme un diagnostic certain. "
        "Privilégie les contrôles non destructifs et les procédures constructeur ; "
        "n'invente ni code de maintenance ni contournement des sécurités. "
        "Si les informations ne suffisent pas, demande les précisions utiles plutôt que d'inventer.\n"
        "Utilise du Markdown simple : **Cas 1**, titres et listes courtes ; pas de bloc de code autour de la réponse."
    )
    trace(
        "CONTEXT",
        "Contexte de synthèse préparé (LLM niveau 2)",
        case_count=len(cases),
        prompt_length=len(instructions) + len(turn_context),
    )
    return llm_service.generate_chat_reply(
        instructions, [{"role": "user", "content": turn_context}], cache_history=True,
    )


def _format_case(case: dict, index: int | None = None) -> str:
    # Les solutions ajoutées après validation d'une proposition ne faisaient
    # PAS partie de la visite : elles sont présentées à part.
    visit_actions = [a for a in case["actions"] if not a.get("proposed_by")]
    validated_additions = [a for a in case["actions"] if a.get("proposed_by")]
    actions_txt = " puis ".join(
        f"{a['description']} ({_OUTCOME_LABELS.get(a.get('outcome_status'), 'résultat non renseigné')})"
        for a in visit_actions
    ) or "aucune action enregistrée"
    opened_at = case.get("opened_at")
    date_txt = f", le {opened_at:%d/%m/%Y}" if hasattr(opened_at, "strftime") else ""
    diagnostic_txt = f" Diagnostic : {case['diagnosis']}." if case.get("diagnosis") else ""
    fiabilite = (
        f" (fiabilité connue : {case['confidence']['accuracy_score']:.0%} sur {case['confidence']['attempts']} cas)"
        if case.get("confidence")
        else ""
    )
    additions_txt = "".join(
        f" Solution ajoutée ensuite, proposée par {a['proposed_by']} et validée par un administrateur : "
        f"{a['description']} ({'problème réglé' if a.get('is_confirmed_solution') else 'réglé en partie'})."
        for a in validated_additions
    )
    prefixe = f"Cas {index}" if index is not None else "Cas"
    author = "origine admin, ajout direct" if case.get("origin") == "admin" else case["technician_name"]
    return (
        f"{prefixe} ({author}, {case['device_label']}{date_txt}) : {_format_matched_symptoms(case)}, "
        f"actions tentées : {actions_txt}, résultat : {case.get('final_outcome_status') or 'non renseigné'}{fiabilite}."
        f"{diagnostic_txt}{additions_txt}"
    )


def _format_query_symptoms(symptoms: list[dict] | None) -> str | None:
    """« Symptômes du technicien : 1. ... ; 2. ... », ou None sans symptôme."""
    if not symptoms:
        return None
    listed = " ; ".join(f"{symptom['number']}. « {symptom['text']} »" for symptom in symptoms)
    return f"Symptômes du technicien, cherchés séparément : {listed}."


def _format_matched_symptoms(case: dict) -> str:
    """
    Les symptômes du cas qui ont répondu à la recherche, chacun relié au
    symptôme du technicien qu'il recoupe. Anciennes recherches (sans
    matched_symptoms) : le seul symptôme mémorisé.
    """
    matched_symptoms = case.get("matched_symptoms") or []
    if not matched_symptoms:
        return f"symptôme « {case.get('matched_symptom_text') or 'non précisé'} »"
    listed = " ; ".join(
        f"« {match['raw_text']} » (recoupe le symptôme {match['query_symptom_number']} du technicien)"
        for match in matched_symptoms
    )
    label = "symptômes recoupés" if len(matched_symptoms) > 1 else "symptôme recoupé"
    return f"{label} : {listed}"
