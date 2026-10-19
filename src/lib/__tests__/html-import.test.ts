/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { extractHtmlBlocks } from "../html-import";

const FIXTURE = `${import.meta.dir}/fixtures/onenote-page.html`;

async function fixtureHtml(): Promise<string> {
  return Bun.file(FIXTURE).text();
}

describe("extractHtmlBlocks — OneNote-exported HTML fixture", () => {
  it("reads the page heading", async () => {
    const blocks = extractHtmlBlocks(await fixtureHtml());
    expect(blocks[0]).toEqual({
      kind: "heading",
      level: 1,
      marker: "",
      indent: 0,
      text: "Project ideas",
    });
  });

  it("decodes entities and flattens inline styles", async () => {
    const blocks = extractHtmlBlocks(await fixtureHtml());
    const para = blocks.find((b) => b.text.includes("Brainstorm"));
    expect(para?.text).toBe(
      "Brainstorm from today's sync — we need faster ink and a lighter bundle.",
    );
  });

  it("keeps nested list structure with bullets", async () => {
    const blocks = extractHtmlBlocks(await fixtureHtml());
    expect(blocks.find((b) => b.text === "Infinite canvas polish")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 0,
    });
    expect(blocks.find((b) => b.text === "OneNote import paths")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 0,
    });
    expect(blocks.find((b) => b.text === "Word documents (.docx)")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 1,
    });
    expect(blocks.find((b) => b.text === "QUANTUMFROG telemetry hook")).toMatchObject({
      kind: "list-item",
      marker: "•",
      indent: 0,
    });
  });

  it("renders table rows as pipe-joined paragraphs", async () => {
    const blocks = extractHtmlBlocks(await fixtureHtml());
    expect(blocks.some((b) => b.text === "Area | Owner")).toBe(true);
    expect(blocks.some((b) => b.text === "Canvas | Tiana")).toBe(true);
  });

  it("ignores head, script, style and comment content", async () => {
    const blocks = extractHtmlBlocks(await fixtureHtml());
    const text = blocks.map((b) => b.text).join("\n");
    expect(text).not.toContain("shouldBeIgnored");
    expect(text).not.toContain("Calibri");
    expect(text).not.toContain("list-style-type");
    expect(text).not.toContain("a comment that must be ignored");
  });
});

describe("extractHtmlBlocks — edge cases", () => {
  it("renders ordered list markers", () => {
    const blocks = extractHtmlBlocks("<ol><li>first</li><li>second</li></ol>");
    expect(blocks[0]).toMatchObject({ kind: "list-item", marker: "1.", text: "first" });
    expect(blocks[1]).toMatchObject({ kind: "list-item", marker: "2.", text: "second" });
  });

  it("treats bare positioned divs as paragraphs (legacy OneNote style)", () => {
    const blocks = extractHtmlBlocks("<div>line one</div><div>line two</div>");
    expect(blocks.map((b) => b.text)).toEqual(["line one", "line two"]);
  });

  it("converts <br> into hard line breaks", () => {
    expect(extractHtmlBlocks("<p>a<br>b</p>")[0].text).toBe("a\nb");
  });

  it("does not glue adjacent inline tags without whitespace", () => {
    expect(extractHtmlBlocks("<p>quan<b>tum</b>frog</p>")[0].text).toBe("quantumfrog");
  });

  it("separates source-newline-separated inline text", () => {
    expect(extractHtmlBlocks("<p>faster\n<b>ink</b></p>")[0].text).toBe("faster ink");
  });

  it("restarts ordered counters per list", () => {
    const html = "<ol><li>one</li></ol><ol><li>two</li></ol>";
    const blocks = extractHtmlBlocks(html);
    expect(blocks[0].marker).toBe("1.");
    expect(blocks[1].marker).toBe("1.");
  });

  it("returns [] for style-only or empty documents", () => {
    expect(
      extractHtmlBlocks("<html><head><style>a{}</style></head><body></body></html>"),
    ).toEqual([]);
    expect(extractHtmlBlocks("")).toEqual([]);
  });
});
