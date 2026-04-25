"""Integration tests for the board API.

Covers the wire contract, CRUD on cards, column rename, all the position
edge cases (move within column, move across columns, clamp past end,
re-pack on delete), and authorization (401 unauthenticated, 404 for
columns/cards that exist on a *different* user's board).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import (
    HARDCODED_PASSWORD,
    HARDCODED_USERNAME,
    create_token,
)
from app.config import Settings
from app.db import init_db, make_engine, make_session_factory, new_id, utc_now_iso
from app.main import create_app
from app.models import Board, Card, Column, User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _board(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/board")
    assert response.status_code == 200, response.text
    return response.json()


def _column(board: dict[str, Any], title: str) -> dict[str, Any]:
    for column in board["columns"]:
        if column["title"] == title:
            return column
    raise AssertionError(f"column {title!r} not in board: {[c['title'] for c in board['columns']]}")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_get_board_requires_auth(client: TestClient) -> None:
    response = client.get("/api/board")
    assert response.status_code == 401


def test_patch_card_requires_auth(client: TestClient) -> None:
    response = client.patch("/api/cards/whatever", json={"title": "x"})
    assert response.status_code == 401


def test_post_card_requires_auth(client: TestClient) -> None:
    response = client.post("/api/cards", json={"column_id": "x", "title": "y"})
    assert response.status_code == 401


def test_delete_card_requires_auth(client: TestClient) -> None:
    response = client.delete("/api/cards/whatever")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Wire contract
# ---------------------------------------------------------------------------


def test_board_shape_matches_frontend_contract(auth_client: TestClient) -> None:
    board = _board(auth_client)

    assert set(board.keys()) == {"columns", "cards"}
    assert isinstance(board["columns"], list)
    assert isinstance(board["cards"], dict)
    assert len(board["columns"]) == 5

    for column in board["columns"]:
        assert set(column.keys()) == {"id", "title", "cardIds"}
        for card_id in column["cardIds"]:
            card = board["cards"][card_id]
            assert set(card.keys()) == {"id", "title", "details"}
            assert card["id"] == card_id


def test_seeded_columns_in_expected_order(auth_client: TestClient) -> None:
    board = _board(auth_client)
    titles = [c["title"] for c in board["columns"]]
    assert titles == ["Backlog", "Discovery", "In Progress", "Review", "Done"]


# ---------------------------------------------------------------------------
# Column rename
# ---------------------------------------------------------------------------


def test_rename_column(auth_client: TestClient) -> None:
    column_id = _column(_board(auth_client), "Backlog")["id"]
    response = auth_client.patch(f"/api/columns/{column_id}", json={"title": "Inbox"})
    assert response.status_code == 200
    assert response.json()["title"] == "Inbox"

    titles = [c["title"] for c in _board(auth_client)["columns"]]
    assert "Inbox" in titles
    assert "Backlog" not in titles


def test_rename_column_rejects_blank_title(auth_client: TestClient) -> None:
    column_id = _column(_board(auth_client), "Backlog")["id"]
    response = auth_client.patch(f"/api/columns/{column_id}", json={"title": ""})
    assert response.status_code == 422


def test_rename_unknown_column_404(auth_client: TestClient) -> None:
    response = auth_client.patch("/api/columns/does-not-exist", json={"title": "x"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Create card
# ---------------------------------------------------------------------------


def test_create_card_appends_to_column(auth_client: TestClient) -> None:
    board_before = _board(auth_client)
    column = _column(board_before, "Discovery")
    response = auth_client.post(
        "/api/cards",
        json={"column_id": column["id"], "title": "New idea", "details": "spike"},
    )
    assert response.status_code == 201
    new_card = response.json()
    assert new_card["title"] == "New idea"
    assert new_card["details"] == "spike"

    after = _column(_board(auth_client), "Discovery")
    assert after["cardIds"][-1] == new_card["id"]
    assert len(after["cardIds"]) == len(column["cardIds"]) + 1


def test_create_card_default_details_empty(auth_client: TestClient) -> None:
    column_id = _column(_board(auth_client), "Discovery")["id"]
    response = auth_client.post(
        "/api/cards", json={"column_id": column_id, "title": "Just a title"}
    )
    assert response.status_code == 201
    assert response.json()["details"] == ""


def test_create_card_unknown_column_404(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/cards", json={"column_id": "does-not-exist", "title": "x"}
    )
    assert response.status_code == 404


def test_create_card_blank_title_rejected(auth_client: TestClient) -> None:
    column_id = _column(_board(auth_client), "Discovery")["id"]
    response = auth_client.post(
        "/api/cards", json={"column_id": column_id, "title": ""}
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Update card — metadata
# ---------------------------------------------------------------------------


def test_update_card_title_and_details(auth_client: TestClient) -> None:
    board = _board(auth_client)
    card_id = _column(board, "Backlog")["cardIds"][0]
    response = auth_client.patch(
        f"/api/cards/{card_id}",
        json={"title": "Updated", "details": "new details"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Updated"
    assert body["details"] == "new details"

    after = _board(auth_client)
    assert after["cards"][card_id]["title"] == "Updated"
    assert after["cards"][card_id]["details"] == "new details"


def test_update_card_partial_only_changes_provided_fields(
    auth_client: TestClient,
) -> None:
    board = _board(auth_client)
    card_id = _column(board, "Backlog")["cardIds"][0]
    original_details = board["cards"][card_id]["details"]

    response = auth_client.patch(f"/api/cards/{card_id}", json={"title": "Only title"})
    assert response.status_code == 200
    after = _board(auth_client)
    assert after["cards"][card_id]["title"] == "Only title"
    assert after["cards"][card_id]["details"] == original_details


# ---------------------------------------------------------------------------
# Update card — moves
# ---------------------------------------------------------------------------


def test_move_card_within_column_to_new_position(auth_client: TestClient) -> None:
    column = _column(_board(auth_client), "In Progress")
    if len(column["cardIds"]) < 2:
        pytest.skip("seed needs >=2 cards in In Progress")
    card_id = column["cardIds"][0]

    auth_client.patch(f"/api/cards/{card_id}", json={"position": 1})

    after = _column(_board(auth_client), "In Progress")
    assert after["cardIds"].index(card_id) == 1


def test_move_card_to_different_column_appends_when_no_position(
    auth_client: TestClient,
) -> None:
    board = _board(auth_client)
    src = _column(board, "Backlog")
    dst = _column(board, "Done")
    card_id = src["cardIds"][0]

    auth_client.patch(f"/api/cards/{card_id}", json={"column_id": dst["id"]})

    after = _board(auth_client)
    after_src = _column(after, "Backlog")
    after_dst = _column(after, "Done")
    assert card_id not in after_src["cardIds"]
    assert after_dst["cardIds"][-1] == card_id


def test_move_card_to_different_column_at_specific_position(
    auth_client: TestClient,
) -> None:
    board = _board(auth_client)
    src = _column(board, "Backlog")
    dst = _column(board, "In Progress")
    card_id = src["cardIds"][0]

    auth_client.patch(
        f"/api/cards/{card_id}",
        json={"column_id": dst["id"], "position": 0},
    )

    after = _board(auth_client)
    assert _column(after, "In Progress")["cardIds"][0] == card_id
    assert card_id not in _column(after, "Backlog")["cardIds"]


def test_move_card_position_past_end_is_clamped(auth_client: TestClient) -> None:
    board = _board(auth_client)
    src = _column(board, "Backlog")
    dst = _column(board, "Done")
    card_id = src["cardIds"][0]

    auth_client.patch(
        f"/api/cards/{card_id}",
        json={"column_id": dst["id"], "position": 999},
    )

    after_dst = _column(_board(auth_client), "Done")
    assert after_dst["cardIds"][-1] == card_id


def test_move_card_to_unknown_column_404(auth_client: TestClient) -> None:
    card_id = _column(_board(auth_client), "Backlog")["cardIds"][0]
    response = auth_client.patch(
        f"/api/cards/{card_id}", json={"column_id": "missing"}
    )
    assert response.status_code == 404


def test_update_unknown_card_404(auth_client: TestClient) -> None:
    response = auth_client.patch("/api/cards/does-not-exist", json={"title": "x"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Delete card
# ---------------------------------------------------------------------------


def test_delete_card_removes_and_repacks(auth_client: TestClient) -> None:
    board = _board(auth_client)
    column = _column(board, "In Progress")
    if not column["cardIds"]:
        pytest.skip("seed needs >=1 card in In Progress")
    card_id = column["cardIds"][0]

    response = auth_client.delete(f"/api/cards/{card_id}")
    assert response.status_code == 204

    after = _board(auth_client)
    assert card_id not in after["cards"]
    assert card_id not in _column(after, "In Progress")["cardIds"]


def test_delete_card_keeps_positions_contiguous(
    auth_client: TestClient, settings: Settings
) -> None:
    """After a delete, the remaining cards in that column must be 0..N-1."""
    board = _board(auth_client)
    column_id = _column(board, "In Progress")["id"]

    if len(_column(board, "In Progress")["cardIds"]) < 2:
        pytest.skip("seed needs >=2 cards in In Progress")

    card_id = _column(board, "In Progress")["cardIds"][0]
    auth_client.delete(f"/api/cards/{card_id}")

    engine = make_engine(settings)
    SessionLocal = make_session_factory(engine)
    with SessionLocal() as session:
        positions = sorted(
            c.position
            for c in session.query(Card).filter(Card.column_id == column_id).all()
        )
    assert positions == list(range(len(positions)))


def test_delete_unknown_card_404(auth_client: TestClient) -> None:
    response = auth_client.delete("/api/cards/does-not-exist")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------


def _seed_extra_user(settings: Settings, username: str) -> dict[str, str]:
    """Add a second user with a board, return ids for that user's column/card."""
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
            title="Other user backlog",
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
        return {
            "user_id": user.id,
            "board_id": board.id,
            "column_id": column.id,
            "card_id": card.id,
        }


