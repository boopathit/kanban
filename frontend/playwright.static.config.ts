import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const staticDir = path.resolve(__dirname, "out");

// Stamp the DB filename per run so each `npx playwright test` starts from a
// freshly seeded database (init_db only seeds when the demo user is missing).
// Files land under backend/.pytest-data/ which is gitignored.
const dbFile = `pm-e2e-${Date.now()}.db`;

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
      DB_PATH: path.join(repoRoot, "backend", ".pytest-data", dbFile),
      SESSION_SECRET: "playwright-static-export-secret",
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
