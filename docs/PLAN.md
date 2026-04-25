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
9. **OpenRouter** with model `openai/gpt-oss-120b`, using `response_format` JSON-schema Structured Outputs for Part 9+.
10. **Per-card PATCH** for moves/edits; separate endpoints for column rename, card create, card delete.

`OPENROUTER_API_KEY` and `SESSION_SECRET` live in `.env` at the repo root and are passed into the container via `env_file` in `docker-compose.yml`. The repo `.gitignore` already excludes `.env`.

---

## Part 1 — Plan and frontend description

Write this plan (with detailed substeps, tests, and success criteria) and describe the existing frontend so later parts can reason about it without re-reading every file.

### Substeps

- [x] Gather all open questions and resolve them with the user before writing.
- [x] Read the existing `frontend/` code (config, pages, components, lib, tests) so the description is accurate.
- [x] Write `frontend/AGENTS.md` covering tech stack, scripts, file layout, domain model, state model, styling, and known gaps for integration.
- [x] Rewrite `docs/PLAN.md` (this file) with Parts 2–10 as actionable checklists.
- [ ] User reviews and approves the plan.

### Tests / checks

- `frontend/AGENTS.md` file paths match reality (`ls frontend/src/**` matches what is described).
- No file described in `frontend/AGENTS.md` is missing or misattributed.
- Every later part has at least one concrete test listed.

### Success criteria

- User replies with approval of this plan.
- `frontend/AGENTS.md` exists and accurately describes the current frontend.

---

## Part 2 — Scaffolding (Docker + FastAPI + scripts, "hello world")

Stand up the container, the FastAPI app, and the start/stop scripts. Prove end-to-end: `scripts/start.*` builds and runs; `http://localhost:8000/` serves a static HTML page; `http://localhost:8000/api/health` returns JSON; `scripts/stop.*` tears it down.

### Substeps

