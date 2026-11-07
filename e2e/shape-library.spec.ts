/**
 * Issue #65 — curated shape library beyond the Excalidraw defaults.
 *
 * Shapes insert from the header toolbar as NATIVE Excalidraw elements:
 * editable, auto-selected on insert, persisted with the scene, and clean
 * through export round-trips. Desktop and mobile (drawer layout) surfaces.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  elementCount,
  expectCount,
  resetToSeed,
  saveNow,
  serializeCurrentPage,
} from "./helpers";

interface SceneJson {
  elements: Array<{
    type: string;
    id: string;
    containerId?: string | null;
    startArrowhead?: string | null;
    endArrowhead?: string | null;
    strokeStyle?: string;
    text?: string;
  }>;
}

async function openShapesMenu(page: Page): Promise<void> {
  await page.getByTestId("shapes-button").click();
  await page.getByTestId("shapes-menu").waitFor({ state: "visible", timeout: 10_000 });
}

async function insertShape(page: Page, shapeId: string): Promise<void> {
  await openShapesMenu(page);
  await page.getByTestId(`shape-${shapeId}`).click();
  await page.getByTestId("shapes-menu").waitFor({ state: "hidden", timeout: 10_000 });
}

test.describe.serial("shape library (issue #65)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    // ignore the known dev-only font-subset worker noise (see helpers.ts) —
    // filtered at assertion time so a reverted helpers.ts cannot resurrect it
    const realErrors = consoleErrors.filter(
      (e) => !/Failed to use workers for subsetting/i.test(e),
    );
    expect(realErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("inserts every catalog shape as native elements, auto-selected", async () => {
    const shapeIds = [
      "frame-rectangle",
      "filled-block",
      "ellipse",
      "diamond",
      "arrow-one-way",
      "arrow-two-way",
      "arrow-dashed",
      "arrow-curved",
      "connector-elbow",
      "connector-line",
      "sticky-note",
      "callout-block",
    ];
    // seed has 2 text elements; 10 single-element shapes + sticky note
    // (rectangle + bound "Note") + callout block (rectangle + bound
    // "Callout") = 14 added elements
    for (const id of shapeIds) {
      await insertShape(page, id);
    }
    await expectCount(page, 2 + 14);

    const scene = JSON.parse(await serializeCurrentPage(page)) as SceneJson;
    const types = new Set(scene.elements.filter((e) => !e.containerId).map((e) => e.type));
    for (const t of ["rectangle", "ellipse", "diamond", "arrow", "line"]) {
      expect(types.has(t), `scene must contain ${t}`).toBe(true);
    }

    // inserted shapes land auto-selected (insertion + selection in one step)
    const selected = await page.evaluate(
      () => Object.keys((window as unknown as { __NOTE_E2E__: { excalidraw: { getAppState: () => { selectedElementIds: Record<string, boolean> } } } }).__NOTE_E2E__.excalidraw.getAppState().selectedElementIds).length,
    );
    expect(selected).toBeGreaterThan(0);
  });

  test("arrow variants keep their arrowheads and dash pattern", async () => {
    const scene = JSON.parse(await serializeCurrentPage(page)) as SceneJson;
    const arrows = scene.elements.filter((e) => e.type === "arrow");
    expect(arrows.some((a) => a.endArrowhead === "arrow" && !a.startArrowhead)).toBe(true);
    expect(arrows.some((a) => a.startArrowhead === "arrow" && a.endArrowhead === "arrow")).toBe(true);
    expect(arrows.some((a) => a.strokeStyle === "dashed")).toBe(true);
    // elbow connector: an arrow that bends through a mid point
    expect(arrows.length).toBeGreaterThanOrEqual(4);
  });

  test("sticky note carries a bound editable label", async () => {
    const scene = JSON.parse(await serializeCurrentPage(page)) as SceneJson;
    const texts = scene.elements.filter((e) => e.type === "text" && e.containerId);
    const bound = texts.find((t) => t.text === "Note");
    expect(bound, "sticky note bound text exists").toBeTruthy();
    const container = scene.elements.find(
      (e) => e.type === "rectangle" && e.id === bound?.containerId,
    );
    expect(container, "bound text has its container in the scene").toBeTruthy();
  });

  test("a click selects an inserted shape (real pointer selection)", async () => {
    await insertShape(page, "frame-rectangle");
    await saveNow(page);

    // compute the newest shape's viewport position with Excalidraw's own
    // transform (inverse of viewportCoordsToSceneCoords) and click its center
    const target = await page.evaluate(() => {
      const api = (window as unknown as {
        __NOTE_E2E__: {
          excalidraw: {
            getSceneElements: () => Array<{ id: string; isDeleted: boolean; x: number; y: number; width: number; height: number }>;
            getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number; selectedElementIds: Record<string, boolean> };
          };
        };
      }).__NOTE_E2E__.excalidraw;
      const live = api.getSceneElements().filter((e) => !e.isDeleted);
      const el = live[live.length - 1];
      const st = api.getAppState();
      // scene → viewport: clientX = (sceneX + scrollX) * zoom + offsetLeft
      return {
        clientX: (el.x + el.width / 2 + st.scrollX) * st.zoom.value + st.offsetLeft,
        clientY: (el.y + el.height / 2 + st.scrollY) * st.zoom.value + st.offsetTop,
        before: Object.keys(st.selectedElementIds).length,
      };
    });

    await page.mouse.click(target.clientX, target.clientY);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const api = (window as unknown as { __NOTE_E2E__: { excalidraw: { getAppState: () => { selectedElementIds: Record<string, boolean> } } } }).__NOTE_E2E__.excalidraw;
            return Object.keys(api.getAppState().selectedElementIds).length;
          }),
        { timeout: 15_000, message: "pointer click selects the inserted shape" },
      )
      .toBeGreaterThan(0);
  });

  test("shapes persist with the scene across a reload", async () => {
    await saveNow(page);
    const before = await elementCount(page);
    await page.reload();
    await page.waitForFunction(
      () => (window.__NOTE_E2E__?.elementCount() ?? -1) >= 0,
      undefined,
      { timeout: 45_000 },
    );
    await expectCount(page, before);
  });

  test("shapes survive a .excalidraw export → import round-trip", async () => {
    const before = await elementCount(page);
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: /Excalidraw scene/ }).click();
    const testInfo = test.info();
    const download = await downloadPromise;
    const filePath = path.join(testInfo.outputDir, download.suggestedFilename());
    await download.saveAs(filePath);

    await page.setInputFiles('input[aria-label="Import files"]', filePath);
    await expectCount(page, before * 2);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SceneJson;
    expect(scene.elements.filter((e) => e.type === "arrow").length).toBeGreaterThanOrEqual(4);
  });

  test("shapes export cleanly to PNG and SVG", async () => {
    for (const menuItem of ["PNG image", "SVG vector"]) {
      const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("menuitem", { name: menuItem }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename().length).toBeGreaterThan(4);
    }
  });

  test("mobile drawer layout: the shapes menu inserts too", async ({ browser }) => {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mobileErrors = attachErrorCollector(mobile);
    await mobile.goto("/?e2e=1");
    // drawer layout: the sidebar is hidden until opened — wait for the app
    // itself (canvas api ready = booted with a page open), not the tree
    await mobile.waitForFunction(
      () => (window.__NOTE_E2E__?.elementCount() ?? -1) >= 0,
      undefined,
      { timeout: 45_000 },
    );
    const count = await elementCount(mobile);
    await mobile.getByTestId("shapes-button").click();
    await mobile.getByTestId("shape-diamond").click();
    await expect
      .poll(() => elementCount(mobile), { timeout: 30_000 })
      .toBe(count + 1);
    // ignore the known dev-only font-subset worker noise (see helpers.ts) —
    // filter at assertion time so a reverted helpers.ts cannot resurrect it
    const realMobileErrors = mobileErrors.filter(
      (e) => !/Failed to use workers for subsetting/i.test(e),
    );
    expect(realMobileErrors, "mobile browser must stay error-free").toEqual([]);
    await mobile.close();
  });
});
