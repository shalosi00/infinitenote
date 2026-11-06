"use client";

/**
 * Print-friendly paginated PDF export (issue #20).
 *
 * Renders the scene onto fixed A4 sheets: content is scaled to the printable
 * width, sliced into page bands (pure math in pdf-layout.ts), non-text
 * elements are stamped on every band they touch and clipped to it (tall
 * images print as continuous slices — like a real printer), and text flows
 * line-by-line so glyphs are never cut mid-line. Latin text is drawn as
 * vector Helvetica (selectable); non-Latin text and rotated elements fall
 * back to high-res raster snippets to stay visually correct.
 *
 * Always exports on light paper, regardless of the app theme.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { exportToBlob, MIME_TYPES } from "@excalidraw/excalidraw";
import { downloadBlob, titleToFilename } from "./excalidraw-utils";
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  PAPER_RULE_PT,
  PRINT_MARGIN_PT,
  bandTop,
  bandsForBox,
  computePageBands,
  flowText,
  type ElementBox,
  type PageSpec,
} from "./pdf-layout";
import type { PageBackground } from "./types";

export type PdfOrientation = "portrait" | "landscape";

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
]);

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

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
    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/* paper + footer                                                      */
/* ------------------------------------------------------------------ */

function drawPaper(doc: Doc, page: PageSpec, background: PageBackground, margin: number): void {
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

function drawFooter(doc: Doc, page: PageSpec, title: string, index: number, count: number): void {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150, 155, 165);
  doc.setLineDashPattern([], 0);
  const y = page.h - PRINT_MARGIN_PT + 16;
  doc.text(title.replace(/[\u0000-\u001f]/g, " ").slice(0, 90), PRINT_MARGIN_PT, y);
  doc.text(`${index + 1} / ${count}`, page.w - PRINT_MARGIN_PT, y, { align: "right" });
}

/* ------------------------------------------------------------------ */
/* export entry point                                                  */
/* ------------------------------------------------------------------ */

export async function exportPagePdf(
  api: ExcalidrawImperativeAPI,
  title: string,
  orientation: PdfOrientation,
  background: PageBackground
): Promise<void> {
  const elements = api
    .getSceneElements()
    .filter((e) => !e.isDeleted && INK_TYPES.has(e.type)) as unknown as LooseElement[];
  if (!elements.length) {
    throw new Error("Nothing to export — the page is empty.");
  }

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

  const page: PageSpec = orientation === "landscape" ? A4_LANDSCAPE : A4_PORTRAIT;
  const margin = PRINT_MARGIN_PT;
  const bands = computePageBands(boxes, page, margin);
  if (!bands) throw new Error("Nothing to export — the page is empty.");

  const files = api.getFiles();
  const { jsPDF } = await import("jspdf");
  const doc: Doc = new jsPDF({ unit: "pt", format: "a4", orientation, compress: true });

  // raster snippets for rotated / non-Latin elements, keyed by element id
  const rasterSnippets = new Map<string, string>();
  for (const el of elements) {
    const box = boxes.find((b) => b.id === el.id)!;
    if (box.kind !== "slice" && el.type !== "image") continue;
    if (el.type === "image" && (el.angle ?? 0) === 0) continue; // drawn natively
    try {
      const blob = await exportToBlob({
        elements: [el as unknown as Parameters<typeof exportToBlob>[0]["elements"][number]],
        appState: {
          exportBackground: true,
          viewBackgroundColor: "#ffffff",
          exportWithDarkMode: false,
        } as Parameters<typeof exportToBlob>[0]["appState"],
        files,
        mimeType: MIME_TYPES.png,
        getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
      });
      rasterSnippets.set(el.id, await blobToDataUrl(blob));
    } catch {
      // raster fallback failed → the element is skipped rather than aborting
    }
  }

  // resolve image payloads once (native placements + format conversion)
  const imagePayloads = new Map<string, { data: string; format: "PNG" | "JPEG" }>();
  for (const el of elements) {
    if (el.type !== "image" || !el.fileId) continue;
    if (rasterSnippets.has(el.id)) continue; // rotated image → snippet path
    const file = files[el.fileId];
    if (!file?.dataURL) continue;
    try {
      imagePayloads.set(el.id, await toAddableImage(file.dataURL));
    } catch {
      // undecodable payload — skip
    }
  }

  const usableW = page.w - 2 * margin;
  const usableH = page.h - 2 * margin;

  for (let pageIndex = 0; pageIndex < bands.pageCount; pageIndex++) {
    if (pageIndex > 0) doc.addPage("a4", orientation);
    const mx: PageMapping = {
      scale: bands.scale,
      originX: bands.originX,
      bandTopY: bandTop(bands, pageIndex),
      margin,
    };

    drawPaper(doc, page, background, margin);

    /* ---- slice elements: stamped on every band they touch, clipped ---- */
    for (const el of elements) {
      const box = boxes.find((b) => b.id === el.id)!;
      // flowing text is drawn separately below; rasterized text slices here
      if (el.type === "text" && box.kind === "text") continue;
      if (!bandsForBox(box, bands).includes(pageIndex)) continue;

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
          margin + (box.x1 - bands.originX) * bands.scale,
          margin + (box.y1 - mx.bandTopY) * bands.scale,
          (box.x2 - box.x1) * bands.scale,
          (box.y2 - box.y1) * bands.scale
        );
      } else if (el.type === "image") {
        const payload = imagePayloads.get(el.id);
        if (payload) {
          const [px, py] = map(mx, el.x, el.y);
          doc.addImage(payload.data, payload.format, px, py, el.width * bands.scale, el.height * bands.scale);
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
    for (const el of elements) {
      if (el.type !== "text") continue;
      const box = boxes.find((b) => b.id === el.id)!;
      if (box.kind !== "text") continue; // rasterized variant handled above
      const text = el.text ?? "";
      const lines = text.split("\n");
      const fontSize = el.fontSize ?? 20;
      const advance = fontSize * (el.lineHeight ?? 1.25);
      const spans = flowText({ top: el.y, lineAdvance: advance, lineCount: lines.length }, bands);
      for (const span of spans) {
        if (span.page !== pageIndex) continue;
        doc.setFontSize(fontSize * bands.scale);
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

    drawFooter(doc, page, title, pageIndex, bands.pageCount);
  }

  downloadBlob(doc.output("blob"), titleToFilename(title, "pdf"));
}
