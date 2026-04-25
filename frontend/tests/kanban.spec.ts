import { expect, test, type Page } from "@playwright/test";

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

const columnByTitle = (page: Page, title: string) =>
  page.locator(`[data-column-title="${title}"]`);

const cardByTitle = (page: Page, title: string) =>
  page.locator('[data-testid^="card-"]', { hasText: title }).first();

test("loads the kanban board with the seeded columns", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  for (const title of ["Backlog", "Discovery", "In Progress", "Review", "Done"]) {
    await expect(columnByTitle(page, title)).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Kanban Studio", exact: true })
  ).toBeVisible();
});

test("adds a card to the Backlog column", async ({ page }) => {
  await page.goto("/");
  const backlog = columnByTitle(page, "Backlog");
  await expect(backlog).toBeVisible();
  await backlog.getByRole("button", { name: /add a card/i }).click();
  const title = `Playwright card ${Date.now().toString(36)}`;
  await backlog.getByPlaceholder("Card title").fill(title);
  await backlog.getByPlaceholder("Details").fill("Added via e2e.");
  await backlog.getByRole("button", { name: /add card/i }).click();
  await expect(backlog.getByText(title)).toBeVisible();
});

test("moves a seeded card from Backlog into Review", async ({ page }) => {
  await page.goto("/");
  const card = cardByTitle(page, "Align roadmap themes");
  const review = columnByTitle(page, "Review");

  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  const columnBox = await review.boundingBox();
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

  await expect(
    review.locator('[data-testid^="card-"]', { hasText: "Align roadmap themes" })
  ).toBeVisible();
});
