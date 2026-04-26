/**
 * useBoard — owns the live BoardData, talks to the FastAPI backend, and
 * exposes optimistic mutators that roll back on failure.
 *
 * The contract for callers (KanbanBoard / Home page) is:
 *
 *   const { board, loading, error, dismissError, actions } = useBoard();
 *
 * `board` is `null` while `loading` is true. Once loaded, every action
 * mutates local state immediately and PATCH/POST/DELETEs in the
 * background. On a failed call the previous snapshot is restored and
 * `error` is set so the UI can show a toast.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCard as apiCreateCard,
  deleteCard as apiDeleteCard,
  getBoard,
  patchCard as apiPatchCard,
  renameColumn as apiRenameColumn,
} from "@/lib/board";
import type { BoardData, Card } from "@/lib/kanban";

export type BoardActions = {
  renameColumn: (columnId: string, title: string) => Promise<void>;
  createCard: (
    columnId: string,
    title: string,
    details: string
  ) => Promise<void>;
  moveCard: (
    cardId: string,
    targetColumnId: string,
    targetIndex: number
  ) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
};

export type UseBoardResult = {
  board: BoardData | null;
  loading: boolean;
  error: string | null;
  dismissError: () => void;
  reload: () => Promise<void>;
  setBoard: (next: BoardData) => void;
  actions: BoardActions;
};

const RENAME_DEBOUNCE_MS = 350;

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live ref so async tasks see the latest board without re-binding callbacks.
  const boardRef = useRef<BoardData | null>(null);
  boardRef.current = board;

  const renameTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const failWith = useCallback((message: string, snapshot: BoardData) => {
    setBoard(snapshot);
    setError(message);
  }, []);

  const dismissError = useCallback(() => setError(null), []);
  const setBoardSnapshot = useCallback((next: BoardData) => {
    setBoard(next);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await getBoard();
      setBoard(fresh);
      setError(null);
    } catch (err) {
      setError(messageFor(err, "Could not load the board."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timers = renameTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [reload]);

  const renameColumn = useCallback<BoardActions["renameColumn"]>(
    async (columnId, title) => {
      const snapshot = boardRef.current;
      if (!snapshot) return;
      const next: BoardData = {
        ...snapshot,
        columns: snapshot.columns.map((c) =>
          c.id === columnId ? { ...c, title } : c
        ),
      };
      setBoard(next);

      const timers = renameTimers.current;
      const existing = timers.get(columnId);
      if (existing) clearTimeout(existing);

      // Debounce so a flurry of keystrokes only produces one PATCH.
      const handle = setTimeout(() => {
        timers.delete(columnId);
        const trimmed = title.trim();
        if (!trimmed) {
          failWith("Column title cannot be empty.", snapshot);
          return;
        }
        apiRenameColumn(columnId, trimmed).catch((err) => {
          failWith(messageFor(err, "Could not rename the column."), snapshot);
        });
      }, RENAME_DEBOUNCE_MS);
      timers.set(columnId, handle);
    },
    [failWith]
  );

  const createCard = useCallback<BoardActions["createCard"]>(
    async (columnId, title, details) => {
      const snapshot = boardRef.current;
      if (!snapshot) return;
      const trimmed = title.trim();
      if (!trimmed) {
        setError("Card title cannot be empty.");
        return;
      }
      try {
        const created = await apiCreateCard(columnId, trimmed, details.trim());
        const live = boardRef.current ?? snapshot;
        const nextCards: Record<string, Card> = {
          ...live.cards,
          [created.id]: created,
        };
        const nextColumns = live.columns.map((c) =>
          c.id === columnId ? { ...c, cardIds: [...c.cardIds, created.id] } : c
        );
        setBoard({ ...live, cards: nextCards, columns: nextColumns });
      } catch (err) {
        failWith(messageFor(err, "Could not create the card."), snapshot);
      }
    },
    [failWith]
  );

  const moveCard = useCallback<BoardActions["moveCard"]>(
    async (cardId, targetColumnId, targetIndex) => {
      const snapshot = boardRef.current;
      if (!snapshot) return;
      const sourceColumn = snapshot.columns.find((c) =>
        c.cardIds.includes(cardId)
      );
      if (!sourceColumn) return;
      const targetColumn = snapshot.columns.find(
        (c) => c.id === targetColumnId
      );
      if (!targetColumn) return;

      const sameColumn = sourceColumn.id === targetColumn.id;
      const sourceWithoutCard = sourceColumn.cardIds.filter(
        (id) => id !== cardId
      );
      const targetExisting = sameColumn
        ? sourceWithoutCard
        : [...targetColumn.cardIds];
      const insertIndex = Math.max(
        0,
        Math.min(targetIndex, targetExisting.length)
      );
      const nextTargetIds = [...targetExisting];
      nextTargetIds.splice(insertIndex, 0, cardId);

      const next: BoardData = {
        ...snapshot,
        columns: snapshot.columns.map((c) => {
          if (sameColumn && c.id === sourceColumn.id) {
            return { ...c, cardIds: nextTargetIds };
          }
          if (c.id === sourceColumn.id) {
            return { ...c, cardIds: sourceWithoutCard };
          }
          if (c.id === targetColumn.id) {
            return { ...c, cardIds: nextTargetIds };
          }
          return c;
        }),
      };
      setBoard(next);

      try {
        await apiPatchCard(cardId, {
          column_id: targetColumnId,
          position: insertIndex,
        });
      } catch (err) {
        failWith(messageFor(err, "Could not move the card."), snapshot);
      }
    },
    [failWith]
  );

  const deleteCard = useCallback<BoardActions["deleteCard"]>(
    async (cardId) => {
      const snapshot = boardRef.current;
      if (!snapshot) return;

      const nextCards = Object.fromEntries(
        Object.entries(snapshot.cards).filter(([id]) => id !== cardId)
      );
      const nextColumns = snapshot.columns.map((c) => ({
        ...c,
        cardIds: c.cardIds.filter((id) => id !== cardId),
      }));
      setBoard({ ...snapshot, cards: nextCards, columns: nextColumns });

      try {
        await apiDeleteCard(cardId);
      } catch (err) {
        failWith(messageFor(err, "Could not delete the card."), snapshot);
      }
    },
    [failWith]
  );

  return {
    board,
    loading,
    error,
    dismissError,
    reload,
    setBoard: setBoardSnapshot,
    actions: { renameColumn, createCard, moveCard, deleteCard },
  };
}

function messageFor(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "detail" in err) {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
