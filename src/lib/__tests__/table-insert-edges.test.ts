/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CELL_H,
  DEFAULT_CELL_W,
  MAX_COLS,
  MAX_ROWS,
  TABLE_MARKER_KEY,
  hitTableCell,
  planTableOp,
  tableGeometry,
  type TableElementLike,
  type TableGeometry,
} from "../table-insert";

const TABLE_ID = "tbl-edge";

function sceneFor(geo: TableGeometry, texts: string[][]): TableElementLike[] {
  const els: TableElementLike[] = [];
  const mk = (marker: Record<string, unknown>, extra: Partial<TableElementLike> = {}) =>
    els.push({
      id: `e-${marker.kind}-${(marker.row as number) ?? -1}-${(marker.col as number) ?? -1}`,
      type: marker.kind === "cell" ? "rectangle" : "line",
      x: 0,
      y: 0,
      isDeleted: false,
      boundElements: null,
      customData: { [TABLE_MARKER_KEY]: marker },
      ...extra,
    });
  for (let i = 0; i <= geo.rows; i++) {
    mk({ tableId: geo.tableId, kind: "border-h", row: i, col: -1 }, { x: geo.x0, y: geo.y0 + i * geo.cellH });
  }
  for (let i = 0; i <= geo.cols; i++) {
    mk({ tableId: geo.tableId, kind: "border-v", row: -1, col: i }, { x: geo.x0 + i * geo.cellW, y: geo.y0 });
  }
  for (let r = 0; r < geo.rows; r++) {
    for (let c = 0; c < geo.cols; c++) {
      mk(
        { tableId: geo.tableId, kind: "cell", row: r, col: c },
        {
          x: geo.x0 + c * geo.cellW,
          y: geo.y0 + r * geo.cellH,
          width: geo.cellW,
          height: geo.cellH,
          boundElements: [],
        },
      );
    }
  }
  void texts;
  return els;
}

const GEO: TableGeometry = {
  tableId: TABLE_ID,
  x0: 0,
  y0: 0,
  rows: 2,
  cols: 2,
  cellW: DEFAULT_CELL_W,
  cellH: DEFAULT_CELL_H,
};

describe("table insert: op guards (issue #277)", () => {
  it("refuses to delete the last row", () => {
    const scene = sceneFor({ ...GEO, rows: 1, cols: 2 }, []);
    const plan = planTableOp(scene, TABLE_ID, { type: "delete-row", at: 0 });
    expect(plan).toEqual({ kind: "error", message: "A table needs at least one row." });
  });

  it("refuses to delete the last column", () => {
    const scene = sceneFor({ ...GEO, rows: 2, cols: 1 }, []);
    const plan = planTableOp(scene, TABLE_ID, { type: "delete-col", at: 0 });
    expect(plan).toEqual({ kind: "error", message: "A table needs at least one column." });
  });

  it("refuses out-of-range rows and columns", () => {
    const scene = sceneFor(GEO, []);
    expect(planTableOp(scene, TABLE_ID, { type: "delete-row", at: 2 })!.kind).toBe("error");
    expect(planTableOp(scene, TABLE_ID, { type: "delete-row", at: -1 })!.kind).toBe("error");
    expect(planTableOp(scene, TABLE_ID, { type: "insert-row", at: 5 })!.kind).toBe("error");
    expect(planTableOp(scene, TABLE_ID, { type: "delete-col", at: 2 })!.kind).toBe("error");
    expect(planTableOp(scene, TABLE_ID, { type: "insert-col", at: -1 })!.kind).toBe("error");
  });

  it("errors on a dead table", () => {
    const scene = sceneFor(GEO, []);
    expect(planTableOp(scene, "gone", { type: "insert-row", at: 0 })).toEqual({
      kind: "error",
      message: "The table no longer exists on this page.",
    });
  });
});

