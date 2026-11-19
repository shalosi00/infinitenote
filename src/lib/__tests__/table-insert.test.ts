/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  CELL_FILL,
  DEFAULT_CELL_H,
  DEFAULT_CELL_W,
  INHERIT_STROKE,
  TABLE_MARKER_KEY,
  cellTexts,
  emptyTexts,
  hitTableCell,
  isTableElement,
  planTableOp,
  readTableMarker,
  tableElements,
  tableGeometry,
  tableSkeletons,
  type TableElementLike,
  type TableGeometry,
} from "../table-insert";

const TABLE_ID = "tbl-1";

/** Build a synthetic live scene for a rows×cols table at (x0, y0). */
function sceneFor(geo: TableGeometry, texts: string[][]): TableElementLike[] {
  const els: TableElementLike[] = [];
  // a non-table element first — every selector below must ignore it
  els.push({ id: "stray-1", type: "freedraw", x: 0, y: 0 });
  const skeletons = tableSkeletons(geo, texts, (marker) => `sk-${marker.kind}-${marker.row}-${marker.col}`);
  for (const sk of skeletons) {
    const el: TableElementLike = {
      id: sk.id,
      type: sk.type,
      x: sk.x,
      y: sk.y,
      width: sk.width,
      height: sk.height,
      isDeleted: false,
      boundElements: sk.type === "rectangle" ? [] : null,
      customData: { [TABLE_MARKER_KEY]: sk.marker },
    };
    els.push(el);
    if (sk.type === "rectangle" && sk.label?.text) {
      const textId = `txt-${sk.id}`;
      el.boundElements = [{ id: textId, type: "text" }];
      els.push({
        id: textId,
        type: "text",
        containerId: sk.id,
        text: sk.label.text,
        isDeleted: false,
      });
    }
  }
  return els;
}

const GEO: TableGeometry = {
  tableId: TABLE_ID,
  x0: 100,
  y0: 200,
  rows: 2,
  cols: 3,
  cellW: DEFAULT_CELL_W,
  cellH: DEFAULT_CELL_H,
};

describe("table insert: markers (issue #277)", () => {
  it("round-trips a marker through customData", () => {
    const el: TableElementLike = {
      id: "e1",
      type: "rectangle",
      customData: { [TABLE_MARKER_KEY]: { tableId: TABLE_ID, kind: "cell", row: 1, col: 2 } },
    };
    expect(readTableMarker(el.customData)).toEqual({
      tableId: TABLE_ID,
      kind: "cell",
      row: 1,
      col: 2,
    });
    expect(isTableElement(el)).toBe(true);
  });

  it("rejects malformed markers", () => {
    expect(readTableMarker(undefined)).toBeNull();
    expect(readTableMarker(null)).toBeNull();
    expect(readTableMarker({})).toBeNull();
    expect(readTableMarker({ [TABLE_MARKER_KEY]: "nope" })).toBeNull();
    expect(
      readTableMarker({ [TABLE_MARKER_KEY]: { tableId: "", kind: "cell", row: 0, col: 0 } }),
    ).toBeNull();
    expect(
      readTableMarker({ [TABLE_MARKER_KEY]: { tableId: "t", kind: "diagonal", row: 0, col: 0 } }),
    ).toBeNull();
    expect(
      readTableMarker({ [TABLE_MARKER_KEY]: { tableId: "t", kind: "cell", row: "x", col: 0 } }),
    ).toBeNull();
    // other modules' customData must never match
    expect(readTableMarker({ audioData: "data:audio/webm;base64,xx" })).toBeNull();
    expect(readTableMarker({ pdfName: "x.pdf", pdfData: "data:application/pdf;base64,xx" })).toBeNull();
  });
});

