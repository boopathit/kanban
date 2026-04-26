"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { BoardData } from "@/lib/kanban";
import { useChat } from "@/lib/useChat";

type ChatSidebarProps = {
  setBoard: (board: BoardData) => void;
};

const SUGGESTIONS = [
  "Rename Backlog to Inbox",
  "Add a card titled Planning to Backlog with details next sprint",
  "Move Refine status language to Review",
];

export const ChatSidebar = ({ setBoard }: ChatSidebarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const { messages, pending, loadingHistory, error, dismissError, send } = useChat({
    setBoard,
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, loadingHistory]);

  const shownMessages = useMemo(
    () => messages.filter((m) => m.role === "user" || m.role === "assistant"),
    [messages]
  );

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await send(text);
  };

  return (
    <>
      <button
        type="button"
        data-testid="chat-launcher"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-lg transition hover:brightness-110"
      >
        AI assistant
      </button>

      {isOpen && !isMinimized ? (
        <div
          className="fixed inset-0 z-40 bg-[#032147]/20 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {!isOpen ? null : (
        <aside
          data-testid="chat-sidebar"
          className={clsx(
            "fixed bottom-20 right-4 z-50 flex flex-col rounded-3xl border border-[var(--stroke)] bg-white/95 shadow-[var(--shadow)] backdrop-blur transition-all",
            "w-[min(390px,calc(100vw-2rem))]",
            isMinimized ? "h-[70px]" : "h-[min(75vh,620px)]"
          )}
        >
        <header
          className="flex items-center justify-between border-b border-[var(--stroke)] px-4 py-3"
        >
          <div>
            <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">
              AI Assistant
            </h2>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--gray-text)]">
              Board-aware chat
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="chat-minimize"
              onClick={() => setIsMinimized((v) => !v)}
              className="rounded-full border border-[var(--stroke)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
              aria-label={isMinimized ? "Expand chat window" : "Minimize chat window"}
            >
              {isMinimized ? "Open" : "Minimize"}
            </button>
            <button
              type="button"
              className="rounded-full border border-[var(--stroke)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--gray-text)]"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat window"
            >
              Close
            </button>
          </div>
        </header>

        {isMinimized ? null : (
          <>
            <div
              ref={listRef}
              data-testid="chat-message-list"
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {loadingHistory ? (
                <p className="text-sm text-[var(--gray-text)]">Loading history...</p>
              ) : shownMessages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--gray-text)]">
                    Ask me to rename columns, create cards, move cards, or clean up work.
                  </p>
                  <div className="space-y-2">
                    {SUGGESTIONS.map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        className="w-full rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)]"
                        onClick={() => setDraft(sample)}
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                shownMessages.map((message) => (
                  <article
                    key={message.id}
                    data-testid={`chat-message-${message.role}`}
                    className={clsx(
                      "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm",
                      message.role === "user"
                        ? "ml-auto bg-[var(--secondary-purple)] text-white"
                        : "mr-auto border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]"
                    )}
                  >
                    <p>{message.content}</p>
                    <p
                      className={clsx(
                        "mt-1 text-[10px] uppercase tracking-[0.16em]",
                        message.role === "user"
                          ? "text-white/80"
                          : "text-[var(--gray-text)]"
                      )}
                    >
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </article>
                ))
              )}
              {pending ? (
                <p className="text-xs uppercase tracking-[0.15em] text-[var(--gray-text)]">
                  Thinking...
                </p>
              ) : null}
            </div>

            {error ? (
              <div
                data-testid="chat-error"
                className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={dismissError}
                  className="shrink-0 rounded-full border border-red-200 px-2 py-0.5 text-[10px] uppercase tracking-wide"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <footer className="border-t border-[var(--stroke)] p-3">
              <label htmlFor="chat-input" className="sr-only">
                Message AI assistant
              </label>
              <textarea
                id="chat-input"
                data-testid="chat-input"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Ask AI to update your board..."
                className="w-full resize-none rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  data-testid="chat-send"
                  disabled={pending || !draft.trim()}
                  onClick={() => void submit()}
                  className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Send
                </button>
              </div>
            </footer>
          </>
        )}
        </aside>
      )}
    </>
  );
};
