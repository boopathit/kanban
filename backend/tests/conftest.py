from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(
        "<!doctype html><html><body><h1>Hello from FastAPI</h1></body></html>",
        encoding="utf-8",
    )
    return Settings(
        SESSION_SECRET="test-secret",
        OPENROUTER_API_KEY="",
        DB_PATH=tmp_path / "pm.db",
        STATIC_DIR=static_dir,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    app = create_app(settings)
    return TestClient(app)
