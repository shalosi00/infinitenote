"use client";

/**
 * Client-only Excalidraw runtime integration.
 *
 * ONLY import this from components that are dynamically loaded with
 * `ssr: false` (the canvas wrapper). Everything browser-only lives here:
 * - file → element conversion (images, text, PDF printouts)
 * - .excalidraw import/export
 * - PNG / SVG export
 */
import type {
  ExcalidrawImperativeAPI,
  BinaryFiles,
  BinaryFileData,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  FileId,
} from "@excalidraw/excalidraw/element/types";
import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  restore,
  getCommonBounds,
  getDataURL,
  MIME_TYPES,
} from "@excalidraw/excalidraw";
import { classifyFile, downloadBlob, sanitizeScene, titleToFilename } from "./excalidraw-utils";
import { extractDocxBlocks } from "./docx-import";
import { extractHtmlContent, type HtmlContent } from "./html-import";
import { headingFontSize, type ImportedBlock } from "./import-blocks";
import { parseMht, resolveMhtResource } from "./mht-import";
import type { ScenePayload } from "./types";

const now = () => Date.now();

/** Placement anchor: below existing content, or near origin on empty page. */
export function nextInsertPosition(elements: readonly ExcalidrawElement[]): { x: number; y: number } {
  const live = elements.filter((e) => !e.isDeleted);
  if (!live.length) return { x: 40, y: 40 };
  const [x1, y1, x2, y2] = getCommonBounds(live as NonDeletedExcalidrawElement[]);
  return { x: Math.min(x1, 0) + 40, y: y2 + 60 };
}

async function fileToDataUrl(file: File): Promise<string> {
  // package helper handles base64/SVG encoding edge cases correctly
  return getDataURL(file);
}

/** Load intrinsic pixel size of an image dataURL. */
function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

/* ------------------------------------------------------------------ */
/* image import                                                        */
/* ------------------------------------------------------------------ */

export async function importImageFiles(
  api: ExcalidrawImperativeAPI,
  files: File[],
  insertAt?: { x: number; y: number }
): Promise<number> {
  const elements = api.getSceneElements();
  const anchor = insertAt ?? nextInsertPosition(elements);
  let x = anchor.x;
  let y = anchor.y;
  const newFiles: NonNullable<ScenePayload["files"]> = {};
  const skeletons: Array<{ type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }> = [];
  for (const file of files) {
    const dataURL = await fileToDataUrl(file);
    const { width: w, height: h } = await imageSize(dataURL);
    // cap enormous images so they stay usable on canvas
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const width = Math.max(16, Math.round(w * scale));
    const height = Math.max(16, Math.round(h * scale));
    const fileId = crypto.randomUUID() as FileId;
    newFiles[fileId] = {
      id: fileId,
      mimeType: file.type || "image/png",
      dataURL,
      created: now(),
    };
    skeletons.push({ type: "image", x, y, width, height, fileId });
    y += height + 24;
  }
  applySkeletons(api, skeletons, newFiles);
  return skeletons.length;
}

/* ------------------------------------------------------------------ */
/* text / markdown import                                              */
/* ------------------------------------------------------------------ */

export async function importTextFiles(
  api: ExcalidrawImperativeAPI,
  files: File[],
  insertAt?: { x: number; y: number }
): Promise<number> {
  const anchor = insertAt ?? nextInsertPosition(api.getSceneElements());
  let y = anchor.y;
  for (const file of files) {
    const text = (await file.text()).slice(0, 60_000); // hard cap for sanity
    if (!text.trim()) continue;
    const skeletons = [
      {
        type: "text" as const,
        text,
        x: anchor.x,
        y,
        fontSize: 20,
        width: 720, // wrap for a OneNote "printout" feel
        id: crypto.randomUUID(),
      },
    ];
    const created = convertToExcalidrawElements(skeletons, { regenerateIds: false });
    api.updateScene({
      elements: [...api.getSceneElements(), ...(created as unknown as ExcalidrawElement[])],
    });
    // rough height estimate for stacking: chars per wrapped line
    const estHeight = Math.max(1, Math.ceil(text.length / 70)) * 26 + 60;
    y += estHeight;
  }
  return files.length;
}

