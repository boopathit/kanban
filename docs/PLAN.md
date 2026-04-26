# Project Plan

Delivery plan for the Project Management MVP defined in the repo-root `AGENTS.md`. The work is split into 10 parts, each with substeps, explicit tests, and success criteria. A part is "done" only when all its success criteria pass.

## Locked-in architecture decisions

These answer the open questions from Part 1 and apply to every later part.

1. **Single Docker container** orchestrated via `docker-compose.yml` (one service today, room to grow). FastAPI inside the container serves both the API under `/api/*` and the built frontend as static files at `/`.
2. **Ephemeral SQLite** inside the container at `/app/data/pm.db`. Created at startup if missing. No bind mount for the MVP.
3. **Next.js static export** (`output: "export"`) produced at image-build time into `frontend/out/`; FastAPI mounts that folder. Browser calls `/api/*` live at runtime — "static" is only about the frontend assets.
4. **Auth**: JWT in a signed, httpOnly, SameSite=Lax cookie. Hardcoded credentials `user` / `password`. Token lifetime 7 days, signed with `SESSION_SECRET` from env.
5. **Schema doc first, then SQL**: schema is proposed as a JSON document in `docs/schema.json` for sign-off; implementation uses normal SQLite tables via SQLAlchemy (sync).
6. **Conversation history** persisted per user in SQLite (`conversations`, `messages` tables).
7. **Testing depth**: edge cases + complex branches only; no tests for trivial getters. Backend uses `pytest` + `httpx.AsyncClient` / `TestClient`; frontend keeps existing Vitest + Playwright.
8. **Scripts**: `scripts/start.sh`, `scripts/stop.sh` (bash, macOS/Linux) and `scripts/start.ps1`, `scripts/stop.ps1` (PowerShell, Windows). Host port `8000`.
9. **OpenRouter** with model `openai/gpt-oss-120b:free`, using `response_format` JSON-schema Structured Outputs for Part 9+.
10. **Per-card PATCH** for moves/edits; separate endpoints for column rename, card create, card delete.

`OPENROUTER_API_KEY` and `SESSION_SECRET` live in `.env` at the repo root and are passed into the container via `env_file` in `docker-compose.yml`. The repo `.gitignore` already excludes `.env`.

---

## Part 1 — Plan and frontend description

Write this plan (with detailed substeps, tests, and success criteria) and describe the existing frontend so later parts can reason about it without re-reading every file.

### Substeps

- Gather all open questions and resolve them with the user before writing.
- Read the existing `frontend/` code (config, pages, components, lib, tests) so the description is accurate.
- Write `frontend/AGENTS.md` covering tech stack, scripts, file layout, domain model, state model, styling, and known gaps for integration.
- Rewrite `docs/PLAN.md` (this file) with Parts 2–10 as actionable checklists.
- User reviews and approves the plan.

### Tests / checks

- `frontend/AGENTS.md` file paths match reality (`ls frontend/src/`** matches what is described).
- No file described in `frontend/AGENTS.md` is missing or misattributed.
- Every later part has at least one concrete test listed.

### Success criteria

- User replies with approval of this plan.
- `frontend/AGENTS.md` exists and accurately describes the current frontend.

---

## Part 2 — Scaffolding (Docker + FastAPI + scripts, "hello world")

Stand up the container, the FastAPI app, and the start/stop scripts. Prove end-to-end: `scripts/start.*` builds and runs; `http://localhost:8000/` serves a static HTML page; `http://localhost:8000/api/health` returns JSON; `scripts/stop.*` tears it down.

### Substeps

