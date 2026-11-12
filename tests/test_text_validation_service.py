"""Validation locale et branchement aux deux points d'entrée, sans base ni réseau."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import chat as chat_routes
from app.schemas.chat_schema import SymptomSearchRequest
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.schemas.photo_schema import PhotoAttachment
from app.services import chat_orchestrator_service as orchestrator
from app.services.greeting_service import get_reply
from app.services.text_validation_service import (
    REFORMULATION_REPLY,
    clean_message,
    validate_and_clean_message,
)

NOISE_MESSAGES = (
    "111111111111111111",
    "aaaaaaaaaaaaaaaaaaa",
    "!!!!!!!!!!!!!!!!!!!",
    "......................",
    "???",
    "asdfgh",
    "qsdfghjklm",
    "owdhcjdknaidpcjhe",
    "xjskqweopzlm",
    "abcabcabcabcabcabc",
    "test test test test test",
    "1" * 32,
    "a" * 32,
)
VALID_MESSAGES = (
    "Le serveur ne démarre plus",
    "VPN KO",
    "PC HS",
    "2",
    "le 2",
    "ok",
    "oui",
    "non non non",
    "bonjour",
    "merci",
    "ça marche pas",
    "E105",
    "1234",
    "0x80070005",
    "0xaaaaaaaa",
    "SNMPTRAP",
    "d41d8cd98f00b204e9800998ecf8427e",
    "Hyosung MX8600 écran noir",
    "slt jai un pb avec le gab",
    "jai changer la cassete mais sa marche tjr pas",
    "le gab affiche WFS_ERR_HARDWARE_ERROR sur le CDM",
    # Lignes de log collées : identifiants camelCase et majuscules collées.
    "WFSExecute CDM hResult=-14 lpszLogicalName=CashDispenser1 status=DEVHWERROR",
    "hResult",
    "DEVHWERROR",
    "ERROR java.net.SocketTimeoutException: Read timed out",
    # Phrase incohérente : ce n'est pas le rôle de ce filtre, le LLM jugera.
    "monte le banch de a chaussete de produit chimique coodeonne bacnagire je suis orche",
)


class TextValidationTests(unittest.TestCase):
    def test_noise_is_rejected(self):
        for text in NOISE_MESSAGES:
            with self.subTest(text=text):
                result = validate_and_clean_message(text)
                self.assertFalse(result.valid)
                self.assertIsNotNone(result.reason)

    def test_everything_else_is_accepted(self):
        for text in VALID_MESSAGES:
            with self.subTest(text=text):
                result = validate_and_clean_message(text)
                self.assertTrue(result.valid, result)
                self.assertIsNone(result.reason)

    def test_empty_and_invisible_text(self):
        for text in ("", "   ", "\t\n", "\u200b\ufeff\u202e", "\x00"):
            with self.subTest(text=text):
                result = validate_and_clean_message(text)
                self.assertFalse(result.valid)
                self.assertEqual(result.reason, "empty_message")

    def test_cleanup_preserves_accents_and_lines(self):
        self.assertEqual(
            clean_message("  Le\tserveur \x00 ne   de\u0301marre\u200b plus\r\n\r\n  Erreur 500  "),
            "Le serveur ne démarre plus\nErreur 500",
        )
        self.assertEqual(clean_message("ＰＣ\u00a0bloqué"), "PC bloqué")

    def test_cleanup_does_not_corrupt_technical_data(self):
        for text in ("0x80000000", "0xaaaaaaaa", "C:\\logs\\error.txt", "SELECT * FROM table;"):
            with self.subTest(text=text):
                self.assertEqual(clean_message(text), text)


class OrchestratorValidationTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.context = {"device_type": "gab", "last_search": {"results": [{"position": 1}]}}
        patches = {
            "conversation": patch.object(
                orchestrator.conversation_service, "get_or_create_conversation",
                return_value=SimpleNamespace(conversation_id=7),
            ),
            "load_context": patch.object(orchestrator.context_service, "get_context", return_value=self.context),
            "save_message": patch.object(orchestrator.conversation_service, "save_message"),
            "save_context": patch.object(orchestrator.context_service, "save_context"),
            "active": patch.object(orchestrator.conversation_service, "mark_conversation_active"),
            "history": patch.object(
                orchestrator.conversation_memory_service, "prepare_history",
                return_value=[{"role": "user", "content": "avant"}, {"role": "assistant", "content": "réponse"}],
            ),
            "understand": patch.object(
                orchestrator.message_understanding_service, "understand_message",
                return_value=UnderstoodMessage(intent="conversation", reply="reply"),
            ),
            "route": patch.object(orchestrator, "_route_message", return_value="reply"),
            "llm": patch.object(orchestrator.llm_service, "generate_reply"),
            "summarize": patch.object(orchestrator.llm_service, "summarize_solutions"),
            "search": patch.object(orchestrator.case_retrieval_service, "find_similar_cases"),
            "describe_search": patch.object(orchestrator, "_describe_last_search", return_value=None),
            "chat_llm": patch.object(orchestrator.llm_service, "generate_chat_reply"),
        }
        self.mocks = {}
        for name, patcher in patches.items():
            self.mocks[name] = patcher.start()
            self.addCleanup(patcher.stop)

    def test_stream_exposes_only_the_final_reply_and_commits_after_emission(self):
        deltas = []

        def understand(*args, **kwargs):
            self.assertIsNone(orchestrator.llm_service._reply_delta_callback.get())
            return UnderstoodMessage(intent="conversation", reply="reply")

        def route(*args):
            callback = orchestrator.llm_service._reply_delta_callback.get()
            callback("pre")
            callback("view")
            return "reply"

        def emit(text):
            self.db.commit.assert_not_called()
            deltas.append(text)

        self.mocks["understand"].side_effect = understand
        self.mocks["route"].side_effect = route
        result = orchestrator.handle_chat_message(self.db, 7, 1, "VPN KO", on_reply_delta=emit)
        self.assertEqual(deltas, ["pre", "view", ""])
        self.assertEqual(result["reply"], "reply")
        self.mocks["save_message"].assert_any_call(self.db, 7, "assistant", "reply")
        self.db.commit.assert_called_once()
        self.assertIsNone(orchestrator.llm_service._reply_delta_callback.get())

    def test_local_greeting_is_emitted_without_understanding(self):
        deltas = []
        result = orchestrator.handle_chat_message(self.db, 7, 1, "bonjour", on_reply_delta=deltas.append)
        self.assertEqual(deltas, [result["reply"], ""])
        self.mocks["understand"].assert_not_called()
        self.db.commit.assert_called_once()

    def test_rejected_messages_skip_all_llm_and_search_calls(self):
        for text in (*NOISE_MESSAGES, "\u200b"):
            with self.subTest(text=text):
                result = orchestrator.handle_chat_message(self.db, 7, 1, text)
                self.assertEqual(
                    result,
                    {
                        "conversation_id": 7,
                        "reply": REFORMULATION_REPLY,
                        "detected_error_code": None,
                        "error_code_id": None,
                        "solution_proposal_available": False,
                        "intervention_add_available": False,
                        "intervention_add_problem": None,
                    },
                )
        for name in ("history", "understand", "route", "llm", "summarize", "search"):
            self.mocks[name].assert_not_called()
        self.assertEqual(self.context["last_search"], {"results": [{"position": 1}]})
        self.assertEqual(self.mocks["save_message"].call_count, 2 * (len(NOISE_MESSAGES) + 1))
        self.assertEqual(self.db.commit.call_count, len(NOISE_MESSAGES) + 1)

    def test_accepted_text_is_cleaned_at_every_step(self):
        result = orchestrator.handle_chat_message(self.db, 7, 1, "  VPN\t KO\u200b  ")
        self.assertEqual(result["reply"], "reply")
        self.mocks["understand"].assert_called_once()
        call = self.mocks["understand"].call_args
        self.assertEqual(call.args, ("VPN KO",))
        self.assertEqual(call.kwargs["device_type"], "gab")
        self.mocks["history"].assert_called_once_with(
            self.db, 7, self.context, orchestrator.settings.chat_history_max_messages,
        )
        self.assertEqual(
            call.kwargs["history"],
            [{"role": "user", "content": "avant"}, {"role": "assistant", "content": "réponse"}],
        )
        self.assertEqual(self.mocks["route"].call_args.args[2], "VPN KO")
        self.mocks["save_message"].assert_any_call(self.db, 7, "user", "VPN KO")
        self.mocks["save_message"].assert_any_call(self.db, 7, "assistant", "reply")
        self.mocks["save_context"].assert_called_once_with(self.db, 7, self.context)
        self.db.commit.assert_called_once()

    def test_exact_greetings_skip_expensive_work_and_preserve_the_conversation(self):
        for text in ("  BONJOUR  ", "salut", "qui est tu", "Qui es-tu ?", "quels sont tes services"):
            with self.subTest(text=text):
                result = orchestrator.handle_chat_message(self.db, 7, 1, text)
                self.assertEqual(result, {
                    "conversation_id": 7,
                    "reply": get_reply(text),
                    "detected_error_code": None,
                    "error_code_id": None,
                    "solution_proposal_available": False,
                    "intervention_add_available": False,
                    "intervention_add_problem": None,
                })
                self.assertTrue(result["reply"])
                self.mocks["save_message"].assert_any_call(self.db, 7, "user", clean_message(text))
                self.mocks["save_message"].assert_any_call(self.db, 7, "assistant", result["reply"])
        for name in ("history", "describe_search", "understand", "route", "llm", "chat_llm", "summarize", "search"):
            self.mocks[name].assert_not_called()
        self.assertEqual(self.context, {"device_type": "gab", "last_search": {"results": [{"position": 1}]}})
        self.assertEqual(self.mocks["save_message"].call_count, 10)
        self.assertEqual(self.mocks["save_context"].call_count, 5)
        self.assertEqual(self.mocks["active"].call_count, 5)
        self.assertEqual(self.db.commit.call_count, 5)

    def test_messages_containing_greetings_still_reach_understanding(self):
        for text in (
            "bonjour le GAB ne démarre plus",
            "salut\ncode erreur 01",
            "qui es-tu pour me conseiller cette réparation ?",
            "quels sont tes services pour un TPE en panne",
            "rebonjour", "bonjour!", "bonjour bonjour",
        ):
            with self.subTest(text=text):
                self.assertIsNone(get_reply(text))
                result = orchestrator.handle_chat_message(self.db, 7, 1, text)
                self.assertEqual(result["reply"], "reply")
        self.assertEqual(self.mocks["understand"].call_count, 7)
        self.assertEqual(self.mocks["history"].call_count, 7)
        self.assertEqual(self.mocks["describe_search"].call_count, 7)

    def test_greeting_with_an_accepted_photo_still_reaches_understanding(self):
        photo = PhotoAttachment(media_type="image/jpeg", data_base64="aW1hZ2U=")
        with patch.object(orchestrator.photo_ocr_service, "accept_photo", return_value=photo):
            orchestrator.handle_chat_message(self.db, 7, 1, "bonjour", photo=photo)
        self.mocks["understand"].assert_called_once()
        self.assertIs(self.mocks["understand"].call_args.kwargs["photo"], photo)
        self.mocks["history"].assert_called_once()
        self.mocks["route"].assert_called_once()


class DirectSearchValidationTests(unittest.TestCase):
    def test_noise_skips_search_and_summary(self):
        with (
            patch.object(chat_routes, "find_ranked_solutions") as search,
            patch.object(chat_routes, "summarize_solutions") as summarize,
        ):
            for text in NOISE_MESSAGES:
                with self.subTest(text=text):
                    result = chat_routes.rechercher_symptome(
                        SymptomSearchRequest(raw_text=text, device_type="gab"), MagicMock()
                    )
                    self.assertEqual(result.matched_symptom_ids, [])
                    self.assertEqual(result.solutions, [])
                    self.assertEqual(result.summary, REFORMULATION_REPLY)
        search.assert_not_called()
        summarize.assert_not_called()

    def test_accepted_search_uses_cleaned_text(self):
        db = MagicMock()
        with (
            patch.object(chat_routes, "find_ranked_solutions",
                         return_value={"matched_symptom_ids": [], "solutions": []}) as search,
            patch.object(chat_routes, "summarize_solutions", return_value="summary") as summarize,
        ):
            result = chat_routes.rechercher_symptome(
                SymptomSearchRequest(raw_text="VPN\t  KO\u200b", device_type="gab"), db
            )
        search.assert_called_once_with(db, search_text="VPN KO", device_type="gab")
        summarize.assert_called_once_with("VPN KO", [], device_type="gab")
        self.assertEqual(result.summary, "summary")


if __name__ == "__main__":
    unittest.main()
