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
  ExcalidrawTextElement,
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
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import { classifyFile, downloadBlob, normalizeImageStatuses, parseSceneFileText, sanitizeScene, titleToFilename } from "./excalidraw-utils";
import {
  CHECK_UNCHECKED,
  applyToDoTag,
  classifyTodoText,
  flipChecklistText,
  type TodoElementLike,
} from "./checklist";
import { pageLinkFor } from "./page-links";
import {
  INHERIT_FILL,
  INHERIT_STROKE,
  getShapeDef,
  type ShapeSkeleton,
} from "./shape-library";
import {
  DEFAULT_CELL_H,
  DEFAULT_CELL_W,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  TABLE_MARKER_KEY,
  emptyTexts,
  planTableOp,
  tableElements,
  tableSkeletons,
  type TableElementLike,
  type TableGeometry,
  type TableMarker,
  type TableOp,
} from "./table-insert";
import {
  conversionSkeletons,
  detectDroppedConversion,
  planHwrConversion,
  type HwrConvertOutcome,
} from "./hwr-convert";
import { extractDocxBlocks } from "./docx-import";
import { extractHtmlContent, type HtmlContent } from "./html-import";
import { headingFontSize, estimateLineCount, withIntrinsicFallback, type ImportedBlock } from "./import-blocks";
import { parseMht, resolveMhtResource } from "./mht-import";
import {
  AUDIO_BLOCK_HEIGHT,
  AUDIO_BLOCK_WIDTH,
  AUDIO_LINK_SCHEME,
  isAudioImportTooLarge,
  withAudioMime,
} from "./audio-notes";
import type { ScenePayload } from "./types";
import { printoutViewportScale } from "./pdf-layout";
import {
  PDF_ATTACHMENT_HEIGHT,
  PDF_ATTACHMENT_LINK_SCHEME,
  PDF_ATTACHMENT_WIDTH,
  isPdfAttachmentTooLarge,
  withPdfMime,
  type PdfAttachmentOutcome,
} from "./pdf-attachment";
import {
  FILE_ATTACHMENT_HEIGHT,
  FILE_ATTACHMENT_LINK_SCHEME,
  FILE_ATTACHMENT_WIDTH,
  fileAttachmentSkippedToast,
  fileAttachedToast,
  isFileAttachmentTooLarge,
  withFileMime,
} from "./file-attachment";

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
    const intrinsic = await imageSize(dataURL);
    // issue #89: SVGs without intrinsic dimensions report 0×0 — fall back
    // to a sane default instead of collapsing to a 16px sliver
    const { width: iw, height: ih } = withIntrinsicFallback(
      intrinsic.width,
      intrinsic.height,
    );
    // cap enormous images so they stay usable on canvas
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const width = Math.max(16, Math.round(iw * scale));
    const height = Math.max(16, Math.round(ih * scale));
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
  let imported = 0;
  // issue #92: batch ALL created elements into ONE scene update — an
  // update per file re-rendered the canvas and restarted the autosave
  // debounce once per dropped file
  const created: ExcalidrawElement[] = [];
  for (const file of files) {
    const text = (await file.text()).slice(0, 60_000); // hard cap for sanity
    if (!text.trim()) continue;
    imported += 1;
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
    created.push(
      ...(convertToExcalidrawElements(skeletons, {
        regenerateIds: false,
      }) as unknown as ExcalidrawElement[]),
    );
    // stacking estimate, CJK-aware (issue #88): wide characters wrap at
    // ~1em, not the 0.52em a flat chars-per-line division assumes
    const estHeight = estimateLineCount(text, 20, 720) * 26 + 60;
    y += estHeight;
  }
  if (created.length) {
    api.updateScene({ elements: [...api.getSceneElements(), ...created] });
  }
  // count only files that produced content (issue #75): blank files must
  // not be reported as imported
  return imported;
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
    // CJK-aware wrap estimate (issue #88)
    const lines = estimateLineCount(text, fontSize, width);
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
  // CJK-aware wrap estimate (issue #88)
  const lines = estimateLineCount(text, fontSize, 720);
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
/* audio import (issue #67)                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a complete Excalidraw embeddable element for one audio clip.
 *
 * The payload rides in `customData` (audioData + audioName): scene restore
 * rewrites every `data:` `link` to about:blank (sanitizeUrl), but passes
 * customData through untouched, while `link` carries the AUDIO_LINK_SCHEME
 * marker that (a) survives sanitization and (b) lets the canvas's
 * `validateEmbeddable` gate mount only our audio players. The name also
 * feeds full-text search (lib/search.ts).
 */
export function makeAudioEmbeddable(
  name: string,
  dataUrl: string,
  x: number,
  y: number
): ExcalidrawElement {
  const seed = Math.floor(Math.random() * 2 ** 31);
  return {
    id: crypto.randomUUID(),
    type: "embeddable",
    x,
    y,
    width: AUDIO_BLOCK_WIDTH,
    height: AUDIO_BLOCK_HEIGHT,
    angle: 0,
    strokeColor: "#8b8b9e",
    backgroundColor: "#f3f3f7",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: AUDIO_LINK_SCHEME,
    locked: false,
    customData: { audioName: name, audioData: dataUrl },
  } as unknown as ExcalidrawElement;
}

