"""External resource failures are explicit; all network and SQL calls are mocked."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests
from sqlalchemy.exc import OperationalError

from app import main
from app.core.errors import ExternalServiceUnavailableError, InvalidReferenceError, StateConflictError
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import (
    chat_orchestrator_service as orchestrator,
    embeddings_service as embeddings,
    llm_service,
    message_understanding_service as understanding,
    retrieval_service,
    stats_service,
)


def api_response(payload=None, status=200):
    response = MagicMock()
    response.status_code = status
    response.json.return_value = payload
    if status >= 400:
        response.raise_for_status.side_effect = requests.HTTPError("upstream error")
    return response


class ExternalProviderTests(unittest.TestCase):
    def setUp(self):
        self.providers = (
            (llm_service.ClaudeProvider("test-key", "test-model"), llm_service.LLMUnavailableError),
            (llm_service.GeminiProvider("test-key", "test-model"), llm_service.LLMUnavailableError),
            (embeddings.VoyageProvider("test-key", "test-model", 2), embeddings.EmbeddingUnavailableError),
        )
        patcher = patch.object(embeddings.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)

    def call_provider(self, provider):
        if isinstance(provider, embeddings.VoyageProvider):
            return provider.embed("test text", False)
        return provider.generate("test prompt")

    def test_network_failures_preserve_the_cause(self):
        for provider, error_type in self.providers:
            for cause, message in (
                (requests.ConnectionError("DNS unavailable"), "connexion"),
                (requests.Timeout(), "délai"),
                (requests.ConnectTimeout(), "délai"),
                (requests.RequestException(), "réseau"),
            ):
                with self.subTest(provider=type(provider).__name__, cause=type(cause).__name__):
                    with patch("requests.post", side_effect=cause) as post:
                        with self.assertRaisesRegex(error_type, message) as result:
                            self.call_provider(provider)
                    self.assertIs(result.exception.__cause__, cause)
                    post.assert_called_once()

    def test_http_errors_never_return_a_result(self):
        for provider, error_type in self.providers:
            for status in (400, 401, 403, 404, 429, 500, 503):
                with self.subTest(provider=type(provider).__name__, status=status):
                    with patch("requests.post", return_value=api_response(status=status)) as post:
                        with self.assertRaises(error_type):
                            self.call_provider(provider)
                    retries = (
                        embeddings._MAX_RETRIES_ON_RATE_LIMIT
                        if isinstance(provider, embeddings.VoyageProvider) and (status == 429 or status >= 500)
                        else 1
                    )
                    self.assertEqual(post.call_count, retries)
                    self.assertEqual(len({call.args[0] for call in post.call_args_list}), 1)

    def test_missing_keys_do_not_make_network_calls(self):
        for provider, error_type in self.providers:
            with self.subTest(provider=type(provider).__name__):
                provider.api_key = ""
                with patch("requests.post") as post:
                    with self.assertRaises(error_type):
                        self.call_provider(provider)
                post.assert_not_called()

    def test_malformed_json_is_wrapped(self):
        for provider, error_type in self.providers:
            with self.subTest(provider=type(provider).__name__):
                response = api_response()
                response.json.side_effect = ValueError("invalid JSON")
                with patch("requests.post", return_value=response):
                    with self.assertRaises(error_type):
                        self.call_provider(provider)

    def test_llm_payload_shape_and_text_are_validated(self):
        payloads = (
            None, [], {}, {"content": None}, {"content": [None]},
            {"content": [{"type": "text", "text": "   "}]},
            {"content": [{"type": "text", "text": 123}]},
            {"candidates": [{"content": {"parts": [{"text": None}]}}]},
            {"candidates": [{"content": {"parts": [{"text": " "}]}}]},
        )
        for provider, error_type in self.providers[:2]:
            for payload in payloads:
                with self.subTest(provider=type(provider).__name__, payload=payload):
                    with patch("requests.post", return_value=api_response(payload)):
                        with self.assertRaises(error_type):
                            self.call_provider(provider)

    def test_successful_llm_responses_are_preserved(self):
        payloads = (
            {"content": [{"type": "thinking"}, {"type": "text", "text": "response"}]},
            {"candidates": [{"content": {"parts": [{"text": "response"}]}}]},
        )
        for (provider, _), payload in zip(self.providers[:2], payloads):
            with patch("requests.post", return_value=api_response(payload)):
                self.assertEqual(self.call_provider(provider), "response")

    def test_voyage_rejects_invalid_vectors_and_indices(self):
        provider, error_type = self.providers[2]
        for vector in (None, "12", [], [1.0], [1.0, "x"], [True, 1.0],
                       [float("nan"), 1.0], [float("inf"), 1.0], [0.0, 0.0]):
            with self.subTest(vector=vector):
                payload = {"data": [{"index": 0, "embedding": vector}]}
                with patch("requests.post", return_value=api_response(payload)):
                    with self.assertRaises(error_type):
                        self.call_provider(provider)
        for data in ([], [{"index": 1, "embedding": [1.0, 0.0]}],
                     [{"index": 0, "embedding": [1.0, 0.0]}] * 2):
            with self.subTest(data=data):
                with patch("requests.post", return_value=api_response({"data": data})):
                    with self.assertRaises(error_type):
                        self.call_provider(provider)

    def test_voyage_batch_preserves_input_order(self):
        provider, _ = self.providers[2]
        payload = {"data": [
            {"index": 1, "embedding": [0.0, 1.0]},
            {"index": 0, "embedding": [1.0, 0.0]},
        ]}
        with patch("requests.post", return_value=api_response(payload)):
            self.assertEqual(provider.embed_batch(["first", "second"], False), [[1.0, 0.0], [0.0, 1.0]])


class ExternalPipelineTests(unittest.TestCase):
    def test_invalid_embedding_configuration_and_dimensions_are_wrapped(self):
        for batch in (False, True):
            generate = embeddings.generate_embeddings_batch if batch else embeddings.generate_embedding
            text = ["message"] if batch else "message"
            with self.subTest(batch=batch):
                for provider in ("unsupported", ""):
                    with patch.object(embeddings.settings, "embedding_provider", provider):
                        with self.assertRaises(embeddings.EmbeddingUnavailableError):
                            generate(text)
                provider = MagicMock()
                provider.embed.return_value = [1.0]
                provider.embed_batch.return_value = [[1.0]]
                with patch.object(embeddings, "_resolve_provider", return_value=(provider, "test-model")):
                    with self.assertRaises(embeddings.EmbeddingUnavailableError):
                        generate(text, dimensions=2)

    def test_no_artificial_vectors_for_empty_text(self):
        with patch("requests.post") as post:
            for text in ("", " \t ", None):
                with self.assertRaises(InvalidReferenceError):
                    embeddings.generate_embedding(text)
            with self.assertRaises(InvalidReferenceError):
                embeddings.generate_embeddings_batch(["valid", " "])
            self.assertEqual(embeddings.generate_embeddings_batch([]), [])
        post.assert_not_called()

    def test_batch_cardinality_errors_are_not_padded(self):
        provider = MagicMock()
        provider.embed_batch.return_value = [[1.0, 0.0]]
        with patch.object(embeddings, "_resolve_provider", return_value=(provider, "test-model")):
            with self.assertRaises(embeddings.EmbeddingUnavailableError):
                embeddings.generate_embeddings_batch(["first", "second"], dimensions=2)

    def test_failed_query_embeddings_are_not_cached(self):
        embeddings._cached_query_embedding.cache_clear()
        self.addCleanup(embeddings._cached_query_embedding.cache_clear)
        provider = MagicMock()
        provider.embed.side_effect = [RuntimeError("unavailable"), [1.0, 0.0]]
        with (
            patch.object(embeddings, "_resolve_provider", return_value=(provider, "test-model")),
            patch.object(embeddings.settings, "embedding_dimensions", 2),
        ):
            with self.assertRaises(embeddings.EmbeddingUnavailableError):
                embeddings.generate_embedding("query", is_query=True)
            self.assertEqual(embeddings.generate_embedding("query", is_query=True), [1.0, 0.0])
        self.assertEqual(provider.embed.call_count, 2)

    def test_understanding_rejects_invalid_content(self):
        # '{"intent":"conversation"}' : hors diagnostic, une réponse est obligatoire.
        for response in ('{}', '{"intent":"unknown"}', '{"intent":"conversation"}', "not JSON", None):
            with self.subTest(response=response):
                with patch.object(llm_service, "generate_chat_reply", return_value=response):
                    with self.assertRaises(llm_service.LLMUnavailableError):
                        understanding.understand_message("message")

    def test_case_summary_does_not_hide_llm_failures(self):
        failure = llm_service.LLMUnavailableError("unavailable")
        with (
            patch.object(orchestrator, "_format_case", return_value="case text"),
            patch.object(llm_service, "generate_reply", side_effect=failure) as generate,
        ):
            with self.assertRaises(llm_service.LLMUnavailableError):
                orchestrator._summarize_cases("query", [{}])
        generate.assert_called_once()

    def test_conversation_failure_is_not_hidden(self):
        with patch.object(llm_service, "generate_chat_reply", side_effect=llm_service.LLMUnavailableError("down")):
            with self.assertRaises(llm_service.LLMUnavailableError):
                understanding.understand_message("détaille le cas 2", history=[{"role": "user", "content": "x"}])

    def test_catalog_match_does_not_retry_with_python(self):
        db = MagicMock()
        db.execute.side_effect = OperationalError("query", {}, Exception("unavailable"))
        with self.assertRaises(ExternalServiceUnavailableError):
            retrieval_service.find_best_catalog_match(db, "text", "gab", query_vector=[1.0, 0.0])
        db.execute.assert_called_once()
        db.begin_nested.return_value.rollback.assert_called_once()
        db.rollback.assert_not_called()

    def test_failed_case_search_does_not_try_aggregate_search(self):
        with (
            patch.object(orchestrator.technical_reference_resolver_service,
                         "resolve_technical_references", return_value={}),
            patch.object(orchestrator.case_retrieval_service, "find_similar_cases",
                         side_effect=ExternalServiceUnavailableError("search unavailable")),
            patch.object(retrieval_service, "find_ranked_solutions") as aggregate,
        ):
            with self.assertRaises(ExternalServiceUnavailableError):
                orchestrator._handle_symptom_search(
                    MagicMock(), {"device_type": "gab"},
                    UnderstoodMessage(intent="diagnostic", reformulated_problem_text="text"),
                )
        aggregate.assert_not_called()

    def test_statistics_failure_reports_that_the_write_is_already_saved(self):
        db = MagicMock()
        with patch.object(stats_service, "recompute_stats",
                          side_effect=OperationalError("query", {}, Exception("unavailable"))):
            with self.assertRaisesRegex(StateConflictError, "a été enregistrée"):
                stats_service.recompute_stats_safely(db)
        db.rollback.assert_called_once()

    def test_database_handler_does_not_expose_sql_parameters(self):
        request = SimpleNamespace(url=SimpleNamespace(path="/api/chat"))
        error = OperationalError("SECRET_SQL", {"text": "SECRET_TEXT"}, Exception("SECRET_PASSWORD"))
        response = main._erreur_base_de_donnees(request, error)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SECRET", response.body.decode())


if __name__ == "__main__":
    unittest.main()
