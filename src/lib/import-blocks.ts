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

/* ------------------------------------------------------------------ */
/* width-aware layout estimates (issue #88)                              */
/* ------------------------------------------------------------------ */

/** Average advance of a narrow (Latin) character, in em units. */
export const NARROW_CHAR_EM = 0.52;

/**
 * Does this character advance a full em when rendered? CJK ideographs,
 * kana, Hangul, fullwidth forms and astral characters (emoji, CJK ext B+)
 * all do — a naive "0.52em per char" estimate under-counts their wrapped
 * height by ~2× and stacked import blocks end up overlapping (issue #88).
 */
export function isWideChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp > 0xffff) return true; // astral: emoji, CJK extension B+
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, kana punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana + CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi syllables
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp === 0x3000 // ideographic space
  );
}

/**
 * Wrapped line count estimate for a text block (issue #88): a character
 * budget per line in em units (blockWidth / fontSize), wide characters
 * spend 1 em, narrow ones 0.52 em, hard newlines always break. Far closer
 * to the real Excalidraw wrap than a flat chars-per-line division.
 */
export function estimateLineCount(
  text: string,
  fontSize: number,
  blockWidth: number,
): number {
  if (!text) return 1;
  const perLineEm = Math.max(1, blockWidth / fontSize);
  let lines = 1;
  let budget = perLineEm;
  for (const ch of text) {
    if (ch === "\n") {
      lines += 1;
      budget = perLineEm;
      continue;
    }
    const advance = isWideChar(ch) ? 1 : NARROW_CHAR_EM;
    if (advance > budget) {
      lines += 1;
      budget = perLineEm;
    }
    budget -= advance;
  }
  return lines;
}

/**
 * Sane intrinsic size for images that report none (issue #89): SVGs without
 * width/height attributes yield naturalWidth/Height 0, which previously
 * collapsed the placed element to a 16px sliver.
 */
export function withIntrinsicFallback(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: width > 0 ? width : 480,
    height: height > 0 ? height : 360,
  };
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
