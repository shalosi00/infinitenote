/**
 * Handwriting E2E — the REAL vendored engine runs (test plan:
 * docs/test-plans/handwriting.md, ids HWR-E*). No mocks: Transformers.js
 * (vendored ESM bundle) loads the sha256-pinned trocr-small-handwritten
 * ONNX from /hwr/ (≈64 MB, first use), recognizes the committed freedraw
 * fixture (block letters tracing "CAT"), and the recognized word must
 * become findable through the app's full-text search. Privacy is asserted
 * for real: not a single cross-origin request may fire — model, runtime
 * and ink crops are all same-origin.
 *
 * Phase B (issue #176) rides the same serial chain: E05 converts the
 * recognized ink into an editable text element (ink kept, one conversion
 * mark, honest no-op re-run), E06 proves undo-safety + the per-group
 * selection branch, E07 proves the honest already-converted/guidance
 * toasts. No new engine, no new privacy surface — conversion only reads
 * the metadata recognition stored.
 */
import { expect, test } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  elementCount,
  expectCount,
  openPage,
  resetToSeed,
  sceneTypes,
  serializeCurrentPage,
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

  /**
   * Focus the canvas by clicking a spot whose topmost element IS the canvas
   * (elementFromPoint hit-test scan). Fixed ratios are unstable here: the
   * ink sits top-left, the sonner toast zone is bottom-center, and Excalidraw's
   * own islands float over the canvas — a click on any of them leaves
   * keyboard focus outside the editor and the subsequent Ctrl+z is a no-op
   * (observed 2026-11-11: activeElement LI (toast) / BUTTON (island)).
   */
  async function clickEmptyCanvasSpot(): Promise<void> {
    const box = await page.locator(".excalidraw").boundingBox();
    if (!box) throw new Error(".excalidraw container not found");
    const candidates: Array<[number, number]> = [
      [0.8, 0.3],
      [0.85, 0.45],
      [0.7, 0.4],
      [0.75, 0.6],
      [0.6, 0.8],
    ];
    for (const [rx, ry] of candidates) {
      const x = box.x + box.width * rx;
      const y = box.y + box.height * ry;
      const hit = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return el ? `${el.tagName}|${String(el.className).slice(0, 40)}` : "none";
        },
        [x, y],
      );
      if (hit.startsWith("CANVAS") || hit.includes("excalidraw")) {
        await page.mouse.click(x, y);
        return;
      }
    }
    throw new Error("no empty canvas spot found — every candidate was overlaid");
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

  test("HWR-E05: recognized ink converts to editable text — ink kept, text at the ink position, re-run is an honest no-op", async () => {
    // page still open from HWR-E03: recognized ink, no text yet
    await expectCount(page, 5);
    expect((await sceneTypes(page))).not.toContain("text");

    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="convert-hwr"]').click();
    await expect(
      page.getByText("Converted 1 line of handwriting to text."),
    ).toBeVisible({ timeout: 15_000 });

    // one editable text element joined the scene; the 5 ink strokes are kept
    await expectCount(page, 6);
    expect((await sceneTypes(page))).toContain("text");
    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<{ type: string; text?: string; x?: number; y?: number }>;
    };
    const textEl = scene.elements.find((e) => e.type === "text");
    expect(textEl?.text?.toLowerCase(), "the recognized word becomes the text").toContain("cat");
    expect(
      scene.elements.filter((e) => e.type === "freedraw"),
      "the original strokes are kept",
    ).toHaveLength(5);
    // the text sits at the ink position (the idempotency anchor: a text
    // element at the line's position marks the line as converted). The
    // ~8 px slack is Excalidraw's text-box padding (measured here), well
    // inside the policy's 12 px HWR_CONVERT_POSITION_EPSILON.
    const inkEl = scene.elements.find((e) => e.type === "freedraw");
    expect(Math.abs(textEl!.x! - inkEl!.x!)).toBeLessThan(12);
    expect(Math.abs(textEl!.y! - inkEl!.y!)).toBeLessThan(12);

    // re-running is an honest no-op — no duplicate text blocks
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="convert-hwr"]').click();
    await expect(
      page.getByText("All recognized handwriting is already converted to text."),
    ).toBeVisible({ timeout: 15_000 });
    await expectCount(page, 6);
  });

  test("HWR-E06: one undo removes the converted text — and the undone scene persists across a reload", async () => {
    // the conversion landed as ONE native scene update — undo must take the
    // page back to ink-only (undo-safety, issue #176). The conversion toast
    // (sonner, bottom-center) lingers ~4 s and holds keyboard focus — let
    // it detach, then focus the canvas via the hit-tested empty spot
    await page
      .locator("[data-sonner-toast]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => {});
    await clickEmptyCanvasSpot();
    await page.keyboard.press("Escape");
    // a selection-only click must not eat the undo: press Ctrl+Z until the
    // text is gone (bounded — then the count assertion makes failures loud)
    for (let i = 0; i < 3 && (await elementCount(page)) !== 5; i++) {
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(300);
    }
    await expectCount(page, 5);
    expect((await sceneTypes(page))).not.toContain("text");
    // outlive the autosave debounce, then prove the undone scene persisted:
    // a reload shows ink-only (5 strokes, no text, conversion mark gone —
    // it rode the same undo entry)
    await page.waitForTimeout(1_200);
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, 5);
    expect((await sceneTypes(page))).not.toContain("text");
  });

  test("HWR-E07: per-group conversion via selection converts the selected line; a page without recognition is guided", async () => {
    // after E06's undo the page is ink-only on a freshly mounted canvas:
    // select the ink (Ctrl+A — nothing else is there) and convert — the
    // per-group branch reads the LIVE selection and converts exactly the
    // selected line
    await clickEmptyCanvasSpot();
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="convert-hwr"]').click();
    await expect(
      page.getByText("Converted 1 line of handwriting to text."),
    ).toBeVisible({ timeout: 15_000 });
    await expectCount(page, 6);
    expect((await sceneTypes(page))).toContain("text");

    // a page that was never recognized points at "Recognize handwriting"
    await openPage(page, "Start here");
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="convert-hwr"]').click();
    await expect(
      page.getByText(
        'No recognized handwriting with recognized text — run "Recognize handwriting" first, then select the ink and convert.',
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("HWR-E04: a page without ink is a friendly no-op", async () => {
    await openPage(page, "Start here");
    await runHandwriting();
    await expect(
      page.getByText("No handwriting on this page — nothing to recognize."),
    ).toBeVisible({ timeout: 15_000 });
  });
});
