/**
 * Ink to shape (issue #329) — pure policy.
 *
 * OneNote "Ink to Shape" parity ("Draw a shape on the page. From the Shapes
 * gallery on the ribbon select Ink to Shape" — support.microsoft.com,
 * "Convert your Ink to Shapes and Math Equations"): a selected freedraw
 * stroke that LOOKS like a shape is replaced by the perfect Excalidraw
 * geometry. Strokes that do not classify are LEFT AS INK — never mutated,
 * never deleted — and counted for the guidance toast (the E07 honest-noop
 * precedent).
 *
 * This module is PURE — no imports from @excalidraw/excalidraw, no DOM —
 * so it runs in bun unit tests and during SSR (the shape-library.ts /
 * hwr-convert.ts contract). It returns convertToExcalidrawElements-
 * compatible skeletons that the runtime layer (excalidraw-client.ts
 * convertInkToShapes) materializes; the runtime owns the ONE updateScene
 * that both deletes the converted strokes and inserts the fitted shapes,
 * so a single Ctrl+Z restores the original ink.
 *
 * Scope modes: selection ONLY (OneNote's model — select the ink, then
 * convert). There is deliberately no page-wide mode: conversion REPLACES
 * ink, and auto-replacing an entire page of drawings would be destructive.
 * A run with an empty selection is a friendly no-op the caller guides on.
 *
 * Honest v1 classifier scope (each miss documented in
 * docs/test-plans/ink-shapes.md): axis-aligned rectangles, circles and
 * axis-aligned ellipses, triangles and diamonds from a single closed
 * stroke, straight lines from an open stroke. Rotated rectangles, rotated
 * ellipses, multi-stroke shapes and arrows stay ink in v1. A four-stroke
 * rectangle degrades gracefully — each side is a straight stroke and
 * converts to its own perfect line.
 *
 * Test plan: docs/test-plans/ink-shapes.md (ids IS-P*, IS-N*).
 */

import type { ScenePayload } from "./types";
import { plural } from "./plural";

/* ------------------------------------------------------------------ */
/* calibration constants — every threshold in one place, pinned by unit
/* tests and documented in docs/test-plans/ink-shapes.md
/* ------------------------------------------------------------------ */

/** Strokes smaller than this are marks, not shapes (px, bbox diagonal). */
export const INK_MIN_DIAGONAL = 18;
/** A stroke is closed when its endpoints are this close — absolute floor
 * plus a share of the diagonal so big hand-drawn circles that stop a few
 * px short of the start still count (a "C" arc has endpoints a full
 * diameter apart and stays open). */
export const INK_CLOSE_GAP = 14;
export const INK_CLOSE_GAP_RATIO = 0.25;
/**
 * An open stroke is a straight line when every point stays within
 * max(INK_LINE_TOL_ABS, INK_LINE_TOL_RATIO * chord) of the chord.
 */
export const INK_LINE_TOL_RATIO = 0.07;
export const INK_LINE_TOL_ABS = 6;
/** Kasa circle-fit acceptance: max radial error / radius. */
export const INK_CIRCLE_RESIDUAL = 0.16;
/** Circle-fit sanity: a fit larger than 4x the bbox diagonal is a line
 * wearing a circle costume (degenerate fit) — rejected. */
export const INK_CIRCLE_FIT_MAX_RATIO = 4;
/** Axis-aligned bbox-ellipse acceptance: max point error / max semi-axis. */
export const INK_ELLIPSE_RESIDUAL = 0.25;
/** Corner detection epsilon = ratio of the bbox diagonal. */
export const INK_CORNER_EPSILON_RATIO = 0.035;
/** A polygon corner may deviate from a right angle by this much (deg). */
export const INK_CORNER_ANGLE_TOL_DEG = 14;
/** Vertices flatter than this are wobble, not corners (deg of turn). */
export const INK_STRAIGHT_TURN_DEG = 12;
/** Diamond: each corner must sit within this ratio of an edge midpoint. */
export const INK_DIAMOND_TOL_RATIO = 0.28;
/** Triangle: reject degenerate slivers (min interior angle, deg). */
export const INK_TRIANGLE_MIN_ANGLE_DEG = 18;