/** Outcome of an audio import batch: what landed, what was refused. */
export interface AudioImportResult {
  /** clips placed on the canvas */
  added: number;
  /** clips skipped for exceeding MAX_AUDIO_IMPORT_BYTES (issue #91) */
  skippedLarge: number;
}

/**
 * Import audio files as embeddable audio blocks, stacked below existing
 * content. Each clip keeps its filename for search + the aria label.
 * Clips larger than the cap are skipped BEFORE any scene mutation (issue
 * #91): a multi-hundred-MB base64 payload would blow the IndexedDB quota
 * after the block is already placed, losing the take on the next save.
 */
export async function importAudioFiles(
  api: ExcalidrawImperativeAPI,
  files: File[],
  insertAt?: { x: number; y: number }
): Promise<AudioImportResult> {
  if (!files.length) return { added: 0, skippedLarge: 0 };
  const anchor = insertAt ?? nextInsertPosition(api.getSceneElements());
  let y = anchor.y;
  let x = anchor.x;
  let added = 0;
  let skippedLarge = 0;
  const created: ExcalidrawElement[] = [];
  for (const file of files) {
    if (isAudioImportTooLarge(file.size)) {
      skippedLarge += 1;
      continue;
    }
    // normalize the MIME (drag-dropped files often arrive with an empty
    // type, which readAsDataURL stamps as application/octet-stream)
    const dataUrl = withAudioMime(await fileToDataUrl(file), file.name);
    if (!dataUrl) {
      // defensive: classifyFile already vetted these — anything still
      // unmappable would render a broken player, so skip it.
      continue;
    }
    created.push(makeAudioEmbeddable(file.name, dataUrl, x, y));
    y += AUDIO_BLOCK_HEIGHT + 24;
    added += 1;
  }
  if (created.length) {
    api.updateScene({ elements: [...api.getSceneElements(), ...created] });
  }
  return { added, skippedLarge };
}

/* ------------------------------------------------------------------ */
/* PDF printout (OneNote-style: each page rendered onto the canvas)    */
/* + the OneNote-style file chip that keeps the original bytes         */
/* ------------------------------------------------------------------ */

/** How much of a PDF actually made it onto the canvas (issue #75). */
export interface PdfPrintoutResult {
  /** pages rendered as canvas images (capped by MAX_PRINTOUT_PAGES) */
  rendered: number;
  /** pages the document actually contains — larger than `rendered` means
   *  the import was truncated and the user must be told */
  total: number;
  /** was the original file embedded in an attachment chip?
   *  (docs/test-plans/pdf-attachment.md) */
  attachment: PdfAttachmentOutcome;
}

/** Render cap per imported PDF — keeps monster documents usable on canvas. */
const MAX_PRINTOUT_PAGES = 20;

/**
 * The OneNote-style file chip above the printout pages (an Excalidraw
 * embeddable, the audio-block pattern of issue #67): `link` carries the
 * marker scheme (survives Excalidraw's link sanitization), `customData`
 * carries the payload (survives scene restore) — the ORIGINAL PDF bytes
 * as a data: URL, so the file stays downloadable byte-exactly, offline.
 * Files beyond the 10 MiB attachment cap keep importing as a plain
 * printout without a chip (docs/test-plans/pdf-attachment.md).
 */
export function makePdfAttachmentElement(
  name: string,
  dataUrl: string,
  x: number,
  y: number
): ExcalidrawElement {
  const seed = Math.floor(Math.random() * 2 ** 31);
  return {
    id: crypto.randomUUID(),
    type: "embeddable",
    x,
    y,
    width: PDF_ATTACHMENT_WIDTH,
    height: PDF_ATTACHMENT_HEIGHT,
    angle: 0,
    strokeColor: "#dc2626",
    backgroundColor: "#fff1f2",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: PDF_ATTACHMENT_LINK_SCHEME,
    locked: false,
    customData: { pdfName: name, pdfData: dataUrl },
  } as unknown as ExcalidrawElement;
}

/**
 * Read the original file bytes for the attachment chip, enforcing the
 * size cap BEFORE any scene mutation. Drag-dropped PDFs often arrive with
 * an empty MIME type (readAsDataURL stamps octet-stream), so the prefix
 * is normalized to application/pdf like the audio clips do.
 */
async function pdfAttachmentDataUrl(
  file: File,
): Promise<{ kind: "stored"; dataUrl: string } | { kind: "skipped-large" }> {
  if (isPdfAttachmentTooLarge(file.size)) return { kind: "skipped-large" };
  const raw = await fileToDataUrl(file);
  const dataUrl = withPdfMime(raw);
  if (!dataUrl) return { kind: "skipped-large" }; // defensive: never a corrupt chip
  return { kind: "stored", dataUrl };
}

