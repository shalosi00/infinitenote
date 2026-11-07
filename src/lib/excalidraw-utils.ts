/**
 * SSR-safe Excalidraw helpers & the CanvasApi contract.
 *
 * This module MUST NOT contain runtime imports from @excalidraw/excalidraw —
 * it is imported by server-rendered components (header, sidebar). All
 * runtime integration lives in `excalidraw-client.ts`, which is only ever
 * loaded by the dynamically-imported canvas wrapper (`ssr: false`).
 */
import type { ScenePayload } from "./types";
import { isAudioFile } from "./audio-notes";

/** Imperative surface the canvas exposes to the rest of the app. */
export interface CanvasApi {
  /** Route files by type: images, text/markdown, PDF (printout), .excalidraw,
   *  Word documents, HTML pages, OneNote .mht single-file pages, audio clips. */
  importFiles: (files: File[]) => Promise<void>;
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  /** Download the current page as a .excalidraw scene file. */
  exportSceneFile: () => Promise<void>;
  /** Print-friendly paginated A4 PDF (issue #20). */
  exportPdf: (orientation: "portrait" | "landscape") => Promise<void>;
  /** Zoom viewport to fit existing content. */
  focusContent: () => void;
  /** Insert one curated library shape by id (issue #65). */
  insertShape: (shapeId: string) => void;
  /** Flush a pending debounced save immediately (used on page switch). */
  flushSave: () => Promise<void>;
  /** True while the canvas holds un-saved edits (autosave debounce pending). */
  hasPendingEdits: () => boolean;
  /**
   * Drop pending edits WITHOUT saving them — used after a sync replaced the
   * open page's content in the DB: the remounting canvas must not flush its
   * now-stale stash over the freshly merged scene.
   */
  discardPendingEdits: () => void;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export type FileImportKind =
  | "image"
  | "pdf"
  | "excalidraw"
  | "text"
  | "docx"
  | "html"
  | "mht"
  | "audio"
  | "unknown";

/**
 * Classify an importable file. Order matters: scene files before generic
 * json; audio before the generic buckets so clips never fall through to
 * "unknown" (their extensions are nobody else's).
 */
export function classifyFile(file: File): FileImportKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".excalidraw") || name.endsWith(".excalidraw.json")) return "excalidraw";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name)) {
    return "image";
  }
  // Audio clips (imported files AND in-app recordings — MediaRecorder stamps
  // audio/webm). .webm stays non-audio unless the MIME says so (video default).
  if (isAudioFile(file.name, file.type)) return "audio";
  // Word documents (OneNote "Save as Word" export), HTML pages
  // (OneNote "Save as" HTML export) and .mht single-file pages
  // (OneNote "Save as" .mht export) — all structured imports.
  if (name.endsWith(".docx")) return "docx";
  // .mht/.mhtml MUST be checked before .html: ".mhtml" ends with ".html".
  if (
    /\.mht(?:ml)?$/i.test(name) ||
    file.type === "message/rfc822" ||
    file.type === "application/x-mimearchive"
  ) {
    return "mht";
  }
  if (file.type.startsWith("text/html") || /\.html?$/i.test(name)) return "html";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown|csv|json|log|ya?ml)$/i.test(name)) {
    return "text";
  }
  return "unknown";
}

/**
 * Keep only files actually referenced by image elements (drop orphans), and
 * enforce the persistence invariant of issue #122: an image element whose
 * file data is being kept must never persist with status "pending".
 *
 * Why: Excalidraw's native image insertion (paste, canvas drop, some import
 * paths) adds the element as "pending" and flips it to "saved" only after the
 * file data decodes asynchronously. An autosave that races that decode would
 * otherwise freeze the stale flag into the persisted scene forever — the data
 * is right there in the same payload, so the flag is provably wrong.
 */
export function sanitizeScene(payload: ScenePayload): ScenePayload {
  const usedFileIds = new Set<string>();
  for (const el of payload.elements as Array<{ type?: string; fileId?: string | null }>) {
    if (el?.type === "image" && el.fileId) usedFileIds.add(el.fileId);
  }
  const files: ScenePayload["files"] = {};
  for (const [id, f] of Object.entries(payload.files)) {
    if (usedFileIds.has(id) && f?.dataURL) files[id] = f;
  }
  return normalizeImageStatuses({ elements: payload.elements, files });
}

/**
 * Flip image elements from "pending" to "saved" once their file data is
 * registered (issue #122).
 *
 * Excalidraw 0.18 inserts images with status "pending" and only its hosted
 * app (not the library) ever flips them to "saved" — elements created by
 * the library's own paths (pasting an image, the image tool, dropping a
 * file straight onto the canvas) would otherwise persist as "pending"
 * forever, even though their binary data is present and renders/exports
 * fine. Elements whose file is genuinely missing keep "pending" — that is
 * the honest state (the data really is not there).
 */
export function normalizeImageStatuses(payload: ScenePayload): ScenePayload {
  let changed = false;
  const elements = payload.elements.map((el) => {
    const e = el as { type?: string; fileId?: string | null; status?: string };
    if (e?.type === "image" && e.status === "pending" && e.fileId) {
      if (payload.files[e.fileId]?.dataURL) {
        changed = true;
        return { ...e, status: "saved" };
      }
    }
    return el;
  });
  return changed ? { ...payload, elements } : payload;
}

/**
 * Safe filename from a page title (issue #74).
 *
 * Unicode-aware: letters and digits from ANY script survive (the UI is
 * bilingual — a 简体中文 title must not collapse to "untitled"), while
 * filesystem-hostile characters are stripped. Whitespace runs slugify to
 * "-", the result is capped at 60 code points (never mid-surrogate-pair),
 * and an empty result falls back to "untitled".
 */
export function titleToFilename(title: string, ext: string): string {
  const slug = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "") // filesystem-hostile chars
    .replace(/[^\p{L}\p{N}\-. _]+/gu, "") // keep Unicode letters/digits + -._ and space
    .trim()
    .replace(/\s+/g, "-");
  const base = slug ? Array.from(slug).slice(0, 60).join("") : "untitled";
  return `${base}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
