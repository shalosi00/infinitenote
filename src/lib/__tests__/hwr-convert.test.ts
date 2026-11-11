/// <reference types="bun-types" />
/**
 * Handwriting → text conversion, Phase B — unit tests (test plan:
 * docs/test-plans/handwriting.md, ids HWR-C*).
 *
 * The pure policy is tested deterministically: which lines are
 * convertible (first-stroke metadata only), per-page vs per-group scoping,
 * font-size derivation, skeleton construction, toast copy, and the
 * round-trip interplay with applyHwrResults (recognize → convert →
 * already-converted → re-recognize resets). The runtime materialization
 * (convertToExcalidrawElements + updateScene) is proven by the real-engine
 * E2E checks (e2e/handwriting.spec.ts, HWR-E*).
 */
import { describe, expect, it } from "bun:test";
import {
  conversionSkeletons,
  fontSizeForInkHeight,
  hwrConvertSummary,
  planHwrConversion,
} from "../hwr-convert";
import { applyHwrResults, type HwrLine, type HwrStroke } from "../hwr";
import { INHERIT_STROKE } from "../shape-library";
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

/** A recognized line's first-stroke metadata carrier. */
const recognized = (text: string, at = 5): Record<string, unknown> => ({
  customData: { hwrText: text, hwrAt: at },
});

const planLine = (id: string, x0: number): HwrStroke => ({
  elementId: id,
  points: [[x0, 100]],
  x0,
  y0: 100,
  x1: x0 + 60,
  y1: 140,
});

/* --------------------------- fontSizeForInkHeight ------------------------ */

describe("fontSizeForInkHeight (HWR-C01..C03)", () => {
  it("HWR-C01: ink height / 1.25 — the text occupies the ink's vertical extent", () => {
    expect(fontSizeForInkHeight(50)).toBe(40);
    expect(fontSizeForInkHeight(40)).toBe(32);
    expect(fontSizeForInkHeight(100)).toBe(80);
  });

  it("HWR-C02: clamps to 12..96 — no 8 px scratch text, no 300 px text", () => {
    expect(fontSizeForInkHeight(2)).toBe(12);
    expect(fontSizeForInkHeight(5)).toBe(12);
    expect(fontSizeForInkHeight(500)).toBe(96);
    expect(fontSizeForInkHeight(4000)).toBe(96);
  });

  it("HWR-C03: non-finite and non-positive heights fall back to the minimum", () => {
    expect(fontSizeForInkHeight(Number.NaN)).toBe(12);
    expect(fontSizeForInkHeight(0)).toBe(12);
    expect(fontSizeForInkHeight(-30)).toBe(12);
    // a non-finite height is a degenerate input, not a clamp target —
    // the early guard returns the minimum
    expect(fontSizeForInkHeight(Number.POSITIVE_INFINITY)).toBe(12);
  });

  it("HWR-C04: rounds to whole font sizes", () => {
    expect(fontSizeForInkHeight(41)).toBe(33); // 32.8 → 33
    expect(fontSizeForInkHeight(51)).toBe(41); // 40.8 → 41
  });
});

/* ---------------------------- planHwrConversion -------------------------- */

