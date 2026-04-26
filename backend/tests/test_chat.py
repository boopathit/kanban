"""Integration tests for /api/chat and /api/chat/history."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import HARDCODED_PASSWORD, HARDCODED_USERNAME
from app.config import Settings, get_settings
from app.db import init_db, make_engine, make_session_factory, new_id, utc_now_iso
from app.main import create_app
from app.models import Board, Card, Column, Conversation, Message, User


@pytest.fixture
def auth_client_chat(tmp_path: Path) -> TestClient:
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html><html/>", encoding="utf-8")
    settings = Settings(
        SESSION_SECRET="test-secret",
        OPENROUTER_API_KEY="sk-test-router",
        DB_PATH=tmp_path / "pm.db",
        STATIC_DIR=static_dir,
    )
    app = create_app(settings)
    client = TestClient(app)
    login = client.post(
        "/api/auth/login",
        json={"username": HARDCODED_USERNAME, "password": HARDCODED_PASSWORD},
    )
    assert login.status_code == 200, login.text
    return client


def _board(client: TestClient) -> dict:
    r = client.get("/api/board")
    assert r.status_code == 200, r.text
    return r.json()


def _column(board: dict, title: str) -> dict:
    for c in board["columns"]:
        if c["title"] == title:
            return c
    raise AssertionError(f"column {title!r} not found")


def _messages(client: TestClient) -> list[dict]:
    r = client.get("/api/chat/history")
    assert r.status_code == 200, r.text
    return r.json()["messages"]


def _mock_llm_response(reply_obj: dict) -> dict:
    import json

    return {"choices": [{"message": {"role": "assistant", "content": json.dumps(reply_obj)}}]}


def _seed_other_user_card(settings: Settings, username: str) -> dict[str, str]:
    engine = make_engine(settings)
    init_db(engine)
    SessionLocal = make_session_factory(engine)
    now = utc_now_iso()
    with SessionLocal() as session:
        user = User(id=new_id(), username=username, created_at=now)
        session.add(user)
        session.flush()
        board = Board(id=new_id(), user_id=user.id, created_at=now)
        session.add(board)
        session.flush()
        column = Column(
            id=new_id(),
            board_id=board.id,
            title="Other backlog",
            position=0,
            created_at=now,
        )
        session.add(column)
        session.flush()
        card = Card(
            id=new_id(),
            column_id=column.id,
            title="Secret",
            details="not yours",
            position=0,
            created_at=now,
            updated_at=now,
        )
        session.add(card)
        session.commit()
        return {"card_id": card.id}


def _settings_from_client(client: TestClient) -> Settings:
    provider = client.app.dependency_overrides[get_settings]
    return provider()


def test_chat_reply_only_stores_messages(monkeypatch: pytest.MonkeyPatch, auth_client_chat: TestClient) -> None:
    async def fake_chat(**_: object) -> dict:
        return _mock_llm_response({"reply": "I can help with that.", "board_update": None})

    monkeypatch.setattr("app.routes.ai.chat", fake_chat)

    before = _board(auth_client_chat)
    r = auth_client_chat.post("/api/chat", json={"message": "hello"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == "I can help with that."
    assert body["applied_ops"] == []
    assert body["updated_board"] is None
    assert _board(auth_client_chat) == before

    history = _messages(auth_client_chat)
    assert history[-2]["role"] == "user"
    assert history[-2]["content"] == "hello"
    assert history[-1]["role"] == "assistant"
    assert history[-1]["content"] == "I can help with that."


def test_chat_rename_column_updates_board(monkeypatch: pytest.MonkeyPatch, auth_client_chat: TestClient) -> None:
    board = _board(auth_client_chat)
    backlog_id = _column(board, "Backlog")["id"]

    async def fake_chat(**_: object) -> dict:
        return _mock_llm_response(
            {
                "reply": "Renamed it.",
                "board_update": {
                    "operations": [
                        {"op": "rename_column", "column_id": backlog_id, "title": "Inbox"}
                    ]
                },
            }
        )

    monkeypatch.setattr("app.routes.ai.chat", fake_chat)
    r = auth_client_chat.post("/api/chat", json={"message": "rename backlog to inbox"})
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["applied_ops"] == [
        {"op": "rename_column", "column_id": backlog_id, "title": "Inbox"}
    ]
    assert payload["updated_board"] is not None
    titles = [c["title"] for c in payload["updated_board"]["columns"]]
    assert "Inbox" in titles

    titles2 = [c["title"] for c in _board(auth_client_chat)["columns"]]
    assert "Inbox" in titles2


def test_chat_create_and_update_apply_atomically(
    monkeypatch: pytest.MonkeyPatch, auth_client_chat: TestClient
) -> None:
    board = _board(auth_client_chat)
    backlog_id = _column(board, "Backlog")["id"]
    review_id = _column(board, "Review")["id"]
    existing_card_id = _column(board, "Backlog")["cardIds"][0]

    async def fake_chat(**_: object) -> dict:
        return _mock_llm_response(
            {
                "reply": "Done.",
                "board_update": {
                    "operations": [
                        {
                            "op": "create_card",
                            "column_id": backlog_id,
                            "title": "From chat",
                            "details": "new",
                        },
                        {
                            "op": "update_card",
                            "card_id": existing_card_id,
                            "column_id": review_id,
                            "position": 0,
                            "title": "Moved by chat",
                        },
                    ]
                },
            }
        )

    monkeypatch.setattr("app.routes.ai.chat", fake_chat)
    r = auth_client_chat.post("/api/chat", json={"message": "do two things"})
    assert r.status_code == 200, r.text
    payload = r.json()
    assert len(payload["applied_ops"]) == 2
    board2 = _board(auth_client_chat)
    cards = board2["cards"]
    assert any(c["title"] == "From chat" for c in cards.values())
    assert cards[existing_card_id]["title"] == "Moved by chat"
    review = _column(board2, "Review")
    assert review["cardIds"][0] == existing_card_id


def test_chat_rejects_cross_user_card_reference(
    monkeypatch: pytest.MonkeyPatch, auth_client_chat: TestClient
) -> None:
    settings = _settings_from_client(auth_client_chat)
    other = _seed_other_user_card(settings, "intruder-chat")

    async def fake_chat(**_: object) -> dict:
        return _mock_llm_response(
            {
                "reply": "Tried, but could not apply it.",
                "board_update": {"operations": [{"op": "delete_card", "card_id": other["card_id"]}]},
            }
        )

    monkeypatch.setattr("app.routes.ai.chat", fake_chat)
    board_before = _board(auth_client_chat)
    r = auth_client_chat.post("/api/chat", json={"message": "delete secret"})
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["applied_ops"] == []
    assert payload["op_error"]
    assert _board(auth_client_chat) == board_before


def test_chat_malformed_model_json_returns_502_but_keeps_user_message(
    monkeypatch: pytest.MonkeyPatch, auth_client_chat: TestClient
) -> None:
    async def fake_chat(**_: object) -> dict:
        return {"choices": [{"message": {"role": "assistant", "content": "not-json"}}]}

    monkeypatch.setattr("app.routes.ai.chat", fake_chat)

    r = auth_client_chat.post("/api/chat", json={"message": "hello malformed"})
    assert r.status_code == 502
    assert r.json()["detail"] == "The AI service returned an invalid response."

    history = _messages(auth_client_chat)
    assert history[-1]["role"] == "user"
    assert history[-1]["content"] == "hello malformed"


def test_history_is_capped_to_last_30(auth_client_chat: TestClient) -> None:
    settings = _settings_from_client(auth_client_chat)
    engine = make_engine(settings)
    SessionLocal = make_session_factory(engine)
    now = utc_now_iso()
    auth_client_chat.get("/api/chat/history")

    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.username == HARDCODED_USERNAME))
        assert user is not None
        conversation = session.scalar(select(Conversation).where(Conversation.user_id == user.id))
        assert conversation is not None
        for i in range(40):
            session.add(
                Message(
                    id=new_id(),
                    conversation_id=conversation.id,
                    role="user",
                    content=f"msg-{i}",
                    created_at=f"{now}-{i:02d}",
                )
            )
        session.commit()

    history = _messages(auth_client_chat)
    assert len(history) == 30
    assert history[0]["content"] == "msg-10"
    assert history[-1]["content"] == "msg-39"


@pytest.mark.live
def test_live_chat_can_create_backlog_card(tmp_path: Path) -> None:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        pytest.skip("OPENROUTER_API_KEY not set")
    if os.environ.get("RUN_OPENROUTER_LIVE", "") != "1":
        pytest.skip("Set RUN_OPENROUTER_LIVE=1 to call the real OpenRouter API")

    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html><html/>", encoding="utf-8")
    settings = Settings(
        SESSION_SECRET="test-secret",
        OPENROUTER_API_KEY=api_key,
        DB_PATH=tmp_path / "pm.db",
        STATIC_DIR=static_dir,
    )
    app = create_app(settings)
    client = TestClient(app)
    login = client.post(
        "/api/auth/login",
        json={"username": HARDCODED_USERNAME, "password": HARDCODED_PASSWORD},
    )
    assert login.status_code == 200, login.text

    title = "Test"
    details = "from chat"
    prompt = f"Please add a card titled '{title}' to Backlog with details '{details}'"
    r = client.post("/api/chat", json={"message": prompt})
    assert r.status_code == 200, r.text
    board = client.get("/api/board").json()
    assert any(
        c["title"] == title and c["details"] == details for c in board["cards"].values()
    )