/* ------------------------------------------------------------------ */
/* structured imports (.docx / OneNote-exported HTML / OneNote .mht)    */
/* ------------------------------------------------------------------ */

interface TextSkeleton {
  type: "text";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  id: string;
}

interface ImageSkeleton {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  fileId: FileId;
}

interface ImportTally {
  blocks: number;
  images: number;
}

/** Lay imported blocks out as stacked text elements; headings render larger. */
function blocksToSkeletons(
  blocks: ImportedBlock[],
  anchor: { x: number; y: number },
): TextSkeleton[] {
  const skeletons: TextSkeleton[] = [];
  let y = anchor.y;
  for (const block of blocks) {
    const fontSize = block.kind === "heading" ? headingFontSize(block.level) : 20;
    const prefix = `${"    ".repeat(block.indent)}${block.marker ? `${block.marker} ` : ""}`;
    const text = `${prefix}${block.text}`;
    const width = 720;
    // rough wrap estimate: chars per line shrinks as the font grows
    const charsPerLine = Math.max(16, Math.floor(width / (fontSize * 0.52)));
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    skeletons.push({
      type: "text",
      text,
      x: anchor.x + block.indent * 28,
      y,
      fontSize,
      width,
      id: crypto.randomUUID(),
    });
    y += lines * fontSize * 1.35 + 14;
  }
  return skeletons;
}

/** Height the next text element will advance the layout cursor by. */
function blockAdvance(block: ImportedBlock): number {
  const fontSize = block.kind === "heading" ? headingFontSize(block.level) : 20;
  const prefix = `${"    ".repeat(block.indent)}${block.marker ? `${block.marker} ` : ""}`;
  const text = `${prefix}${block.text}`;
  const charsPerLine = Math.max(16, Math.floor(720 / (fontSize * 0.52)));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return lines * fontSize * 1.35 + 14;
}

/** Append imported blocks to the canvas below existing content. */
async function insertBlocks(
  api: ExcalidrawImperativeAPI,
  blocks: ImportedBlock[],
  insertAt?: { x: number; y: number },
): Promise<number> {
  if (!blocks.length) return 0;
  const anchor = insertAt ?? nextInsertPosition(api.getSceneElements());
  const skeletons = blocksToSkeletons(blocks, anchor);
  const created = convertToExcalidrawElements(skeletons, { regenerateIds: false });
  api.updateScene({
    elements: [...api.getSceneElements(), ...(created as unknown as ExcalidrawElement[])],
  });
  return skeletons.length;
}

/** Where an imported image's binary payload comes from. */
type ImageResolver = (src: string) => Promise<{ dataUrl: string; mimeType: string } | null>;

/** Resolve data: image URLs inline (self-contained HTML pages). */
const dataUrlResolver: ImageResolver = async (src) => {
  const m = /^data:([^;,]+)[^,]*,/.exec(src);
  if (!m || !m[1].startsWith("image/")) return null;
  return { dataUrl: src, mimeType: m[1] };
};

/**
 * Append blocks + embedded images to the canvas below existing content,
 * interleaved in document order (image blockIndex semantics: the image goes
 * after the nth text block). Unresolvable images are skipped silently — a
 * missing resource must not abort an otherwise good import.
 */
