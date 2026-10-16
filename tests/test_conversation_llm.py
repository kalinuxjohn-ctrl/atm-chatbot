"""Conversation envoyée au LLM à chaque message ; aucun appel réseau ni base réelle."""

import json
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

import requests

from app.services import (
    chat_orchestrator_service as orchestrator,
    llm_service,
    message_understanding_service as understanding,
)


class ConversationMessagesTests(unittest.TestCase):
    def test_history_is_sent_in_order_and_ends_with_the_current_message(self):
        history = [
            {"role": "assistant", "content": "Bienvenue"},  # un fil ne commence jamais côté assistant
            {"role": "user", "content": "Le GAB avale la carte"},
            {"role": "assistant", "content": "Cas 1 … Cas 2 …"},
            {"role": "assistant", "content": "Proposition enregistrée"},  # fusionné avec le précédent
        ]
        messages = understanding._build_messages(history, "détaille le cas 2")
        self.assertEqual([m["role"] for m in messages], ["user", "assistant", "user"])
        self.assertEqual(messages[1]["content"], "Cas 1 … Cas 2 …\n\nProposition enregistrée")
        self.assertEqual(messages[-1]["content"], "détaille le cas 2")

    def test_turn_context_goes_in_the_last_message_not_in_the_system_prompt(self):
        # Consigne système fixe (condition du cache) : ni appareil, ni résultats, ni date.
        turn = understanding._build_turn_message("détaille le cas 2", "gab", "Cas 2 (Bob, Agence) : …")
        self.assertIn("Type d'appareil choisi dans l'interface : GAB.", turn)
        self.assertIn("Cas 2 (Bob, Agence)", turn)
        self.assertTrue(turn.endswith("[Message du technicien]\ndétaille le cas 2"))
        self.assertIn(understanding._NO_SEARCH_RESULTS, understanding._build_turn_message("x", None, None))

    def test_same_history_gives_the_same_prefix(self):
        history = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
        first = understanding._build_messages(history, "turn 1")
        second = understanding._build_messages(history + [{"role": "user", "content": "turn 1 text"}], "turn 2")
        self.assertEqual(first[:-1], second[:2])

    def test_reply_and_result_position_come_back_from_a_single_call(self):
        response = json.dumps({"intent": "conversation", "result_position": 2, "reply": "Le cas 2 …"})
        with patch.object(llm_service, "generate_chat_reply", return_value=response) as call:
            understood = understanding.understand_message("détaille le cas 2", history=[], search_results_text="Cas 2")
        self.assertEqual((understood.reply, understood.result_position), ("Le cas 2 …", 2))
        call.assert_called_once()
        self.assertEqual(call.call_args.args[0], understanding._SYSTEM_PROMPT)
        self.assertTrue(call.call_args.kwargs["cache_history"])


class LastSearchDescriptionTests(unittest.TestCase):
    def test_cases_and_stats_are_read_from_the_database(self):
        context = {
            "device_type": "gab",
            "last_search": {
                "query": "carte avalée",
                "results": [
                    {"position": 1, "kind": "case", "intervention_id": 3001, "matched_symptom_text": "carte retenue"},
                    {"position": 2, "kind": "stat", "action_text": "Réinitialiser le lecteur", "symptom_text": "Carte retenue",
                     "successes": 3, "attempts": 4, "accuracy_score": 0.75},
                    {"position": 3, "kind": "case", "intervention_id": 404},  # supprimée depuis : ignorée
                ],
            },
        }
        case = {
            "technician_name": "Alan", "device_label": "Agence 14", "opened_at": datetime(2026, 9, 2, 9, 14),
            "matched_symptom_text": "carte retenue", "final_outcome_status": "resolved", "confidence": None,
            "diagnosis": "Capteur encrassé",
            "actions": [{"description": "Nettoyer le capteur", "outcome_status": "resolved", "proposed_by": None}],
        }
        with patch.object(orchestrator.case_retrieval_service, "build_case",
                          side_effect=lambda db, iid, **kwargs: case if iid == 3001 else None):
            text = orchestrator._describe_last_search(MagicMock(), context)
        self.assertIn("carte avalée", text)
        self.assertIn("Cas 1 (Alan, Agence 14, le 02/09/2026)", text)
        self.assertIn("Nettoyer le capteur (problème réglé)", text)
        self.assertIn("Diagnostic : Capteur encrassé.", text)
        self.assertIn("Résultat 2 : action « Réinitialiser le lecteur »", text)
        self.assertNotIn("Cas 3", text)

    def test_no_search_gives_nothing(self):
        self.assertIsNone(orchestrator._describe_last_search(MagicMock(), {}))