- Create `backend/` skeleton:
  - `backend/pyproject.toml` managed by `uv`, Python 3.12.
  - Dependencies: `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `sqlalchemy`, `python-jose[cryptography]`, `passlib[bcrypt]`, `httpx`; dev: `pytest`, `pytest-asyncio`, `pytest-cov`, `respx`.
  - `backend/app/__init__.py`, `backend/app/main.py` with `create_app()` factory.
  - `backend/app/config.py` with `Settings` reading `SESSION_SECRET`, `OPENROUTER_API_KEY`, `DB_PATH`, `STATIC_DIR`.
  - `backend/app/routes/health.py` → `GET /api/health` returns `{"status": "ok"}`.
  - Static mount: `StaticFiles(directory=settings.STATIC_DIR, html=True)` at `/`.
  - Placeholder `backend/static/index.html` so the container works before Part 3 exists.
- Create `Dockerfile` at repo root. Single-stage `python:3.12-slim` + `uv` for Part 2 (no frontend build yet — the placeholder `backend/static/` is copied directly). Part 3 will add a `node:22-alpine` build stage that produces `frontend/out/` and replaces the static dir.
- Create `docker-compose.yml` at repo root: one `app` service, build context `.`, ports `"8000:8000"`, `env_file: .env`, restart `unless-stopped`.
- Create `.dockerignore` excluding `node_modules`, `.next`, `frontend/out`, `__pycache__`, `.venv`, `.git`, `docs/`, `terminals/`, `**/AGENTS.md`, `.env*` (except `.env.example`).
- Create `.env.example` documenting required env vars; `.env` itself is gitignored and is auto-created by `start` scripts on first run.
- Create scripts: `scripts/start.sh`, `scripts/stop.sh`, `scripts/start.ps1`, `scripts/stop.ps1`. Each `start` resolves the repo root from its own location, copies `.env.example` → `.env` if missing, runs `docker compose up -d --build`, then polls `/api/health` for 30 s. On timeout, dumps `app` logs.
- Write `backend/AGENTS.md` describing module layout, config surface, run/test commands.
- Write `scripts/AGENTS.md` describing scripts and usage.
- Write backend tests:
  - `backend/tests/test_health.py` — `/api/health` returns 200 + body; `/health` (no prefix) returns 404.
  - `backend/tests/test_static.py` — `/` returns 200 + placeholder string + `text/html`; unknown path returns 404.

### Tests / checks

- `cd backend && uv run pytest` passes (currently 4/4, 100 % coverage on `app/`).
- `bash scripts/start.sh` (or `scripts\start.ps1`) completes without error on a clean machine. *(Manual verification — not run by the agent in this environment as Docker is not available in the agent shell; user to run.)*
- `curl http://localhost:8000/api/health` returns `{"status":"ok"}` within 30 s of start.
- `curl http://localhost:8000/` returns HTML containing the placeholder string.
- `bash scripts/stop.sh` removes the container; `docker ps` shows it gone.

### Success criteria

- All backend unit tests green. *(done — 4/4)*
- Start script brings the stack up and health check passes. *(pending user verification with Docker)*
- Stop script brings it down cleanly. *(pending user verification)*
- `backend/AGENTS.md` and `scripts/AGENTS.md` reflect reality. *(done)*

---

## Part 3 — Wire the existing frontend through FastAPI static serving

Replace the placeholder HTML with the real Kanban demo, built via `next build` with `output: "export"`, and served by FastAPI. The app behaves identically to the current `npm run dev` experience but runs from the container.

### Substeps

- Edit `frontend/next.config.ts` to set `output: "export"`, `images: { unoptimized: true }`, `trailingSlash: false`.
- Verified pages/components are client-compatible: `npm run build` succeeds, prerenders only `/` and `/_not-found` as static, writes `frontend/out/index.html` referencing `/_next/static/chunks/*.{js,css}` and font assets.
- Convert `Dockerfile` to multi-stage: `node:22-alpine` stage runs `npm ci && npm run build`, then `python:3.12-slim` runtime stage copies `--from=frontend /frontend/out` into `/app/static`. (Replaces the placeholder copy from Part 2.)
- Keep `backend/static/index.html` as a local-dev fallback (used only when running uvicorn directly without Docker — STATIC_DIR defaults to `<backend>/static`). Documented in `backend/AGENTS.md`.
- Add SPA fallback via a `SPAStaticFiles` subclass at `backend/app/static.py`: serves `index.html` for unknown extensionless paths, never overrides `/api/`* 404s, never swallows missing-asset 404s (paths with `.` extension still 404).
- Add Playwright config for static export at `frontend/playwright.static.config.ts`: spawns `uv run uvicorn app.main:app --port 8000` with `STATIC_DIR=<repo>/frontend/out`, `baseURL=http://127.0.0.1:8000`, `workers: 1` (single backend process). Keep the existing `playwright.config.ts` for the dev-server flow. New `npm run test:e2e:static` script builds the export then runs Playwright.
- Add `backend/tests/test_static_export.py`: builds a Next-shaped fixture (`index.html` referencing `/_next/static/chunks/main.js` + the asset), verifies root serves the indexed HTML, asset returns 200 with content, SPA fallback handles `/login` and `/projects/123/edit`, missing `_next` asset still 404s, `/api/does-not-exist` still 404s, `/api/health` still wins over the static mount.

### Tests / checks

- `cd frontend && npm run build` succeeds and writes `frontend/out/index.html`.
- `cd backend && uv run pytest` — 12/12 green, 97 % coverage on `app/`.
- `cd frontend && npm run test:unit` — 6/6 green.
- `cd frontend && npm run test:e2e:static` — 3/3 green against FastAPI serving `frontend/out/` (~3.5 s).
- `cd frontend && npm run lint` — no warnings.
- Container build + run via `scripts/start.ps1` — image built, container started, `/api/health` healthy in ~2 s after start. End-to-end curl matrix on the live container:
  - `GET /api/health` → 200 `{"status":"ok"}`
  - `GET /` → 200, 20391 B, contains `<title>Kanban Studio</title>` and all 5 column `data-testid`s
  - `GET /_next/static/chunks/<hash>.js` → 200, `text/javascript`
  - `GET /login` → 200, served `index.html` (SPA fallback)
  - `GET /projects/123/edit` → 200 (nested SPA fallback)
  - `GET /api/does-not-exist` → 404
  - `GET /_next/static/chunks/missing.js` → 404
