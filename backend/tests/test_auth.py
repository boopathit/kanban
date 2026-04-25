"""Tests for /api/auth/* routes and the get_current_user dependency."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.auth import (
    SESSION_COOKIE_NAME,
    TOKEN_ALGORITHM,
    create_token,
)
from app.config import Settings


def test_login_success_sets_session_cookie(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200
    assert response.json() == {"username": "user"}

    cookie = response.cookies.get(SESSION_COOKIE_NAME)
    assert cookie, "expected a session cookie"

    set_cookie_header = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie_header
    assert "samesite=lax" in set_cookie_header.lower()
    assert "Path=/" in set_cookie_header
    assert "Secure" not in set_cookie_header  # local http


def test_login_wrong_password_returns_401_and_no_cookie(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "nope"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or password"
    assert response.cookies.get(SESSION_COOKIE_NAME) is None


def test_login_wrong_username_returns_401(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert response.status_code == 401
    assert response.cookies.get(SESSION_COOKIE_NAME) is None


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "", "password": "password"},
        {"username": "user", "password": ""},
        {"username": "user"},
        {"password": "password"},
        {},
    ],
)
def test_login_validation_rejects_empty_or_missing_fields(
    client: TestClient, payload: dict
) -> None:
    response = client.post("/api/auth/login", json=payload)
    assert response.status_code == 422


def test_me_without_cookie_returns_401(client: TestClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_me_with_valid_cookie_returns_username(client: TestClient) -> None:
    login = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert login.status_code == 200

    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"username": "user"}


def test_logout_clears_cookie_and_subsequent_me_is_401(client: TestClient) -> None:
    client.post("/api/auth/login", json={"username": "user", "password": "password"})
    assert client.get("/api/auth/me").status_code == 200

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 204
    # TestClient deletes the cookie from its jar when set-cookie has Max-Age=0
    assert client.cookies.get(SESSION_COOKIE_NAME) is None

    after = client.get("/api/auth/me")
    assert after.status_code == 401


def test_tampered_token_returns_401(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, "this.is.not.a.jwt")
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session"


def test_token_signed_with_wrong_secret_returns_401(
    client: TestClient, settings: Settings
) -> None:
    bad_token = jwt.encode({"sub": "user"}, "different-secret", algorithm=TOKEN_ALGORITHM)
    client.cookies.set(SESSION_COOKIE_NAME, bad_token)
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_expired_token_returns_401(client: TestClient, settings: Settings) -> None:
    long_ago = datetime.now(timezone.utc) - timedelta(days=30)
    expired = create_token("user", settings=settings, now=long_ago)
    client.cookies.set(SESSION_COOKIE_NAME, expired)
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_token_with_missing_sub_returns_401(
    client: TestClient, settings: Settings
) -> None:
    payload = {
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
    }
    token = jwt.encode(payload, settings.SESSION_SECRET, algorithm=TOKEN_ALGORITHM)
    client.cookies.set(SESSION_COOKIE_NAME, token)
    response = client.get("/api/auth/me")
    assert response.status_code == 401
