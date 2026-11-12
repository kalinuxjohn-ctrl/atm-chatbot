from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import ReferenceNotFoundError
from app.main import app
from app.models.conversation import Conversation
from app.services import conversation_service as service


NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)
SECRET = "history-test-gateway-secret"
HEADERS = {"X-Atm-Chatbot-Gateway-Secret": SECRET, "X-Authenticated-Technician-Id": "7"}


@pytest.fixture
def history_client(monkeypatch):
    monkeypatch.setattr(settings, "atm_chatbot_gateway_shared_secret", SECRET)
    with patch.dict(app.dependency_overrides, {get_db: lambda: MagicMock()}):
        yield TestClient(app)


def test_history_requires_authenticated_gateway(history_client):
    assert history_client.get("/api/chat/conversations?technician_id=7").status_code == 401
    assert history_client.get("/api/chat/conversations/1?technician_id=7").status_code == 401


def test_list_uses_authenticated_owner_and_validates_pagination(history_client):
    with patch.object(service, "list_conversations", return_value={"items": [], "has_more": False}) as listing:
        response = history_client.get("/api/chat/conversations?technician_id=999&offset=30&limit=10", headers=HEADERS)
    assert response.status_code == 200
    assert listing.call_args.args[1:] == (7, 30, 10)
    for query in ("offset=-1", "limit=0", "limit=101", "technician_id=0"):
        assert history_client.get(f"/api/chat/conversations?technician_id=7&{query}", headers=HEADERS).status_code == 422


def test_detail_returns_complete_ordered_messages_with_device_type(history_client):
    history = {
        "conversation_id": 25, "device_type": "tpe",
        "messages": [
            {"message_id": 1, "role": "user", "content": "Ecran noir", "created_at": NOW},
            {"message_id": 2, "role": "assistant", "content": "Verifier le terminal", "created_at": NOW},
        ],
    }
    with patch.object(service, "get_conversation_history", return_value=history) as reading:
        response = history_client.get("/api/chat/conversations/25?technician_id=999", headers=HEADERS)
    assert response.status_code == 200
    assert reading.call_args.args[1:] == (25, 7)
    assert response.json()["device_type"] == "tpe"
    assert [message["role"] for message in response.json()["messages"]] == ["user", "assistant"]


def test_missing_or_foreign_conversation_is_not_found(history_client):
    with patch.object(service, "get_conversation_history", side_effect=ReferenceNotFoundError("Conversation introuvable.")):
        assert history_client.get("/api/chat/conversations/25?technician_id=7", headers=HEADERS).status_code == 404


def test_service_filters_owner_before_reading_any_messages():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    with patch.object(service, "get_messages_after") as messages:
        with pytest.raises(ReferenceNotFoundError):
            service.get_conversation_history(db, 25, 7)
    clauses = db.query.return_value.filter.call_args.args
    assert {str(clause.left): clause.right.value for clause in clauses} == {
        "conversation.conversation_id": 25, "conversation.technician_id": 7,
    }
    messages.assert_not_called()
    db.commit.assert_not_called()


def test_listing_paginates_with_one_extra_row_and_does_not_expose_context():
    db = MagicMock()
    rows = [(SimpleNamespace(conversation_id=i, created_at=NOW, updated_at=NOW), "x" * 200) for i in (3, 2, 1)]
    query = db.query.return_value
    query.filter.return_value.order_by.return_value.offset.return_value.limit.return_value.all.return_value = rows
    result = service.list_conversations(db, 7, 30, 2)
    assert result["has_more"]
    assert [row["conversation_id"] for row in result["items"]] == [3, 2]
    assert all(len(row["title"]) == 160 for row in result["items"])
    query.filter.return_value.order_by.return_value.offset.assert_called_once_with(30)
    query.filter.return_value.order_by.return_value.offset.return_value.limit.assert_called_once_with(3)


def test_detail_reads_messages_without_rewriting_context():
    db = MagicMock()
    conversation = Conversation(conversation_id=25, technician_id=7)
    conversation.context = None
    db.query.return_value.filter.return_value.first.return_value = conversation
    message = SimpleNamespace(
        message_id=2, role="assistant", content="Reponse", created_at=NOW,
        detected_error_code=None, error_code_id=None,
    )
    with patch.object(service, "get_messages_after", return_value=[message]):
        history = service.get_conversation_history(db, 25, 7)
    assert history["device_type"] == "gab"
    assert history["messages"][0]["content"] == "Reponse"
    assert conversation.context is None
    db.commit.assert_not_called()
