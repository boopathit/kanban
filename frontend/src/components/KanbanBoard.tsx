"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type DragOverEvent,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragCancelEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Toast } from "@/components/Toast";
import type { BoardData } from "@/lib/kanban";
import type { BoardActions } from "@/lib/useBoard";

type KanbanBoardProps = {
  board: BoardData | null;
  loading: boolean;
  error?: string | null;
  onDismissError?: () => void;
  setBoard: (board: BoardData) => void;
  actions: BoardActions;
  onLogout?: () => void | Promise<void>;
};

export const KanbanBoard = ({
  board,
  loading,
  error,
  onDismissError,
  setBoard,
  actions,
  onLogout,
}: KanbanBoardProps) => {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [previewBoard, setPreviewBoard] = useState<BoardData | null>(null);
  const dragOverRafRef = useRef<number | null>(null);
  const dragOverPendingRef = useRef<DragOverEvent | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const displayBoard = previewBoard ?? board;
  const displayBoardRef = useRef<BoardData | null>(displayBoard);
  useEffect(() => {
    displayBoardRef.current = displayBoard;
  }, [displayBoard]);

  const cardsById = useMemo(() => displayBoard?.cards ?? {}, [displayBoard?.cards]);
  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      // Prefer pointer-based hit-testing so the entire droppable area of each
      // column responds, not only positions close to card corners.
      const pointerHits = pointerWithin(args);
      if (pointerHits.length > 0) return pointerHits;
      return rectIntersection(args);
    },
    []
  );

  const flushDragOverRaf = useCallback(() => {
    if (dragOverRafRef.current != null) {
      cancelAnimationFrame(dragOverRafRef.current);
      dragOverRafRef.current = null;
    }
    dragOverPendingRef.current = null;
  }, []);

  useEffect(() => flushDragOverRaf, [flushDragOverRaf]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
    setPreviewBoard(null);
  };

  const handleDragOver = useCallback((event: DragOverEvent) => {
    dragOverPendingRef.current = event;
    if (dragOverRafRef.current != null) return;
    dragOverRafRef.current = requestAnimationFrame(() => {
      dragOverRafRef.current = null;
      const pending = dragOverPendingRef.current;
      dragOverPendingRef.current = null;
      if (!pending) return;

      const liveBoard = displayBoardRef.current;
      if (!liveBoard) {
        setDropColumnId(null);
        setPreviewBoard(null);
        return;
      }
      if (!pending.over) {
        // Keep the last valid preview target; dnd-kit can briefly report no
        // collision while crossing gaps between children.
        return;
      }

      const target = resolveDropTarget(
        liveBoard,
        pending.active.id as string,
        pending.over.id as string
      );
      setDropColumnId(target?.columnId ?? null);
      if (!target) {
        setPreviewBoard(null);
        return;
      }
      startTransition(() => {
        setPreviewBoard(applyPreviewMove(liveBoard, pending.active.id as string, target));
      });
    });
  }, []);

  const handleDragCancel = (_event: DragCancelEvent) => {
    flushDragOverRaf();
    setActiveCardId(null);
    setDropColumnId(null);
    setPreviewBoard(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    flushDragOverRaf();
    const { active, over } = event;
    setActiveCardId(null);
    setDropColumnId(null);
    const baseBoard = board;
    setPreviewBoard(null);

    if (!baseBoard) {
      return;
    }

    const activeId = active.id as string;

    if (previewBoard) {
      const before = findCardLocation(baseBoard, activeId);
      const after = findCardLocation(previewBoard, activeId);
      if (after && (!before || before.columnId !== after.columnId || before.index !== after.index)) {
        void actions.moveCard(activeId, after.columnId, after.index);
        return;
      }
    }

    if (!over) {
      return;
    }

    const nextBoard = previewBoard ?? baseBoard;
    const overId = over.id as string;

    if (active.id === over.id) {
      return;
    }

    const target = resolveDropTarget(nextBoard, activeId, overId);
    if (!target) return;

    void actions.moveCard(activeId, target.columnId, target.index);
  };

  if (loading || !displayBoard) {
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        data-testid="board-loading"
      >
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-[var(--gray-text)]">
          Loading board...
        </p>
      </main>
    );
  }

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
              {onLogout ? (
                <button
                  type="button"
                  onClick={() => {
                    void onLogout();
                  }}
                  data-testid="logout-button"
                  className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Log out
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {displayBoard.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 lg:grid-cols-5">
            {displayBoard.columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds
                  .map((cardId) => displayBoard.cards[cardId])
                  .filter((card): card is NonNullable<typeof card> => Boolean(card))}
                onRename={(id, title) => void actions.renameColumn(id, title)}
                onAddCard={(id, title, details) =>
                  void actions.createCard(id, title, details)
                }
                onDeleteCard={(_columnId, cardId) => void actions.deleteCard(cardId)}
                isDropTarget={dropColumnId === column.id}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      <ChatSidebar setBoard={setBoard} />

      {error ? (
        <Toast message={error} onDismiss={onDismissError} variant="error" />
      ) : null}
    </div>
  );
};

export function resolveDropTarget(
  board: BoardData,
  activeId: string,
  overId: string
): { columnId: string; index: number } | null {
  // Keep this intentionally simple:
  // - over a column => append to end
  // - over a card   => insert at that card index
  const directColumn = board.columns.find((column) => column.id === overId);
  if (directColumn) {
    const existing = directColumn.cardIds.filter((id) => id !== activeId);
    return { columnId: directColumn.id, index: existing.length };
  }

  for (const column of board.columns) {
    const targetIndex = column.cardIds.indexOf(overId);
    if (targetIndex !== -1) {
      return { columnId: column.id, index: targetIndex };
    }
  }

  return null;
}

export function applyPreviewMove(
  board: BoardData,
  cardId: string,
  target: { columnId: string; index: number }
): BoardData {
  const sourceColumn = board.columns.find((column) => column.cardIds.includes(cardId));
  const destinationColumn = board.columns.find((column) => column.id === target.columnId);
  if (!sourceColumn || !destinationColumn) {
    return board;
  }

  const sourceWithout = sourceColumn.cardIds.filter((id) => id !== cardId);
  const destinationBase =
    sourceColumn.id === destinationColumn.id
      ? sourceWithout
      : [...destinationColumn.cardIds];
  const insertIndex = Math.max(0, Math.min(target.index, destinationBase.length));
  const nextDestination = [...destinationBase];
  nextDestination.splice(insertIndex, 0, cardId);

  const nextColumns = board.columns.map((column) => {
    if (sourceColumn.id === destinationColumn.id && column.id === sourceColumn.id) {
      return { ...column, cardIds: nextDestination };
    }
    if (column.id === sourceColumn.id) {
      return { ...column, cardIds: sourceWithout };
    }
    if (column.id === destinationColumn.id) {
      return { ...column, cardIds: nextDestination };
    }
    return column;
  });

  if (sameColumnCardOrder(board.columns, nextColumns)) {
    return board;
  }

  return { ...board, columns: nextColumns };
}

function findCardLocation(
  board: BoardData,
  cardId: string
): { columnId: string; index: number } | null {
  for (const column of board.columns) {
    const index = column.cardIds.indexOf(cardId);
    if (index !== -1) {
      return { columnId: column.id, index };
    }
  }
  return null;
}

function sameColumnCardOrder(
  before: BoardData["columns"],
  after: BoardData["columns"]
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].id !== after[i].id) return false;
    const x = before[i].cardIds;
    const y = after[i].cardIds;
    if (x.length !== y.length) return false;
    for (let j = 0; j < x.length; j += 1) {
      if (x[j] !== y[j]) return false;
    }
  }
  return true;
}