- `scripts/stop.ps1` — container removed, network removed.

### Success criteria

- Static export builds, is served by FastAPI, and the e2e suite passes against it.
- No regressions in Vitest or backend pytest suites.
- No build-time use of server-only Next.js features remains.
- Visual parity with `npm run dev` confirmed in the container.

### Notable mid-task fix

Initial container run revealed a SPA-fallback bug: Next's static export ships its own `404.html`, which Starlette's `StaticFiles(html=True)` returns with HTTP 404 *as a response* instead of raising `HTTPException`. The original `SPAStaticFiles` only caught the exception path, so `/login` 404'd with the Next not-found page instead of falling back to the SPA shell. Fixed by also intercepting the `response.status_code == 404` case while still letting `/api/`* and extensioned-asset 404s stand. Test fixture updated to include a `404.html` so this regresses obviously in CI.

---

## Part 4 — Fake login (hardcoded user/password) with JWT session cookie

Hide the Kanban behind a login page. Unauthenticated visits to `/` redirect to `/login`. Credentials are hardcoded (`user` / `password`). On success, backend sets an httpOnly JWT cookie; frontend reads authenticated state by calling `GET /api/auth/me`. Logout clears the cookie.

### Substeps

- Backend:
  - `backend/app/auth.py` — helpers: `create_token(username)`, `decode_token(token)`, `get_current_user` dependency reading the `session` cookie. `verify_credentials()` uses `hmac.compare_digest` for constant-time comparison.
  - `backend/app/routes/auth.py`:
    - `POST /api/auth/login` body `{username, password}`; on match, issues an HS256 JWT and sets cookie `session` (httpOnly, SameSite=Lax, Secure=False for local http, 7-day Max-Age, Path=/). Returns `{"username":"user"}`.
    - `POST /api/auth/logout` clears the cookie and returns 204.
    - `GET /api/auth/me` returns `{"username":"user"}` when the cookie is valid, else 401.
  - Router registered under `/api/auth/*` in `app/main.py`.
  - `app.dependency_overrides[get_settings]` is wired in `create_app(settings)` so test-injected settings flow through to deps that resolve `get_settings`.
- Frontend:
  - `src/lib/api.ts` — `apiFetch<T>(path, init)` wrapper that always sends `credentials: "include"`, JSON-encodes `init.json`, parses JSON responses, returns `null` for 204, and throws a typed `ApiError(status, detail)` on non-2xx.
  - `src/lib/auth.ts` — `login`, `logout`, `getCurrentUser` thin functions on top of `apiFetch`.
  - `src/app/login/page.tsx` — brand-styled, centered, accessible form. On submit calls `login()`; on success `router.replace("/")`; on `ApiError(401)` shows `"Invalid username or password."`, on other errors shows `"Sign-in failed. Please try again."`.
  - `src/app/page.tsx` — converted to a client component that calls `getCurrentUser()` in a `useEffect`. While checking, renders a small `data-testid="auth-checking"` placeholder. On 401 `router.replace("/login")`; on success renders `<KanbanBoard onLogout={...} />`.
  - `KanbanBoard` accepts an optional `onLogout` prop; when provided, renders a "Log out" button (`data-testid="logout-button"`) in the header. The home page wires it to call `logout()` then `router.replace("/login")`.
- Tests:
  - **Backend** `backend/tests/test_auth.py` — 15 tests including: login OK sets the right cookie attributes (HttpOnly, SameSite=lax, Path=/, Secure absent on local http); wrong password / wrong username → 401 + no cookie; pydantic validation rejects empty/missing fields (5 parametrised cases); `me` without cookie → 401; `me` with valid cookie → 200; logout clears the cookie and the next `me` → 401; tampered token → 401; token signed with wrong secret → 401; expired token → 401; token without `sub` claim → 401.
  - **Frontend unit** `src/lib/api.test.ts` (7), `src/app/login/page.test.tsx` (4), `src/app/page.test.tsx` (4), and 2 new cases in `KanbanBoard.test.tsx` (logout button hidden by default, clicking calls `onLogout`).
  - **Playwright** `tests/auth.spec.ts` (6): unauth `/` → redirect; wrong creds show inline error; valid creds reveal the board; reload preserves session; logout bounces to `/login` and `/` is then locked again; cookie is httpOnly + SameSite=Lax and not readable from `document.cookie`.
  - **Playwright** `tests/kanban.spec.ts` updated: each test programmatically logs in via `request.post('/api/auth/login', …)` first, with `test.skip` if the backend isn't reachable (so the dev-mode Playwright config no longer hard-fails when there's no backend).

