import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Export filenames must follow the CURRENT page title (issue #72).
 *
 * The canvas builds its imperative export surface when Excalidraw mounts,
 * and the canvas only remounts on page switches — so the fix keeps
 * latest-value refs. This spec proves the mechanism end-to-end: rename the
 * open page in place, export, and the download must carry the NEW title.
 */

const NEW_TITLE = "Renamed Export Page";

/** Export the current page in the given menu format; returns the download's suggested filename. */
async function exportCurrentPage(
  page: Page,
  menuItem: RegExp,
): Promise<string> {
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: menuItem }).click();
  const download = await downloadPromise;
  return download.suggestedFilename();
}

test.describe.serial("export follows the current page title (issue #72)", () => {
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

  test("renaming the open page updates PNG and scene export filenames", async () => {
    // sanity: the seeded page is open under its original title
    const titleButton = page
      .locator("main")
      .getByRole("button", { name: "Start here", exact: true });
    await expect(titleButton).toBeVisible();

    // rename in place (click title → input → Enter commits on blur)
    await titleButton.click();
    const titleInput = page.locator("main").getByRole("textbox");
    await titleInput.fill(NEW_TITLE);
    await titleInput.press("Enter");
    await expect(
      page.locator("main").getByRole("button", { name: NEW_TITLE, exact: true }),
    ).toBeVisible();

    // the very next exports must use the NEW title — before the fix these
    // downloaded as "Start-here.*" (stale mount-time closure)
    expect(await exportCurrentPage(page, /PNG image/)).toBe("Renamed-Export-Page.png");
    expect(await exportCurrentPage(page, /Excalidraw scene/)).toBe(
      "Renamed-Export-Page.excalidraw",
    );
  });

  test("paper-style switch is picked up by the next PDF export (no remount)", async () => {
    // switch paper to ruled without leaving the page
    await page.locator('[data-testid="background-picker"]').click();
    await page.locator('[data-testid="background-ruled"]').click();
    await expect(
      page.locator('[data-testid="ruled-paper"]'),
    ).toBeVisible();

    // PDF export must succeed with the fresh paper style and the new title
    // (portrait lives in a Radix submenu — hover it open first)
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.locator('[data-testid="export-pdf-submenu"]').hover();
    await page.locator('[data-testid="export-pdf-portrait"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Renamed-Export-Page.pdf");
  });
});
