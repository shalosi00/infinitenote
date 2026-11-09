/**
 * OCR E2E — the REAL vendored engine runs (test plan:
 * docs/test-plans/ocr.md, ids OCR-E*). No mocks: tesseract.js (wasm, LSTM)
 * loads from /ocr/, recognizes the committed fixture image, and the
 * recognized word must become findable through the app's full-text search.
 */
import { expect, test } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  openPage,
  resetToSeed,
  sceneTypes,
} from "./helpers";

const ASSETS = [
  "/ocr/tesseract.min.js",
  "/ocr/worker.min.js",
  "/ocr/core/tesseract-core-lstm.wasm.js",
  "/ocr/core/tesseract-core-simd-lstm.wasm.js",
  "/ocr/lang/deu.traineddata.gz",
];

// serial: E02 builds the state (fresh page + imported image + recognized
// text) that E03 (reload persistence) and E04 (no-op page) continue from —
// fullyParallel would split them across workers and each worker's beforeAll
// re-seeds, erasing the built-up state.
test.describe.serial("ocr: images become searchable", () => {
  let consoleErrors: string[];
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  async function runOcr(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="run-ocr"]').click();
  }

  /** Open search (Ctrl+K) and type `term` into it. */
  async function searchFor(term: string): Promise<void> {
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
    // The input is controlled (value={query}); filling during the dialog's
    // opening re-render can have the typed value wiped by the next
    // controlled render — right after a reload that window is wide enough
    // to lose the whole query. Fill, verify the value stuck, retry.
    for (let attempt = 0; attempt < 4; attempt++) {
      await input.fill(term);
      await page.waitForTimeout(250);
      if ((await input.inputValue()) === term) break;
    }
    await expect(input).toHaveValue(term);
    await page.locator("[cmdk-list]").waitFor({ state: "visible" });
  }

  /** Retrying assertion — the content index loads async after the dialog opens. */
  async function expectSearchHit(term: string): Promise<void> {
    await expect(page.locator("[cmdk-list]")).toContainText(term, { timeout: 15_000 });
  }

  test("OCR-E01: all five vendored engine assets are served", async () => {
    for (const url of ASSETS) {
      const res = await page.request.get(url);
      expect(res.status(), `${url} must be served`).toBe(200);
      expect((await res.body()).length, `${url} must not be empty`).toBeGreaterThan(0);
    }
  });

  test("OCR-E02: full path — import image, recognize, find via search", async () => {
    // import the fixture image (a fresh page keeps the seed scene intact)
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.setInputFiles('input[aria-label="Import files"]', "e2e/fixtures/ocr-text.png");
    await expectCount(page, 1);
    expect((await sceneTypes(page))).toContain("image");

    // run the real engine — the toast flips to the success summary
    await runOcr();
    await expect(
      page.getByText("Recognized text in 1 image — 1 had readable text."),
    ).toBeVisible({ timeout: 60_000 });

    // the recognized word is now searchable, snippet and all
    await searchFor("QUOKKA");
    await expectSearchHit("QUOKKA");
    await page.keyboard.press("Escape");
  });

  test("OCR-E03: the recognized text persists across a reload", async () => {
    await page.reload();
    // let the app fully boot before driving it (a search fired into a
    // booting app races the controlled input and reports nothing)
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await searchFor("QUOKKA");
    await expectSearchHit("QUOKKA");
    await page.keyboard.press("Escape");
    // and the image itself is still on the page, scanned
    await expectCount(page, 1);
  });

  test("OCR-E04: a page without images is a friendly no-op", async () => {
    await openPage(page, "Start here");
    await runOcr();
    await expect(page.getByText("No images on this page — nothing to recognize.")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("OCR-E05: German text is recognized and searchable (umlauts intact)", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.setInputFiles('input[aria-label="Import files"]', "e2e/fixtures/ocr-text-de.png");
    await expectCount(page, 1);
    expect((await sceneTypes(page))).toContain("image");

    // run the real engine over the German fixture (GÄSTEBUCH / MÜNCHEN STRAßE)
    await runOcr();
    await expect(
      page.getByText("Recognized text in 1 image — 1 had readable text."),
    ).toBeVisible({ timeout: 60_000 });

    // the umlaut word survives the whole path: engine → customData → search
    await searchFor("GÄSTEBUCH");
    await expectSearchHit("GÄSTEBUCH");
    await page.keyboard.press("Escape");
  });
});
