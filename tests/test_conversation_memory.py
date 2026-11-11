"""Condensation de mémoire sans appel réseau ni base réelle."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import conversation_memory_service as memory


def exchanges(count, start=1, size=20):
    return [
        SimpleNamespace(
            message_id=start + index, role="user" if index % 2 == 0 else "assistant",
            content=f"Message {start + index} : " + "x" * size,
        )
        for index in range(count * 2)
    ]


class ConversationMemoryTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.context = {"device_type": "gab", "last_search": {"query": "panne", "results": []}}
        self.rows = exchanges(10)
        self.query_patch = patch.object(memory.conversation_service, "get_messages_after", return_value=self.rows)
        self.query = self.query_patch.start()
        self.addCleanup(self.query_patch.stop)
        self.llm_patch = patch.object(memory.llm_service, "generate_chat_reply", return_value="Faits conservés.")
        self.llm = self.llm_patch.start()
        self.addCleanup(self.llm_patch.stop)

    def prepare(self, threshold=100):
        return memory.prepare_history(self.db, 42, self.context, threshold)

    def test_short_history_is_unchanged_without_an_extra_call(self):
        history = self.prepare()
        self.assertEqual(history, [{"role": row.role, "content": row.content} for row in self.rows])
        self.query.assert_called_once_with(self.db, 42, 0)
        self.llm.assert_not_called()
        self.assertNotIn("conversation_memory", self.context)

    def test_exact_char_threshold_condenses_only_the_older_exchanges(self):
        older_chars = sum(len(row.content) for row in self.rows[:-12])
        with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", older_chars + 1):
            self.prepare()
        self.llm.assert_not_called()
        with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", older_chars):
            history = self.prepare()
        self.llm.assert_called_once()
        payload = json.loads(self.llm.call_args.args[1][0]["content"])
        self.assertEqual(len(payload["older_messages"]), 8)
        self.assertEqual(history[1:], [{"role": row.role, "content": row.content} for row in self.rows[-12:]])
        self.assertEqual(self.context["conversation_memory"], {
            "summary": "Faits conservés.", "through_message_id": self.rows[-13].message_id,
        })
        self.assertEqual(self.context["last_search"], {"query": "panne", "results": []})
        self.assertEqual(len(self.rows), 20)

    def test_message_count_threshold_also_triggers_compaction(self):
        self.rows = exchanges(50, size=20)
        self.query.return_value = self.rows
        self.prepare()
        self.llm.assert_called_once()
        self.assertEqual(self.context["conversation_memory"]["through_message_id"], 88)

    def test_six_exchanges_are_never_summarized_even_if_large(self):
        self.query.return_value = exchanges(6, size=3000)
        self.assertEqual(len(self.prepare()), 12)
        self.llm.assert_not_called()

    def test_boundary_keeps_associated_extra_assistant_messages(self):
        rows = exchanges(8)
        rows.insert(6, SimpleNamespace(message_id=0, role="assistant", content="Proposition enregistrée"))
        for index, row in enumerate(rows, 1):
            row.message_id = index
        self.query.return_value = rows
        with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", 1):
            history = self.prepare()
        self.assertEqual(history[1]["content"], rows[4].content)
        self.assertIn({"role": "assistant", "content": "Proposition enregistrée"}, history)
        self.assertEqual(sum(item["role"] == "user" for item in history[1:]), 6)

    def test_persisted_summary_is_reused_without_an_extra_call(self):
        self.context["conversation_memory"] = {"summary": "Code E42 ; essai infructueux.", "through_message_id": 8}
        self.query.return_value = exchanges(7, start=9)
        history = self.prepare()
        self.query.assert_called_once_with(self.db, 42, 8)
        self.llm.assert_not_called()
        self.assertIn("Code E42", history[0]["content"])
        self.assertEqual(len(history), 15)

    def test_incremental_summary_includes_the_previous_memory(self):
        self.context["conversation_memory"] = {"summary": "Code E42 ; essai infructueux.", "through_message_id": 8}
        self.query.return_value = exchanges(10, start=9)
        with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", 1):
            self.prepare()
        payload = json.loads(self.llm.call_args.args[1][0]["content"])
        self.assertEqual(payload["previous_summary"], "Code E42 ; essai infructueux.")
        self.assertEqual(self.context["conversation_memory"]["through_message_id"], 16)

    def test_empty_or_uncompressed_summary_is_an_explicit_failure(self):
        for summary in ("", "x" * 7000, "x" * 250):
            with self.subTest(summary_length=len(summary)):
                self.llm.return_value = summary
                with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", 1):
                    with self.assertRaises(memory.llm_service.LLMUnavailableError):
                        self.prepare()
                self.assertNotIn("conversation_memory", self.context)

    def test_provider_failure_does_not_advance_the_memory(self):
        self.llm.side_effect = memory.llm_service.LLMUnavailableError("Service indisponible")
        with patch.object(memory, "COMPACTION_CHAR_THRESHOLD", 1):
            with self.assertRaises(memory.llm_service.LLMUnavailableError):
                self.prepare()
        self.assertNotIn("conversation_memory", self.context)

    def test_invalid_memory_never_silently_discards_history(self):
        for value in ({"summary": "x", "through_message_id": "8"}, {}, {"summary": "", "through_message_id": 8}):
            self.context["conversation_memory"] = value
            with self.assertRaises(memory.llm_service.LLMUnavailableError):
                self.prepare()
        self.query.assert_not_called()


if __name__ == "__main__":
    unittest.main()
