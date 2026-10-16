"""
Coordination du endpoint POST /api/chat.

ORCHESTRE seulement : text_validation_service (nettoyage et validation
locale, AVANT tout appel au LLM : le bruit ne coûte aucun jeton),
message_understanding_service (un appel LLM : comprendre ET répondre hors
diagnostic), technical_reference_resolver_service (résoudre le texte en IDs
réels), context_service (mémoire de la conversation), case_retrieval_service/
retrieval_service (recherche en base), llm_service (synthèse d'un diagnostic).

Partage des rôles : le LLM gère tout ce qui est langage (comprendre, détailler
un résultat, répondre aux questions), avec toute la conversation sous les yeux ;
la base gère les données (historique des interventions, statistiques).
Seul un diagnostic déclenche une recherche en base.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import settings
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

    validation = validate_and_clean_message(message)
    trace(
        "VALIDATION",
        "Message utilisateur évalué",
        conversation_id=conversation.conversation_id,
        valid=validation.valid,
        reason=validation.reason,
    )
    # Lu AVANT d'enregistrer le message courant : il est envoyé à part au LLM.
    history = _load_history(db, conversation.conversation_id) if validation.valid else []
    conversation_service.save_message(db, conversation.conversation_id, "user", validation.cleaned_text)

    # Comparé après le routage : record_last_search remplace l'objet, donc une
    # identité différente = une nouvelle recherche a eu lieu pendant CE message.
    search_before = context.get("last_search")

    # La compréhension appelle déjà le LLM : la validation doit la précéder.
    if validation.valid:
        understood = message_understanding_service.understand_message(
            validation.cleaned_text,
            device_type=context.get("device_type"),
            history=history,
            search_results_text=_describe_last_search(db, context),
        )
        trace(
            "ROUTING",
            "Orientation du message selon son intention",
            conversation_id=conversation.conversation_id,
            intent=understood.intent,
        )
        reply = _route_message(db, context, validation.cleaned_text, understood)
    else:
        reply = REFORMULATION_REPLY

    conversation_service.save_message(db, conversation.conversation_id, "assistant", reply)
    context_service.save_context(db, conversation.conversation_id, context)
    conversation_service.mark_conversation_active(conversation)
    db.commit()
    trace(
        "RESPONSE",
        "Messages et contexte persistés",
        conversation_id=conversation.conversation_id,
    )

    search_after = context.get("last_search")
    new_search_with_results = search_after is not search_before and bool((search_after or {}).get("results"))
    return {
        "conversation_id": conversation.conversation_id,
        "reply": reply,
        "solution_proposal_available": new_search_with_results,
    }


def _route_message(db: Session, context: dict, message: str, understood: UnderstoodMessage) -> str:
    if understood.intent == "diagnostic":
        return _handle_symptom_search(db, context, understood, message)

    # Tout le reste : le LLM a déjà rédigé sa réponse, avec la conversation et
    # les résultats de la dernière recherche sous les yeux. Le backend retient
    # seulement le résultat dont il parle (sert de référence à une proposition
    # de solution), après avoir vérifié qu'il existe vraiment.
    if understood.result_position is not None:
        selected = context_service.select_result_by_position(context, understood.result_position)
        trace("CONTEXT", "Résultat de la dernière recherche désigné", found=selected is not None)
    trace("ROUTING", "Réponse rédigée par le LLM, sans recherche vectorielle")
    return understood.reply


def _load_history(db: Session, conversation_id: int) -> list[dict]:
    """Anciens messages de la conversation, du plus ancien au plus récent (les plus récents si elle est très longue)."""
    return [
        {"role": message.role, "content": message.content}
        for message in conversation_service.get_recent_messages(
            db, conversation_id, limit=settings.chat_history_max_messages
        )
    ]


def _describe_last_search(db: Session, context: dict) -> str | None:
    """
    Détail, lu en base, des résultats de la dernière recherche : c'est ce que
    le LLM utilise pour répondre à « détaille le cas 2 ». None sans recherche.
    """
    last_search = context.get("last_search") or {}
    descriptions = []
    for resultat in last_search.get("results") or []:
        kind = resultat.get("kind") or _infer_legacy_kind(resultat)
        if kind == "case":
            case = case_retrieval_service.build_case(
                db,
                resultat["intervention_id"],
                device_type=context.get("device_type"),
                matched_symptom_text=resultat.get("matched_symptom_text"),
            )
            if case is not None:  # intervention supprimée depuis la recherche
                descriptions.append(_format_case(case, resultat.get("position")))
        elif resultat.get("action_text"):
            descriptions.append(_format_stat_result(resultat))
    if not descriptions:
        return None
    query = last_search.get("query") or "non précisé"
    return "\n".join([f"Problème recherché : « {query} »", *descriptions])


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
        db, search_text=search_text, device_type=device_type, model_name=model_name
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
        db, search_text=search_text, device_type=device_type, model_name=model_name
    )

    solutions = aggregated["solutions"]

    if solutions:
        results = [_stat_result(index + 1, s) for index, s in enumerate(solutions)]
        context_service.record_last_search(context, query=search_text, results=results)
        context["intent"] = "diagnostic"
        trace("CONTEXT", "Solutions agrégées mémorisées pour le suivi", result_count=len(results))
        return llm_service.summarize_solutions(search_text, solutions, device_type=device_type)

    context_service.record_last_search(context, query=search_text, results=[])
    trace("RESPONSE", "Aucun cas ni solution, suggestions du chatbot demandées", has_model_filter=bool(model_name))
    suggestions = _summarize_cases(search_text, [], device_type)
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


def _summarize_cases(problem_text: str, cases: list[dict], device_type: str | None = None) -> str:
    lignes = "\n".join(_format_case(case, index + 1) for index, case in enumerate(cases)) or "Aucun cas candidat."

    prompt = (
        "Tu es un assistant pour techniciens de maintenance ATM. "
        f"{llm_service.device_type_instruction(device_type)}"
        f"Un technicien décrit ce symptôme : « {problem_text} ».\n"
        "Voici des cas candidats issus d'une recherche vectorielle, classés par similarité. "
        "Leur présence dans cette liste ne garantit PAS leur pertinence technique :\n"
        f"{lignes}\n\n"
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
        prompt_length=len(prompt),
    )
    return llm_service.generate_reply(prompt)


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
    return (
        f"{prefixe} ({case['technician_name']}, {case['device_label']}{date_txt}) : symptôme « {case.get('matched_symptom_text') or 'non précisé'} », "
        f"actions tentées : {actions_txt}, résultat : {case.get('final_outcome_status') or 'non renseigné'}{fiabilite}."
        f"{diagnostic_txt}{additions_txt}"
    )