/* ------------------------------------------------------------------ */
/* classification                                                      */
/* ------------------------------------------------------------------ */

export type InkShapeKind = "line" | "ellipse" | "rectangle" | "diamond" | "triangle";

export interface Vec {
  x: number;
  y: number;
}

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Defensive point extraction (the safeTags contract: external input never
 * crashes the classifier). Accepts [x, y] and [x, y, pressure] pairs —
 * Excalidraw freedraw points — plus absolute element translation.
 */
function absolutePoints(raw: unknown, dx: number, dy: number): Vec[] {
  if (!Array.isArray(raw)) return [];
  const pts: Vec[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = p[0];
    const y = p[1];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push({ x: x + dx, y: y + dy });
  }
  return pts;
}

/** Path length of the polyline. */
function pathLength(pts: Vec[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(pts: Vec[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Perpendicular distance from `p` to the closed segment a-b. */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return dist(p, a);
  let t = (wx * vx + wy * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Ramer–Douglas–Peucker simplification (recursive; stroke point counts
 * are small enough that the stack is not a concern). */
function rdp(pts: Vec[], epsilon: number): Vec[] {
  if (pts.length <= 2) return pts.slice();
  let maxIdx = 0;
  let maxDist = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segmentDistance(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdp(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Turn angle at vertex i in degrees (signed magnitude of the corner). */
function turnAngle(prev: Vec, at: Vec, next: Vec): number {
  const v1x = at.x - prev.x;
  const v1y = at.y - prev.y;
  const v2x = next.x - at.x;
  const v2y = next.y - at.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 === 0 || l2 === 0) return 0;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Drop near-straight vertices (wobble corners) from a simplified loop:
 * a vertex whose DIRECTION TURN is below `straightDeg` deg is mid-edge
 * (the interior-angle complement is ~180). */
function pruneStraight(pts: Vec[], straightDeg: number): Vec[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    if (turnAngle(prev, pts[i], next) >= straightDeg) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts.slice();
}

/** Interior (smaller) angle at each corner of a closed polygon, degrees. */
function interiorAngles(corners: Vec[]): number[] {
  return corners.map((c, i) => {
    const prev = corners[(i + corners.length - 1) % corners.length];
    const next = corners[(i + 1) % corners.length];
    return 180 - turnAngle(prev, c, next);
  });
}

/**
 * Kasa circle fit — least squares x² + y² = 2ax + 2by + c solved via the
 * 3x3 normal equations. Returns null when the system is degenerate.
 */
function fitCircle(pts: Vec[]): { cx: number; cy: number; r: number } | null {
  if (pts.length < 4) return null;
  let sxx = 0;
  let sxy = 0;
  let sx = 0;
  let syy = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  const n = pts.length;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    sx += p.x;
    syy += p.y * p.y;
    sy += p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  // normal equations for [a, b, c] in x²+y² = 2ax + 2by + c
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [sxz / 2, syz / 2, sz / 2];
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (col: number): number => {
    const mm = m.map((row) => row.slice());
    for (let i = 0; i < 3; i++) mm[i][col] = rhs[i];
    const d =
      mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1]) -
      mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0]) +
      mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0]);
    return d / det;
  };
  const a = solve(0);
  const b = solve(1);
  const c = solve(2);
  const r2 = c + a * a + b * b;
  if (r2 <= 0) return null;
  return { cx: a, cy: b, r: Math.sqrt(r2) };
}

function circleResidual(pts: Vec[], fit: { cx: number; cy: number; r: number }): number {
  let maxErr = 0;
  for (const p of pts) {
    const err = Math.abs(dist(p, { x: fit.cx, y: fit.cy }) - fit.r);
    if (err > maxErr) maxErr = err;
  }
  return maxErr / fit.r;
}

/** Residual of the points against the axis-aligned bbox ellipse. */
function bboxEllipseResidual(pts: Vec[], bb: BBox): number {
  const a = (bb.maxX - bb.minX) / 2;
  const b = (bb.maxY - bb.minY) / 2;
  if (a <= 0 || b <= 0) return Infinity;
  const cx = bb.minX + a;
  const cy = bb.minY + b;
  let maxErr = 0;
  for (const p of pts) {
    const t = Math.atan2((p.y - cy) / b, (p.x - cx) / a);
    const ex = cx + a * Math.cos(t);
    const ey = cy + b * Math.sin(t);
    const err = Math.hypot(p.x - ex, p.y - ey);
    if (err > maxErr) maxErr = err;
  }
  return maxErr / Math.max(a, b);
}

/** Classification result for ONE stroke. */
export interface StrokeShape {
  kind: InkShapeKind;
  /** Fitted bounds (the shape skeleton's x/y/width/height). */
  bounds: { x: number; y: number; width: number; height: number };
  /** Absolute corner path for line/triangle skeletons. */
  path?: Vec[];
}

/** The classifier proper: one absolute-point polyline → shape or null. */
export function classifyStrokePoints(pts: Vec[]): StrokeShape | null {
  if (pts.length < 3) return null;
  const bb = bboxOf(pts);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const diag = Math.hypot(w, h);
  if (!Number.isFinite(diag) || diag < INK_MIN_DIAGONAL) return null;
  const len = pathLength(pts);
  if (!Number.isFinite(len) || len === 0) return null;

  const gap = dist(pts[0], pts[pts.length - 1]);
  const closed = gap <= Math.max(INK_CLOSE_GAP, INK_CLOSE_GAP_RATIO * diag);

  if (!closed) {
    // straight line: every point near the chord
    const chord = gap;
    const tol = Math.max(INK_LINE_TOL_ABS, INK_LINE_TOL_RATIO * chord);
    const first = pts[0];
    const last = pts[pts.length - 1];
    for (const p of pts) {
      if (segmentDistance(p, first, last) > tol) return null;
    }
    if (chord < INK_MIN_DIAGONAL) return null;
    return {
      kind: "line",
      bounds: { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width: Math.abs(last.x - first.x), height: Math.abs(last.y - first.y) },
      path: [first, last],
    };
  }

  // closed strokes: circle fit first, then polygon corner analysis
  const fit = fitCircle(pts);
  if (fit && fit.r <= INK_CIRCLE_FIT_MAX_RATIO * diag && circleResidual(pts, fit) <= INK_CIRCLE_RESIDUAL) {
    return { kind: "ellipse", bounds: { x: fit.cx - fit.r, y: fit.cy - fit.r, width: 2 * fit.r, height: 2 * fit.r } };
  }
  if (bboxEllipseResidual(pts, bb) <= INK_ELLIPSE_RESIDUAL) {
    return { kind: "ellipse", bounds: { x: bb.minX, y: bb.minY, width: w, height: h } };
  }

  // corner analysis on the closed loop (RDP over the loop with the start
  // point duplicated at the end so the closure corner is detectable)
  const loop = [...pts, pts[0]];
  const simplified = rdp(loop, Math.max(1.5, diag * INK_CORNER_EPSILON_RATIO));
  let corners = simplified.slice(0, -1);
  corners = pruneStraight(corners, INK_STRAIGHT_TURN_DEG);

  if (corners.length === 4) {
    const angles = interiorAngles(corners);
    const rightAngles = angles.every((a) => Math.abs(a - 90) <= INK_CORNER_ANGLE_TOL_DEG);
    const bb2 = bboxOf(corners);
    const cw = bb2.maxX - bb2.minX;
    const ch = bb2.maxY - bb2.minY;
    const maxDim = Math.max(cw, ch);
    const asBounds = (): StrokeShape["bounds"] => ({ x: bb2.minX, y: bb2.minY, width: cw, height: ch });
    if (rightAngles) {
      // axis-aligned rectangle: every edge nearly horizontal or vertical
      let axisAligned = true;
      for (let i = 0; i < 4; i++) {
        const p = corners[i];
        const q = corners[(i + 1) % 4];
        const dx = Math.abs(q.x - p.x);
        const dy = Math.abs(q.y - p.y);
        const e = Math.hypot(dx, dy);
        if (e === 0 || Math.min(dx, dy) / e > Math.sin((INK_CORNER_ANGLE_TOL_DEG * Math.PI) / 180)) {
          axisAligned = false;
          break;
        }
      }
      if (axisAligned) return { kind: "rectangle", bounds: asBounds() };
      // right angles but rotated edges: a 45°-rotated square IS a diamond
      // (corners at the bbox edge midpoints) — fall through to the diamond
      // test; other rotations are an honest v1 miss and stay ink
    }
    // diamond: 4 corners each near a bbox edge midpoint
    const mids: Vec[] = [
      { x: bb2.minX + cw / 2, y: bb2.minY },
      { x: bb2.maxX, y: bb2.minY + ch / 2 },
      { x: bb2.minX + cw / 2, y: bb2.maxY },
      { x: bb2.minX, y: bb2.minY + ch / 2 },
    ];
    const tol = INK_DIAMOND_TOL_RATIO * maxDim;
    const used = new Set<number>();
    let matched = true;
    for (const c of corners) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < mids.length; i++) {
        if (used.has(i)) continue;
        const d = dist(c, mids[i]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0 || bestD > tol) {
        matched = false;
        break;
      }
      used.add(best);
    }
    if (matched) return { kind: "diamond", bounds: asBounds() };
    return null;
  }

  if (corners.length === 3) {
    const angles = interiorAngles(corners).sort((a, b) => a - b);
    if (angles[0] >= INK_TRIANGLE_MIN_ANGLE_DEG) {
      const bb3 = bboxOf(corners);
      return {
        kind: "triangle",
        bounds: { x: bb3.minX, y: bb3.minY, width: bb3.maxX - bb3.minX, height: bb3.maxY - bb3.minY },
        path: [...corners, corners[0]],
      };
    }
    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */

export interface InkShapeTarget extends StrokeShape {
  id: string;
  /** Style inherited from the converted stroke (shapes replace ink — they
   * must look like it drew itself). */
  strokeColor: string;
  strokeWidth: number;
  roughness: number;
}

export interface InkShapePlan {
  targets: InkShapeTarget[];
  /** Strokes left as ink (unrecognized or not shape-like). */
  unrecognized: string[];
}

const asString = (v: unknown, fallback: string): string => (typeof v === "string" && v.length > 0 ? v : fallback);
const asClampedInt = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;

/**
 * Selection-scoped plan (OneNote's model — select the ink, then convert):
 * ids not present as alive freedraw strokes are skipped silently (the
 * integrity-heal re-entry relies on this), strokes that do not classify
 * are reported as unrecognized and never touched.
 */
export function planInkShapes(payload: ScenePayload, ids: ReadonlySet<string>): InkShapePlan {
  const targets: InkShapeTarget[] = [];
  const unrecognized: string[] = [];
  if (ids.size === 0) return { targets, unrecognized };
  for (const raw of payload.elements) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as Record<string, unknown>;
    if (el.type !== "freedraw" || el.isDeleted === true) continue;
    if (typeof el.id !== "string" || !ids.has(el.id)) continue;
    const pts = absolutePoints(el.points, typeof el.x === "number" ? el.x : 0, typeof el.y === "number" ? el.y : 0);
    const shape = classifyStrokePoints(pts);
    if (!shape) {
      unrecognized.push(el.id);
      continue;
    }
    targets.push({
      id: el.id,
      kind: shape.kind,
      bounds: shape.bounds,
      path: shape.path,
      strokeColor: asString(el.strokeColor, "#1e1e1e"),
      strokeWidth: asClampedInt(el.strokeWidth, 2, 1, 4),
      roughness: asClampedInt(el.roughness, 1, 0, 2),
    });
  }
  return { targets, unrecognized };
}

/* ------------------------------------------------------------------ */
/* skeletons (convertToExcalidrawElements-compatible, runtime adds ids) */
/* ------------------------------------------------------------------ */

export type InkShapeSkeleton = {
  type: "line" | "ellipse" | "rectangle" | "diamond";
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  roughness: number;
  roundness: null;
  opacity: number;
};

/**
 * Skeletons for the plan's targets. Placeholder ids ("ink-shape") must
 * never reach the live scene twice — the runtime swaps in fresh UUIDs (the
 * insertShapeById / conversionSkeletons precedent).
 */
export function inkShapeSkeletons(plan: InkShapePlan): InkShapeSkeleton[] {
  return plan.targets.map((t) => {
    const base = {
      id: "ink-shape",
      strokeColor: t.strokeColor,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: t.strokeWidth,
      roughness: t.roughness,
      roundness: null,
      opacity: 100,
    };
    if (t.kind === "line" && t.path) {
      // canonical linear-element form: points[0] is [0,0] at the element
      // anchor (the stroke's first endpoint)
      const p0 = t.path[0];
      const p1 = t.path[t.path.length - 1];
      return {
        ...base,
        type: "line" as const,
        x: p0.x,
        y: p0.y,
        points: [
          [0, 0] as [number, number],
          [p1.x - p0.x, p1.y - p0.y] as [number, number],
        ],
      };
    }
    if (t.kind === "triangle" && t.path) {
      const p0 = t.path[0];
      return {
        ...base,
        type: "line" as const,
        x: p0.x,
        y: p0.y,
        points: [
          [0, 0] as [number, number],
          ...t.path.slice(1, -1).map((p) => [p.x - p0.x, p.y - p0.y] as [number, number]),
          [0, 0] as [number, number], // close the loop — a perfect triangle
        ],
      };
    }
    if (t.kind === "ellipse") {
      return { ...base, type: "ellipse" as const, x: t.bounds.x, y: t.bounds.y, width: t.bounds.width, height: t.bounds.height };
    }
    return {
      ...base,
      type: t.kind === "diamond" ? ("diamond" as const) : ("rectangle" as const),
      x: t.bounds.x,
      y: t.bounds.y,
      width: t.bounds.width,
      height: t.bounds.height,
    };
  });
}

/* ------------------------------------------------------------------ */
/* toast copy                                                          */
/* ------------------------------------------------------------------ */

/** What one conversion run did (drives the completion toast). */
export interface InkShapesOutcome {
  converted: number;
  /** Strokes intentionally left as ink (not shape-like). */
  leftAsInk: number;
  /** true when the run had a live ink selection (else guidance). */
  selected: boolean;
}

/** The exact completion toast lines (English-only UI). */
export function inkShapesSummary(out: InkShapesOutcome): string {
  if (!out.selected) {
    return "Select the ink strokes to convert, then run Ink to shape again.";
  }
  if (out.converted === 0 && out.leftAsInk === 0) {
    return "No ink in the selection — Ink to shape converts drawn (freedraw) strokes.";
  }
  if (out.converted === 0) {
    return "Nothing shape-like in the selection — the ink stays as is.";
  }
  const head = `Converted ${plural(out.converted, "1 stroke", "# strokes")} to shapes.`;
  const tail = out.leftAsInk
    ? ` ${plural(out.leftAsInk, "1 stroke stays", "# strokes stay")} as ink — not shape-like.`
    : "";
  return `${head}${tail}`;
}
