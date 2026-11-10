/// <reference types="bun-types" />
/**
 * Handwriting raster geometry — unit tests (test plan:
 * docs/test-plans/handwriting.md, ids HWR-R*).
 *
 * `rasterParams` is pure geometry and fully tested here; the canvas
 * drawing half (renderLineBitmap) is browser-only and covered by
 * e2e/hwr.spec.ts against the real model.
 */
import { describe, expect, it } from "bun:test";
import {
  HWR_PEN_WIDTH,
  HWR_RASTER_PAD,
  HWR_TARGET_INK_HEIGHT,
  rasterParams,
} from "../hwr-raster";
import type { HwrLine, HwrStroke } from "../hwr";

const stroke = (id: string, x0: number, y0: number, x1: number, y1: number): HwrStroke => ({
  elementId: id,
  points: [[x0, y0], [x1, y1]],
  x0,
  y0,
  x1,
  y1,
});

const line = (x0: number, y0: number, x1: number, y1: number): HwrLine => ({
  index: 0,
  strokes: [stroke("s", x0, y0, x1, y1)],
  x0,
  y0,
  x1,
  y1,
});

describe("rasterParams (HWR-R01..R05)", () => {
  it("HWR-R01: normal writing scales to the target ink height", () => {
    // 200×50 line → scale 88/50 = 1.76
    const p = rasterParams(line(0, 0, 200, 50));
    expect(p.scale).toBeCloseTo(1.76, 5);
    expect(p.height).toBe(Math.ceil(50 * 1.76) + HWR_PEN_WIDTH + 2 * HWR_RASTER_PAD);
    expect(p.width).toBe(Math.ceil(200 * 1.76) + HWR_PEN_WIDTH + 2 * HWR_RASTER_PAD);
    expect(p.penWidth).toBe(4);
  });

  it("HWR-R02: tiny writing scales up at most 4×", () => {
    // 12px-tall line → 88/12 = 7.3 clamps to 4
    const p = rasterParams(line(0, 0, 60, 12));
    expect(p.scale).toBe(4);
  });

  it("HWR-R03: huge ink scales down (sanity caps keep scale ≥ 0.22)", () => {
    const p = rasterParams(line(0, 0, 2000, 400));
    expect(p.scale).toBeCloseTo(88 / 400, 5);
    expect(p.scale).toBeGreaterThanOrEqual(0.05);
  });

  it("HWR-R04: the ink stays inside the bitmap at its extremes", () => {
    for (const [x0, y0, x1, y1] of [
      [0, 0, 200, 50],
      [-500, -300, 700, 100],
      [10_000, 5_000, 12_000, 5_090],
    ]) {
      const p = rasterParams(line(x0, y0, x1, y1));
      const left = x0 * p.scale + p.offsetX - p.penWidth / 2;
      const right = x1 * p.scale + p.offsetX + p.penWidth / 2;
      const top = y0 * p.scale + p.offsetY - p.penWidth / 2;
      const bottom = y1 * p.scale + p.offsetY + p.penWidth / 2;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(p.width);
      expect(bottom).toBeLessThanOrEqual(p.height);
    }
  });

  it("HWR-R05: the constants stay in the model-validated band", () => {
    // docs/test-plans/handwriting.md: pen/height ≈ 0.045–0.05 read
    // correctly at pen widths 3 and 4 in the 2026-11-10 validation
    expect(HWR_TARGET_INK_HEIGHT).toBe(88);
    expect(HWR_PEN_WIDTH).toBe(4);
    expect(HWR_PEN_WIDTH / HWR_TARGET_INK_HEIGHT).toBeGreaterThanOrEqual(0.04);
    expect(HWR_PEN_WIDTH / HWR_TARGET_INK_HEIGHT).toBeLessThanOrEqual(0.06);
  });
});
