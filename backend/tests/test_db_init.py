"""Tests for app/db.py: schema creation, PRAGMAs, and idempotent seeding."""

from __future__ import annotations

from sqlalchemy import text

from app.auth import HARDCODED_USERNAME
from app.config import Settings
from app.db import init_db, make_engine, make_session_factory
from app.models import Board, Card, Column, User


def test_init_db_creates_tables_and_seeds_demo_user(settings: Settings) -> None:
    engine = make_engine(settings)
    init_db(engine)

    SessionLocal = make_session_factory(engine)
    with SessionLocal() as session:
        users = session.query(User).all()
        assert len(users) == 1
        assert users[0].username == HARDCODED_USERNAME

        boards = session.query(Board).all()
        assert len(boards) == 1
        assert boards[0].user_id == users[0].id

        columns = session.query(Column).order_by(Column.position).all()
        assert [c.title for c in columns] == [
            "Backlog",
            "Discovery",
            "In Progress",
            "Review",
            "Done",
        ]
        assert [c.position for c in columns] == [0, 1, 2, 3, 4]

        cards = session.query(Card).all()
        assert len(cards) >= 5
        for column in columns:
            positions = sorted(c.position for c in column.cards)
            assert positions == list(range(len(positions))), (
                f"column {column.title!r} not contiguously packed: {positions}"
            )


def test_init_db_is_idempotent(settings: Settings) -> None:
    engine = make_engine(settings)
    init_db(engine)
    init_db(engine)  # second call must not duplicate
    init_db(engine)

    SessionLocal = make_session_factory(engine)
    with SessionLocal() as session:
        assert session.query(User).count() == 1
        assert session.query(Board).count() == 1


def test_pragmas_are_set(settings: Settings) -> None:
    engine = make_engine(settings)
    init_db(engine)
    with engine.connect() as conn:
        fk = conn.execute(text("PRAGMA foreign_keys")).scalar()
        journal = conn.execute(text("PRAGMA journal_mode")).scalar()
    assert fk == 1
    assert (journal or "").lower() == "wal"


def test_cascade_delete_user_removes_everything(settings: Settings) -> None:
    engine = make_engine(settings)
    init_db(engine)
    SessionLocal = make_session_factory(engine)

    with SessionLocal() as session:
        user = session.query(User).one()
        session.delete(user)
        session.commit()

    with SessionLocal() as session:
        assert session.query(User).count() == 0
        assert session.query(Board).count() == 0
        assert session.query(Column).count() == 0
        assert session.query(Card).count() == 0
