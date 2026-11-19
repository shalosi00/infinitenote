/**
 * Tables on pages (issue #277, test plan: docs/test-plans/table.md, ids TB-E*).
 * Real canvas, no mocks: a table inserts from the header toolbar as NATIVE
 * Excalidraw elements ((rows+1)+(cols+1) border lines + white cell containers,
 * one shared group, customData markers), cells type via double-click (the
 * non-transparent-container text flow), the structural ops run from the
 * cell's right-click menu and rebuild in one step, the 1×1 floor and the
 * 20×12 caps refuse with explicit toasts, everything survives reload, and
 * cell text is indexed by the existing full-text search with no changes.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  saveNow,
  scrollToContent,
  serializeCurrentPage,
} from "./helpers";

interface TableScene {
  elements: Array<{
    type: string;
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    isDeleted?: boolean;
    containerId?: string | null;
    text?: string;
    boundElements?: Array<{ id: string; type: string }> | null;
    groupIds?: string[];
    customData?: Record<string, unknown> | null;
  }>;
}

interface Marker {
  tableId: string;
  kind: "cell" | "border-h" | "border-v";
  row: number;
  col: number;
}

function markerOf(el: TableScene["elements"][number]): Marker | null {
  const raw = el.customData?.["infinitenote:table"];
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<Marker>;
  if (typeof m.tableId !== "string" || !m.kind || typeof m.row !== "number" || typeof m.col !== "number") {
    return null;
  }
  return m as Marker;
}

function liveElements(scene: TableScene) {
  return scene.elements.filter((e) => !e.isDeleted);
}

function cellsOf(scene: TableScene) {
  return liveElements(scene).filter((e) => markerOf(e)?.kind === "cell");
}

function bordersOf(scene: TableScene, kind: "border-h" | "border-v") {
  return liveElements(scene).filter((e) => markerOf(e)?.kind === kind);
}

function boundText(scene: TableScene, value: string) {
  return liveElements(scene).find(
    (e) => e.type === "text" && e.containerId && e.text === value,
  );
}

async function loadScene(page: Page): Promise<TableScene> {
  return JSON.parse(await serializeCurrentPage(page)) as TableScene;
}

/**
 * Scene → viewport with Excalidraw's own transform (the shape-spec
 * pattern): clientX = (sceneX + scrollX) * zoom + offsetLeft.
 */
async function scenePointToViewport(
  page: Page,
  sx: number,
  sy: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const hooks = (
      window as unknown as {
        __NOTE_E2E__?: {
          excalidraw: {
            getAppState: () => {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
              offsetLeft: number;
              offsetTop: number;
            };
          };
        };
      }
    ).__NOTE_E2E__;
    if (!hooks) throw new Error("e2e hooks missing");
    const st = hooks.excalidraw.getAppState();
    return {
      x: (x + st.scrollX) * st.zoom.value + st.offsetLeft,
      y: (y + st.scrollY) * st.zoom.value + st.offsetTop,
    };
  }, [sx, sy]);
}

/** Center of a specific table cell in viewport coords. */
async function cellCenter(
  page: Page,
  scene: TableScene,
  row: number,
  col: number,
): Promise<{ x: number; y: number }> {
  const cell = cellsOf(scene).find((e) => markerOf(e)!.row === row && markerOf(e)!.col === col);
  expect(cell, `cell (${row}, ${col}) exists in the scene`).toBeTruthy();
  const vp = await scenePointToViewport(
    page,
    (cell!.x ?? 0) + (cell!.width ?? 0) / 2,
    (cell!.y ?? 0) + (cell!.height ?? 0) / 2,
  );
  return vp;
}

