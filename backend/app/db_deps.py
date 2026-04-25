"""FastAPI dependency for obtaining a SQLAlchemy session.

The session factory is created once per app in ``app/main.py#create_app``
and stored on ``app.state.session_factory``. This indirection lets tests
build a separate engine per test (against ``settings.DB_PATH``) without
touching module-level globals.
"""

from __future__ import annotations

from typing import Iterator

from fastapi import Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Iterator[Session]:
    session_factory = request.app.state.session_factory
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
