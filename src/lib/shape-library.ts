/**
 * Curated shape library beyond the Excalidraw defaults (issue #65).
 *
 * OneNote-style quick inserts: blocks and frames, arrow variants, elbow
 * connectors and sticky notes — all defined as NATIVE Excalidraw element
 * skeletons (editable, theme-aware, persisted with the scene, round-trip
 * through .excalidraw / PNG / SVG like anything drawn by hand).
 *
 * This module is PURE — no imports from @excalidraw/excalidraw — so it runs
 * in bun unit tests and during SSR. The runtime conversion + insertion live
 * in `excalidraw-client.ts` (insertShapeById).
 *
 * Color handling: skeletons may carry the INHERIT_* sentinels — insertShapeById
 * resolves them to the user's currently selected toolbar colors, so inserted
 * shapes match what the user would draw by hand (and follow theme changes).
 * Shapes that NEED a fixed look (yellow sticky, tinted block) pin their own
 * colors instead.
 */

export type ShapeCategory = "Blocks" | "Arrows" | "Connectors" | "Sticky notes";

/** Resolve at insert time to the user's current toolbar stroke color. */
export const INHERIT_STROKE = "inherit:stroke";
/** Resolve at insert time to the user's current toolbar background color. */
export const INHERIT_FILL = "inherit:fill";

/**
 * One convertToExcalidrawElements-compatible skeleton, anchored in
 * shape-local coordinates (0,0 = shape top-left). x/y are shifted to the
 * insertion anchor by insertShapeById.
 */
export interface ShapeSkeleton {
  type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text";
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeStyle?: string;
  strokeWidth?: number;
  roundness?: { type: number } | null;
  opacity?: number;
  startArrowhead?: string;
  endArrowhead?: string;
  fontSize?: number;
  label?: { text: string; fontSize?: number };
}

export interface ShapeDef {
  /** Stable id — also the DropdownMenuItem test id suffix. */
  id: string;
  /** Plain-English menu label (UI is English-only since v1.9). */
  label: string;
  category: ShapeCategory;
  skeletons: ShapeSkeleton[];
  /** Bounding box, for layout assertions and future previews. */
  width: number;
  height: number;
}

export const SHAPE_CATEGORIES: ShapeCategory[] = [
  "Blocks",
  "Arrows",
  "Connectors",
  "Sticky notes",
];

const OUTLINE = { strokeColor: INHERIT_STROKE, backgroundColor: "transparent" };