async function insertHtmlContent(
  api: ExcalidrawImperativeAPI,
  content: HtmlContent,
  resolve: ImageResolver,
  insertAt?: { x: number; y: number },
): Promise<ImportTally> {
  const anchor = insertAt ?? nextInsertPosition(api.getSceneElements());
  let y = anchor.y;
  let images = 0;
  const skeletons: Array<TextSkeleton | ImageSkeleton> = [];
  const newFiles: NonNullable<ScenePayload["files"]> = {};
  const pending = [...content.images].sort((a, b) => a.blockIndex - b.blockIndex);

  const emitImagesUpTo = async (blockIndex: number): Promise<void> => {
    while (pending.length && pending[0].blockIndex <= blockIndex) {
      const img = pending.shift()!;
      const resolved = await resolve(img.src);
      if (!resolved) continue;
      let w: number;
      let h: number;
      try {
        const intrinsic = await imageSize(resolved.dataUrl);
        w = img.width ?? intrinsic.width;
        h = img.height ?? intrinsic.height;
        // one declared dimension → keep the intrinsic aspect ratio
        if (img.width && !img.height) h = Math.round(intrinsic.height * (img.width / intrinsic.width));
        if (img.height && !img.width) w = Math.round(intrinsic.width * (img.height / intrinsic.height));
      } catch {
        continue; // undecodable payload — skip
      }
      const scale = Math.min(1, 1600 / Math.max(w, h)); // stay usable on canvas
      w = Math.max(16, Math.round(w * scale));
      h = Math.max(16, Math.round(h * scale));
      const fileId = crypto.randomUUID() as FileId;
      newFiles[fileId] = {
        id: fileId,
        mimeType: resolved.mimeType,
        dataURL: resolved.dataUrl,
        created: now(),
      };
      skeletons.push({ type: "image", x: anchor.x, y, width: w, height: h, fileId });
      y += h + 24;
      images += 1;
    }
  };

  let index = 0;
  for (const block of content.blocks) {
    await emitImagesUpTo(index);
    const fontSize = block.kind === "heading" ? headingFontSize(block.level) : 20;
    const prefix = `${"    ".repeat(block.indent)}${block.marker ? `${block.marker} ` : ""}`;
    skeletons.push({
      type: "text",
      text: `${prefix}${block.text}`,
      x: anchor.x + block.indent * 28,
      y,
      fontSize,
      width: 720,
      id: crypto.randomUUID(),
    });
    y += blockAdvance(block);
    index += 1;
  }
  await emitImagesUpTo(Number.POSITIVE_INFINITY); // trailing images

  if (skeletons.length) {
    const created = convertToExcalidrawElements(skeletons, {
      regenerateIds: false,
    }) as unknown as Array<ExcalidrawElement & { type: string; fileId?: FileId }>;
    // ensure images render immediately (not stuck in "pending")
    const safe = created.map((e) => (e.type === "image" ? { ...e, status: "saved" } : e));
    api.updateScene({ elements: [...api.getSceneElements(), ...(safe as ExcalidrawElement[])] });
    api.addFiles(Object.values(newFiles) as BinaryFileData[]);
  }
  return { blocks: content.blocks.length, images };
}

/** Import a Word document (OneNote "Save as Word" export). */
export async function importDocxFile(
  api: ExcalidrawImperativeAPI,
  file: File,
  insertAt?: { x: number; y: number },
): Promise<number> {
  const blocks = extractDocxBlocks(new Uint8Array(await file.arrayBuffer()));
  return insertBlocks(api, blocks, insertAt);
}

/** Import an HTML page (OneNote "Save as" HTML export, web articles). */
export async function importHtmlFile(
  api: ExcalidrawImperativeAPI,
  file: File,
  insertAt?: { x: number; y: number },
): Promise<ImportTally> {
  const content = extractHtmlContent(await file.text());
  return insertHtmlContent(api, content, dataUrlResolver, insertAt);
}

/** Import a OneNote .mht single-file web page (html + embedded images). */
export async function importMhtFile(
  api: ExcalidrawImperativeAPI,
  file: File,
  insertAt?: { x: number; y: number },
): Promise<ImportTally> {
  const parsed = parseMht(await file.text());
  const content = extractHtmlContent(parsed.html);
  const resources = parsed.resources;
  const resolver: ImageResolver = async (src) => {
    const hit = resolveMhtResource(src, resources);
    return hit ? { dataUrl: hit.dataUrl, mimeType: hit.contentType } : null;
  };
  return insertHtmlContent(api, content, resolver, insertAt);
}

/* ------------------------------------------------------------------ */
/* PDF printout (OneNote-style: each page rendered onto the canvas)    */
/* ------------------------------------------------------------------ */

