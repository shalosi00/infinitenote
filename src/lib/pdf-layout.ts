/**
 * Print pagination math — pure, no I/O, no jsPDF (fully unit-testable).
 *
 * Model: the scene is scaled to fit the printable width of a fixed page size,
 * then sliced into fixed-height page bands over content space.
 * - Non-text elements are stamped on every band they intersect; the caller
 *   clips them to the band, so a tall image prints as a continuous slice
 *   across pages — exactly like a real printer.
 * - Text elements never get cut mid-glyph: lines flow to the band containing
 *   the line's center, one page per contiguous run of lines.
 */

/** A4 in PDF points (72 dpi). */
export interface PageSpec {
  w: number;
  h: number;
}

export const A4_PORTRAIT: PageSpec = { w: 595.28, h: 841.89 };
export const A4_LANDSCAPE: PageSpec = { w: 841.89, h: 595.28 };

/** Uniform print margin on all sides (pt). Footer sits inside it. */
export const PRINT_MARGIN_PT = 40;

/** Never blow a tiny note up by more than 2×. */
export const MAX_UPSCALE = 2;
/** Never shrink below 10% — beyond that nothing is readable anyway. */
export const MIN_SCALE = 0.1;

/** Vertical rhythm of ruled/grid paper in the exported PDF (pt). */
export const PAPER_RULE_PT = 24;

/** Pixel cap for one dimension of a rendered PDF printout page (issue #87). */
export const MAX_PRINTOUT_DIM_PX = 1600;

/**
 * Scale for rendering one PDF page onto a canvas (issue #87): start from the
 * preferred base scale, but never let the larger dimension exceed the cap —
 * an A0 poster at scale 1.5 would otherwise become a ~3.5k-pixel multi-MB
 * dataURL, and twenty of them balloon the scene and IndexedDB. Mirrors the
 * 1600px cap regular image imports already apply.
 */
export function printoutViewportScale(
  baseWidth: number,
  baseHeight: number,
  baseScale = 1.5,
  maxDim = MAX_PRINTOUT_DIM_PX,
): number {
  const largest = Math.max(baseWidth, baseHeight);
  if (!Number.isFinite(largest) || largest <= 0) return baseScale;
  return baseScale * Math.min(1, maxDim / largest);
}

/**
 * Which elements need the PDF raster-snippet fallback (issue #107) — pure,
 * so the policy is unit-tested. Rasterization exists for elements the
 * vector renderer cannot keep visually correct:
 * - text that is rotated or non-Latin (its box is classified "slice"), and
 * - any non-text element that is rotated.
 * Unrotated shapes draw as vectors, unrotated images from their payload,
 * unrotated Latin text through the flowing-text pass.
 */
export function needsRasterSnippet(
  el: { type: string; angle?: number },
  boxKind: "text" | "slice",
): boolean {
  if (el.type === "text") return boxKind === "slice";
  return (el.angle ?? 0) !== 0;
}

/** Bounding box of one printable element, in content (scene) space. */
export interface ElementBox {
  id: string;
  /** "text" flows line-by-line; anything else is band-sliced with clipping. */
  kind: "text" | "slice";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageBands {
  /** content → paper scale (pt per content unit) */
  scale: number;
  /** content-space top-left of the printed area (min corner of all boxes) */
  originX: number;
  originY: number;
  contentW: number;
  contentH: number;
  /** content-space height covered by one printable page */
  bandH: number;
  pageCount: number;
}

/**
 * Compute the page-band structure for a set of element boxes.
 * Returns null when there is nothing to print.
 */
export function computePageBands(
  boxes: ElementBox[],
  page: PageSpec,
  margin: number = PRINT_MARGIN_PT
): PageBands | null {
  if (!boxes.length) return null;
  let originX = Number.POSITIVE_INFINITY;
  let originY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const b of boxes) {
    originX = Math.min(originX, b.x1);
    originY = Math.min(originY, b.y1);
    maxX = Math.max(maxX, b.x2);
    maxY = Math.max(maxY, b.y2);
  }
  const contentW = Math.max(1, maxX - originX);
  const contentH = Math.max(1, maxY - originY);
  const usableW = Math.max(1, page.w - 2 * margin);
  const usableH = Math.max(1, page.h - 2 * margin);
  const scale = Math.min(MAX_UPSCALE, Math.max(MIN_SCALE, usableW / contentW));
  const bandH = usableH / scale;
  const pageCount = Math.max(1, Math.ceil(contentH / bandH));
  return { scale, originX, originY, contentW, contentH, bandH, pageCount };
}

/** Content-space y of a page band's top edge. */
export function bandTop(bands: PageBands, pageIndex: number): number {
  return bands.originY + pageIndex * bands.bandH;
}

/**
 * 0-based indices of every page band the box vertically intersects.
 * An element exactly touching a boundary still stamps the next band — the
 * caller clips, so a zero-height overlap paints nothing.
 */
export function bandsForBox(box: ElementBox, bands: PageBands): number[] {
  const first = Math.max(0, Math.floor((box.y1 - bands.originY) / bands.bandH));
  const last = Math.min(
    bands.pageCount - 1,
    Math.floor((box.y2 - bands.originY) / bands.bandH)
  );
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

/** Where a text element's lines live, in content space. */
export interface TextFlowSpec {
  /** content-space top of the first line's box */
  top: number;
  /** advance per line (fontSize × lineHeight) in content units */
  lineAdvance: number;
  lineCount: number;
}

/** A contiguous run of lines that prints on one page. */
export interface TextPageSpan {
  page: number;
  firstLine: number;
  lineCount: number;
}

/**
 * Assign every line to the band containing the line's CENTER — a line is
 * never sliced between two pages. Returns contiguous runs, page order.
 */
export function flowText(spec: TextFlowSpec, bands: PageBands): TextPageSpan[] {
  const spans: TextPageSpan[] = [];
  for (let i = 0; i < spec.lineCount; i++) {
    const center = spec.top + (i + 0.5) * spec.lineAdvance;
    const page = Math.min(
      bands.pageCount - 1,
      Math.max(0, Math.floor((center - bands.originY) / bands.bandH))
    );
    const last = spans[spans.length - 1];
    if (last && last.page === page) {
      last.lineCount += 1;
    } else {
      spans.push({ page, firstLine: i, lineCount: 1 });
    }
  }
  return spans;
}
