import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
}));

import Home from "@/app/page";

const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("Home (auth gate)", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const okJson = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const handlerWithBoard = (url: string) => {
    if (url.endsWith("/api/auth/me")) return okJson({ username: "user" });
    if (url.endsWith("/api/board"))
      return okJson({
        columns: [{ id: "col-a", title: "Backlog", cardIds: [] }],
        cards: {},
      });
    return new Response("not stubbed", { status: 500 });
  };

  it("shows the checking-sign-in placeholder before /api/auth/me resolves", () => {
    mockFetch(handlerWithBoard);
    render(<Home />);
    expect(screen.getByTestId("auth-checking")).toBeInTheDocument();
  });

  it("renders the board after successful auth", async () => {
    mockFetch(handlerWithBoard);
    render(<Home />);
    expect(
      await screen.findByRole("heading", { name: /Kanban Studio/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to /login on 401", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ detail: "Not authenticated" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
    );
    render(<Home />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("heading", { name: /Kanban Studio/i })).toBeNull();
  });

  it("logout clicks call /api/auth/logout and redirect to /login", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith("/api/auth/logout")) {
        return new Response(null, { status: 204 });
      }
      return handlerWithBoard(url);
    });

    render(<Home />);
    const logoutButton = await screen.findByTestId("logout-button");
    await userEvent.click(logoutButton);

    await waitFor(() =>
      expect(calls).toEqual(
        expect.arrayContaining([
          "/api/auth/me",
          "/api/board",
          "/api/auth/logout",
        ])
      )
    );
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
