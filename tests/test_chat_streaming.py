"""Flux du chat : progression avant la fin, erreurs neutres et déconnexion."""

import asyncio
import json
from threading import Event
import unittest
from unittest.mock import MagicMock, patch

from app.api.routes import chat as routes
from app.schemas.conversation_schema import ChatRequest
from app.services import llm_service


class ChatStreamingTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.session = MagicMock()
        self.session.__enter__.return_value = self.db
        session_patch = patch.object(routes, "SessionLocal", return_value=self.session)
        identity_patch = patch.object(routes, "effective_technician_id", return_value=1)
        session_patch.start()
        identity_patch.start()
        self.addCleanup(session_patch.stop)
        self.addCleanup(identity_patch.stop)
        self.payload = ChatRequest(technician_id=1, message="Panne", device_type="gab")

    def test_first_delta_arrives_before_the_final_response(self):
        release = Event()

        def handle(**kwargs):
            kwargs["on_reply_delta"]("Début ")
            if not release.wait(5):
                raise TimeoutError("Le consommateur n'a pas reçu le premier morceau.")
            kwargs["on_reply_delta"]("complet.")
            return {"conversation_id": 7, "reply": "Début complet."}

        async def consume(response):
            first = json.loads(await anext(response.body_iterator))
            self.assertEqual(first, {"type": "delta", "text": "Début "})
            release.set()
            return [first, *[json.loads(line) async for line in response.body_iterator]]

        with patch.object(routes.chat_orchestrator_service, "handle_chat_message", side_effect=handle):
            response = routes.stream_chat(self.payload, MagicMock())
            events = asyncio.run(consume(response))
        self.assertEqual([event["type"] for event in events], ["delta", "delta", "done"])
        self.assertEqual(events[-1]["response"]["reply"], "Début complet.")
        self.assertEqual(response.headers["x-accel-buffering"], "no")
        self.session.__exit__.assert_called_once()

    def test_failure_after_a_delta_has_no_done_or_private_detail(self):
        def handle(**kwargs):
            kwargs["on_reply_delta"]("Texte provisoire")
            raise llm_service.LLMUnavailableError("PRIVATE_PROVIDER_DETAILS")

        async def consume(response):
            return [json.loads(line) async for line in response.body_iterator]

        with patch.object(routes.chat_orchestrator_service, "handle_chat_message", side_effect=handle):
            events = asyncio.run(consume(routes.stream_chat(self.payload, MagicMock())))
        self.assertEqual([event["type"] for event in events], ["delta", "error"])
        self.assertEqual(events[-1]["status"], 503)
        self.assertNotIn("PRIVATE", json.dumps(events))
        self.db.commit.assert_not_called()
        self.session.__exit__.assert_called_once()

    def test_disconnect_stops_the_producer_before_commit(self):
        release, finished = Event(), Event()

        def handle(**kwargs):
            try:
                kwargs["on_reply_delta"]("Début")
                release.wait(5)
                kwargs["on_reply_delta"]("")
                self.db.commit()
                return {"conversation_id": 7, "reply": "Début complet."}
            finally:
                finished.set()

        async def consume(response):
            await anext(response.body_iterator)
            await response.body_iterator.aclose()
            release.set()
            await asyncio.to_thread(finished.wait, 5)

        with patch.object(routes.chat_orchestrator_service, "handle_chat_message", side_effect=handle):
            asyncio.run(consume(routes.stream_chat(self.payload, MagicMock())))
        self.assertTrue(finished.is_set())
        self.db.commit.assert_not_called()
