/// <reference types="bun-types" />
/**
 * Edge-case coverage for the HTML tokenizer, complementing the fixture-based
 * html-import.test.ts: tag-less text, the full h1–h6 range, blockquote/pre
 * containers, nested and mixed lists, CJK content with numeric/named
 * entities, table cell quirks (empty cells, th-only rows, loose <tr>),
 * case-insensitive tags with doctype/comments, and zero-sized images.
 * All inputs are inline strings — deterministic, no fixtures, no network.
 */
import { describe, expect, it } from "bun:test";
import { extractHtmlBlocks, extractHtmlContent } from "../html-import";

describe("extractHtmlBlocks — block shapes", () => {
  it("flushes tag-less plain text as a single paragraph", () => {
    expect(extractHtmlBlocks("just words, no tags at all")).toEqual([
      { kind: "paragraph", level: 0, marker: "", indent: 0, text: "just words, no tags at all" },
    ]);
  });

  it("maps the whole h1–h6 range onto heading levels", () => {
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>t${n}</h${n}>`).join("");
    const expected = [1, 2, 3, 4, 5, 6].map((n) => ["heading", n, `t${n}`]);
    expect(extractHtmlBlocks(html).map((b) => [b.kind, b.level, b.text])).toEqual(expected);
  });

  it("treats blockquote and pre as paragraph containers", () => {
    const blocks = extractHtmlBlocks("<blockquote>quoted words</blockquote><pre>code here</pre>");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
    expect(blocks.map((b) => b.text)).toEqual(["quoted words", "code here"]);
  });
});

describe("extractHtmlBlocks — list nesting", () => {
  it("restarts ordered markers at each nesting level", () => {
    const html = "<ol><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ol>";
    expect(extractHtmlBlocks(html).map((b) => [b.marker, b.indent, b.text])).toEqual([
      ["1.", 0, "a"],
      ["1.", 1, "b"],
      ["2.", 1, "c"],
      ["2.", 0, "d"],
    ]);
  });

  it("keeps bullet markers for a ul nested inside an ol", () => {
    const html = "<ol><li>one<ul><li>sub</li></ul></li></ol>";
    expect(extractHtmlBlocks(html).map((b) => [b.marker, b.indent, b.text])).toEqual([
      ["1.", 0, "one"],
      ["•", 1, "sub"],
    ]);
  });
});

describe("extractHtmlBlocks — content edges", () => {
  it("keeps CJK text and decodes numeric and named entities", () => {
    const blocks = extractHtmlBlocks(
      "<h2>三、会议记录</h2><p>中文段落 &#x4e2d;&#25991; &lt;tag&gt; &nbsp;end</p>",
    );
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 2, text: "三、会议记录" });
    expect(blocks[1].text).toBe("中文段落 中文 <tag> end");
  });

  it("keeps an empty table cell's column position with a doubled separator", () => {
    const blocks = extractHtmlBlocks("<table><tr><td>a</td><td></td><td>c</td></tr></table>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("a | | c");
  });

  it("renders th-only header rows and loose <tr> fragments outside any table", () => {
    const html =
      "<table><tr><th>H1</th><th>H2</th></tr></table>" +
      "loose<tr><td>x</td><td>y</td></tr>";
    expect(extractHtmlBlocks(html).map((b) => b.text)).toEqual(["H1 | H2", "loose", "x | y"]);
  });

  it("matches tags case-insensitively and strips doctype and inline comments", () => {
    const blocks = extractHtmlBlocks(
      "<!DOCTYPE html><P>upper <B>para</B></P><!-- gone --><DIV>UD</DIV>",
    );
    expect(blocks.map((b) => b.text)).toEqual(["upper para", "UD"]);
  });
});

describe("extractHtmlContent — image dimension edges", () => {
  it("treats zero-sized images as dimensionless (width/height null)", () => {
    const { images } = extractHtmlContent('<p>pic</p><img src="flat.svg" width="0" height="0">');
    expect(images).toEqual([{ src: "flat.svg", width: null, height: null, blockIndex: 1 }]);
  });
});