export async function importPdfAsPrintout(
  api: ExcalidrawImperativeAPI,
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<PdfPrintoutResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const total = doc.numPages;
  const maxPages = Math.min(total, MAX_PRINTOUT_PAGES); // guard against monsters
  const anchor = nextInsertPosition(api.getSceneElements());
  const attachment = await pdfAttachmentDataUrl(file);
  const newFiles: NonNullable<ScenePayload["files"]> = {};
  const skeletons: Array<{ type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }> = [];
  // chip first at the anchor, pages directly below it — one updateScene,
  // so a single undo removes the whole import
  const chip =
    attachment.kind === "stored"
      ? makePdfAttachmentElement(file.name, attachment.dataUrl, anchor.x, anchor.y)
      : null;
  let y = anchor.y + (chip ? PDF_ATTACHMENT_HEIGHT + 24 : 0);
  const canvas = document.createElement("canvas");
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    // issue #87: cap the render size like image imports — a huge page (A0
    // poster) at scale 1.5 would otherwise become a multi-MB dataURL
    const base = page.getViewport({ scale: 1.5 });
    const viewport = page.getViewport({
      scale: printoutViewportScale(base.width, base.height),
    });
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
  applySkeletons(api, skeletons, newFiles, chip ? [chip] : []);
  return { rendered: skeletons.length, total, attachment: attachment.kind };
}

/* ------------------------------------------------------------------ */
/* general file attachments (issue #278)                               */
/* ------------------------------------------------------------------ */

/**
 * The OneNote "Insert > File Attachment" chip for ANY file (issue #278,
 * generalizing the PDF chip above): an Excalidraw embeddable whose `link`
 * carries the `infinitenote:file` marker scheme and whose `customData`
 * carries the ORIGINAL bytes as a data: URL plus the recorded name, MIME
 * and byte size. Neutral slate styling distinguishes it from the red PDF
 * chip; the badge shows the file's extension (formatFileSize /
 * fileBadgeLabel in lib/file-attachment.ts are unit-tested).
 */
export function makeFileAttachmentElement(
  name: string,
  mime: string,
  dataUrl: string,
  size: number,
  x: number,
  y: number
): ExcalidrawElement {
  const seed = Math.floor(Math.random() * 2 ** 31);
  return {
    id: crypto.randomUUID(),
    type: "embeddable",
    x,
    y,
    width: FILE_ATTACHMENT_WIDTH,
    height: FILE_ATTACHMENT_HEIGHT,
    angle: 0,
    strokeColor: "#475569",
    backgroundColor: "#f1f5f9",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: FILE_ATTACHMENT_LINK_SCHEME,
    locked: false,
    customData: { fileName: name, fileData: dataUrl, fileSize: size, fileMime: mime },
  } as unknown as ExcalidrawElement;
}

/**
 * Attach one or more files to the current page (issue #278). Each file is
 * size-capped BEFORE any scene mutation (10 MiB, the PDF/audio stance —
 * the payload rides every autosave, snapshot and sync copy) and lands as
 * a chip at the next insert position, each row offset so a batch stays
 * readable. ONE updateScene per batch = one undo step removes them all.
 *
 * Returns the per-file outcomes the caller turns into toasts: attached
 * names, oversized names (explicitly skipped), and names whose data URL
 * could not be normalized (defensive — never a corrupt chip).
 */
export async function attachFiles(
  api: ExcalidrawImperativeAPI,
  files: readonly File[],
): Promise<{ attached: string[]; skippedLarge: string[]; skippedInvalid: string[] }> {
  const attached: string[] = [];
  const skippedLarge: string[] = [];
  const skippedInvalid: string[] = [];
  const created: ExcalidrawElement[] = [];
  const base = nextInsertPosition(api.getSceneElements());
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isFileAttachmentTooLarge(file.size)) {
      skippedLarge.push(file.name);
      continue;
    }
    try {
      const raw = await fileToDataUrl(file);
      const dataUrl = withFileMime(raw, file.type);
      if (!dataUrl) {
        skippedInvalid.push(file.name);
        continue;
      }
      created.push(
        makeFileAttachmentElement(
          file.name,
          file.type || "application/octet-stream",
          dataUrl,
          file.size,
          base.x,
          base.y + i * (FILE_ATTACHMENT_HEIGHT + 16),
        ),
      );
      attached.push(file.name);
    } catch {
      skippedInvalid.push(file.name);
    }
  }
  if (created.length) {
    // one updateScene = one undo step (the tables precedent); INSERT
    // deselects on purpose — the HWR-E05/E06 lesson: programmatic
    // auto-selection mounts the Selected-shape-actions panel and races
    // the canvas for keyboard focus
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
    });
  }
  return { attached, skippedLarge, skippedInvalid };
}

