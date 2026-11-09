/**
 * OCR for images & PDF printouts — pure policy (no DOM, no engine).
 *
 * The tesseract WASM engine is vendored under /ocr/ and driven by
 * ocr-client.ts; this module owns every decision around it:
 * which elements can be recognized (ocrTargets), how results merge back
 * into the scene immutably (applyOcrResults), status accounting
 * (ocrStatus), the injectable-engine orchestrator (recognizeAllImages),
 * and the exact toast lines (ocrRunSummary). Tests inject fake engines —
 * the real one is exercised by e2e/ocr.spec.ts.
 *
 * Test plan: docs/test-plans/ocr.md.
 */
import type { ScenePayload } from "./types";
import { plural } from "./plural";

/**
 * Stored recognized text is capped at 20 000 CODE POINTS (issue #101
 * parity: never split an astral character) — a snapshot of dense text,
 * not a document dump bloating every scene.
 */
export const OCR_TEXT_CAP = 20_000;

/**
 * Recognition languages — the single source of truth consumed by the
 * engine driver (ocr-client.ts) and the asset drift tests.
 *
 * 2026-11-09: ONE German fast model. Measured against the real
 * tesseract.js 6.0.1 (docs/test-plans/ocr.md, evidence table): the
 * combination modes "eng+deu" / "deu+eng" strip umlauts (Ä→A, Ö→O, Ü→U)
 * and fail German outright, while the deu fast model recognizes German
 * perfectly AND every English probe flawlessly — the German alphabet is
 * a superset of the English one. English stays pinned by the English
 * fixture E2E running through this model.
 */
export const OCR_LANGS = "deu";

/** The traineddata files the bundle must ship for OCR_LANGS. */
export const OCR_LANG_FILES = ["deu.traineddata.gz"] as const;

interface SceneElementLike {
  id?: string;
  type?: string;
  fileId?: string | null;
  isDeleted?: boolean;
  customData?: { ocrText?: unknown; ocrAt?: unknown } | null;
}

/** One recognizable image element, resolved to its binary dataURL. */
export interface OcrTarget {
  id: string;
  fileId: string;
  dataUrl: string;
}

/** An injected recognition engine — the real one lives in ocr-client.ts. */
export type RecognizeFn = (dataUrl: string) => Promise<string>;

/** A single engine result, applied to the scene by `applyOcrResults`. */
export interface OcrResult {
  elementId: string;
  text: string;
  at: number;
}

/**
 * Collapse OCR noise into storable text: any whitespace run (line breaks,
 * tabs, multiple spaces — tesseract emits plenty) becomes one space, the
 * result is trimmed, and the length is capped by code points.
 */
export function normalizeOcrText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const chars = Array.from(collapsed);
  return chars.length <= OCR_TEXT_CAP ? collapsed : chars.slice(0, OCR_TEXT_CAP).join("");
}

function liveElements(payload: ScenePayload): SceneElementLike[] {
  return payload.elements.filter((el) => !(el as SceneElementLike | null)?.isDeleted) as SceneElementLike[];
}

/**
 * Every image element that can be recognized right now: live, has a fileId,
 * and the file's binary dataURL is present (a "pending" image with no data
 * has nothing to scan). Order follows element (z) order.
 */
export function ocrTargets(payload: ScenePayload): OcrTarget[] {
  const out: OcrTarget[] = [];
  for (const el of liveElements(payload)) {
    if (el?.type !== "image") continue;
    const fileId = typeof el.fileId === "string" ? el.fileId : null;
    if (!fileId) continue;
    const dataUrl = payload.files[fileId]?.dataURL;
    if (typeof dataUrl !== "string" || !dataUrl) continue;
    out.push({ id: el.id ?? "", fileId, dataUrl });
  }
  return out;
}

/**
 * Merge recognition results into a NEW payload: matching image elements
 * gain `customData.ocrText` (normalized) + `customData.ocrAt`, preserving
 * any pre-existing customData fields. Unknown element ids are ignored.
 * The input payload is never mutated; `applied` counts real hits.
 * Empty text is stored as `ocrText: ""` — scanned-but-blank must be
 * distinguishable from never-scanned.
 */
