/**
 * Issue #123 — restore the last-opened page on app reload.
 *
 * OneNote reopens where you left off; a full browser reload must reopen the
 * page the user was working on, with a graceful fallback to the first page
 * when the stored selection no longer resolves (page trashed/deleted).
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, openPage, resetToSeed } from "./helpers";

test.describe.serial("restore last-opened page (#123)", () => {
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

  /** The page title shown in the title bar (click-to-rename button). */
  const openTitleButton = () =>
    page.locator('button[title="Click to rename this page"]');

  /** Expand "Ideas" ONLY when its page is not already reachable. */
  const ensureBrainstormReachable = async () => {
    const row = page.getByRole("button", { name: "Brainstorm", exact: true });
    if (await row.isVisible().catch(() => false)) return;
    await page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: "Ideas" })
      .locator("button")
      .first()
      .click();
    await row.waitFor({ state: "visible", timeout: 15_000 });
  };

  test("reopens the last-opened page after a full reload", async () => {
    await ensureBrainstormReachable();
    await openPage(page, "Brainstorm");
    await expect(openTitleButton()).toHaveText("Brainstorm");

    // full reload — the app must come back on "Brainstorm", not "Start here"
    await page.reload();
    await openTitleButton().waitFor({ state: "visible", timeout: 30_000 });
    await expect(openTitleButton()).toHaveText("Brainstorm");
  });

  test("falls back to the first page when the stored selection is stale", async () => {
    // simulate a page that was trashed/deleted between sessions: the stored
    // selection points at ids that no longer exist in the tree
    await page.evaluate(() => {
      localStorage.setItem(
        "infinitenote.lastPage",
        JSON.stringify({ notebookId: "gone", sectionId: "gone", pageId: "gone" }),
      );
    });
    await page.reload();
    await openTitleButton().waitFor({ state: "visible", timeout: 30_000 });
    await expect(openTitleButton()).toHaveText("Start here");
  });

  test("a fresh selection wins over the restored one", async () => {
    // the fallback above opened "Start here"; selecting another page must
    // persist and survive yet another reload ("Ideas" is collapsed again
    // after that reload — the restore only expands the restored page's chain)
    await ensureBrainstormReachable();
    await openPage(page, "Brainstorm");
    await page.reload();
    await openTitleButton().waitFor({ state: "visible", timeout: 30_000 });
    await expect(openTitleButton()).toHaveText("Brainstorm");
  });
});