async function insertTable(page: Page, rows: string, cols: string): Promise<void> {
  await page.getByTestId("table-button").click();
  const menu = page.getByTestId("table-menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("table-rows-input").fill(rows);
  await page.getByTestId("table-cols-input").fill(cols);
  await page.getByTestId("table-insert-button").click();
  await menu.waitFor({ state: "hidden", timeout: 10_000 });
}

/** Right-click a cell and run one context-menu action (issue #277). */
async function tableOp(
  page: Page,
  row: number,
  col: number,
  itemTestid: string,
): Promise<void> {
  await scrollToContent(page);
  const center = await cellCenter(page, await loadScene(page), row, col);
  await page.mouse.click(center.x, center.y, { button: "right" });
  const menu = page.getByTestId("table-context-menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await menu.getByTestId(itemTestid).click();
  await menu.waitFor({ state: "hidden", timeout: 10_000 });
}

test.describe.serial("tables on pages (issue #277)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    const realErrors = (consoleErrors ?? []).filter(
      (e) => !/Failed to use workers for subsetting/i.test(e),
    );
    expect(realErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("TB-E01: a 2×3 table inserts as native marked elements", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await insertTable(page, "2", "3");
    await expectCount(page, 13); // 6 cells + 3 h-borders + 4 v-borders; empty labels ship no text children

    const scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(6);
    expect(bordersOf(scene, "border-h").length).toBe(3);
    expect(bordersOf(scene, "border-v").length).toBe(4);
    // every table element is marked; cells deliberately stay UNGROUPED —
    // Excalidraw's double-click turns an already-selected GROUP into
    // group-leaf selection and returns (handleCanvasDoubleClick's
    // selectedGroupIds branch, 0.18.1), so a grouped cell could never reach
    // the double-click-to-type flow. The OneNote behavior — click into a
    // cell, type — wins; ops key off customData markers, not selection.
    const tableEls = liveElements(scene).filter((e) => markerOf(e));
    expect(tableEls.length).toBe(13);
    expect(tableEls.flatMap((e) => e.groupIds ?? []).length).toBe(0);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        expect(
          cellsOf(scene).some((e) => markerOf(e)!.row === r && markerOf(e)!.col === c),
          `cell (${r}, ${c}) marked`,
        ).toBe(true);
      }
    }
    // cells are opaque white rectangles (clickable + double-click-to-type)
    expect(cellsOf(scene)[0].type).toBe("rectangle");
    await saveNow(page);
  });

  test("TB-E02: double-click types into a cell like OneNote", async () => {
    await scrollToContent(page);
    const center = await cellCenter(page, await loadScene(page), 0, 0);
    await page.mouse.dblclick(center.x, center.y);
    await page.keyboard.type("revenue Q1");
    await page.keyboard.press("Escape");
    await saveNow(page);

    const scene = await loadScene(page);
    const bound = boundText(scene, "revenue Q1");
    expect(bound, "the typed text is bound to the cell container").toBeTruthy();
    const host = cellsOf(scene).find((e) => e.id === bound!.containerId);
    expect(host, "the bound text's container is the (0,0) cell").toBeTruthy();
    expect(markerOf(host!)!.row).toBe(0);
    expect(markerOf(host!)!.col).toBe(0);
  });

  test("TB-E03: Add row below grows the grid and keeps every text", async () => {
    await tableOp(page, 0, 1, "table-menu-add-row-below");
    const scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(9);
    expect(bordersOf(scene, "border-h").length).toBe(4);
    expect(Math.max(...cellsOf(scene).map((e) => markerOf(e)!.row))).toBe(2);
    // the typed text survived the rebuild, still bound to a cell
    const bound = boundText(scene, "revenue Q1");
    expect(bound).toBeTruthy();
    expect(cellsOf(scene).some((e) => e.id === bound!.containerId)).toBe(true);
    await saveNow(page);
  });

  test("TB-E04: Add column right grows the grid and keeps every text", async () => {
    await tableOp(page, 0, 0, "table-menu-add-col-right");
    const scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(12);
    expect(bordersOf(scene, "border-v").length).toBe(5);
    expect(Math.max(...cellsOf(scene).map((e) => markerOf(e)!.col))).toBe(3);
    expect(boundText(scene, "revenue Q1")).toBeTruthy();
    await saveNow(page);
  });

  test("TB-E05: Delete row / Delete column shrink the grid", async () => {
    // grid is 3 rows × 4 cols; drop row 1 (empty) and the last column
    await tableOp(page, 1, 0, "table-menu-delete-row");
    let scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(8);
    expect(boundText(scene, "revenue Q1")).toBeTruthy();
    await tableOp(page, 0, 3, "table-menu-delete-col");
    scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(6);
    expect(bordersOf(scene, "border-h").length).toBe(3);
    expect(bordersOf(scene, "border-v").length).toBe(4);
    await saveNow(page);
  });

  test("TB-E06: the reload restores markers and texts", async () => {
    const before = await loadScene(page);
    const markedBefore = liveElements(before).filter((e) => markerOf(e)).length;
    expect(markedBefore).toBeGreaterThan(0);
    const liveBefore = liveElements(before).length;
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, liveBefore, 45_000);

    const after = await loadScene(page);
    expect(liveElements(after).filter((e) => markerOf(e)).length).toBe(markedBefore);
    expect(boundText(after, "revenue Q1")).toBeTruthy();
  });

  test("TB-E07: the 1×1 floor refuses with an explicit toast", async () => {
    // shrink 2×3 down to 1×1: delete row 1, then columns 2 and 1
    await tableOp(page, 1, 0, "table-menu-delete-row");
    await tableOp(page, 0, 2, "table-menu-delete-col");
    await tableOp(page, 0, 1, "table-menu-delete-col");
    let scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(1);

    await tableOp(page, 0, 0, "table-menu-delete-row");
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "A table needs at least one row." }).first(),
    ).toBeVisible();
    scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(1); // refused — nothing changed
    await saveNow(page);
  });

  test("TB-E08: out-of-bounds insert sizes toast and do nothing", async () => {
    await insertTable(page, "21", "3");
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Tables support 1-20 rows and 1-12 columns." })
        .first(),
    ).toBeVisible();
    await insertTable(page, "3", "13");
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Tables support 1-20 rows and 1-12 columns." })
        .first(),
    ).toBeVisible();
  });

  test("TB-E09: Delete table removes every marked element", async () => {
    await tableOp(page, 0, 0, "table-menu-delete-table");
    const scene = await loadScene(page);
    expect(liveElements(scene).filter((e) => markerOf(e)).length).toBe(0);
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Table deleted." }).first(),
    ).toBeVisible();
    await saveNow(page);
  });

  test("TB-E11: the page-actions path inserts OneNote's starter 3×3 grid", async () => {
    // the toolbar popover hides below sm (640px) — the overlap audit pinned
    // that; phones insert via the ⋯ page-actions menu. Same CanvasApi call,
    // OneNote's starter grid, structural ops grow it from there.
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await page.getByTestId("page-actions").click();
    const menu = page.getByTestId("page-actions-menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    await menu.getByTestId("page-actions-insert-table").click();
    await menu.waitFor({ state: "hidden", timeout: 10_000 });
    await expectCount(page, 17); // 9 cells + 4 h-borders + 4 v-borders
    const scene = await loadScene(page);
    expect(cellsOf(scene).length).toBe(9);
    expect(Math.max(...cellsOf(scene).map((e) => markerOf(e)!.row))).toBe(2);
    expect(Math.max(...cellsOf(scene).map((e) => markerOf(e)!.col))).toBe(2);
    await saveNow(page);
  });

  test("TB-E10: cell text is searchable — zero search changes", async () => {
    // fresh table with a typed phrase on this page
    await insertTable(page, "2", "2");
    await scrollToContent(page);
    const center = await cellCenter(page, await loadScene(page), 0, 0);
    await page.mouse.dblclick(center.x, center.y);
    await page.keyboard.type("quarterly numbers");
    await page.keyboard.press("Escape");
    await saveNow(page);

    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await expect(input).toBeVisible();
    await input.fill("quarterly numbers");
    const results = page.locator("[cmdk-list]");
    await expect(results).toContainText("quarterly numbers", { timeout: 15_000 });
    await page.keyboard.press("Escape");
  });
});
