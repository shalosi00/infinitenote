/**
 * HWR-U — handwriting conversion must survive a post-undo re-conversion,
 * and a store-dropped conversion must self-heal (test plan:
 * docs/test-plans/handwriting.md, "Known limitation" section).
 *
 * Background (measured 2026-11-11, engine-chain development): a conversion
 * issued immediately after undoing a previous conversion could be dropped
 * by the Excalidraw 0.18 store ~1 s later — "applied at +0 ms, gone at
 * +1200 ms, no tombstone". Re-measured 2026-11-13 on the current
 * toolchain (Chromium 156 headless-shell, Excalidraw 0.18, webpack dev
 * server): the interactive flow does NOT drop anymore (HWR-U01, probes to
 * +4 s, twice) — but the drop shape stays real, so the conversion now
 * carries an integrity guard (detectDroppedConversion + a 1.5 s re-check
 * that re-applies the conversion once). U01 pins the healthy flow, U03
 * forces the exact drop shape (elements removed from the map, no
 * tombstone, captureUpdate NEVER) and proves the guard heals it.
 *
 * The fixture ships the same first-stroke metadata (customData.hwrText /
 * hwrAt) the real recognition flow stores, so "Convert handwriting to
 * text" works without the 64 MB engine — the guard logic is identical on
 * both paths (conversion only ever reads the metadata).
 *
 * Serial chain: U01 builds the state U02 inspects.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  sceneTypes,
} from "./helpers";

test.describe.serial("handwriting: conversion survives undo + store drops", () => {
  let consoleErrors: string[];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  /** Same hit-tested empty-spot focus as the engine spec (toast zone, islands). */
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

  async function count(): Promise<number> {
    return page.evaluate(() => window.__NOTE_E2E__?.elementCount() ?? -1);
  }

  async function convertHandwriting(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="convert-hwr"]').click();
  }

  /** Import the pre-recognized fixture and wait for the import handshake. */
  async function importRecognizedFixture(): Promise<void> {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      "e2e/fixtures/handwriting-cat-recognized.excalidraw",
    );
    // the import toast is the handshake: clicks/events can stall while the
    // canvas mounts (documented helpers pattern) — retry the import once
    // if no toast showed up
    try {
      await page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Imported scene" })
        .waitFor({ state: "visible", timeout: 8_000 });
    } catch {
      await page.setInputFiles(
        'input[aria-label="Import files"]',
        "e2e/fixtures/handwriting-cat-recognized.excalidraw",
      );
    }
    await expectCount(page, 5);
  }

  /** Reload into a fresh-mount canvas — the REAL post-recognition state
   *  (recognition writes to the DB and remounts; the import's own
   *  EVENTUALLY-captured history entry would otherwise merge with the
   *  conversion's IMMEDIATELY capture and one Ctrl+Z would eat the
   *  import too — measured 2026-11-13, undo press went 6→1). */
  async function reloadToFreshMount(): Promise<void> {
    await page
      .locator("[data-sonner-toast]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => {});
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /** Undo the last conversion — toast detached first, canvas focused via
   *  the hit-tested spot. NEVER presses when the scene already dropped
   *  to/below the ink-only 5 (a further undo would eat earlier history);
   *  the first Ctrl+Z after a selection can be a no-op (measured), so the
   *  loop is bounded and loud. */
  async function undoConversion(): Promise<void> {
    await page
      .locator("[data-sonner-toast]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => {});
    await clickEmptyCanvasSpot();
    await page.keyboard.press("Escape");
    for (let i = 0; i < 5; i++) {
      const before = await count();
      if (before <= 5) break;
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(700);
      const after = await count();
      console.info(`hwr-undo-e2e] undo press #${i + 1}: ${before} -> ${after}`);
      if (after === 5) break;
    }
  }

  test("HWR-U01: convert, undo, convert again — the re-conversion persists", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await importRecognizedFixture();
    await reloadToFreshMount();
    await expectCount(page, 5);

    // first conversion — the metadata-only fast path (no engine)
    await convertHandwriting();
    await expect(
      page.getByText("Converted 1 line of handwriting to text."),
    ).toBeVisible({ timeout: 15_000 });
    await expectCount(page, 6);
    expect((await sceneTypes(page))).toContain("text");

    // one undo returns the page to ink-only
    await undoConversion();
    await expectCount(page, 5);
    expect((await sceneTypes(page)), "undo removes the text").not.toContain("text");

    // convert again IMMEDIATELY (no reload, no re-recognition — the
    // historically drop-prone state)
    await convertHandwriting();
    await expect(
      page.getByText("Converted 1 line of handwriting to text."),
    ).toBeVisible({ timeout: 15_000 });
    const t0 = Date.now();
    await expectCount(page, 6);

    // probe past the measured drop window (~+1200 ms) AND past the
    // integrity guard's re-check (+1500 ms): the count must stay 6 and the
    // guard must stay silent (a false re-apply would still be 6 —
    // structural idempotency — but the persistence assert below would
    // catch any real churn)
    const samples: Array<[number, number]> = [];
    for (const wait of [300, 300, 600, 800, 2000]) {
      await page.waitForTimeout(wait);
      const n = await count();
      samples.push([Date.now() - t0, n]);
      console.info(`hwr-undo-e2e] +${Date.now() - t0}ms count=${n}`);
    }
    const dropped = samples.filter(([, n]) => n !== 6);
    expect(
      dropped,
      `the re-conversion must not be dropped by the store (samples: ${JSON.stringify(samples)})`,
    ).toEqual([]);

    // and the undone-then-reconverted scene persists for real
    await reloadToFreshMount();
    await expectCount(page, 6);
    expect((await sceneTypes(page)), "the re-conversion persists across a reload").toContain(
      "text",
    );
  });

  test("HWR-U02: the reloaded page's text is the recognized word at the ink position", async () => {
    const scene = JSON.parse(
      await page.evaluate(() => window.__NOTE_E2E__?.serializeCurrentPage() ?? ""),
    ) as {
      elements: Array<{ type: string; text?: string; x?: number; y?: number }>;
    };
    const textEl = scene.elements.find((e) => e.type === "text");
    expect(textEl?.text?.toLowerCase(), "the recognized word became the text").toContain(
      "cat",
    );
    const inkEl = scene.elements.find((e) => e.type === "freedraw");
    expect(inkEl, "the original strokes are kept").toBeTruthy();
    expect(Math.abs(textEl!.x! - inkEl!.x!)).toBeLessThan(12);
    expect(Math.abs(textEl!.y! - inkEl!.y!)).toBeLessThan(12);
  });

  test("HWR-U03: the integrity guard heals a store-dropped conversion", async () => {
    // fresh setup: own page, import, fresh mount — same state as U01's start
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await importRecognizedFixture();
    await reloadToFreshMount();
    await expectCount(page, 5);

    await convertHandwriting();
    await expect(
      page.getByText("Converted 1 line of handwriting to text."),
    ).toBeVisible({ timeout: 15_000 });
    await expectCount(page, 6);

    // force the exact drop shape the 2026-11-11 measurement recorded:
    // the created text element is removed from the elements map ENTIRELY
    // (no tombstone) via a full-scene replace with captureUpdate NEVER —
    // what a store reconciliation-away looks like. A legit undo would
    // TOMBSTONE the element instead; the guard must tell the two apart.
    await page.evaluate(() => {
      const api = (window as unknown as {
        __NOTE_E2E__?: {
          excalidraw: {
            getSceneElementsIncludingDeleted: () => Array<{ isDeleted?: boolean; type: string }>;
            updateScene: (opts: Record<string, unknown>) => void;
          };
        };
      }).__NOTE_E2E__!;
      const live = api.excalidraw
        .getSceneElementsIncludingDeleted()
        .filter((e) => !e.isDeleted && e.type !== "text");
      api.excalidraw.updateScene({ elements: live, captureUpdate: "NEVER" });
    });
    await expectCount(page, 5);

    // the guard fires ~1500 ms after the conversion, detects the missing
    // id, and re-enters the conversion (structural idempotency keeps it
    // duplicate-free) — the healed scene must be back at 6
    await expect
      .poll(async () => count(), {
        timeout: 8_000,
        message: "the integrity guard re-applies the dropped conversion",
      })
      .toBe(6);

    // exactly ONE text element — the heal is not a duplicate
    const textCount = await page.evaluate(
      () =>
        (
          window as unknown as {
            __NOTE_E2E__?: {
              excalidraw: { getSceneElements: () => Array<{ type: string }> };
            };
          }
        ).__NOTE_E2E__!.excalidraw.getSceneElements().filter((e) => e.type === "text").length,
    );
    expect(textCount, "the heal inserts exactly one text element").toBe(1);

    // and the healed scene persists for real
    await reloadToFreshMount();
    await expectCount(page, 6);
    expect((await sceneTypes(page)), "the healed conversion persists across a reload").toContain(
      "text",
    );
  });
});