describe("table insert: skeletons (issue #277)", () => {
  it("produces (rows+1)+(cols+1) borders and rows×cols cells", () => {
    const skeletons = tableSkeletons(GEO, emptyTexts(2, 3), (m) => `${m.kind}-${m.row}-${m.col}`);
    expect(skeletons.filter((s) => s.marker.kind === "border-h").length).toBe(3);
    expect(skeletons.filter((s) => s.marker.kind === "border-v").length).toBe(4);
    expect(skeletons.filter((s) => s.marker.kind === "cell").length).toBe(6);
    expect(skeletons.length).toBe(13);
  });

  it("draws the grid exactly: border extents and cell origins", () => {
    const skeletons = tableSkeletons(GEO, emptyTexts(2, 3), (m) => `${m.kind}-${m.row}-${m.col}`);
    const totalW = 3 * DEFAULT_CELL_W;
    const totalH = 2 * DEFAULT_CELL_H;
    for (let i = 0; i <= 2; i++) {
      const h = skeletons.find((s) => s.marker.kind === "border-h" && s.marker.row === i)!;
      expect(h.x).toBe(100);
      expect(h.y).toBe(200 + i * DEFAULT_CELL_H);
      expect(h.points).toEqual([
        [0, 0],
        [totalW, 0],
      ]);
    }
    for (let i = 0; i <= 3; i++) {
      const v = skeletons.find((s) => s.marker.kind === "border-v" && s.marker.col === i)!;
      expect(v.x).toBe(100 + i * DEFAULT_CELL_W);
      expect(v.y).toBe(200);
      expect(v.points).toEqual([
        [0, 0],
        [0, totalH],
      ]);
    }
    const cell21 = skeletons.find((s) => s.marker.kind === "cell" && s.marker.row === 1 && s.marker.col === 2)!;
    expect(cell21.x).toBe(100 + 2 * DEFAULT_CELL_W);
    expect(cell21.y).toBe(200 + 1 * DEFAULT_CELL_H);
    expect(cell21.width).toBe(DEFAULT_CELL_W);
    expect(cell21.height).toBe(DEFAULT_CELL_H);
    // cells are white-filled, stroke-transparent (borders ARE the grid)
    expect(cell21.backgroundColor).toBe(CELL_FILL);
    expect(cell21.strokeColor).toBe("transparent");
    expect(cell21.fillStyle).toBe("solid");
    // borders inherit the toolbar stroke
    const h0 = skeletons.find((s) => s.marker.kind === "border-h" && s.marker.row === 0)!;
    expect(h0.strokeColor).toBe(INHERIT_STROKE);
  });

  it("carries the cell text into the label and marks every skeleton", () => {
    const texts = [
      ["a", "b", "c"],
      ["d", "e", "f"],
    ];
    const skeletons = tableSkeletons(GEO, texts, (m) => `${m.kind}-${m.row}-${m.col}`);
    for (const sk of skeletons) {
      expect(sk.id.length).toBeGreaterThan(0);
      expect(sk.marker.tableId).toBe(TABLE_ID);
    }
    const cellB = skeletons.find((s) => s.marker.kind === "cell" && s.marker.row === 0 && s.marker.col === 1)!;
    expect(cellB.label?.text).toBe("b");
    const cellA = skeletons.find((s) => s.marker.kind === "cell" && s.marker.row === 0 && s.marker.col === 0)!;
    expect(cellA.label?.text).toBe("a");
  });

  it("tolerates a texts grid smaller than the grid (missing cells read empty)", () => {
    const skeletons = tableSkeletons(GEO, [["only"]], (m) => `${m.kind}-${m.row}-${m.col}`);
    const cell22 = skeletons.find((s) => s.marker.kind === "cell" && s.marker.row === 1 && s.marker.col === 2)!;
    expect(cell22.label?.text).toBe("");
  });
});

describe("table insert: geometry + texts from a scene (issue #277)", () => {
  it("reconstructs the grid and reads bound texts", () => {
    const texts = [
      ["alpha", "", "gamma"],
      ["", "beta", ""],
    ];
    const scene = sceneFor(GEO, texts);
    const geo = tableGeometry(scene, TABLE_ID);
    expect(geo).toEqual({ tableId: TABLE_ID, x0: 100, y0: 200, rows: 2, cols: 3, cellW: DEFAULT_CELL_W, cellH: DEFAULT_CELL_H });
    expect(cellTexts(scene, geo!)).toEqual(texts);
  });

  it("reads never-typed cells as empty strings", () => {
    const scene = sceneFor(GEO, emptyTexts(2, 3));
    expect(cellTexts(scene, tableGeometry(scene, TABLE_ID)!)).toEqual(emptyTexts(2, 3));
  });

  it("ignores deleted elements", () => {
    const scene = sceneFor(GEO, emptyTexts(2, 3));
    for (const el of scene) {
      if (readTableMarker(el.customData)?.kind === "cell") el.isDeleted = true;
    }
    expect(tableGeometry(scene, TABLE_ID)).toBeNull();
    expect(tableElements(scene, TABLE_ID).length).toBe(7); // borders only
  });

  it("returns null for an unknown tableId and ignores foreign tables", () => {
    const scene = sceneFor(GEO, emptyTexts(2, 3));
    expect(tableGeometry(scene, "tbl-other")).toBeNull();
    expect(tableElements(scene, "tbl-other")).toEqual([]);
  });
});

