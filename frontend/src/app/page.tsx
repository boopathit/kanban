"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KanbanBoard } from "@/components/KanbanBoard";
import { ApiError } from "@/lib/api";
import { getCurrentUser, logout } from "@/lib/auth";
import { useBoard } from "@/lib/useBoard";

type AuthState = "checking" | "authed" | "anon";

export default function Home() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const board = useBoard();

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then(() => {
        if (!cancelled) setAuthState("authed");
      })
      .catch((err) => {
        if (cancelled) return;
        setAuthState("anon");
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  };

  if (authState === "checking") {
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        data-testid="auth-checking"
      >
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-[var(--gray-text)]">
          Checking sign-in...
        </p>
      </main>
    );
  }

  if (authState === "anon") {
    return null;
  }

  return (
    <KanbanBoard
      board={board.board}
      loading={board.loading}
      error={board.error}
      onDismissError={board.dismissError}
      actions={board.actions}
      onLogout={handleLogout}
    />
  );
}
