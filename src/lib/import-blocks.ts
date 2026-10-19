/**
 * Shared shape for structured imports (Word documents, HTML pages).
 *
 * Importers turn source documents into a flat list of blocks; the canvas
 * runtime then lays them out as stacked Excalidraw text elements. Keeping
 * this module dependency-free (and DOM-free) means the extractors run
 * identically in the browser bundle, in bun unit tests and during SSR.
 */

export interface ImportedBlock {
  kind: "heading" | "paragraph" | "list-item";
  /** Heading level 1-6; 0 for paragraphs and list items. */
  level: number;
  /** List marker shown before the text ("•", "1.", …); empty otherwise. */
  marker: string;
  /** List nesting depth (0 = top level). */
  indent: number;
  /** Block text. May contain "\n" for hard line breaks. */
  text: string;
}

/** Canvas font sizes for heading levels 1-6 (body text renders at 20). */
export const HEADING_FONT_SIZES = [40, 32, 28, 25, 22, 20] as const;

export function headingFontSize(level: number): number {
  const clamped = Math.min(Math.max(level, 1), 6);
  return HEADING_FONT_SIZES[clamped - 1];
}

/** Decode the XML/HTML entities we accept in imported documents. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      safeFromCodePoint(parseInt(hex, 16), `&#x${hex};`),
    )
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10), `&#${dec};`))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&middot;/g, "·")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // must be last — never double-decode
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/** Collapse runs of whitespace to single spaces, preserving hard newlines. */
export function normalizeBlockText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
