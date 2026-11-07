/// <reference types="bun-types" />
/**
 * Canvas import-toast i18n (issues #73 + #75).
 *
 * The canvas layer composes its import feedback from the `canvas.*` message
 * namespace — including the PDF-truncation notice and the empty-file notice
 * added with the bugfix wave. These tests pin the exact key set and the
 * placeholder parity between English and Simplified Chinese, so a missing
 * key or a mismatched {placeholder} can never reach production.
 */
import { describe, expect, it } from "bun:test";
import { flattenMessageKeys, messagePlaceholders } from "../i18n";
import en from "../../../messages/en.json";
import zhCN from "../../../messages/zh-CN.json";

/** Keys the canvas import pipeline reads (see excalidraw-canvas.tsx). */
const CANVAS_KEYS = [
  "importedImages",
  "importedTexts",
  "emptyFiles",
  "pdfPrintout",
  "pdfTruncated",
  "importedStructured",
  "plusImages",
  "importedAudio",
  "importedScene",
  "skipped",
  "importFailed",
] as const;

/** Placeholders each key must provide (subset check — order-independent). */
const EXPECTED_PLACEHOLDERS: Record<(typeof CANVAS_KEYS)[number], string[]> = {
  importedImages: ["count"],
  importedTexts: ["count"],
  emptyFiles: [],
  pdfPrintout: ["pages"],
  pdfTruncated: ["shown", "total"],
  importedStructured: ["blocks", "name"],
  plusImages: ["count"],
  importedAudio: ["count"],
  importedScene: ["name"],
  skipped: [],
  importFailed: [],
};

function catalogCanvas(
  catalog: Record<string, unknown>,
): Record<string, string> {
  const canvas = (catalog as { canvas?: Record<string, unknown> }).canvas;
  expect(canvas).toBeDefined();
  return canvas as Record<string, string>;
}

describe("canvas import-toast messages (issues #73/#75)", () => {
  it("every key the canvas reads exists in both catalogs", () => {
    for (const catalog of [en, zhCN]) {
      const canvas = catalogCanvas(catalog as Record<string, unknown>);
      for (const key of CANVAS_KEYS) {
        expect(canvas[key], `${key} missing`).toBeString();
        expect((canvas[key] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("both catalogs carry the same canvas key set (no drift)", () => {
    const enKeys = Object.keys(catalogCanvas(en as Record<string, unknown>)).sort();
    const zhKeys = Object.keys(catalogCanvas(zhCN as Record<string, unknown>)).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toEqual([...CANVAS_KEYS].sort());
  });

  it("every canvas message exposes the placeholders the code passes", () => {
    for (const catalog of [en, zhCN]) {
      const canvas = catalogCanvas(catalog as Record<string, unknown>);
      for (const [key, expected] of Object.entries(EXPECTED_PLACEHOLDERS)) {
        const got = messagePlaceholders(canvas[key] as string).sort();
        expect(got, `${key} placeholders`).toEqual([...expected].sort());
      }
    }
  });

  it("the English plural forms still render the legacy strings", () => {
    const canvas = catalogCanvas(en as Record<string, unknown>);
    // These strings were previously hardcoded — keep them byte-identical so
    // existing user expectations (and any docs) stay intact.
    expect(canvas.skipped).toBe("Some files were skipped (unsupported type)");
    expect(canvas.importFailed).toBe("Import failed — see console for details");
    expect(canvas.importedScene).toBe('Imported scene "{name}"');
  });

  it("the namespace is part of the flattened catalogs (parity suite sees it)", () => {
    for (const catalog of [en, zhCN]) {
      const keys = flattenMessageKeys(catalog as Record<string, unknown>);
      for (const key of CANVAS_KEYS) {
        expect(keys).toContain(`canvas.${key}`);
      }
    }
  });
});