/* ------------------------------------------------------------------ */
/* internal page links (OneNote "Copy Link to Page" parity)            */
/* ------------------------------------------------------------------ */

/**
 * The pasted/picked page link as a CANVAS element: a normal, editable
 * text element whose Excalidraw `link` field carries the
 * `infinitenote:page/<id>` marker (the audio/PDF/file marker precedent —
 * the scheme survives Excalidraw's link sanitization). Building it via
 * `convertToExcalidrawElements` keeps Excalidraw's own text metrics, so
 * the click target matches the rendered label exactly.
 *
 * Returns null when the label or the page id cannot form a valid link —
 * the caller toasts; the scene is never mutated with a broken link.
 */
export function makePageLinkElement(
  label: string,
  pageId: string,
  x: number,
  y: number
): ExcalidrawElement | null {
  const link = pageLinkFor(pageId);
  const text = label.trim();
  if (!link || !text) return null;
  const skeletons = [
    {
      type: "text" as const,
      text,
      x,
      y,
      fontSize: 20,
      id: crypto.randomUUID(),
      link,
    },
  ];
  const [element] = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }) as unknown as ExcalidrawElement[];
  return element ?? null;
}

/**
 * Insert one internal page link at the next insert position. ONE
 * updateScene = one undo step removes it (the tables/attachments
 * precedent); INSERT deselects on purpose (the HWR-E05/E06 lesson).
 * Returns false when the link or label is invalid — the caller toasts.
 */
export function insertPageLink(
  api: ExcalidrawImperativeAPI,
  pageId: string,
  label: string
): boolean {
  const at = nextInsertPosition(api.getSceneElements());
  const element = makePageLinkElement(label, pageId, at.x, at.y);
  if (!element) return false;
  api.updateScene({
    elements: [...api.getSceneElements(), element],
  });
  return true;
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
  // Fail with the file named and the reason — a truncated download or a
  // renamed non-scene file must not surface as a bare SyntaxError that
  // aborts the rest of the import batch with no clue which file broke.
  let parsed: ReturnType<typeof parseSceneFileText>;
  try {
    parsed = parseSceneFileText(json);
  } catch (e) {
    throw new Error(`"${file.name}" is not a valid Excalidraw scene: ${(e as Error).message}`);
  }
  // the seam stays untyped on purpose — restore() is the element sanitizer,
  // so junk shapes are its problem, not the parser's
  const restored = restore(
    {
      elements: parsed.elements,
      appState: parsed.appState,
      files: parsed.files,
    } as Parameters<typeof restore>[0],
    null,
    null,
  );
  return { elements: restored.elements as ExcalidrawElement[], files: restored.files };
}

/** Append an imported scene into the current canvas, placed below existing content. */
export function appendScene(api: ExcalidrawImperativeAPI, scene: ImportedScene): void {
  const fileValues = Object.values(scene.files);
  if (fileValues.length) api.addFiles(fileValues as BinaryFileData[]);
  const current = api.getSceneElements();
  if (!current.length) {
    // normalize image statuses at import (issue #122): restored scenes can
    // carry "pending" images whose data is present — flip them up front
    const normalized = normalizeImageStatuses({
      elements: [...scene.elements],
      files: scene.files as NonNullable<ScenePayload["files"]>,
    });
    api.updateScene({ elements: [...(normalized.elements as ExcalidrawElement[])] });
    return;
  }
  const anchor = nextInsertPosition(current);
  const [ix1, iy1] = getCommonBounds(scene.elements as NonDeletedExcalidrawElement[]);
  const shifted = scene.elements.map((e) => ({
    ...e,
    x: e.x - ix1 + anchor.x,
    y: e.y - iy1 + anchor.y,
  }));
  const normalized = normalizeImageStatuses({
    elements: shifted,
    files: scene.files as NonNullable<ScenePayload["files"]>,
  });
  api.updateScene({ elements: [...current, ...(normalized.elements as ExcalidrawElement[])] });
}

/* ------------------------------------------------------------------ */
/* curated shape library (issue #65)                                   */
/* ------------------------------------------------------------------ */

/**
 * Insert one curated library shape as native Excalidraw elements below the
 * existing content (or at `insertAt`), auto-selected for immediate editing.
 *
 * Colors: INHERIT_* sentinels resolve to the user's current toolbar colors,
 * so shapes match what they would draw by hand. Everything else — geometry,
 * arrowheads, the sticky note's pinned yellow + bound label — comes straight
 * from the pure catalog in lib/shape-library.ts. Native elements mean the
 * shapes persist with the scene and round-trip through every export path.
 */
