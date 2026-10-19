/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { extractDocxBlocks } from "../docx-import";

const FIXTURE = `${import.meta.dir}/fixtures/onenote-export.docx`;

async function fixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(FIXTURE).arrayBuffer());
}

describe("extractDocxBlocks — OneNote-exported .docx fixture", () => {
  it("reads the Title style as a level-1 heading", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    expect(blocks[0]).toEqual({
      kind: "heading",
      level: 1,
      marker: "",
      indent: 0,
      text: "Quarterly Review",
    });
  });

  it("reads Heading1 paragraphs", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    const agenda = blocks.find((b) => b.text === "Agenda");
    expect(agenda?.kind).toBe("heading");
    expect(agenda?.level).toBe(1);
  });

  it("flattens bold runs and converts <w:br/> to a line break", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    const para = blocks.find((b) => b.text.includes("quantumfrog"));
    expect(para?.kind).toBe("paragraph");
    expect(para?.text).toBe(
      "We reviewed the quantumfrog launch and the roadmap.\nSecond line continues here.",
    );
  });

  it("renders bullets with nesting and ordered items with counters", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    expect(blocks.find((b) => b.text === "Campus release")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 0,
    });
    expect(blocks.find((b) => b.text === "ship the canvas upgrade")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 1,
    });
    expect(blocks.find((b) => b.text === "First decision")).toMatchObject({
      kind: "list-item",
      marker: "1.",
    });
    expect(blocks.find((b) => b.text === "Second decision")).toMatchObject({
      kind: "list-item",
      marker: "2.",
    });
  });

  it("renders table rows as pipe-joined paragraphs", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    expect(blocks.some((b) => b.text === "Owner | Status")).toBe(true);
    expect(blocks.some((b) => b.text === "Tiana | On track")).toBe(true);
  });

  it("never emits empty blocks", async () => {
    const blocks = await extractDocxBlocks(await fixtureBytes());
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.text.length > 0)).toBe(true);
  });
});

describe("extractDocxBlocks — edge cases", () => {
  it("throws a clear error for a non-zip file", () => {
    expect(() => extractDocxBlocks(new TextEncoder().encode("not a zip"))).toThrow(
      /Not a Word document/,
    );
  });

  it("throws when word/document.xml is missing", () => {
    const bytes = zipSync({ "hello.txt": new TextEncoder().encode("hi") });
    expect(() => extractDocxBlocks(bytes)).toThrow(/word\/document\.xml/);
  });

  it("falls back to bullets when numbering.xml is absent", () => {
    const xml =
      '<w:document xmlns:w="urn:x"><w:body>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>' +
      "<w:r><w:t>Plain item</w:t></w:r></w:p></w:body></w:document>";
    const bytes = zipSync({ "word/document.xml": new TextEncoder().encode(xml) });
    expect(extractDocxBlocks(bytes)[0]).toMatchObject({
      kind: "list-item",
      marker: "•",
      text: "Plain item",
    });
  });

  it("decodes XML entities in text runs", () => {
    const xml =
      '<w:document xmlns:w="urn:x"><w:body><w:p><w:r>' +
      "<w:t>a &amp; b &lt;c&gt; &#65;&#x42;</w:t></w:r></w:p></w:body></w:document>";
    const bytes = zipSync({ "word/document.xml": new TextEncoder().encode(xml) });
    expect(extractDocxBlocks(bytes)[0].text).toBe("a & b <c> AB");
  });

  it("never double-decodes entities", () => {
    const xml =
      '<w:document xmlns:w="urn:x"><w:body><w:p><w:r>' +
      "<w:t>&amp;lt;raw&amp;gt;</w:t></w:r></w:p></w:body></w:document>";
    const bytes = zipSync({ "word/document.xml": new TextEncoder().encode(xml) });
    expect(extractDocxBlocks(bytes)[0].text).toBe("&lt;raw&gt;");
  });
});