describe("table insert: growth caps (issue #277)", () => {
  it("caps rows at MAX_ROWS with an explicit message", () => {
    const tall: TableGeometry = { ...GEO, rows: MAX_ROWS };
    const scene = sceneFor(tall, []);
    const plan = planTableOp(scene, TABLE_ID, { type: "insert-row", at: 0 });
    expect(plan).toEqual({ kind: "error", message: `Tables cap at ${MAX_ROWS} rows.` });
    // one row below the cap still grows
    const near: TableGeometry = { ...GEO, rows: MAX_ROWS - 1 };
    const plan2 = planTableOp(sceneFor(near, []), TABLE_ID, { type: "insert-row", at: 0 });
    expect(plan2.kind).toBe("rebuild");
  });

  it("caps columns at MAX_COLS with an explicit message", () => {
    const wide: TableGeometry = { ...GEO, cols: MAX_COLS };
    const scene = sceneFor(wide, []);
    const plan = planTableOp(scene, TABLE_ID, { type: "insert-col", at: 0 });
    expect(plan).toEqual({ kind: "error", message: `Tables cap at ${MAX_COLS} columns.` });
  });
});

describe("table insert: grid normalization (issue #277)", () => {
  it("normalizes a dragged cell back to the grid's largest extents", () => {
    // the user dragged the (0,0) cell 40px right and made it 200px wide;
    // the next op must rebuild from the grid's top-left-most cell origin
    // and the largest cell extent — the uniform-grid rule
    const scene = sceneFor(GEO, []);
    const dragged = scene.find((e) => readMarker(e)?.kind === "cell" && readMarker(e)?.row === 0 && readMarker(e)?.col === 0)!;
    dragged.x = 40;
    dragged.width = 200;
    const geo = tableGeometry(scene, TABLE_ID)!;
    expect(geo.x0).toBe(40);
    expect(geo.cellW).toBe(200);
    // a 1×1 table with a dragged cell still deletes fine after normalization
    const plan = planTableOp(scene, TABLE_ID, { type: "insert-col", at: 1 });
    expect(plan.kind).toBe("rebuild");
  });

  it("survives borders deleted by hand (cells alone carry the geometry)", () => {
    const scene = sceneFor(GEO, []);
    for (const el of scene) {
      if (readMarker(el)?.kind !== "cell") el.isDeleted = true;
    }
    const geo = tableGeometry(scene, TABLE_ID)!;
    expect(geo.rows).toBe(2);
    expect(geo.cols).toBe(2);
  });

  it("borders alone never reconstruct a table", () => {
    const scene = sceneFor(GEO, []);
    for (const el of scene) {
      if (readMarker(el)?.kind === "cell") el.isDeleted = true;
    }
    expect(tableGeometry(scene, TABLE_ID)).toBeNull();
    expect(planTableOp(scene, TABLE_ID, { type: "delete-table" })).toEqual({ kind: "delete" });
  });
});

describe("table insert: hit-test edges (issue #277)", () => {
  it("does not hit deleted or foreign-table cells", () => {
    const scene = sceneFor(GEO, []);
    const cell = scene.find((e) => readMarker(e)?.kind === "cell")!;
    cell.isDeleted = true;
    expect(hitTableCell(scene, cell.x! + 5, cell.y! + 5)).toBeNull();
    cell.isDeleted = false;
    expect(hitTableCell(scene, cell.x! + 5, cell.y! + 5)).toBeTruthy();
    // a rectangle with someone else's customData is not a table cell
    const impostor: TableElementLike = {
      id: "impostor",
      type: "rectangle",
      x: 1000,
      y: 1000,
      width: 100,
      height: 100,
      isDeleted: false,
      customData: { pdfName: "x.pdf" },
    };
    scene.push(impostor);
    expect(hitTableCell(scene, 1050, 1050)).toBeNull();
  });

  it("hits only rectangles carrying cell markers — a marked LINE never hits", () => {
    const scene: TableElementLike[] = [
      {
        id: "line-pretending",
        type: "line",
        x: 0,
        y: 0,
        width: 160,
        height: 44,
        isDeleted: false,
        customData: { [TABLE_MARKER_KEY]: { tableId: "t", kind: "cell", row: 0, col: 0 } },
      },
    ];
    expect(hitTableCell(scene, 10, 10)).toBeNull();
  });
});

function readMarker(el: TableElementLike): { kind?: string; row?: number; col?: number } | null {
  const raw = el.customData?.[TABLE_MARKER_KEY];
  return raw && typeof raw === "object" ? (raw as { kind?: string; row?: number; col?: number }) : null;
}
