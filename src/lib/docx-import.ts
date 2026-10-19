/**
 * WordprocessingML (.docx) → ImportedBlock[] extractor.
 *
 * Pure string processing — no DOM and no platform APIs — so the exact same
 * code runs in the browser bundle, in bun unit tests and anywhere else.
 * Word documents (including OneNote's "Save as Word document" export) are
 * machine-generated XML with a very regular shape, which a small, focused
 * scanner handles reliably; the extractor is covered by fixture tests.
 *
 * Phase 1 scope: titles, headings, paragraphs (with bold/italic runs
 * flattened — Excalidraw text is plain), hard breaks, bullet and ordered
 * lists (via word/numbering.xml), and tables rendered as " | "-joined rows.
 */
import { unzipSync } from "fflate";
import {
  decodeEntities,
  normalizeBlockText,
  type ImportedBlock,
} from "./import-blocks";

/** numId → per-level format ("bullet" | "decimal") resolved from numbering.xml. */
type NumberingFormats = Map<number, Map<number, "bullet" | "decimal">>;

/** Running counters for ordered lists, keyed by "numId:ilvl". */
type NumberingCounters = Map<string, number>;

export function extractDocxBlocks(bytes: Uint8Array): ImportedBlock[] {
  const files = safeUnzip(bytes);
  const documentXml = readEntry(files, "word/document.xml");
  if (!documentXml) {
    throw new Error("Not a Word document: word/document.xml is missing");
  }
  const numberingXml = readEntry(files, "word/numbering.xml");
  const formats = parseNumbering(numberingXml);
  const counters: NumberingCounters = new Map();

  const body = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? documentXml;
  const blocks: ImportedBlock[] = [];
  for (const part of iterateTopLevel(body)) {
    if (part.startsWith("<w:tbl")) {
      blocks.push(...tableBlocks(part));
    } else {
      const block = paragraphBlock(part, formats, counters);
      if (block) blocks.push(block);
    }
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* package + xml plumbing                                              */
/* ------------------------------------------------------------------ */

function safeUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("Not a Word document: the file is not a valid .zip package");
  }
}

function readEntry(files: Record<string, Uint8Array>, name: string): string | null {
  const entry = files[name];
  return entry ? new TextDecoder().decode(entry) : null;
}

/**
 * Yield the direct children of <w:body>: each <w:p …>…</w:p> (or <w:p/>)
 * and each (possibly nested) <w:tbl>…</w:tbl>. Paragraphs inside a table
 * are consumed with their table, never yielded separately.
 */
function* iterateTopLevel(body: string): Generator<string> {
  const opens: Array<{ tag: "p" | "tbl"; start: number }> = [
    ...body.matchAll(/<w:p(?=[\s/>])/g),
  ].map((m) => ({ tag: "p" as const, start: m.index ?? 0 }));
  for (const m of body.matchAll(/<w:tbl(?=[\s/>])/g)) {
    opens.push({ tag: "tbl" as const, start: m.index ?? 0 });
  }
  opens.sort((a, b) => a.start - b.start);

  let skipUntil = -1;
  for (const open of opens) {
    if (open.start < skipUntil) continue; // inside a table handled earlier
    if (open.tag === "p") {
      const close = body.indexOf("</w:p>", open.start);
      yield close < 0
        ? body.slice(open.start)
        : body.slice(open.start, close + "</w:p>".length);
    } else {
      const end = findTableEnd(body, open.start);
      skipUntil = end;
      yield body.slice(open.start, end);
    }
  }
}

/** End index (exclusive) of a <w:tbl>, honouring nested tables. */
function findTableEnd(body: string, start: number): number {
  let depth = 0;
  for (const m of body.slice(start).matchAll(/<w:tbl(?=[\s/>])|<\/w:tbl>/g)) {
    depth += m[0] === "</w:tbl>" ? -1 : 1;
    if (depth === 0) return start + (m.index ?? 0) + m[0].length;
  }
  return body.length;
}

/* ------------------------------------------------------------------ */
/* numbering                                                           */
/* ------------------------------------------------------------------ */