describe("planHwrConversion (HWR-C10..C19)", () => {
  it("HWR-C10: per-page — a recognized line converts at its ink position", () => {
    const payload = scene([ink("s1", [[0, 100], [60, 140]], recognized("hello"))]);
    const plan = planHwrConversion(payload);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      lineIndex: 0,
      text: "hello",
      x: 0,
      y: 100,
      fontSize: 32, // ink height 40 → 32
      firstStrokeId: "s1",
    });
    expect(plan.alreadyConverted).toBe(0);
    expect(plan.unreadable).toBe(0);
  });

  it("HWR-C11: metadata on a NON-first stroke is ignored (first-stroke carrier only)", () => {
    const payload = scene([
      ink("a", [[0, 100], [30, 140]]),
      ink("b", [[40, 100], [70, 140]], recognized("ghost")),
    ]);
    const plan = planHwrConversion(payload);
    expect(plan.targets).toHaveLength(0);
    expect(plan.unreadable).toBe(1);
  });

  it("HWR-C12: unreadable metadata never converts (empty, missing hwrAt, non-string)", () => {
    const cases: Array<Record<string, unknown>> = [
      { customData: { hwrText: "", hwrAt: 1 } },
      { customData: { hwrText: "   ", hwrAt: 1 } },
      { customData: { hwrText: "no timestamp" } },
      { customData: { hwrAt: 1 } },
      { customData: { hwrText: 42, hwrAt: 1 } },
      { customData: { hwrText: { t: "object" }, hwrAt: 1 } },
      {},
    ];
    for (const extra of cases) {
      const plan = planHwrConversion(scene([ink("s1", [[0, 100], [60, 140]], extra)]));
      expect(plan.targets, JSON.stringify(extra)).toHaveLength(0);
      expect(plan.unreadable, JSON.stringify(extra)).toBe(1);
    }
  });

  it("HWR-C13: a line is already-converted when a text element sits at its ink position", () => {
    const recognized = ink("done", [[0, 100], [60, 140]], {
      customData: { hwrText: "hello", hwrAt: 5 },
    });
    // a text element right at the line's top-left (what conversion inserts)
    const atSpot = { id: "t1", type: "text", x: 0, y: 100, text: "hello" };
    const elsewhere = { id: "t2", type: "text", x: 400, y: 500, text: "hello" };
    expect(planHwrConversion(scene([recognized, atSpot])).alreadyConverted).toBe(1);
    expect(planHwrConversion(scene([recognized, atSpot])).targets).toHaveLength(0);
    // a text element anywhere else does not block the conversion
    const plan = planHwrConversion(scene([recognized, elsewhere]));
    expect(plan.targets).toHaveLength(1);
    expect(plan.alreadyConverted).toBe(0);
    // the epsilon covers Excalidraw's ~8 px text-box padding drift
    // (measured in HWR-E05) plus small restore normalization
    const nearMiss = { id: "t3", type: "text", x: 8, y: 106, text: "hello" };
    expect(planHwrConversion(scene([recognized, nearMiss])).alreadyConverted).toBe(1);
    // but a text 20 px away does not
    const drifted = { id: "t4", type: "text", x: 20, y: 100, text: "hello" };
    expect(planHwrConversion(scene([recognized, drifted])).targets).toHaveLength(1);
  });

  it("HWR-C14: per-group — ANY member stroke in the selection converts the whole line", () => {
    const payload = scene([
      ink("l1", [[0, 100], [60, 140]], recognized("one")),
      ink("l2", [[40, 110], [100, 130]]),
      ink("m1", [[0, 200], [60, 240]], recognized("two")),
    ]);
    // only "l2" (a member of line 0) is selected — line 0 converts, line 1
    // (m1) is outside the selection and must not count at all
    const plan = planHwrConversion(payload, new Set(["l2"]));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ text: "one", firstStrokeId: "l1" });
    expect(plan.unreadable).toBe(0);
    expect(plan.alreadyConverted).toBe(0);
  });

  it("HWR-C15: per-group — selected-but-unrecognized ink counts as unreadable", () => {
    const payload = scene([ink("l1", [[0, 100], [60, 140]])]);
    const plan = planHwrConversion(payload, new Set(["l1"]));
    expect(plan.targets).toHaveLength(0);
    expect(plan.unreadable).toBe(1);
  });

  it("HWR-C16: drawings beyond the line sanity caps produce no targets", () => {
    // height 1000 > HWR_MAX_LINE_HEIGHT(400) — segmentLines drops it
    const payload = scene([ink("big", [[0, 0], [100, 1000]], recognized("huge"))]);
    expect(planHwrConversion(payload)).toEqual({ targets: [], alreadyConverted: 0, unreadable: 0 });
  });

  it("HWR-C17: multiple lines convert in reading order, each at its own bbox", () => {
    const payload = scene([
      ink("l1", [[0, 100], [60, 140]], recognized("first")),
      ink("m1", [[0, 200], [60, 240]], recognized("second")),
    ]);
    const plan = planHwrConversion(payload);
    expect(plan.targets.map((t) => [t.lineIndex, t.text])).toEqual([
      [0, "first"],
      [1, "second"],
    ]);
    expect(plan.targets.map((t) => t.y)).toEqual([100, 200]);
  });

  it("HWR-C18: the input payload is never mutated", () => {
    const payload = scene([ink("s1", [[0, 100], [60, 140]], recognized("hello"))]);
    const before = JSON.stringify(payload);
    planHwrConversion(payload);
    planHwrConversion(payload, new Set(["s1"]));
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("HWR-C19: a deleted stroke's metadata is invisible — deleted ink never converts", () => {
    const payload = scene([
      ink("gone", [[0, 100], [60, 140]], { isDeleted: true, ...recognized("hello") }),
    ]);
    expect(planHwrConversion(payload)).toEqual({ targets: [], alreadyConverted: 0, unreadable: 0 });
  });

  it("HWR-C20: an empty selection set converts nothing (caller decides page vs group mode)", () => {
    const payload = scene([ink("s1", [[0, 100], [60, 140]], recognized("hello"))]);
    const plan = planHwrConversion(payload, new Set());
    expect(plan.targets).toHaveLength(0);
    // and page mode still works
    expect(planHwrConversion(payload).targets).toHaveLength(1);
  });
});

