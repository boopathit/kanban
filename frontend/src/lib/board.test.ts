import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCard,
  deleteCard,
  getBoard,
  patchCard,
  renameColumn,
} from "@/lib/board";

const mockJsonFetch = (payload: unknown, init: ResponseInit = { status: 200 }) => {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("board api client", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("getBoard hits /api/board with credentials", async () => {
    const spy = mockJsonFetch({ columns: [], cards: {} });
    const data = await getBoard();
    expect(spy).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({ credentials: "include" })
    );
    expect(data).toEqual({ columns: [], cards: {} });
  });

  it("renameColumn PATCHes /api/columns/{id} with the new title", async () => {
    const spy = mockJsonFetch({ id: "c1", title: "Inbox", cardIds: [] });
    await renameColumn("c1", "Inbox");
    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/columns/c1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ title: "Inbox" }));
  });

  it("renameColumn URL-encodes weird ids", async () => {
    const spy = mockJsonFetch({ id: "x/y", title: "t", cardIds: [] });
    await renameColumn("x/y", "t");
    expect(spy.mock.calls[0][0]).toBe("/api/columns/x%2Fy");
  });

  it("createCard POSTs the column_id payload", async () => {
    const spy = mockJsonFetch(
      { id: "new", title: "T", details: "D" },
      { status: 201 }
    );
    const card = await createCard("col-1", "T", "D");
    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/cards");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      column_id: "col-1",
      title: "T",
      details: "D",
    });
    expect(card).toEqual({ id: "new", title: "T", details: "D" });
  });

  it("patchCard PATCHes /api/cards/{id} with only the provided fields", async () => {
    const spy = mockJsonFetch({ id: "c1", title: "x", details: "y" });
    await patchCard("c1", { column_id: "col-2", position: 3 });
    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/cards/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      column_id: "col-2",
      position: 3,
    });
  });

  it("deleteCard DELETEs /api/cards/{id} and returns null on 204", async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", spy);
    const result = await deleteCard("c1");
    expect(spy).toHaveBeenCalledWith(
      "/api/cards/c1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toBeNull();
  });
});
