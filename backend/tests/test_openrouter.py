"""OpenRouter client + /api/ai/ping."""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth import HARDCODED_PASSWORD, HARDCODED_USERNAME
from app.config import Settings
from app.main import create_app
from app.openrouter import CHAT_COMPLETIONS_URL, OpenRouterError, assistant_text, chat


@pytest.fixture
def auth_client_router(tmp_path: Path) -> TestClient:
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


def test_assistant_text_extracts_first_choice() -> None:
    data = {
        "choices": [{"message": {"role": "assistant", "content": "  42  \n"}}],
    }
    assert assistant_text(data) == "42"


def test_assistant_text_empty_on_malformed() -> None:
    assert assistant_text({}) == ""
    assert assistant_text({"choices": []}) == ""


@pytest.mark.asyncio
async def test_chat_posts_expected_payload() -> None:
    async with respx.mock:
        route = respx.post(CHAT_COMPLETIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json={"choices": [{"message": {"role": "assistant", "content": "4"}}]},
            )
        )
        data = await chat(
            api_key="secret-key",
            messages=[{"role": "user", "content": "ping"}],
        )
        assert assistant_text(data) == "4"
        assert route.called
        req = route.calls.last.request
        assert req.headers["authorization"] == "Bearer secret-key"
        payload = json.loads(req.content.decode())
        assert payload["model"] == "openai/gpt-oss-120b"
        assert payload["messages"] == [{"role": "user", "content": "ping"}]
        assert "response_format" not in payload


@pytest.mark.asyncio
async def test_chat_forwards_response_format_when_set() -> None:
    fmt = {"type": "json_object"}

    async with respx.mock:
        route = respx.post(CHAT_COMPLETIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json={"choices": [{"message": {"role": "assistant", "content": "{}"}}]},
            )
        )
        await chat(
            api_key="k",
            messages=[{"role": "user", "content": "x"}],
            response_format=fmt,
        )
        payload = json.loads(route.calls.last.request.content.decode())
        assert payload["response_format"] == fmt


@pytest.mark.asyncio
async def test_chat_raises_on_upstream_500() -> None:
    async with respx.mock:
        respx.post(CHAT_COMPLETIONS_URL).mock(
            return_value=httpx.Response(500, text="upstream failure")
        )
        with pytest.raises(OpenRouterError) as excinfo:
            await chat(api_key="k", messages=[{"role": "user", "content": "x"}])
        assert excinfo.value.status_code == 500


@pytest.mark.asyncio
async def test_chat_raises_on_empty_api_key() -> None:
    with pytest.raises(OpenRouterError):
        await chat(api_key="   ", messages=[{"role": "user", "content": "x"}])


@pytest.mark.asyncio
async def test_chat_raises_on_non_json_body() -> None:
    async with respx.mock:
        respx.post(CHAT_COMPLETIONS_URL).mock(
            return_value=httpx.Response(200, text="not-json")
        )
        with pytest.raises(OpenRouterError) as excinfo:
            await chat(api_key="k", messages=[{"role": "user", "content": "x"}])
        assert excinfo.value.status_code == 502


def test_ai_ping_requires_auth(client: TestClient) -> None:
    r = client.post("/api/ai/ping", json={})
    assert r.status_code == 401


def test_ai_ping_503_when_api_key_missing(auth_client: TestClient) -> None:
    r = auth_client.post("/api/ai/ping", json={})
    assert r.status_code == 503
    assert r.json()["detail"] == "OpenRouter is not configured."


@respx.mock
def test_ai_ping_returns_model_answer(auth_client_router: TestClient) -> None:
    respx.post(CHAT_COMPLETIONS_URL).mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "4"}}]},
        )
    )
    r = auth_client_router.post("/api/ai/ping", json={})
    assert r.status_code == 200, r.text
    assert r.json() == {"answer": "4"}


@respx.mock
def test_ai_ping_502_when_openrouter_returns_500(auth_client_router: TestClient) -> None:
    respx.post(CHAT_COMPLETIONS_URL).mock(return_value=httpx.Response(500, text="boom"))
    r = auth_client_router.post("/api/ai/ping", json={})
    assert r.status_code == 502
    assert r.json()["detail"] == "The AI service returned an error."


@respx.mock
def test_ai_ping_502_when_answer_empty(auth_client_router: TestClient) -> None:
    respx.post(CHAT_COMPLETIONS_URL).mock(
        return_value=httpx.Response(200, json={"choices": []})
    )
    r = auth_client_router.post("/api/ai/ping", json={})
    assert r.status_code == 502
    assert r.json()["detail"] == "The AI service returned an empty answer."


@pytest.mark.live
def test_live_ai_ping_contains_four(tmp_path: Path) -> None:
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

    r = client.post("/api/ai/ping", json={})
    assert r.status_code == 200, r.text
    answer = r.json().get("answer", "")
    assert "4" in answer, f"expected '4' in answer, got: {answer!r}"