export async function importPdfAsPrintout(
  api: ExcalidrawImperativeAPI,
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const maxPages = Math.min(doc.numPages, 20); // guard against monsters
  const anchor = nextInsertPosition(api.getSceneElements());
  const newFiles: NonNullable<ScenePayload["files"]> = {};
  const skeletons: Array<{ type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }> = [];
  let y = anchor.y;
  const canvas = document.createElement("canvas");
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataURL = canvas.toDataURL("image/png");
    const fileId = crypto.randomUUID() as FileId;
    newFiles[fileId] = {
      id: fileId,
      mimeType: "image/png",
      dataURL,
      created: now(),
    };
    skeletons.push({
      type: "image",
      x: anchor.x,
      y,
      width: canvas.width,
      height: canvas.height,
      fileId,
    });
    y += canvas.height + 32;
    onProgress?.(i, maxPages);
  }
  applySkeletons(api, skeletons, newFiles);
  return skeletons.length;
}

/* ------------------------------------------------------------------ */
/* .excalidraw scene import                                            */
/* ------------------------------------------------------------------ */

export interface ImportedScene {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
}

export async function importExcalidrawFile(file: File): Promise<ImportedScene> {
  const json = await file.text();
  const data = JSON.parse(json);
  const restored = restore({ elements: data.elements, appState: data.appState, files: data.files }, null, null);
  return { elements: restored.elements as ExcalidrawElement[], files: restored.files };
}

/** Append an imported scene into the current canvas, placed below existing content. */
export function appendScene(api: ExcalidrawImperativeAPI, scene: ImportedScene): void {
  const fileValues = Object.values(scene.files);
  if (fileValues.length) api.addFiles(fileValues as BinaryFileData[]);
  const current = api.getSceneElements();
  if (!current.length) {
    api.updateScene({ elements: [...scene.elements] });
    return;
  }
  const anchor = nextInsertPosition(current);
  const [ix1, iy1] = getCommonBounds(scene.elements as NonDeletedExcalidrawElement[]);
  const shifted = scene.elements.map((e) => ({
    ...e,
    x: e.x - ix1 + anchor.x,
    y: e.y - iy1 + anchor.y,
  }));
  api.updateScene({ elements: [...current, ...shifted] });
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function applySkeletons(
  api: ExcalidrawImperativeAPI,
  skeletons: Array<{ type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }>,
  newFiles: NonNullable<ScenePayload["files"]>
): void {
  const created = convertToExcalidrawElements(skeletons, { regenerateIds: false }) as unknown as Array<
    ExcalidrawElement & { fileId: string }
  >;
  // ensure images render immediately (not stuck in "pending")
  const safe = created.map((e) => ({ ...e, status: "saved" }));
  api.updateScene({ elements: [...api.getSceneElements(), ...(safe as ExcalidrawElement[])] });
  api.addFiles(Object.values(newFiles) as BinaryFileData[]);
}

export function getScenePayload(api: ExcalidrawImperativeAPI): ScenePayload {
  const elements = api.getSceneElements();
  const files = api.getFiles();
  return sanitizeScene({ elements: [...elements], files });
}

/* ------------------------------------------------------------------ */
/* exports                                                             */
/* ------------------------------------------------------------------ */

function exportAppState(api: ExcalidrawImperativeAPI) {
  const { offsetTop: _t, offsetLeft: _l, ...appState } = api.getAppState();
  return { ...appState, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" };
}

export async function exportPng(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const blob = await exportToBlob({
    elements: api.getSceneElements(),
    appState: exportAppState(api),
    files: api.getFiles(),
    mimeType: MIME_TYPES.png,
    getDimensions: (w, h) => ({ width: w * 2, height: h * 2, scale: 2 }),
  });
  downloadBlob(blob, titleToFilename(title, "png"));
}

export async function exportSvg(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const svg = await exportToSvg({
    elements: api.getSceneElements(),
    appState: exportAppState(api),
    files: api.getFiles(),
  });
  const xml = new XMLSerializer().serializeToString(svg);
  downloadBlob(new Blob([xml], { type: MIME_TYPES.svg }), titleToFilename(title, "svg"));
}

export async function exportSceneFile(api: ExcalidrawImperativeAPI, title: string): Promise<void> {
  const json = serializeAsJSON(
    api.getSceneElements(),
    { viewBackgroundColor: "#ffffff" },
    api.getFiles(),
    "local"
  );
  downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), titleToFilename(title, "excalidraw"));
}

export { classifyFile };
