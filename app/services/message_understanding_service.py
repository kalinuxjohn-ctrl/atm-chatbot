"""
Un seul appel au LLM par message validé : il comprend ce que le technicien
vient d'écrire ET, si ce n'est pas un diagnostic, lui répond directement.

Le LLM reçoit toute la conversation (anciens messages du technicien et du
chatbot), le type d'appareil choisi et le détail des résultats de la
dernière recherche (lus en base par le backend). Il renvoie un JSON (voir
message_understanding_schema.py) :

- intent "diagnostic"   -> le backend cherche en base (chat_orchestrator_service) ;
- intent "conversation" -> "reply" est la réponse du LLM, envoyée telle quelle :
  demandes de détail (« le cas 2 »), suivi, questions générales.

Ordre de la requête, pensé pour le cache de Claude (llm_service, cache_history) :
consigne système FIXE, puis les anciens messages tels qu'enregistrés -- ce
début est identique d'un tour à l'autre et relu depuis le cache --, puis le
dernier message, seul à changer : contexte du tour + message du technicien.

Passe par llm_service.generate_chat_reply() -- Claude ou Gemini, sans
dépendre du fournisseur choisi. Ne retourne jamais un ID interne (garantie
structurelle : voir message_understanding_schema.py).
"""

from __future__ import annotations

import json
import re

from app.core.tracing import trace
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import llm_service

# Texte FIXE : la moindre variation d'un appel à l'autre empêcherait Claude
# de relire la conversation depuis son cache. Tout ce qui change (type
# d'appareil, résultats de recherche) va dans le dernier message.
_SYSTEM_PROMPT = """Tu es le Copilote, l'assistant des techniciens de maintenance de GAB (distributeurs de billets) et de TPE (terminaux de paiement). Tu échanges en français avec un technicien sur le terrain.

Tu reçois toute la conversation avec ce technicien. Lis-la en entier avant de répondre : elle donne le contexte de son dernier message.

Le dernier message commence par un bloc [Contexte], ajouté par le système et non écrit par le technicien : type d'appareil choisi dans l'interface et résultats de la dernière recherche dans l'historique des interventions (lus en base, numérotés comme affichés au technicien). Le message du technicien suit, après [Message du technicien].

À CHAQUE message, réponds UNIQUEMENT par un objet JSON (pas de texte avant ou après, pas de balises markdown), avec exactement ces clés :
{
  "intent": "diagnostic" | "conversation",
  "device_type_text": "gab" | "tpe" | null,
  "model_name_text": "<nom de modèle cité dans le dernier message>" | null,
  "error_code_text": "<code d'erreur cité dans le dernier message, ex. E42>" | null,
  "reformulated_problem_text": "<le problème reformulé clairement>" | null,
  "result_position": <numéro du résultat de la dernière recherche dont parle le technicien> | null,
  "reply": "<ta réponse au technicien>" | null
}

Choix de "intent" :
- "diagnostic" : le dernier message décrit une panne ou un symptôme technique NOUVEAU sur un GAB ou un TPE, qu'il faut chercher dans l'historique des interventions. Remplis alors "reformulated_problem_text" et mets "reply" à null : la recherche en base et sa synthèse sont faites ailleurs.
- "conversation" : tout le reste. Par exemple une question sur un résultat déjà montré (« détaille le cas 2 », « pourquoi ça a marché ? »), un suivi (« ça n'a pas marché, autre chose ? »), une question technique générale, une salutation, une question sans rapport avec la maintenance. Rédige alors "reply".

Règles pour "reply" :
- Réponds naturellement, comme un collègue expérimenté : clair, concis, en texte simple (pas de markdown), un paragraphe par ligne.
- Pour une question sur les résultats, appuie-toi d'abord sur les résultats de la dernière recherche donnés dans le [Contexte]. Tu peux les compléter avec tes connaissances générales en maintenance, en disant clairement que ce complément vient de toi et non de l'historique.
- N'invente JAMAIS de fait de l'historique : technicien, intervention, action réalisée, statistique ou fiabilité qui ne figure pas dans les résultats ou dans la conversation.
- Pour une question sans rapport avec la maintenance, réponds simplement et brièvement, puis propose ton aide sur l'équipement si c'est naturel.

Autres règles :
- "device_type_text" : si le [Contexte] donne un type d'appareil, mets-le, même si le message en cite un autre ; sinon déduis-le des messages, ou null.
- "model_name_text" et "error_code_text" : seulement s'ils sont cités dans le dernier message, sinon null. Jamais d'identifiant de base de données.
- "result_position" : le numéro affiché du résultat (« le cas 2 », « la deuxième solution » -> 2), seulement si le technicien parle d'un résultat précis de la dernière recherche, sinon null.
"""