export function applyOcrResults(
  payload: ScenePayload,
  results: readonly OcrResult[],
): { payload: ScenePayload; applied: number } {
  const byId = new Map(results.map((r) => [r.elementId, r]));
  let applied = 0;
  const elements = payload.elements.map((el) => {
    const e = el as SceneElementLike;
    const result = e?.id ? byId.get(e.id) : undefined;
    if (!result || e?.type !== "image") return el;
    applied += 1;
    return {
      ...(el as Record<string, unknown>),
      customData: {
        ...(e.customData ?? {}),
        ocrText: normalizeOcrText(result.text),
        ocrAt: result.at,
      },
    };
  });
  return { payload: applied ? { ...payload, elements } : { ...payload }, applied };
}

/** How much of a page's image content has been recognized. */
export function ocrStatus(payload: ScenePayload): {
  images: number;
  scanned: number;
  withText: number;
} {
  let scanned = 0;
  let withText = 0;
  for (const el of liveElements(payload)) {
    if (el?.type !== "image") continue;
    if (typeof el.customData?.ocrAt === "number") {
      scanned += 1;
      if (typeof el.customData.ocrText === "string" && el.customData.ocrText) withText += 1;
    }
  }
  return { images: ocrTargets(payload).length, scanned, withText };
}

export interface OcrRunOutcome {
  payload: ScenePayload;
  /** elements the results actually updated */
  applied: number;
  /** images the engine attempted */
  scanned: number;
  /** attempted images whose stored text is non-empty */
  withText: number;
  /** engine failures (never abort the batch) */
  failed: number;
}

/**
 * Run the (injected) engine over every target, sequentially, reporting
 * progress after each image (1..N). One failing image never aborts the
 * batch — the rest still apply, the failure is counted. No targets: the
 * engine is never called.
 */
export async function recognizeAllImages(
  payload: ScenePayload,
  recognize: RecognizeFn,
  opts?: { onProgress?: (done: number) => void },
): Promise<OcrRunOutcome> {
  const targets = ocrTargets(payload);
  const results: OcrResult[] = [];
  let failed = 0;
  let done = 0;
  const at = Date.now();
  for (const target of targets) {
    try {
      const text = await recognize(target.dataUrl);
      results.push({ elementId: target.id, text, at });
    } catch {
      failed += 1;
    }
    done += 1;
    opts?.onProgress?.(done);
  }
  const { payload: next, applied } = applyOcrResults(payload, results);
  const withText = results.filter((r) => normalizeOcrText(r.text)).length;
  return { payload: next, applied, scanned: targets.length, withText, failed };
}

/** The exact completion toast lines (English-only UI). */
export function ocrRunSummary(out: { scanned: number; withText: number; failed: number }): string {
  const head = `Recognized text in ${plural(out.scanned, "1 image", "# images")}`;
  const failedTail = out.failed
    ? `, ${plural(out.failed, "1 failed", "# failed")}`
    : "";
  if (out.withText === 0) {
    return `${head} — none had readable text${failedTail}.`;
  }
  return `${head} — ${plural(out.withText, "1 had readable text", "# had readable text")}${failedTail}.`;
}

/* ------------------------------------------------------------------ */
/* typed engine errors (thrown by ocr-client.ts, mapped to toasts)     */
/* ------------------------------------------------------------------ */

export type OcrErrorCode = "load-failed" | "init-failed" | "recognize-failed";

/** A typed OCR failure — never a raw engine exception. */
export class OcrError extends Error {
  readonly code: OcrErrorCode;
  constructor(code: OcrErrorCode, message: string) {
    super(message);
    this.name = "OcrError";
    this.code = code;
  }
}

/** English toast lines for the typed failures (export-errors pattern). */
export const OCR_ERROR_MESSAGES: Record<OcrErrorCode, string> = {
  "load-failed": "The text recognition engine could not be loaded.",
  "init-failed": "The text recognition engine could not be started.",
  "recognize-failed": "Text recognition failed.",
};