- [x] Create `backend/` skeleton:
  - `backend/pyproject.toml` managed by `uv`, Python 3.12.
  - Dependencies: `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `sqlalchemy`, `python-jose[cryptography]`, `passlib[bcrypt]`, `httpx`; dev: `pytest`, `pytest-asyncio`, `pytest-cov`, `respx`.
  - `backend/app/__init__.py`, `backend/app/main.py` with `create_app()` factory.
  - `backend/app/config.py` with `Settings` reading `SESSION_SECRET`, `OPENROUTER_API_KEY`, `DB_PATH`, `STATIC_DIR`.
  - `backend/app/routes/health.py` → `GET /api/health` returns `{"status": "ok"}`.
  - Static mount: `StaticFiles(directory=settings.STATIC_DIR, html=True)` at `/`.
  - Placeholder `backend/static/index.html` so the container works before Part 3 exists.
- [x] Create `Dockerfile` at repo root. Single-stage `python:3.12-slim` + `uv` for Part 2 (no frontend build yet — the placeholder `backend/static/` is copied directly). Part 3 will add a `node:22-alpine` build stage that produces `frontend/out/` and replaces the static dir.
- [x] Create `docker-compose.yml` at repo root: one `app` service, build context `.`, ports `"8000:8000"`, `env_file: .env`, restart `unless-stopped`.
- [x] Create `.dockerignore` excluding `node_modules`, `.next`, `frontend/out`, `__pycache__`, `.venv`, `.git`, `docs/`, `terminals/`, `**/AGENTS.md`, `.env*` (except `.env.example`).
- [x] Create `.env.example` documenting required env vars; `.env` itself is gitignored and is auto-created by `start` scripts on first run.
- [x] Create scripts: `scripts/start.sh`, `scripts/stop.sh`, `scripts/start.ps1`, `scripts/stop.ps1`. Each `start` resolves the repo root from its own location, copies `.env.example` → `.env` if missing, runs `docker compose up -d --build`, then polls `/api/health` for 30 s. On timeout, dumps `app` logs.
- [x] Write `backend/AGENTS.md` describing module layout, config surface, run/test commands.
- [x] Write `scripts/AGENTS.md` describing scripts and usage.
- [x] Write backend tests:
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

- [x] Edit `frontend/next.config.ts` to set `output: "export"`, `images: { unoptimized: true }`, `trailingSlash: false`.
- [x] Verified pages/components are client-compatible: `npm run build` succeeds, prerenders only `/` and `/_not-found` as static, writes `frontend/out/index.html` referencing `/_next/static/chunks/*.{js,css}` and font assets.
- [x] Convert `Dockerfile` to multi-stage: `node:22-alpine` stage runs `npm ci && npm run build`, then `python:3.12-slim` runtime stage copies `--from=frontend /frontend/out` into `/app/static`. (Replaces the placeholder copy from Part 2.)
- [x] Keep `backend/static/index.html` as a local-dev fallback (used only when running uvicorn directly without Docker — STATIC_DIR defaults to `<backend>/static`). Documented in `backend/AGENTS.md`.
- [x] Add SPA fallback via a `SPAStaticFiles` subclass at `backend/app/static.py`: serves `index.html` for unknown extensionless paths, never overrides `/api/*` 404s, never swallows missing-asset 404s (paths with `.` extension still 404).
- [x] Add Playwright config for static export at `frontend/playwright.static.config.ts`: spawns `uv run uvicorn app.main:app --port 8000` with `STATIC_DIR=<repo>/frontend/out`, `baseURL=http://127.0.0.1:8000`, `workers: 1` (single backend process). Keep the existing `playwright.config.ts` for the dev-server flow. New `npm run test:e2e:static` script builds the export then runs Playwright.
- [x] Add `backend/tests/test_static_export.py`: builds a Next-shaped fixture (`index.html` referencing `/_next/static/chunks/main.js` + the asset), verifies root serves the indexed HTML, asset returns 200 with content, SPA fallback handles `/login` and `/projects/123/edit`, missing `_next` asset still 404s, `/api/does-not-exist` still 404s, `/api/health` still wins over the static mount.

### Tests / checks

- [x] `cd frontend && npm run build` succeeds and writes `frontend/out/index.html`.
- [x] `cd backend && uv run pytest` — 11/11 green, 96 % coverage on `app/`.
- [x] `cd frontend && npm run test:unit` — 6/6 green.
- [x] `cd frontend && npm run test:e2e:static` — 3/3 green against FastAPI serving `frontend/out/` (~3.5 s).
- [x] `cd frontend && npm run lint` — no warnings.
- Container rebuild: `scripts/start.sh` (or `.ps1`) → `http://localhost:8000/` loads the real Kanban board, all 5 columns render, fonts load, no 404s for `_next/*` assets. *(Pending user verification — Docker not present on the agent shell.)*
- `cd frontend && npm run test:e2e` against the dev server: not run by the agent (slow, untouched flow). *(Pending user verification if desired.)*

### Success criteria

- [x] Static export builds, is served by FastAPI, and the e2e suite passes against it.
- [x] No regressions in Vitest or backend pytest suites.
- [x] No build-time use of server-only Next.js features remains.
- Visual parity with `npm run dev` confirmed in the container. *(Pending user.)*

---

## Part 4 — Fake login (hardcoded user/password) with JWT session cookie

Hide the Kanban behind a login page. Unauthenticated visits to `/` redirect to `/login`. Credentials are hardcoded (`user` / `password`). On success, backend sets an httpOnly JWT cookie; frontend reads authenticated state by calling `GET /api/auth/me`. Logout clears the cookie.

### Substeps

- [ ] Backend:
  - [ ] `backend/app/auth.py` — helpers: `create_token(sub: str) -> str`, `decode_token(token: str) -> dict`, `get_current_user` dependency that reads the cookie, raises 401 if invalid/missing.
  - [ ] `backend/app/routes/auth.py`:
    - `POST /api/auth/login` body `{username, password}`; if hardcoded match, issue JWT, set cookie `session` (httpOnly, SameSite=Lax, Secure=False for local http, 7-day max-age), return `{username: "user"}`.
    - `POST /api/auth/logout` — clear cookie, return 204.
    - `GET /api/auth/me` — returns `{username}` if cookie valid, else 401.
  - [ ] Register `auth` router under `/api`.
  - [ ] Constant-time compare for credentials (`hmac.compare_digest`) so brute-force timing differences are avoided even for the hardcoded case.
- [ ] Frontend:
  - [ ] Add `src/app/login/page.tsx` — client component with a small centered form, brand styling (uses the same CSS vars), calls `POST /api/auth/login` with `credentials: "include"`, redirects to `/` on success, shows an inline error on 401.
  - [ ] Add `src/lib/api.ts` — thin typed `fetch` wrapper that always sends `credentials: "include"` and throws on non-2xx.
  - [ ] Add `src/lib/auth.ts` — `getCurrentUser()` wrapping `GET /api/auth/me`.
  - [ ] Edit `src/app/page.tsx`: turn into a small client component that checks auth on mount; if 401, `router.replace("/login")`; if ok, render `<KanbanBoard />`. (Keep export-compatible — no server-only code.)
  - [ ] Add a Logout button to `KanbanBoard` header; calls `POST /api/auth/logout` then redirects to `/login`.
  - [ ] Ensure `next.config.ts` still builds to static export with the new `/login` route.
- [ ] Tests:
  - [ ] Backend: `backend/tests/test_auth.py`:
    - login with correct creds → 200, sets cookie, body has username
    - login with wrong creds → 401
    - `me` without cookie → 401
    - `me` with valid cookie → 200
    - logout clears cookie (subsequent `me` → 401)
    - expired/tampered token → 401
  - [ ] Frontend unit: `src/app/login/page.test.tsx` — renders form, shows error on failed fetch (mock `fetch`), redirects on success.
  - [ ] Frontend unit: update `KanbanBoard.test.tsx` — presence of "Log out" button; clicking it calls the API (mock).
  - [ ] Playwright: `tests/auth.spec.ts` — visiting `/` unauthenticated redirects to `/login`; invalid creds show an error; valid creds reveal the board; logout returns to `/login`.

### Tests / checks

- All new and existing unit and e2e tests pass.
- Manual: cookie is httpOnly (not readable from `document.cookie`), SameSite=Lax, 7d expiry.

### Success criteria

- Unauthenticated `/` redirects to `/login`.
- `user`/`password` logs in; wrong creds show an error.
- Auth survives a page reload.
- Logout immediately bounces back to `/login`.

---

## Part 5 — Database schema proposal (JSON doc, then sign-off)

Propose the database schema, document it in `docs/schema.json` and `docs/db.md`, and get user approval before writing migrations. Schema must support multiple users, one board per user (MVP constraint), many columns, many cards, plus conversation history.

### Substeps

- [ ] Draft `docs/schema.json` — JSON document describing tables, columns, types, nullability, and foreign keys. Proposed tables:
  - `users(id TEXT PK, username TEXT UNIQUE, created_at TEXT)`
  - `boards(id TEXT PK, user_id TEXT FK→users.id UNIQUE, created_at TEXT)` — UNIQUE enforces one board per user for MVP.
  - `columns(id TEXT PK, board_id TEXT FK→boards.id, title TEXT, position INTEGER, created_at TEXT)` — `(board_id, position)` unique.
  - `cards(id TEXT PK, column_id TEXT FK→columns.id, title TEXT, details TEXT, position INTEGER, created_at TEXT, updated_at TEXT)` — `(column_id, position)` unique.
  - `conversations(id TEXT PK, user_id TEXT FK→users.id, created_at TEXT)`
  - `messages(id TEXT PK, conversation_id TEXT FK→conversations.id, role TEXT CHECK(role IN ('user','assistant','system')), content TEXT, created_at TEXT)`
- [ ] Write `docs/db.md` — narrative: why these tables, why `position INTEGER` (gapped values, re-normalized on write), why TEXT ids (uuid4 hex), how the one-board-per-user constraint is enforced, how we'll seed columns on first login.
- [ ] Present both files to the user for review.

### Tests / checks

- User reviews `docs/schema.json` and `docs/db.md` and approves.

### Success criteria

- Explicit user approval recorded in chat.
- Schema proposal is self-consistent (every FK target exists; positions have a clear ordering contract).

---

## Part 6 — Backend persistence + Kanban API

Implement the approved schema and the full REST API so the frontend (Part 7) can replace its in-memory state.

### Substeps

- [ ] `backend/app/db.py` — SQLAlchemy engine/session factory pointing at `settings.DB_PATH`. `init_db()` creates tables if missing and seeds the `user`/`password` user + their default board + 5 starter columns + demo cards (matches `frontend/src/lib/kanban.ts#initialData` so UX is unchanged).
- [ ] Call `init_db()` on app startup (lifespan).
- [ ] `backend/app/models.py` — SQLAlchemy models mirroring `docs/schema.json`.
- [ ] `backend/app/schemas.py` — Pydantic request/response models.
- [ ] `backend/app/services/board.py` — business logic for reads/writes, including position renormalization on move.
- [ ] `backend/app/routes/board.py`:
  - `GET /api/board` — returns current user's board in the exact shape the frontend uses (`{ columns: [{id,title,cardIds:[...]}], cards: {id: {id,title,details}} }`).
  - `PATCH /api/columns/{id}` body `{title}` — rename.
  - `POST /api/cards` body `{column_id, title, details}` — returns new card; server assigns id.
  - `PATCH /api/cards/{id}` body `{title?, details?, column_id?, position?}` — edit and/or move. Server re-packs positions in affected columns.
  - `DELETE /api/cards/{id}` — 204.
- [ ] All board routes depend on `get_current_user`; return 401 otherwise. Every query filters by `user_id` to prevent cross-user reads.
- [ ] Tests — `backend/tests/test_board.py` (every test logs in first to get a cookie):
  - `GET /api/board` shape matches frontend contract; fresh user gets seeded columns + demo cards.
  - Rename column persists.
  - Create card returns id; it appears in `GET /api/board`.
  - Move card within same column (middle → top) — other positions re-packed correctly.
  - Move card to another column at a specific position.
  - Move card to an empty column.
  - Delete card removes it; subsequent `GET /api/board` no longer references it.
  - 401 for every endpoint when not authenticated.
  - Cross-user isolation: user A cannot PATCH user B's card (404, not 403, to avoid leaking existence).
  - Invalid column_id / card_id → 404.
  - Position past end gets clamped to end of column.
- [ ] `backend/tests/test_db_init.py` — `init_db()` is idempotent; second call doesn't duplicate seed data.

### Tests / checks

- `uv run pytest -q` all green with ≥ 90% coverage on `app/services/board.py`.
- `curl` smoke: log in, GET board, PATCH a card, GET again → change reflected.

### Success criteria

- Every endpoint in the substep list behaves per spec.
- All tests pass.
- No cross-user data leakage is possible by construction.

---

## Part 7 — Frontend uses the real backend

Replace `useState(initialData)` with data loaded from `/api/board`. Every mutation (drag, rename, add, delete) hits the backend and updates local state from the response.

### Substeps

- [ ] Extend `src/lib/api.ts` with typed functions: `getBoard()`, `renameColumn(id, title)`, `createCard(columnId, title, details)`, `patchCard(id, patch)`, `deleteCard(id)`.
- [ ] Introduce `src/lib/useBoard.ts` hook:
  - Loads board on mount, exposes `{ board, loading, error, actions }`.
  - `actions` mirror current handlers in `KanbanBoard.tsx`, doing optimistic updates and rolling back on error.
  - For drag, compute the target `column_id` + `position` from the existing `moveCard` result, then PATCH.
- [ ] Refactor `KanbanBoard.tsx` to use `useBoard`. Keep the UI identical.
- [ ] Add a small skeleton loading state and a non-blocking error toast on failed mutations.
- [ ] Tests:
  - [ ] Backend integration: no changes (already covered in Part 6).
  - [ ] Frontend unit: `useBoard.test.tsx` — happy path (GET on mount), PATCH on card move (mocked fetch), optimistic rollback on 500.
  - [ ] Update `KanbanBoard.test.tsx` to mock `/api/board` response; assert initial render waits for data.
  - [ ] Playwright `tests/kanban.spec.ts` continues to pass against the static-export container. Add a new spec `tests/persistence.spec.ts` that: logs in, adds a card, reloads the page, asserts the card is still there, then deletes it and reloads to confirm removal.

### Tests / checks

- All Vitest + Playwright suites pass.
- Manual: open two browsers logged in as the same user, make a change in one, refresh the other, the change is there.

### Success criteria

- No call to `initialData` remains in production code paths (only in tests, if at all).
- Drag, rename, add, delete all round-trip through the API and survive reload.
- Optimistic updates feel instant; errors surface without losing the UI.

---

## Part 8 — OpenRouter connectivity (2+2 smoke test)

Wire up the backend to OpenRouter, using `openai/gpt-oss-120b`. Provide a simple endpoint and test to prove a call round-trips successfully.

### Substeps

- [ ] `backend/app/openrouter.py` — small async client built on `httpx.AsyncClient`:
  - Reads `OPENROUTER_API_KEY` from settings.
  - `chat(messages, response_format=None, model="openai/gpt-oss-120b") -> dict` — POSTs to `https://openrouter.ai/api/v1/chat/completions`, returns parsed JSON.
  - Raises a typed `OpenRouterError` on non-2xx.
- [ ] `backend/app/routes/ai.py`:
  - `POST /api/ai/ping` — protected by `get_current_user`. Body `{}`. Sends a single user message: "What is 2+2? Reply with just the number." Returns `{answer: <string>}`.
- [ ] Tests — `backend/tests/test_openrouter.py`:
  - Unit: stub `httpx.AsyncClient` with `respx` (add dev dep); assert request URL, auth header `Bearer <key>`, model, and that the response is parsed.
  - Unit: error path returns `OpenRouterError` on 500.
  - Live smoke test gated by env: `pytest -m live` runs `POST /api/ai/ping` against the real service and asserts the answer contains `"4"`. Skipped by default in CI if `OPENROUTER_API_KEY` is missing.

### Tests / checks

- `uv run pytest -q` passes (unit).
- `uv run pytest -q -m live` against real OpenRouter returns a response containing "4".
- `curl -X POST http://localhost:8000/api/ai/ping --cookie session=...` returns `{"answer":"4"}` (or similar).

### Success criteria

- A real request to `openai/gpt-oss-120b` via OpenRouter succeeds locally.
- API key is never logged; error messages do not leak secrets.

---

## Part 9 — AI chat with board context + Structured Outputs

Upgrade the AI endpoint to accept a user message plus conversation history, always send the full current board JSON as context, and require the model to reply with Structured Outputs: a message to the user plus an optional board update instruction. Persist the conversation in SQLite.

### Substeps

- [ ] Define the response JSON schema in `backend/app/ai_schema.py`:
  ```json
  {
    "type": "object",
    "additionalProperties": false,
    "required": ["reply"],
    "properties": {
      "reply": { "type": "string" },
      "board_update": {
        "type": ["object", "null"],
        "additionalProperties": false,
        "required": ["operations"],
        "properties": {
          "operations": {
            "type": "array",
            "items": {
              "oneOf": [
                { "type": "object", "required": ["op","column_id","title"], "properties": { "op": {"const":"rename_column"}, "column_id":{"type":"string"}, "title":{"type":"string"} } },
                { "type": "object", "required": ["op","column_id","title","details"], "properties": { "op": {"const":"create_card"}, "column_id":{"type":"string"}, "title":{"type":"string"}, "details":{"type":"string"} } },
                { "type": "object", "required": ["op","card_id"], "properties": { "op": {"const":"delete_card"}, "card_id":{"type":"string"} } },
                { "type": "object", "required": ["op","card_id"], "properties": { "op": {"const":"update_card"}, "card_id":{"type":"string"}, "title":{"type":"string"}, "details":{"type":"string"}, "column_id":{"type":"string"}, "position":{"type":"integer"} } }
              ]
            }
          }
        }
      }
    }
  }
  ```
- [ ] `backend/app/services/chat.py`:
  - `start_or_get_conversation(user_id)` — reuses the user's single conversation row.
  - `append_message(conversation_id, role, content)`.
  - `build_system_prompt(board)` — instructs the model to only propose operations it knows will help the user; always include current board JSON.
  - `apply_board_update(user_id, operations)` — reuses the Part-6 board service to execute each op in a transaction; validates that all `column_id`/`card_id` belong to this user; on any failure, rolls back and returns a structured error.
- [ ] `backend/app/routes/ai.py`:
  - `POST /api/chat` body `{message: string}`. Loads conversation history (capped at last N=30 messages), fetches board, calls OpenRouter with `response_format={"type":"json_schema", "json_schema": {...}}`. Persists the user and assistant messages. If the assistant returned `board_update`, applies it and returns `{reply, applied_ops, updated_board}`; else `{reply, applied_ops: []}`.
  - `GET /api/chat/history` — returns recent messages for the UI.
- [ ] Tests — `backend/tests/test_chat.py`:
  - Stub OpenRouter to return a response with no `board_update` → reply is stored, nothing changes.
  - Stub to return `rename_column` → column renamed in DB, `updated_board` matches reality.
  - Stub to return `create_card` + `update_card` in a single call → both applied atomically.
  - Stub to return an op referencing another user's card → rejected, DB unchanged, `applied_ops` empty, error reported in response but reply still stored.
  - Malformed JSON from the model (force unparsable) → 502 with a safe error message; conversation still records the user message.
  - History pagination / cap behaviour.
- [ ] One live smoke test (gated) that asks "Please add a card titled 'Test' to Backlog with details 'from chat'" and asserts the card appears.

### Tests / checks

- Unit tests green. Live smoke optional.
- Manually verify via `curl` that a chat call updates the board JSON returned by `GET /api/board`.

### Success criteria

- Every chat turn persists both messages.
- The model's structured output is strictly validated; unknown fields rejected.
- Board updates are transactional and user-scoped.
- Reply always comes back even if ops fail.

---

## Part 10 — AI chat sidebar UI with live board refresh

Add a polished chat sidebar to the Kanban page. User can send messages; assistant replies stream in (or appear on completion); whenever the response includes board updates, the Kanban refreshes automatically without a page reload.

### Substeps

- [ ] `src/components/ChatSidebar.tsx` — collapsible sidebar pinned to the right:
  - Header "AI Assistant", collapse toggle, color-scheme aligned (`--secondary-purple` submit, `--primary-blue` accents).
  - Message list (user right, assistant left), timestamp, simple auto-scroll to bottom.
  - Composer: textarea + Send button (disabled while pending).
  - Empty state with 2–3 sample prompts.
- [ ] `src/lib/chat.ts` — `sendMessage(text)` hits `POST /api/chat` and returns `{reply, applied_ops, updated_board}`. `getHistory()` hits `GET /api/chat/history`.
- [ ] `src/lib/useChat.ts` hook — manages messages state, pending flag, error. On success, if `updated_board` is present, calls the `useBoard` hook's `setBoard(updated_board)` (pass it in) so the UI refreshes without refetch.
- [ ] Wire `KanbanBoard.tsx` to render `<ChatSidebar />` next to the columns; pass a `setBoard` callback down.
- [ ] Responsive layout: sidebar collapses under ~1024 px and opens over the board as a drawer.
- [ ] Tests:
  - [ ] `ChatSidebar.test.tsx` (Vitest) — mocks `fetch`: send a message, assistant reply renders, when `updated_board` is in the response, `setBoard` prop is called with the new data.
  - [ ] Update `useBoard.test.tsx` — adding a capability to accept an externally-provided board snapshot.
  - [ ] Playwright `tests/chat.spec.ts`:
    - Log in, open chat, send "rename Backlog to Inbox", assistant reply appears and first column title updates without reload.
    - Send "add a card titled E2E to Inbox with details demo" → the new card appears in that column.
    - Both use a Playwright network route mock to pin the OpenRouter response shape (no live model calls in CI).

### Tests / checks

- All Vitest + Playwright suites pass.
- Manual: real-model chat ("move Refine status language to Review") updates the board within a few seconds.

### Success criteria

- Sidebar looks on-brand, is accessible by keyboard, and works on narrow screens.
- Board updates appear instantly after a chat response; a manual reload yields the same data (proving persistence).
- No regressions in Parts 2–9 test suites.
