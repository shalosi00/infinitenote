/// <reference types="bun-types" />
/**
 * OCR for images & PDF printouts — unit tests (test plan:
 * docs/test-plans/ocr.md, ids OCR-P* and OCR-S*).
 *
 * The engine itself (tesseract WASM) is never spun up here: the
 * orchestrator takes an injected `recognize` function, so every data-flow
 * decision — targeting, merging results back into the scene, status
 * accounting, search integration — is tested deterministically. The real
 * engine is proven by e2e/ocr.spec.ts against the vendored assets.
 */
import { describe, expect, it } from "bun:test";
import {
  OCR_TEXT_CAP,
  normalizeOcrText,
  ocrRunSummary,
  ocrStatus,
  ocrTargets,
  applyOcrResults,
  recognizeAllImages,
  type OcrTarget,
  type RecognizeFn,
} from "../ocr";
import { buildSearchIndex, extractSearchableText, searchIndex } from "../search";
import type { ScenePayload } from "../types";

/* ------------------------------- fixtures ------------------------------- */

const img = (id: string, fileId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  fileId,
  ...extra,
});

const file = (id: string, dataURL = "data:image/png;base64,QUJD") => ({
  id,
  dataURL,
  mimeType: "image/png",
  created: 1,
});

const scene = (
  elements: Array<Record<string, unknown>>,
  files: Record<string, ReturnType<typeof file>> = {},
): ScenePayload => ({ elements: elements as unknown[], files });

/* ---------------------------- normalizeOcrText --------------------------- */

describe("normalizeOcrText (OCR-P01..P04)", () => {
  it("OCR-P01: collapses line breaks, tabs and repeated spaces; trims", () => {
    expect(normalizeOcrText("  QUOKKA \r\n NOTEBOOK\t  in\t\tthe\n\rwild  ")).toBe(
      "QUOKKA NOTEBOOK in the wild",
    );
  });

  it("OCR-P02: whitespace-only input normalizes to the empty string", () => {
    expect(normalizeOcrText("   \n\t \r\n ")).toBe("");
  });

  it("OCR-P03: the cap is surrogate-safe — astral pairs are never split", () => {
    const pair = "😀"; // U+1F600 — two UTF-16 code units, one code point
    const many = pair.repeat(OCR_TEXT_CAP + 10);
    const capped = normalizeOcrText(many);
    // never longer than the cap and never a lone surrogate half
    expect(Array.from(capped).length).toBeLessThanOrEqual(OCR_TEXT_CAP);
    expect(capped.includes("\u{FFFD}")).toBe(false);
    expect(Array.from(capped).every((ch) => ch === pair)).toBe(true);
  });

  it("OCR-P04: exactly at the cap stays unchanged; one over truncates to it", () => {
    const atCap = "a".repeat(OCR_TEXT_CAP);
    expect(normalizeOcrText(atCap)).toHaveLength(OCR_TEXT_CAP);
    expect(normalizeOcrText(atCap + "b")).toHaveLength(OCR_TEXT_CAP);
  });
});

/* ------------------------------- ocrTargets ------------------------------ */

describe("ocrTargets (OCR-P10..P16)", () => {
  it("OCR-P10: an image with fileId + file dataURL is a target", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1") });
    expect(ocrTargets(payload)).toEqual([
      { id: "i1", fileId: "f1", dataUrl: "data:image/png;base64,QUJD" },
    ] satisfies OcrTarget[]);
  });

  it("OCR-P11: an image without fileId is excluded", () => {
    const payload = scene([{ id: "i1", type: "image" }], {});
    expect(ocrTargets(payload)).toEqual([]);
  });

  it("OCR-P12: an image whose file is missing from files is excluded", () => {
    const payload = scene([img("i1", "ghost")], { f1: file("f1") });
    expect(ocrTargets(payload)).toEqual([]);
  });

  it("OCR-P13: an image whose file has an empty dataURL is excluded", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1", "") });
    expect(ocrTargets(payload)).toEqual([]);
  });

  it("OCR-P14: non-image elements are excluded", () => {
    const payload = scene(
      [
        { id: "t1", type: "text", text: "hello" },
        {
          id: "a1",
          type: "embeddable",
          customData: { audioName: "interview.mp3" },
        },
      ],
      {},
    );
    expect(ocrTargets(payload)).toEqual([]);
  });

  it("OCR-P15: soft-deleted tombstone elements are excluded", () => {
    const payload = scene([img("dead", "f1", { isDeleted: true })], { f1: file("f1") });
    expect(ocrTargets(payload)).toEqual([]);
  });

  it("OCR-P16: multiple images are all listed, in element order", () => {
    const payload = scene(
      [img("i1", "f1"), img("i2", "f2"), img("i3", "f1")],
      { f1: file("f1"), f2: file("f2") },
    );
    expect(ocrTargets(payload).map((t) => t.id)).toEqual(["i1", "i2", "i3"]);
  });
});

