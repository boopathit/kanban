/**
 * Tiny typed fetch wrapper for the FastAPI backend at /api/*.
 *
 * - Always sends `credentials: "include"` so the httpOnly session cookie is
 *   carried with every request (and Set-Cookie responses are stored).
 * - Throws an `ApiError` on non-2xx so callers can `try/catch` instead of
 *   threading `response.ok` everywhere.
 * - Parses JSON when the response says it's JSON, otherwise returns `null`.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, detail: string | undefined, message?: string) {
    super(message ?? detail ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type ApiInit = Omit<RequestInit, "credentials" | "body"> & {
  json?: unknown;
};

const isJsonResponse = (response: Response) =>
  (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;

  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: "include",
  });

  if (!response.ok) {
    let detail: string | undefined;
    if (isJsonResponse(response)) {
      try {
        const data = (await response.json()) as { detail?: unknown };
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        /* swallow — the body wasn't valid JSON, ApiError still has the status */
      }
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return null as T;
  }

  if (isJsonResponse(response)) {
    return (await response.json()) as T;
  }

  return null as T;
}
