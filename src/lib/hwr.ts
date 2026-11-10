/**
 * Handwriting recognition, Phase A — pure policy (no DOM, no engine).
 *
 * Mirrors the OCR module's shape exactly (docs/test-plans/ocr.md is the
 * template): this module owns every decision around the vendored
 * trocr-small-handwritten engine (docs/handwriting-research.md §4),
 * which lives in hwr-client.ts and is injected into the orchestrator:
 *
 *   freedraw strokes → segment into text lines (geometry, below)
 *   → each line rasterized to a bitmap (hwr-raster.ts, injected)
 *   → recognized by the engine (hwr-client.ts, injected)
 *   → per-line text stored on the line's first stroke's customData
 *     (`hwrText` + `hwrAt`) — machine-generated metadata, the ink
 *     geometry itself is never touched, re-running is idempotent and
 *     deleting recognition is trivial
 *   → the existing Ctrl+K search indexes the text (src/lib/search.ts)
 *
 * Phase A scope (issue #175): explicit per-page action, never background
 * processing; English-only (the model is trained on IAM-class English
 * handwriting — the UI says so); fully on-device, no ink ever leaves
 * the browser. Out of scope: ink-to-text conversion (issue #176, gated
 * on Phase A accuracy), CJK (deferred).
 *
 * Test plan: docs/test-plans/handwriting.md.
 */
import type { ScenePayload } from "./types";
import { plural } from "./plural";

/**
 * Stored recognized text is capped at 20 000 CODE POINTS per line —
 * OCR_TEXT_CAP parity (issue #101: never split an astral character). A
 * recognized line is a snapshot of text, not a document dump.
 */
export const HWR_TEXT_CAP = 20_000;

/** Minimum line geometry that is worth a model call (scene px). */
export const HWR_MIN_LINE_WIDTH = 24;
export const HWR_MIN_LINE_HEIGHT = 10;
/** Sanity caps — a "line" taller/wider than this is a drawing, not text. */
export const HWR_MAX_LINE_WIDTH = 4000;
export const HWR_MAX_LINE_HEIGHT = 400;

/* ------------------------------------------------------------------ */
/* stroke extraction                                                   */
/* ------------------------------------------------------------------ */