def test_cannot_read_other_users_card(auth_client: TestClient, settings: Settings) -> None:
    other = _seed_extra_user(settings, "intruder-target")

    response = auth_client.patch(
        f"/api/cards/{other['card_id']}", json={"title": "hijacked"}
    )
    assert response.status_code == 404

    response = auth_client.delete(f"/api/cards/{other['card_id']}")
    assert response.status_code == 404

    response = auth_client.patch(
        f"/api/columns/{other['column_id']}", json={"title": "hijacked"}
    )
    assert response.status_code == 404

    # The other user's card title must be unchanged.
    engine = make_engine(settings)
    SessionLocal = make_session_factory(engine)
    with SessionLocal() as session:
        card = session.scalar(select(Card).where(Card.id == other["card_id"]))
        assert card is not None
        assert card.title == "Secret"


def test_cannot_create_card_in_other_users_column(
    auth_client: TestClient, settings: Settings
) -> None:
    other = _seed_extra_user(settings, "intruder-target-2")
    response = auth_client.post(
        "/api/cards",
        json={"column_id": other["column_id"], "title": "leak", "details": ""},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Token without backing user
# ---------------------------------------------------------------------------


def test_valid_token_for_unknown_user_returns_404(
    settings: Settings,
) -> None:
    """A signed token that doesn't correspond to a row in users → 404 on read."""
    app = create_app(settings)
    client = TestClient(app)
    token = create_token("ghost-user", settings=settings)
    client.cookies.set("session", token)
    response = client.get("/api/board")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Sanity: login round-trip
# ---------------------------------------------------------------------------


def test_login_then_get_board(client: TestClient) -> None:
    login = client.post(
        "/api/auth/login",
        json={"username": HARDCODED_USERNAME, "password": HARDCODED_PASSWORD},
    )
    assert login.status_code == 200
    response = client.get("/api/board")
    assert response.status_code == 200
    assert "columns" in response.json()