### Tests / checks

- `cd backend && uv run pytest --cov` — 26 tests green, 99 % coverage.
- `cd frontend && npm run test:unit` — 23 tests green.
- `cd frontend && npm run lint` — no warnings.
- `cd frontend && npm run test:e2e:static` — 9 tests green (6 auth + 3 kanban).
- Container build + smoke (`scripts/start.ps1`):
  - `GET /api/auth/me` (no cookie) → 401
  - `POST /api/auth/login` `{user, nope}` → 401, no Set-Cookie
  - `POST /api/auth/login` `{user, password}` → 200, Set-Cookie: `session=…; HttpOnly; Max-Age=604800; Path=/; SameSite=lax`
  - `GET /api/auth/me` with cookie → 200 `{"username":"user"}`
  - `POST /api/auth/logout` → 204
  - `GET /api/auth/me` after logout → 401
  - `GET /login` → 200 with the real `<form>` (Sign in to Kanban Studio + username/password inputs + submit)
  - `GET /` → 200 (Kanban shell that JS-checks auth and redirects to `/login` when 401)
  - `GET /api/notexist` → 404; `GET /_next/static/chunks/missing.js` → 404 (no SPA bleed)
- `scripts/stop.ps1` — container + network removed cleanly.

### Success criteria

- Unauthenticated `/` redirects to `/login`.
- `user`/`password` logs in; wrong creds show a clear inline error.
- Auth survives a page reload.
- Logout immediately bounces back to `/login`, and `/` is locked again.
- Session cookie is httpOnly + SameSite=Lax with a 7-day max-age, not readable from `document.cookie`.

### Notable mid-task fix

Live verification revealed the SPA fallback was over-eager: Next's static export emits `login.html` (flat), not `login/index.html`, and Starlette's `StaticFiles(html=True)` doesn't auto-resolve `<path>.html`. As a result `/login` was 404'ing out of `StaticFiles` and the SPA fallback served `index.html` (the Kanban shell) instead. `SPAStaticFiles` now also tries `<path>.html` for extensionless paths before falling back to `index.html`. Two new tests in `test_static_export.py` (login.html resolution + dynamic-path fallback) cover both branches.

---

## Part 5 — Database schema proposal (JSON doc, then sign-off)

Propose the database schema, document it in `docs/schema.json` and `docs/db.md`, and get user approval before writing migrations. Schema must support multiple users, one board per user (MVP constraint), many columns, many cards, plus conversation history.

### Substeps

- Draft `docs/schema.json` — JSON document describing tables, columns, types, nullability, foreign keys, indexes, conventions, seed plan, and the wire contract for `GET /api/board`. Tables proposed:
  - `users(id TEXT PK, username TEXT UNIQUE, created_at TEXT)`
  - `boards(id TEXT PK, user_id TEXT FK→users.id UNIQUE, created_at TEXT)` — UNIQUE enforces one board per user for MVP.
  - `columns(id TEXT PK, board_id TEXT FK→boards.id, title TEXT, position INTEGER, created_at TEXT)` — non-UNIQUE index on `(board_id, position)`; UNIQUE intentionally omitted (see `docs/db.md`).
  - `cards(id TEXT PK, column_id TEXT FK→columns.id, title TEXT, details TEXT, position INTEGER, created_at TEXT, updated_at TEXT)` — non-UNIQUE index on `(column_id, position)`.
  - `conversations(id TEXT PK, user_id TEXT FK→users.id UNIQUE, created_at TEXT)` — one rolling conversation per user.
  - `messages(id TEXT PK, conversation_id TEXT FK→conversations.id, role TEXT CHECK(role IN ('user','assistant','system')), content TEXT, created_at TEXT)`
  - All FKs cascade ON DELETE; `PRAGMA foreign_keys = ON` is required per connection.
- Write `docs/db.md` — narrative covering: TEXT uuid4 ids, ISO-8601 UTC TEXT timestamps, contiguous (re-packed) `position` strategy and **why we deviate from PLAN.md by omitting `UNIQUE(column_id, position)`** for the MVP, cascade-delete semantics, idempotent seed plan keyed on `username = 'user'`, and the `GET /api/board` wire contract that matches `frontend/src/lib/kanban.ts#BoardData` byte-for-byte.
- Present both files to the user for review (this PR / chat).
- User reviews and approves — all five open questions answered "as proposed" (2026-04-25).

### Tests / checks

- User reviews `docs/schema.json` and `docs/db.md` and approves (no automated tests in this part — Part 6 will exercise the schema).

### Success criteria

