/// <reference types="bun-types" />
/**
 * Bug-hunt wave 2, PR 3 — import layout & guards:
 * - #88 CJK-aware line estimates (imported Chinese text no longer overlaps)
 * - #89 intrinsic-size fallback for SVGs without dimensions
 * - #90 .docx hard breaks with spaced self-closing tags
 * - #91 audio import size cap
 */
import { describe, expect, it } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import {
  estimateLineCount,
  isWideChar,
  withIntrinsicFallback,
} from "../import-blocks";
import { isAudioImportTooLarge, MAX_AUDIO_IMPORT_BYTES } from "../audio-notes";
import { extractDocxBlocks } from "../docx-import";

describe("isWideChar (issue #88)", () => {
  it("treats CJK, kana, Hangul and fullwidth forms as 1em", () => {
    for (const ch of ["中", "文", "あ", "ア", "한", "Ａ", "，", "。"]) {
      expect(isWideChar(ch), ch).toBe(true);
    }
  });

  it("treats Latin, digits and ASCII punctuation as narrow", () => {
    for (const ch of ["a", "Z", "9", " ", ".", "-"]) {
      expect(isWideChar(ch), ch).toBe(false);
    }
  });

  it("treats astral characters (emoji) as 1em", () => {
    expect(isWideChar("🎵")).toBe(true);
    expect(isWideChar("🙂")).toBe(true);
  });
});

describe("estimateLineCount (issue #88)", () => {
  const W = 720;
  const SIZE = 20;

  it("1000 CJK chars wrap to ~2x the old flat estimate", () => {
    const text = "字".repeat(1000);
    // old: ceil(1000/69) = 15 lines; real wrap at ~1em: ~28 lines
    const lines = estimateLineCount(text, SIZE, W);
    expect(lines).toBeGreaterThanOrEqual(26);
    expect(lines).toBeLessThanOrEqual(30);
  });

  it("1000 ASCII words still estimate reasonably", () => {
    const text = "a".repeat(1000);
    const lines = estimateLineCount(text, SIZE, W);
    // 720/20 = 36em budget; 1000 × 0.52em = 520em → ~15 lines
    expect(lines).toBeGreaterThanOrEqual(14);
    expect(lines).toBeLessThanOrEqual(16);
  });

  it("hard newlines always break", () => {
    expect(estimateLineCount("a\n\nb", SIZE, W)).toBe(3);
  });

  it("empty text is one line", () => {
    expect(estimateLineCount("", SIZE, W)).toBe(1);
  });
});

describe("withIntrinsicFallback (issue #89)", () => {
  it("passes positive dimensions through untouched", () => {
    expect(withIntrinsicFallback(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("replaces 0×0 (SVG without intrinsic size) with a sane default", () => {
    expect(withIntrinsicFallback(0, 0)).toEqual({ width: 480, height: 360 });
  });
});

describe("docx hard breaks (issue #90)", () => {
  function docx(body: string): Uint8Array {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
    return zipSync({ "word/document.xml": strToU8(xml) });
  }

  it("keeps unspaced <w:br/> (regression)", async () => {
    const bytes = docx("<w:p><w:r><w:t>one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>two</w:t></w:r></w:p>");
    const blocks = extractDocxBlocks(bytes);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("one\ntwo");
  });

  it("keeps spaced <w:br /> — previously dropped silently", async () => {
    const bytes = docx(
      "<w:p><w:r><w:t>one</w:t></w:r><w:r><w:br /><w:br /></w:r><w:r><w:t>two</w:t></w:r></w:p>",
    );
    const blocks = extractDocxBlocks(bytes);
    expect(blocks).toHaveLength(1);
    // (normalizeBlockText collapses blank lines — the break must survive at all)
    expect(blocks[0].text).toBe("one\ntwo");
  });

  it("keeps spaced <w:tab /> (normalized to a space, like unspaced)", async () => {
    const bytes = docx("<w:p><w:r><w:t>a</w:t></w:r><w:r><w:tab /></w:r><w:r><w:t>b</w:t></w:r></w:p>");
    const blocks = extractDocxBlocks(bytes);
    // normalizeBlockText collapses whitespace runs — the tab contributes a
    // separator instead of being silently dropped
    expect(blocks[0].text).toBe("a b");
  });
});

describe("audio import size cap (issue #91)", () => {
  it("refuses clips above the cap", () => {
    expect(isAudioImportTooLarge(MAX_AUDIO_IMPORT_BYTES + 1)).toBe(true);
    expect(isAudioImportTooLarge(500 * 1024 * 1024)).toBe(true);
  });

  it("allows normal clips (an hour of opus is well under)", () => {
    expect(isAudioImportTooLarge(0)).toBe(false);
    expect(isAudioImportTooLarge(10 * 1024 * 1024)).toBe(false);
    expect(isAudioImportTooLarge(MAX_AUDIO_IMPORT_BYTES)).toBe(false);
  });
});
