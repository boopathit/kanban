# Frontend

Next.js 16 (App Router) + React 19 + Tailwind CSS v4. Static export served by FastAPI; cookie-based auth; board state lives in SQLite via `/api/board`, and Part 10 adds a chat sidebar that applies `updated_board` snapshots from `/api/chat`.

## Tech stack

- `next@16.1.6` (App Router) — client-side only, no Server Components or Server Actions in use
- `react@19.2.3`, `react-dom@19.2.3`
- `tailwindcss@4` via `@tailwindcss/postcss` (new `@import "tailwindcss";` syntax in `globals.css`)
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` for drag-and-drop
- `clsx` for conditional classes
- Fonts: `Manrope` (body), `Space_Grotesk` (display) via `next/font/google`

## Scripts (`package.json`)

- `dev` — `next dev`
- `build` — `next build` (configured for **static export**, writes to `frontend/out/`)
- `start` — `next start` (unused once static export is the deploy mode)
- `lint` — `eslint`
- `test` / `test:unit` — Vitest (single run)
- `test:unit:watch` — Vitest watch mode
- `test:e2e` — Playwright against `next dev` (uses `playwright.config.ts`)
- `test:e2e:static` — `npm run build` then Playwright against FastAPI serving `frontend/out/` (uses `playwright.static.config.ts`); spawns `uv run uvicorn` with `STATIC_DIR=<repo>/frontend/out`
- `test:all` — unit then e2e (dev)

## Testing

- Vitest + `@testing-library/react` + `@testing-library/user-event`, jsdom environment, globals enabled. Setup at `src/test/setup.ts` (imports `@testing-library/jest-dom`). Config at `vitest.config.ts` — picks up `src/**/*.{test,spec}.{ts,tsx}`, excludes `tests/`.
- Playwright (dev) at `playwright.config.ts`, base URL `http://127.0.0.1:3000`, specs in `tests/`. Webserver command is `npm run dev -- --hostname 127.0.0.1 --port 3000` with `reuseExistingServer: true`. Specs that need `/api/*` (everything except a small subset) self-skip when the API is unreachable; `auth.spec.ts` is best run via the static config.
- Playwright (static export, **the primary E2E suite**) at `playwright.static.config.ts`, base URL `http://127.0.0.1:8000`, same specs in `tests/`. Webserver runs `uv run uvicorn app.main:app --port 8000` from `backend/` with `STATIC_DIR` pointed at `frontend/out`. Workers pinned to 1 (single backend process). `DB_PATH` is stamped with `pm-e2e-${Date.now()}.db` so every run starts from a freshly seeded database. Run via `npm run test:e2e:static`.

## File layout

