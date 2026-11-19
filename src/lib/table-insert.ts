/**
 * Tables on pages — OneNote "Insert > Table" parity (issue #277).
 *
 * A table is a COMPOSED structure of native Excalidraw elements (the
 * shape-library precedent, issue #65): (rows+1) horizontal and (cols+1)
 * vertical `line` elements as the borders, plus rows×cols white-filled
 * `rectangle` cell containers. Cells are pure containers — no bound text
 * ships with them (Excalidraw's transform skips empty labels), and
 * double-clicking inside a non-transparent container creates and edits its
 * bound text on the fly (App.tsx dblclick path: any hit inside a
 * non-transparent bindable shape snaps to the container center and starts
 * text editing). OneNote behavior: click into a cell, type.
 *
 * Identity: every table element carries `customData[TABLE_MARKER_KEY]`
 * (the audio/PDF-chip pattern, issues #67/#204) with `{ tableId, kind,
 * row, col }`; all elements of one table share `groupIds: [tableId]` so a
 * single click selects the whole table. The marker is undo-safe by
 * construction: undo removes whole elements — including their customData —
 * and the measured HWR-E06 staleness only bit when a flag had to survive
 * on an element that a LATER undo left in place.
 *
 * Structural ops are REBUILD-based and pure: add/delete row/column reads
 * the current geometry plus the per-cell bound texts and returns a new
 * uniform grid + text grid; the caller swaps the old elements for the
 * rebuilt ones in ONE updateScene (one undo step, the conversion
 * precedent). The grid is uniform by design (OneNote's is too): individual
 * cell drags are normalized back on the next structural op.
 *
 * This module is PURE — no imports from @excalidraw/excalidraw — so it
 * runs identically in the browser bundle, in bun unit tests and during
 * SSR. The runtime conversion + insertion live in `excalidraw-client.ts`.
 */

/** Marker scheme: the customData key that marks a table element. */
export const TABLE_MARKER_KEY = "infinitenote:table";

/** Resolve at insert time to the user's current toolbar stroke color (shape-library precedent). */
export const INHERIT_STROKE = "inherit:stroke";

/** Cell text color — resolved to the container's stroke at conversion time; cells are stroke-transparent, so the skeleton carries the inherit sentinel directly on the label. */
export const CELL_FILL = "#ffffff";

export type TableElementKind = "cell" | "border-h" | "border-v";

export interface TableMarker {
  tableId: string;
  kind: TableElementKind;
  /** cell: its row | border-h: the line index (0..rows) | border-v: -1 */
  row: number;
  /** cell: its column | border-h: -1 | border-v: the line index (0..cols) */
  col: number;
}

export interface TableGeometry {
  tableId: string;
  x0: number;
  y0: number;
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
}

/** Bounds for the insert UI and the structural ops (1×1 is the floor). */
export const MIN_ROWS = 1;
export const MAX_ROWS = 20;
export const MIN_COLS = 1;
export const MAX_COLS = 12;
export const DEFAULT_CELL_W = 160;
export const DEFAULT_CELL_H = 44;
export const CELL_FONT_SIZE = 16;

/** The minimal scene-element shape this module needs (structural typing). */
export interface TableElementLike {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  /** Text elements carry their container's id (bound cell labels). */
  containerId?: string | null;
  /** Text elements carry their body (bound cell labels). */
  text?: string;
  boundElements?: Array<{ id: string; type: string }> | null;
  customData?: Record<string, unknown> | null;
}

export interface TableTextLike extends TableElementLike {
  text?: string;
  containerId?: string | null;
}

/**
 * One skeleton for the table: geometry + the marker that stamps customData
 * after conversion. `id` is assigned by the caller (fresh UUID per insert,
 * the insertShapeById precedent) and doubles as the conversion identity —
 * convertToExcalidrawElements keeps skeleton ids under regenerateIds:false.
 */
export interface TableSkeleton {
  id: string;
  marker: TableMarker;
  type: "line" | "rectangle";
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  strokeColor: string;
  backgroundColor: string;
  /** Lines (borders) carry no fill style. */
  fillStyle?: string;
  strokeWidth: number;
  label?: { text: string; fontSize?: number };
}

/** Validate + read a table marker off an element's customData. */
export function readTableMarker(customData: Record<string, unknown> | null | undefined): TableMarker | null {
  if (!customData) return null;
  const raw = customData[TABLE_MARKER_KEY];
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<TableMarker>;
  if (typeof m.tableId !== "string" || !m.tableId) return null;
  if (m.kind !== "cell" && m.kind !== "border-h" && m.kind !== "border-v") return null;
  if (typeof m.row !== "number" || !Number.isFinite(m.row)) return null;
  if (typeof m.col !== "number" || !Number.isFinite(m.col)) return null;
  return { tableId: m.tableId, kind: m.kind, row: m.row, col: m.col };
}

/** Is this element part of ANY table? */
export function isTableElement(el: TableElementLike): boolean {
  return readTableMarker(el.customData) !== null;
}

