import { test, expect } from "@playwright/test";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Import feedback must follow the active locale (issue #73).
 *
 * The canvas composes its toasts from the `canvas.*` message namespace; the
 * translator is read through a latest-value ref, so switching the UI to
 * 简体中文 mid-session must localize the very next import toast — no page
 * switch, no remount.
 */

const FX = path.join(__dirname, "fixtures");
/** Locale-independent selector for the hidden import input (its aria-label is translated). */
const IMPORT_INPUT = 'header input[type="file"][multiple]';

test.describe.serial("import toasts follow the locale (issue #73)", () => {
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

  test("default English toast after importing an image", async () => {
    await page.setInputFiles(IMPORT_INPUT, path.join(FX, "test-image.png"));
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Imported 1 image" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("switching to 简体中文 localizes the next import toast", async () => {
    await page.locator('[data-testid="locale-toggle"]').click();
    await expect(page.locator('[data-testid="quick-note-button"]')).toHaveText(
      /快速笔记/,
    );

    // import on the SAME page — the canvas did not remount, so only the
    // latest-value translator ref can produce a localized toast
    await page.setInputFiles(IMPORT_INPUT, path.join(FX, "test-image.png"));
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "已导入 1 张图片" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("the truncation notice is localized too (25-page PDF in Chinese)", async () => {
    await page.setInputFiles(IMPORT_INPUT, path.join(FX, "test-25pages.pdf"));
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "已插入 PDF 打印件（共 25 页，仅前 20 页" }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
