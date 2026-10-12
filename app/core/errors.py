"""
Exceptions métier partagées par les services, traduites en réponses HTTP
claires par les gestionnaires enregistrés dans app/main.py -- les services
restent ainsi indépendants de FastAPI.
"""


class ReferenceNotFoundError(LookupError):
    """Un identifiant fourni par le client (device_id, action_id...) n'existe pas en base -> HTTP 404."""


class InvalidReferenceError(ValueError):
    """Un identifiant existe mais n'est pas cohérent avec la requête (ex. symptôme d'une autre intervention) -> HTTP 422."""


class AccessDeniedError(PermissionError):
    """L'appelant n'a pas le droit d'agir sur cette ressource (conversation d'un autre technicien, clé admin absente) -> HTTP 403."""


class StateConflictError(RuntimeError):
    """L'opération est impossible dans l'état actuel (aucun problème identifié, proposition déjà examinée...) -> HTTP 409."""


class ExternalServiceUnavailableError(RuntimeError):
    """
    Un service externe indispensable (IA de langage, API d'embedding) ne répond
    pas ou répond de façon inexploitable -> HTTP 503. Le message de l'exception
    est destiné aux JOURNAUX du serveur (cause précise) ; le client ne reçoit
    qu'un message neutre (voir app/main.py), pour ne pas exposer les services
    utilisés derrière le chatbot.
    """
