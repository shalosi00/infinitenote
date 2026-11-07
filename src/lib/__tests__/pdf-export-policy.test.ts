/// <reference types="bun-types" />
/**
 * Pure PDF-export policy tests for bug-hunt wave 2, PR 2:
 * - #107 the raster-snippet fallback must only apply to rotated elements
 *   and rotated/non-Latin text — unrotated shapes stay vector.
 * - #87 printout rendering caps the larger dimension at 1600px.
 * - #85 ExportError carries a stable locale-independent code.
 */
import { describe, expect, it } from "bun:test";
import { needsRasterSnippet, printoutViewportScale } from "../pdf-layout";
import { ExportError } from "../export-errors";

describe("needsRasterSnippet (issue #107)", () => {
  it("unrotated Latin text flows — never rasterized", () => {
    expect(needsRasterSnippet({ type: "text", angle: 0 }, "text")).toBe(false);
  });

  it("rotated or non-Latin text (slice boxes) rasterizes", () => {
    expect(needsRasterSnippet({ type: "text", angle: 0 }, "slice")).toBe(true);
    expect(needsRasterSnippet({ type: "text", angle: 0.4 }, "slice")).toBe(true);
  });

  it("unrotated shapes draw as vectors — not rasterized", () => {
    expect(needsRasterSnippet({ type: "rectangle", angle: 0 }, "slice")).toBe(false);
    expect(needsRasterSnippet({ type: "ellipse", angle: 0 }, "slice")).toBe(false);
    expect(needsRasterSnippet({ type: "arrow", angle: 0 }, "slice")).toBe(false);
    expect(needsRasterSnippet({ type: "draw", angle: 0 }, "slice")).toBe(false);
    expect(needsRasterSnippet({ type: "embeddable", angle: 0 }, "slice")).toBe(false);
  });

  it("rotated shapes and images rasterize", () => {
    expect(needsRasterSnippet({ type: "rectangle", angle: 0.7 }, "slice")).toBe(true);
    expect(needsRasterSnippet({ type: "image", angle: 0.7 }, "slice")).toBe(true);
    expect(needsRasterSnippet({ type: "embeddable", angle: 0.7 }, "slice")).toBe(true);
  });

  it("unrotated images render natively from their payload", () => {
    expect(needsRasterSnippet({ type: "image", angle: 0 }, "slice")).toBe(false);
  });
});

describe("printoutViewportScale (issue #87)", () => {
  it("keeps the base scale for normal pages", () => {
    // A4 at scale 1.5 ≈ 892×1263 px — under the cap
    expect(printoutViewportScale(892, 1263, 1.5)).toBeCloseTo(1.5, 10);
  });

  it("caps the larger dimension at 1600px for huge pages", () => {
    // A0 at scale 1.5 ≈ 2526×3567 px (base dims are AT the base scale)
    const scale = printoutViewportScale(2526, 3567, 1.5);
    // final render = base × (scale / baseScale)
    expect((3567 * scale) / 1.5).toBeLessThanOrEqual(1600 + 0.5);
    expect((2526 * scale) / 1.5).toBeLessThanOrEqual(1600 + 0.5);
    expect(scale).toBeCloseTo((1.5 * 1600) / 3567, 10);
  });

  it("degenerate dimensions fall back to the base scale", () => {
    expect(printoutViewportScale(0, 0, 1.5)).toBe(1.5);
    expect(printoutViewportScale(Number.NaN, 10, 1.5)).toBe(1.5);
  });
});

describe("ExportError (issue #85)", () => {
  it("is an Error with a stable code", () => {
    const err = new ExportError("Nothing to export — the page is empty.");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExportError");
    expect(err.code).toBe("emptyPage");
    expect(typeof err.message).toBe("string");
  });
});
