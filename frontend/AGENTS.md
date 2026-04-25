# Frontend

Next.js 16 (App Router) + React 19 + Tailwind CSS v4. Static export served by FastAPI; cookie-based auth; in-memory board state (real persistence lands in Part 6/7).

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
- Playwright (dev) at `playwright.config.ts`, base URL `http://127.0.0.1:3000`, specs in `tests/`. Webserver command is `npm run dev -- --hostname 127.0.0.1 --port 3000` with `reuseExistingServer: true`.
- Playwright (static export) at `playwright.static.config.ts`, base URL `http://127.0.0.1:8000`, same specs in `tests/`. Webserver runs `uv run uvicorn app.main:app --port 8000` from `backend/` with `STATIC_DIR` pointed at `frontend/out`. Workers are pinned to 1 (single backend process). Run via `npm run test:e2e:static`.

## File layout

```
frontend/
  next.config.ts             output: "export", images.unoptimized, trailingSlash: false
  tsconfig.json              Path alias "@/*" -> "./src/*"
  eslint.config.mjs          next/core-web-vitals + next/typescript
  postcss.config.mjs         @tailwindcss/postcss
  playwright.config.ts       Chromium, dev server (port 3000)
  playwright.static.config.ts  Chromium, FastAPI serving frontend/out (port 8000), workers: 1
  vitest.config.ts           jsdom, src/** only
  public/                    Default Next.js SVGs (unused by app)
  src/
    app/
      layout.tsx             Root layout, loads Manrope + Space Grotesk
      page.tsx               "use client". Auth-gates the board (calls /api/auth/me, redirects to /login on 401), renders <KanbanBoard onLogout={...} />.
      page.test.tsx          Vitest: checking placeholder, board renders on 200, redirect on 401, logout calls API and redirects.
      globals.css            Tailwind v4 import + brand CSS vars (--primary-blue, --secondary-purple, --accent-yellow, --navy-dark, --gray-text, --surface, --surface-strong, --stroke, --shadow)
      favicon.ico
      login/
        page.tsx             "use client". Brand-styled sign-in form. Posts to /api/auth/login, redirects to / on success, shows inline error on 401/500.
        page.test.tsx        Vitest: form rendering, success → router.replace("/"), 401 → inline error, 500 → generic error.
    components/
      KanbanBoard.tsx        "use client". Optional `onLogout` prop renders header "Log out" button. Holds BoardData state, DndContext, DragOverlay, handlers for drag/rename/add/delete.
      KanbanColumn.tsx       useDroppable, SortableContext, embeds NewCardForm, inline-editable title.
      KanbanCard.tsx         useSortable card with delete button.
      KanbanCardPreview.tsx  Visual-only card used inside DragOverlay.
      NewCardForm.tsx        Toggleable inline form (title + details), trims and validates title.
      KanbanBoard.test.tsx   Vitest: renders 5 cols, rename col, add+remove card, logout button hidden by default + invoked on click.
    lib/
      api.ts                 apiFetch<T>(path, init) — fetch wrapper, credentials: "include", JSON body via init.json, throws ApiError on non-2xx.
      api.test.ts            Vitest: credentials, JSON body, 204 → null, ApiError with/without detail.
      auth.ts                login / logout / getCurrentUser thin wrappers on apiFetch.
      kanban.ts              Types (Card, Column, BoardData), demo initialData (5 cols, 8 cards), moveCard pure function, createId helper.
      kanban.test.ts         Vitest: reorder within col, move across cols, drop to empty col target.
    test/
      setup.ts               Imports @testing-library/jest-dom.
      vitest.d.ts            Triple-slash refs for vitest + jest-dom.
  tests/
    auth.spec.ts             Playwright: redirect, wrong creds, valid creds, reload survives session, logout, cookie httpOnly.
    kanban.spec.ts           Playwright: programmatic login in beforeEach, then load board / add card / drag card. Self-skips if backend isn't reachable.
```

