/**
 * Ink to shape E2E (issue #329, OneNote "Ink to Shape" parity — test plan:
 * docs/test-plans/ink-shapes.md, ids IS-N*).
 *
 * A committed fixture carries four deterministic freedraw strokes (noisy
 * circle, wobbly line, zigzag, noisy rectangle). Selecting all of them and
 * running "Ink to shape" must convert exactly the three shape-like strokes
 * into perfect Excalidraw geometry — ellipse / line / rectangle with the
 * classifier's fitted bounds — while the zigzag STAYS INK and the toast
 * reports both counts. Undo restores the original ink in one step (the
 * whole replacement is one scene update), re-running re-converts, and the
 * converted scene persists across a reload. IS-N05 proves the real input
 * path: a circle drawn live with the mouse converts too.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  elementCount,
  expectCount,
  openPage,
  resetToSeed,
  sceneTypes,
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

interface SceneElementLike {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: number[][];
}

async function sceneElements(page: Page): Promise<SceneElementLike[]> {
  const raw = await serializeCurrentPage(page);
  return (JSON.parse(raw).elements ?? []) as SceneElementLike[];
}

/** Live element counts by type (alive elements only, tombstones excluded). */
async function typeCounts(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const el of await sceneElements(page)) {
    if (!el.type) continue;
    counts[el.type] = (counts[el.type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Focus the canvas by clicking a spot whose topmost element IS the canvas
 * (elementFromPoint hit-test scan — the handwriting-spec pattern; fixed
 * ratios hit Excalidraw islands or the sonner toast zone).
 */
async function clickEmptyCanvasSpot(page: Page): Promise<void> {
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

/** Sonner toasts hold keyboard focus ~4 s — wait them out before canvas work. */
async function waitForToastsGone(page: Page): Promise<void> {
  await page
    .locator("[data-sonner-toast]")
    .first()
    .waitFor({ state: "detached", timeout: 9_000 })
    .catch(() => {
      /* a second toast may still be riding its own exit — the explicit
         detach wait below catches it */
    });
  await page
    .locator("[data-sonner-toast]")
    .waitFor({ state: "detached", timeout: 9_000 })
    .catch(() => {});
}

async function openInkToShape(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="ink-to-shape"]').click();
}

// serial: N01 builds the state (imported fixture + converted scene) that
// N02/N03 continue from — fullyParallel would split them across workers
// and each worker's beforeAll re-seeds.
test.describe.serial("ink to shape: strokes become perfect geometry", () => {
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

  test("IS-N01: selected shape-like strokes convert with fitted bounds; the rest stays ink", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.setInputFiles('input[aria-label="Import files"]', "e2e/fixtures/ink-shapes.excalidraw");
    await expectCount(page, 4);
    expect((await sceneTypes(page))).toContain("freedraw");

    await clickEmptyCanvasSpot(page);
    await page.keyboard.press("Control+a");
    await openInkToShape(page);
    await expect(
      page.getByText("Converted 3 strokes to shapes. 1 stroke stays as ink — not shape-like."),
    ).toBeVisible({ timeout: 15_000 });

    // alive counts unchanged (3 in, 3 out) but the TYPES prove it
    const counts = await typeCounts(page);
    expect(counts.freedraw).toBe(1); // only the zigzag remains
    expect(counts.ellipse).toBe(1);
    expect(counts.rectangle).toBe(1);
    expect(counts.line).toBe(1);

    // the fitted bounds are the classifier's (fixture-probed) geometry
    const els = await sceneElements(page);
    const ellipse = els.find((e) => e.type === "ellipse");
    expect(ellipse).toBeDefined();
    expect(Math.abs(ellipse!.x! - 139)).toBeLessThanOrEqual(5);
    expect(Math.abs(ellipse!.y! - 90)).toBeLessThanOrEqual(5);
    expect(Math.abs(ellipse!.width! - 120)).toBeLessThanOrEqual(8);
    expect(Math.abs(ellipse!.height! - 120)).toBeLessThanOrEqual(8);
    const rect = els.find((e) => e.type === "rectangle");
    expect(rect).toBeDefined();
    expect(Math.abs(rect!.x! - 419)).toBeLessThanOrEqual(5);
    expect(Math.abs(rect!.y! - 150)).toBeLessThanOrEqual(5);
    expect(Math.abs(rect!.width! - 141)).toBeLessThanOrEqual(8);
    expect(Math.abs(rect!.height! - 90)).toBeLessThanOrEqual(8);
    // the shapes inherited the strokes' color
    const serialized = (JSON.parse(await serializeCurrentPage(page)).elements ?? []) as Array<{
      type?: string;
      strokeColor?: string;
    }>;
    for (const e of serialized) {
      if (e.type === "ellipse" || e.type === "rectangle" || e.type === "line") {
        expect(e.strokeColor).toBe("#1e1e1e");
      }
    }
  });

  test("IS-N02: one undo restores the original ink and outlives a reload", async () => {
    await waitForToastsGone(page);
    await clickEmptyCanvasSpot(page);
    // the whole conversion is ONE scene update — one Ctrl+Z restores the
    // strokes. Wait for the scene to settle after each press (the E06
    // lesson: a fixed read raced the undo landing).
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Control+z");
      const settled = await expect
        .poll(async () => (await typeCounts(page)).ellipse ?? 0, {
          timeout: 2_000,
          intervals: [100, 250, 500],
        })
        .toBe(0)
        .then(() => true)
        .catch(() => false);
      if (settled) break;
    }
    const counts = await typeCounts(page);
    expect(counts.freedraw).toBe(4);
    expect(counts.ellipse ?? 0).toBe(0);
    expect(counts.rectangle ?? 0).toBe(0);
    expect(counts.line ?? 0).toBe(0);
    await expectCount(page, 4);

    // the undone scene persists across a reload (outlive the autosave debounce)
    await page.waitForTimeout(1_200);
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, 4);
    expect((await sceneTypes(page))).not.toContain("ellipse");
    expect((await sceneTypes(page))).toContain("freedraw");
  });

  test("IS-N03: re-running after an undo re-converts and the result persists", async () => {
    await clickEmptyCanvasSpot(page);
    await page.keyboard.press("Control+a");
    await openInkToShape(page);
    await expect(
      page.getByText("Converted 3 strokes to shapes. 1 stroke stays as ink — not shape-like."),
    ).toBeVisible({ timeout: 15_000 });
    const counts = await typeCounts(page);
    expect(counts.freedraw).toBe(1);
    expect(counts.ellipse).toBe(1);

    // the converted scene persists across a reload
    await waitForToastsGone(page);
    await page.waitForTimeout(1_200);
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, 4);
    const countsAfter = await typeCounts(page);
    expect(countsAfter.ellipse).toBe(1);
    expect(countsAfter.freedraw).toBe(1);
    expect((await sceneTypes(page))).toContain("rectangle");
    expect((await sceneTypes(page))).toContain("line");
  });

  test("IS-N04: an empty selection is a friendly guidance no-op", async () => {
    await openPage(page, "Start here");
    await expectCount(page, 2);
    await openInkToShape(page);
    await expect(
      page.getByText("Select the ink strokes to convert, then run Ink to shape again."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("IS-N05: a circle drawn live with the mouse converts (real input path)", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await setActiveTool(page, "freedraw");

    // draw around a hit-tested empty anchor (islands live at the edges)
    const box = await page.locator(".excalidraw").boundingBox();
    if (!box) throw new Error(".excalidraw container not found");
    const cx = box.x + box.width * 0.55;
    const cy = box.y + box.height * 0.5;
    const r = 70;
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      await page.mouse.move(cx + r * Math.cos(t), cy + r * Math.sin(t), { steps: 2 });
    }
    await page.mouse.up();
    await expectCount(page, 1);

    await setActiveTool(page, "selection");
    await clickEmptyCanvasSpot(page);
    await page.keyboard.press("Control+a");
    await openInkToShape(page);
    await expect(page.getByText("Converted 1 stroke to shapes.")).toBeVisible({ timeout: 15_000 });
    const counts = await typeCounts(page);
    expect(counts.freedraw ?? 0).toBe(0);
    expect(counts.ellipse).toBe(1);
    await expectCount(page, 1);
  });
});
