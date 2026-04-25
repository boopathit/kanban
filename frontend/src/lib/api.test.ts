import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";

const mockFetch = (body: BodyInit | null, init: ResponseInit = {}) => {
  const fetchSpy = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
};

describe("apiFetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends credentials include on every call", async () => {
    const spy = mockFetch(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await apiFetch("/api/auth/me");
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("serialises `json` to a JSON body and sets the content-type", async () => {
    const spy = mockFetch(JSON.stringify({ username: "user" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await apiFetch("/api/auth/login", {
      method: "POST",
      json: { username: "user", password: "pw" },
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ username: "user", password: "pw" }));
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("parses JSON responses", async () => {
    mockFetch(JSON.stringify({ username: "user" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const data = await apiFetch<{ username: string }>("/api/auth/me");
    expect(data).toEqual({ username: "user" });
  });

  it("returns null on 204", async () => {
    mockFetch(null, { status: 204 });
    const data = await apiFetch("/api/auth/logout", { method: "POST" });
    expect(data).toBeNull();
  });

  it("throws ApiError with detail when the server returns a JSON error", async () => {
    mockFetch(JSON.stringify({ detail: "Invalid username or password" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await expect(apiFetch("/api/auth/login")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      detail: "Invalid username or password",
    });
  });

  it("throws ApiError without detail when the body is not JSON", async () => {
    mockFetch("plain text", { status: 500 });
    await expect(apiFetch("/api/anything")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });

  it("ApiError is a real Error subclass", async () => {
    mockFetch(null, { status: 401 });
    try {
      await apiFetch("/api/auth/me");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