/** One live freedraw element, resolved to ABSOLUTE scene coordinates. */
export interface HwrStroke {
  elementId: string;
  /** stroke polyline in absolute scene coords (>= 1 point) */
  points: ReadonlyArray<readonly [number, number]>;
  /** absolute bbox (inclusive-ish: min/max over points) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface FreedrawLike {
  id?: string;
  type?: string;
  x?: unknown;
  y?: unknown;
  points?: unknown;
  isDeleted?: boolean;
}

/**
 * Extract every live freedraw element with usable geometry. Excalidraw
 * stores freedraw `points` relative to the element origin (x/y = bbox
 * top-left), so absolute = element.x + point.x. Strokes with no finite
 * points are skipped (they cannot be rasterized or grouped).
 */
export function hwrStrokes(payload: ScenePayload): HwrStroke[] {
  const out: HwrStroke[] = [];
  for (const el of payload.elements) {
    const e = el as FreedrawLike | null;
    if (!e || e.isDeleted || e.type !== "freedraw") continue;
    const ex = typeof e.x === "number" ? e.x : Number.NaN;
    const ey = typeof e.y === "number" ? e.y : Number.NaN;
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
    const raw = Array.isArray(e.points) ? e.points : [];
    const pts: Array<readonly [number, number]> = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const px = typeof p[0] === "number" ? ex + p[0] : Number.NaN;
      const py = typeof p[1] === "number" ? ey + p[1] : Number.NaN;
      if (Number.isFinite(px) && Number.isFinite(py)) pts.push([px, py]);
    }
    if (!pts.length) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [px, py] of pts) {
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
    }
    out.push({ elementId: typeof e.id === "string" ? e.id : "", points: pts, x0, y0, x1, y1 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* line segmentation (pure geometry)                                   */
/* ------------------------------------------------------------------ */

/** A group of strokes that reads as one text line, top-to-bottom order. */
export interface HwrLine {
  index: number;
  /** member strokes ordered left-to-right (ties: top-to-bottom) */
  strokes: HwrStroke[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Vertical-overlap ratio under which two strokes share a line. */
const V_OVERLAP_RATIO = 0.55;
/** Horizontal gap (in units of the smaller stroke's height) that still
 *  counts as the same line — word gaps stay inside, two text columns
 *  (the realistic "notes side by side" case) split apart. */
const H_GAP_HEIGHTS = 2.5;
/** Absolute horizontal-gap slack so tiny strokes (i-dots) are not held to
 *  a percentage-only budget. */
const H_GAP_SLACK = 8;

/**
 * Do two strokes plausibly belong to the same handwriting line?
 * Deterministic, symmetric — used as the union-find predicate.
 */
export function sameLine(a: HwrStroke, b: HwrStroke): boolean {
  const ah = a.y1 - a.y0;
  const bh = b.y1 - b.y0;
  const minH = Math.min(ah, bh);
  if (minH <= 0) return false;
  const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (vOverlap <= 0) return false;
  if (vOverlap / minH < V_OVERLAP_RATIO) return false;
  const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
  return hGap <= H_GAP_HEIGHTS * minH + H_GAP_SLACK;
}

/**
 * Segment strokes into text lines.
 *
 * Union-find over the pairwise sameLine relation (order-independent and
 * deterministic regardless of input stroke order), then per line:
 * filter by minimum/maximum geometry (drops i-dots, commas, underlines
 * and obvious drawings), order strokes left-to-right, order lines
 * top-to-bottom. This is the "geometry + projection" segmentation of
 * docs/handwriting-research.md §4 — freedraw boxes give the groups, the
 * bitmap projection happens implicitly through the bboxes.
 */
export function segmentLines(strokes: readonly HwrStroke[]): HwrLine[] {
  // union-find
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      if (sameLine(strokes[i], strokes[j])) union(i, j);
    }
  }
  const groups = new Map<number, HwrStroke[]>();
  for (let i = 0; i < strokes.length; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(strokes[i]);
    groups.set(root, list);
  }
  const lines: HwrLine[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0 || (a.elementId < b.elementId ? -1 : 1));
    const x0 = Math.min(...sorted.map((s) => s.x0));
    const y0 = Math.min(...sorted.map((s) => s.y0));
    const x1 = Math.max(...sorted.map((s) => s.x1));
    const y1 = Math.max(...sorted.map((s) => s.y1));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < HWR_MIN_LINE_WIDTH || h < HWR_MIN_LINE_HEIGHT) continue;
    if (w > HWR_MAX_LINE_WIDTH || h > HWR_MAX_LINE_HEIGHT) continue;
    lines.push({ index: 0, strokes: sorted, x0, y0, x1, y1 });
  }
  lines.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);
  lines.forEach((l, i) => (l.index = i));
  return lines;
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */

/** A single line's recognition outcome (aligned with segmentLines order). */
export interface HwrResult {
  lineIndex: number;
  text: string;
  at: number;
}

/**
 * Collapse recognition noise into storable text: any whitespace run
 * becomes one space, trim, cap by code points (OCR parity).
 */
export function normalizeHwrText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const chars = Array.from(collapsed);
  return chars.length <= HWR_TEXT_CAP ? collapsed : chars.slice(0, HWR_TEXT_CAP).join("");
}

/**
 * Merge recognition results into a NEW payload. Every live freedraw
 * element first loses stale `customData.hwrText`/`hwrAt` (re-running is
 * idempotent — no orphaned annotations survive an ink edit), then each
 * recognized line's FIRST stroke (leftmost) carries the line's text.
 * Per-line annotation (not per-page) keeps deletion honest: erase one
 * word of a line and re-run, and only that line's metadata changes.
 * `null` text (a failed line) is not stored at all; empty text IS stored
 * — recognized-but-blank must stay distinguishable from never-run (OCR
 * precedent). Other customData fields are always preserved.
 */
export function applyHwrResults(
  payload: ScenePayload,
  lines: readonly HwrLine[],
  results: readonly HwrResult[],
): { payload: ScenePayload; applied: number } {
  const byLine = new Map(results.map((r) => [r.lineIndex, r]));
  // only each line's FIRST stroke (leftmost) carries the line's result
  const resultByFirstStroke = new Map<string, HwrResult>();
  for (const line of lines) {
    const result = byLine.get(line.index);
    if (result && line.strokes.length) resultByFirstStroke.set(line.strokes[0].elementId, result);
  }
  let applied = 0;
  const elements = payload.elements.map((el) => {
    const e = el as FreedrawLike & { customData?: Record<string, unknown> | null };
    if (!e || e.isDeleted || e.type !== "freedraw") return el;
    const had = e.customData && ("hwrText" in e.customData || "hwrAt" in e.customData);
    const result = resultByFirstStroke.get(e.id ?? "");
    const carries = result !== undefined;
    if (!had && !carries) return el;
    if (carries) applied += 1;
    const customData: Record<string, unknown> = { ...(e.customData ?? {}) };
    delete customData.hwrText;
    delete customData.hwrAt;
    if (carries) {
      customData.hwrText = normalizeHwrText(result.text);
      customData.hwrAt = result.at;
    }
    return { ...(el as Record<string, unknown>), customData };
  });
  return { payload: applied ? { ...payload, elements } : { ...payload }, applied };
}