- Explicit user approval recorded in chat (2026-04-25, "as proposed").
- Schema proposal is self-consistent (every FK target exists; positions have a clear ordering contract).
- Wire contract for `GET /api/board` matches the existing `BoardData` shape so Part 7 can swap state sources without touching the UI.

---

## Part 6 — Backend persistence + Kanban API

Implement the approved schema and the full REST API so the frontend (Part 7) can replace its in-memory state.

### Substeps

- `backend/app/db.py` — SQLAlchemy engine/session factory pointing at `settings.DB_PATH`. PRAGMAs `foreign_keys = ON` + `journal_mode = WAL` set per connection. `init_db()` creates tables if missing and seeds the `user`/`password` user + their default board + 5 starter columns + demo cards (titles/details match `frontend/src/lib/kanban.ts#initialData` so UX is unchanged).
- `init_db()` runs eagerly inside `create_app(settings)` — that path also stores the engine and session factory on `app.state` for the dependency to read.
- `backend/app/models.py` — SQLAlchemy 2.0 declarative models for `User`, `Board`, `Column`, `Card`, `Conversation`, `Message`. All FKs `ondelete="CASCADE"`; non-UNIQUE composite indexes on `(board_id, position)` and `(column_id, position)`; `CHECK(role IN ('user','assistant','system'))` on messages.
- `backend/app/schemas.py` — Pydantic models (`extra="forbid"`) for request/response: `BoardResponse`, `ColumnSummary`, `CardSummary`, `RenameColumnRequest`, `CreateCardRequest`, `UpdateCardRequest`.
- `backend/app/services/board.py` — every public function is keyed on the authenticated `username`, resolves `user → board` once, and operates only inside it. Lookups for non-owned columns/cards raise `BoardNotFound` → 404 (avoids leaking existence). Re-packs positions to contiguous `0..N-1` in the affected column(s) on every move/delete. After delete, repack re-queries the live rows so the in-memory `column.cards` collection can't carry a stale instance.
- `backend/app/db_deps.py` — `get_db` reads `request.app.state.session_factory` and yields a session that auto-commits on success / rolls back on exception, so tests with a private SQLite file don't fight a module-level engine.
- `backend/app/routes/board.py`:
  - `GET /api/board` — returns current user's board in the exact shape the frontend uses (`{ columns: [{id,title,cardIds:[...]}], cards: {id: {id,title,details}} }`).
  - `PATCH /api/columns/{id}` body `{title}` — rename (1–120 chars).
  - `POST /api/cards` body `{column_id, title, details?}` — `201 CardSummary`; server assigns id and appends to column tail.
  - `PATCH /api/cards/{id}` body `{title?, details?, column_id?, position?}` — edit and/or move. Server re-packs positions in source + target column. `position` clamped to `[0, len]`.
  - `DELETE /api/cards/{id}` — 204; remaining cards in the column repacked.
- All board routes depend on `get_current_user`; return 401 otherwise. Every query is scoped through the user's `Board` so cross-user reads are impossible by construction.
- Tests — `backend/tests/test_board.py` (32 cases covering): wire shape vs. `BoardData`; seeded column order; rename column happy + 404 + 422; create card append + default details + 404 + 422; partial PATCH (title only / details only); move within column; move across columns (append, specific position, clamp past end); 404 paths for unknown card/column on move; delete removes + repacks remaining contiguous; 401 on every endpoint without cookie; cross-user isolation (cannot read/PATCH/DELETE another user's card or column, cannot create a card in another user's column — all return 404, not 403); valid token for an unknown user → 404; full login → GET board round-trip.
- `backend/tests/test_db_init.py` (4 cases): tables + seed created on first call; `init_db()` is idempotent across three calls; `PRAGMA foreign_keys = 1` and `journal_mode = wal`; cascade delete of a user removes board/columns/cards.

### Tests / checks

- `cd backend && uv run pytest` — 58 tests green (was 26 after Part 4).
- Wire contract verified: `GET /api/board` returns `{columns: [...], cards: {...}}` matching `frontend/src/lib/kanban.ts#BoardData` byte-for-byte.
- `cd frontend && npm run test:unit -- --run` — 23/23 still green (no regressions from Parts 3–4).
- Container smoke (`scripts/start.ps1` then `curl`):
  - `GET /api/board` (no cookie) → 401
  - `POST /api/auth/login` `{user, password}` → 200 + session cookie
  - `GET /api/board` → 200, 5 columns `[Backlog, Discovery, In Progress, Review, Done]`, 8 seeded cards
  - `PATCH /api/cards/<id>` `{title, details}` → 200; subsequent `GET /api/board` reflects the new fields
  - `POST /api/cards` `{column_id: <Discovery>, title, details}` → 201 with new id, appears at tail of Discovery
  - `PATCH /api/cards/<new>` `{column_id: <Backlog>, position: 0}` → 200; new card now at index 0 of Backlog
  - `DELETE /api/cards/<new>` → 204; subsequent `GET /api/board` confirms removal and remaining Backlog cards stay contiguous

