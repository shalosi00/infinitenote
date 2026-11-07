import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  createTextElement,
  expectCount,
  openPage,
  resetToSeed,
  saveNow,
  setActiveTool,
} from "./helpers";

/**
 * Regression specs for bug-hunt wave 2, PR 1 (state & data integrity):
 * - #79 search index must refresh on every dialog open (no stale cache)
 * - #80 trash list must refresh after restore/purge while the dialog is open
 * - #82 search jumps must reveal the target page in a collapsed section
 */
test.describe.serial("wave2 state fixes: search freshness, trash refresh, reveal", () => {
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

  test("#79 search re-indexes content created after a previous search", async () => {
    // 1) open search once and close it — the old code cached contents here
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("Search all pages…")).toBeVisible();
    await page.keyboard.press("Escape");

    // 2) add NEW searchable content on a fresh page
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await setActiveTool(page, "text");
    await createTextElement(page, "ZEBRA-MARKER-42");
    await expectCount(page, 1);
    await saveNow(page);

    // 3) search again — the fresh content must be found
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await expect(input).toBeVisible();
    await input.fill("ZEBRA-MARKER-42");
    const results = page.locator("[cmdk-list]");
    await expect(results).toContainText("ZEBRA-MARKER-42", { timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  test("#82 search jump reveals the page inside its collapsed section", async () => {
    // collapse everything so the hit page is not visible in the tree
    await page
      .getByTestId("sidebar")
      .getByRole("button", { name: "Welcome Notebook", exact: true })
      .click();
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "Start here", exact: true }),
    ).toHaveCount(0);

    // jump to the known seeded page via search
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await input.fill("infinite canvas");
    const hit = page.locator("[cmdk-list]").getByText("Start here").first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    // the sidebar must now SHOW the landed page (section re-expanded)
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "Start here", exact: true }),
    ).toBeVisible();
  });

  test("#80 trash list refreshes after restore while the dialog stays open", async () => {
    // trash one page, then reopen the tree
    await openPage(page, "Start here");
    await page.getByRole("button", { name: "Actions for page Start here" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();

    await page.getByRole("button", { name: "Trash" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Start here (page)");

    // restore WITHOUT closing the dialog — the row must disappear immediately
    await dialog.getByRole("button", { name: "Restore" }).first().click();
    await expect(dialog).not.toContainText("Start here (page)");
    await expect(dialog).toContainText("Trash is empty");
    await page.keyboard.press("Escape");
  });
});
