"""Sélection des fournisseurs LLM conservés, sans requête réseau."""

import json
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.core.config import Settings
from app.services import llm_service


def stream_response(events=None):
    response = MagicMock(status_code=200)
    response.json.return_value = {"content": [{"type": "text", "text": '{"reply":"ok"}'}]}
    if events is None:
        events = [
            {"type": "message_start", "message": {"model": "claude-sonnet-5-5", "content": [],
                                                 "usage": {"input_tokens": 10}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": '{"reply":"'}},
            {"type": "ping"},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": 'ok"}'}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 5}},
            {"type": "message_stop"},
        ]
    response.iter_lines.return_value = [
        line for event in events for line in ("event: " + event["type"], "data: " + json.dumps(event), "")
    ]
    return response


class LLMProviderTests(unittest.TestCase):
    def test_scoped_callback_receives_deltas_before_the_provider_finishes(self):
        response = stream_response()
        lines = response.iter_lines.return_value
        deltas = []

        def incremental_lines():
            for line in lines:
                if line == "event: message_stop":
                    self.assertEqual(deltas, ['{"reply":"', 'ok"}'])
                yield line

        response.iter_lines.return_value = incremental_lines()
        with patch("requests.post", return_value=response):
            with llm_service.stream_reply(deltas.append):
                self.assertEqual(
                    llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question"),
                    '{"reply":"ok"}',
                )
            # La requête suivante ne doit pas réutiliser le destinataire précédent.
            response.iter_lines.return_value = lines
            llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Autre question")
        self.assertEqual(deltas, ['{"reply":"', 'ok"}'])

    def test_fast_chat_preserves_the_schema_and_cache_in_the_request(self):
        response = stream_response()
        schema = {"type": "object", "properties": {}, "additionalProperties": False}
        for response_schema in (None, schema):
            with self.subTest(schema=response_schema), patch("requests.post", return_value=response) as post:
                provider = llm_service.ClaudeProvider("test-key", "claude-sonnet-5-5")
                reply = provider.generate_chat(
                    "Consigne", [{"role": "user", "content": "Question"}],
                    cache_history=True, response_schema=response_schema,
                )
                self.assertEqual(reply, '{"reply":"ok"}')
                payload = post.call_args.kwargs["json"]
                if response_schema is None:
                    self.assertEqual(payload["thinking"], {"type": "between_tools"})
                    self.assertEqual(payload["output_config"], {"effort": "low"})
                else:
                    self.assertNotIn("thinking", payload)
                    self.assertEqual(payload["output_config"], {
                        "format": {"type": "json_schema", "schema": schema},
                    })
                self.assertIn("cache_control", payload["system"][0])
                self.assertTrue(payload["stream"])
                self.assertEqual(post.call_args.kwargs["timeout"], (5, 45))

    def test_fast_chat_can_be_disabled_and_does_not_change_other_models(self):
        response = stream_response()
        for model, fast_chat in (
            ("claude-sonnet-5-5", False),
            ("claude-sonnet-5", True),
            ("claude-sonnet-4-5-20250929", True),
        ):
            with self.subTest(model=model, fast_chat=fast_chat), patch("requests.post", return_value=response) as post:
                llm_service.ClaudeProvider("test-key", model, fast_chat=fast_chat).generate("Question")
                payload = post.call_args.kwargs["json"]
                self.assertNotIn("thinking", payload)
                self.assertNotIn("output_config", payload)

    def test_configured_fast_chat_mode_reaches_the_provider(self):
        with patch.multiple(llm_service.settings, llm_provider="claude", claude_fast_chat=False):
            provider = llm_service.get_llm_provider()
        self.assertFalse(provider.fast_chat)

    def test_stream_preserves_usage_and_logs_first_text_without_content(self):
        response = stream_response()
        with patch("requests.post", return_value=response), patch.object(llm_service, "trace") as trace:
            reply = llm_service.ClaudeProvider("secret-key", "claude-sonnet-5-5").generate("PRIVATE_PROMPT")
        self.assertEqual(reply, '{"reply":"ok"}')
        response.close.assert_called_once()
        first_text = [call for call in trace.call_args_list if call.args[1] == "Premier texte Claude reçu"]
        self.assertEqual(len(first_text), 1)
        self.assertEqual(trace.call_args.kwargs["uncached_input_tokens"], 10)
        self.assertEqual(trace.call_args.kwargs["output_tokens"], 5)
        self.assertNotIn("PRIVATE", str(trace.call_args_list))
        self.assertNotIn("secret-key", str(trace.call_args_list))

    def test_stream_errors_and_missing_end_never_return_partial_text(self):
        for ending in ([], [{"type": "error", "error": {"type": "overloaded_error", "message": "PRIVATE"}}]):
            events = [
                {"type": "message_start", "message": {"content": [], "usage": {}}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": "partial"}},
                *ending,
            ]
            response = stream_response(events)
            with self.subTest(ending=ending), patch("requests.post", return_value=response):
                with self.assertRaises(llm_service.LLMUnavailableError) as error:
                    llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
                self.assertNotIn("PRIVATE", str(error.exception))
                response.close.assert_called_once()

    def test_stream_pings_cannot_extend_the_generation_budget(self):
        response = stream_response([{"type": "ping"}])
        with (
            patch("requests.post", return_value=response),
            patch.object(llm_service, "monotonic", side_effect=[0, 0, 45, 45]),
        ):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, r"génération \(45s\)"):
                llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        response.close.assert_called_once()

    def test_stream_read_timeout_is_explicit_and_closes_the_connection(self):
        import requests
        response = stream_response()
        cause = requests.Timeout()
        response.iter_lines.side_effect = cause
        with patch("requests.post", return_value=response):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "45s sans données") as error:
                llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        self.assertIs(error.exception.__cause__, cause)
        response.close.assert_called_once()

    def test_header_wait_is_not_cut_short_before_the_generation_budget(self):
        import requests
        response = stream_response()

        def delayed_headers(*args, **kwargs):
            # Une réponse démarrant à 20 s doit rester dans le budget de 45 s.
            if kwargs["timeout"][1] < 20:
                raise requests.ReadTimeout()
            return response

        with patch("requests.post", side_effect=delayed_headers) as post:
            reply = llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        self.assertEqual(reply, '{"reply":"ok"}')
        post.assert_called_once()

    def test_header_timeout_is_distinguished_from_a_stream_interruption(self):
        import requests
        with patch("requests.post", side_effect=requests.ReadTimeout()) as post:
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "45s en attendant les en-têtes HTTP"):
                llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        post.assert_called_once()

    def test_wrapped_stream_read_timeout_is_reported_as_a_timeout(self):
        import requests
        from urllib3.exceptions import ReadTimeoutError
        response = stream_response()
        cause = requests.ConnectionError(ReadTimeoutError(None, "/messages", "Read timed out."))
        response.iter_lines.side_effect = cause
        with patch("requests.post", return_value=response):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "45s sans données") as error:
                llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        self.assertIs(error.exception.__cause__, cause)
        response.close.assert_called_once()

    def test_stream_rejects_a_stop_while_a_text_block_is_still_open(self):
        response = stream_response([
            {"type": "message_start", "message": {"content": [], "usage": {}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": "partial"}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {}},
            {"type": "message_stop"},
        ])
        with patch("requests.post", return_value=response):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "flux inexploitable"):
                llm_service.ClaudeProvider("key", "claude-sonnet-5-5").generate("Question")
        response.close.assert_called_once()

    def test_default_is_claude(self):
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.llm_provider, "claude")

    def test_supported_providers(self):
        providers = {"claude": llm_service.ClaudeProvider, "gemini": llm_service.GeminiProvider}
        self.assertEqual(set(llm_service._PROVIDERS), set(providers))
        for name, provider_type in providers.items():
            with self.subTest(provider=name):
                with patch.object(llm_service.settings, "llm_provider", name):
                    self.assertIsInstance(llm_service.get_llm_provider(), provider_type)

    def test_unknown_provider_is_an_explicit_error(self):
        with patch.object(llm_service.settings, "llm_provider", "unsupported"):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "Fournisseur LLM inconnu"):
                llm_service.get_llm_provider()

    def test_model_rejects_an_accidentally_pasted_assignment(self):
        for value in ("CLAUDE_MODEL=claude-sonnet-5-5", " claude-sonnet-5-5", "claude sonnet", ""):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                Settings(_env_file=None, claude_model=value)
        self.assertEqual(Settings(_env_file=None, claude_model="claude-sonnet-5-5").claude_model, "claude-sonnet-5-5")


if __name__ == "__main__":
    unittest.main()
