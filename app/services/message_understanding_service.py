"""
Niveau 1 du flux (voir diagramme) : comprendre ce que le technicien vient
d'écrire -- son intention, et le texte brut qu'il mentionne (modèle, code
d'erreur, description du problème).

Passe par llm_service.generate_reply() -- Ollama aujourd'hui, Claude demain,
sans aucun changement à ce fichier quand ça basculera. Ne retourne QUE du
texte et une intention, jamais un ID interne (garantie structurelle : voir
message_understanding_schema.py).
"""

from __future__ import annotations

import json
import re

from app.core.tracing import trace
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import llm_service

_PROMPT_TEMPLATE = """Tu es un module de compréhension pour un chatbot de techniciens de maintenance ATM (GAB/TPE).

Analyse UNIQUEMENT le message suivant et renvoie un JSON strict, rien d'autre (pas de texte avant/après, pas de balises markdown), avec EXACTEMENT ces clés :

{{
  "intent": "conversation" | "detail_request" | "diagnostic",
  "device_type_text": "gab" | "tpe" | null,
  "model_name_text": "<nom de modèle mentionné tel quel>" | null,
  "error_code_text": "<code d'erreur mentionné, ex. E42>" | null,
  "reformulated_problem_text": "<reformulation claire et concise du problème>" | null
}}

Règles strictes :
- "intent" = "diagnostic" si le technicien décrit un symptôme/problème technique nouveau c'est vraiment l'intension clair de l'utilisateur veux t'il de l'aide sur un equipement, juste un message,tu dois analuser cela.
- "intent" = "detail_request" si le technicien demande des précisions sur un résultat déjà montré
  (ex: "le deuxième", "cette solution", "pourquoi ça a marché", "quelle action").
- "intent" = "conversation" sinon (salutation, remerciement, hors-sujet).
- N'invente JAMAIS une information absente du message : si le modèle ou le code d'erreur
  n'est pas mentionné, mets null. Ne mets JAMAIS un identifiant numérique de base de données.
- "reformulated_problem_text" ne doit être rempli QUE si intent == "diagnostic".

Message du technicien : « {technician_message} »
"""


def understand_message(technician_message: str) -> UnderstoodMessage:
    """
    Pas de repli : sans compréhension fiable, on ne devine PAS l'intention.
    (Avant, tout message était alors traité comme une panne -- un simple
    « bonjour » déclenchait une recherche et affichait des cas sans rapport.)

    Lève LLMUnavailableError si le LLM ne répond pas, ou si sa réponse n'est
    pas le JSON attendu. La requête se termine en 503 et le technicien voit
    « chatbot saturé » (voir app/main.py).
    """
    trace(
        "UNDERSTANDING",
        "Compréhension du message démarrée (LLM niveau 1)",
        message_length=len(technician_message),
    )
    prompt = _PROMPT_TEMPLATE.format(technician_message=technician_message)
    raw_response = llm_service.generate_reply(prompt)  # lève LLMUnavailableError si le LLM ne répond pas

    try:
        parsed = _parse_json_response(raw_response)
        understood = UnderstoodMessage(**parsed)
    except Exception as error:
        # La réponse brute n'est pas journalisée : elle peut reprendre le
        # texte du technicien.
        trace("ERROR", "Réponse de compréhension inexploitable", error_type=type(error).__name__)
        raise llm_service.LLMUnavailableError(
            f"Réponse de compréhension inexploitable ({type(error).__name__} : JSON absent ou non conforme)."
        ) from error

    trace(
        "UNDERSTANDING",
        "Message compris",
        intent=understood.intent,
        has_device_type=bool(understood.device_type_text),
        has_model_name=bool(understood.model_name_text),
        has_error_code=bool(understood.error_code_text),
        has_reformulated_problem=bool(understood.reformulated_problem_text),
    )
    return understood


def _parse_json_response(raw_response: str) -> dict:
    """
    Les modèles locaux (Ollama) respectent rarement un JSON pur à 100% --
    ils entourent parfois la réponse de ```json ... ``` ou d'une phrase
    d'intro. On extrait le premier bloc { ... } trouvé plutôt que de
    dépendre d'un format de sortie parfait.
    """
    match = re.search(r"\{.*\}", raw_response, re.DOTALL)
    if not match:
        raise ValueError("Aucun JSON trouvé dans la réponse du LLM.")
    return json.loads(match.group(0))