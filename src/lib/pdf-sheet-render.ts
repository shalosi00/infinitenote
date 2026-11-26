"use client";

/**
 * Data-driven print-PDF renderer — the shared core of BOTH export paths:
 * the page-level export (issue #20, `pdf-export.ts`) and the section-level
 * export (issue #344, `section-pdf.ts`).
 *
 * Renders scene payloads onto fixed A4 sheets: content is scaled to the
 * printable width, sliced into page bands (pure math in pdf-layout.ts),
 * non-text elements are stamped on every band they touch and clipped to it
 * (tall images print as continuous slices — like a real printer), and text
 * flows line-by-line so glyphs are never cut mid-line. Latin text is drawn
 * as vector Helvetica (selectable); non-Latin text and rotated elements fall
 * back to high-res raster snippets to stay visually correct.
 *
 * Always renders on light paper, regardless of the app theme.
 *
 * This module deliberately has NO top-level import from
 * @excalidraw/excalidraw — the raster fallback loads it dynamically, so
 * headless unit tests over pure vector scenes never pull the canvas runtime.
 * jsPDF is loaded dynamically for the same reason (it worked headless under
 * bun: probes printed page objects and inflating the streams recovered the
 * vector text verbatim).
 */
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  PAPER_RULE_PT,
  PRINT_MARGIN_PT,
  bandTop,
  bandsForBox,
  computePageBands,
  flowText,
  needsRasterSnippet,
  type ElementBox,
  type PageSpec,
} from "./pdf-layout";
import type { PageBackground } from "./types";
import { PAGE_COLOR_HEX, safePageColor } from "./page-colors";
import { ExportError } from "./export-errors";

export type PdfOrientation = "portrait" | "landscape";

/** Loose shape of the persisted / live scene files map (BinaryFileData subset). */
export type PdfFiles = Record<string, { id: string; dataURL: string }>;

/** One printable page: a title (footer), its paper style and its scene. */
export interface PdfSceneInput {
  title: string;
  background: PageBackground;
  /** OneNote "Page Color" tint (issue #385) — the sheet fills with it first */
  pageColor?: import("./types").PageColor | null;
  elements: readonly unknown[];
  files: PdfFiles | null;
}

export interface PdfRenderResult {
  blob: Blob;
  /** A4 sheets in the document (blank pages contribute exactly one). */
  sheetCount: number;
  /** Input pages that carried at least one ink element. */
  inkPageCount: number;
}

// re-exported for callers that already import from this module
export { ExportError };

/* ------------------------------------------------------------------ */
/* loose element shape (Excalidraw's union is hostile to drawing code)  */
/* ------------------------------------------------------------------ */

interface LooseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: string;
  opacity: number;
  isDeleted: boolean;
  text?: string;
  fontSize?: number;
  lineHeight?: number;
  textAlign?: string;
  points?: Array<[number, number]>;
  fileId?: string;
  roundness?: unknown;
  startArrowhead?: string;
  endArrowhead?: string;
  /** audio blocks (embeddables): the clip's display name */
  customData?: { audioName?: unknown } | null;
}

/** Element types that carry printable ink (frames/containers are structural). */
const INK_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "draw",
  "image",
  "text",
  // audio blocks are printable ink too (issue #83): they render as a
  // labeled player strip so an audio-only page exports instead of failing
  // with "Nothing to export"
  "embeddable",
]);

