"""Board service: all reads and writes for a single user's board.

Every public function takes the authenticated ``username`` as its first
argument and resolves the user (and their board) inside, so callers cannot
accidentally cross user boundaries. Lookups for a card or column that the
caller does not own raise ``BoardNotFound`` — translated to **404** at the
route layer to avoid leaking existence.

Position contract (see ``docs/db.md`` § Position handling):

- Within a column, ``cards.position`` is contiguous ``0..N-1``.
- Within a board, ``columns.position`` is contiguous ``0..M-1``.
- Every write that could disturb either ordering re-packs the affected
  column(s) inside the same transaction.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import new_id, utc_now_iso
from app.models import Board, Card, Column, User
from app.schemas import BoardResponse, CardSummary, ColumnSummary


class BoardError(Exception):
    """Base for service-level board errors."""


class BoardNotFound(BoardError):
    """The authenticated user has no board, column, or card matching the request."""


class InvalidColumn(BoardError):
    """The requested target column belongs to a different board."""


@dataclass(slots=True)
class _UserBoard:
    user: User
    board: Board


def _load_user_board(session: Session, username: str) -> _UserBoard:
    """Resolve the authenticated user's user+board pair, or raise BoardNotFound.

    Loads columns and their cards eagerly so subsequent service calls don't
    issue N+1 queries.
    """
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        raise BoardNotFound(f"unknown user: {username!r}")
    board = session.scalar(
        select(Board)
        .where(Board.user_id == user.id)
        .options(selectinload(Board.columns).selectinload(Column.cards))
    )
    if board is None:
        raise BoardNotFound(f"user {username!r} has no board")
    return _UserBoard(user=user, board=board)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def get_board(session: Session, username: str) -> BoardResponse:
    ub = _load_user_board(session, username)

    columns: list[ColumnSummary] = []
    cards: dict[str, CardSummary] = {}

    for column in sorted(ub.board.columns, key=lambda c: c.position):
        ordered_cards = sorted(column.cards, key=lambda c: c.position)
        columns.append(
            ColumnSummary(
                id=column.id,
                title=column.title,
                cardIds=[card.id for card in ordered_cards],
            )
        )
        for card in ordered_cards:
            cards[card.id] = CardSummary(
                id=card.id,
                title=card.title,
                details=card.details,
            )

    return BoardResponse(columns=columns, cards=cards)


# ---------------------------------------------------------------------------
# Writes — columns
# ---------------------------------------------------------------------------


def rename_column(
    session: Session, username: str, *, column_id: str, title: str
) -> ColumnSummary:
    ub = _load_user_board(session, username)
    column = _column_for_board(ub.board, column_id)
    column.title = title
    session.flush()
    ordered_cards = sorted(column.cards, key=lambda c: c.position)
    return ColumnSummary(
        id=column.id,
        title=column.title,
        cardIds=[card.id for card in ordered_cards],
    )


# ---------------------------------------------------------------------------
# Writes — cards
# ---------------------------------------------------------------------------


def create_card(
    session: Session,
    username: str,
    *,
    column_id: str,
    title: str,
    details: str,
) -> CardSummary:
    ub = _load_user_board(session, username)
    column = _column_for_board(ub.board, column_id)

    now = utc_now_iso()
    card = Card(
        id=new_id(),
        column_id=column.id,
        title=title,
        details=details,
        position=len(column.cards),
        created_at=now,
        updated_at=now,
    )
    session.add(card)
    session.flush()
    return CardSummary(id=card.id, title=card.title, details=card.details)


def update_card(
    session: Session,
    username: str,
    *,
    card_id: str,
    title: str | None = None,
    details: str | None = None,
    column_id: str | None = None,
    position: int | None = None,
) -> CardSummary:
    ub = _load_user_board(session, username)
    card = _card_for_board(ub.board, card_id)
    source_column = card.column

    if title is not None:
        card.title = title
    if details is not None:
        card.details = details

    target_column = source_column
    if column_id is not None and column_id != source_column.id:
        target_column = _column_for_board(ub.board, column_id)

    if target_column is source_column and position is None:
        # Pure metadata edit; no reordering needed.
        card.updated_at = utc_now_iso()
        session.flush()
        return CardSummary(id=card.id, title=card.title, details=card.details)

    _move_card(
        session,
        card=card,
        source_column=source_column,
        target_column=target_column,
        target_position=position,
    )
    card.updated_at = utc_now_iso()
    session.flush()
    return CardSummary(id=card.id, title=card.title, details=card.details)


def delete_card(session: Session, username: str, *, card_id: str) -> None:
    ub = _load_user_board(session, username)
    card = _card_for_board(ub.board, card_id)
    column = card.column
    session.delete(card)
    session.flush()
    _repack(session, column)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _column_for_board(board: Board, column_id: str) -> Column:
    for column in board.columns:
        if column.id == column_id:
            return column
    raise BoardNotFound(f"column {column_id!r} not on this board")


def _card_for_board(board: Board, card_id: str) -> Card:
    for column in board.columns:
        for card in column.cards:
            if card.id == card_id:
                return card
    raise BoardNotFound(f"card {card_id!r} not on this board")


def _move_card(
    session: Session,
    *,
    card: Card,
    source_column: Column,
    target_column: Column,
    target_position: int | None,
) -> None:
    """Move ``card`` between/within columns and re-pack positions.

    Strategy: detach from source, repack source, then insert at target index
    in target column and repack. This keeps the contiguous-0..N-1 invariant
    in a single transaction without needing UNIQUE shenanigans (see
    docs/db.md § Why position is not UNIQUE).
    """
    same_column = source_column.id == target_column.id

    source_remaining = [c for c in sorted(source_column.cards, key=lambda c: c.position) if c.id != card.id]

    if same_column:
        target_existing = source_remaining
    else:
        target_existing = sorted(target_column.cards, key=lambda c: c.position)

    if target_position is None:
        insert_index = len(target_existing)
    else:
        insert_index = max(0, min(target_position, len(target_existing)))

    target_order = target_existing.copy()
    target_order.insert(insert_index, card)

    card.column_id = target_column.id

    for index, c in enumerate(target_order):
        c.position = index

    if not same_column:
        for index, c in enumerate(source_remaining):
            c.position = index

    session.flush()


def _repack(session: Session, column: Column) -> None:
    """Re-pack a column's cards to contiguous 0..N-1.

    Re-queries the live rows so callers can rely on this after a delete/flush
    even though the in-memory ``column.cards`` collection may still reference
    the just-deleted instance.
    """
    rows = (
        session.execute(
            select(Card).where(Card.column_id == column.id).order_by(Card.position)
        )
        .scalars()
        .all()
    )
    for index, c in enumerate(rows):
        c.position = index
    session.flush()