export const SHAPE_LIBRARY: ShapeDef[] = [
  /* ------------------------------ Blocks ------------------------------ */
  {
    id: "frame-rectangle",
    label: "Frame (rectangle)",
    category: "Blocks",
    width: 240,
    height: 160,
    skeletons: [
      { type: "rectangle", id: "shape-frame-rect", x: 0, y: 0, width: 240, height: 160, ...OUTLINE },
    ],
  },
  {
    id: "filled-block",
    label: "Filled block",
    category: "Blocks",
    width: 240,
    height: 160,
    skeletons: [
      {
        type: "rectangle",
        id: "shape-filled-block",
        x: 0,
        y: 0,
        width: 240,
        height: 160,
        strokeColor: INHERIT_STROKE,
        backgroundColor: "#94a3b8",
        fillStyle: "solid",
        opacity: 55,
      },
    ],
  },
  {
    id: "ellipse",
    label: "Ellipse",
    category: "Blocks",
    width: 200,
    height: 140,
    skeletons: [
      { type: "ellipse", id: "shape-ellipse", x: 0, y: 0, width: 200, height: 140, ...OUTLINE },
    ],
  },
  {
    id: "diamond",
    label: "Diamond",
    category: "Blocks",
    width: 220,
    height: 140,
    skeletons: [
      { type: "diamond", id: "shape-diamond", x: 0, y: 0, width: 220, height: 140, ...OUTLINE },
    ],
  },
  /* ------------------------------ Arrows ------------------------------ */
  {
    id: "arrow-one-way",
    label: "Arrow (one-way)",
    category: "Arrows",
    width: 200,
    height: 0,
    skeletons: [
      {
        type: "arrow",
        id: "shape-arrow-one-way",
        x: 0,
        y: 0,
        width: 200,
        height: 0,
        points: [
          [0, 0],
          [200, 0],
        ],
        endArrowhead: "arrow",
        ...OUTLINE,
      },
    ],
  },
  {
    id: "arrow-two-way",
    label: "Arrow (two-way)",
    category: "Arrows",
    width: 200,
    height: 0,
    skeletons: [
      {
        type: "arrow",
        id: "shape-arrow-two-way",
        x: 0,
        y: 0,
        width: 200,
        height: 0,
        points: [
          [0, 0],
          [200, 0],
        ],
        startArrowhead: "arrow",
        endArrowhead: "arrow",
        ...OUTLINE,
      },
    ],
  },
  {
    id: "arrow-dashed",
    label: "Arrow (dashed)",
    category: "Arrows",
    width: 200,
    height: 0,
    skeletons: [
      {
        type: "arrow",
        id: "shape-arrow-dashed",
        x: 0,
        y: 0,
        width: 200,
        height: 0,
        points: [
          [0, 0],
          [200, 0],
        ],
        endArrowhead: "arrow",
        strokeStyle: "dashed",
        ...OUTLINE,
      },
    ],
  },
  {
    id: "arrow-curved",
    label: "Arrow (curved)",
    category: "Arrows",
    width: 200,
    height: 60,
    skeletons: [
      {
        type: "arrow",
        id: "shape-arrow-curved",
        x: 0,
        y: 0,
        width: 200,
        height: 60,
        points: [
          [0, 60],
          [100, 0],
          [200, 60],
        ],
        endArrowhead: "arrow",
        roundness: { type: 2 },
        ...OUTLINE,
      },
    ],
  },
  /* ---------------------------- Connectors ---------------------------- */
  {
    id: "connector-elbow",
    label: "Elbow connector",
    category: "Connectors",
    width: 100,
    height: 80,
    skeletons: [
      {
        type: "arrow",
        id: "shape-connector-elbow",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        points: [
          [0, 0],
          [100, 0],
          [100, 80],
        ],
        endArrowhead: "arrow",
        ...OUTLINE,
      },
    ],
  },
  {
    id: "connector-line",
    label: "Plain line",
    category: "Connectors",
    width: 160,
    height: 0,
    skeletons: [
      {
        type: "line",
        id: "shape-connector-line",
        x: 0,
        y: 0,
        width: 160,
        height: 0,
        points: [
          [0, 0],
          [160, 0],
        ],
        ...OUTLINE,
      },
    ],
  },
  /* --------------------------- Sticky notes --------------------------- */
  {
    id: "sticky-note",
    label: "Sticky note",
    category: "Sticky notes",
    width: 180,
    height: 150,
    skeletons: [
      {
        type: "rectangle",
        id: "shape-sticky-note",
        x: 0,
        y: 0,
        width: 180,
        height: 150,
        // pinned yellow — the one shape with a fixed, recognizable look
        strokeColor: "#a16207",
        backgroundColor: "#facc15",
        fillStyle: "solid",
        roundness: { type: 3 },
        label: { text: "Note", fontSize: 20 },
      },
    ],
  },
  {
    id: "callout-block",
    label: "Callout block",
    category: "Sticky notes",
    width: 220,
    height: 90,
    skeletons: [
      {
        type: "rectangle",
        id: "shape-callout-block",
        x: 0,
        y: 0,
        width: 220,
        height: 90,
        strokeColor: INHERIT_STROKE,
        backgroundColor: INHERIT_FILL,
        fillStyle: "solid",
        roundness: { type: 3 },
        label: { text: "Callout", fontSize: 20 },
      },
    ],
  },
];

/** Shapes grouped by their menu category, in catalog order. */
export function shapesByCategory(category: ShapeCategory): ShapeDef[] {
  return SHAPE_LIBRARY.filter((s) => s.category === category);
}

/** Look up one shape by id (null for unknown ids — callers toast/skip). */
export function getShapeDef(id: string): ShapeDef | null {
  return SHAPE_LIBRARY.find((s) => s.id === id) ?? null;
}