/** How much of a page's ink has been recognized. */
export function hwrStatus(payload: ScenePayload): {
  strokes: number;
  lines: number;
  recognized: number;
  withText: number;
} {
  const strokes = hwrStrokes(payload);
  const lines = segmentLines(strokes).length;
  let recognized = 0;
  let withText = 0;
  for (const el of payload.elements) {
    const e = el as (FreedrawLike & { customData?: { hwrText?: unknown; hwrAt?: unknown } }) | null;
    if (!e || e.isDeleted || e.type !== "freedraw") continue;
    if (typeof e.customData?.hwrAt === "number") {
      recognized += 1;
      if (typeof e.customData.hwrText === "string" && e.customData.hwrText) withText += 1;
    }
  }
  return { strokes: strokes.length, lines, recognized, withText };
}

/* ------------------------------------------------------------------ */
/* orchestrator                                                        */
/* ------------------------------------------------------------------ */

/** Renders one line to a PNG dataURL (browser part lives in hwr-raster.ts). */
export type RenderLineFn = (line: HwrLine) => string | Promise<string>;
/** Recognizes one rasterized line; resolves the raw model output. */
export type RecognizeLineFn = (dataUrl: string) => Promise<string>;

export interface HwrRunOutcome {
  payload: ScenePayload;
  /** lines the results actually annotated */
  applied: number;
  /** lines the engine attempted */
  scanned: number;
  /** attempted lines whose stored text is non-empty */
  withText: number;
  /** engine failures (never abort the batch) */
  failed: number;
}

/**
 * Run the (injected) engine over every line, sequentially, reporting
 * progress after each line (1..N). One failing line never aborts the
 * batch — the rest still apply, the failure is counted. No lines: the
 * engine is never called.
 */
export async function recognizeAllHandwriting(
  payload: ScenePayload,
  render: RenderLineFn,
  recognize: RecognizeLineFn,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<HwrRunOutcome> {
  const lines = segmentLines(hwrStrokes(payload));
  const results: HwrResult[] = [];
  let failed = 0;
  let done = 0;
  const at = Date.now();
  for (const line of lines) {
    try {
      const dataUrl = await render(line);
      const text = await recognize(dataUrl);
      results.push({ lineIndex: line.index, text, at });
    } catch {
      failed += 1;
    }
    done += 1;
    opts?.onProgress?.(done, lines.length);
  }
  const { payload: next, applied } = applyHwrResults(payload, lines, results);
  const withText = results.filter((r) => normalizeHwrText(r.text)).length;
  return { payload: next, applied, scanned: lines.length, withText, failed };
}

/** The exact completion toast lines (English-only UI). */
export function hwrRunSummary(out: { scanned: number; withText: number; failed: number }): string {
  const head = `Recognized handwriting on ${plural(out.scanned, "1 line", "# lines")}`;
  const failedTail = out.failed ? `, ${plural(out.failed, "1 failed", "# failed")}` : "";
  if (out.withText === 0) {
    return `${head} — none was readable${failedTail}.`;
  }
  return `${head} — ${plural(out.withText, "1 line had readable text", "# lines had readable text")}${failedTail}.`;
}

/* ------------------------------------------------------------------ */
/* typed engine errors (thrown by hwr-client.ts, mapped to toasts)     */
/* ------------------------------------------------------------------ */

export type HwrErrorCode = "load-failed" | "init-failed" | "recognize-failed";

/** A typed handwriting-recognition failure — never a raw engine exception. */
export class HwrError extends Error {
  readonly code: HwrErrorCode;
  constructor(code: HwrErrorCode, message: string) {
    super(message);
    this.name = "HwrError";
    this.code = code;
  }
}

/** English toast lines for the typed failures (export-errors pattern). */
export const HWR_ERROR_MESSAGES: Record<HwrErrorCode, string> = {
  "load-failed": "The handwriting recognition engine could not be loaded.",
  "init-failed": "The handwriting recognition engine could not be started.",
  "recognize-failed": "Handwriting recognition failed.",
};
