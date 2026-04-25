# Backend

FastAPI app, Python 3.12, managed with `uv`. Serves the JSON API under `/api/*` and (in production) the built frontend as static files at `/`.

## Layout

```
backend/
  pyproject.toml         Dependencies + pytest config (managed by uv)
  uv.lock                Pinned lockfile (committed)
  app/
    __init__.py
    main.py              create_app() factory; builds engine, runs init_db(), mounts routers + SPAStaticFiles
    config.py            Settings (pydantic-settings): SESSION_SECRET, OPENROUTER_API_KEY, DB_PATH, STATIC_DIR
    openrouter.py        Async OpenRouter client: `chat()` POSTs chat completions; `OpenRouterError` + `assistant_text()` (Part 8)
    static.py            SPAStaticFiles: StaticFiles subclass with SPA fallback
    auth.py              JWT cookie auth (Part 4)
    db.py                SQLAlchemy engine, session factory, idempotent init_db() + seed (Part 6)
    db_deps.py           FastAPI dependency that yields a session from app.state.session_factory (Part 6)
    models.py            ORM models mirroring docs/schema.json: User/Board/Column/Card/Conversation/Message (Part 6)
    schemas.py           Pydantic request/response models for the board API (Part 6)
    services/
      board.py           Board reads/writes scoped to the authenticated user (Part 6)
    routes/
      __init__.py
      health.py          GET /api/health -> {"status": "ok"}
      auth.py            POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me (Part 4)
      ai.py              POST /api/ai/ping — auth-gated OpenRouter 2+2 smoke (Part 8)
      board.py           GET /api/board, PATCH /api/columns/{id}, POST/PATCH/DELETE /api/cards (Part 6)
  static/
    index.html           Local-dev fallback served at / when running uvicorn directly
                         (in the container, STATIC_DIR is overridden to /app/static
                         which holds the built frontend export)
  tests/
    conftest.py          Builds a Settings + TestClient fixture, plus an auth_client logged in as the seeded user
    test_health.py
    test_static.py
    test_static_export.py  Verifies SPA fallback + /_next asset wiring + /api isolation
    test_auth.py
    test_db_init.py        Schema, PRAGMAs, idempotent seed, cascade-on-user-delete (Part 6)
    test_board.py          Wire contract, CRUD, moves/repack, cross-user isolation, 401/404 cases (Part 6)
    test_openrouter.py     OpenRouter `chat()` + `/api/ai/ping` (respx + optional `@pytest.mark.live`) (Part 8)
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
- `POST /api/ai/ping` — **auth required** (session cookie). JSON body must be `{}`. Calls OpenRouter `openai/gpt-oss-120b` with a fixed 2+2 prompt; `200 {"answer": "…"}`. Returns `503` when `OPENROUTER_API_KEY` is unset/blank, `502` on upstream failure or empty model text. Never returns raw provider error bodies to the client.
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

- Part 9 will add a conversation router using the `conversations` + `messages` tables already declared in `app/models.py`.
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

## Persistence (Part 6)

`app/db.py` builds a SQLAlchemy `Engine` against `settings.DB_PATH` and registers two SQLite PRAGMAs on every connection:

- `PRAGMA foreign_keys = ON` — required for the `ON DELETE CASCADE` chain `users → boards → columns → cards`.
- `PRAGMA journal_mode = WAL` — concurrent reads while a write is in flight.

`init_db(engine)` creates the schema (idempotent via `Base.metadata.create_all`) and seeds the demo `user`/board on first run only — the seed is keyed on `username = 'user'`, so re-running it is a no-op. `create_app` calls `init_db` eagerly so the very first request already sees a populated database.

The session per request comes from `app/db_deps.get_db`, which reads `request.app.state.session_factory`. That factory is built once per app in `create_app(settings)`, so tests that pass their own `Settings` get an isolated SQLite file with no global state to clean up.

`app/services/board.py` is the single source of truth for board mutations. Every public function takes the authenticated `username`, resolves the user's `Board`, and works only inside it. Lookups for a column or card not on that board raise `BoardNotFound`, translated to **404** at the route layer (never 403 — we don't leak whether the id exists on someone else's board). Position is repacked to contiguous `0..N-1` after every move/delete, matching the contract in `docs/db.md`.

## Board API (Part 6)

`app/routes/board.py` mounts under `/api/*`, all auth-gated:

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET`    | `/api/board`             | — | `200 {columns: [{id, title, cardIds}], cards: {id: {id, title, details}}}` — matches `frontend/src/lib/kanban.ts#BoardData`. |
| `PATCH`  | `/api/columns/{id}`      | `{title}` | `200 ColumnSummary` |
| `POST`   | `/api/cards`             | `{column_id, title, details?}` | `201 CardSummary`; appended to the column's tail position. |
| `PATCH`  | `/api/cards/{id}`        | `{title?, details?, column_id?, position?}` | `200 CardSummary`; positions repacked in source and target columns. `position` is clamped to `[0, len]`. |
| `DELETE` | `/api/cards/{id}`        | — | `204`; remaining cards in the column are repacked. |

Unauthenticated calls → `401`. Calls referencing a column/card not on the caller's board → `404`. Validation errors (blank title, negative position, unknown fields) → `422` from Pydantic.

## OpenRouter (Part 8)

- `app/openrouter.py` — `CHAT_COMPLETIONS_URL` = `https://openrouter.ai/api/v1/chat/completions`, default model `openai/gpt-oss-120b`. `chat()` uses a short-lived `httpx.AsyncClient` per call (MVP simplicity).
- Live smoke: `RUN_OPENROUTER_LIVE=1 OPENROUTER_API_KEY=… uv run pytest -m live -q` runs `test_live_ai_ping_contains_four` against the real API. Without both, that test is **skipped** so normal `pytest` and CI do not spend quota.
