import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

test.describe.serial("page tags (issue #18)", () => {
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

  test("add a tag from the page header; chip shows in picker and sidebar", async () => {
    await page.locator('[data-testid="tag-picker"]').click();
    const input = page.locator('[data-testid="tag-input"]');
    await expect(input).toBeVisible();
    await input.fill("Recipe");
    await input.press("Enter");
    await expect(page.locator('[data-testid="tag-chip-Recipe"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // the sidebar page row now carries the tag chip
    await expect(page.locator('[data-testid="page-tag-Recipe"]').first()).toBeVisible();
  });

  test("tag filter view lists only matching pages and clears back to the tree", async () => {
    await page.locator('[data-testid="page-tag-Recipe"]').first().click();
    const view = page.locator('[data-testid="tag-filter-view"]');
    await expect(view).toBeVisible();
    await expect(view).toContainText("Recipe");
    await expect(page.locator('[data-testid="tag-filter-row"]')).toHaveCount(1);
    await expect(view).toContainText("Start here");

    await page.locator('[data-testid="tag-filter-clear"]').click();
    await expect(page.locator('[data-testid="tag-filter-view"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="notebook-row"]').first()).toBeVisible();
  });

  test("tags persist across a reload and Ctrl+K search finds them", async () => {
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.locator('[data-testid="page-tag-Recipe"]').first()).toBeVisible();

    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await expect(input).toBeVisible();
    await input.fill("recipe");
    const results = page.locator("[cmdk-list]");
    await expect(results).toContainText("Start here", { timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  test("removing the tag clears the chips everywhere", async () => {
    await page.locator('[data-testid="tag-picker"]').click();
    await page.locator('[data-testid="tag-chip-remove-Recipe"]').click();
    await expect(page.locator('[data-testid="tag-chip-Recipe"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="page-tag-Recipe"]')).toHaveCount(0);
  });
});
