import { expect, test } from "@playwright/test";

test.describe("auth flow", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("invalid credentials show an inline error and stay on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill("user");
    await page.getByLabel(/password/i).fill("wrong");
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page.getByTestId("login-error")).toHaveText(
      /invalid username or password/i
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("valid credentials reveal the kanban board", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill("user");
    await page.getByLabel(/password/i).fill("password");
    await page.getByTestId("login-submit").click();

    // Logout button only renders once auth + board both load — a stable signal
    // that we've actually arrived on the board page (not just matching a
    // substring on the login heading).
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
    await expect(
      page.getByRole("heading", { name: "Kanban Studio", exact: true })
    ).toBeVisible();
  });

  test("session survives a reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill("user");
    await page.getByLabel(/password/i).fill("password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.reload();
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("logout clears the cookie and bounces back to /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill("user");
    await page.getByLabel(/password/i).fill("password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("logout-button")).toBeVisible();

    await page.getByTestId("logout-button").click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("session cookie is httpOnly and not readable from document.cookie", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill("user");
    await page.getByLabel(/password/i).fill("password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("logout-button")).toBeVisible();

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");

    const visibleCookie = await page.evaluate(() => document.cookie);
    expect(visibleCookie).not.toContain("session=");
  });
});
