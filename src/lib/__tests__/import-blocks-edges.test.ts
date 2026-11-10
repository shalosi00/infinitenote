/// <reference types="bun-types" />
/**
 * Edge-case coverage for the shared import-blocks helpers, complementing
 * import-layout.test.ts (which covers the issue #88/#89 scenarios):
 * heading-level clamping, the full entity-decoding surface (decimal/hex/
 * astral numeric refs, invalid refs, named entities, no double decoding),
 * whitespace normalization, exact wrap-budget arithmetic and the wide-char
 * range boundaries. Pure functions — no fixtures, no network.
 */
import { describe, expect, it } from "bun:test";
import {
  decodeEntities,
  estimateLineCount,
  headingFontSize,
  isWideChar,
  normalizeBlockText,
} from "../import-blocks";

describe("headingFontSize", () => {
  it("clamps out-of-range levels instead of indexing outside the ladder", () => {
    expect(headingFontSize(0)).toBe(40); // below the range → level 1
    expect(headingFontSize(-2)).toBe(40);
    expect(headingFontSize(7)).toBe(20); // above the range → level 6
    expect(headingFontSize(99)).toBe(20);
  });
});

describe("decodeEntities — numeric references", () => {
  it("decodes decimal, lower- and upper-case hex refs, including astral points", () => {
    expect(decodeEntities("&#65;&#x42;&#X43;")).toBe("ABC");
    expect(decodeEntities("&#x1F600;")).toBe("😀");
    expect(decodeEntities("&#x4E2D;&#25991;")).toBe("中文");
  });

  it("leaves invalid code points and unknown entity names untouched", () => {
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;"); // beyond Unicode
    expect(decodeEntities("&#-5;")).toBe("&#-5;"); // negative — not a numeric ref
    expect(decodeEntities("&bogus;")).toBe("&bogus;");
  });
});

describe("decodeEntities — named entities and ordering", () => {
  it("decodes the accepted named entities", () => {
    expect(decodeEntities("&quot;q&quot; &apos;a&apos;")).toBe('"q" \'a\'');
    expect(decodeEntities("&mdash;&ndash;&hellip;&middot;")).toBe("—–…·");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodes &amp; last, so a pre-escaped entity name survives verbatim", () => {
    expect(decodeEntities("&amp;mdash;")).toBe("&mdash;");
    expect(decodeEntities("R &amp; D")).toBe("R & D");
  });
});

describe("normalizeBlockText", () => {
  it("collapses space/tab runs, trims lines and drops blank lines", () => {
    expect(normalizeBlockText("  a \t b  ")).toBe("a b");
    expect(normalizeBlockText("a\n\n\nb")).toBe("a\nb");
    expect(normalizeBlockText("  x \n\n  y  ")).toBe("x\ny");
    expect(normalizeBlockText("\t \n")).toBe("");
  });
});

describe("estimateLineCount — exact budget arithmetic", () => {
  it("spends 1em per wide char and wraps once the budget is exhausted", () => {
    // 10px font in a 20px-wide block → 2em per line
    expect(estimateLineCount("中中", 10, 20)).toBe(1);
    expect(estimateLineCount("中中中", 10, 20)).toBe(2);
    expect(estimateLineCount("中中中\n中", 10, 20)).toBe(3); // newline resets budget
  });

  it("spends 0.52em per narrow char and clamps sub-em budgets to one em", () => {
    expect(estimateLineCount("a", 100, 100)).toBe(1); // 1em/line, one char fits
    expect(estimateLineCount("aaa", 100, 100)).toBe(3); // each char needs its own line
    expect(estimateLineCount("ab", 100, 50)).toBe(2); // width < fontSize → 1em/line
  });
});

describe("isWideChar — range boundaries", () => {
  it("classifies exact code points at the wide/narrow range edges", () => {
    expect(isWideChar(String.fromCodePoint(0x2e80))).toBe(true); // CJK radicals start
    expect(isWideChar(String.fromCodePoint(0x2e7f))).toBe(false); // just before
    expect(isWideChar(String.fromCodePoint(0x9fff))).toBe(true); // CJK unified end
    expect(isWideChar(String.fromCodePoint(0xa000))).toBe(true); // Yi syllables start
    expect(isWideChar(String.fromCodePoint(0xff60))).toBe(true); // fullwidth forms end
    expect(isWideChar(String.fromCodePoint(0xff61))).toBe(false); // halfwidth start
    expect(isWideChar(String.fromCodePoint(0x3000))).toBe(true); // ideographic space
  });
});