function parseNumbering(numberingXml: string | null): NumberingFormats {
  const formats: NumberingFormats = new Map();
  if (!numberingXml) return formats;
  // abstractNumId → level → format
  const abstract = new Map<string, Map<number, "bullet" | "decimal">>();
  for (const abs of numberingXml.matchAll(
    /<w:abstractNum\s[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    const levels = new Map<number, "bullet" | "decimal">();
    for (const lvl of abs[2].matchAll(
      /<w:lvl\s[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g,
    )) {
      levels.set(parseInt(lvl[1], 10), /w:val="decimal"/.test(lvl[2]) ? "decimal" : "bullet");
    }
    abstract.set(abs[1], levels);
  }
  for (const num of numberingXml.matchAll(
    /<w:num\s[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g,
  )) {
    const absId = num[2].match(/<w:abstractNumId\s+w:val="(\d+)"/)?.[1];
    if (absId !== undefined) formats.set(parseInt(num[1], 10), abstract.get(absId) ?? new Map());
  }
  return formats;
}

/* ------------------------------------------------------------------ */
/* paragraphs                                                          */
/* ------------------------------------------------------------------ */

function paragraphBlock(
  pXml: string,
  formats: NumberingFormats,
  counters: NumberingCounters,
): ImportedBlock | null {
  const text = runsText(pXml);
  const style = pXml.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1] ?? "";
  const heading = headingLevel(style);

  const hasNumPr = /<w:numPr>/.test(pXml);
  if (!hasNumPr) {
    if (!text) return null; // empty paragraph
    if (heading > 0) {
      return { kind: "heading", level: heading, marker: "", indent: 0, text };
    }
    return { kind: "paragraph", level: 0, marker: "", indent: 0, text };
  }

  // list item
  const ilvl = parseInt(pXml.match(/<w:ilvl\s+w:val="(\d+)"/)?.[1] ?? "0", 10);
  const numId = parseInt(pXml.match(/<w:numId\s+w:val="(\d+)"/)?.[1] ?? "0", 10);
  const format = formats.get(numId)?.get(ilvl) ?? "bullet";
  let marker: string;
  if (format === "decimal") {
    const key = `${numId}:${ilvl}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    // a shallower list level restarts numbering at deeper levels
    for (const other of counters.keys()) {
      const [, level] = other.split(":").map(Number) as [number, number];
      if (level > ilvl) counters.set(other, 0);
    }
    marker = `${next}.`;
  } else {
    marker = "•";
  }
  if (!text) return null;
  return { kind: "list-item", level: heading, marker, indent: ilvl, text };
}

/** Heading level for a paragraph style id (Title, Subtitle, Heading1-6). */
function headingLevel(style: string): number {
  if (style === "Title") return 1;
  if (style === "Subtitle") return 2;
  const match = /^Heading([1-6])$/.exec(style);
  return match ? parseInt(match[1], 10) : 0;
}

/** Concatenated text of a paragraph's runs: <w:t>, <w:br/>, <w:tab/>. */
function runsText(pXml: string): string {
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g;
  for (const m of pXml.matchAll(re)) {
    if (m[0] === "<w:br/>") out.push("\n");
    else if (m[0] === "<w:tab/>") out.push("\t");
    else out.push(decodeEntities(m[1] ?? ""));
  }
  return normalizeBlockText(out.join(""));
}

/* ------------------------------------------------------------------ */
/* tables                                                              */
/* ------------------------------------------------------------------ */

function tableBlocks(tblXml: string): ImportedBlock[] {
  const blocks: ImportedBlock[] = [];
  for (const row of tblXml.matchAll(/<w:tr(?=[\s/>])[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cell of row[0].matchAll(/<w:tc(?=[\s/>])[\s\S]*?<\/w:tc>/g)) {
      cells.push(runsText(cell[0]));
    }
    const text = cells.filter(Boolean).join(" | ");
    if (text) {
      blocks.push({ kind: "paragraph", level: 0, marker: "", indent: 0, text });
    }
  }
  return blocks;
}
