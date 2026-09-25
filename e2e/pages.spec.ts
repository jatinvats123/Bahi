import { expect, test } from "@playwright/test";
import { horizontalOverflow, watchConsole } from "./helpers";

const PAGES = [
  { path: "/", heading: "Kya karna hai?" },
  { path: "/ledger", heading: "Ledger" },
  { path: "/activity", heading: "Activity" },
  { path: "/activity?tab=audit", heading: "Activity" },
  { path: "/settings", heading: "Settings" },
];

test.describe("every page", () => {
  for (const p of PAGES) {
    test(`${p.path} loads with zero console errors`, async ({ page }) => {
      const console = watchConsole(page);
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
      await page.waitForLoadState("networkidle");
      console.check();
    });
  }

  test("a run replay page loads with zero console errors", async ({ page }) => {
    const console = watchConsole(page);
    await page.goto("/activity");
    const first = page.getByRole("link", { name: "Replay dekho" }).first();
    await first.click();
    await expect(page).toHaveURL(/\/activity\/.+/);
    await expect(page.locator("#run-title")).toBeVisible();
    await page.waitForLoadState("networkidle");
    console.check();
  });

  test("mode badges say mock data and recorded runs", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByText("Mock data")).toBeVisible();
    await expect(sidebar.getByText("Recorded", { exact: true })).toBeVisible();
  });
});

test.describe("mobile 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("bottom bar navigates between pages", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: "Main" }).last();
    await expect(bar).toBeVisible();
    await bar.getByRole("link", { name: /Ledger/ }).click();
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
    await bar.getByRole("link", { name: /Activity/ }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await bar.getByRole("link", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await bar.getByRole("link", { name: /Command/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kya karna hai?" })).toBeVisible();
  });

  for (const path of ["/", "/ledger", "/activity", "/activity?tab=audit", "/settings"]) {
    test(`${path} has no horizontal overflow`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("a finished run has no horizontal overflow", async ({ page }) => {
    await page.goto("/?demo=S2");
    await expect(page.getByTestId("run-stamp").locator("[data-stamp=approved]")).toBeVisible({ timeout: 30_000 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("ledger", () => {
  test("status filters and search narrow the rows", async ({ page }) => {
    await page.goto("/ledger");
    const rows = page.locator("table tbody tr");
    const all = await rows.count();
    expect(all).toBeGreaterThan(3);

    const filters = page.getByRole("group", { name: "Status filter" });
    await filters.getByRole("button", { name: /^Late/ }).click();
    await expect(filters.getByRole("button", { name: /^Late/ })).toHaveAttribute("aria-pressed", "true");
    const late = await rows.count();
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(all);
    for (const status of await rows.locator("td:nth-child(5)").allInnerTexts()) expect(status).toMatch(/Late/);

    await filters.getByRole("button", { name: /^Sab/ }).click();
    await page.getByLabel("Dhoondho").fill("Sharma");
    await expect(rows.first()).toContainText("Sharma");
    for (const client of await rows.locator("td:nth-child(2)").allInnerTexts()) expect(client).toMatch(/Sharma/);

    await page.getByLabel("Dhoondho").fill("koi aisa client nahi");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText(/Koi invoice nahi|kuch nahi mila/i).first()).toBeVisible();
  });
});

test.describe("shell", () => {
  test("theme toggle flips light and dark, and remembers it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/ledger");
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");
    await page.locator("aside").first().getByRole("button", { name: "Light ya dark theme badlo" }).click();
    const after = await html.getAttribute("data-theme");
    expect(after).not.toBe(before);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after ?? "");
  });

  test("offline banner appears and clears", async ({ page, context }) => {
    await page.goto("/ledger");
    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId("offline-banner")).toBeHidden();
  });
});
