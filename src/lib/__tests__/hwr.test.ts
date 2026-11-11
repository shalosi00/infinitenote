/// <reference types="bun-types" />
/**
 * Handwriting recognition Phase A — unit tests (test plan:
 * docs/test-plans/handwriting.md, ids HWR-P*).
 *
 * The engine itself (trocr ONNX) is never spun up here: the orchestrator
 * takes injected `render`/`recognize` functions, so every data-flow
 * decision — stroke extraction, line segmentation, merging results back
 * into the scene, status accounting, search integration — is tested
 * deterministically. The real engine is proven by e2e/hwr.spec.ts
 * against the vendored assets.
 */
import { describe, expect, it } from "bun:test";
import {
  HWR_TEXT_CAP,
  applyHwrResults,
  hwrRunSummary,
  hwrStatus,
  hwrStrokes,
  normalizeHwrText,
  recognizeAllHandwriting,
  sameLine,
  segmentLines,
  type HwrLine,
  type HwrStroke,
} from "../hwr";
import { buildSearchIndex, extractSearchableText, searchIndex } from "../search";
import type { ScenePayload } from "../types";

/* ------------------------------- fixtures ------------------------------- */

/** A freedraw element from absolute stroke points (like Excalidraw stores:
 *  x/y = bbox top-left, points relative to it). */
const ink = (id: string, absPoints: Array<[number, number]>, extra: Record<string, unknown> = {}) => {
  const xs = absPoints.map((p) => p[0]);
  const ys = absPoints.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    id,
    type: "freedraw",
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    points: absPoints.map(([px, py]) => [px - x, py - y]),
    ...extra,
  };
};

const scene = (elements: Array<Record<string, unknown>>): ScenePayload => ({
  elements: elements as unknown[],
  files: {},
});

/** one word-like stroke set: "hello"-ish, x-height 50, baseline 120 */
const wordStrokes = (idPrefix: string, xOff: number): Array<[number, number]>[] => [
  // tall h-stem
  [[xOff + 0, 70], [xOff + 1, 120]],
  // h-hump + down
  [[xOff + 1, 88], [xOff + 16, 76], [xOff + 30, 88], [xOff + 31, 120]],
  // e
  [[xOff + 62, 100], [xOff + 54, 92], [xOff + 58, 82], [xOff + 70, 88], [xOff + 72, 104]],
];

/* ------------------------------ hwrStrokes ------------------------------ */

describe("hwrStrokes (HWR-P01..P03)", () => {
  it("HWR-P01: resolves freedraw geometry to absolute coordinates", () => {
    const strokes = hwrStrokes(scene([ink("s1", [[10, 20], [14, 26], [22, 25]])]));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points).toEqual([[10, 20], [14, 26], [22, 25]]);
    expect(strokes[0].x0).toBe(10);
    expect(strokes[0].y0).toBe(20);
    expect(strokes[0].x1).toBe(22);
    expect(strokes[0].y1).toBe(26);
  });

  it("HWR-P02: skips deleted strokes, non-freedraw elements and malformed points", () => {
    const strokes = hwrStrokes(
      scene([
        ink("dead", [[0, 0], [50, 40]], { isDeleted: true }),
        { id: "r", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        ink("nan", [[Number.NaN, 0], [30, 30]]),
        ink("good", [[0, 0], [40, 30]]),
      ]),
    );
    expect(strokes.map((s) => s.elementId)).toEqual(["good"]);
  });

  it("HWR-P03: elements without usable geometry are dropped, never crash", () => {
    const strokes = hwrStrokes(
      scene([{ id: "a", type: "freedraw" }, { id: "b", type: "freedraw", x: 0, y: 0, points: [] }]),
    );
    expect(strokes).toHaveLength(0);
  });
});

/* ---------------------------- segmentation ------------------------------ */