/* ---------------------------- conversionSkeletons ------------------------ */

describe("conversionSkeletons (HWR-C30..C32)", () => {
  it("HWR-C30: one text skeleton per target, carrying text, position, size and the inherit sentinel", () => {
    const plan = planHwrConversion(
      scene([
        ink("l1", [[0, 100], [60, 140]], recognized("hello")),
        ink("m1", [[0, 200], [60, 240]], recognized("world")),
      ]),
    );
    const skeletons = conversionSkeletons(plan.targets);
    expect(skeletons).toHaveLength(2);
    expect(skeletons[0]).toEqual({
      type: "text",
      id: "hwr-converted-0",
      x: 0,
      y: 100,
      text: "hello",
      fontSize: 32,
      fontFamily: 2,
      strokeColor: INHERIT_STROKE,
    });
    expect(skeletons[1]).toMatchObject({ id: "hwr-converted-1", text: "world", y: 200 });
  });

  it("HWR-C31: no targets → no skeletons", () => {
    expect(conversionSkeletons([])).toEqual([]);
  });

  it("HWR-C32: skeleton ids are stable placeholders — collision-safe re-id happens at insert time", () => {
    const plan = planHwrConversion(scene([ink("s1", [[0, 100], [60, 140]], recognized("hi"))]));
    const [a] = conversionSkeletons(plan.targets);
    const [b] = conversionSkeletons(plan.targets);
    expect(a.id).toBe(b.id); // deterministic policy output
    expect(a.id).not.toMatch(/uuid/i); // runtime must replace it
  });
});

/* ------------------------------ hwrConvertSummary ------------------------ */

