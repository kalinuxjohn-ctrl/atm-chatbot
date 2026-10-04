"""
Importer tous les modèles ici garantit qu'ils sont tous enregistrés auprès
de SQLAlchemy avant qu'une relationship() ne cherche à résoudre un nom de
classe passé en chaîne (ex: relationship("Intervention", ...)) -- sans ça,
on peut obtenir une erreur "class not found" selon l'ordre d'import.
"""

from app.models.technician import Technician
from app.models.device import Manufacturer, DeviceModel, DeviceModelVersion, Device
from app.models.catalog import Component, Symptom, Action, SymptomActionOutcomeStats
from app.models.intervention import Intervention, InterventionSymptom, InterventionAction, Diagnosis
from app.models.fault import Fault, ErrorCode
from app.models.conversation import Conversation, ConversationMessage, ConversationContext

__all__ = [
    "Technician",
    "Manufacturer",
    "DeviceModel",
    "DeviceModelVersion",
    "Device",
    "Component",
    "Symptom",
    "Action",
    "SymptomActionOutcomeStats",
    "Intervention",
    "InterventionSymptom",
    "InterventionAction",
    "Fault",
    "ErrorCode",
    "Diagnosis",
    "Conversation",
    "ConversationMessage",
    "ConversationContext",
]