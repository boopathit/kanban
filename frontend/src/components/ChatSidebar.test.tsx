import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import type { BoardData } from "@/lib/kanban";

const BOARD: BoardData = {
  columns: [{ id: "col-a", title: "Inbox", cardIds: ["card-1"] }],
  cards: {
    "card-1": { id: "card-1", title: "Seeded", details: "d" },
  },
};

describe("ChatSidebar", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a message, renders assistant reply, and applies updated_board", async () => {
    const setBoard = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/chat/history")) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/chat")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            reply: "Done, renamed to Inbox.",
            applied_ops: [{ op: "rename_column", column_id: "col-a", title: "Inbox" }],
            updated_board: BOARD,
            op_error: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return new Response("not mocked", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ChatSidebar setBoard={setBoard} />);

    const input = await screen.findByTestId("chat-input");
    await userEvent.type(input, "rename backlog to inbox");
    await userEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() =>
      expect(screen.getByTestId("chat-message-user")).toHaveTextContent(
        "rename backlog to inbox"
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
        "Done, renamed to Inbox."
      )
    );
    expect(setBoard).toHaveBeenCalledWith(BOARD);
  });

  it("shows and dismisses op_error from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/chat/history")) {
          return new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            reply: "I could not apply that.",
            applied_ops: [],
            updated_board: null,
            op_error: "One or more requested board items were not found for this user.",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      })
    );

    render(<ChatSidebar setBoard={vi.fn()} />);
    await userEvent.type(await screen.findByTestId("chat-input"), "delete secret");
    await userEvent.click(screen.getByTestId("chat-send"));

    const err = await screen.findByTestId("chat-error");
    expect(err).toHaveTextContent("not found for this user");
    await userEvent.click(within(err).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByTestId("chat-error")).toBeNull());
  });
});