describe("segmentLines (HWR-P10..P19)", () => {
  it("HWR-P10: strokes sharing a vertical band form one line", () => {
    const lines = segmentLines([
      { elementId: "a", points: [[0, 0]], x0: 0, y0: 70, x1: 32, y1: 120 },
      { elementId: "b", points: [[0, 0]], x0: 54, y0: 82, x1: 72, y1: 104 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokes.map((s) => s.elementId)).toEqual(["a", "b"]);
  });

  it("HWR-P11: two stacked text lines split and order top-first", () => {
    const top = { elementId: "t", points: [[0, 0]] as const, x0: 0, y0: 100, x1: 200, y1: 140 };
    const bottom = { elementId: "b", points: [[0, 0]] as const, x0: 0, y0: 200, x1: 220, y1: 240 };
    const lines = segmentLines([bottom, top]);
    expect(lines).toHaveLength(2);
    expect(lines[0].strokes[0].elementId).toBe("t");
    expect(lines[1].strokes[0].elementId).toBe("b");
  });

  it("HWR-P12: two columns side by side split at a wide horizontal gap", () => {
    const left = { elementId: "l", points: [[0, 0]] as const, x0: 0, y0: 100, x1: 100, y1: 140 };
    const right = { elementId: "r", points: [[0, 0]] as const, x0: 400, y0: 100, x1: 500, y1: 140 };
    const lines = segmentLines([left, right]);
    expect(lines).toHaveLength(2);
    expect(lines[0].strokes[0].elementId).toBe("l");
    expect(lines[1].strokes[0].elementId).toBe("r");
  });

  it("HWR-P13: a word gap stays inside one line", () => {
    // gap 40 px between words, stroke height 40 → 2.5×40+8 budget allows it
    const w1 = { elementId: "w1", points: [[0, 0]] as const, x0: 0, y0: 100, x1: 80, y1: 140 };
    const w2 = { elementId: "w2", points: [[0, 0]] as const, x0: 120, y0: 100, x1: 200, y1: 140 };
    expect(segmentLines([w1, w2])).toHaveLength(1);
  });

  it("HWR-P14: an isolated i-dot is too small for its own line and drops out", () => {
    const dot = { elementId: "dot", points: [[0, 0]] as const, x0: 40, y0: 60, x1: 46, y1: 66 };
    const word = { elementId: "word", points: [[0, 0]] as const, x0: 0, y0: 90, x1: 120, y1: 140 };
    const lines = segmentLines([dot, word]);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokes.map((s) => s.elementId)).toEqual(["word"]);
  });

  it("HWR-P15: underline-thin ink is filtered by the minimum height", () => {
    const rule = { elementId: "r", points: [[0, 0]] as const, x0: 0, y0: 100, x1: 300, y1: 103 };
    expect(segmentLines([rule])).toHaveLength(0);
  });

  it("HWR-P16: page-sized drawings exceed the sanity caps and drop out", () => {
    const big = { elementId: "b", points: [[0, 0]] as const, x0: 0, y0: 0, x1: 900, y1: 600 };
    expect(segmentLines([big])).toHaveLength(0);
  });

  it("HWR-P17: result is order-independent (union-find, not a scan)", () => {
    const strokes: HwrStroke[] = wordStrokes("a", 0).map((pts, i) => {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return {
        elementId: `a${i}`,
        points: pts.map((p) => [p[0], p[1]] as const),
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      };
    });
    const forward = segmentLines(strokes);
    const backward = segmentLines([...strokes].reverse());
    expect(forward.map((l) => l.strokes.map((s) => s.elementId))).toEqual(
      backward.map((l) => l.strokes.map((s) => s.elementId)),
    );
    expect(forward).toHaveLength(1);
  });

  it("HWR-P18: within a line, strokes order left-to-right (ties top-first)", () => {
    const lines = segmentLines([
      { elementId: "late", points: [[0, 0]] as const, x0: 200, y0: 90, x1: 260, y1: 130 },
      { elementId: "early", points: [[0, 0]] as const, x0: 0, y0: 90, x1: 60, y1: 130 },
      { elementId: "middle", points: [[0, 0]] as const, x0: 100, y0: 90, x1: 160, y1: 130 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokes.map((s) => s.elementId)).toEqual(["early", "middle", "late"]);
  });

  it("HWR-P19: sameLine is symmetric and rejects non-overlapping pairs", () => {
    const a = { elementId: "a", points: [[0, 0]] as const, x0: 0, y0: 0, x1: 100, y1: 40 };
    const b = { elementId: "b", points: [[0, 0]] as const, x0: 50, y0: 80, x1: 150, y1: 120 };
    expect(sameLine(a, b)).toBe(false);
    expect(sameLine(b, a)).toBe(false);
  });
});

/* ------------------------------ normalize ------------------------------- */

describe("normalizeHwrText (HWR-P20..P22)", () => {
  it("HWR-P20: collapses whitespace runs and trims", () => {
    expect(normalizeHwrText("  icily \n\t hmm  ")).toBe("icily hmm");
  });

  it("HWR-P21: caps at 20 000 code points without splitting an astral character", () => {
    const ok = "a".repeat(20_000);
    expect(Array.from(normalizeHwrText(ok))).toHaveLength(20_000);
    const over = "a".repeat(20_000) + "😀b";
    const capped = normalizeHwrText(over);
    expect(Array.from(capped)).toHaveLength(20_000);
    expect(Array.from(capped).at(-1)).toBe("a");
  });

  it("HWR-P22: HWR_TEXT_CAP is the documented 20 000", () => {
    expect(HWR_TEXT_CAP).toBe(20_000);
  });
});

/* --------------------------- applyHwrResults ---------------------------- */

describe("applyHwrResults (HWR-P30..P36)", () => {
  const line = (id: string, x0: number): HwrStroke => ({
    elementId: id,
    points: [[x0, 100]],
    x0,
    y0: 100,
    x1: x0 + 60,
    y1: 140,
  });
  const lines = (): HwrLine[] => [
    { index: 0, strokes: [line("l1", 0), line("l2", 40)], x0: 0, y0: 100, x1: 100, y1: 140 },
    { index: 1, strokes: [line("m1", 0)], x0: 0, y0: 200, x1: 60, y1: 240 },
  ];

  it("HWR-P30: each line's FIRST (leftmost) stroke carries the line text", () => {
    const payload = scene([ink("l1", [[0, 100], [60, 140]]), ink("l2", [[40, 110], [100, 130]]), ink("m1", [[0, 200], [60, 240]])]);
    const { payload: next, applied } = applyHwrResults(payload, lines(), [
      { lineIndex: 0, text: "hello", at: 5 },
      { lineIndex: 1, text: "world", at: 5 },
    ]);
    expect(applied).toBe(2);
    const byId = new Map((next.elements as Array<{ id: string; customData?: { hwrText?: string } }>).map((e) => [e.id, e]));
    expect(byId.get("l1")?.customData?.hwrText).toBe("hello");
    expect(byId.get("l2")?.customData).toBeUndefined();
    expect(byId.get("m1")?.customData?.hwrText).toBe("world");
  });

  it("HWR-P31: empty text is stored (scanned-but-blank ≠ never-run)", () => {
    const payload = scene([ink("m1", [[0, 200], [60, 240]])]);
    const { payload: next } = applyHwrResults(payload, [{ ...lines()[1], index: 0 }], [{ lineIndex: 0, text: "   ", at: 7 }]);
    const el = (next.elements as Array<{ customData?: { hwrText?: string; hwrAt?: number } }>)[0];
    expect(el.customData?.hwrText).toBe("");
    expect(el.customData?.hwrAt).toBe(7);
  });

  it("HWR-P32: re-running clears stale annotations first (idempotent)", () => {
    const payload = scene([
      ink("l1", [[0, 100], [60, 140]], { customData: { hwrText: "stale", hwrAt: 1 } }),
      ink("l2", [[40, 110], [100, 130]], { customData: { hwrText: "stale-2", hwrAt: 1 } }),
    ]);
    const { payload: next } = applyHwrResults(payload, [lines()[0]], [{ lineIndex: 0, text: "fresh", at: 9 }]);
    const byId = new Map((next.elements as Array<{ id: string; customData?: { hwrText?: string } }>).map((e) => [e.id, e]));
    expect(byId.get("l1")?.customData?.hwrText).toBe("fresh");
    expect(byId.get("l2")?.customData).toBeUndefined();
  });

  it("HWR-P33: other customData fields survive", () => {
    const payload = scene([ink("m1", [[0, 200], [60, 240]], { customData: { keep: "me" } })]);
    const { payload: next } = applyHwrResults(payload, [{ ...lines()[1], index: 0 }], [{ lineIndex: 0, text: "x", at: 1 }]);
    const el = (next.elements as Array<{ customData?: Record<string, unknown> }>)[0];
    expect(el.customData?.keep).toBe("me");
    expect(el.customData?.hwrText).toBe("x");
  });

  it("HWR-P34: the input payload is never mutated", () => {
    const payload = scene([ink("m1", [[0, 200], [60, 240]])]);
    applyHwrResults(payload, [lines()[1]], [{ lineIndex: 0, text: "x", at: 1 }]);
    expect((payload.elements[0] as { customData?: unknown }).customData).toBeUndefined();
  });

  it("HWR-P35: results for unknown line indexes are ignored", () => {
    const payload = scene([ink("m1", [[0, 200], [60, 240]])]);
    const { applied } = applyHwrResults(payload, [lines()[1]], [{ lineIndex: 42, text: "ghost", at: 1 }]);
    expect(applied).toBe(0);
  });

  it("HWR-P36: recognition text is normalized on the way in", () => {
    const payload = scene([ink("m1", [[0, 200], [60, 240]])]);
    const { payload: next } = applyHwrResults(payload, [{ ...lines()[1], index: 0 }], [{ lineIndex: 0, text: "  spaced\t out ", at: 1 }]);
    expect((next.elements[0] as { customData?: { hwrText?: string } }).customData?.hwrText).toBe("spaced out");
  });

  it("HWR-P37: a partially failed re-run strips stale metadata from lines without results", () => {
    const payload = scene([
      ink("l1", [[0, 100], [60, 140]], { customData: { hwrText: "stale-one", hwrAt: 1 } }),
      ink("l2", [[40, 110], [100, 130]]),
    ]);
    // line 0 re-recognizes and only it gets a result: its old text must be
    // replaced, the non-carrier stroke stays clean, no stale metadata
    // survives anywhere
    const { payload: next, applied } = applyHwrResults(
      payload,
      [{ index: 0, strokes: [line("l1", 0), line("l2", 40)], x0: 0, y0: 100, x1: 100, y1: 140 }],
      [{ lineIndex: 0, text: "fresh", at: 11 }],
    );
    expect(applied).toBe(1);
    const byId = new Map(
      (next.elements as Array<{ id: string; customData?: Record<string, unknown> }>).map((e) => [e.id, e]),
    );
    expect(byId.get("l1")?.customData?.hwrText).toBe("fresh");
    expect(byId.get("l2")?.customData).toBeUndefined();
  });

  it("HWR-P38: a fully failed re-run strips ALL stale recognition metadata (empty bag dropped)", () => {
    const payload = scene([
      ink("m1", [[0, 200], [60, 240]], {
        customData: { hwrText: "old", hwrAt: 1 },
      }),
    ]);
    const { payload: next } = applyHwrResults(payload, [{ ...lines()[1], index: 0 }], []);
    const el = next.elements[0] as { customData?: Record<string, unknown> };
    // the bag's VALUE is dropped (JSON.stringify serializes the element
    // without the key — the stored form is back to pre-recognition bytes).
    // Fixed while writing the Phase B tests: the old
    // `applied ? mapped : original` shortcut returned the ORIGINAL payload
    // whenever no line carried a result, keeping stale metadata on the
    // strokes (a fully failed re-run behaved differently from a partially
    // successful one — one uniform lifecycle now).
    expect(el.customData).toBeUndefined();
  });
});

/* ------------------------------ hwrStatus ------------------------------- */

describe("hwrStatus (HWR-P40..P41)", () => {
  it("HWR-P40: accounts strokes, lines, recognized and with-text", () => {
    const payload = scene([
      ink("l1", [[0, 100], [60, 140]], { customData: { hwrText: "hello", hwrAt: 1 } }),
      ink("l2", [[70, 110], [130, 130]]),
      ink("blank", [[0, 300], [60, 340]], { customData: { hwrText: "", hwrAt: 2 } }),
      { id: "rect", type: "rectangle", x: 0, y: 0, width: 5, height: 5 },
    ]);
    expect(hwrStatus(payload)).toEqual({ strokes: 3, lines: 2, recognized: 2, withText: 1 });
  });

  it("HWR-P41: a page without ink is all zeros", () => {
    expect(hwrStatus(scene([{ id: "t", type: "text", text: "hi" }]))).toEqual({
      strokes: 0,
      lines: 0,
      recognized: 0,
      withText: 0,
    });
  });
});

/* ---------------------------- orchestrator ------------------------------ */

describe("recognizeAllHandwriting (HWR-P50..P54)", () => {
  const twoLineScene = () =>
    scene([
      ink("top1", [[0, 100], [80, 130]]),
      ink("bottom1", [[0, 300], [80, 330]]),
    ]);

  it("HWR-P50: calls the engine per line in order and reports progress", async () => {
    const calls: string[] = [];
    const progress: Array<[number, number]> = [];
    const out = await recognizeAllHandwriting(
      twoLineScene(),
      (line) => `raster:${line.index}`,
      async (dataUrl) => {
        calls.push(dataUrl);
        return `text:${dataUrl}`;
      },
      { onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(calls).toEqual(["raster:0", "raster:1"]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(out.scanned).toBe(2);
    expect(out.applied).toBe(2);
    expect(out.withText).toBe(2);
    expect(out.failed).toBe(0);
  });

  it("HWR-P51: one failing line never aborts the batch", async () => {
    const out = await recognizeAllHandwriting(
      twoLineScene(),
      (line) => `r:${line.index}`,
      async (dataUrl) => {
        if (dataUrl === "r:0") throw new Error("engine exploded");
        return "ok";
      },
    );
    expect(out.scanned).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.applied).toBe(1);
  });

  it("HWR-P52: failure isolation — every line gets its own try", async () => {
    let n = 0;
    const out = await recognizeAllHandwriting(twoLineScene(), () => "r", async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return "second";
    });
    expect(out.failed).toBe(1);
    expect(out.applied).toBe(1);
    expect(out.withText).toBe(1);
  });

  it("HWR-P53: no lines → engine never called", async () => {
    let called = false;
    const out = await recognizeAllHandwriting(scene([]), () => "r", async () => {
      called = true;
      return "x";
    });
    expect(called).toBe(false);
    expect(out).toEqual({ payload: expect.any(Object), applied: 0, scanned: 0, withText: 0, failed: 0 });
  });

  it("HWR-P54: empty results count as scanned but not with-text", async () => {
    const out = await recognizeAllHandwriting(twoLineScene(), () => "r", async () => "  ");
    expect(out.withText).toBe(0);
    expect(out.scanned).toBe(2);
  });
});

/* ------------------------------- summary -------------------------------- */

describe("hwrRunSummary (HWR-P60..P62)", () => {
  it("HWR-P60: singular and plural success lines", () => {
    expect(hwrRunSummary({ scanned: 1, withText: 1, failed: 0 })).toBe(
      "Recognized handwriting on 1 line — 1 line had readable text.",
    );
    expect(hwrRunSummary({ scanned: 3, withText: 2, failed: 0 })).toBe(
      "Recognized handwriting on 3 lines — 2 lines had readable text.",
    );
  });

  it("HWR-P61: nothing readable", () => {
    expect(hwrRunSummary({ scanned: 2, withText: 0, failed: 0 })).toBe(
      "Recognized handwriting on 2 lines — none was readable.",
    );
  });

  it("HWR-P62: failures ride the tail", () => {
    expect(hwrRunSummary({ scanned: 2, withText: 1, failed: 1 })).toBe(
      "Recognized handwriting on 2 lines — 1 line had readable text, 1 failed.",
    );
  });
});

/* --------------------------- search integration -------------------------- */

describe("search integration (HWR-P70..P72)", () => {
  const content = JSON.stringify({
    elements: [
      { id: "t", type: "text", text: "typed note" },
      ink("l1", [[0, 100], [60, 140]], { customData: { hwrText: "icily", hwrAt: 1 } }),
      ink("l2", [[70, 110], [130, 130]], { customData: { hwrText: "", hwrAt: 1 } }),
      { id: "i", type: "image", customData: { ocrText: "printed" } },
    ],
    files: {},
  });

  it("HWR-P70: freedraw hwrText is extracted as searchable content", () => {
    const out = extractSearchableText(content);
    expect(out).toContain("icily");
    expect(out).toContain("typed note");
    expect(out).toContain("printed");
    expect(out).not.toContain("");
  });

  it("HWR-P71: handwriting-only queries find the page through the index", () => {
    const index = buildSearchIndex(
      [{ id: "nb", name: "Notes", createdAt: 1, order: 0, updatedAt: 1, deletedAt: null, color: "violet" }],
      [{ id: "s", notebookId: "nb", name: "S", createdAt: 1, order: 0, updatedAt: 1, deletedAt: null }],
      [{ id: "p", sectionId: "s", title: "Page", createdAt: 1, updatedAt: 1, deletedAt: null, order: 0, tags: [], content }],
    );
    expect(searchIndex(index, "icily")).toHaveLength(1);
    expect(searchIndex(index, "icily notebook")).toHaveLength(0); // AND semantics
  });

  it("HWR-P72: unrecognized ink (no hwrText) stays invisible to search", () => {
    const plain = JSON.stringify({ elements: [ink("x", [[0, 0], [60, 40]])], files: {} });
    expect(extractSearchableText(plain)).toEqual([]);
  });
});
