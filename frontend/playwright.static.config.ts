import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const staticDir = path.resolve(__dirname, "out");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "uv run uvicorn app.main:app --host 127.0.0.1 --port 8000",
    cwd: path.join(repoRoot, "backend"),
    env: {
      ...(process.env as Record<string, string>),
      STATIC_DIR: staticDir,
      DB_PATH: path.join(repoRoot, "backend", ".pytest-data", "pm.db"),
    },
    url: "http://127.0.0.1:8000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
