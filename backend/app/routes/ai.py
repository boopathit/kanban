"""AI smoke routes (OpenRouter)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.openrouter import OpenRouterError, assistant_text, chat

router = APIRouter(prefix="/api/ai", tags=["ai"])


class PingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PingResponse(BaseModel):
    answer: str = Field(..., min_length=1)


_PING_PROMPT = "What is 2+2? Reply with just the number."


@router.post("/ping", response_model=PingResponse)
async def ai_ping(
    _: PingBody,
    _user: str = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PingResponse:
    """Ask the configured model a trivial arithmetic question (auth required)."""

    if not settings.OPENROUTER_API_KEY.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter is not configured.",
        )

    try:
        data = await chat(
            api_key=settings.OPENROUTER_API_KEY,
            messages=[{"role": "user", "content": _PING_PROMPT}],
        )
    except OpenRouterError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The AI service returned an error.",
        ) from None

    answer = assistant_text(data)
    if not answer:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The AI service returned an empty answer.",
        )
    return PingResponse(answer=answer)
