/// <reference types="bun-types" />
/**
 * Unit tests for the pure print-pagination math (issue #20).
 * Deterministic by construction: explicit boxes, page specs and margins —
 * never the wall clock, never jsPDF.
 */
import { describe, expect, it } from "bun:test";
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  MAX_UPSCALE,
  MIN_SCALE,
  PRINT_MARGIN_PT,
  bandTop,
  bandsForBox,
  computePageBands,
  flowText,
  type ElementBox,
} from "../pdf-layout";

const box = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: ElementBox["kind"] = "slice"
): ElementBox => ({ id, kind, x1, y1, x2, y2 });

describe("computePageBands", () => {
  it("returns null when there is nothing to print", () => {
    expect(computePageBands([], A4_PORTRAIT)).toBeNull();
  });

  it("a small single element fits one page and may upscale (capped)", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 50, "text")], A4_PORTRAIT)!;
    const usableW = A4_PORTRAIT.w - 2 * PRINT_MARGIN_PT;
    expect(bands.scale).toBe(Math.min(MAX_UPSCALE, usableW / 100));
    expect(bands.pageCount).toBe(1);
    expect(bands.originX).toBe(0);
    expect(bands.originY).toBe(0);
  });

  it("wide content is scaled down to the printable width", () => {
    const bands = computePageBands([box("a", 0, 0, 2000, 100)], A4_PORTRAIT)!;
    const usableW = A4_PORTRAIT.w - 2 * PRINT_MARGIN_PT;
    expect(bands.scale).toBeCloseTo(usableW / 2000, 6);
    expect(bands.scale).toBeLessThanOrEqual(1);
    expect(bands.pageCount).toBe(1);
  });

  it("tall content paginates into ceil(contentH / bandH) pages", () => {
    const H = 3000;
    const bands = computePageBands([box("a", 0, 0, 100, H)], A4_PORTRAIT)!;
    const usableH = A4_PORTRAIT.h - 2 * PRINT_MARGIN_PT;
    const bandH = usableH / bands.scale;
    expect(bands.bandH).toBeCloseTo(bandH, 6);
    expect(bands.pageCount).toBe(Math.ceil(H / bandH));
  });

  it("landscape swaps usable dimensions", () => {
    const bP = computePageBands([box("a", 0, 0, 100, 3000)], A4_PORTRAIT)!;
    const bL = computePageBands([box("a", 0, 0, 100, 3000)], A4_LANDSCAPE)!;
    // same width fit → same scale, but landscape bands are shorter → more pages
    expect(bL.scale).toBe(bP.scale);
    expect(bL.pageCount).toBeGreaterThan(bP.pageCount);
  });

  it("scale is clamped on both ends", () => {
    const usableW = A4_PORTRAIT.w - 2 * PRINT_MARGIN_PT;
    // tiny content → clamped to MAX_UPSCALE
    const tiny = computePageBands([box("a", 0, 0, 1, 1)], A4_PORTRAIT)!;
    expect(tiny.scale).toBe(MAX_UPSCALE);
    // absurdly wide → clamped to MIN_SCALE
    const huge = computePageBands([box("a", 0, 0, usableW / MIN_SCALE + 5000, 10)], A4_PORTRAIT)!;
    expect(huge.scale).toBe(MIN_SCALE);
  });

  it("origin is the min corner, not (0,0)", () => {
    const bands = computePageBands([box("a", 500, 700, 900, 900)], A4_PORTRAIT)!;
    expect(bands.originX).toBe(500);
    expect(bands.originY).toBe(700);
    expect(bands.contentW).toBe(400);
    expect(bands.contentH).toBe(200);
  });
});

describe("bandsForBox", () => {
  it("a box inside the first band touches only page 0", () => {
    const bands = computePageBands([box("a", 0, 0, 400, 200)], A4_PORTRAIT)!;
    expect(bandsForBox(box("a", 0, 10, 400, 200), bands)).toEqual([0]);
  });

  it("a box spanning three bands is stamped on all of them", () => {
    // bands computed from a tall scene so pageCount really is > 3
    const bands = computePageBands([box("a", 0, 0, 100, 1200)], A4_PORTRAIT)!;
    expect(bands.pageCount).toBeGreaterThanOrEqual(4);
    const spanning = box("s", 0, 0, 100, bands.bandH * 3 - 1);
    expect(bandsForBox(spanning, bands)).toEqual([0, 1, 2]);
  });

  it("clamps to the last page even when the box overflows the content", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 100)], A4_PORTRAIT)!;
    const overflow = box("o", 0, 0, 100, bands.bandH * 50);
    const pages = bandsForBox(overflow, bands);
    expect(pages[0]).toBe(0);
    expect(pages[pages.length - 1]).toBe(bands.pageCount - 1);
  });
});

describe("bandTop", () => {
  it("advances by one band per page", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 3000)], A4_PORTRAIT)!;
    expect(bandTop(bands, 0)).toBe(bands.originY);
    expect(bandTop(bands, 1)).toBeCloseTo(bands.originY + bands.bandH, 6);
    expect(bandTop(bands, 2)).toBeCloseTo(bands.originY + 2 * bands.bandH, 6);
  });
});

describe("flowText", () => {
  it("all lines land on one page when the text fits a band", () => {
    const bands = computePageBands([box("a", 0, 0, 400, 300)], A4_PORTRAIT)!;
    const spans = flowText({ top: 10, lineAdvance: 20, lineCount: 10 }, bands);
    expect(spans).toEqual([{ page: 0, firstLine: 0, lineCount: 10 }]);
  });

  it("lines are assigned by their center — never cut mid-glyph", () => {
    // tall scene: 9 lines at bandH/3 advance cover exactly three bands
    const bands = computePageBands([box("a", 0, 0, 100, 1200)], A4_PORTRAIT)!;
    const advance = bands.bandH / 3;
    const spans = flowText({ top: 0, lineAdvance: advance, lineCount: 9 }, bands);
    expect(spans).toEqual([
      { page: 0, firstLine: 0, lineCount: 3 },
      { page: 1, firstLine: 3, lineCount: 3 },
      { page: 2, firstLine: 6, lineCount: 3 },
    ]);
  });

  it("an empty text produces no spans", () => {
    const bands = computePageBands([box("a", 0, 0, 400, 300)], A4_PORTRAIT)!;
    expect(flowText({ top: 10, lineAdvance: 20, lineCount: 0 }, bands)).toEqual([]);
  });

  it("pages are clamped into the valid range", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 1200)], A4_PORTRAIT)!;
    // a runaway line center below the last band must clamp, not overflow
    const spans = flowText(
      { top: bands.bandH * (bands.pageCount + 5), lineAdvance: 20, lineCount: 3 },
      bands
    );
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.page).toBe(bands.pageCount - 1);
    }
  });

  it("contiguous runs stay merged per page", () => {
    const bands = computePageBands([box("a", 0, 0, 100, 1200)], A4_PORTRAIT)!;
    const advance = bands.bandH / 2;
    const spans = flowText({ top: 0, lineAdvance: advance, lineCount: 5 }, bands);
    expect(spans.length).toBeGreaterThan(1);
    let cursor = 0;
    for (const s of spans) {
      expect(s.firstLine).toBe(cursor);
      cursor += s.lineCount;
    }
    expect(cursor).toBe(5);
  });
});
