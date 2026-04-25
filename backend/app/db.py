"""SQLAlchemy engine + session factory + idempotent init_db().

Mirrors `docs/schema.json` 1:1. The seed is keyed on ``username='user'``;
running ``init_db()`` repeatedly is a no-op once the seeded user exists.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth import HARDCODED_USERNAME
from app.config import Settings
from app.models import Base, Board, Card, Column, User


_DEMO_BOARD = [
    (
        "Backlog",
        [
            ("Align roadmap themes", "Draft quarterly themes with impact statements and metrics."),
            ("Gather customer signals", "Review support tags, sales notes, and churn feedback."),
        ],
    ),
    (
        "Discovery",
        [
            ("Prototype analytics view", "Sketch initial dashboard layout and key drill-downs."),
        ],
    ),
    (
        "In Progress",
        [
            ("Refine status language", "Standardize column labels and tone across the board."),
            ("Design card layout", "Add hierarchy and spacing for scanning dense lists."),
        ],
    ),
    (
        "Review",
        [
            ("QA micro-interactions", "Verify hover, focus, and loading states."),
        ],
    ),
    (
        "Done",
        [
            ("Ship marketing page", "Final copy approved and asset pack delivered."),
            ("Close onboarding sprint", "Document release notes and share internally."),
        ],
    ),
]


def utc_now_iso() -> str:
    """ISO-8601 UTC, second precision, trailing 'Z' (matches docs/db.md)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id() -> str:
    """uuid4 hex without dashes — TEXT primary key per docs/schema.json."""
    return uuid4().hex


def _enable_sqlite_pragmas(engine: Engine) -> None:
    """SQLite ships with FK enforcement off and rollback journal by default;
    flip both per connection so cascades work and concurrent reads aren't
    blocked behind writers.
    """

    @event.listens_for(engine, "connect")
    def _set_pragmas(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.close()


def make_engine(settings: Settings) -> Engine:
    """Create an Engine pointed at ``settings.DB_PATH`` and register PRAGMAs.

    Always uses the same ``check_same_thread=False`` knob — FastAPI's TestClient
    and uvicorn both share the engine across threads.
    """
    db_path: Path = settings.DB_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{db_path}"
    engine = create_engine(
        url,
        future=True,
        connect_args={"check_same_thread": False},
    )
    _enable_sqlite_pragmas(engine)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db(engine: Engine) -> None:
    """Create tables if missing and seed the demo user/board on first run.

    Idempotent: a second call with the seeded user already present inserts
    nothing.
    """
    Base.metadata.create_all(engine)
    SessionLocal = make_session_factory(engine)

    with SessionLocal() as session:
        existing = session.scalar(
            select(User).where(User.username == HARDCODED_USERNAME)
        )
        if existing is not None:
            return

        now = utc_now_iso()

        user = User(id=new_id(), username=HARDCODED_USERNAME, created_at=now)
        session.add(user)
        session.flush()

        board = Board(id=new_id(), user_id=user.id, created_at=now)
        session.add(board)
        session.flush()

        for col_index, (col_title, cards) in enumerate(_DEMO_BOARD):
            column = Column(
                id=new_id(),
                board_id=board.id,
                title=col_title,
                position=col_index,
                created_at=now,
            )
            session.add(column)
            session.flush()

            for card_index, (card_title, card_details) in enumerate(cards):
                session.add(
                    Card(
                        id=new_id(),
                        column_id=column.id,
                        title=card_title,
                        details=card_details,
                        position=card_index,
                        created_at=now,
                        updated_at=now,
                    )
                )

        session.commit()


# Per-request session dependency lives in app/db_deps.py to keep this module
# free of FastAPI imports (handy for direct unit testing).
