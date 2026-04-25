import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context, request }) => {
  await context.clearCookies();
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

test("a card added in one session persists across reload and can be deleted", async ({
  page,
}) => {
  const title = `Persisted ${Date.now().toString(36)}`;

  await page.goto("/");
  const column = columnByTitle(page, "Discovery");
  await expect(column).toBeVisible();

  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByPlaceholder("Details").fill("Should survive reload");
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText(title)).toBeVisible();

  await page.reload();
  const columnAfter = columnByTitle(page, "Discovery");
  await expect(columnAfter.getByText(title)).toBeVisible();
  await expect(columnAfter.getByText("Should survive reload")).toBeVisible();

  const card = columnAfter.locator('[data-testid^="card-"]', {
    hasText: title,
  });
  await card
    .getByRole("button", { name: new RegExp(`delete ${title}`, "i") })
    .click();
  await expect(columnAfter.getByText(title)).toBeHidden();

  await page.reload();
  await expect(columnByTitle(page, "Discovery").getByText(title)).toBeHidden();
});

test("renaming a column persists across reload", async ({ page }) => {
  const newTitle = `Renamed-${Date.now().toString(36)}`;

  await page.goto("/");
  const review = columnByTitle(page, "Review");
  await expect(review).toBeVisible();
  const input = review.getByLabel("Column title");
  await input.fill(newTitle);
  // Wait for the rename debounce to flush.
  await page.waitForTimeout(700);

  await page.reload();
  await expect(columnByTitle(page, newTitle)).toBeVisible();

  // Best-effort restore so the next test sees a familiar board.
  const renamed = columnByTitle(page, newTitle);
  await renamed.getByLabel("Column title").fill("Review");
  await page.waitForTimeout(700);
});
