import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  saveNow,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

/** Page count of a PDF (counts /Type /Page objects, not /Pages). */
function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) ?? []).length;
}

/** Full text with FlateDecode streams inflated (jsPDF compresses). */
function pdfDecompressed(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const out: string[] = [raw];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      out.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      /* not a zlib stream (e.g. a binary image payload) */
    }
  }
  return out.join("\n");
}

/** Open Export → PDF submenu → orientation; returns the downloaded file bytes. */
async function exportPdf(
  page: Page,
  orientation: "portrait" | "landscape",
): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.locator('[data-testid="export-pdf-submenu"]').hover();
  await page.locator(`[data-testid="export-pdf-${orientation}"]`).waitFor({ state: "visible" });
  await page.locator(`[data-testid="export-pdf-${orientation}"]`).click();
  const download = await downloadPromise;
  const p = await download.path();
  if (!p) throw new Error("download produced no file");
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(p) };
}

/**
 * Bug-hunt wave 2, PR 2 — PDF export fixes:
 * - #83 audio blocks must print (audio-only page exports instead of erroring)
 * - #84 a 简体中文 page title must not garble the footer (raster fallback)
 * - #85 the empty-page export error is a localized toast, not a raw message
 */
test.describe.serial("wave2 PDF export fixes", () => {
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

  test("#83 an audio-only page exports to PDF instead of failing", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-audio.wav"),
    );
    await expectCount(page, 1);
    await expect
      .poll(() => page.locator('[data-testid="audio-player"]').count())
      .toBeGreaterThanOrEqual(1);
    await saveNow(page);

    const { name, bytes } = await exportPdf(page, "portrait");
    expect(name).toBe("Page-2.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // the strip is printed: exactly one page, and the clip's name is drawn
    // as vector text inside the player strip
    expect(pdfPageCount(bytes)).toBe(1);
    expect(pdfDecompressed(bytes)).toContain("test-audio.wav");
  });

  test("#84 a 简体中文 page title exports with a rasterized footer", async () => {
    // rename the open page to a CJK title via the header title button
    // (its accessible name is the current page title — the tooltip is not)
    await page.locator("main").getByRole("button", { name: "Page 2", exact: true }).click();
    const titleInput = page.getByRole("textbox", { name: "Page title" });
    await titleInput.fill("会议记录");
    await titleInput.press("Enter");

    const { name, bytes } = await exportPdf(page, "portrait");
    // unicode-aware export filename (issue #74 behavior preserved)
    expect(name).toBe("会议记录.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(1);
    // the footer title is a rasterized image (system font renders CJK),
    // not garbled vector text — an /XObject image must exist in the file
    expect(pdfDecompressed(bytes)).toContain("/Subtype /Image");
  });

  test("#85 exporting an empty page shows the localized empty-page toast", async () => {
    await page.locator('[data-testid="quick-note-button"]').click();
    await expect(
      page
        .getByTestId("page-row")
        .filter({ hasText: /Quick note \d{4}-\d{2}-\d{2}/ })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.locator('[data-testid="export-pdf-submenu"]').hover();
    await page.locator('[data-testid="export-pdf-portrait"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="export-pdf-portrait"]').click();

    // localized message keyed by ExportError.code (en: "Nothing to export —
    // this page is empty.") — never a raw internal error string. Earlier
    // toasts (audio import) may still be on screen, so filter by text.
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Nothing to export" });
    await expect(toast).toContainText("this page is empty", { timeout: 15_000 });
  });
});