/** Collect the live elements of one table (cells + borders), unsorted. */
export function tableElements(
  elements: readonly TableElementLike[],
  tableId: string,
): TableElementLike[] {
  return elements.filter((el) => {
    if (el.isDeleted) return false;
    const m = readTableMarker(el.customData);
    return m !== null && m.tableId === tableId;
  });
}

/**
 * Reconstruct the uniform grid geometry from the live marked elements.
 * x0/y0 anchor on the top-left-most cell; cellW/cellH take the largest
 * cell extent (a dragged cell normalizes to the grid's biggest cell on the
 * next op — the uniform-grid rule). Returns null when the table has no
 * live cells (borders alone can be deleted by hand without breaking this).
 */
export function tableGeometry(
  elements: readonly TableElementLike[],
  tableId: string,
): TableGeometry | null {
  const marked = tableElements(elements, tableId);
  const cells = marked.filter((el) => readTableMarker(el.customData)?.kind === "cell");
  if (!cells.length) return null;
  let rows = 0;
  let cols = 0;
  for (const el of cells) {
    const m = readTableMarker(el.customData)!;
    rows = Math.max(rows, m.row + 1);
    cols = Math.max(cols, m.col + 1);
  }
  // The (0,0) cell anchors the grid: a dragged anchor drags the whole grid's
  // origin, and every OTHER cell normalizes back to it on the next op (the
  // uniform-grid rule). Without an anchor cell, fall back to the extremes.
  const anchor = cells.find((el) => {
    const m = readTableMarker(el.customData)!;
    return m.row === 0 && m.col === 0;
  });
  let x0 = Infinity;
  let y0 = Infinity;
  let cellW = 0;
  let cellH = 0;
  for (const el of cells) {
    x0 = Math.min(x0, el.x ?? 0);
    y0 = Math.min(y0, el.y ?? 0);
    cellW = Math.max(cellW, el.width ?? DEFAULT_CELL_W);
    cellH = Math.max(cellH, el.height ?? DEFAULT_CELL_H);
  }
  if (anchor) {
    x0 = anchor.x ?? x0;
    y0 = anchor.y ?? y0;
  }
  return { tableId, x0, y0, rows, cols, cellW, cellH };
}

/**
 * Per-cell bound texts, row-major. A container without a bound text (never
 * typed into) reads as "". Deleted texts are ignored.
 */
export function cellTexts(
  elements: readonly TableElementLike[],
  geo: TableGeometry,
): string[][] {
  const byId = new Map<string, TableElementLike>();
  for (const el of elements) {
    if (el.id && !el.isDeleted) byId.set(el.id, el);
  }
  const marked = tableElements(elements, geo.tableId);
  const cells = marked.filter((el) => readTableMarker(el.customData)?.kind === "cell");
  const grid: string[][] = Array.from({ length: geo.rows }, () =>
    Array.from({ length: geo.cols }, () => ""),
  );
  for (const cell of cells) {
    const m = readTableMarker(cell.customData)!;
    if (m.row >= geo.rows || m.col >= geo.cols) continue;
    const textId = (cell.boundElements ?? []).find((b) => b.type === "text")?.id;
    const text = textId ? (byId.get(textId) as TableTextLike | undefined) : undefined;
    grid[m.row][m.col] = typeof text?.text === "string" ? text.text : "";
  }
  return grid;
}

/** An empty text grid for a fresh table. */
export function emptyTexts(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
}

/**
 * Build the full skeleton list for a uniform grid: (rows+1) horizontal +
 * (cols+1) vertical border lines, then rows×cols white cell containers
 * (row-major). `idFor` assigns fresh ids and receives the marker so the
 * caller can stamp customData right after conversion. Border lines inherit
 * the user's stroke color at insert time; cells are stroke-transparent —
 * the borders ARE the grid — with an opaque white fill so the whole cell
 * is clickable and double-click-to-type works (App.tsx requires a
 * non-transparent fill for the inside hit).
 */
export function tableSkeletons(
  geo: TableGeometry,
  texts: string[][],
  idFor: (marker: TableMarker) => string,
): TableSkeleton[] {
  const skeletons: TableSkeleton[] = [];
  const totalW = geo.cols * geo.cellW;
  const totalH = geo.rows * geo.cellH;
  for (let i = 0; i <= geo.rows; i++) {
    skeletons.push({
      id: idFor({ tableId: geo.tableId, kind: "border-h", row: i, col: -1 }),
      marker: { tableId: geo.tableId, kind: "border-h", row: i, col: -1 },
      type: "line",
      x: geo.x0,
      y: geo.y0 + i * geo.cellH,
      points: [
        [0, 0],
        [totalW, 0],
      ],
      strokeColor: INHERIT_STROKE,
      backgroundColor: "transparent",
      strokeWidth: 1,
    });
  }
  for (let i = 0; i <= geo.cols; i++) {
    skeletons.push({
      id: idFor({ tableId: geo.tableId, kind: "border-v", row: -1, col: i }),
      marker: { tableId: geo.tableId, kind: "border-v", row: -1, col: i },
      type: "line",
      x: geo.x0 + i * geo.cellW,
      y: geo.y0,
      points: [
        [0, 0],
        [0, totalH],
      ],
      strokeColor: INHERIT_STROKE,
      backgroundColor: "transparent",
      strokeWidth: 1,
    });
  }
  for (let r = 0; r < geo.rows; r++) {
    for (let c = 0; c < geo.cols; c++) {
      skeletons.push({
        id: idFor({ tableId: geo.tableId, kind: "cell", row: r, col: c }),
        marker: { tableId: geo.tableId, kind: "cell", row: r, col: c },
        type: "rectangle",
        x: geo.x0 + c * geo.cellW,
        y: geo.y0 + r * geo.cellH,
        width: geo.cellW,
        height: geo.cellH,
        strokeColor: "transparent",
        backgroundColor: CELL_FILL,
        fillStyle: "solid",
        strokeWidth: 1,
        label: {
          text: texts[r]?.[c] ?? "",
          fontSize: CELL_FONT_SIZE,
        },
      });
    }
  }
  return skeletons;
}

