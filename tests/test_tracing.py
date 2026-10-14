"""Tests de tracing sans connexion PostgreSQL ni appel réel au LLM."""

import io
import logging
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.exc import OperationalError

from app import main
from app.api.routes import chat as chat_routes
from app.core import tracing
from app.schemas.conversation_schema import ChatRequest
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import (
    chat_orchestrator_service as orchestrator,
    llm_service,
    message_understanding_service as understanding,
    retrieval_service,
    technical_reference_resolver_service as resolver,
)


class TracingTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        handler = logging.StreamHandler(self.output)
        handler.setFormatter(logging.Formatter(
            "[TRACE][%(trace_category)s] %(filename)s:%(lineno)d - %(message)s"
        ))
        self.addCleanup(patch.stopall)
        patch.object(tracing._logger, "handlers", [handler]).start()
        patch.object(tracing._logger, "disabled", False).start()
        patch.object(tracing, "TRACING_ENABLED", True).start()

    def test_format_and_caller(self):
        tracing.trace("TEST", "Message", count=3)
        output = self.output.getvalue()
        self.assertRegex(output, r"\[TRACE\]\[TEST\] test_tracing.py:\d+ - Message")
        self.assertIn("count=3", output)

    def test_disabled_produces_no_output(self):
        tracing.TRACING_ENABLED = False
        tracing.trace("TEST", "Message")
        self.assertEqual(self.output.getvalue(), "")

    def test_logging_failure_does_not_escape(self):
        with patch.object(tracing._logger, "info", side_effect=RuntimeError("broken handler")):
            tracing.trace("TEST", "Message")

    def test_understanding_success_does_not_log_extracted_text(self):
        response = (
            '{"intent":"diagnostic","model_name_text":"SECRET_MODEL",'
            '"error_code_text":"SECRET_CODE","reformulated_problem_text":"SECRET_PROBLEM"}'
        )
        with patch.object(understanding.llm_service, "generate_chat_reply", return_value=response):
            result = understanding.understand_message("SECRET_MESSAGE")
        self.assertEqual(result.intent, "diagnostic")
        self.assertEqual(result.model_name_text, "SECRET_MODEL")
        output = self.output.getvalue()
        self.assertIn("[UNDERSTANDING]", output)
        self.assertNotIn("SECRET", output)

    def test_unreadable_understanding_raises_instead_of_guessing_diagnostic(self):
        # Avant : une réponse illisible faisait traiter le message comme une
        # panne (un « bonjour » affichait des cas). Désormais : erreur 503.
        with patch.object(understanding.llm_service, "generate_chat_reply", return_value="SECRET_RESPONSE"):
            with self.assertRaises(llm_service.LLMUnavailableError):
                understanding.understand_message("SECRET_MESSAGE")
        self.assertIn("[ERROR]", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_llm_failure_raises_without_fallback(self):
        provider = MagicMock()
        provider.generate.side_effect = llm_service.LLMUnavailableError("Gemini a répondu avec une erreur (503).")
        with patch.object(llm_service, "get_llm_provider", return_value=provider):
            with self.assertRaises(llm_service.LLMUnavailableError):
                llm_service.generate_reply("prompt")
        provider.generate.assert_called_once_with("prompt")

    def test_empty_llm_reply_is_an_error(self):
        provider = MagicMock()
        provider.generate.return_value = "   "
        with patch.object(llm_service, "get_llm_provider", return_value=provider):
            with self.assertRaises(llm_service.LLMUnavailableError):
                llm_service.generate_reply("prompt")

    def test_unavailable_service_returns_neutral_503_and_logs_cause(self):
        request = SimpleNamespace(url=SimpleNamespace(path="/api/chat"))
        response = main._service_externe_indisponible(
            request, llm_service.LLMUnavailableError("Gemini a répondu avec une erreur (503).")
        )
        body = response.body.decode("utf-8")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("Gemini", body)  # le client ne doit pas deviner le fournisseur
        self.assertIn("saturé", body)
        self.assertIn("Gemini a répondu avec une erreur (503).", self.output.getvalue())  # cause claire côté serveur

    def test_reference_resolution_keeps_returned_ids(self):
        db = MagicMock()
        db.execute.return_value.first.side_effect = [(12,), (34,)]
        result = resolver.resolve_technical_references(db, " GAB ", "SECRET_MODEL", "SECRET_CODE")
        self.assertEqual(result["device_type"], "gab")
        self.assertEqual(result["model_id"], 12)
        self.assertEqual(result["error_code_id"], 34)
        self.assertEqual(db.execute.call_count, 2)
        self.assertIn("[REFERENCES]", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_relevance_filter_keeps_results_without_raw_text_output(self):
        candidates = [
            {"symptom_id": 1, "similarity": 0.9, "raw_text": "SECRET_SYMPTOM"},
            {"symptom_id": 2, "similarity": 0.1, "raw_text": "SECRET_OTHER"},
        ]
        with patch("builtins.print") as print_mock:
            result = retrieval_service._apply_relevance_threshold(candidates, 0.5, "pgvector")
        self.assertEqual(result, [candidates[0]])
        print_mock.assert_not_called()
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_vector_search_traces_count_and_keeps_threshold(self):
        db = MagicMock()
        candidates = [
            {"symptom_id": 1, "similarity": 0.9, "raw_text": "SECRET_SYMPTOM"},
            {"symptom_id": 2, "similarity": 0.1, "raw_text": "SECRET_OTHER"},
        ]
        db.execute.return_value.mappings.return_value.all.return_value = candidates
        with (
            patch.object(retrieval_service, "generate_embedding", return_value=[1.0, 0.0]) as embedding,
            patch.object(retrieval_service.settings, "symptom_similarity_threshold", 0.5),
        ):
            result = retrieval_service.fetch_similar_symptoms(db, " SECRET_QUERY ", "gab")
        self.assertEqual(result, [candidates[0]])
        embedding.assert_called_once_with("SECRET_QUERY", is_query=True)
        self.assertIn("count=2", self.output.getvalue())
        self.assertIn("method=pgvector", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_pgvector_failure_raises_without_another_search(self):
        db = MagicMock()
        db.execute.side_effect = OperationalError("SECRET_SQL", {}, Exception("unavailable"))
        with (
            patch.object(retrieval_service, "generate_embedding", return_value=[1.0, 0.0]),
            patch.object(retrieval_service.settings, "symptom_similarity_threshold", 0.5),
        ):
            with self.assertRaises(main.ExternalServiceUnavailableError):
                retrieval_service.fetch_similar_symptoms(db, "SECRET_QUERY", "gab")
        db.execute.assert_called_once()
        # Seul le savepoint est annulé, jamais toute la transaction de l'appelant.
        db.begin_nested.return_value.rollback.assert_called_once()
        db.rollback.assert_not_called()
        self.assertIn("error_type=OperationalError", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_conversation_branch_does_not_search(self):
        with (
            patch.object(orchestrator.llm_service, "generate_reply") as generate,
            patch.object(orchestrator.case_retrieval_service, "find_similar_cases") as search,
        ):
            result = orchestrator._route_message(
                MagicMock(), {}, "hello", UnderstoodMessage(intent="conversation", reply="reply")
            )
        # La réponse vient de l'appel de compréhension : aucun second appel au LLM.
        self.assertEqual(result, "reply")
        generate.assert_not_called()
        search.assert_not_called()
        self.assertIn("sans recherche vectorielle", self.output.getvalue())

    def test_diagnostic_cases_branch(self):
        context = {"device_type": "gab"}
        cases = [{"intervention_id": 7}]
        with (
            patch.object(orchestrator.technical_reference_resolver_service,
                         "resolve_technical_references", return_value={}),
            patch.object(orchestrator.case_retrieval_service, "find_similar_cases", return_value=cases),
            patch.object(orchestrator, "_summarize_cases", return_value="case reply"),
            patch.object(orchestrator.retrieval_service, "find_ranked_solutions") as aggregate,
        ):
            result = orchestrator._handle_symptom_search(
                MagicMock(), context,
                UnderstoodMessage(intent="diagnostic", reformulated_problem_text="SECRET"),
            )
        self.assertEqual(result, "case reply")
        self.assertEqual(context["last_search"]["results"][0]["intervention_id"], 7)
        aggregate.assert_not_called()
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_diagnostic_aggregate_and_empty_branches(self):
        for solutions, expected in (
            ([{"symptom_id": 1, "action_id": 2}], "aggregate reply"),
            ([], "Aucune intervention ni statistique connue pour ce symptôme dans l'historique."),
        ):
            with self.subTest(solutions=solutions):
                context = {"device_type": "gab"}
                with (
                    patch.object(orchestrator.technical_reference_resolver_service,
                                 "resolve_technical_references", return_value={}),
                    patch.object(orchestrator.case_retrieval_service, "find_similar_cases", return_value=[]),
                    patch.object(orchestrator.retrieval_service, "find_ranked_solutions",
                                 return_value={"solutions": solutions}),
                    patch.object(orchestrator.llm_service, "summarize_solutions",
                                 return_value="aggregate reply") as summarize,
                ):
                    result = orchestrator._handle_symptom_search(
                        MagicMock(), context,
                        UnderstoodMessage(intent="diagnostic", reformulated_problem_text="SECRET"),
                    )
                self.assertEqual(result, expected)
                self.assertEqual(len(context["last_search"]["results"]), len(solutions))
                self.assertEqual(summarize.call_count, int(bool(solutions)))

    def test_detail_request_selects_the_designated_result_without_new_search(self):
        context = {"last_search": {"results": [{"position": 1}, {"position": 2, "intervention_id": 9}]}}
        with patch.object(orchestrator.case_retrieval_service, "find_similar_cases") as search:
            result = orchestrator._route_message(
                MagicMock(), context, "détaille le cas 2",
                UnderstoodMessage(intent="conversation", reply="detail", result_position=2),
            )
        self.assertEqual(result, "detail")
        self.assertEqual(context["selected_result"]["intervention_id"], 9)
        search.assert_not_called()

    def test_unknown_result_position_is_ignored(self):
        context = {"last_search": {"results": [{"position": 1}]}}
        result = orchestrator._route_message(
            MagicMock(), context, "le cas 5", UnderstoodMessage(intent="conversation", reply="r", result_position=5)
        )
        self.assertEqual(result, "r")
        self.assertNotIn("selected_result", context)

    def test_persistence_and_http_response(self):
        db = MagicMock()
        with (
            patch.object(orchestrator.conversation_service, "get_or_create_conversation",
                         return_value=SimpleNamespace(conversation_id=42)),
            patch.object(orchestrator.context_service, "get_context", return_value={}),
            patch.object(orchestrator.conversation_service, "save_message") as save,
            patch.object(orchestrator.context_service, "save_context"),
            patch.object(orchestrator.conversation_service, "get_recent_messages", return_value=[]),
            patch.object(orchestrator.message_understanding_service, "understand_message",
                         return_value=UnderstoodMessage(intent="conversation", reply="reply")),
        ):
            response = chat_routes.chat(ChatRequest(technician_id=1, message="SECRET"), db)
        self.assertEqual(response.conversation_id, 42)
        self.assertEqual(response.reply, "reply")
        self.assertEqual(save.call_count, 2)
        db.commit.assert_called_once()
        self.assertIn("endpoint=/chat", self.output.getvalue())
        self.assertNotIn("/chat/api/chat", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())

    def test_route_error_is_traced_and_reraised(self):
        with patch.object(orchestrator, "handle_chat_message", side_effect=ValueError("SECRET")):
            with self.assertRaises(ValueError):
                chat_routes.chat(ChatRequest(technician_id=1, message="SECRET"), MagicMock())
        self.assertIn("error_type=ValueError", self.output.getvalue())
        self.assertNotIn("SECRET", self.output.getvalue())


if __name__ == "__main__":
    unittest.main()
