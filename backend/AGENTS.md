# Backend

FastAPI app, Python 3.12, managed with `uv`. Serves the JSON API under `/api/*` and (in production) the built frontend as static files at `/`.

## Layout

```
backend/
  pyproject.toml         Dependencies + pytest config (managed by uv)
  uv.lock                Pinned lockfile (committed)
  app/
    __init__.py
    main.py              create_app() factory; mounts routers + StaticFiles
    config.py            Settings (pydantic-settings): SESSION_SECRET, OPENROUTER_API_KEY, DB_PATH, STATIC_DIR
    routes/
      __init__.py
      health.py          GET /api/health -> {"status": "ok"}
  static/
    index.html           Placeholder served at / until Part 3 swaps in frontend/out
  tests/
    conftest.py          Builds a Settings + TestClient fixture using a tmp static dir
    test_health.py
    test_static.py
```

## Configuration

All config is loaded by `pydantic-settings` from environment variables (case-insensitive, no `.env` auto-load — env_file is wired via Docker compose's `env_file: .env`).

| Var | Default | Purpose |
|-----|---------|---------|
| `SESSION_SECRET` | `dev-insecure-change-me` | Signs JWT session cookies (Part 4+) |
| `OPENROUTER_API_KEY` | `""` | OpenRouter bearer token (Part 8+) |
| `DB_PATH` | `/app/data/pm.db` | SQLite file (Part 6+); container creates the parent dir |
| `STATIC_DIR` | `<backend>/static` | Folder served at `/`; in container, set to `/app/static` |

`get_settings()` in `app.config` returns a fresh `Settings()` per call — fine for the MVP; switch to `lru_cache` later if call sites multiply.

## Routes

- `GET /api/health` — liveness probe; used by the start scripts and the Docker `HEALTHCHECK`.
- `GET /` and `GET /<path>` — static files served from `STATIC_DIR` (FastAPI's `StaticFiles(html=True)` falls back to `index.html` for directory requests).

## Run locally (without Docker)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/` and `http://127.0.0.1:8000/api/health`.

## Tests

```bash
cd backend
uv run pytest            # quiet, fast
uv run pytest --cov      # with coverage
```

Tests build their own `Settings` + `TestClient` via `conftest.py`, with a temp `STATIC_DIR` whose `index.html` contains a known sentinel string. They never touch the real `backend/static/` content.

## Notes for later parts

- Part 4 will add `app/auth.py` and `app/routes/auth.py`, register the router under `/api`, and introduce a `get_current_user` dependency.
- Part 6 will add `app/db.py`, `app/models.py`, `app/schemas.py`, `app/services/board.py`, `app/routes/board.py`, plus a startup hook that calls `init_db()`.
- Part 8 will add `app/openrouter.py` and `app/routes/ai.py`.
- The `StaticFiles` mount currently sits at `/`. Because routers are added BEFORE the static mount in `create_app`, all `/api/*` routes still take precedence — keep that order when adding new routers.
