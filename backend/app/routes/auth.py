"""Auth routes: login, logout, me."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.auth import (
    SESSION_COOKIE_NAME,
    TOKEN_TTL_SECONDS,
    create_token,
    get_current_user,
    verify_credentials,
)
from app.config import Settings, get_settings


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserResponse(BaseModel):
    username: str


def _set_session_cookie(response: Response, token: str) -> None:
    # Secure=False so the cookie works on plain http://localhost.
    # Production deployments behind TLS should flip this.
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=TOKEN_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> UserResponse:
    if not verify_credentials(payload.username, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_token(payload.username, settings=settings)
    _set_session_cookie(response, token)
    return UserResponse(username=payload.username)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserResponse)
def me(username: str = Depends(get_current_user)) -> UserResponse:
    return UserResponse(username=username)
