import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import { inflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Page-count math for the injected scene (deterministic):
 * - 40 single-line text elements, y from 60 to 60+39*90+25 = 3595 → contentH 3535, contentW 500
 * - portrait: scale = min(2, 515.28/500) = 1.03056 → bandH = 761.89/1.03056
 *   = 739.27 → ceil(3535/739.27) = 5 pages
 * - landscape: scale = min(2, 761.89/500) = 1.52378 → bandH = 515.28/1.52378
 *   = 338.2 → ceil(3535/338.2) = 11 pages (wider sheet scales up → shorter bands)
 */
const EXPECT_PORTRAIT_PAGES = 5;
const EXPECT_LANDSCAPE_PAGES = 11;

/** Count PDF page objects in a raw jsPDF-produced buffer. */
function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) ?? []).length;
}

/** Full text of the file with FlateDecode streams inflated (jsPDF compresses). */
function pdfDecompressed(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let out = raw;
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      out += "\n" + inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // not a zlib stream (e.g. binary image payload) — keep the raw bytes
    }
  }
  return out;
}

/** Inject a tall, deterministic 40-block text scene through the e2e hook. */
async function injectTallScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.__NOTE_E2E__?.excalidraw as unknown as {
      updateScene: (scene: { elements: unknown[] }) => void;
    };
    if (!api) throw new Error("e2e hook missing");
    const elements: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      elements.push({
        type: "text",
        id: `pdf-e2e-${i}`,
        x: 60,
        y: 60 + i * 90,
        width: 500,
        height: 25,
        text: i === 0 ? "PDFEXPORTMARKER first line" : `printout line ${i}`,
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#1e1b4b",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        groupIds: [],
        frameId: null,
        roundness: null,
        baseline: 18,
        lineHeight: 1.25,
        containerId: null,
        originalText: "",
        autoResize: true,
      });
    }
    api.updateScene({ elements });
  });
}

/** Open Export → PDF submenu → orientation; returns the downloaded file bytes. */
async function exportPdf(page: Page, orientation: "portrait" | "landscape"): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.locator('[data-testid="export-pdf-submenu"]').hover();
  await page.locator(`[data-testid="export-pdf-${orientation}"]`).waitFor({ state: "visible" });
  await page.locator(`[data-testid="export-pdf-${orientation}"]`).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no file");
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(path) };
}

test.describe.serial("paginated PDF export (issue #20)", () => {
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

  test("portrait export of a tall multi-block scene yields a 5-page PDF with vector text", async () => {
    await injectTallScene(page);
    const { name, bytes } = await exportPdf(page, "portrait");

    expect(name).toBe("Start-here.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(EXPECT_PORTRAIT_PAGES);
    // non-trivial file
    expect(bytes.length).toBeGreaterThan(4_000);
    // text embedded as vector (selectable) — the marker survives in a content stream
    expect(pdfDecompressed(bytes)).toContain("PDFEXPORTMARKER");
  });

  test("landscape export of the same scene paginates into more pages", async () => {
    const { name, bytes } = await exportPdf(page, "landscape");
    expect(name).toBe("Start-here.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(EXPECT_LANDSCAPE_PAGES);
  });

  test("exporting an empty page surfaces an error toast instead of a file", async () => {
    await page.locator('[data-testid="quick-note-button"]').click();
    await expect(
      page.locator('[data-testid="page-row"]').filter({ hasText: /Quick note \d{4}-\d{2}-\d{2}/ }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.locator('[data-testid="export-pdf-submenu"]').hover();
    await page.locator('[data-testid="export-pdf-portrait"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="export-pdf-portrait"]').click();

    await expect(page.locator("[data-sonner-toast]")).toContainText("Nothing to export", {
      timeout: 15_000,
    });
  });
});
