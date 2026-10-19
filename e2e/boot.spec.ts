import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, expectCount, resetToSeed } from "./helpers";

test.describe.serial("boot: first launch with the welcome seed", () => {
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

  test("document title", async () => {
    await expect(page).toHaveTitle("InfiniteNote — infinite canvas notebook");
  });

  test("welcome scene is seeded with exactly 2 elements", async () => {
    await expectCount(page, 2);
  });

  test("notebook tree shows the seeded hierarchy", async () => {
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toContainText("Welcome Notebook");
    await expect(sidebar).toContainText("Getting Started");
    await expect(sidebar).toContainText("Start here");
  });

  test("first page is auto-selected", async () => {
    await expect(
      page.locator('[data-testid="page-row"][data-selected="true"]'),
    ).toContainText("Start here");
  });

  test("canvas stylesheet is applied (layout bug guard)", async () => {
    const height = await page.evaluate(
      () => document.querySelector(".excalidraw")?.getBoundingClientRect().height ?? 0,
    );
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(2000);
  });
});