/* ---------------------------- applyOcrResults ---------------------------- */

describe("applyOcrResults (OCR-P20..P26)", () => {
  it("OCR-P20: the matching image gains ocrText + ocrAt; others untouched", () => {
    const payload = scene(
      [img("i1", "f1"), { id: "t1", type: "text", text: "keep" }],
      { f1: file("f1") },
    );
    const { payload: next, applied } = applyOcrResults(payload, [
      { elementId: "i1", text: "QUOKKA", at: 1234 },
    ]);
    expect(applied).toBe(1);
    expect((next.elements[0] as { customData?: unknown }).customData).toEqual({
      ocrText: "QUOKKA",
      ocrAt: 1234,
    });
    expect(next.elements[1]).toEqual(payload.elements[1]);
  });

  it("OCR-P21: pre-existing customData fields survive the merge", () => {
    const payload = scene(
      [img("i1", "f1", { customData: { ocrLang: "keep-me", other: 7 } })],
      { f1: file("f1") },
    );
    const { payload: next } = applyOcrResults(payload, [
      { elementId: "i1", text: "X", at: 9 },
    ]);
    expect((next.elements[0] as { customData: Record<string, unknown> }).customData).toEqual({
      ocrLang: "keep-me",
      other: 7,
      ocrText: "X",
      ocrAt: 9,
    });
  });

  it("OCR-P22: empty text still marks the element scanned (ocrText: \"\")", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1") });
    const { payload: next, applied } = applyOcrResults(payload, [
      { elementId: "i1", text: "   ", at: 5 },
    ]);
    expect(applied).toBe(1);
    expect((next.elements[0] as { customData: { ocrText: string } }).customData.ocrText).toBe("");
    expect((next.elements[0] as { customData: { ocrAt: number } }).customData.ocrAt).toBe(5);
  });

  it("OCR-P23: unknown elementIds are ignored; applied counts only real hits", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1") });
    const { payload: next, applied } = applyOcrResults(payload, [
      { elementId: "ghost", text: "nope", at: 1 },
      { elementId: "i1", text: "yes", at: 2 },
    ]);
    expect(applied).toBe(1);
    expect((next.elements[0] as { customData?: unknown }).customData).toMatchObject({
      ocrText: "yes",
    });
  });

  it("OCR-P24: several images apply in one pass", () => {
    const payload = scene([img("i1", "f1"), img("i2", "f2")], {
      f1: file("f1"),
      f2: file("f2"),
    });
    const { payload: next, applied } = applyOcrResults(payload, [
      { elementId: "i1", text: "one", at: 1 },
      { elementId: "i2", text: "two", at: 1 },
    ]);
    expect(applied).toBe(2);
    expect((next.elements[0] as { customData: { ocrText: string } }).customData.ocrText).toBe("one");
    expect((next.elements[1] as { customData: { ocrText: string } }).customData.ocrText).toBe("two");
  });

  it("OCR-P25: the input payload is never mutated", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1") });
    const snapshot = JSON.stringify(payload);
    applyOcrResults(payload, [{ elementId: "i1", text: "x", at: 1 }]);
    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  it("OCR-P26: raw text is normalized before storage", () => {
    const payload = scene([img("i1", "f1")], { f1: file("f1") });
    const { payload: next } = applyOcrResults(payload, [
      { elementId: "i1", text: "  hello\n\tworld  ", at: 1 },
    ]);
    expect((next.elements[0] as { customData: { ocrText: string } }).customData.ocrText).toBe(
      "hello world",
    );
  });
});

/* ------------------- ocrStatus + recognizeAllImages -------------------- */

describe("ocrStatus (OCR-P30, OCR-P31)", () => {
  it("OCR-P30: counts images / scanned / withText on a mixed payload", () => {
    const payload = scene(
      [
        img("i1", "f1", { customData: { ocrText: "found words", ocrAt: 1 } }),
        img("i2", "f2", { customData: { ocrText: "", ocrAt: 2 } }),
        img("i3", "f3"),
      ],
      { f1: file("f1"), f2: file("f2"), f3: file("f3") },
    );
    expect(ocrStatus(payload)).toEqual({ images: 3, scanned: 2, withText: 1 });
  });

  it("OCR-P31: a payload without images reports zeros", () => {
    expect(ocrStatus(scene([{ id: "t", type: "text", text: "x" }]))).toEqual({
      images: 0,
      scanned: 0,
      withText: 0,
    });
  });
});

