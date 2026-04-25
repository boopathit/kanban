import { apiFetch } from "@/lib/api";

export type User = { username: string };

export const login = (username: string, password: string) =>
  apiFetch<User>("/api/auth/login", { method: "POST", json: { username, password } });

export const logout = () =>
  apiFetch<null>("/api/auth/logout", { method: "POST" });

export const getCurrentUser = () => apiFetch<User>("/api/auth/me");