class InterventionAddAvailabilityTests(unittest.TestCase):
    def run_turn(self, *, results=None, reply="Conseils", new_search=True, valid=True):
        context = {}
        if not new_search:
            context["last_search"] = {"query": "ancienne panne", "results": []}

        def route(*args):
            if new_search:
                context["last_search"] = {"query": "nouvelle panne", "results": results or []}
            return reply

        with (
            patch.object(orchestrator.conversation_service, "get_or_create_conversation",
                         return_value=MagicMock(conversation_id=15)),
            patch.object(orchestrator.context_service, "get_context", return_value=context),
            patch.object(orchestrator.context_service, "save_context"),
            patch.object(orchestrator.conversation_service, "save_message"),
            patch.object(orchestrator.conversation_service, "mark_conversation_active"),
            patch.object(orchestrator, "_load_history", return_value=[]),
            patch.object(orchestrator, "_describe_last_search", return_value=None),
            patch.object(orchestrator, "validate_and_clean_message",
                         return_value=MagicMock(valid=valid, cleaned_text="panne", reason=None)),
            patch.object(orchestrator.message_understanding_service, "understand_message",
                         return_value=MagicMock(intent="diagnostic")),
            patch.object(orchestrator, "_route_message", side_effect=route),
        ):
            return orchestrator.handle_chat_message(MagicMock(), 15, 4, "panne", "gab")

    def test_empty_search_offers_an_intervention_not_a_solution_attachment(self):
        result = self.run_turn()
        self.assertTrue(result["intervention_add_available"])
        self.assertEqual(result["intervention_add_problem"], "nouvelle panne")
        self.assertFalse(result["solution_proposal_available"])

    def test_relevant_cases_keep_the_solution_attachment(self):
        result = self.run_turn(results=[{"intervention_id": 3001}])
        self.assertFalse(result["intervention_add_available"])
        self.assertIsNone(result["intervention_add_problem"])
        self.assertTrue(result["solution_proposal_available"])

    def test_candidates_rejected_by_synthesis_offer_a_new_intervention(self):
        for subject in ("intervention", "solution"):
            with self.subTest(subject=subject):
                result = self.run_turn(
                    results=[{"intervention_id": 3001}],
                    reply=f"**Aucune {subject} correspondant à ce problème n’a été trouvée dans notre base de données.**",
                )
                self.assertTrue(result["intervention_add_available"])
                self.assertFalse(result["solution_proposal_available"])

    def test_followup_does_not_offer_an_intervention_from_an_old_search(self):
        result = self.run_turn(new_search=False)
        self.assertFalse(result["intervention_add_available"])
        self.assertFalse(result["solution_proposal_available"])

    def test_invalid_input_does_not_offer_an_intervention(self):
        result = self.run_turn(valid=False)
        self.assertFalse(result["intervention_add_available"])


def ok_response(payload):
    response = MagicMock(status_code=200)
    response.json.return_value = payload
    return response


class ProviderConversationPayloadTests(unittest.TestCase):
    MESSAGES = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "user", "content": "c"}]

    def test_claude_receives_system_prompt_and_all_messages(self):
        with patch.object(requests, "post", return_value=ok_response({"content": [{"type": "text", "text": "ok"}]})) as post:
            llm_service.ClaudeProvider("key", "model").generate_chat("consigne", self.MESSAGES)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["system"], "consigne")
        self.assertEqual(payload["messages"], self.MESSAGES)

    def test_claude_caches_the_system_prompt_and_the_history_but_not_the_last_message(self):
        response = ok_response({
            "content": [{"type": "text", "text": "ok"}],
            "usage": {"cache_read_input_tokens": 900, "cache_creation_input_tokens": 40, "input_tokens": 60},
        })
        with patch.object(requests, "post", return_value=response) as post:
            llm_service.ClaudeProvider("key", "model").generate_chat("consigne", self.MESSAGES, cache_history=True)
        payload = post.call_args.kwargs["json"]
        cache = {"type": "ephemeral", "ttl": "1h"}
        self.assertEqual(payload["system"], [{"type": "text", "text": "consigne", "cache_control": cache}])
        self.assertEqual(payload["messages"][1]["content"], [{"type": "text", "text": "b", "cache_control": cache}])
        self.assertEqual(payload["messages"][0], {"role": "user", "content": "a"})
        self.assertEqual(payload["messages"][2], {"role": "user", "content": "c"})
        self.assertEqual(self.MESSAGES[1]["content"], "b")  # les messages de l'appelant ne sont pas modifiés

    def test_first_message_has_no_history_to_cache(self):
        with patch.object(requests, "post", return_value=ok_response({"content": [{"type": "text", "text": "ok"}]})) as post:
            llm_service.ClaudeProvider("key", "model").generate_chat("consigne", self.MESSAGES[:1], cache_history=True)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["messages"], self.MESSAGES[:1])
        self.assertIn("cache_control", payload["system"][0])

    def test_gemini_ignores_the_cache_option(self):
        response = ok_response({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})
        with patch.object(requests, "post", return_value=response) as post:
            llm_service.GeminiProvider("key", "model").generate_chat("consigne", self.MESSAGES, cache_history=True)
        self.assertNotIn("cache_control", json.dumps(post.call_args.kwargs["json"]))

    def test_gemini_maps_assistant_to_model(self):
        response = MagicMock(status_code=200)
        response.json.return_value = {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
        with patch("requests.post", return_value=response) as post:
            llm_service.GeminiProvider("key", "model").generate_chat(
                "consigne", [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
            )
        payload = post.call_args.kwargs["json"]
        self.assertEqual([c["role"] for c in payload["contents"]], ["user", "model"])
        self.assertEqual(payload["systemInstruction"]["parts"][0]["text"], "consigne")


if __name__ == "__main__":
    unittest.main()
