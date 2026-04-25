# Backend

FastAPI app, Python 3.12, managed with `uv`. Serves the JSON API under `/api/*` and (in production) the built frontend as static files at `/`.

## Layout

```
backend/
  pyproject.toml         Dependencies + pytest config (managed by uv)
  uv.lock                Pinned lockfile (committed)
  app/
    __init__.py
    main.py              create_app() factory; mounts routers + SPAStaticFiles
    config.py            Settings (pydantic-settings): SESSION_SECRET, OPENROUTER_API_KEY, DB_PATH, STATIC_DIR
    static.py            SPAStaticFiles: StaticFiles subclass with SPA fallback
    routes/
      __init__.py
      health.py          GET /api/health -> {"status": "ok"}
  static/
    index.html           Local-dev fallback served at / when running uvicorn directly
                         (in the container, STATIC_DIR is overridden to /app/static
                         which holds the built frontend export)
  tests/
    conftest.py          Builds a Settings + TestClient fixture using a tmp static dir
    test_health.py
    test_static.py
    test_static_export.py  Verifies SPA fallback + /_next asset wiring + /api isolation
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
- `GET /` and `GET /<path>` — served from `STATIC_DIR` via `SPAStaticFiles` (a `StaticFiles` subclass). Behaviour:
  - Existing files are served as-is (HTML, JS, CSS, fonts, etc.).
  - An extensionless path with no matching file (e.g. `/login`, `/projects/123`) falls back to `index.html` so the frontend's client-side router can take over.
  - A missing path with a file extension (e.g. `/_next/static/missing.js`) still returns 404, so broken asset references surface clearly.
  - `/api/*` paths never reach this fallback because the API router is registered before the static mount; even if the API router 404s, `SPAStaticFiles` skips its fallback for any path beginning with `api/`.

## Run locally (without Docker)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/` (placeholder card) and `http://127.0.0.1:8000/api/health`.

To serve the real frontend without Docker, build it first and point `STATIC_DIR` at the export:

```bash
cd frontend && npm ci && npm run build
cd ../backend && STATIC_DIR=../frontend/out uv run uvicorn app.main:app --reload
```

## Tests

```bash
cd backend
uv run pytest            # quiet, fast
uv run pytest --cov      # with coverage
```

Tests build their own `Settings` + `TestClient` via `conftest.py`, with a temp `STATIC_DIR` whose `index.html` contains a known sentinel string. They never touch the real `backend/static/` content.

## Notes for later parts

- Part 6 will add `app/db.py`, `app/models.py`, `app/schemas.py`, `app/services/board.py`, `app/routes/board.py`, plus a startup hook that calls `init_db()`.
- Part 8 will add `app/openrouter.py` and `app/routes/ai.py`.
- The `SPAStaticFiles` mount currently sits at `/`. Because routers are added BEFORE the static mount in `create_app`, all `/api/*` routes still take precedence — keep that order when adding new routers.

## Auth (Part 4)

`app/auth.py` exposes:

- `verify_credentials(username, password)` — constant-time check against the hardcoded `user`/`password`.
- `create_token(username)` — issues an HS256 JWT (`sub`, `iat`, `exp`) signed with `settings.SESSION_SECRET`, valid for `TOKEN_TTL_SECONDS` (7 days).
- `decode_token(token)` — returns claims, or raises `AuthError` on any JWT failure.
- `get_current_user(settings, session_cookie)` — FastAPI dependency. Reads the `session` cookie, returns the username, or raises `HTTPException(401)`.

`app/routes/auth.py` mounts under `/api/auth/*`:

| Method | Path | Body / cookie | Response |
|--------|------|---------------|----------|
| `POST` | `/api/auth/login` | JSON `{username, password}` | `200 {"username": "..."}` + `Set-Cookie: session=…; HttpOnly; Max-Age=604800; Path=/; SameSite=lax` on success; `401 {"detail": "Invalid username or password"}` on mismatch. |
| `POST` | `/api/auth/logout` | session cookie (optional) | `204` and clears the cookie. |
| `GET`  | `/api/auth/me` | session cookie | `200 {"username": "..."}` if valid; `401` otherwise. |

`create_app(settings=...)` installs `app.dependency_overrides[get_settings] = lambda: settings` so test-injected settings flow through to `get_current_user`. Without that, the dependency would resolve `Settings()` from the real env on every call.