## Domain model (`src/lib/kanban.ts`)

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

Board state is normalized: cards keyed by id in `cards`, column order + card order in `columns[].cardIds`. `moveCard(columns, activeId, overId)` returns new columns, handling same-column reorder, cross-column insert before a target card, and drop-onto-empty-column (appends).

## State model (today)

All board state lives in `useState` inside `KanbanBoard`. Seeded from `initialData`. Nothing is persisted — reload resets the board. IDs for new cards come from `createId("card")` (random + timestamp in base36). The auth state lives in `Home` (`src/app/page.tsx`) and is sourced from `GET /api/auth/me`.

## Auth (Part 4)

- `src/lib/api.ts#apiFetch` is the only place we call `fetch`. It always sends `credentials: "include"` so the httpOnly `session` cookie is carried, JSON-encodes `init.json`, returns parsed JSON / `null` for 204, and throws `ApiError(status, detail)` on non-2xx.
- `src/lib/auth.ts` exports `login(username, password)`, `logout()`, `getCurrentUser()`.
- `src/app/login/page.tsx` is a client component. On submit it calls `login()`; success → `router.replace("/")`; `ApiError(401)` → `"Invalid username or password."`; everything else → `"Sign-in failed. Please try again."` Errors are surfaced in `[data-testid="login-error"]`.
- `src/app/page.tsx` is a client component. On mount it calls `getCurrentUser()`. Until that resolves it renders a `[data-testid="auth-checking"]` placeholder. On `ApiError(401)` it `router.replace("/login")`; on success it renders `<KanbanBoard onLogout={handleLogout} />`. The logout handler calls `logout()` then `router.replace("/login")` (in a `try/finally` so we always bounce even if the network call fails).
- `KanbanBoard` accepts an optional `onLogout` prop; when provided, renders a `[data-testid="logout-button"]` "Log out" button in the header.

## Styling

- Tailwind v4 utility classes inline on elements.
- Brand tokens exposed as CSS vars in `:root` and surfaced to Tailwind via `@theme inline` (`--color-foreground`, `--color-background`, `--font-sans`).
- Arbitrary-value classes like `bg-[var(--surface-strong)]` and `ring-[var(--accent-yellow)]` are used throughout.

## Build output

`npm run build` writes a static export to `frontend/out/`. The interesting bits:
- `out/index.html` — prerendered shell with `<div id="__next">` and links to `/_next/static/chunks/*.{js,css}` plus font files under `/_next/static/media/`.
- `out/_next/static/...` — hashed JS, CSS, font, and media bundles.
- `out/404.html`, `out/_not-found.html`, `out/favicon.ico`, plus the public/* SVGs.

In production this directory is copied into the runtime image at `/app/static/` and served by FastAPI. Locally without Docker, run `STATIC_DIR=../frontend/out uv run uvicorn ...` from the backend folder (see `backend/AGENTS.md`).

## Playwright details

Two configs live side by side:

- `playwright.config.ts` (dev) — boots `npm run dev` on port 3000. Has no backend, so any spec that needs `/api/*` self-skips via `test.skip(login.status() !== 200, ...)` in its `beforeEach`. Use this only for component/style iteration.
- `playwright.static.config.ts` (production-like, **the primary E2E suite**) — runs `npm run build`, then boots `uvicorn` on port 8000 with `STATIC_DIR=frontend/out` and a fixed `SESSION_SECRET`, single worker, fresh server. Specs in `tests/auth.spec.ts` and `tests/kanban.spec.ts` use the real auth flow.

## Known gaps to close during integration

- No API client for the board itself. A typed set of `getBoard / patchCard / …` functions will be added on top of `apiFetch` in Part 7.
- Board state is still a monolithic `useState`. Part 7 introduces `useBoard()` that loads from `/api/board` and PATCHes mutations.
- Card ids are still client-generated. When the backend owns identity, new-card flow will POST and adopt the server-assigned id.
