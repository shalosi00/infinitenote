"use client";

/**
 * Print-friendly paginated PDF export (issue #20) — the canvas adapter.
 *
 * The rendering itself lives in pdf-sheet-render.ts (data-driven, shared
 * with the section-level export — OneNote "Export notes as a PDF (Section)"
 * parity, issue #344). This adapter gathers the LIVE scene from the open
 * canvas (so unsaved edits are included) and hands it to the shared core.
 *
 * Always exports on light paper, regardless of the app theme.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PageBackground } from "./types";
import { downloadBlob, titleToFilename } from "./excalidraw-utils";
import {
  renderPdfDocument,
  filterInkElements,
  type PdfFiles,
} from "./pdf-sheet-render";
import { ExportError } from "./export-errors";

export type { PdfOrientation } from "./pdf-sheet-render";

// re-exported for callers that already import from this module
export { ExportError, rasterizeFooterTitle } from "./pdf-sheet-render";

export async function exportPagePdf(
  api: ExcalidrawImperativeAPI,
  title: string,
  orientation: import("./pdf-sheet-render").PdfOrientation,
  background: PageBackground,
  pageColor?: import("./types").PageColor | null
): Promise<void> {
  const elements = filterInkElements(api.getSceneElements());
  if (!elements.length) {
    throw new ExportError("Nothing to export — the page is empty.");
  }

  const files = api.getFiles();
  const { blob } = await renderPdfDocument(
    [{ title, background, pageColor: pageColor ?? null, elements, files: files as unknown as PdfFiles }],
    orientation,
  );
  downloadBlob(blob, titleToFilename(title, "pdf"));
}
