import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  canvasTheme,
  expectCount,
  resetToSeed,
} from "./helpers";

test.describe.serial("theme and mobile layout", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("canvas follows the theme toggle", async () => {
    // The theme is the authoritative signal: the canvas paints white paper in
    // both themes (Excalidraw's dark-mode CSS filter inverts it into the dark
    // look), so the raw viewBackgroundColor no longer flips on toggle.
    const before = await canvasTheme(page);
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect.poll(() => canvasTheme(page)).not.toBe(before);
    await page.screenshot({ path: "e2e-artifacts/e2e-dark-mode.png" });

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect.poll(() => canvasTheme(page)).toBe(before);
  });

  test("mobile viewport navigates via the drawer", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.locator("[data-slot='sheet-content']");
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: "e2e-artifacts/e2e-mobile.png" });

    // "Brainstorm" lives in the collapsed "Ideas" section — expand it first.
    // NOTE: the page-row click must not use filter({ has: <drawer-scoped
    // locator> }) — Playwright evaluates the inner chain from the candidate
    // element, where the drawer root does not exist. The drawer contains
    // exactly one "Brainstorm" button (the kebab has a different name).
    await drawer.getByRole("button", { name: "Ideas", exact: true }).click();
    await drawer.getByRole("button", { name: "Brainstorm", exact: true }).click();
    await expectCount(page, 0); // Brainstorm page is empty

    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
