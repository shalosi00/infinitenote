/// <reference types="bun-types" />
/**
 * Edge coverage for the pure print-pagination math — printout viewport
 * scaling corners (custom base scale and pixel budget, height-dominant
 * capping, exact-at-cap), custom margins, degenerate and negative-coordinate
 * element boxes, and bands entirely outside the printed range.
 *
 * Complements pdf-layout.test.ts (band math) and the #87/#107 policy cases
 * already pinned in pdf-export-policy.test.ts — no assertion duplicates
 * either file.
 */
import { describe, expect, it } from "bun:test";
import {
  A4_PORTRAIT,
  MAX_PRINTOUT_DIM_PX,
  PRINT_MARGIN_PT,
  bandsForBox,
  computePageBands,
  printoutViewportScale,
  type ElementBox,
} from "../pdf-layout";

const box = (id: string, x1: number, y1: number, x2: number, y2: number): ElementBox => ({
  id,
  kind: "slice",
  x1,
  y1,
  x2,
  y2,
});

describe("printoutViewportScale (issue #87) — corners beyond the base policy tests", () => {
  it("honors a custom base scale and pixel budget, and leaves an exact-at-cap viewport untouched", () => {
    expect(printoutViewportScale(100, 100, 2.5)).toBe(2.5);
    // custom budget: 2000pt at base 1.5 capped to a 1000px render
    expect(printoutViewportScale(2000, 100, 1.5, 1000)).toBe(0.75);
    // the HEIGHT is the dominant dimension: same budget math on the other axis
    const s = printoutViewportScale(1000, 4000, 1.5, 1000);
    expect((4000 * s) / 1.5).toBeCloseTo(1000, 6);
    // exactly at the cap: min(1, maxDim/largest) = 1 → no downscale
    expect(printoutViewportScale(MAX_PRINTOUT_DIM_PX, 800)).toBe(1.5);
  });
});

describe("computePageBands — margins, degenerate extents and negative coordinates", () => {
  it("a zero margin widens the printable area and raises the fit scale accordingly", () => {
    const b = box("a", 0, 0, 400, 100);
    const withMargin = computePageBands([b], A4_PORTRAIT)!;
    const fullBleed = computePageBands([b], A4_PORTRAIT, 0)!;
    expect(withMargin.scale).toBeCloseTo((A4_PORTRAIT.w - 2 * PRINT_MARGIN_PT) / 400, 6);
    expect(fullBleed.scale).toBeCloseTo(A4_PORTRAIT.w / 400, 6);
    expect(fullBleed.scale).toBeGreaterThan(withMargin.scale);
  });

  it("floors a zero-extent box to 1×1 content units and accepts negative coordinates", () => {
    const degenerate = computePageBands([box("z", 5, 5, 5, 5)], A4_PORTRAIT)!;
    expect(degenerate.contentW).toBe(1);
    expect(degenerate.contentH).toBe(1);
    expect(Number.isFinite(degenerate.scale)).toBe(true);
    expect(degenerate.pageCount).toBe(1);

    const negative = computePageBands([box("n", -300, -400, -100, -100)], A4_PORTRAIT)!;
    expect(negative.originX).toBe(-300);
    expect(negative.originY).toBe(-400);
    expect(negative.contentW).toBe(200);
    expect(negative.contentH).toBe(300);
  });
});

describe("bandsForBox — boxes outside the printed range", () => {
  it("stamps no pages for a box entirely above the origin or below the last band", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 100)], A4_PORTRAIT)!;
    const above = box("u", 0, bands.originY - 500, 100, bands.originY - 100);
    const below = box(
      "d",
      0,
      bands.originY + bands.contentH + 5000,
      100,
      bands.originY + bands.contentH + 5100,
    );
    expect(bandsForBox(above, bands)).toEqual([]);
    expect(bandsForBox(below, bands)).toEqual([]);
  });
});
