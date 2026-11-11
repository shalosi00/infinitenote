/**
 * Handwriting → text conversion, Phase B (issue #176) — pure policy.
 *
 * Reuses Phase A entirely: line segmentation (hwr.ts segmentLines) and the
 * stored recognition metadata (the FIRST stroke of each recognized line
 * carries customData.hwrText / hwrAt). No new model, no new engine calls,
 * no new privacy surface — conversion only ever reads what "Recognize
 * handwriting" already stored on-device. Nothing here talks to the DOM,
 * the engine or @excalidraw (mirrors shape-library.ts so it runs in bun
 * unit tests): it returns convertToExcalidrawElements-compatible text
 * SKELETONS that the runtime layer (excalidraw-client.ts
 * convertHandwritingToText) materializes.
 *
 * OneNote behavior (issue scope): the recognized text becomes a REAL,
 * editable Excalidraw text element placed at the ink's position on top of
 * the z-order, while the original strokes are KEPT (never mutated, never
 * deleted). Re-running never inserts duplicates: converted-ness is
 * detected structurally (a text element already sits at the line's ink
 * position — see HWR_CONVERT_POSITION_EPSILON below), so an undo or a
 * deleted text block naturally makes the line convertible again.
 *
 * Scope modes: per-page (no selection) or per-group (ink selected — the
 * caller passes the selected element ids; a line converts when ANY of its
 * strokes is selected, so selecting one word of a recognized line
 * converts the whole line).
 *
 * Undo-safety lives in the runtime layer: the conversion lands as ONE
 * native Excalidraw scene update — a single Ctrl+Z removes the inserted
 * text and un-marks the ink, exactly like inserting a shape does.
 *
 * Test plan: docs/test-plans/handwriting.md (Phase B, ids HWR-C*).
 */
import type { ScenePayload } from "./types";
import { INHERIT_STROKE } from "./shape-library";
import { plural } from "./plural";
import { hwrStrokes, normalizeHwrText, segmentLines } from "./hwr";

/**
 * Converted text is sized from the ink line's height (the text should sit
 * where the ink sits): fontSize = inkHeight / 1.25 (Excalidraw's default
 * text line-height), clamped to a sane range so a scratch line cannot
 * produce 8 px text and a page-filling drawing cannot produce 300 px text.
 */
export const HWR_FONT_SIZE_MIN = 12;
export const HWR_FONT_SIZE_MAX = 96;
/** Excalidraw's default text line-height (DEFAULT_LINE_HEIGHT heuristic). */
export const HWR_TEXT_LINE_HEIGHT = 1.25;

export function fontSizeForInkHeight(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return HWR_FONT_SIZE_MIN;
  const rounded = Math.round(height / HWR_TEXT_LINE_HEIGHT);
  return Math.min(HWR_FONT_SIZE_MAX, Math.max(HWR_FONT_SIZE_MIN, rounded));
}

/** One conversion target: a recognized, not-yet-converted ink line. */
export interface HwrConvertTarget {
  /** segmentLines order (top-to-bottom) — targets keep this order */
  lineIndex: number;
  /** stored, normalized recognition text (never empty here) */
  text: string;
  /** ink bbox top-left — where the text element goes */
  x: number;
  y: number;
  fontSize: number;
  /** the line's first (leftmost) stroke — the metadata carrier */
  firstStrokeId: string;
}

export interface HwrConvertPlan {
  targets: HwrConvertTarget[];
  /** readable lines already converted (skipped this run) */
  alreadyConverted: number;
  /** recognized lines whose stored text is empty/unreadable */
  unreadable: number;
}

/** Recognition metadata a converted stroke carries (subset view). */
interface HwrStrokeMeta {
  hwrText?: unknown;
  hwrAt?: unknown;
}

/**
 * Converted-ness is detected STRUCTURALLY, not via a persistent flag: a
 * line counts as converted when a text element already sits at the line's
 * ink position (within HWR_CONVERT_POSITION_EPSILON — 12 px: Excalidraw's
 * text-box padding shifts the created element ~8 px off the skeleton
 * position, measured 2026-11-11). Why not a
 * customData flag on the stroke: Excalidraw's undo/redo does NOT revert
 * customData changes (measured 2026-11-11, HWR-E06) — an undo removed the
 * converted text but left the flag, and "already converted" would lie.
 * With positional detection, undo (or deleting the text block) naturally
 * makes the line convertible again, and editing the converted text does
 * not resurrect a duplicate. Re-running recognition (applyHwrResults)
 * wipes the stored metadata; a fresh text element lands at the same spot
 * and the line converts again from the new reading.
 */
export const HWR_CONVERT_POSITION_EPSILON = 12;

