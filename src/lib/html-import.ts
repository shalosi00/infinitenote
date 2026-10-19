/**
 * HTML → ImportedBlock[] extractor for machine-generated pages — OneNote's
 * "Save as" HTML export in particular, plus plain web articles.
 *
 * Pure string tokenizer — no DOMParser (unavailable in bun tests), no
 * dependencies. Handles: h1-h6, paragraphs, <br> line breaks, nested
 * ul/ol lists (bullets and "1." markers), tables as " | "-joined rows,
 * entity decoding; ignores <head>/<script>/<style>/comments.
 *
 * Divs are containers only (OneNote wraps content in deeply nested
 * positioned <div>s — flushing on every open tag would shred paragraphs).
 * A </div> flushes whatever loose text has accumulated, so the legacy
 * OneNote "one positioned div per line" export style still works.
 */
import {
  decodeEntities,
  normalizeBlockText,
  type ImportedBlock,
} from "./import-blocks";

const BLOCK_TAGS = new Set(["p", "blockquote", "pre"]);

interface CurrentBlock {
  kind: ImportedBlock["kind"];
  level: number;
  marker: string;
  indent: number;
  /** tag that opened this block ("li", "p", "h2", "tr", …) */
  tag: string;
}

export function extractHtmlBlocks(html: string): ImportedBlock[] {
  const cleaned = stripIgnorable(html);
  const blocks: ImportedBlock[] = [];
  const listStack: Array<{ ordered: boolean; counter: number }> = [];

  let buffer = "";
  let current: CurrentBlock | null = null;

  /** Emit the pending buffer (if non-empty) as a block and reset. */
  const flush = () => {
    const text = normalizeBlockText(buffer);
    if (text) {
      const shape = current ?? { kind: "paragraph" as const, level: 0, marker: "", indent: 0, tag: "" };
      blocks.push({
        kind: shape.kind,
        level: shape.level,
        marker: shape.marker,
        indent: shape.indent,
        text,
      });
    }
    buffer = "";
    current = null;
  };

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  for (const token of cleaned.matchAll(tagRe)) {
    const [full, tagName, , text] = token as unknown as [
      string, string, string, string | undefined,
    ];

    if (text !== undefined) {
      // text node: collapse source whitespace (indentation, newlines)
      buffer += decodeEntities(text.replace(/\s+/g, " "));
      continue;
    }

    const name = tagName.toLowerCase();
    const closing = full.startsWith("</");

    if (closing) {
      if (name === "ul" || name === "ol") {
        flush();
        listStack.pop();
      } else if (current && name === current.tag) {
        flush();
      } else if (name === "p" || name === "div") {
        // </p> / </div> end loose content even when tags interleave oddly
        flush();
      }
      continue;
    }

    // ---- opening tag ----
    if (name === "br") {
      buffer += "\n";
    } else if (name === "ul" || name === "ol") {
      flush();
      listStack.push({ ordered: name === "ol", counter: 0 });
    } else if (name === "tr") {
      flush();
      current = { kind: "paragraph", level: 0, marker: "", indent: 0, tag: "tr" };
    } else if (name === "td" || name === "th") {
      if (buffer.trim()) buffer += " | ";
      if (!current) current = { kind: "paragraph", level: 0, marker: "", indent: 0, tag: "tr" };
    } else if (/^h[1-6]$/.test(name)) {
      flush();
      current = {
        kind: "heading",
        level: parseInt(name.slice(1), 10),
        marker: "",
        indent: 0,
        tag: name,
      };
    } else if (name === "li") {
      flush();
      const parent = listStack[listStack.length - 1];
      const indent = Math.max(0, listStack.length - 1);
      let marker = "•";
      if (parent?.ordered) {
        parent.counter += 1;
        marker = `${parent.counter}.`;
      }
      current = { kind: "list-item", level: 0, marker, indent, tag: "li" };
    } else if (BLOCK_TAGS.has(name)) {
      flush();
      current = { kind: "paragraph", level: 0, marker: "", indent: 0, tag: name };
    }
    // any other opening tag (span, b, i, div, img, …): inline — no-op
  }
  flush();
  return blocks;
}

/** Remove everything that must never contribute text: head, script, style, comments. */
function stripIgnorable(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ");
}