/** The structural ops the context menu offers. */
export type TableOp =
  | { type: "insert-row"; at: number }
  | { type: "insert-col"; at: number }
  | { type: "delete-row"; at: number }
  | { type: "delete-col"; at: number }
  | { type: "delete-table" };

export type TableOpPlan =
  | { kind: "rebuild"; geo: TableGeometry; texts: string[][] }
  | { kind: "delete" }
  | { kind: "error"; message: string };

/**
 * Plan one structural op against the live scene. Pure: reads geometry +
 * texts, returns the rebuilt grid for the caller to swap in one updateScene.
 * Guards: 1×1 is the deletion floor, MAX_ROWS/MAX_COLS the growth ceiling,
 * and `at` must be an existing row/column index.
 */
export function planTableOp(
  elements: readonly TableElementLike[],
  tableId: string,
  op: TableOp,
): TableOpPlan {
  if (op.type === "delete-table") return { kind: "delete" };
  const geo = tableGeometry(elements, tableId);
  if (!geo) return { kind: "error", message: "The table no longer exists on this page." };
  const texts = cellTexts(elements, geo);
  switch (op.type) {
    case "insert-row": {
      if (op.at < 0 || op.at >= geo.rows) {
        return { kind: "error", message: "That row does not exist." };
      }
      if (geo.rows >= MAX_ROWS) {
        return { kind: "error", message: `Tables cap at ${MAX_ROWS} rows.` };
      }
      const newGeo = { ...geo, rows: geo.rows + 1 };
      const newTexts = texts.map((r) => [...r]);
      newTexts.splice(op.at + 1, 0, Array.from({ length: geo.cols }, () => ""));
      return { kind: "rebuild", geo: newGeo, texts: newTexts };
    }
    case "insert-col": {
      if (op.at < 0 || op.at >= geo.cols) {
        return { kind: "error", message: "That column does not exist." };
      }
      if (geo.cols >= MAX_COLS) {
        return { kind: "error", message: `Tables cap at ${MAX_COLS} columns.` };
      }
      const newGeo = { ...geo, cols: geo.cols + 1 };
      const newTexts = texts.map((r) => {
        const row = [...r];
        row.splice(op.at + 1, 0, "");
        return row;
      });
      return { kind: "rebuild", geo: newGeo, texts: newTexts };
    }
    case "delete-row": {
      if (op.at < 0 || op.at >= geo.rows) {
        return { kind: "error", message: "That row does not exist." };
      }
      if (geo.rows <= MIN_ROWS) {
        return { kind: "error", message: "A table needs at least one row." };
      }
      const newGeo = { ...geo, rows: geo.rows - 1 };
      const newTexts = texts.map((r) => [...r]);
      newTexts.splice(op.at, 1);
      return { kind: "rebuild", geo: newGeo, texts: newTexts };
    }
    case "delete-col": {
      if (op.at < 0 || op.at >= geo.cols) {
        return { kind: "error", message: "That column does not exist." };
      }
      if (geo.cols <= MIN_COLS) {
        return { kind: "error", message: "A table needs at least one column." };
      }
      const newGeo = { ...geo, cols: geo.cols - 1 };
      const newTexts = texts.map((r) => {
        const row = [...r];
        row.splice(op.at, 1);
        return row;
      });
      return { kind: "rebuild", geo: newGeo, texts: newTexts };
    }
  }
}

/**
 * Hit-test the CELL rectangles at scene coords (the context-menu entry
 * point). Only cells are hit-testable — borders are one-pixel lines and a
 * near-miss right-click should not open a table menu with a wrong row.
 */
export function hitTableCell(
  elements: readonly TableElementLike[],
  sceneX: number,
  sceneY: number,
): { tableId: string; row: number; col: number } | null {
  for (const el of elements) {
    if (el.isDeleted || el.type !== "rectangle") continue;
    const m = readTableMarker(el.customData);
    if (!m || m.kind !== "cell") continue;
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    if (sceneX >= x && sceneX <= x + w && sceneY >= y && sceneY <= y + h) {
      return { tableId: m.tableId, row: m.row, col: m.col };
    }
  }
  return null;
}
