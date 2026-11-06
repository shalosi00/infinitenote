import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

test.describe.serial("keyboard shortcut cheatsheet (issue #28)", () => {
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

  const dialog = () => page.locator('[data-testid="shortcuts-dialog"]');

  test("? opens the cheatsheet with all groups; Escape closes it", async () => {
    // focus the canvas first — the shortcut must work mid-drawing too
    await page.locator(".excalidraw").click();
    await page.keyboard.press("Shift+Slash"); // "?"
    await expect(dialog()).toBeVisible();

    for (const group of ["General", "Organizing", "Canvas tools", "Canvas editing"]) {
      await expect(dialog()).toContainText(group);
    }
    // the real app shortcuts are listed
    await expect(dialog()).toContainText("Search all pages");
    await expect(dialog()).toContainText("New quick note");

    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
  });

  test("the sidebar footer button opens the same dialog", async () => {
    await page.locator('[data-testid="shortcuts-button"]').click();
    await expect(dialog()).toBeVisible();
    await expect(dialog()).toContainText("Canvas tools");
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
  });

  test("? typed inside an input does not open the cheatsheet", async () => {
    // open the search dialog and type "?" into its input
    await page.keyboard.press("Control+k");
    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible();
    await searchInput.type("?");
    await expect(dialog()).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(searchInput).toHaveCount(0);
  });
});
