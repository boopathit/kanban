# Frontend

Next.js 16 (App Router) + React 19 + Tailwind CSS v4 demo of the Kanban board. Currently frontend-only with in-memory state; no backend wiring, no auth, no persistence.

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
      page.tsx               Renders <KanbanBoard />
      globals.css            Tailwind v4 import + brand CSS vars (--primary-blue, --secondary-purple, --accent-yellow, --navy-dark, --gray-text, --surface, --surface-strong, --stroke, --shadow)
      favicon.ico
    components/
      KanbanBoard.tsx        "use client". Holds BoardData state, DndContext, DragOverlay, handlers for drag/rename/add/delete.
      KanbanColumn.tsx       useDroppable, SortableContext, embeds NewCardForm, inline-editable title.
      KanbanCard.tsx         useSortable card with delete button.
      KanbanCardPreview.tsx  Visual-only card used inside DragOverlay.
      NewCardForm.tsx        Toggleable inline form (title + details), trims and validates title.
      KanbanBoard.test.tsx   Vitest: renders 5 cols, rename col, add+remove card.
    lib/
      kanban.ts              Types (Card, Column, BoardData), demo initialData (5 cols, 8 cards), moveCard pure function, createId helper.
      kanban.test.ts         Vitest: reorder within col, move across cols, drop to empty col target.
    test/
      setup.ts               Imports @testing-library/jest-dom.
      vitest.d.ts            Triple-slash refs for vitest + jest-dom.
  tests/
    kanban.spec.ts           Playwright: load board, add card, drag card across columns.
```

## Domain model (`src/lib/kanban.ts`)

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

Board state is normalized: cards keyed by id in `cards`, column order + card order in `columns[].cardIds`. `moveCard(columns, activeId, overId)` returns new columns, handling same-column reorder, cross-column insert before a target card, and drop-onto-empty-column (appends).

## State model (today)

All state lives in `useState` inside `KanbanBoard`. Seeded from `initialData`. Nothing is persisted — reload resets the board. IDs for new cards come from `createId("card")` (random + timestamp in base36).

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

## Known gaps to close during integration

- No routing beyond `/`. Login page at `/login` will be added in Part 4 (static export supports this via a page directory, no dynamic params needed).
- No API client. A small `src/lib/api.ts` will be added in Part 7 for typed `fetch` calls to `/api/*`.
- Board state is monolithic `useState`. It will likely be moved behind a hook (e.g. `useBoard`) that loads from and PATCHes to the backend.
- Card ids are client-generated. When the backend owns identity, new-card flow will POST and adopt the server-assigned id.
