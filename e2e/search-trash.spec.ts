import path from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  saveNow,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

test.describe.serial("search (Ctrl+K) and trash", () => {
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

  test("search finds pages by content keyword", async () => {
    // put searchable content on a new page
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-notes.txt"),
    );
    await expectCount(page, 1);
    await saveNow(page);

    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await expect(input).toBeVisible();
    await input.fill("QUANTUMFROG");

    const results = page.locator("[cmdk-list]");
    await expect(results).toContainText("Page 2", { timeout: 15_000 });
    await expect(results).toContainText("QUANTUMFROG");
    await page.keyboard.press("Escape");
  });

  test("trash lists and restores a deleted page", async () => {
    await page.getByRole("button", { name: "Actions for page Page 2" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    // the deleted page must no longer be navigable from the sidebar
    // (collapsed sections render no page rows, so a row count would be wrong)
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "Page 2", exact: true }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Trash" }).click();
    await expect(page.getByRole("dialog")).toContainText("Page 2 (page)");

    await page.getByRole("button", { name: "Restore" }).first().click();
    await expect(page.getByTestId("sidebar")).toContainText("Page 2");
    await page.keyboard.press("Escape");
  });
});