describe("recognizeAllImages (OCR-P32..P35)", () => {
  const twoImages = scene([img("i1", "f1"), img("i2", "f2")], {
    f1: file("f1", "data:image/png;base64,QQ=="),
    f2: file("f2", "data:image/png;base64,Qg=="),
  });

  it("OCR-P32: calls the engine once per target with its dataUrl; progress 1..N", async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const recognize: RecognizeFn = async (dataUrl) => {
      calls.push(dataUrl);
      return dataUrl.endsWith("QQ==") ? "first" : "second";
    };
    const out = await recognizeAllImages(twoImages, recognize, {
      onProgress: (done) => progress.push(done),
    });
    expect(calls).toEqual(["data:image/png;base64,QQ==", "data:image/png;base64,Qg=="]);
    expect(progress).toEqual([1, 2]);
    expect(out.scanned).toBe(2);
    expect(out.withText).toBe(2);
    expect(out.failed).toBe(0);
    expect(out.applied).toBe(2);
  });

  it("OCR-P33: one engine failure does not abort the batch", async () => {
    const recognize: RecognizeFn = async (dataUrl) => {
      if (dataUrl.endsWith("QQ==")) throw new Error("engine boom");
      return "second";
    };
    const out = await recognizeAllImages(twoImages, recognize);
    expect(out.failed).toBe(1);
    expect(out.applied).toBe(1);
    expect(out.withText).toBe(1);
    const texts = out.payload.elements.map(
      (el) => (el as { customData?: { ocrText?: string } }).customData?.ocrText ?? null,
    );
    expect(texts).toEqual([null, "second"]);
  });

  it("OCR-P34: when every target fails, the payload is structurally unchanged", async () => {
    const recognize: RecognizeFn = async () => {
      throw new Error("engine boom");
    };
    const out = await recognizeAllImages(twoImages, recognize);
    expect(out.applied).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.payload).toEqual(twoImages);
  });

  it("OCR-P35: no targets — the engine is never called, immediate no-op", async () => {
    let called = 0;
    const recognize: RecognizeFn = async () => {
      called += 1;
      return "";
    };
    const out = await recognizeAllImages(scene([]), recognize);
    expect(called).toBe(0);
    expect(out).toEqual({
      payload: scene([]),
      applied: 0,
      scanned: 0,
      withText: 0,
      failed: 0,
    });
  });
});

describe("ocrRunSummary (OCR-P36)", () => {
  it("builds the scanned-with-text toast line", () => {
    expect(ocrRunSummary({ scanned: 3, withText: 2, failed: 0 })).toBe(
      "Recognized text in 3 images — 2 had readable text.",
    );
  });

  it("builds the none-with-text toast line", () => {
    expect(ocrRunSummary({ scanned: 4, withText: 0, failed: 0 })).toBe(
      "Recognized text in 4 images — none had readable text.",
    );
  });

  it("mentions engine failures when some images failed", () => {
    expect(ocrRunSummary({ scanned: 2, withText: 1, failed: 1 })).toBe(
      "Recognized text in 2 images — 1 had readable text, 1 failed.",
    );
  });
});

/* --------------------------- search integration -------------------------- */

describe("search sees OCR text (OCR-S01..S03)", () => {
  const ocrScene = (text: string) =>
    JSON.stringify(
      scene([img("i1", "f1", text ? { customData: { ocrText: text, ocrAt: 1 } } : {})], {
        f1: file("f1"),
      }),
    );

  it("OCR-S01: a scanned image's ocrText is emitted as searchable content", () => {
    expect(extractSearchableText(ocrScene("QUOKKA NOTEBOOK"))).toEqual(["QUOKKA NOTEBOOK"]);
  });

  it("OCR-S02: empty ocrText is not emitted", () => {
    expect(extractSearchableText(ocrScene(""))).toEqual([]);
  });

  it("OCR-S03: end-to-end — a page whose only match is OCR text is found + snippeted", () => {
    const index = buildSearchIndex(
      [{ id: "nb1", name: "NB", color: "violet", order: 1, createdAt: 1, updatedAt: 1, deletedAt: null }],
      [{ id: "s1", notebookId: "nb1", name: "S", order: 1, createdAt: 1, updatedAt: 1, deletedAt: null }],
      [
        {
          id: "p1",
          sectionId: "s1",
          title: "Scanned photo",
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          content: ocrScene("the QUOKKA sleeps"),
        },
      ],
    );
    const hits = searchIndex(index, "quokka");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p1");
    expect(hits[0].snippet).toContain("QUOKKA");
  });
});