/** Drop deleted + structural elements — the printable ink of a scene. */
export function filterInkElements(elements: readonly unknown[]): LooseElement[] {
  return (elements as unknown as LooseElement[]).filter(
    (e) => !e.isDeleted && INK_TYPES.has(e.type),
  );
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve a page's tint to its PDF paint hex (issue #385). PDFs are light
 * artifacts: the palette hex is used verbatim; no tint → undefined (white
 * sheet, the pre-#385 behavior).
 */
function paperColorHex(color: unknown): string | undefined {
  const c = safePageColor(color);
  return c ? PAGE_COLOR_HEX[c] : undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return [0, 0, 0];
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Rotation-expanded axis-aligned box of an element (scene coordinates). */
function elementAABB(el: LooseElement): { x1: number; y1: number; x2: number; y2: number } {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = Math.abs(el.angle ?? 0);
  if (a === 0) return { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height };
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = el.width * c + el.height * s;
  const h = el.width * s + el.height * c;
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

/** jsPDF instance type without a top-level runtime import (loaded on demand). */
type Doc = import("jspdf").jsPDF;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** Re-encode unsupported image payloads (SVG, GIF…) as PNG for jsPDF. */
async function toAddableImage(dataUrl: string): Promise<{ data: string; format: "PNG" | "JPEG" }> {
  if (dataUrl.startsWith("data:image/png")) return { data: dataUrl, format: "PNG" };
  if (dataUrl.startsWith("data:image/jpeg")) return { data: dataUrl, format: "JPEG" };
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, img.naturalWidth);
  canvas.height = Math.max(1, img.naturalHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  return { data: canvas.toDataURL("image/png"), format: "PNG" };
}

/** Latin-1 text can be encoded by jsPDF's built-in fonts; the rest rasterizes. */
function isPdfEncodableText(text: string): boolean {
  return /^[\u0000-\u00ff]*$/.test(text);
}

/** Rasterized footer title (issue #84) — a small transparent PNG. */
interface FooterTitleImage {
  dataUrl: string;
  wPx: number;
  hPx: number;
}

/**
 * Render a non-Latin page title with the system font on a canvas (issue #84):
 * jsPDF's built-in Helvetica simply cannot encode 简体中文 — the glyphs would
 * print as mojibake. Returns null when the DOM is unavailable.
 */
export function rasterizeFooterTitle(title: string): FooterTitleImage | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = "500 32px system-ui, -apple-system, sans-serif";
  ctx.font = font;
  const textW = Math.ceil(ctx.measureText(title).width) + 8;
  const h = 44;
  canvas.width = Math.max(1, Math.min(4000, textW));
  canvas.height = h;
  // resizing the canvas resets all state — re-arm the context
  ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = "rgb(150, 155, 165)";
  ctx.textBaseline = "middle";
  ctx.fillText(title.slice(0, 90), 4, h / 2);
  return { dataUrl: canvas.toDataURL("image/png"), wPx: canvas.width, hPx: h };
}

/* ------------------------------------------------------------------ */
/* element drawing (page space)                                        */
/* ------------------------------------------------------------------ */

interface PageMapping {
  scale: number;
  originX: number;
  bandTopY: number; // content-space y that maps to the top margin
  margin: number;
}

/** content-space point → page-space point */
function map(mx: PageMapping, cx: number, cy: number): [number, number] {
  return [
    mx.margin + (cx - mx.originX) * mx.scale,
    mx.margin + (cy - mx.bandTopY) * mx.scale,
  ];
}

function applyStroke(doc: Doc, el: LooseElement, scale: number): void {
  const [r, g, b] = hexToRgb(el.strokeColor);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(Math.max(0.4, el.strokeWidth * scale));
  doc.setLineCap("round");
  doc.setLineJoin("round");
  if (el.strokeStyle === "dashed") doc.setLineDashPattern([6, 4], 0);
  else if (el.strokeStyle === "dotted") doc.setLineDashPattern([1.2, 3.2], 0);
}

function applyFill(doc: Doc, el: LooseElement): "S" | "F" | "FD" {
  if (!el.backgroundColor || el.backgroundColor === "transparent") return "S";
  const [r, g, b] = hexToRgb(el.backgroundColor);
  doc.setFillColor(r, g, b);
  return "FD";
}

function hasRoundness(el: LooseElement): boolean {
  return !!el.roundness && typeof el.roundness === "object";
}

function drawArrowhead(
  doc: Doc,
  mx: PageMapping,
  tip: [number, number],
  prev: [number, number],
  kind: string | undefined,
  scale: number
): void {
  if (!kind || kind === "none") return;
  const [tx, ty] = map(mx, tip[0], tip[1]);
  const [px, py] = map(mx, prev[0], prev[1]);
  const dx = tx - px;
  const dy = ty - py;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.max(5, 11 * scale);
  if (kind === "dot") {
    doc.circle(tx, ty, Math.max(1.2, size / 4), "F");
    return;
  }
  if (kind === "triangle") {
    // small filled triangle centered on the tip, pointing along the line
    const b = size * 0.9;
    const p1: [number, number] = [tx, ty];
    const p2: [number, number] = [tx - ux * b - uy * b * 0.45, ty - uy * b + ux * b * 0.45];
    const p3: [number, number] = [tx - ux * b + uy * b * 0.45, ty - uy * b - ux * b * 0.45];
    doc.triangle(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], "F");
    return;
  }
  // "arrow" and "bar": two strokes at ±26° from the tip
  const angle = Math.atan2(uy, ux);
  for (const side of [-1, 1]) {
    const a = angle + side * 0.46;
    doc.line(tx, ty, tx - Math.cos(a) * size, ty - Math.sin(a) * size);
  }
}

/** Draw one non-text element (already inside the band clip). */
function drawSliceElement(doc: Doc, el: LooseElement, mx: PageMapping): void {
  const s = mx.scale;
  applyStroke(doc, el, s);
  const style = applyFill(doc, el);

  switch (el.type) {
    case "rectangle": {
      const [x, y] = map(mx, el.x, el.y);
      const w = el.width * s;
      const h = el.height * s;
      if (hasRoundness(el)) {
        const r = Math.min(w, h) * 0.2;
        doc.roundedRect(x, y, w, h, r, r, style);
      } else {
        doc.rect(x, y, w, h, style);
      }
      return;
    }
    case "ellipse": {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const [px, py] = map(mx, cx, cy);
      doc.ellipse(px, py, (el.width / 2) * s, (el.height / 2) * s, style);
      return;
    }
    case "diamond": {
      const top: [number, number] = [el.x + el.width / 2, el.y];
      const right: [number, number] = [el.x + el.width, el.y + el.height / 2];
      const bottom: [number, number] = [el.x + el.width / 2, el.y + el.height];
      const left: [number, number] = [el.x, el.y + el.height / 2];
      const [x0, y0] = map(mx, top[0], top[1]);
      const [x1, y1] = map(mx, right[0], right[1]);
      const [x2, y2] = map(mx, bottom[0], bottom[1]);
      const [x3, y3] = map(mx, left[0], left[1]);
      doc.triangle(x0, y0, x1, y1, x2, y2, style);
      doc.triangle(x0, y0, x2, y2, x3, y3, style);
      return;
    }
    case "line":
    case "arrow": {
      const pts = el.points ?? [];
      if (pts.length < 2) return;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = map(mx, el.x + pts[i - 1][0], el.y + pts[i - 1][1]);
        const [bx, by] = map(mx, el.x + pts[i][0], el.y + pts[i][1]);
        doc.line(ax, ay, bx, by);
      }
      if (el.type === "arrow") {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const first = pts[0];
        const second = pts[1] ?? pts[0];
        drawArrowhead(doc, mx, last, prev, el.endArrowhead, s);
        drawArrowhead(doc, mx, first, second, el.startArrowhead, s);
      }
      return;
    }
    case "draw": {
      const pts = el.points ?? [];
      if (pts.length < 2) return;
      const [x0, y0] = map(mx, el.x + pts[0][0], el.y + pts[0][1]);
      const deltas: Array<[number, number]> = [];
      for (let i = 1; i < pts.length; i++) {
        deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
      }
      doc.lines(deltas, x0, y0, [s, s], "S", false);
      return;
    }
    case "image": {
      // images are placed by the caller (async dataURL resolution)
      return;
    }
    case "embeddable": {
      // audio block (issue #83): print as a labeled player strip so clips
      // appear in the PDF instead of being dropped (and an audio-only page
      // exports at all)
      const [x, y] = map(mx, el.x, el.y);
      const w = el.width * s;
      const h = el.height * s;
      doc.setFillColor(243, 243, 247);
      doc.setDrawColor(139, 139, 158);
      doc.setLineWidth(Math.max(0.4, el.strokeWidth * s));
      const r = Math.min(w, h) * 0.12;
      doc.roundedRect(x, y, w, h, r, r, "FD");
      // vector music-note glyph: filled head + stem + flag
      const [nr, ng, nb] = hexToRgb(el.strokeColor);
      const headX = x + h * 0.30;
      const headY = y + h * 0.62;
      const headR = Math.max(0.8, h * 0.09);
      doc.setFillColor(nr, ng, nb);
      doc.circle(headX, headY, headR, "F");
      doc.line(headX + headR, headY, headX + headR, headY - h * 0.30);
      doc.line(headX + headR, headY - h * 0.30, headX + headR + h * 0.12, headY - h * 0.22);
      // clip label — vector text only when jsPDF can encode it ("…" is not
      // Latin-1; use plain dots so the check stays honest)
      const name =
        typeof el.customData?.audioName === "string" ? el.customData.audioName : "";
      if (name && isPdfEncodableText(name)) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(Math.max(5, 9 * s));
        doc.setTextColor(nr, ng, nb);
        const maxW = w - h * 0.5;
        let label = name;
        while (label.length > 4 && doc.getTextWidth(label) > maxW) {
          label = label.slice(0, -4) + "...";
        }
        if (doc.getTextWidth(label) <= maxW) {
          doc.text(label, x + h * 0.48, y + h * 0.5, { baseline: "middle" });
        }
      }
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/* paper + footer                                                      */
/* ------------------------------------------------------------------ */

function drawPaper(
  doc: Doc,
  page: PageSpec,
  background: PageBackground,
  margin: number,
  colorHex?: string,
): void {
  // issue #385: the tint fills the whole sheet first — PDFs are light
  // artifacts, so they always use the palette hex (never a dark transform)
  if (colorHex) {
    const [r, g, b] = hexToRgb(colorHex);
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, page.w, page.h, "F");
  }
  if (background !== "ruled" && background !== "grid") return;
  doc.setDrawColor(215, 220, 228);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([], 0);
  for (let y = margin + PAPER_RULE_PT; y < page.h - margin; y += PAPER_RULE_PT) {
    doc.line(margin, y, page.w - margin, y);
  }
  if (background === "grid") {
    for (let x = margin + PAPER_RULE_PT; x < page.w - margin; x += PAPER_RULE_PT) {
      doc.line(x, margin, x, page.h - margin);
    }
  }
}

/**
 * Sheet footer. `index`/`count` are GLOBAL sheet numbers across the whole
 * document — for a single-page export that equals the per-page band count
 * (the issue #20 behavior, byte-for-byte), and a section export numbers its
 * sheets 1..N across every note page it contains.
 */
function drawFooter(
  doc: Doc,
  page: PageSpec,
  title: string,
  titleImage: FooterTitleImage | null,
  index: number,
  count: number,
): void {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150, 155, 165);
  doc.setLineDashPattern([], 0);
  const y = page.h - PRINT_MARGIN_PT + 16;
  if (titleImage) {
    // non-Latin title (issue #84): the pre-rendered system-font image keeps
    // 简体中文 (and any other script) legible where Helvetica cannot encode it
    const imgH = 9;
    const imgW = (imgH * titleImage.wPx) / titleImage.hPx;
    doc.addImage(titleImage.dataUrl, "PNG", PRINT_MARGIN_PT, y - 6.5, imgW, imgH);
  } else {
    doc.text(title.replace(/[\u0000-\u001f]/g, " ").slice(0, 90), PRINT_MARGIN_PT, y);
  }
  doc.text(`${index + 1} / ${count}`, page.w - PRINT_MARGIN_PT, y, { align: "right" });
}

/* ------------------------------------------------------------------ */
/* render core                                                         */
/* ------------------------------------------------------------------ */

interface PreparedPage {
  input: PdfSceneInput;
  elements: LooseElement[];
  boxes: ElementBox[];
  /** null → the page has no printable ink: one blank sheet, footer kept */
  bands: ReturnType<typeof computePageBands>;
  sheetCount: number;
}

/** Lazily-loaded @excalidraw/excalidraw runtime (raster fallback only). */
let excalidrawRuntime: typeof import("@excalidraw/excalidraw") | null = null;

/**
 * Render one or many scene payloads into ONE PDF document.
 *
 * Every input page starts on a fresh A4 sheet; its bands follow the proven
 * pagination math (pdf-layout.ts). A page with no printable ink renders as
 * a blank sheet carrying only paper + footer (OneNote exports empty pages
 * the same way) — the CALLER decides whether that is an error (the
 * single-page export throws "Nothing to export" before calling here; the
 * section exporter throws only when the whole section has no pages).
 *
 * The footer's sheet counter is global across the document.
 */
export async function renderPdfDocument(
  pages: readonly PdfSceneInput[],
  orientation: PdfOrientation,
): Promise<PdfRenderResult> {
  if (!pages.length) {
    throw new ExportError("Nothing to export — no pages to render.");
  }

  /* pre-pass: filter ink, box it, band it — all pure math, no I/O */
  const page: PageSpec = orientation === "landscape" ? A4_LANDSCAPE : A4_PORTRAIT;
  const margin = PRINT_MARGIN_PT;
  const prepared: PreparedPage[] = pages.map((input) => {
    const elements = filterInkElements(input.elements);
    const boxes: ElementBox[] = elements.map((el) => {
      const b = elementAABB(el);
      return {
        id: el.id,
        kind: el.type === "text" && (el.angle ?? 0) === 0 && isPdfEncodableText(el.text ?? "")
          ? "text"
          : "slice",
        x1: b.x1,
        y1: b.y1,
        x2: b.x2,
        y2: b.y2,
      };
    });
    const bands = computePageBands(boxes, page, margin);
    return { input, elements, boxes, bands, sheetCount: bands ? bands.pageCount : 1 };
  });
  const totalSheets = prepared.reduce((n, p) => n + p.sheetCount, 0);

  const { jsPDF } = await import("jspdf");
  const doc: Doc = new jsPDF({ unit: "pt", format: "a4", orientation, compress: true });

  const usableW = page.w - 2 * margin;
  const usableH = page.h - 2 * margin;
  let sheetIndex = 0;
  let inkPageCount = 0;

  for (const p of prepared) {
    // Footer title (issue #84): rasterize non-Latin titles once per note
    // page — jsPDF's standard fonts cannot encode them, the footer must not
    // print mojibake.
    let footerTitleImage: FooterTitleImage | null = null;
    if (!isPdfEncodableText(p.input.title)) {
      try {
        footerTitleImage = rasterizeFooterTitle(p.input.title);
      } catch {
        footerTitleImage = null; // fall back to the (mangled) vector text
      }
    }

    const colorHex = paperColorHex(p.input.pageColor);

    /* ---- blank sheet: no ink — paper + footer only ---- */
    if (!p.bands) {
      if (sheetIndex > 0) doc.addPage("a4", orientation);
      drawPaper(doc, page, p.input.background, margin, colorHex);
      drawFooter(doc, page, p.input.title, footerTitleImage, sheetIndex, totalSheets);
      sheetIndex += 1;
      continue;
    }
    inkPageCount += 1;

    /* ---- raster snippets for rotated / non-Latin elements ---- */
    const rasterSnippets = new Map<string, string>();
    for (const el of p.elements) {
      const box = p.boxes.find((b) => b.id === el.id)!;
      // issue #107: rasterize ONLY what the vector renderer cannot keep
      // visually correct (rotated shapes/images, rotated or non-Latin text).
      // Unrotated shapes stay vector, unrotated images use their payload,
      // unrotated Latin text flows — no more PNG snippet per rectangle.
      if (!needsRasterSnippet(el, box.kind)) continue;
      try {
        const xr = (excalidrawRuntime ??= await import("@excalidraw/excalidraw"));
        const blob = await xr.exportToBlob({
          elements: [el as unknown as LooseElement],
          appState: {
            exportBackground: true,
            // the tint, so a snippet blends into the colored sheet (issue #385);
            // white when the page has no tint — today's behavior
            viewBackgroundColor: colorHex ?? "#ffffff",
            exportWithDarkMode: false,
          },
          files: (p.input.files ?? {}) as Parameters<typeof xr.exportToBlob>[0]["files"],
          mimeType: xr.MIME_TYPES.png,
          getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
        });
        rasterSnippets.set(el.id, await blobToDataUrl(blob));
      } catch {
        // raster fallback failed → the element is skipped rather than aborting
      }
    }

    /* ---- resolve image payloads once (native placements + conversion) ---- */
    const imagePayloads = new Map<string, { data: string; format: "PNG" | "JPEG" }>();
    for (const el of p.elements) {
      if (el.type !== "image" || !el.fileId) continue;
      if (rasterSnippets.has(el.id)) continue; // rotated image → snippet path
      const file = p.input.files?.[el.fileId];
      if (!file?.dataURL) continue;
      try {
        imagePayloads.set(el.id, await toAddableImage(file.dataURL));
      } catch {
        // undecodable payload — skip
      }
    }

    for (let pageIndex = 0; pageIndex < p.bands.pageCount; pageIndex++) {
      if (sheetIndex > 0) doc.addPage("a4", orientation);
      const mx: PageMapping = {
        scale: p.bands.scale,
        originX: p.bands.originX,
        bandTopY: bandTop(p.bands, pageIndex),
        margin,
      };

      drawPaper(doc, page, p.input.background, margin, colorHex);

      /* ---- slice elements: stamped on every band they touch, clipped ---- */
      for (const el of p.elements) {
        const box = p.boxes.find((b) => b.id === el.id)!;
        // flowing text is drawn separately below; rasterized text slices here
        if (el.type === "text" && box.kind === "text") continue;
        if (!bandsForBox(box, p.bands).includes(pageIndex)) continue;

        doc.saveGraphicsState();
        doc.rect(margin, margin, usableW, usableH);
        doc.clip();
        doc.discardPath();
        doc.setLineDashPattern([], 0);

        const snippet = rasterSnippets.get(el.id);
        if (snippet) {
          doc.addImage(
            snippet,
            "PNG",
            margin + (box.x1 - p.bands.originX) * p.bands.scale,
            margin + (box.y1 - mx.bandTopY) * p.bands.scale,
            (box.x2 - box.x1) * p.bands.scale,
            (box.y2 - box.y1) * p.bands.scale
          );
        } else if (el.type === "image") {
          const payload = imagePayloads.get(el.id);
          if (payload) {
            const [px, py] = map(mx, el.x, el.y);
            doc.addImage(payload.data, payload.format, px, py, el.width * p.bands.scale, el.height * p.bands.scale);
          }
        } else {
          if (el.opacity < 100) doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: el.opacity / 100 }));
          drawSliceElement(doc, el, mx);
          if (el.opacity < 100) doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 1 }));
        }
        doc.restoreGraphicsState();
      }

      /* ---- text: flows line-by-line, never cut mid-glyph ---- */
      doc.setFont("helvetica", "normal");
      for (const el of p.elements) {
        if (el.type !== "text") continue;
        const box = p.boxes.find((b) => b.id === el.id)!;
        if (box.kind !== "text") continue; // rasterized variant handled above
        const text = el.text ?? "";
        const lines = text.split("\n");
        const fontSize = el.fontSize ?? 20;
        const advance = fontSize * (el.lineHeight ?? 1.25);
        const spans = flowText({ top: el.y, lineAdvance: advance, lineCount: lines.length }, p.bands);
        for (const span of spans) {
          if (span.page !== pageIndex) continue;
          doc.setFontSize(fontSize * p.bands.scale);
          const [r, g, b] = hexToRgb(el.strokeColor);
          doc.setTextColor(r, g, b);
          const align = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "right" : "left";
          const anchorX =
            align === "center"
              ? el.x + el.width / 2
              : align === "right"
                ? el.x + el.width
                : el.x;
          for (let i = span.firstLine; i < span.firstLine + span.lineCount; i++) {
            const lineTop = el.y + i * advance;
            const [, baselineY] = map(mx, el.x, lineTop + fontSize * 0.82);
            const [px] = map(mx, anchorX, lineTop);
            if (baselineY < margin - 2 || baselineY > margin + usableH + 2) continue;
            doc.text(lines[i] ?? "", px, baselineY, { align });
          }
        }
      }

      drawFooter(doc, page, p.input.title, footerTitleImage, sheetIndex, totalSheets);
      sheetIndex += 1;
    }
  }

  // arraybuffer → Blob by hand: identical bytes in the browser, and it does
  // not lean on jsPDF's environment detection for Blob support (the unit
  // probes proved arraybuffer output headless)
  const blob = new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
  return { blob, sheetCount: totalSheets, inkPageCount };
}
