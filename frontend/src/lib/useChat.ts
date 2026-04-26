"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHistory, sendMessage, type ChatHistoryItem } from "@/lib/chat";
import type { BoardData } from "@/lib/kanban";

export type ChatUiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type UseChatOptions = {
  setBoard: (board: BoardData) => void;
};

export type UseChatResult = {
  messages: ChatUiMessage[];
  pending: boolean;
  loadingHistory: boolean;
  error: string | null;
  dismissError: () => void;
  send: (text: string) => Promise<void>;
};

function toUiMessage(m: ChatHistoryItem): ChatUiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
  };
}

export function useChat({ setBoard }: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getHistory()
      .then((payload) => {
        if (!active) return;
        setMessages(payload.messages.map(toUiMessage));
      })
      .catch((err) => {
        if (!active) return;
        setError(messageFor(err, "Could not load chat history."));
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (pending) return;

      const userMsg: ChatUiMessage = {
        id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setPending(true);
      setError(null);

      try {
        const response = await sendMessage(trimmed);
        const assistantMsg: ChatUiMessage = {
          id: `local-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          content: response.reply,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (response.updated_board) {
          setBoard(response.updated_board);
        }
        if (response.op_error) {
          setError(response.op_error);
        }
      } catch (err) {
        setError(messageFor(err, "Could not send your message."));
      } finally {
        setPending(false);
      }
    },
    [pending, setBoard]
  );

  return useMemo(
    () => ({
      messages,
      pending,
      loadingHistory,
      error,
      dismissError,
      send,
    }),
    [dismissError, error, loadingHistory, messages, pending, send]
  );
}

function messageFor(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "detail" in err) {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
