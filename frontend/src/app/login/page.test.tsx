import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
}));

import LoginPage from "@/app/login/page";

const mockFetchOnce = (init: ResponseInit, body: BodyInit | null = null) => {
  const spy = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("LoginPage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the form with username, password, and submit", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveTextContent(/sign in/i);
  });

  it("submits credentials and redirects to / on success", async () => {
    const fetchSpy = mockFetchOnce(
      { status: 200, headers: { "content-type": "application/json" } },
      JSON.stringify({ username: "user" })
    );
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByTestId("login-submit"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({ username: "user", password: "password" })
    );
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("shows the credential error on 401 and stays on the page", async () => {
    mockFetchOnce(
      { status: 401, headers: { "content-type": "application/json" } },
      JSON.stringify({ detail: "Invalid username or password" })
    );
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByTestId("login-submit"));

    const error = await screen.findByTestId("login-error");
    expect(error).toHaveTextContent(/invalid username or password/i);
    expect(replaceMock).not.toHaveBeenCalled();
    // the button is re-enabled so the user can try again
    expect(screen.getByTestId("login-submit")).not.toBeDisabled();
  });

  it("shows a generic error on a 500 response", async () => {
    mockFetchOnce({ status: 500 }, "boom");
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByTestId("login-submit"));

    const error = await screen.findByTestId("login-error");
    expect(error).toHaveTextContent(/sign-in failed/i);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
