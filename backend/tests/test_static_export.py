"""Verifies that FastAPI serves a Next.js-export-shaped static directory.

Builds a tmp directory mimicking `frontend/out/` (index.html that references
a /_next/ asset, plus the asset itself) and asserts that the SPA fallback
behaves correctly without leaking into the API surface.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def export_client(tmp_path: Path) -> TestClient:
    static_dir = tmp_path / "out"
    (static_dir / "_next" / "static" / "chunks").mkdir(parents=True)
    (static_dir / "_next" / "static" / "chunks" / "main.js").write_text(
        "console.log('kanban');", encoding="utf-8"
    )
    (static_dir / "index.html").write_text(
        '<!doctype html><html><head>'
        '<link rel="stylesheet" href="/_next/static/chunks/main.css">'
        '</head><body><div id="__next">Kanban Studio</div>'
        '<script src="/_next/static/chunks/main.js"></script></body></html>',
        encoding="utf-8",
    )
    # Mimic the Next.js export's own 404.html. Starlette's StaticFiles
    # returns this with status 404 instead of raising HTTPException, so the
    # SPA fallback must handle the response-is-404 case as well as the
    # exception case.
    (static_dir / "404.html").write_text(
        '<!doctype html><html><body><h1>Next 404</h1></body></html>',
        encoding="utf-8",
    )
    # Mimic Next's per-route static file: GET /login should resolve to this,
    # not fall back to index.html.
    (static_dir / "login.html").write_text(
        '<!doctype html><html><body><h1>Sign in</h1></body></html>',
        encoding="utf-8",
    )
    settings = Settings(
        SESSION_SECRET="test",
        DB_PATH=tmp_path / "pm.db",
        STATIC_DIR=static_dir,
    )
    return TestClient(create_app(settings))


def test_root_returns_index_with_next_asset_refs(export_client: TestClient) -> None:
    response = export_client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Kanban Studio" in response.text
    assert "/_next/static/chunks/main.js" in response.text


def test_next_asset_is_served_with_real_content(export_client: TestClient) -> None:
    response = export_client.get("/_next/static/chunks/main.js")
    assert response.status_code == 200
    assert "console.log('kanban')" in response.text


def test_login_route_resolves_to_login_html(
    export_client: TestClient,
) -> None:
    """Next exports /login as login.html; serve that, not index.html."""
    response = export_client.get("/login")
    assert response.status_code == 200
    assert "Sign in" in response.text
    assert "Kanban Studio" not in response.text
    assert "Next 404" not in response.text


def test_spa_fallback_for_unknown_extensionless_path(
    export_client: TestClient,
) -> None:
    """Dynamic routes with no pre-rendered .html fall back to index.html."""
    response = export_client.get("/projects/123/edit")
    assert response.status_code == 200
    assert "Kanban Studio" in response.text
    assert "Next 404" not in response.text


def test_spa_fallback_does_not_swallow_missing_assets(
    export_client: TestClient,
) -> None:
    response = export_client.get("/_next/static/chunks/missing.js")
    assert response.status_code == 404


def test_api_404_is_not_overridden_by_spa_fallback(
    export_client: TestClient,
) -> None:
    response = export_client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert "Kanban Studio" not in response.text
    assert "Next 404" not in response.text


def test_health_still_wins_over_static_mount(export_client: TestClient) -> None:
    response = export_client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