describe("table insert: ops (issue #277)", () => {
  it("insert-row grows the grid and keeps every text", () => {
    const texts = [
      ["r0c0", "r0c1", "r0c2"],
      ["r1c0", "r1c1", "r1c2"],
    ];
    const scene = sceneFor(GEO, texts);
    const plan = planTableOp(scene, TABLE_ID, { type: "insert-row", at: 0 });
    expect(plan.kind).toBe("rebuild");
    if (plan.kind !== "rebuild") return;
    expect(plan.geo.rows).toBe(3);
    expect(plan.geo.cols).toBe(3);
    expect(plan.texts).toEqual([
      ["r0c0", "r0c1", "r0c2"],
      ["", "", ""],
      ["r1c0", "r1c1", "r1c2"],
    ]);
    // geometry origin does not move: the rebuild shifts rows via row*cellH
    expect(plan.geo.x0).toBe(100);
    expect(plan.geo.y0).toBe(200);
  });

  it("insert-col grows the grid and keeps every text", () => {
    const scene = sceneFor({ ...GEO, cols: 2 }, [["a", "b"], ["c", "d"]]);
    const plan = planTableOp(scene, TABLE_ID, { type: "insert-col", at: 1 });
    if (plan.kind !== "rebuild") throw new Error("expected a rebuild plan");
    expect(plan.geo.cols).toBe(3);
    expect(plan.texts).toEqual([
      ["a", "b", ""],
      ["c", "d", ""],
    ]);
  });

  it("delete-row removes exactly that row's texts", () => {
    const scene = sceneFor(GEO, [["a", "b", "c"], ["d", "e", "f"]]);
    const plan = planTableOp(scene, TABLE_ID, { type: "delete-row", at: 0 });
    if (plan.kind !== "rebuild") throw new Error("expected a rebuild plan");
    expect(plan.geo.rows).toBe(1);
    expect(plan.texts).toEqual([["d", "e", "f"]]);
  });

  it("delete-col removes exactly that column's texts", () => {
    const scene = sceneFor(GEO, [["a", "b", "c"], ["d", "e", "f"]]);
    const plan = planTableOp(scene, TABLE_ID, { type: "delete-col", at: 2 });
    if (plan.kind !== "rebuild") throw new Error("expected a rebuild plan");
    expect(plan.geo.cols).toBe(2);
    expect(plan.texts).toEqual([
      ["a", "b"],
      ["d", "e"],
    ]);
  });

  it("plans a whole-table delete", () => {
    const scene = sceneFor(GEO, emptyTexts(2, 3));
    expect(planTableOp(scene, TABLE_ID, { type: "delete-table" })).toEqual({ kind: "delete" });
  });

  it("hitTableCell finds the cell under the point (and only cells)", () => {
    const scene = sceneFor(GEO, emptyTexts(2, 3));
    expect(hitTableCell(scene, 100 + 1, 200 + 1)).toEqual({ tableId: TABLE_ID, row: 0, col: 0 });
    expect(hitTableCell(scene, 100 + DEFAULT_CELL_W * 2 + 5, 200 + DEFAULT_CELL_H + 5)).toEqual({
      tableId: TABLE_ID,
      row: 1,
      col: 2,
    });
    // a point outside every cell (just past the last border)
    expect(
      hitTableCell(scene, 100 + DEFAULT_CELL_W * 3 + 1, 200 + 1),
    ).toBeNull();
    // the top border line of row 0 sits exactly at y0 — one pixel above no cell
    expect(hitTableCell(scene, 150, 199)).toBeNull();
  });
});
