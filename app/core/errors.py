"""
Exceptions métier partagées par les services, traduites en réponses HTTP
claires par les gestionnaires enregistrés dans app/main.py -- les services
restent ainsi indépendants de FastAPI.
"""


class ReferenceNotFoundError(LookupError):
    """Un identifiant fourni par le client (device_id, action_id...) n'existe pas en base -> HTTP 404."""


class InvalidReferenceError(ValueError):
    """Un identifiant existe mais n'est pas cohérent avec la requête (ex. symptôme d'une autre intervention) -> HTTP 422."""


class ExternalServiceUnavailableError(RuntimeError):
    """Un service externe indispensable (ex. API d'embedding) ne répond pas -> HTTP 503."""
