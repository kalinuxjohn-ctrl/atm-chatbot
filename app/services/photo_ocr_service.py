"""
Photos du chat : lire le texte affiché sur l'appareil (OCR).

Le technicien prend une photo (écran du GAB, ticket, afficheur du TPE...) et
l'envoie avec son message, ex. « je viens d'arriver, ça affiche seulement ça
en boucle ». Le message seul n'apporte rien : c'est le texte de la photo
qui décrit la panne.

    photo + message
        -> 1er appel à Claude (message_understanding_service), photo jointe :
           Claude lit le texte de la photo, en donne la signification et,
           s'il décrit une panne, l'ajoute aux symptômes numérotés
        -> la suite est INCHANGÉE : chaque symptôme est cherché en base
           (un embedding chacun), comme un symptôme écrit par le technicien.

La photo n'est jamais enregistrée : seul le texte lu est gardé dans la
conversation (message du technicien et réponse), pour les tours suivants.

TOUT ce qui concerne les photos est dans ce fichier. Les autres fichiers se
contentent d'appeler les fonctions ci-dessous, qui ne font rien sans photo.

Activer / désactiver : PHOTO_OCR_ENABLED dans le .env (settings.photo_ocr_enabled).
Désactivée, le bouton photo disparaît du chat (GET /api/chat/photo-ocr) et
une photo reçue malgré tout est ignorée. Réservée à Claude : avec un autre
fournisseur LLM, la fonctionnalité est considérée comme désactivée.
"""

from __future__ import annotations

from app.core.config import settings
from app.core.tracing import trace
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.schemas.photo_schema import PhotoAttachment

# Texte envoyé à Claude quand le technicien envoie une photo sans message
# exploitable (vide, ou rejeté par text_validation_service).
PHOTO_ONLY_MESSAGE = "(Photo envoyée sans message.)"

# Consigne ajoutée au DERNIER message seulement, quand une photo est jointe :
# la consigne système reste identique d'un tour à l'autre (cache Claude).
_PHOTO_INSTRUCTIONS = """[Photo jointe]
Le technicien a joint une photo prise sur l'appareil (écran, afficheur, ticket, étiquette...). Elle sert à lire le texte affiché.
- Lis tout le texte visible sur la photo, tel quel, sans le corriger ni le traduire.
- Lis le message du technicien ET la photo ensemble. Si son message n'apporte aucune information sur la panne (ex. « ça affiche seulement ça en boucle », « regarde »), c'est le texte de la photo qui décrit le problème.
- Explique ce que signifie ce texte pour un technicien : message d'erreur, état de l'appareil, code d'erreur, composant concerné. Si tu n'es pas sûr de sa signification, dis-le au lieu d'inventer.
- Si ce texte décrit une panne ou une anomalie, choisis "diagnostic" et ajoute-le aux "symptoms", numéroté à la suite des symptômes du message : un symptôme clair qui reprend le texte affiché et les circonstances données par le technicien (ex. « Le GAB affiche en boucle le message CARD READER FAULT »). Intègre-le aussi à "reformulated_problem_text". Un code d'erreur lisible va dans "error_code_text".
- Si la photo ne contient aucun texte lisible et que le message seul ne suffit pas, choisis "conversation" et demande dans "reply" une photo plus nette, prise de face, ou une description du problème.
En plus des clés habituelles, ajoute au JSON :
  "photo_text": "<texte lu sur la photo, tel quel>" | null,
  "photo_meaning": "<signification de ce texte, en une ou deux phrases>" | null

"""


def is_enabled() -> bool:
    """Interrupteur de la fonctionnalité (lu aussi par le frontend, voir GET /api/chat/photo-ocr)."""
    return settings.photo_ocr_enabled and settings.llm_provider == "claude"


def accept_photo(photo: PhotoAttachment | None) -> PhotoAttachment | None:
    """La photo à analyser, ou None si aucune n'est jointe ou si la fonctionnalité est désactivée."""
    if photo is None:
        return None
    if not is_enabled():
        trace("PHOTO", "Photo reçue mais ignorée : fonctionnalité désactivée ou fournisseur autre que Claude")
        return None
    trace("PHOTO", "Photo jointe au message", media_type=photo.media_type, base64_length=len(photo.data_base64))
    return photo


def attach_to_messages(messages: list[dict], photo: PhotoAttachment | None) -> list[dict]:
    """
    Joint la photo au dernier message (celui du technicien) au format de
    l'API Claude : l'image, puis la consigne de lecture et le texte habituel.
    Sans photo, renvoie les messages tels quels.
    """
    if photo is None:
        return messages
    *previous, last = messages
    image_block = {
        "type": "image",
        "source": {"type": "base64", "media_type": photo.media_type, "data": photo.data_base64},
    }
    text_block = {"type": "text", "text": _PHOTO_INSTRUCTIONS + last["content"]}
    return [*previous, {"role": last["role"], "content": [image_block, text_block]}]


def add_reading_to_message(technician_text: str, photo: PhotoAttachment | None, understood: UnderstoodMessage) -> str:
    """
    Message du technicien tel qu'enregistré dans la conversation : son texte
    suivi du texte lu sur la photo. Les tours suivants (et la recherche de
    repli) savent ainsi ce que montrait la photo, sans la renvoyer.
    """
    if photo is None:
        return technician_text
    reading = f"« {understood.photo_text} »" if understood.photo_text else "aucun texte lisible"
    return f"{technician_text}\n[Photo jointe, texte lu : {reading}]"


def add_reading_to_reply(reply: str, photo: PhotoAttachment | None, understood: UnderstoodMessage) -> str:
    """
    Réponse au technicien précédée de ce qui a été lu sur la photo : il peut
    vérifier que la lecture est juste avant de suivre les conseils.
    """
    if photo is None:
        return reply
    trace("PHOTO", "Lecture de la photo", has_text=bool(understood.photo_text), has_meaning=bool(understood.photo_meaning))
    if not understood.photo_text:
        return f"📷 **Aucun texte lisible sur la photo.**\n\n{reply}"
    reading = f"📷 **Texte lu sur la photo :** « {understood.photo_text} »"
    if understood.photo_meaning:
        reading += f"\n\n**Signification :** {understood.photo_meaning}"
    return f"{reading}\n\n{reply}"
