import { test, expect } from "@playwright/test";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { attachErrorCollector, expectCount, resetToSeed } from "./helpers";

/**
 * PDF import truncation + blank-file feedback (issue #75).
 *
 * A PDF beyond the 20-page render cap must import 20 pages AND tell the user
 * exactly how much was dropped; a blank text file must not be counted as
 * imported.
 */

const FX = path.join(__dirname, "fixtures");

test.describe.serial("PDF printout truncation notice (issue #75)", () => {
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

  test("a 25-page PDF imports 20 pages with an explicit truncation toast", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-25pages.pdf"),
    );
    // seed scene = 2 elements + 20 rendered pages
    await expectCount(page, 22, 60_000);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Inserted PDF printout (first 20 of 25 pages)" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a blank text file is not reported as imported", async () => {
    await page.setInputFiles('input[aria-label="Import files"]', {
      name: "empty.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("   \n \n"),
    });
    // scene unchanged — nothing importable in the file
    await expectCount(page, 22);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Some files had no importable content" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
