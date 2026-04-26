"""AI routes: OpenRouter smoke ping + structured board-aware chat."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai_schema import openrouter_response_format, parse_chat_model_json
from app.auth import get_current_user
from app.config import Settings, get_settings
from app.openrouter import OpenRouterError, assistant_text, chat
from app.db_deps import get_db
from app.schemas import BoardResponse
from app.services.board import get_board
from app.services.chat import (
    HISTORY_LIMIT,
    append_message,
    apply_board_update,
    build_system_prompt,
    get_user_by_username,
    recent_messages,
    start_or_get_conversation,
)
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api", tags=["ai"])


class PingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PingResponse(BaseModel):
    answer: str = Field(..., min_length=1)


_PING_PROMPT = "What is 2+2? Reply with just the number."


@router.post("/ai/ping", response_model=PingResponse)
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


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=4000)


class ChatHistoryItem(BaseModel):
    id: str
    role: str
    content: str
    created_at: str


class ChatHistoryResponse(BaseModel):
    messages: list[ChatHistoryItem]


class ChatResponse(BaseModel):
    reply: str
    applied_ops: list[dict] = Field(default_factory=list)
    updated_board: BoardResponse | None = None
    op_error: str | None = None


@router.get("/chat/history", response_model=ChatHistoryResponse)
def chat_history(
    username: str = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> ChatHistoryResponse:
    user = get_user_by_username(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown user")
    convo = start_or_get_conversation(session, user.id)
    messages = recent_messages(session, convo.id, limit=HISTORY_LIMIT)
    return ChatHistoryResponse(
        messages=[
            ChatHistoryItem(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at,
            )
            for m in messages
        ]
    )


@router.post("/chat", response_model=ChatResponse)
async def post_chat(
    payload: ChatRequest,
    username: str = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> ChatResponse | JSONResponse:
    if not settings.OPENROUTER_API_KEY.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter is not configured.",
        )

    user = get_user_by_username(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown user")

    convo = start_or_get_conversation(session, user.id)
    append_message(session, convo.id, role="user", content=payload.message.strip())

    board = get_board(session, username)
    system_prompt = build_system_prompt(board)
    history = recent_messages(session, convo.id, limit=HISTORY_LIMIT)
    llm_messages = [
        {"role": "system", "content": system_prompt},
        *[
            {"role": m.role, "content": m.content}
            for m in history
            if m.role in {"user", "assistant", "system"}
        ],
    ]

    try:
        llm_data = await chat(
            api_key=settings.OPENROUTER_API_KEY,
            messages=llm_messages,
            response_format=openrouter_response_format(),
        )
    except OpenRouterError:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "The AI service returned an error."},
        )

    content = assistant_text(llm_data)
    if not content:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "The AI service returned an empty answer."},
        )

    try:
        structured = parse_chat_model_json(content)
    except ValidationError:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "The AI service returned an invalid response."},
        )

    append_message(session, convo.id, role="assistant", content=structured.reply)

    ops = structured.board_update.operations if structured.board_update else []
    apply_result = apply_board_update(session, username, ops)
    return ChatResponse(
        reply=structured.reply,
        applied_ops=apply_result.applied_ops,
        updated_board=apply_result.updated_board,
        op_error=apply_result.error,
    )
