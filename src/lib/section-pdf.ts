"use client";

/**
 * Export a WHOLE SECTION as one paginated PDF (issue #344) — OneNote
 * "Export notes as a PDF (Section)" parity, wave 21 of the product-parity
 * direction.
 *
 * Evidence (majors pass, 2026-11-23): OneNote's File > Export offers an
 * "Export Current" scope of Page / Section / Notebook, saved as a static
 * snapshot ("Any changes you make later in OneNote won't get changed in
 * the PDF" — support.microsoft.com, "Export notes from OneNote as a PDF");
 * Joplin prints PDFs per note only (multi-note export is JEX / Markdown —
 * joplinapp.org/help/apps/import_export), so the section leg is OneNote-only
 * parity. Until this wave, exporting a section here meant exporting its
 * pages one by one.
 *
 * Design: every ALIVE page of the section, in sidebar order, flows into ONE
 * document through the shared render core (pdf-sheet-render.ts) — each page
 * starts on a fresh A4 sheet, per-page paper style (plain / ruled / grid) is
 * honored, empty pages render as blank sheets with their footer, and the
 * footer sheet counter runs 1..N across the whole document. The export is a
 * static snapshot: READ-ONLY — no data-model change, no sync surface, the
 * scenes come straight from the persisted store (getPageContent).
 */
import { downloadBlob, titleToFilename } from "./excalidraw-utils";
import { ExportError } from "./export-errors";
import { renderPdfDocument, type PdfOrientation, type PdfRenderResult } from "./pdf-sheet-render";
import { getPageContent, listPages } from "./notes-db";
import { isPageBackground } from "./types";
import { selectSectionPages } from "./section-tree";

/**
 * Export every alive page of `sectionId` as ONE paginated PDF and download
 * it as `<section name>.pdf`. Throws ExportError (code "emptySection") when
 * the section has no pages at all; pages WITHOUT ink render as blank
 * sheets (OneNote exports empty pages too — the footer keeps the title).
 */
export async function exportSectionPdf(
  sectionId: string,
  sectionName: string,
  orientation: PdfOrientation,
): Promise<PdfRenderResult> {
  const rows = selectSectionPages(await listPages(), sectionId);
  if (!rows.length) {
    throw new ExportError("Nothing to export — this section has no pages yet.", "emptySection");
  }
  const contents = await Promise.all(rows.map((r) => getPageContent(r.id)));
  const inputs = rows.map((r, i) => ({
    title: r.title,
    background: isPageBackground(r.background) ? r.background : "plain",
    elements: contents[i]?.elements ?? [],
    files: contents[i]?.files ?? null,
  }));
  const result = await renderPdfDocument(inputs, orientation);
  downloadBlob(result.blob, titleToFilename(sectionName, "pdf"));
  return result;
}
