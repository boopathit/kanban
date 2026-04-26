"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board?.cards ?? {}, [board?.cards]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || !over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const target = resolveDropTarget(board, activeId, overId);
    if (!target) return;

    void actions.moveCard(activeId, target.columnId, target.index);
  };

  if (loading || !board) {
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
            {board.columns.map((column) => (
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

        <div className="relative lg:flex lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <section className="grid gap-6 lg:grid-cols-5">
                {board.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds
                      .map((cardId) => board.cards[cardId])
                      .filter((card): card is NonNullable<typeof card> => Boolean(card))}
                    onRename={(id, title) => void actions.renameColumn(id, title)}
                    onAddCard={(id, title, details) =>
                      void actions.createCard(id, title, details)
                    }
                    onDeleteCard={(_columnId, cardId) =>
                      void actions.deleteCard(cardId)
                    }
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
          </div>
          <ChatSidebar setBoard={setBoard} />
        </div>
      </main>

      {error ? (
        <Toast message={error} onDismiss={onDismissError} variant="error" />
      ) : null}
    </div>
  );
};

function resolveDropTarget(
  board: BoardData,
  activeId: string,
  overId: string
): { columnId: string; index: number } | null {
  // Dropped on a column itself → append to the end.
  const columnDirect = board.columns.find((c) => c.id === overId);
  if (columnDirect) {
    return {
      columnId: columnDirect.id,
      index: columnDirect.cardIds.filter((id) => id !== activeId).length,
    };
  }
  // Dropped on a card → insert at that card's index in its column.
  for (const column of board.columns) {
    const overIdx = column.cardIds.indexOf(overId);
    if (overIdx !== -1) {
      const sourceColumn = board.columns.find((c) =>
        c.cardIds.includes(activeId)
      );
      const sameColumn = sourceColumn?.id === column.id;
      if (sameColumn) {
        const without = column.cardIds.filter((id) => id !== activeId);
        const targetIdx = without.indexOf(overId);
        return {
          columnId: column.id,
          index: targetIdx === -1 ? without.length : targetIdx,
        };
      }
      return { columnId: column.id, index: overIdx };
    }
  }
  return null;
}
