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

  const boardAfterReload = (await (
    await page.request.get("/api/board")
  ).json()) as {
    columns: Array<{ id: string; title: string; cardIds: string[] }>;
    cards: Record<string, { id: string; title: string; details: string }>;
  };
  const created = Object.values(boardAfterReload.cards).find((c) => c.title === title);
  if (!created) throw new Error("Created card was not found in /api/board");

  const cardId = created.id;
  const deleteResp = await page.request.delete(`/api/cards/${cardId}`);
  expect(deleteResp.status()).toBe(204);

  await expect
    .poll(
      async () => {
        const board = (await (
          await page.request.get(`/api/board?ts=${Date.now()}`)
        ).json()) as {
          cards: Record<string, { id: string; title: string; details: string }>;
        };
        return Object.values(board.cards).some((c) => c.id === cardId);
      },
      { timeout: 10_000 }
    )
    .toBe(false);

  await page.reload();
  await expect(columnByTitle(page, "Discovery").getByText(title)).toHaveCount(0);
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