describe("hwrConvertSummary (HWR-C40..C45)", () => {
  it("HWR-C40: page mode, nothing readable — points at Recognize handwriting first", () => {
    expect(hwrConvertSummary({ converted: 0, alreadyConverted: 0, selected: false })).toBe(
      'No recognized handwriting with recognized text — run "Recognize handwriting" first, then select the ink and convert.',
    );
  });

  it("HWR-C41: selection mode, nothing readable — same guidance, scoped to the selection", () => {
    expect(hwrConvertSummary({ converted: 0, alreadyConverted: 0, selected: true })).toBe(
      'No selected handwriting with recognized text — run "Recognize handwriting" first, then select the ink and convert.',
    );
  });

  it("HWR-C42: everything already converted is said explicitly, no silent no-op", () => {
    expect(hwrConvertSummary({ converted: 0, alreadyConverted: 2, selected: false })).toBe(
      "All recognized handwriting is already converted to text.",
    );
    expect(hwrConvertSummary({ converted: 0, alreadyConverted: 1, selected: true })).toBe(
      "All selected handwriting is already converted to text.",
    );
  });

  it("HWR-C43: single line, first conversion", () => {
    expect(hwrConvertSummary({ converted: 1, alreadyConverted: 0, selected: false })).toBe(
      "Converted 1 line of handwriting to text.",
    );
  });

  it("HWR-C44: multiple lines with an already-converted tail", () => {
    expect(hwrConvertSummary({ converted: 3, alreadyConverted: 2, selected: false })).toBe(
      "Converted 3 lines of handwriting to text. 2 lines were already converted.",
    );
    expect(hwrConvertSummary({ converted: 2, alreadyConverted: 1, selected: true })).toBe(
      "Converted 2 lines of handwriting to text. 1 line was already converted.",
    );
  });
});

/* ---------------- interplay with applyHwrResults (round-trip) ------------ */

describe("recognize / convert / undo round-trip (HWR-C50..C52)", () => {
  it("HWR-C50: full cycle — recognized ink converts once, then reports already-converted", () => {
    const payload = scene([ink("s1", [[0, 100], [60, 140]]), ink("s2", [[40, 110], [90, 130]])]);
    const line: HwrLine = {
      index: 0,
      strokes: [planLine("s1", 0), planLine("s2", 40)],
      x0: 0,
      y0: 100,
      x1: 90,
      y1: 140,
    };
    // 1. recognition stores metadata on the FIRST stroke
    const { payload: recognizedPayload } = applyHwrResults(payload, [line], [
      { lineIndex: 0, text: "hello", at: 5 },
    ]);
    // 2. conversion finds exactly one target on the first stroke
    const plan = planHwrConversion(recognizedPayload);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].firstStrokeId).toBe("s1");
    // 3. the runtime inserts a text element at the target's position (as
    // convertHandwritingToText does)
    const convertedPayload = scene([
      ...(recognizedPayload.elements as Array<Record<string, unknown>>),
      { id: "text-1", type: "text", x: plan.targets[0].x, y: plan.targets[0].y, text: "hello" },
    ]);
    // 4. re-running conversion is a no-op that says so
    const again = planHwrConversion(convertedPayload);
    expect(again.targets).toHaveLength(0);
    expect(again.alreadyConverted).toBe(1);
  });

  it("HWR-C51: undoing the conversion (text element removed) makes the line convertible again", () => {
    const recognized = ink("s1", [[0, 100], [60, 140]], {
      customData: { hwrText: "hello", hwrAt: 5 },
    });
    const converted = scene([
      recognized,
      { id: "text-1", type: "text", x: 0, y: 100, text: "hello" },
    ]);
    expect(planHwrConversion(converted).alreadyConverted).toBe(1);
    // undo (or delete) removes the text element — the line converts again
    const undone = scene([recognized]);
    const plan = planHwrConversion(undone);
    expect(plan.targets).toHaveLength(1);
    expect(plan.alreadyConverted).toBe(0);
  });

  it("HWR-C52: re-recognizing the same ink keeps the line blocked while the text stands (no duplicate)", () => {
    // recognition ran twice (fresh timestamp) but the converted text block
    // still sits at the ink position — a second conversion must not stack
    // a duplicate on top of the user's (possibly edited) text
    const payload = scene([
      ink("s1", [[0, 100], [60, 140]], {
        customData: { hwrText: "fresh reading", hwrAt: 99 },
      }),
      { id: "text-1", type: "text", x: 0, y: 100, text: "older reading" },
    ]);
    const plan = planHwrConversion(payload);
    expect(plan.targets).toHaveLength(0);
    expect(plan.alreadyConverted).toBe(1);
  });
});
