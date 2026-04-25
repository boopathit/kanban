"""JWT cookie auth for the MVP.

Tiny surface:

- :func:`create_token(username)` returns a signed JWT.
- :func:`decode_token(token)` returns its claims, or raises :class:`AuthError`.
- :func:`get_current_user` is a FastAPI dependency that reads the ``session``
  cookie and returns the authenticated username, or raises ``HTTPException(401)``.

Credentials are hardcoded for the MVP (``user`` / ``password``); the comparison
uses :func:`hmac.compare_digest` to keep it constant-time anyway.
"""

from __future__ import annotations

import hmac
from datetime import datetime, timedelta, timezone
from typing import Final

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError, jwt

from app.config import Settings, get_settings


HARDCODED_USERNAME: Final[str] = "user"
HARDCODED_PASSWORD: Final[str] = "password"

SESSION_COOKIE_NAME: Final[str] = "session"
TOKEN_ALGORITHM: Final[str] = "HS256"
TOKEN_TTL_SECONDS: Final[int] = 7 * 24 * 60 * 60


class AuthError(Exception):
    """Token is missing, malformed, expired, or signed with the wrong key."""


def verify_credentials(username: str, password: str) -> bool:
    """Constant-time check against the hardcoded MVP credentials."""

    user_ok = hmac.compare_digest(username.encode("utf-8"), HARDCODED_USERNAME.encode("utf-8"))
    pass_ok = hmac.compare_digest(password.encode("utf-8"), HARDCODED_PASSWORD.encode("utf-8"))
    # Avoid short-circuiting on the username so timing reveals nothing.
    return user_ok and pass_ok


def create_token(username: str, *, settings: Settings | None = None, now: datetime | None = None) -> str:
    settings = settings or get_settings()
    issued_at = now or datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(seconds=TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, settings.SESSION_SECRET, algorithm=TOKEN_ALGORITHM)


def decode_token(token: str, *, settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    try:
        return jwt.decode(token, settings.SESSION_SECRET, algorithms=[TOKEN_ALGORITHM])
    except JWTError as exc:
        raise AuthError(str(exc)) from exc


def get_current_user(
    settings: Settings = Depends(get_settings),
    session: str | None = Cookie(default=None),
) -> str:
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        claims = decode_token(session, settings=settings)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session") from exc
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return sub
