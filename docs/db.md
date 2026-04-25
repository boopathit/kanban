# Database

This document explains **why** the schema in [`docs/schema.json`](./schema.json) is shaped the way it is. The JSON is the source of truth; this Markdown file is the prose. If they ever disagree, the JSON wins.

> Status: **approved 2026-04-25** — all five [open questions](#open-questions-for-sign-off) answered "as proposed". Part 6 implements `app/db.py`, `app/models.py`, and the seed against this contract.

## High-level shape

```
users 1 ──┬── 1 boards 1 ── N columns 1 ── N cards
          │
          └── 1 conversations 1 ── N messages
```

Six tables, all in one SQLite file at `settings.DB_PATH` (default `/app/data/pm.db` inside the container). Every relationship cascades on delete from the user down: removing a user removes everything they own.

## Engine

- **SQLite** (sync), accessed via SQLAlchemy 2.x. The MVP single container has no concurrent-writer requirement and SQLite handles all reads and writes for the seeded user comfortably.
- Two PRAGMAs are issued on every connection:
  - `PRAGMA foreign_keys = ON` — SQLite ships with FK enforcement off by default; without this, our cascade deletes are silently skipped.
  - `PRAGMA journal_mode = WAL` — better concurrency for the rare case of a chat write happening alongside a board read; safe to call repeatedly.

## Conventions (apply to every table)

- **Primary keys** are `TEXT`, holding a 32-char `uuid4().hex`. The application generates them; SQLite never auto-assigns. Reasons:
  - Stable identifiers we can ship to the client without leaking row counts.
  - Easy to mint a card id before the round-trip completes (useful for optimistic UI in Part 7) — though for the MVP we still wait for the server response.
  - No collisions across tables, which makes log lines and bug reports easier to read.
- **Timestamps** (`created_at`, `updated_at`) are `TEXT`, ISO-8601 UTC, second precision, trailing `Z` (e.g. `2026-04-25T12:34:56Z`). The application supplies them. We do not use SQLite's `DATETIME('now')` so that wall-clock control lives entirely in app code (easier to test).
- **Booleans** are not used in this schema. If we need one later it will be `INTEGER` with a CHECK to `0` or `1`.
- **Nullability**: nothing is nullable except where explicitly noted (and there is currently nothing). Empty strings (`details = ''`) are how we represent "unset" for free-form text.
- **Hard deletes**, no tombstones, no `is_deleted` columns. The MVP doesn't need recovery; ON DELETE CASCADE handles everything.

## Per-table notes

### `users`

The MVP authenticates against hardcoded credentials in `app/auth.py`, but the JWT `sub` claim still needs to map to a row. `init_db()` seeds one row with `username = 'user'`; `get_current_user()` looks it up by that string when board/AI handlers need a `user_id`.

We deliberately **do not** store passwords here. If we ever switch on real auth we will add `password_hash TEXT` and write a migration; doing it now would create a column the MVP can't fill meaningfully.

### `boards`

`UNIQUE(user_id)` enforces the "one board per user" MVP constraint at the DB level. If we relax that later, we'll drop the UNIQUE and add a `title` column.

There is no `title` column today because the only board is implicitly named after the workspace ("Kanban Studio") in the page header.

### `columns`

- `position` is `INTEGER`, contiguous `0..N-1` per board. Read with `ORDER BY position WHERE board_id = ?`.
- A column rename is a single `UPDATE columns SET title = ? WHERE id = ? AND board_id = ?` (the `board_id` predicate is a defense-in-depth check enforced at the service layer in Part 6).

### `cards`

- `position` is `INTEGER`, contiguous `0..N-1` per **column** (not per board).
- `details` is plain text. We use empty string `''` when the user doesn't supply details — keeps reads `NOT NULL`-clean.
- `updated_at` is set by the service on every PATCH (title/details/move). Useful for:
  1. surfacing "most recently changed" in future UI,
  2. giving the AI chat in Part 9 a deterministic recency signal when summarising context.

### `conversations`

`UNIQUE(user_id)` enforces the "one rolling conversation per user" decision (PLAN.md locked-in #6 plus Part 9's `start_or_get_conversation`). Created lazily on the first chat turn so users who never use the AI sidebar carry no conversation row at all.

### `messages`

Append-only. The role CHECK constraint (`role IN ('user','assistant','system')`) catches typos at insert time. We store the assistant's `reply` field, **not** the full Structured Output JSON envelope; the `board_update` operations are applied immediately and don't need to be re-played from history.

## Position handling

Two viable strategies for ordering within a column:

| Strategy | Pros | Cons |
|----------|------|------|
| **A — Contiguous re-pack** (chosen) | Trivial to read (`ORDER BY position`); positions stay small and human-readable. | Every move rewrites every card in the affected column(s). |
| **B — Gapped / fractional** (e.g. 1024, 2048, …) | Most moves touch only the moved row; renormalize lazily when gaps shrink. | More machinery (gap-management code, periodic renormalize); harder to debug; harder for the AI in Part 9 to reason about. |

For an MVP with one user and small boards (tens of cards per column), **strategy A is the right call**: the cost of a re-pack is bounded by the column size, which is tiny, and the simpler invariant ("positions are 0..N-1") makes service code and tests dramatically clearer. If we ever observe contention we can move to B without changing the wire contract — `position` stays `INTEGER` either way.

### Why `position` is **not** UNIQUE

PLAN.md originally proposed `UNIQUE(column_id, position)`. This proposal **omits the UNIQUE** for the MVP because:

- During a re-pack, you must update multiple rows whose `position` values rotate (e.g. shifting `[A=0, B=1, C=2]` to `[B=0, A=1, C=2]`). With a UNIQUE constraint and no deferred-constraint mechanic, the first `UPDATE B SET position = 0` collides with `A`'s existing `0`. Working around this requires either a "shift everything by +N" two-pass trick or temporary negative positions — both correct, but more code and more risk.
- The MVP service layer is the only writer. There is no other process that could violate the invariant.
- We still index `(column_id, position)` (non-unique) so reads stay O(N).

We will reconsider adding the UNIQUE if we ever see duplicate-position bugs in practice; doing so will require switching to the shift-by-N renumbering pattern in `services/board.py`.

## Indexes (summary)

| Index | Columns | Unique | Why |
|-------|---------|--------|-----|
| `ix_users_username` | `username` | yes | Lookup by username (auth seed). |
| `ix_boards_user_id` | `user_id` | yes | Enforces one-board-per-user; lookup by user. |
| `ix_columns_board_position` | `board_id, position` | no | Read pattern: ordered fetch of all columns for a board. |
| `ix_cards_column_position` | `column_id, position` | no | Read pattern: ordered fetch of all cards for a column. |
| `ix_conversations_user_id` | `user_id` | yes | Enforces one-conversation-per-user; lookup by user. |
| `ix_messages_conv_created` | `conversation_id, created_at` | no | Recent-N retrieval for chat history. |

Primary-key indexes are implicit and not listed.

## Seed strategy

`app.db.init_db()` runs on FastAPI startup (`lifespan`) and is **idempotent**:

1. Open a session.
2. If `SELECT 1 FROM users WHERE username = 'user'` returns a row, return — nothing else to do.
3. Otherwise, in a single transaction, insert:
   - one `users` row (username `'user'`),
   - one `boards` row,
   - five `columns` rows matching `frontend/src/lib/kanban.ts#initialData` titles and order,
   - eight `cards` rows matching the demo content (preserving the per-column ordering shown in the JSON `seed.rows.cards` array).

Demo content is kept identical to the in-memory `initialData` so Part 7 can swap the frontend's `useState(initialData)` for `useBoard()` without users noticing any visual change.

The container DB lives at `/app/data/pm.db` and is **ephemeral** (no bind mount in `docker-compose.yml`); restart with `scripts/start.*` reseeds.

## What the API returns

Every board read returns the shape that the existing frontend already consumes — see `wire_contract` in `schema.json`. The mapping is:

```
GET /api/board (Part 6)
{
  "columns": [
    { "id": columns.id, "title": columns.title, "cardIds": [cards.id, ...] }   # ordered by columns.position, then cards.position
  ],
  "cards": {
    cards.id: { "id": cards.id, "title": cards.title, "details": cards.details }
  }
}
```

This is intentionally lossy on the wire (no positions, no timestamps, no `column_id` on cards) — the client doesn't need any of that, and reconstructing from `columns[].cardIds` is unambiguous. PATCH endpoints take a `column_id` + `position` directly, so the missing fields aren't a round-trip problem.

## Open questions for sign-off

1. **`UNIQUE(column_id, position)` deviation** — happy to omit, or do you want the constraint with the gap-shift renumbering? (See [Why `position` is not UNIQUE](#why-position-is-not-unique).)
2. **Cascade on user delete** — confirm we want everything (board, columns, cards, conversation, messages) to vanish with the user. Alternative: deny user deletion while children exist.
3. **Demo seed identical to current UI** — confirm the eight demo cards should match `initialData` verbatim. Alternative: seed an empty board and let the user add their own cards.
4. **Conversation-per-user** — keep `UNIQUE(conversations.user_id)` for one rolling conversation, or allow multiple (one per session / topic) from day one?
5. **Timestamps as TEXT** — fine, or prefer `INTEGER` UNIX epoch ms for ordering performance? (TEXT ISO sorts correctly with `ORDER BY` and is human-readable in the SQLite shell.)

If the answer to all five is "as proposed", I'll proceed straight into Part 6.
