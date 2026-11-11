/// <reference types="bun-types" />
/**
 * Edge-case coverage for the .docx extractor, complementing the fixture-based
 * docx-import.test.ts: heading styles beyond Title/Heading1, CJK and astral
 * text, per-level numbering formats, ordered-counter resets across numIds,
 * table quirks (attributes, empty cells, nesting), a missing <w:body>
 * wrapper, truncated documents and blank content. All inputs are tiny
 * in-memory zip packages built with fflate — deterministic, no fixtures.
 */
import { describe, expect, it } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { extractDocxBlocks } from "../docx-import";

/** Wrap body xml in a minimal single-part .docx package (plus optional parts). */
function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="urn:wordprocessingml">` +
    `<w:body>${body}</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(xml), ...extra });
}

/** A paragraph with an optional <w:pPr> block (style, numbering…). */
function para(text: string, pPr = ""): string {
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** A numbered list-item paragraph at the given numId / nesting level. */
function item(text: string, numId: number, ilvl: number): string {
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/>` +
    `<w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

/** A <w:tr>; every cell becomes one <w:tc> holding a single paragraph. */
function row(cells: string[]): string {
  const tcs = cells
    .map((c) => `<w:tc w:tcW="500"><w:tcPr/><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`)
    .join("");
  return `<w:tr w:rsidR="00A1">${tcs}</w:tr>`;
}

/** numbering.xml: numId 1 = decimal@0 + bullet@1, numId 2 = decimal@0+1. */
function numberingXml(): Uint8Array {
  return strToU8(
    `<?xml version="1.0"?><w:numbering xmlns:w="urn:wordprocessingml">` +
      `<w:abstractNum w:abstractNumId="0">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`,
  );
}

describe("extractDocxBlocks — heading styles", () => {
  it("maps Heading2–Heading6 and Subtitle onto their heading levels", () => {
    const body =
      ["2", "3", "4", "5", "6"]
        .map((n) => para(`h${n}`, `<w:pPr><w:pStyle w:val="Heading${n}"/></w:pPr>`))
        .join("") +
      para("subtitle text", `<w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>`);
    const blocks = extractDocxBlocks(docx(body));
    expect(blocks.map((b) => [b.kind, b.level, b.text])).toEqual([
      ["heading", 2, "h2"],
      ["heading", 3, "h3"],
      ["heading", 4, "h4"],
      ["heading", 5, "h5"],
      ["heading", 6, "h6"],
      ["heading", 2, "subtitle text"],
    ]);
  });

  it("treats unknown and missing paragraph styles as plain paragraphs", () => {
    const body =
      para("custom style", `<w:pPr><w:pStyle w:val="QuoteCustom"/></w:pPr>`) + para("no style");
    const blocks = extractDocxBlocks(docx(body));
    expect(blocks.every((b) => b.kind === "paragraph" && b.level === 0)).toBe(true);
    expect(blocks.map((b) => b.text)).toEqual(["custom style", "no style"]);
  });
});

describe("extractDocxBlocks — text content edges", () => {
  it("keeps CJK text and astral characters (emoji) intact", () => {
    const blocks = extractDocxBlocks(docx(para("季度审查 — 量子蛙🐸发布")));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("季度审查 — 量子蛙🐸发布");
  });

  it("drops empty paragraphs, whitespace-only runs and empty list items", () => {
    const body =
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>' + // styled but textless
      item(" ", 1, 0) + // whitespace-only list item
      para("kept") +
      "<w:p><w:r><w:t>\t \n</w:t></w:r></w:p>"; // whitespace-only run
    const blocks = extractDocxBlocks(docx(body));
    expect(blocks.map((b) => b.text)).toEqual(["kept"]);
  });

  it("extracts the last paragraph of a truncated document (no closing tags)", () => {
    const xml =
      `<?xml version="1.0"?><w:document xmlns:w="urn:x">` +
      `<w:body><w:p><w:r><w:t>tail</w:t></w:r>`; // neither </w:p> nor </w:body>
    const blocks = extractDocxBlocks(zipSync({ "word/document.xml": strToU8(xml) }));
    expect(blocks.map((b) => b.text)).toEqual(["tail"]);
  });

  it("falls back to scanning the whole document.xml when <w:body> is absent", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="urn:x">${para("nobody")}</w:document>`;
    const blocks = extractDocxBlocks(zipSync({ "word/document.xml": strToU8(xml) }));
    expect(blocks.map((b) => b.text)).toEqual(["nobody"]);
  });
});

describe("extractDocxBlocks — numbering.xml resolution", () => {
  it("resolves per-level formats: decimal at level 0, bullet at level 1", () => {
    const body = item("top", 1, 0) + item("kid", 1, 1);
    const blocks = extractDocxBlocks(docx(body, { "word/numbering.xml": numberingXml() }));
    expect(blocks.map((b) => [b.marker, b.indent, b.text])).toEqual([
      ["1.", 0, "top"],
      ["•", 1, "kid"],
    ]);
  });

  it("restarts deeper ordered counters when a shallower item appears", () => {
    const body =
      item("one", 2, 0) + item("deepA", 2, 1) + item("deepB", 2, 1) +
      item("two", 2, 0) + item("deepC", 2, 1);
    const blocks = extractDocxBlocks(docx(body, { "word/numbering.xml": numberingXml() }));
    expect(blocks.map((b) => b.marker)).toEqual(["1.", "1.", "2.", "2.", "1."]);
    expect(blocks.map((b) => b.indent)).toEqual([0, 1, 1, 0, 1]);
  });
});

describe("extractDocxBlocks — table edges", () => {
  it("parses attribute-carrying table tags and drops empty cells", () => {
    const body =
      `<w:tbl w:tblW="0" w:tblLayout="fixed">${row(["a", "", "c"])}</w:tbl>` +
      `<w:tbl w:tblW="1">${row(["", ""])}</w:tbl>`; // entirely empty row
    const blocks = extractDocxBlocks(docx(body));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", text: "a | c" });
  });

  it("flattens a nested table into the outer row without duplicating text", () => {
    const inner = `<w:tbl>${row(["inner"])}</w:tbl>`;
    const outer =
      `<w:tbl><w:tr><w:tc w:tcW="0">` +
      `<w:p><w:r><w:t>outer</w:t></w:r></w:p>${inner}` +
      `</w:tc></w:tr></w:tbl>`;
    const blocks = extractDocxBlocks(docx(outer));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain("outer");
    expect(blocks[0].text).toContain("inner");
  });
});
