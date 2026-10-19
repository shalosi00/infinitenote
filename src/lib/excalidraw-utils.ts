/**
 * SSR-safe Excalidraw helpers & the CanvasApi contract.
 *
 * This module MUST NOT contain runtime imports from @excalidraw/excalidraw —
 * it is imported by server-rendered components (header, sidebar). All
 * runtime integration lives in `excalidraw-client.ts`, which is only ever
 * loaded by the dynamically-imported canvas wrapper (`ssr: false`).
 */
import type { ScenePayload } from "./types";

/** Imperative surface the canvas exposes to the rest of the app. */
export interface CanvasApi {
  /** Route files by type: images, text/markdown, PDF (printout), .excalidraw,
   *  Word documents, HTML pages. */
  importFiles: (files: File[]) => Promise<void>;
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  /** Download the current page as a .excalidraw scene file. */
  exportSceneFile: () => Promise<void>;
  /** Zoom viewport to fit existing content. */
  focusContent: () => void;
  /** Flush a pending debounced save immediately (used on page switch). */
  flushSave: () => Promise<void>;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export type FileImportKind =
  | "image"
  | "pdf"
  | "excalidraw"
  | "text"
  | "docx"
  | "html"
  | "unknown";

/** Classify an importable file. Order matters: scene files before generic json. */
export function classifyFile(file: File): FileImportKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".excalidraw") || name.endsWith(".excalidraw.json")) return "excalidraw";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name)) {
    return "image";
  }
  // Word documents (OneNote "Save as Word" export) and HTML pages
  // (OneNote "Save as" HTML export) — both structured text imports.
  if (name.endsWith(".docx")) return "docx";
  if (file.type.startsWith("text/html") || /\.html?$/i.test(name)) return "html";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown|csv|json|log|ya?ml)$/i.test(name)) {
    return "text";
  }
  return "unknown";
}

/** Keep only files actually referenced by image elements (drop orphans). */
export function sanitizeScene(payload: ScenePayload): ScenePayload {
  const usedFileIds = new Set<string>();
  for (const el of payload.elements as Array<{ type?: string; fileId?: string | null }>) {
    if (el?.type === "image" && el.fileId) usedFileIds.add(el.fileId);
  }
  const files: ScenePayload["files"] = {};
  for (const [id, f] of Object.entries(payload.files)) {
    if (usedFileIds.has(id) && f?.dataURL) files[id] = f;
  }
  return { elements: payload.elements, files };
}

/** Safe filename from a page title. */
export function titleToFilename(title: string, ext: string): string {
  const base =
    title
      .replace(/[^\w\d\-. ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled";
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
