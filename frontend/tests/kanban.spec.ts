import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, request }) => {
  await context.clearCookies();
  // Auth via the API so each test starts with a valid session cookie.
  // (Static-export config talks to the real FastAPI; dev config has no /api/*
  // and these specs are skipped there — see frontend/AGENTS.md.)
  const login = await request.post("/api/auth/login", {
    data: { username: "user", password: "password" },
    failOnStatusCode: false,
  });
  test.skip(
    login.status() !== 200,
    "Backend not reachable; run with playwright.static.config.ts"
  );
  const cookies = await request.storageState();
  await context.addCookies(cookies.cookies);
});

test("loads the kanban board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  await page.goto("/");
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
});
