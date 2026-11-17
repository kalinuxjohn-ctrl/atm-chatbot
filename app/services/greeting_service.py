"""Réponses locales aux messages entiers de salutation et de présentation."""

from app.services.text_validation_service import clean_message

_GREETING_REPLY = (
    "Bonjour ! Je peux t'aider sur les GAB et les TPE. "
    "Sélectionne le type d'appareil, puis décris la panne ou indique le code d'erreur affiché."
)
_IDENTITY_REPLY = (
    "Je suis l'ATM-Chatbot, un assistant d'aide à la maintenance des GAB "
    "(distributeurs de billets) et des TPE (terminaux de paiement). "
    "Je t'aide à retrouver les consignes et les interventions utiles à partir de ton problème."
)
_SERVICES_REPLY = (
    "Je peux t'aider à :\n"
    "- retrouver la consigne enregistrée pour un code d'erreur ;\n"
    "- rechercher des interventions similaires à partir des symptômes d'une panne ;\n"
    "- expliquer les résultats et les actions des interventions retrouvées.\n\n"
    "Sélectionne GAB ou TPE, puis décris ton problème."
)

_REPLIES = {
    "bonjour": _GREETING_REPLY,
    "salut": _GREETING_REPLY,
    "bonsoir": _GREETING_REPLY,
    "hello": _GREETING_REPLY,
    "coucou": _GREETING_REPLY,
    "slt": _GREETING_REPLY,
    "qui es-tu": _IDENTITY_REPLY,
    "qui es-tu ?": _IDENTITY_REPLY,
    "qui es-tu?": _IDENTITY_REPLY,
    "qui es tu": _IDENTITY_REPLY,
    "qui es tu ?": _IDENTITY_REPLY,
    "qui es tu?": _IDENTITY_REPLY,
    "qui est tu": _IDENTITY_REPLY,
    "qui est tu ?": _IDENTITY_REPLY,
    "qui est tu?": _IDENTITY_REPLY,
    "quels sont tes services": _SERVICES_REPLY,
    "quels sont tes services ?": _SERVICES_REPLY,
    "quels sont tes services?": _SERVICES_REPLY,
    "que peux-tu faire": _SERVICES_REPLY,
    "que peux-tu faire ?": _SERVICES_REPLY,
    "que peux-tu faire?": _SERVICES_REPLY,
    "que peux tu faire": _SERVICES_REPLY,
    "que peux tu faire ?": _SERVICES_REPLY,
    "que peux tu faire?": _SERVICES_REPLY,
}


def get_reply(message: str) -> str | None:
    """Égalité sur le message nettoyé, insensible à la casse ; jamais de sous-chaîne."""
    return _REPLIES.get(clean_message(message).casefold())
