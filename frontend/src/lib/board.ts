/**
 * Typed client for the board API. Wire shapes match
 * `backend/app/schemas.py` 1:1 — see `docs/schema.json` for the contract.
 */

import { apiFetch } from "@/lib/api";
import type { BoardData, Card } from "@/lib/kanban";

export type CardSummary = Card;

export const getBoard = () => apiFetch<BoardData>("/api/board");

export const renameColumn = (columnId: string, title: string) =>
  apiFetch<{ id: string; title: string; cardIds: string[] }>(
    `/api/columns/${encodeURIComponent(columnId)}`,
    { method: "PATCH", json: { title } }
  );

export const createCard = (
  columnId: string,
  title: string,
  details: string
) =>
  apiFetch<CardSummary>("/api/cards", {
    method: "POST",
    json: { column_id: columnId, title, details },
  });

export type CardPatch = {
  title?: string;
  details?: string;
  column_id?: string;
  position?: number;
};

export const patchCard = (cardId: string, patch: CardPatch) =>
  apiFetch<CardSummary>(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: "PATCH",
    json: patch,
  });

export const deleteCard = (cardId: string) =>
  apiFetch<null>(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: "DELETE",
  });
