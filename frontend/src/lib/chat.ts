import { apiFetch } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

export type ChatHistoryItem = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type ChatHistoryResponse = {
  messages: ChatHistoryItem[];
};

export type SendChatResponse = {
  reply: string;
  applied_ops: Array<Record<string, unknown>>;
  updated_board?: BoardData | null;
  op_error?: string | null;
};

export const getHistory = () =>
  apiFetch<ChatHistoryResponse>("/api/chat/history", { method: "GET" });

export const sendMessage = (message: string) =>
  apiFetch<SendChatResponse>("/api/chat", {
    method: "POST",
    json: { message },
  });