/**
 * Build the conversion plan for a scene payload.
 *
 * Per-page mode (no `onlyStrokeIds`): every recognized, not-yet-converted
 * line converts. Per-group mode: a line converts when ANY of its strokes
 * is in `onlyStrokeIds`; lines outside the selection are not counted at
 * all. Metadata is only read from a line's FIRST stroke (the carrier
 * applyHwrResults writes) — text on any other stroke of the line is
 * Phase-A-invisible and stays so. The input payload is never mutated.
 */
export function planHwrConversion(
  payload: ScenePayload,
  onlyStrokeIds?: ReadonlySet<string>,
): HwrConvertPlan {
  const metaById = new Map<string, HwrStrokeMeta>();
  const textPositions: Array<{ x: number; y: number }> = [];
  for (const el of payload.elements) {
    const e = el as {
      id?: unknown;
      type?: unknown;
      isDeleted?: unknown;
      x?: unknown;
      y?: unknown;
      customData?: unknown;
    } | null;
    if (!e || e.isDeleted) continue;
    if (e.type === "text" && typeof e.x === "number" && typeof e.y === "number") {
      textPositions.push({ x: e.x, y: e.y });
      continue;
    }
    if (typeof e.id === "string" && e.customData && typeof e.customData === "object") {
      metaById.set(e.id, e.customData as HwrStrokeMeta);
    }
  }
  const convertedAt = (x: number, y: number): boolean =>
    textPositions.some(
      (t) => Math.abs(t.x - x) < HWR_CONVERT_POSITION_EPSILON && Math.abs(t.y - y) < HWR_CONVERT_POSITION_EPSILON,
    );
  const lines = segmentLines(hwrStrokes(payload));
  const targets: HwrConvertTarget[] = [];
  let alreadyConverted = 0;
  let unreadable = 0;
  for (const line of lines) {
    const first = line.strokes[0];
    if (!first) continue;
    if (onlyStrokeIds && !line.strokes.some((s) => onlyStrokeIds.has(s.elementId))) continue;
    const meta = metaById.get(first.elementId);
    const text = typeof meta?.hwrText === "string" ? normalizeHwrText(meta.hwrText) : "";
    if (!text || typeof meta?.hwrAt !== "number") {
      unreadable += 1;
      continue;
    }
    if (convertedAt(line.x0, line.y0)) {
      alreadyConverted += 1;
      continue;
    }
    targets.push({
      lineIndex: line.index,
      text,
      x: line.x0,
      y: line.y0,
      fontSize: fontSizeForInkHeight(line.y1 - line.y0),
      firstStrokeId: first.elementId,
    });
  }
  return { targets, alreadyConverted, unreadable };
}

/**
 * One convertToExcalidrawElements-compatible text skeleton per target,
 * in target order (top-to-bottom). fontFamily 2 = Excalidraw's clean
 * "Normal" font — converted text is meant to be read and edited, not to
 * mimic the ink. The stroke color carries the INHERIT_STROKE sentinel and
 * resolves to the user's current toolbar color at insert time (shape
 * library precedent), so converted text is visible in dark mode too.
 * Runtime re-ids every skeleton before insertion — stable placeholder ids
 * must never reach the live scene twice.
 */
export interface HwrTextSkeleton {
  type: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: 1 | 2 | 3;
  strokeColor: string;
}

export function conversionSkeletons(targets: readonly HwrConvertTarget[]): HwrTextSkeleton[] {
  return targets.map((t) => ({
    type: "text",
    id: `hwr-converted-${t.lineIndex}`,
    x: t.x,
    y: t.y,
    text: t.text,
    fontSize: t.fontSize,
    fontFamily: 2,
    strokeColor: INHERIT_STROKE,
  }));
}

/** What one conversion run did (drives the completion toast). */
export interface HwrConvertOutcome {
  converted: number;
  alreadyConverted: number;
  /** true when the run was scoped to the current selection (per-group) */
  selected: boolean;
}

/** The exact completion toast lines (English-only UI). */
export function hwrConvertSummary(out: HwrConvertOutcome): string {
  const scope = out.selected ? "selected" : "recognized";
  if (out.converted === 0 && out.alreadyConverted === 0) {
    return `No ${scope} handwriting with recognized text — run "Recognize handwriting" first, then select the ink and convert.`;
  }
  if (out.converted === 0) {
    return `All ${scope} handwriting is already converted to text.`;
  }
  const head = `Converted ${plural(out.converted, "1 line", "# lines")} of handwriting to text.`;
  const tail = out.alreadyConverted
    ? ` ${plural(out.alreadyConverted, "1 line was", "# lines were")} already converted.`
    : "";
  return `${head}${tail}`;
}