```
frontend/
  next.config.ts             output: "export", images.unoptimized, trailingSlash: false
  tsconfig.json              Path alias "@/*" -> "./src/*"
  eslint.config.mjs          next/core-web-vitals + next/typescript
  postcss.config.mjs         @tailwindcss/postcss
  playwright.config.ts       Chromium, dev server (port 3000)
  playwright.static.config.ts  Chromium, FastAPI serving frontend/out (port 8000), workers: 1, fresh DB per run
  vitest.config.ts           jsdom, src/** only
  public/                    Default Next.js SVGs (unused by app)
  src/
    app/
      layout.tsx             Root layout, loads Manrope + Space Grotesk
      page.tsx               "use client". Auth-gates the board, then wires `useBoard()` and feeds board + actions + `setBoard` into <KanbanBoard>.
      page.test.tsx          Vitest: checking placeholder, board renders on auth+board success, redirect on 401, logout calls API and redirects.
      globals.css            Tailwind v4 import + brand CSS vars
      favicon.ico
      login/
        page.tsx             "use client". Sign-in form. Posts to /api/auth/login.
        page.test.tsx        Vitest: form rendering, success/error redirects.
    components/
      KanbanBoard.tsx        "use client". **Presentational** — props: { board, loading, error, onDismissError, setBoard, actions, onLogout? }. Renders board + DragOverlay + Toast + ChatSidebar.
      ChatSidebar.tsx        "use client". Right-panel chat (desktop) + drawer (mobile). Uses useChat, shows message bubbles, suggestions, composer, and applies `updated_board` via prop callback.
      ChatSidebar.test.tsx   Vitest: send flow, assistant render, updated_board callback, op_error dismiss.
      KanbanColumn.tsx       useDroppable, SortableContext, embeds NewCardForm. Carries [data-column-title] for stable e2e selectors (column ids are server UUIDs now).
      KanbanCard.tsx         useSortable card with delete button.
      KanbanCardPreview.tsx  Visual-only card used inside DragOverlay.
      NewCardForm.tsx        Toggleable inline form (title + details), trims and validates title.
      Toast.tsx              role="status" toast, [data-testid="board-error-toast"], "Dismiss notification" button.
      KanbanBoard.test.tsx   Vitest: loading placeholder, column count, rename/create/delete callbacks, error toast + dismiss, logout visibility/click.
    lib/
      api.ts                 apiFetch<T>(path, init) — fetch wrapper, credentials: "include", JSON body via init.json, throws ApiError on non-2xx.
      api.test.ts            Vitest: credentials, JSON body, 204 → null, ApiError with/without detail.
      auth.ts                login / logout / getCurrentUser thin wrappers on apiFetch.
      board.ts               Typed board API: getBoard / renameColumn / createCard / patchCard / deleteCard. Encodes ids; only sends supplied PATCH fields.
      board.test.ts          Vitest: URL/method/body shape per verb, URL-encoded ids, 204 on delete.
      useBoard.ts            React hook owning BoardData. Exposes { board, loading, error, dismissError, reload, setBoard, actions }.
      useBoard.test.tsx      Vitest: load happy/error, optimistic flows, rollbacks, and external `setBoard` snapshot injection.
      chat.ts                Typed chat API client: `getHistory()` + `sendMessage()`.
      useChat.ts             Chat hook: history load, pending/error state, send + assistant append, `updated_board` application through injected callback.
      kanban.ts              Types (Card, Column, BoardData), demo initialData (still exported for tests/storybook fixtures), createId helper. **Not imported by the rendered page.**
      kanban.test.ts         Vitest: pure moveCard reordering helpers (still used as a reference; useBoard re-derives target column/index inline).
    test/
      setup.ts               Imports @testing-library/jest-dom.
      vitest.d.ts            Triple-slash refs for vitest + jest-dom.
  tests/
    auth.spec.ts             Playwright: redirect, wrong creds, valid creds, reload survives session, logout, cookie httpOnly. Asserts `[data-testid="logout-button"]` (stable post-board-load signal) instead of substring-matching the heading.
    kanban.spec.ts           Playwright: programmatic login, then load board / add card / drag card. Selectors use `[data-column-title]` and visible card text.
    persistence.spec.ts      Playwright: add card → reload → still there → delete (API verification) → reload → gone; rename column → reload → name persists.
    chat.spec.ts             Playwright: mocked `/api/chat*` validates rename + card-create updates without page reload.
```

## Domain model (`src/lib/kanban.ts`)

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

Board state is normalized: cards keyed by id in `cards`, column order + card order in `columns[].cardIds`. The wire format (see `docs/schema.json` and `backend/app/schemas.py#BoardResponse`) is identical — `getBoard()` returns this exact shape and the UI consumes it byte-for-byte.

## State model (today, post-Part 10)

`useBoard()` (`src/lib/useBoard.ts`) is the single source of truth for board state. It:

- Calls `GET /api/board` on mount, sets `loading=false` when the response lands (or sets `error` from the body).
- Snapshots state before each mutation. On failure it snaps back **and** sets `error` to a friendly message (`ApiError.detail` if present).
- Exposes `actions: { renameColumn, createCard, moveCard, deleteCard }`:
  - `createCard` is **pessimistic** (POST first, then mutate state with the server-assigned id) so we never have a phantom client id that drag/delete might later target.
  - `moveCard` and `deleteCard` are **optimistic**: mutate the local board first, PATCH/DELETE in the background, restore on failure.
  - `renameColumn` updates the title locally on every keystroke and **debounces** the PATCH by 350 ms; one PATCH per quiescent edit.
