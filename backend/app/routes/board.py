"""Board API routes — all auth-gated and user-scoped.

Wire contract for ``GET /api/board`` matches ``frontend/src/lib/kanban.ts``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db_deps import get_db
from app.schemas import (
    BoardResponse,
    CardSummary,
    ColumnSummary,
    CreateCardRequest,
    RenameColumnRequest,
    UpdateCardRequest,
)
from app.services.board import (
    BoardNotFound,
    create_card,
    delete_card,
    get_board,
    rename_column,
    update_card,
)


router = APIRouter(prefix="/api", tags=["board"])


def _not_found(exc: BoardNotFound) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/board", response_model=BoardResponse)
def read_board(
    session: Session = Depends(get_db),
    username: str = Depends(get_current_user),
) -> BoardResponse:
    try:
        return get_board(session, username)
    except BoardNotFound as exc:
        raise _not_found(exc) from exc


@router.patch("/columns/{column_id}", response_model=ColumnSummary)
def patch_column(
    column_id: str,
    payload: RenameColumnRequest,
    session: Session = Depends(get_db),
    username: str = Depends(get_current_user),
) -> ColumnSummary:
    try:
        return rename_column(
            session, username, column_id=column_id, title=payload.title
        )
    except BoardNotFound as exc:
        raise _not_found(exc) from exc


@router.post(
    "/cards",
    response_model=CardSummary,
    status_code=status.HTTP_201_CREATED,
)
def post_card(
    payload: CreateCardRequest,
    session: Session = Depends(get_db),
    username: str = Depends(get_current_user),
) -> CardSummary:
    try:
        return create_card(
            session,
            username,
            column_id=payload.column_id,
            title=payload.title,
            details=payload.details,
        )
    except BoardNotFound as exc:
        raise _not_found(exc) from exc


@router.patch("/cards/{card_id}", response_model=CardSummary)
def patch_card(
    card_id: str,
    payload: UpdateCardRequest,
    session: Session = Depends(get_db),
    username: str = Depends(get_current_user),
) -> CardSummary:
    try:
        return update_card(
            session,
            username,
            card_id=card_id,
            title=payload.title,
            details=payload.details,
            column_id=payload.column_id,
            position=payload.position,
        )
    except BoardNotFound as exc:
        raise _not_found(exc) from exc


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_card(
    card_id: str,
    session: Session = Depends(get_db),
    username: str = Depends(get_current_user),
) -> Response:
    try:
        delete_card(session, username, card_id=card_id)
    except BoardNotFound as exc:
        raise _not_found(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
