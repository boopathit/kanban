import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBoard } from "@/lib/useBoard";
import type { BoardData } from "@/lib/kanban";

const SEED: BoardData = {
  columns: [
    { id: "col-a", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "Done", cardIds: ["card-3"] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "One", details: "1" },
    "card-2": { id: "card-2", title: "Two", details: "2" },
    "card-3": { id: "card-3", title: "Three", details: "3" },
  },
};

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

const installFetch = (handler: FetchHandler) => {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
};

const json = (payload: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(JSON.stringify(payload), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

describe("useBoard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the board on mount and exposes loading -> board transitions", async () => {
    installFetch(async () => json(SEED));
    const { result } = renderHook(() => useBoard());

    expect(result.current.loading).toBe(true);
    expect(result.current.board).toBeNull();

    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.board).toEqual(SEED);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a friendly error message when the initial GET fails", async () => {
    installFetch(async () =>
      json({ detail: "Not authenticated" }, { status: 401 })
    );
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.board).toBeNull();
    expect(result.current.error).toBe("Not authenticated");
  });

  it("createCard optimistically appends the server's card and keeps it on success", async () => {
    const fetchSpy = installFetch(async (_url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      // POST /api/cards
      const body = JSON.parse(init.body as string);
      return json(
        { id: "card-new", title: body.title, details: body.details },
        { status: 201 }
      );
    });

    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    await act(async () => {
      await result.current.actions.createCard("col-a", "Brand new", "details");
    });

    expect(fetchSpy.mock.calls.some(([u]) => u === "/api/cards")).toBe(true);
    expect(result.current.board?.cards["card-new"]).toEqual({
      id: "card-new",
      title: "Brand new",
      details: "details",
    });
    expect(
      result.current.board?.columns.find((c) => c.id === "col-a")?.cardIds
    ).toEqual(["card-1", "card-2", "card-new"]);
    expect(result.current.error).toBeNull();
  });

  it("createCard rolls back when the server returns 500", async () => {
    installFetch(async (_url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      return json({ detail: "boom" }, { status: 500 });
    });
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    const before = result.current.board;
    await act(async () => {
      await result.current.actions.createCard("col-a", "Will fail", "");
    });

    expect(result.current.board).toEqual(before);
    expect(result.current.error).toBe("boom");
  });

  it("moveCard optimistically reorders within a column and PATCHes column_id+position", async () => {
    const patchCalls: { url: string; body: unknown }[] = [];
    installFetch(async (url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      patchCalls.push({ url, body: JSON.parse(init.body as string) });
      return json({ id: "card-1", title: "One", details: "1" });
    });
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    await act(async () => {
      await result.current.actions.moveCard("card-1", "col-a", 1);
    });

    expect(
      result.current.board?.columns.find((c) => c.id === "col-a")?.cardIds
    ).toEqual(["card-2", "card-1"]);
    expect(patchCalls).toEqual([
      { url: "/api/cards/card-1", body: { column_id: "col-a", position: 1 } },
    ]);
  });

  it("moveCard rolls back the optimistic state when PATCH fails", async () => {
    installFetch(async (_url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      return json({ detail: "nope" }, { status: 409 });
    });
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());
    const before = result.current.board;

    await act(async () => {
      await result.current.actions.moveCard("card-1", "col-b", 0);
    });

    expect(result.current.board).toEqual(before);
    expect(result.current.error).toBe("nope");
  });

  it("deleteCard optimistically removes and stays removed on success", async () => {
    const deleteUrls: string[] = [];
    installFetch(async (url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      if (init.method === "DELETE") {
        deleteUrls.push(url);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    });
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    await act(async () => {
      await result.current.actions.deleteCard("card-2");
    });

    expect(deleteUrls).toEqual(["/api/cards/card-2"]);
    expect(result.current.board?.cards["card-2"]).toBeUndefined();
    expect(
      result.current.board?.columns.find((c) => c.id === "col-a")?.cardIds
    ).toEqual(["card-1"]);
  });

  it("renameColumn debounces PATCH and rolls back on failure", async () => {
    const patches: { url: string; body: unknown }[] = [];
    installFetch(async (url, init) => {
      if (!init || !init.method || init.method === "GET") return json(SEED);
      patches.push({ url, body: JSON.parse(init.body as string) });
      return json({ detail: "denied" }, { status: 422 });
    });
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    // Three rapid keystrokes — should collapse to one PATCH after the debounce.
    await act(async () => {
      await result.current.actions.renameColumn("col-a", "I");
      await result.current.actions.renameColumn("col-a", "In");
      await result.current.actions.renameColumn("col-a", "Inb");
    });
    expect(
      result.current.board?.columns.find((c) => c.id === "col-a")?.title
    ).toBe("Inb");
    expect(patches).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(patches).toEqual([
      { url: "/api/columns/col-a", body: { title: "Inb" } },
    ]);
    await vi.waitFor(() => expect(result.current.error).toBe("denied"));
    expect(
      result.current.board?.columns.find((c) => c.id === "col-a")?.title
    ).toBe("Backlog");
  });

  it("dismissError clears the error state", async () => {
    installFetch(async () => json({ detail: "x" }, { status: 500 }));
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.error).toBe("x"));
    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });

  it("accepts an externally provided board snapshot via setBoard", async () => {
    installFetch(async () => json(SEED));
    const { result } = renderHook(() => useBoard());
    await vi.waitFor(() => expect(result.current.board).not.toBeNull());

    const updated: BoardData = {
      ...SEED,
      columns: [{ ...SEED.columns[0], title: "Inbox" }, SEED.columns[1]],
    };
    act(() => result.current.setBoard(updated));
    expect(result.current.board?.columns[0].title).toBe("Inbox");
  });
});
