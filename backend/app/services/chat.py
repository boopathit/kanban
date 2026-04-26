"""Conversation persistence + board-update execution for AI chat."""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_schema import BoardOp, CreateCardOp, DeleteCardOp, RenameColumnOp, UpdateCardOp
from app.db import new_id, utc_now_iso
from app.models import Conversation, Message, User
from app.schemas import BoardResponse
from app.services.board import (
    BoardNotFound,
    create_card,
    delete_card,
    get_board,
    rename_column,
    update_card,
)


HISTORY_LIMIT = 30


@dataclass(slots=True)
class BoardApplyResult:
    applied_ops: list[dict]
    updated_board: BoardResponse | None
    error: str | None = None


def get_user_by_username(session: Session, username: str) -> User | None:
    return session.scalar(select(User).where(User.username == username))


def start_or_get_conversation(session: Session, user_id: str) -> Conversation:
    convo = session.scalar(select(Conversation).where(Conversation.user_id == user_id))
    if convo is not None:
        return convo
    convo = Conversation(id=new_id(), user_id=user_id, created_at=utc_now_iso())
    session.add(convo)
    session.flush()
    return convo


def append_message(
    session: Session, conversation_id: str, *, role: str, content: str
) -> Message:
    msg = Message(
        id=new_id(),
        conversation_id=conversation_id,
        role=role,
        content=content,
        created_at=utc_now_iso(),
    )
    session.add(msg)
    session.flush()
    return msg


def recent_messages(session: Session, conversation_id: str, *, limit: int = HISTORY_LIMIT) -> list[Message]:
    rows = (
        session.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    rows.reverse()
    return rows


def build_system_prompt(board: BoardResponse) -> str:
    board_json = json.dumps(board.model_dump(), ensure_ascii=True, separators=(",", ":"))
    return (
        "You are an assistant for a project-management Kanban board.\n"
        "Reply with concise, helpful text for the user.\n"
        "Only propose board operations when they are clearly useful and valid.\n"
        "Never invent column or card ids; only use ids from the board JSON below.\n"
        "If no board change is needed, set board_update to null.\n\n"
        f"Current board JSON:\n{board_json}"
    )


def apply_board_update(session: Session, username: str, operations: list[BoardOp]) -> BoardApplyResult:
    if not operations:
        return BoardApplyResult(applied_ops=[], updated_board=None, error=None)

    try:
        with session.begin_nested():
            applied: list[dict] = []
            for op in operations:
                if isinstance(op, RenameColumnOp):
                    rename_column(session, username, column_id=op.column_id, title=op.title)
                elif isinstance(op, CreateCardOp):
                    create_card(
                        session,
                        username,
                        column_id=op.column_id,
                        title=op.title,
                        details=op.details,
                    )
                elif isinstance(op, DeleteCardOp):
                    delete_card(session, username, card_id=op.card_id)
                elif isinstance(op, UpdateCardOp):
                    update_card(
                        session,
                        username,
                        card_id=op.card_id,
                        title=op.title,
                        details=op.details,
                        column_id=op.column_id,
                        position=op.position,
                    )
                applied.append(op.model_dump(exclude_none=True))
    except BoardNotFound:
        return BoardApplyResult(
            applied_ops=[],
            updated_board=None,
            error="One or more requested board items were not found for this user.",
        )
    except Exception:
        return BoardApplyResult(
            applied_ops=[],
            updated_board=None,
            error="Board updates could not be applied.",
        )

    return BoardApplyResult(
        applied_ops=applied,
        updated_board=get_board(session, username),
        error=None,
    )