_NO_SEARCH_RESULTS = "Aucune recherche dans l'historique des interventions n'a encore été faite dans cette conversation."


def _build_turn_message(technician_message: str, device_type: str | None, search_results_text: str | None) -> str:
    """Dernier message : contexte de CE tour (variable), puis le message du technicien."""
    device = device_type.upper() if device_type else "non choisi"
    search_results = (
        f"Résultats de la dernière recherche :\n{search_results_text}" if search_results_text else _NO_SEARCH_RESULTS
    )
    return (
        f"[Contexte]\nType d'appareil choisi dans l'interface : {device}.\n{search_results}\n\n"
        f"[Message du technicien]\n{technician_message}"
    )


def _build_messages(history: list[dict] | None, turn_message: str) -> list[dict]:
    """
    Conversation au format attendu par les fournisseurs : rôles alternés,
    premier et dernier messages côté technicien. Deux messages consécutifs
    du même rôle (ex. confirmation d'une proposition de solution, enregistrée
    sans message du technicien) sont fusionnés. Déterministe : un même
    historique donne toujours les mêmes messages (condition du cache).
    """
    messages: list[dict] = []
    for message in [*(history or []), {"role": "user", "content": turn_message}]:
        content = (message.get("content") or "").strip()
        if not content:
            continue
        if not messages and message["role"] != "user":
            continue
        if messages and messages[-1]["role"] == message["role"]:
            messages[-1]["content"] += f"\n\n{content}"
        else:
            messages.append({"role": message["role"], "content": content})
    return messages


def understand_message(
    technician_message: str,
    device_type: str | None = None,
    history: list[dict] | None = None,
    search_results_text: str | None = None,
) -> UnderstoodMessage:
    """
    `history` : anciens messages de la conversation, [{"role": "user" |
    "assistant", "content": str}], SANS le message courant.
    `search_results_text` : détail des résultats de la dernière recherche, ou None.

    Pas de repli : sans réponse fiable, on ne devine PAS l'intention. Lève
    LLMUnavailableError si le LLM ne répond pas, ou si sa réponse n'est pas
    le JSON attendu. La requête se termine en 503 et le technicien voit
    « chatbot saturé » (voir app/main.py).
    """
    messages = _build_messages(history, _build_turn_message(technician_message, device_type, search_results_text))
    trace(
        "UNDERSTANDING",
        "Message envoyé au LLM avec la conversation (compréhension + réponse)",
        message_length=len(technician_message),
        conversation_message_count=len(messages),
        has_search_results=bool(search_results_text),
    )
    raw_response = llm_service.generate_chat_reply(
        _SYSTEM_PROMPT, messages, cache_history=True
    )  # lève LLMUnavailableError si le LLM ne répond pas

    try:
        parsed = _parse_json_response(raw_response)
        understood = UnderstoodMessage(**parsed)
    except (ValueError, TypeError) as error:
        # La réponse brute n'est pas journalisée : elle peut reprendre le
        # texte du technicien.
        trace("ERROR", "Réponse du LLM inexploitable", error_type=type(error).__name__)
        raise llm_service.LLMUnavailableError(
            f"Réponse du LLM inexploitable ({type(error).__name__} : JSON absent ou non conforme)."
        ) from error

    trace(
        "UNDERSTANDING",
        "Message compris",
        intent=understood.intent,
        has_device_type=bool(understood.device_type_text),
        has_model_name=bool(understood.model_name_text),
        has_error_code=bool(understood.error_code_text),
        has_reformulated_problem=bool(understood.reformulated_problem_text),
        has_result_position=understood.result_position is not None,
    )
    return understood


def _parse_json_response(raw_response: str) -> dict:
    """
    Les fournisseurs entourent parfois la réponse de ```json ... ``` ou d'une phrase
    d'intro. On extrait le premier bloc { ... } trouvé plutôt que de
    dépendre d'un format de sortie parfait.
    """
    match = re.search(r"\{.*\}", raw_response, re.DOTALL)
    if not match:
        raise ValueError("Aucun JSON trouvé dans la réponse du LLM.")
    return json.loads(match.group(0))
