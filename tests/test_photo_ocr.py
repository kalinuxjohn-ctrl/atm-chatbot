"""Photos du chat (photo_ocr_service) : aucun appel réseau ni base réelle."""

import base64
import json
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.schemas.conversation_schema import ChatRequest
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.schemas.photo_schema import PhotoAttachment
from app.services import (
    chat_orchestrator_service as orchestrator,
    llm_service,
    message_understanding_service as understanding,
    photo_ocr_service,
)

PHOTO = PhotoAttachment(media_type="image/jpeg", data_base64=base64.b64encode(b"fausse image").decode())


def enabled(value=True, provider="claude"):
    """Remplace l'interrupteur et le fournisseur le temps d'un test."""
    return patch.multiple(photo_ocr_service.settings, photo_ocr_enabled=value, llm_provider=provider)


class PhotoSchemaTests(unittest.TestCase):
    def test_invalid_or_too_heavy_photo_is_refused(self):
        with self.assertRaises(ValidationError):
            PhotoAttachment(media_type="image/jpeg", data_base64="pas du base64 !")
        with self.assertRaises(ValidationError):
            PhotoAttachment(media_type="image/bmp", data_base64=PHOTO.data_base64)
        with patch.object(photo_ocr_service.settings, "photo_max_bytes", 3):
            with self.assertRaises(ValidationError):
                PhotoAttachment(media_type="image/jpeg", data_base64=PHOTO.data_base64)

    def test_message_may_be_empty_only_with_a_photo(self):
        self.assertEqual(ChatRequest(technician_id=1, message="  ", photo=PHOTO).message, "")
        with self.assertRaises(ValidationError):
            ChatRequest(technician_id=1, message="  ")

    def test_empty_photo_text_means_nothing_read(self):
        understood = UnderstoodMessage(intent="diagnostic", photo_text="  ", photo_meaning=" Lecteur en panne ")
        self.assertIsNone(understood.photo_text)
        self.assertEqual(understood.photo_meaning, "Lecteur en panne")


class PhotoSwitchTests(unittest.TestCase):
    def test_photo_is_ignored_when_disabled_or_not_claude(self):
        with enabled(False):
            self.assertIsNone(photo_ocr_service.accept_photo(PHOTO))
        with enabled(True, provider="gemini"):
            self.assertFalse(photo_ocr_service.is_enabled())
            self.assertIsNone(photo_ocr_service.accept_photo(PHOTO))
        with enabled(True):
            self.assertIs(photo_ocr_service.accept_photo(PHOTO), PHOTO)

    def test_without_photo_nothing_changes(self):
        understood = UnderstoodMessage(intent="diagnostic")
        messages = [{"role": "user", "content": "texte"}]
        self.assertIs(photo_ocr_service.attach_to_messages(messages, None), messages)
        self.assertEqual(photo_ocr_service.add_reading_to_message("texte", None, understood), "texte")
        self.assertEqual(photo_ocr_service.add_reading_to_reply("réponse", None, understood), "réponse")