export function insertShapeById(
  api: ExcalidrawImperativeAPI,
  shapeId: string,
  insertAt?: { x: number; y: number },
): boolean {
  const def = getShapeDef(shapeId);
  if (!def) return false;
  const anchor = insertAt ?? nextInsertPosition(api.getSceneElements());
  const appState = api.getAppState();
  // fresh element ids per insert: catalog skeleton ids are stable
  // placeholders, but inserting the SAME shape twice must never put two
  // elements with one id into the live scene — Excalidraw keys its
  // elementsMap by id, and the collision makes dragging copy #2 mutate
  // copy #1 (restore() re-ids duplicates on reload, but the live scene
  // must not get there in the first place)
  const skeletons = def.skeletons.map((s: ShapeSkeleton) => ({
    ...s,
    id: crypto.randomUUID(),
    x: s.x + anchor.x,
    y: s.y + anchor.y,
    strokeColor:
      s.strokeColor === INHERIT_STROKE
        ? (appState.currentItemStrokeColor ?? "#1e1e1e")
        : s.strokeColor,
    backgroundColor:
      s.backgroundColor === INHERIT_FILL
        ? (appState.currentItemBackgroundColor ?? "transparent")
        : s.backgroundColor,
  }));
  const created = convertToExcalidrawElements(
    skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  ) as unknown as ExcalidrawElement[];
  api.updateScene({
    elements: [...api.getSceneElements(), ...created],
    appState: {
      selectedElementIds: Object.fromEntries(created.map((e) => [e.id, true])),
    },
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* tables on pages (issue #277)                                         */
/* ------------------------------------------------------------------ */

/**
 * Stamp the table marker into an element's customData, PRESERVING any
 * existing customData keys (the marker must never clobber a payload another
 * feature already put there — the audio/pdf chips share this space).
 */
function withTableMarker(
  el: { customData?: Record<string, unknown> | null },
  marker: TableMarker,
): void {
  el.customData = { ...(el.customData ?? {}), [TABLE_MARKER_KEY]: marker };
}

/**
 * Convert table skeletons into live elements and append them to the scene.
 * Shared by insertTable (a fresh table) and the structural ops (rebuild).
 * One updateScene call = one undo step (captureUpdate IMMEDIATELY, the
 * conversion precedent). The ops deselect, and INSERT deselects too — the
 * HWR-E05/E06 lesson: programmatic auto-selection mounts Excalidraw's
 * "Selected shape actions" panel and races the canvas for keyboard focus,
 * which kills any editor opened right after (measured: a double-click into
 * a cell within seconds of a selecting insert lost the editor before the
 * first keystroke). A fresh table sits where it landed; the user clicks a
 * cell to type (OneNote behavior) and drags the grid normally.
 */
function applyTableRebuild(
  api: ExcalidrawImperativeAPI,
  removed: readonly ExcalidrawElement[],
  geo: TableGeometry,
  texts: string[][],
  select: boolean,
): void {
  const skeletons = tableSkeletons(geo, texts, () => crypto.randomUUID());
  const created = convertToExcalidrawElements(
    skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  ) as unknown as ExcalidrawElement[];
  // stamp markers by skeleton id — regenerateIds:false keeps the ids, so
  // every created element matches its skeleton exactly once. Deliberately
  // NO shared groupIds: Excalidraw's double-click turns an ALREADY-SELECTED
  // GROUP into group-leaf selection and returns (the selectedGroupIds
  // branch of handleCanvasDoubleClick, 0.18.1 lines ~5474-5492 and identical
  // on master — measured in e2e): a grouped cell could never reach the
  // double-click-to-type flow. The OneNote behavior — click into a cell,
  // type — wins; whole-table moves work by rubber-band selection, and the
  // structural ops key off customData markers, not selection.
  const markerById = new Map(skeletons.map((s) => [s.id, s.marker]));
  for (const el of created) {
    const marker = markerById.get(el.id);
    if (marker) withTableMarker(el as unknown as { customData?: Record<string, unknown> | null }, marker);
  }
  const removedIds = new Set(removed.map((e) => e.id));
  const live = api.getSceneElements().filter((e) => !removedIds.has(e.id));
  const tombstones = removed.map((e) => ({ ...e, isDeleted: true }));
  api.updateScene({
    elements: [...live, ...tombstones, ...created] as ExcalidrawElement[],
    appState: {
      selectedElementIds: select
        ? Object.fromEntries(created.map((e) => [e.id, true]))
        : {},
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/**
 * Insert a rows×cols table (OneNote "Insert > Table" parity, issue #277)
 * at the next insert position — the shape-library insertion path. Every
 * element carries its marker in customData for the structural ops; the
 * elements deliberately stay UNGROUPED (see applyTableRebuild).
 */
export function insertTable(
  api: ExcalidrawImperativeAPI,
  rows: number,
  cols: number,
): boolean {
  const r = Math.floor(rows);
  const c = Math.floor(cols);
  if (r < MIN_ROWS || r > MAX_ROWS || c < MIN_COLS || c > MAX_COLS) return false;
  const anchor = nextInsertPosition(api.getSceneElements());
  const geo: TableGeometry = {
    tableId: crypto.randomUUID(),
    x0: anchor.x,
    y0: anchor.y,
    rows: r,
    cols: c,
    cellW: DEFAULT_CELL_W,
    cellH: DEFAULT_CELL_H,
  };
  applyTableRebuild(api, [], geo, emptyTexts(r, c), false);
  return true;
}

export interface TableOpResult {
  ok: boolean;
  /** Present on success when the UI should toast (whole-table delete). */
  message?: string;
  /** Present on failure — the exact reason the op was refused. */
  error?: string;
}

/**
 * Apply one structural op (add/delete row/column, delete table) to the
 * table with the given id (issue #277). Refusals (the 1×1 floor, the
 * growth caps, a dead table) come back as { ok: false, error } for the
 * toast; success rebuilds the grid in one undoable updateScene. The ops
 * deselect on success — a menu action must never leave the canvas fighting
 * a panel for keyboard focus (HWR-E05).
 */
/* -------------- checklists (issue #302) -------------- */

/**
 * Rebuild ONE text element in place with new text: convertToExcalidraw
 * Elements with the SAME id (regenerateIds:false keeps it — the page-link
 * / table precedents) re-measures width/height/baseline from the new text
 * in the browser's own font metrics, and every style prop rides through
 * so the flip is invisible except for the token. This is the table-op
 * rebuild precedent applied to a single element.
 *
 * The VERSION is bumped past the replaced element's on purpose: convert
 * stamps a fresh element (version 1), and a same-id replacement whose
 * version reads `id@1` while the last save recorded `id@1` is
 * indistinguishable from a metadata re-stamp to the autosave gate
 * (sceneSignature is id@version — an equal signature DROPS the stash and
 * the flip never persists; measured 2026-11-21: a toggle of a
 * version-1 starter item survived on canvas but never reached the DB,
 * the reload came back unchecked). The bump also keeps the store's
 * version-aware reconciliation honest — a replacement must never present
 * a version behind the element it replaces.
 */
function rebuildTextElement(el: ExcalidrawTextElement, newText: string): ExcalidrawElement | null {
  const skeleton = {
    type: "text" as const,
    id: el.id,
    x: el.x,
    y: el.y,
    text: newText,
    fontSize: el.fontSize,
    fontFamily: el.fontFamily,
    strokeColor: el.strokeColor,
    backgroundColor: el.backgroundColor,
    fillStyle: el.fillStyle,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    roughness: el.roughness,
    opacity: el.opacity,
    angle: el.angle,
    textAlign: el.textAlign,
    lineHeight: el.lineHeight,
    // a checklist item that IS a page-link label keeps its link through
    // the rebuild (the wave-13 marker rides the text element)
    link: el.link || undefined,
  };
  const [rebuilt] = convertToExcalidrawElements(
    [skeleton] as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  ) as unknown as ExcalidrawTextElement[];
  if (!rebuilt) return null;
  return {
    ...rebuilt,
    version: Math.max(el.version ?? 0, rebuilt.version ?? 0) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}

export interface ChecklistOpResult {
  ok: boolean;
  /** The new checked state (toggle only). */
  checked?: boolean;
  /** User-facing toast line when ok is false. */
  error?: string;
}

/**
 * Toggle ONE checklist item's done state (issue #302): flip the `[ ]`/`[x]`
 * token as ONE scene update = one undo step (the table-op precedent),
 * deselecting on purpose so the following canvas undo is deterministic
 * (the issue-#231 lesson — a selection left behind races the keyboard).
 * Refuses elements that are not live checklist items.
 */
export function toggleChecklist(api: ExcalidrawImperativeAPI, elementId: string): ChecklistOpResult {
  const scene = api.getSceneElementsIncludingDeleted() as unknown as TodoElementLike[];
  const el = scene.find((e) => e.id === elementId && !e.isDeleted);
  const hit = el ? classifyTodoText(el) : null;
  if (!hit || hit.kind !== "checklist" || !el) {
    return { ok: false, error: "Not a checklist item." };
  }
  const flipped = flipChecklistText(typeof el.text === "string" ? el.text : "");
  if (!flipped) return { ok: false, error: "Not a checklist item." };
  const rebuilt = rebuildTextElement(el as unknown as ExcalidrawTextElement, flipped);
  if (!rebuilt) return { ok: false, error: "The checklist item could not be updated." };
  api.updateScene({
    elements: (scene as unknown as ExcalidrawElement[]).map((e) => (e.id === elementId ? rebuilt : e)),
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ok: true, checked: !hit.checked };
}

/**
 * OneNote "Home > To Do tag" (issue #302): apply the `[ ] ` token to ONE
 * plain single-line text element as ONE scene update = one undo step.
 * Refuses elements that are not taggable plain text.
 */
export function applyToDoTagToElement(api: ExcalidrawImperativeAPI, elementId: string): ChecklistOpResult {
  const scene = api.getSceneElementsIncludingDeleted() as unknown as TodoElementLike[];
  const el = scene.find((e) => e.id === elementId && !e.isDeleted);
  const hit = el ? classifyTodoText(el) : null;
  if (!hit || hit.kind !== "plain" || !el) {
    return { ok: false, error: "Only a plain single-line text can get the To Do tag." };
  }
  const tagged = applyToDoTag(hit.text);
  if (!tagged) return { ok: false, error: "The To Do tag could not be applied." };
  const rebuilt = rebuildTextElement(el as unknown as ExcalidrawTextElement, tagged);
  if (!rebuilt) return { ok: false, error: "The To Do tag could not be applied." };
  api.updateScene({
    elements: (scene as unknown as ExcalidrawElement[]).map((e) => (e.id === elementId ? rebuilt : e)),
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ok: true };
}

/**
 * Insert ONE bare checklist item (`[ ]`) at the next insert position
 * (issue #302) — the Import-menu starter. The desktop editor opens text
 * edits fully selected (measured: `autoSelect: !device.isTouchScreen`),
 * so the item ships EMPTY and the flow that cannot lose its token is the
 * menu one (type text, then "Add To Do tag"); arrows collapse the
 * selection for the keyboard-confident in-place edit.
 */
export function insertChecklistItem(api: ExcalidrawImperativeAPI): boolean {
  const at = nextInsertPosition(api.getSceneElements());
  const skeleton = {
    type: "text" as const,
    id: crypto.randomUUID(),
    text: CHECK_UNCHECKED,
    x: at.x,
    y: at.y,
    fontSize: 20,
  };
  const [element] = convertToExcalidrawElements(
    [skeleton] as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  ) as unknown as ExcalidrawElement[];
  if (!element) return false;
  api.updateScene({
    elements: [...api.getSceneElements(), element],
  });
  return true;
}

export function applyTableOp(
  api: ExcalidrawImperativeAPI,
  tableId: string,
  op: TableOp,
): TableOpResult {
  const scene = api.getSceneElementsIncludingDeleted() as unknown as TableElementLike[];
  const plan = planTableOp(scene, tableId, op);
  if (plan.kind === "error") return { ok: false, error: plan.message };
  const marked = tableElements(scene, tableId) as unknown as ExcalidrawElement[];
  // The marked elements AND their bound labels must both go: the labels carry
  // no marker of their own, so leaving them live would restore a ghost label
  // over a tombstoned container (caught by e2e TB-E03: the old "revenue Q1"
  // survived a row insert as a floating text). One doomed-id set serves the
  // whole-table delete and the rebuild alike.
  const doomed = new Set(marked.map((e) => e.id));
  for (const el of marked) {
    for (const b of el.boundElements ?? []) {
      if (b.type === "text") doomed.add(b.id);
    }
  }
  const removedWithTexts = (api.getSceneElementsIncludingDeleted() as ExcalidrawElement[]).filter(
    (e) => doomed.has(e.id),
  );
  if (plan.kind === "delete") {
    api.updateScene({
      elements: (api.getSceneElementsIncludingDeleted() as ExcalidrawElement[]).map((e) =>
        doomed.has(e.id) ? { ...e, isDeleted: true } : e,
      ),
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return { ok: true, message: "Table deleted." };
  }
  applyTableRebuild(api, removedWithTexts, plan.geo, plan.texts, false);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* handwriting → text conversion (issue #176, Phase B)                  */
/* ------------------------------------------------------------------ */

/**
 * How long after a conversion the integrity guard re-checks that the
 * created text elements still exist in the elements map. Sized just past
 * the measured drop window (the 0.18 store/history interplay removed an
 * insert ~1 s after it was applied — docs/test-plans/handwriting.md
 * "Known limitation"). The guard is a no-op on the healthy path: the
 * elements are in the map, nothing is logged, nothing is written.
 */
const CONVERSION_INTEGRITY_DELAY_MS = 1_500;

/**
 * Convert recognized handwriting into editable text elements (Phase B,
 * issue #176). Reads the LIVE scene and, when freedraw ink is selected,
 * converts only lines overlapping the selection (per-group — any member
 * stroke in the selection pulls in its whole line); without a selection
 * the whole page converts (per-page). The scope decision counts INK only:
 * a conversion auto-selects its own text output, and that must not hijack
 * the NEXT conversion into group mode (found by HWR-E05, fixed 2026-11-11).
 * OneNote behavior: the text lands at the ink's position on TOP of the
 * z-order and the original strokes are KEPT. Re-runs are no-ops by
 * structural detection (a text element at the line's position already
 * counts as converted), so undoing or deleting the text block makes the
 * line convertible again, and a fresh recognition run simply updates the
 * stored metadata.
 *
 * One native `updateScene` call = one undo step (Ctrl+Z removes the
 * inserted text and un-marks the ink) and one autosave cycle. Returns the
 * counts the toast needs; never throws for a legitimately empty scene —
 * an empty result means "nothing recognized yet".
 *
 * Integrity guard (HWR-U03): ~1.5 s after the insert the created ids are
 * re-checked against the elements map INCLUDING tombstones. An element
 * that was TOMBSTONED is a legitimate undo/delete — never touched. An
 * element missing from the map entirely is the measured store drop —
 * healed by re-entering this same function once (structural idempotency
 * makes re-entry safe: lines that gained a text block meanwhile report
 * alreadyConverted instead of inserting a duplicate). The re-entry never
 * schedules another guard, so the loop is bounded at one heal.
 */
export function convertHandwritingToText(
  api: ExcalidrawImperativeAPI,
  opts: { scheduleIntegrityCheck?: boolean } = {},
): HwrConvertOutcome {
  const payload = getScenePayload(api);
  const appState = api.getAppState();
  const inkIds = new Set(
    (payload.elements as Array<{ id?: unknown; type?: unknown; isDeleted?: unknown }>)
      .filter((e) => e && e.type === "freedraw" && !e.isDeleted && typeof e.id === "string")
      .map((e) => e.id as string),
  );
  const selectedIds = new Set(
    Object.keys(appState.selectedElementIds ?? {}).filter((id) => inkIds.has(id)),
  );
  const selected = selectedIds.size > 0;
  const plan = planHwrConversion(payload, selected ? selectedIds : undefined);
  if (!plan.targets.length) {
    return { converted: 0, alreadyConverted: plan.alreadyConverted, selected };
  }
  // fresh ids per conversion — placeholder skeleton ids must never reach
  // the live scene twice (insertShapeById precedent)
  const skeletons = conversionSkeletons(plan.targets).map((s) => ({
    ...s,
    id: crypto.randomUUID(),
    strokeColor:
      s.strokeColor === INHERIT_STROKE
        ? (appState.currentItemStrokeColor ?? "#1e1e1e")
        : s.strokeColor,
  }));
  const created = convertToExcalidrawElements(
    skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  ) as unknown as ExcalidrawElement[];
  // Pure append — exactly the proven shape-library insertion pattern. No
  // customData flag on the strokes: Excalidraw's undo does not revert
  // customData (measured 2026-11-11, HWR-E06), so a flag would survive the
  // undo that removed the text and "already converted" would lie. Idempotency
  // is structural instead (planHwrConversion matches a text element at the
  // line's position), so undoing or deleting the text makes the line
  // convertible again.
  api.updateScene({
    elements: [...api.getSceneElements(), ...created] as ExcalidrawElement[],
    // Deselect on purpose (issue #231): selecting the freshly created text
    // mounts Excalidraw's "Selected shape actions" panel and races the
    // canvas for keyboard focus — on CI reruns every Ctrl+Z then landed in
    // the panel/trigger instead of the canvas undo stack and the element
    // count stuck at the pre-undo number (measured 2026-11-15: three
    // presses no-op, selection shows the converted text, panel mounted).
    // The converted scene deselects itself: the toast reports the outcome,
    // and canvas undo becomes deterministic (HWR-E06). The selection rides
    // the same native scene update, so the undo grouping (one IMMEDIATELY
    // entry) is untouched.
    appState: {
      selectedElementIds: {},
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  if (opts.scheduleIntegrityCheck !== false) {
    const createdIds = created.map((e) => e.id);
    setTimeout(() => {
      let dropped: string[] = [];
      try {
        dropped = detectDroppedConversion(createdIds, api.getSceneElementsIncludingDeleted());
      } catch (err) {
        // an api whose canvas was remounted mid-window can throw on access;
        // the new canvas is authoritative — nothing to heal here
        console.warn("[hwr-convert] integrity check could not read the scene:", err);
        return;
      }
      if (!dropped.length) return; // healthy — the only path a normal run ever takes
      console.warn(
        `[hwr-convert] the store dropped ${dropped.length} converted text element(s) ` +
          `~${CONVERSION_INTEGRITY_DELAY_MS}ms after insertion — re-applying ` +
          `(documented Excalidraw 0.18 store/history interplay, docs/test-plans/handwriting.md)`,
      );
      const healed = convertHandwritingToText(api, { scheduleIntegrityCheck: false });
      if (healed.converted === 0 && healed.alreadyConverted === 0) {
        console.error(
          "[hwr-convert] re-apply found nothing to convert — the ink or its recognition metadata is gone",
        );
      }
    }, CONVERSION_INTEGRITY_DELAY_MS);
  }
  return { converted: plan.targets.length, alreadyConverted: plan.alreadyConverted, selected };
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function applySkeletons(
  api: ExcalidrawImperativeAPI,
  skeletons: Array<{ type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }>,
  newFiles: NonNullable<ScenePayload["files"]>,
  extraElements: ExcalidrawElement[] = []
): void {
  const created = convertToExcalidrawElements(skeletons, { regenerateIds: false }) as unknown as Array<
    ExcalidrawElement & { fileId: string }
  >;
  // ensure images render immediately (not stuck in "pending")
  const safe = created.map((e) => ({ ...e, status: "saved" }));
  api.updateScene({ elements: [...api.getSceneElements(), ...(safe as ExcalidrawElement[]), ...extraElements] });
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
