"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await login(username, password);
      router.replace("/");
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? "Invalid username or password."
          : "Sign-in failed. Please try again.";
      setError(message);
      setPending(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="rounded-[32px] border border-[var(--stroke)] bg-white/80 p-10 shadow-[var(--shadow)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Single Board Kanban
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in to Kanban Studio
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--gray-text)]">
            Use the demo credentials to access your board.
          </p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--navy-dark)]">
              Username
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                disabled={pending}
                className="rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--navy-dark)]">
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={pending}
                className="rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              />
            </label>

            {error ? (
              <p
                role="alert"
                data-testid="login-error"
                className="rounded-2xl border border-[#f3c7c7] bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#a01919]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              data-testid="login-submit"
              className="mt-2 rounded-full bg-[var(--primary-blue)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Signing in..." : "Sign in"}
            </button>

            <p className="mt-2 text-center text-xs text-[var(--gray-text)]">
              Demo credentials: <code className="font-mono">user</code> /{" "}
              <code className="font-mono">password</code>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
