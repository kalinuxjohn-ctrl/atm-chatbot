"""Validation locale et branchement aux deux points d'entrée, sans base ni réseau."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import chat as chat_routes
from app.schemas.chat_schema import SymptomSearchRequest
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import chat_orchestrator_service as orchestrator
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
            "understand": patch.object(
                orchestrator.message_understanding_service, "understand_message",
                return_value=UnderstoodMessage(intent="conversation"),
            ),
            "route": patch.object(orchestrator, "_route_message", return_value="reply"),
            "llm": patch.object(orchestrator.llm_service, "generate_reply"),
            "summarize": patch.object(orchestrator.llm_service, "summarize_solutions"),
            "search": patch.object(orchestrator.case_retrieval_service, "find_similar_cases"),
        }
        self.mocks = {}
        for name, patcher in patches.items():
            self.mocks[name] = patcher.start()
            self.addCleanup(patcher.stop)

    def test_rejected_messages_skip_all_llm_and_search_calls(self):
        for text in (*NOISE_MESSAGES, "\u200b"):
            with self.subTest(text=text):
                result = orchestrator.handle_chat_message(self.db, 7, 1, text)
                self.assertEqual(result, {"conversation_id": 7, "reply": REFORMULATION_REPLY})
        for name in ("understand", "route", "llm", "summarize", "search"):
            self.mocks[name].assert_not_called()
        self.assertEqual(self.context["last_search"], {"results": [{"position": 1}]})
        self.assertEqual(self.mocks["save_message"].call_count, 2 * (len(NOISE_MESSAGES) + 1))
        self.assertEqual(self.db.commit.call_count, len(NOISE_MESSAGES) + 1)

    def test_accepted_text_is_cleaned_at_every_step(self):
        result = orchestrator.handle_chat_message(self.db, 7, 1, "  VPN\t KO\u200b  ")
        self.assertEqual(result["reply"], "reply")
        self.mocks["understand"].assert_called_once_with("VPN KO", device_type="gab")
        self.assertEqual(self.mocks["route"].call_args.args[2], "VPN KO")
        self.mocks["save_message"].assert_any_call(self.db, 7, "user", "VPN KO")
        self.mocks["save_message"].assert_any_call(self.db, 7, "assistant", "reply")
        self.mocks["save_context"].assert_called_once_with(self.db, 7, self.context)
        self.db.commit.assert_called_once()


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
        search.assert_called_once_with(db, raw_text="VPN KO", device_type="gab")
        summarize.assert_called_once_with("VPN KO", [], device_type="gab")
        self.assertEqual(result.summary, "summary")


if __name__ == "__main__":
    unittest.main()