class PhotoSentToClaudeTests(unittest.TestCase):
    def test_photo_goes_with_the_last_message_and_system_prompt_is_unchanged(self):
        response = json.dumps({
            "intent": "diagnostic",
            "reformulated_problem_text": "Le GAB affiche en boucle CARD READER FAULT",
            "symptoms": [{"number": 1, "text": "Le GAB affiche en boucle le message CARD READER FAULT"}],
            "photo_text": "CARD READER FAULT",
            "photo_meaning": "Le lecteur de carte est en défaut.",
        })
        history = [{"role": "user", "content": "bonjour"}, {"role": "assistant", "content": "Salut"}]
        with patch.object(llm_service, "generate_chat_reply", return_value=response) as call:
            understood = understanding.understand_message(
                "ça affiche seulement ça en boucle", device_type="gab", history=history, photo=PHOTO
            )

        system, messages = call.call_args.args
        self.assertEqual(system, understanding._SYSTEM_PROMPT)  # cache Claude préservé
        self.assertEqual(messages[:-1], history)  # anciens messages intacts
        image_block, text_block = messages[-1]["content"]
        self.assertEqual(image_block["type"], "image")
        self.assertEqual(image_block["source"]["data"], PHOTO.data_base64)
        self.assertTrue(text_block["text"].startswith("[Photo jointe]"))
        self.assertTrue(text_block["text"].endswith("ça affiche seulement ça en boucle"))
        # Le symptôme lu sur la photo suit le chemin normal de la recherche.
        self.assertEqual(understood.symptoms[0].text, "Le GAB affiche en boucle le message CARD READER FAULT")
        self.assertEqual(understood.photo_text, "CARD READER FAULT")

    def test_reading_is_shown_in_the_reply_and_kept_in_the_message(self):
        understood = UnderstoodMessage(
            intent="diagnostic", photo_text="CARD READER FAULT", photo_meaning="Le lecteur de carte est en défaut."
        )
        reply = photo_ocr_service.add_reading_to_reply("Cas 1 …", PHOTO, understood)
        self.assertIn("« CARD READER FAULT »", reply)
        self.assertIn("Le lecteur de carte est en défaut.", reply)
        self.assertTrue(reply.endswith("Cas 1 …"))
        message = photo_ocr_service.add_reading_to_message("regarde", PHOTO, understood)
        self.assertEqual(message, "regarde\n[Photo jointe, texte lu : « CARD READER FAULT »]")

        nothing_read = UnderstoodMessage(intent="conversation", reply="Photo floue, reprends-la.")
        self.assertIn("Aucun texte lisible", photo_ocr_service.add_reading_to_reply("x", PHOTO, nothing_read))


class PhotoInOrchestratorTests(unittest.TestCase):
    def run_turn(self, *, valid, photo):
        understood = UnderstoodMessage(intent="diagnostic", photo_text="CARD READER FAULT", photo_meaning="Lecteur en défaut.")
        with (
            patch.object(orchestrator.conversation_service, "get_or_create_conversation",
                         return_value=MagicMock(conversation_id=15)),
            patch.object(orchestrator.context_service, "get_context", return_value={}),
            patch.object(orchestrator.context_service, "save_context"),
            patch.object(orchestrator.conversation_service, "save_message") as save_message,
            patch.object(orchestrator.conversation_service, "mark_conversation_active"),
            patch.object(orchestrator, "_load_history", return_value=[]),
            patch.object(orchestrator, "_describe_last_search", return_value=None),
            patch.object(orchestrator, "validate_and_clean_message",
                         return_value=MagicMock(valid=valid, cleaned_text="regarde" if valid else "", reason=None)),
            patch.object(orchestrator.message_understanding_service, "understand_message",
                         return_value=understood) as understand,
            patch.object(orchestrator, "_route_message", return_value="Cas 1 …") as route,
            enabled(True),
        ):
            result = orchestrator.handle_chat_message(MagicMock(), 15, 4, "regarde", "gab", photo=photo)
        return result, understand, route, save_message

    def test_photo_without_usable_text_is_still_understood(self):
        result, understand, route, save_message = self.run_turn(valid=False, photo=PHOTO)
        self.assertEqual(understand.call_args.args[0], photo_ocr_service.PHOTO_ONLY_MESSAGE)
        self.assertIs(understand.call_args.kwargs["photo"], PHOTO)
        self.assertIn("CARD READER FAULT", route.call_args.args[2])  # repli de recherche
        self.assertIn("CARD READER FAULT", save_message.call_args_list[0].args[3])
        self.assertTrue(result["reply"].startswith("📷"))

    def test_invalid_text_without_photo_still_asks_to_rephrase(self):
        result, understand, _, _ = self.run_turn(valid=False, photo=None)
        understand.assert_not_called()
        self.assertEqual(result["reply"], orchestrator.REFORMULATION_REPLY)


if __name__ == "__main__":
    unittest.main()