### Success criteria

- Every endpoint in the substep list behaves per spec.
- All tests pass.
- No cross-user data leakage is possible by construction (covered by 3 dedicated isolation tests).
- Position invariant (`0..N-1` contiguous) holds after every write, verified by both API tests and direct DB assertions.

---

## Part 7 — Frontend uses the real backend

Replace `useState(initialData)` with data loaded from `/api/board`. Every mutation (drag, rename, add, delete) hits the backend; the UI updates optimistically and rolls back on error.

### Substeps

- `src/lib/board.ts` — typed wrappers on `apiFetch`: `getBoard()`, `renameColumn(id, title)`, `createCard(columnId, title, details)`, `patchCard(id, patch)`, `deleteCard(id)`. Card paths URL-encode the id; PATCH/POST send only the supplied fields.
- `src/lib/useBoard.ts` — owns `BoardData`, exposes `{ board, loading, error, dismissError, reload, actions }`.
  - Loads on mount; sets `loading=false` and `error` from the response.
  - `actions.createCard` POSTs first and only mutates state with the server's id on success (avoids optimistic-id mismatches); errors snap back to the pre-call snapshot and surface a friendly message.
  - `actions.moveCard` is fully optimistic: reorders the column locally then PATCHes `{ column_id, position }`; rollback on failure.
  - `actions.deleteCard` removes the card locally, DELETEs in the background, restores the snapshot if the call fails.
  - `actions.renameColumn` updates the title locally on every keystroke and **debounces** the PATCH by 350 ms so a flurry of edits collapses to one request. A failed PATCH (or a blank title at flush time) restores the snapshot.
- `src/components/Toast.tsx` — minimal `role="status"` toast used for board errors. `data-testid="board-error-toast"`, dismiss button labelled `Dismiss notification`.
- `KanbanBoard.tsx` is now **purely presentational**: `{ board, loading, error, onDismissError, actions, onLogout? }`. Renders a `[data-testid="board-loading"]` placeholder while `loading || !board`, otherwise the full Kanban + toast.
- `KanbanColumn.tsx` carries `data-column-title={column.title}` so e2e specs can target columns by title (the column id is now a server-assigned UUID).
- `src/app/page.tsx` wires `useBoard()` and feeds the props through to `<KanbanBoard>`.
- Tests:
  - `src/lib/board.test.ts` (6 cases): URL + method + body shape for each verb, 204 → null on delete, URL-encoded ids.
  - `src/lib/useBoard.test.tsx` (9 cases): initial load happy/error, createCard happy + 500 rollback, moveCard happy + rollback, deleteCard happy, renameColumn debounce + rollback, `dismissError`.
  - `src/components/KanbanBoard.test.tsx` rewritten against the new props API (9 cases): loading placeholder, column count, rename/create/delete callbacks, error toast + dismiss, logout visibility/click.
  - `src/app/page.test.tsx` — page test now also stubs `/api/board` so the board renders.
  - `tests/kanban.spec.ts` — selectors switched to `data-column-title="…"` + visible card text. `Add card` test uses a unique title per run.
  - New `tests/persistence.spec.ts` (2 cases): create card → reload → still there → delete → reload → gone; rename column → reload → renamed (and best-effort restore at the end).
  - `playwright.static.config.ts` stamps `DB_PATH` with `pm-e2e-${Date.now()}.db` so each run gets a freshly seeded database.

### Tests / checks

- `cd frontend && npm run test:unit -- --run` — 42/42 (was 23/23 after Part 6).
- `cd frontend && npm run lint` — 0 errors, 0 warnings.
- `cd backend && uv run pytest` — 58/58 still green (no regressions).
- `cd frontend && npm run build` — clean static export.
- `cd frontend && npx playwright test --config=playwright.static.config.ts` — 11/11 e2e (6 auth + 3 board + 2 persistence) in ~8 s against a fresh DB.
- Container smoke (`scripts/start.ps1`):
  - Login, add a card via the UI, hard reload → card present.
  - Drag a card across columns → reload → card stays in the new column.
  - Delete the new card → reload → gone.
  - Rename a column → reload → name persists.

### Notable design decisions

