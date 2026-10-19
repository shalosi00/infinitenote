/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { extractHtmlBlocks, extractHtmlContent } from "../html-import";

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

describe("extractHtmlContent — embedded images", () => {
  it("extracts data: URLs with declared dimensions", () => {
    const html = `<p>before</p><img src="data:image/png;base64,AAAA" width="240" height="156">`;
    const { blocks, images } = extractHtmlContent(html);
    expect(blocks.map((b) => b.text)).toEqual(["before"]);
    expect(images).toEqual([
      { src: "data:image/png;base64,AAAA", width: 240, height: 156, blockIndex: 1 },
    ]);
  });

  it("places an image inside pending text after that text's block", () => {
    const html = `<p>caption<img src="data:image/gif;base64,BBBB">tail</p>`;
    const { images } = extractHtmlContent(html);
    expect(images[0].blockIndex).toBe(1); // after the paragraph it sits inside
  });

  it("counts blocks, not characters: image after a list", () => {
    const html = `<ul><li>one</li><li>two</li></ul><img src="cid:cover.png">`;
    const { blocks, images } = extractHtmlContent(html);
    expect(blocks).toHaveLength(2);
    expect(images[0]).toMatchObject({ src: "cid:cover.png", blockIndex: 2, width: null, height: null });
  });

  it("accepts single-quoted, unquoted and mixed attribute forms", () => {
    const a = extractHtmlContent(`<img src='data:image/png;base64,A'>`).images;
    const b = extractHtmlContent(`<img src=data:image/png;base64,B width=50>`).images;
    const c = extractHtmlContent(`<IMG SRC="data:image/png;base64,C" HEIGHT="7">`).images;
    expect(a[0].src).toBe("data:image/png;base64,A");
    expect(b[0]).toMatchObject({ src: "data:image/png;base64,B", width: 50 });
    expect(c[0]).toMatchObject({ src: "data:image/png;base64,C", height: 7 });
  });

  it("skips img tags without a usable src and ignores junk dimensions", () => {
    const { images } = extractHtmlContent(
      `<img alt="no src"><img src="x.png" width="-5" height="abc">`,
    );
    expect(images).toEqual([
      { src: "x.png", width: null, height: null, blockIndex: 0 },
    ]);
  });

  it("keeps document order across multiple images", () => {
    const html = [
      `<h1>t</h1>`,
      `<img src="one.png">`,
      `<p>a</p>`,
      `<img src="two.png">`,
      `<img src="three.png">`,
      `<p>b</p>`,
    ].join("");
    const { images } = extractHtmlContent(html);
    expect(images.map((i) => i.src)).toEqual(["one.png", "two.png", "three.png"]);
    expect(images.map((i) => i.blockIndex)).toEqual([1, 2, 2]);
  });

  it("ignores images inside the head (style blocks stripped)", () => {
    const html = `<head><style>a{background:url(x.png)}</style></head><body><p>ok</p></body>`;
    const { images } = extractHtmlContent(html);
    expect(images).toEqual([]);
  });
});
