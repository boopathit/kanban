import { expect, test } from "@playwright/test";

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

test("chat can rename Backlog to Inbox and refresh board without reload", async ({
  page,
}) => {
  await page.goto("/");
  const boardResponse = await page.request.get("/api/board");
  const originalBoard = (await boardResponse.json()) as {
    columns: Array<{ id: string; title: string; cardIds: string[] }>;
    cards: Record<string, { id: string; title: string; details: string }>;
  };
  const backlog = originalBoard.columns.find((c) => c.title === "Backlog");
  if (!backlog) throw new Error("Backlog not found in seeded board");

  const updatedBoard = {
    ...originalBoard,
    columns: originalBoard.columns.map((c) =>
      c.id === backlog.id ? { ...c, title: "Inbox" } : c
    ),
  };

  await page.route("**/api/chat/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Done. Renamed Backlog to Inbox.",
        applied_ops: [{ op: "rename_column", column_id: backlog.id, title: "Inbox" }],
        updated_board: updatedBoard,
        op_error: null,
      }),
    });
  });

  await page.reload();
  await page.getByTestId("chat-launcher").click();
  await page.getByTestId("chat-input").fill("rename Backlog to Inbox");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-message-assistant")).toContainText("Inbox");
  await expect(page.locator('[data-column-title="Inbox"]')).toBeVisible();
});

test("chat can add card and new card appears in Inbox", async ({ page }) => {
  await page.goto("/");
  const boardResponse = await page.request.get("/api/board");
  const originalBoard = (await boardResponse.json()) as {
    columns: Array<{ id: string; title: string; cardIds: string[] }>;
    cards: Record<string, { id: string; title: string; details: string }>;
  };
  const backlog = originalBoard.columns.find((c) => c.title === "Backlog");
  if (!backlog) throw new Error("Backlog not found in seeded board");

  const newCardId = `chat-e2e-${Date.now().toString(36)}`;
  const updatedBoard = {
    columns: originalBoard.columns.map((c) =>
      c.id === backlog.id
        ? { ...c, title: "Inbox", cardIds: [...c.cardIds, newCardId] }
        : c
    ),
    cards: {
      ...originalBoard.cards,
      [newCardId]: { id: newCardId, title: "E2E", details: "demo" },
    },
  };

  await page.route("**/api/chat/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Added card E2E to Inbox.",
        applied_ops: [
          {
            op: "create_card",
            column_id: backlog.id,
            title: "E2E",
            details: "demo",
          },
        ],
        updated_board: updatedBoard,
        op_error: null,
      }),
    });
  });

  await page.reload();
  await page.getByTestId("chat-launcher").click();
  await page
    .getByTestId("chat-input")
    .fill("add a card titled E2E to Inbox with details demo");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-message-assistant")).toContainText("E2E");
  const inbox = page.locator('[data-column-title="Inbox"]');
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText("E2E")).toBeVisible();
});