- **Pessimistic create, optimistic move/delete/rename.** Cards need a server id before they can be referenced (drag/delete), so `createCard` waits for the POST response. Move and delete don't need a new id, so they snap immediately with rollback on failure. Rename is the same family but debounced because it fires on every keystroke.
- **Friendly errors over raw HTTP.** `messageFor()` prefers `ApiError.detail` (FastAPI's `HTTPException` payload), falls back to `error.message`, then a hand-written sentence per action. The toast surfaces it; `dismissError()` clears it.
- `**data-column-title` instead of `data-testid` for e2e.** Column ids are server UUIDs now, so tests can't hard-code `column-col-review`. Adding the title attribute keeps Playwright selectors stable across runs and reseeds.

### Success criteria

- No call to `initialData` remains on the rendered path (it's still exported from `lib/kanban.ts` for type re-use, but never imported by `page.tsx` / `KanbanBoard.tsx`).
- Drag, rename, add, delete all round-trip through the API and survive a hard reload.
- Optimistic updates feel instant; errors surface in a toast without losing the UI.

---

## Part 8 — OpenRouter connectivity (2+2 smoke test)

Wire up the backend to OpenRouter, using `openai/gpt-oss-120b:free`. Provide a simple endpoint and test to prove a call round-trips successfully.

### Substeps

- `backend/app/openrouter.py` — async `httpx.AsyncClient` wrapper:
  - `chat(api_key=..., messages=..., model="openai/gpt-oss-120b:free", response_format=None) -> dict` — POSTs to `https://openrouter.ai/api/v1/chat/completions`, returns parsed JSON; forwards `response_format` when set (for Part 9).
  - Raises `OpenRouterError` on HTTP `>= 400`, blank API key, or non-JSON success body.
  - `assistant_text(data)` — extracts first `choices[].message.content` (never logs the key or upstream error bodies).
- `backend/app/routes/ai.py` — `POST /api/ai/ping` (prefix `/api/ai`):
  - Protected by `get_current_user`. Body must be `{}` (`extra="forbid"`).
  - Sends one user message: "What is 2+2? Reply with just the number." Returns `200 {"answer": "<string>"}`.
  - `503` when `OPENROUTER_API_KEY` is unset/blank; `502` when OpenRouter fails or returns an empty assistant string.
- `backend/app/main.py` — `ai.router` registered after `auth`, before `board` (still before `/` static mount).
- `backend/pyproject.toml` — `markers = ["live: …"]` for the opt-in smoke test.
- `backend/tests/test_openrouter.py`:
  - `assistant_text` happy + malformed.
  - Async `respx` tests: request URL, `Authorization: Bearer <key>`, default model, messages JSON; optional `response_format` in body; `OpenRouterError` on 500; `OpenRouterError` on empty key; `OpenRouterError` on 200 non-JSON.
  - Route tests (`TestClient`): `401` without session; `503` with session but no API key (default `conftest` settings); `200` + `{answer: "4"}` with mocked upstream; `502` on upstream 500; `502` on empty `choices`.
  - `@pytest.mark.live` — real `POST /api/ai/ping` when `**OPENROUTER_API_KEY` and `RUN_OPENROUTER_LIVE=1`** are set; asserts `"4"` in `answer`. Otherwise skipped (CI-safe, no accidental spend when only the key is exported).

### Tests / checks

- `cd backend && uv run pytest` — **70 passed, 1 skipped** (live skipped without `RUN_OPENROUTER_LIVE=1` + key).
- Live: `RUN_OPENROUTER_LIVE=1 OPENROUTER_API_KEY=... uv run pytest -m live -q` — real ping; answer contains `"4"`.
- `curl` after `POST /api/auth/login` with `POST /api/ai/ping` `{}` — `200` and JSON with `answer` (value depends on model; mocked tests pin `"4"`).

### Success criteria

- A real request to `openai/gpt-oss-120b:free` via OpenRouter succeeds locally when env is set for the live test.
- API key is never logged; HTTP error responses to the client are generic (`502` / `503` messages) and do not echo upstream bodies.

### Notable design decisions

- **Two env gates for the live test** — `OPENROUTER_API_KEY` alone is easy to leave exported from `.env`; requiring `RUN_OPENROUTER_LIVE=1` avoids burning quota on every `pytest` run.
- **Pessimistic HTTP layer** — route maps any `OpenRouterError` to `502` with a fixed detail string so clients never see provider-internal messages.

---

## Part 9 — AI chat with board context + Structured Outputs

Upgrade the AI endpoint to accept a user message plus conversation history, always send the full current board JSON as context, and require the model to reply with Structured Outputs: a message to the user plus an optional board update instruction. Persist the conversation in SQLite.

### Substeps

- `backend/app/ai_schema.py` — strict schema + typed parser:
  - Pydantic models for `reply` and optional `board_update.operations` with discriminated union ops:
    - `rename_column`, `create_card`, `delete_card`, `update_card`
  - `CHAT_RESPONSE_SCHEMA` JSON schema (`additionalProperties: false` throughout).
  - `openrouter_response_format()` returns OpenRouter `{"type":"json_schema","json_schema":{...,"strict":true}}`.
  - `parse_chat_model_json(raw_json)` validates model output and rejects unknown fields/types.
- `backend/app/services/chat.py`:
  - `start_or_get_conversation(user_id)` — one conversation row per user.
  - `append_message(conversation_id, role, content)` — persists each chat turn message.
  - `recent_messages(..., limit=30)` — capped history (ascending in response order).
  - `build_system_prompt(board)` — embeds full current board JSON + operation rules.
  - `apply_board_update(username, operations)` — executes board ops via Part-6 board service inside `session.begin_nested()` (transactional savepoint). On any invalid cross-user/missing id, rolls back all ops and returns `{applied_ops: [], error: ...}` while still allowing the assistant reply to persist.
- `backend/app/routes/ai.py`:
  - Kept `POST /api/ai/ping` unchanged for Part-8 smoke.
  - Added `POST /api/chat` body `{message}`:
    - Auth required.
    - Appends user message first.
    - Loads board + last 30 messages and calls OpenRouter with strict JSON schema response format.
    - On valid structured output, appends assistant reply.
    - Applies optional board ops transactionally and returns `{reply, applied_ops, updated_board?, op_error?}`.
    - Malformed model JSON returns `502` safe error (`"The AI service returned an invalid response."`) while preserving the user message.
  - Added `GET /api/chat/history` returning recent persisted messages.
- Tests — `backend/tests/test_chat.py`:
  - reply-only response stores user+assistant and leaves board unchanged.
  - `rename_column` op mutates DB and returns `updated_board`.
  - `create_card` + `update_card` apply in one turn.
  - cross-user `card_id` op is rejected, board unchanged, `applied_ops=[]`, `op_error` present, reply still returned.
  - malformed model JSON returns 502 and still records user message.
  - history cap returns last 30 messages.
  - live-gated smoke (`@pytest.mark.live`, requires both `OPENROUTER_API_KEY` and `RUN_OPENROUTER_LIVE=1`).

### Tests / checks

- `cd backend && uv run pytest` — 76 passed, 2 skipped (`live` tests gated).
- Live smoke (Docker + curl): `POST /api/chat {"message":"Please rename Backlog to Inbox"}` returned reply + applied op; subsequent `GET /api/board` showed `Inbox`.
- Live test command available: `RUN_OPENROUTER_LIVE=1 OPENROUTER_API_KEY=... uv run pytest -m live -q`

### Success criteria

- Every successful chat turn persists both messages (`user`, `assistant`).
- Structured output is strictly validated against schema; unknown/malformed payloads are rejected safely.
- Board updates are transactional and user-scoped (`begin_nested` + Part-6 ownership checks).
- Reply still comes back when ops fail (`op_error` set, `applied_ops=[]`, DB unchanged).

---

## Part 10 — AI chat sidebar UI with live board refresh

Add a polished chat sidebar to the Kanban page. User can send messages; assistant replies stream in (or appear on completion); whenever the response includes board updates, the Kanban refreshes automatically without a page reload.

### Substeps

- [x] `src/lib/chat.ts` — typed API client (`getHistory`, `sendMessage`).
- [x] `src/lib/useChat.ts` — chat state hook:
  - loads persisted history on mount,
  - sends messages and appends assistant replies,
  - applies `updated_board` snapshots immediately via injected `setBoard`,
  - exposes pending/error/dismiss lifecycle.
- [x] `src/components/ChatSidebar.tsx`:
  - right-side panel on desktop + drawer on mobile,
  - collapse/expand control, keyboard-friendly composer,
  - empty-state prompt suggestions,
  - message bubbles + timestamps + auto-scroll.
- [x] `useBoard` now exposes `setBoard(nextBoard)` for external board snapshots (used by chat updates).
- [x] `KanbanBoard.tsx` renders `<ChatSidebar setBoard={...} />` beside the board and wires chat updates to live board refresh.
- [x] Tests:
  - [x] `ChatSidebar.test.tsx` — mocked fetch verifies send flow, assistant render, `setBoard(updated_board)` behavior, and error dismiss.
  - [x] `useBoard.test.tsx` — external snapshot injection test via `setBoard`.
  - [x] `tests/chat.spec.ts` (Playwright) — mocked `/api/chat*` validates no-reload rename + card creation flows.
  - [x] existing suite updates for new props and chat-history fetch stubs.

### Tests / checks

- [x] `cd frontend && npm run test:unit -- --run` — 45/45 passing.
- [x] `cd frontend && npm run lint` — clean.
- [x] `cd frontend && npm run test:e2e:static` — 13/13 passing (includes new `chat.spec.ts`).
- [x] `cd backend && uv run pytest -q` — 76 passed, 2 skipped (no regressions).
- [x] Manual: real chat operation updates board instantly and persists on reload.

### Success criteria

- [x] Sidebar is on-brand, keyboard-usable, and responsive for narrow screens.
- [x] Board updates apply instantly from chat response snapshots and persist across reload.
- [x] No regressions in Parts 2–9 suites.

