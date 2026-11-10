/**
 * Handwriting line rasterizer — browser-only drawing half of Phase A.
 *
 * trocr is an image model (docs/handwriting-research.md §3.1): each
 * segmented line's strokes are rendered to a small black-on-white PNG
 * (the input class the model was trained on — IAM line crops) and handed
 * to the engine. `rasterParams` is pure geometry and unit-tested; only
 * `renderLineBitmap` touches a canvas, and it is only ever called by the
 * recognition action (never at render time).
 *
 * Rendering contract (validated against the real model 2026-11-10,
 * docs/test-plans/handwriting.md): round caps + round joins, straight
 * segments between points, white background, black ink, the line's
 * height normalized to ~88 px with a fixed 4 px pen — pen-to-height
 * ≈ 0.05 read correctly at both 3 px and 4 px in the validation runs,
 * so the fixed pen keeps every input in the validated band regardless
 * of how large or small the user wrote.
 */
import type { HwrLine } from "./hwr";

/** Target rendered ink height (px) — one validated input band. */
export const HWR_TARGET_INK_HEIGHT = 88;
/** Fixed pen width (px) after scaling. */
export const HWR_PEN_WIDTH = 4;
/** White margin around the ink (px) — keeps caps inside the bitmap. */
export const HWR_RASTER_PAD = 6;

/** Pure geometry of a line's raster: everything except the drawing. */
export interface RasterParams {
  width: number;
  height: number;
  /** scale factor applied to stroke coordinates */
  scale: number;
  /** ink bbox offset inside the bitmap (before padding) */
  offsetX: number;
  offsetY: number;
  penWidth: number;
  pad: number;
}

/**
 * Compute the bitmap geometry for a line: the ink is scaled so its
 * height maps to HWR_TARGET_INK_HEIGHT (scale clamped to [0.05, 4] —
 * giant drawings shrink, tiny writing grows at most 4×), centered in a
 * white margin of HWR_RASTER_PAD.
 */
export function rasterParams(line: HwrLine): RasterParams {
  const inkW = Math.max(line.x1 - line.x0, 1);
  const inkH = Math.max(line.y1 - line.y0, 1);
  const scale = Math.min(Math.max(HWR_TARGET_INK_HEIGHT / inkH, 0.05), 4);
  const pad = HWR_RASTER_PAD;
  const penWidth = HWR_PEN_WIDTH;
  // the pen must fit inside the bitmap on both sides of the ink
  const width = Math.ceil(inkW * scale) + penWidth + 2 * pad;
  const height = Math.ceil(inkH * scale) + penWidth + 2 * pad;
  // center the ink bbox in the drawable area
  const offsetX = (width - inkW * scale) / 2 - line.x0 * scale;
  const offsetY = (height - inkH * scale) / 2 - line.y0 * scale;
  return { width, height, scale, offsetX, offsetY, penWidth, pad };
}

/**
 * Render one line to a PNG dataURL (browser only — needs a canvas).
 * The engine (hwr-client.ts) consumes the result.
 */
export function renderLineBitmap(line: HwrLine): string {
  const p = rasterParams(line);
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, p.width, p.height);
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = p.penWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const stroke of line.strokes) {
    const pts = stroke.points;
    if (pts.length === 1) {
      // a single point (a pen tap) renders as a dot
      const [x, y] = pts[0];
      ctx.beginPath();
      ctx.arc(x * p.scale + p.offsetX, y * p.scale + p.offsetY, p.penWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const px = x * p.scale + p.offsetX;
      const py = y * p.scale + p.offsetY;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}