- Returns `dismissError()`, `reload()`, and `setBoard(nextBoard)` for external snapshot updates.

`useChat()` (`src/lib/useChat.ts`) owns chat UI state (history, pending, local optimistic user messages, assistant replies). On each successful send, if `/api/chat` returns `updated_board`, it calls the injected `setBoard` callback so the Kanban updates immediately without refetch/reload.

Auth state still lives in `Home` (`src/app/page.tsx`) and is sourced from `GET /api/auth/me`. The board only renders once auth resolves to "authed".

## Auth (Part 4)

- `src/lib/api.ts#apiFetch` is the only place we call `fetch`. It always sends `credentials: "include"` so the httpOnly `session` cookie is carried, JSON-encodes `init.json`, returns parsed JSON / `null` for 204, and throws `ApiError(status, detail)` on non-2xx.
- `src/lib/auth.ts` exports `login(username, password)`, `logout()`, `getCurrentUser()`.
- `src/app/login/page.tsx` is a client component. On submit it calls `login()`; success → `router.replace("/")`; `ApiError(401)` → `"Invalid username or password."`; everything else → `"Sign-in failed. Please try again."` Errors are surfaced in `[data-testid="login-error"]`.
- `src/app/page.tsx` is a client component. On mount it calls `getCurrentUser()`. Until that resolves it renders a `[data-testid="auth-checking"]` placeholder. On `ApiError(401)` it `router.replace("/login")`; on success it renders `<KanbanBoard …>` wired to `useBoard()`. The logout handler calls `logout()` then `router.replace("/login")` (in a `try/finally` so we always bounce even if the network call fails).

## Board API client (Part 7)

- `src/lib/board.ts`:
  - `getBoard()` → `BoardData`
  - `renameColumn(columnId, title)` → 200 column summary
  - `createCard(columnId, title, details)` → 201 `CardSummary`
  - `patchCard(cardId, { title?, details?, column_id?, position? })` → 200 `CardSummary`
  - `deleteCard(cardId)` → null on 204
- All calls go through `apiFetch`, so they automatically carry the session cookie and surface `ApiError` on non-2xx.

## Styling

- Tailwind v4 utility classes inline on elements.
- Brand tokens exposed as CSS vars in `:root` and surfaced to Tailwind via `@theme inline`.
- The error toast is a fixed-position element at `bottom-6 right-6`, soft red on `error`.

## Build output

`npm run build` writes a static export to `frontend/out/`. The interesting bits:
- `out/index.html` — prerendered shell with `<div id="__next">` and links to `/_next/static/chunks/*.{js,css}` plus font files under `/_next/static/media/`.
- `out/_next/static/...` — hashed JS, CSS, font, and media bundles.
- `out/404.html`, `out/_not-found.html`, `out/login.html`, `out/favicon.ico`, plus the public/* SVGs.

In production this directory is copied into the runtime image at `/app/static/` and served by FastAPI. Locally without Docker, run `STATIC_DIR=../frontend/out uv run uvicorn ...` from the backend folder (see `backend/AGENTS.md`).

## Playwright details

Two configs live side by side:

- `playwright.config.ts` (dev) — boots `npm run dev` on port 3000. Has no backend, so any spec that needs `/api/*` self-skips via `test.skip(login.status() !== 200, ...)` in its `beforeEach`. Use this only for component/style iteration; `auth.spec.ts` does not skip and will fail here.
- `playwright.static.config.ts` (production-like, **the primary E2E suite**) — runs `npm run build`, then boots `uvicorn` on port 8000 with `STATIC_DIR=frontend/out`, a fixed `SESSION_SECRET`, and `DB_PATH` stamped per run (so every test session starts from a fresh seeded DB). Specs use the real auth flow.
- `tests/chat.spec.ts` mocks `/api/chat/history` + `/api/chat` so CI stays deterministic and does not call live LLMs while still verifying live board refresh behavior.
