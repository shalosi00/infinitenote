/**
 * Handwriting E2E — the REAL vendored engine runs (test plan:
 * docs/test-plans/handwriting.md, ids HWR-E*). No mocks: Transformers.js
 * (vendored ESM bundle) loads the sha256-pinned trocr-small-handwritten
 * ONNX from /hwr/ (≈64 MB, first use), recognizes the committed freedraw
 * fixture (block letters tracing "CAT"), and the recognized word must
 * become findable through the app's full-text search. Privacy is asserted
 * for real: not a single cross-origin request may fire — model, runtime
 * and ink crops are all same-origin.
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
  "/hwr/transformers.web.bundle.js.gz",
  "/hwr/ort/ort-wasm-simd-threaded.asyncify.mjs",
  "/hwr/ort/ort-wasm-simd-threaded.asyncify.wasm",
  "/hwr/models/trocr-small-handwritten/config.json",
  "/hwr/models/trocr-small-handwritten/tokenizer.json",
  "/hwr/models/trocr-small-handwritten/onnx/encoder_model_quantized.onnx",
  "/hwr/models/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx",
];

// serial: E02 builds the state (fresh page + imported ink + recognized
// text) that E03 (reload persistence) continues from — fullyParallel would
// split them across workers and each worker's beforeAll re-seeds.
test.describe.serial("handwriting: ink becomes searchable", () => {
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

  async function runHandwriting(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="run-hwr"]').click();
  }

  /** Open search (Ctrl+K) and type `term` into it (controlled-input safe). */
  async function searchFor(term: string): Promise<void> {
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
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
    await expect(page.locator("[cmdk-list]")).toContainText(term, { timeout: 20_000 });
  }

  test("HWR-E01: all vendored engine assets are served", async () => {
    for (const url of ASSETS) {
      const res = await page.request.get(url);
      expect(res.status(), `${url} must be served`).toBe(200);
      expect((await res.body()).length, `${url} must not be empty`).toBeGreaterThan(0);
    }
  });

  test("HWR-E02: full path — import ink, recognize, find via search, zero cross-origin requests", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    // privacy tripwire: every request from now on must be same-origin
    const crossOrigin: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.origin !== new URL(page.url()).origin) crossOrigin.push(req.url());
    });

    await page.setInputFiles(
      'input[aria-label="Import files"]',
      "e2e/fixtures/handwriting-cat.excalidraw",
    );
    await expectCount(page, 5);
    expect((await sceneTypes(page))).toContain("freedraw");

    // run the real engine — first use loads the ≈64 MB model from
    // same-origin /hwr/, then recognizes the fixture's single ink line
    const hwrLogs: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("[handwriting] line")) hwrLogs.push(msg.text());
    });
    await runHandwriting();
    const t0 = Date.now();
    await expect(
      page.getByText("Recognized handwriting on 1 line — 1 line had readable text."),
    ).toBeVisible({ timeout: 300_000 });
    console.info(
      `[handwriting-e2e] recognize+toast after ${Date.now() - t0}ms (incl. first-use model load)`,
    );
    // the engine's own per-line latency log — recorded evidence for the
    // test plan's latency table (docs/test-plans/handwriting.md)
    expect(hwrLogs.length, "engine must log per-line latency").toBeGreaterThan(0);
    for (const line of hwrLogs) console.info(`[handwriting-e2e] ${line}`);

    // the recognized word is now searchable (case-insensitive: the model
    // may answer "CAT" or "cat")
    await searchFor("CAT");
    await expectSearchHit("CAT");
    await page.keyboard.press("Escape");

    // privacy: not a single cross-origin request — no model CDN, no telemetry
    expect(crossOrigin, "recognition must be fully on-device").toEqual([]);
  });

  test("HWR-E03: the recognized text persists across a reload", async () => {
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await searchFor("CAT");
    await expectSearchHit("CAT");
    await page.keyboard.press("Escape");
    // and the ink itself is still on the page, untouched
    await expectCount(page, 5);
    expect((await sceneTypes(page))).toContain("freedraw");
  });

  test("HWR-E04: a page without ink is a friendly no-op", async () => {
    await openPage(page, "Start here");
    await runHandwriting();
    await expect(
      page.getByText("No handwriting on this page — nothing to recognize."),
    ).toBeVisible({ timeout: 15_000 });
  });
});
