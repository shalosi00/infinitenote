"use client";

/**
 * Export a WHOLE NOTEBOOK as one paginated PDF (issue #351) — OneNote
 * "Export notes as a PDF (Notebook)" parity, wave 22 of the product-parity
 * direction and the phase-2 candidate the wave-21 docs named
 * ("notebook-level export with section divider sheets").
 *
 * Evidence (majors pass, carried from wave 21 + this cycle's refresh):
 * OneNote's desktop File > Export offers an "Export Current" scope of
 * Page / Section / Notebook, saved as a static snapshot ("Any changes you
 * make later in OneNote won't get changed in the PDF" — support.microsoft.com,
 * "Export notes from OneNote as a PDF"; learn.microsoft.com's answers thread
 * spells out the three-scope flow). Joplin prints PDFs per note only (its
 * multi-note export is JEX / Markdown — joplinapp.org). Until this wave,
 * exporting a notebook here meant exporting its sections one by one.
 *
 * Design: every ALIVE section of the notebook, in sidebar order
 * (selectNotebookExportSections — depth-first, sections inside section
 * groups export at their sidebar position, group containers never get a
 * divider of their own), flows into ONE document through the shared render
 * core (pdf-sheet-render.ts). Each section OPENS ON A DIVIDER SHEET (the
 * pure builder lives in notebook-divider.ts — the wave-21 lesson keeps the
 * Dexie-reading adapter away from the headless-tested builder) — section
 * name, color accent bar in the effective section color (override or
 * notebook inheritance, issue #319), page count, and the parent group name
 * when the section lives in one — then every alive page of the section
 * continues on fresh A4 sheets: per-page paper style honored, pages without
 * ink render as blank footer-carrying sheets, the footer sheet counter runs
 * GLOBAL 1..N across the whole document (dividers included). Empty sections
 * still get their divider — OneNote exports empty sections too. The export
 * is a static snapshot: READ-ONLY — no data-model change, no sync surface,
 * the scenes come straight from the persisted store (listNotebooks /
 * listSections / listPages / getPageContent).
 */
import { downloadBlob, titleToFilename } from "./excalidraw-utils";
import { ExportError } from "./export-errors";
import {
  renderPdfDocument,
  type PdfOrientation,
  type PdfRenderResult,
  type PdfSceneInput,
} from "./pdf-sheet-render";
import { getPageContent, listNotebooks, listPages, listSections } from "./notes-db";
import { isPageBackground, type Notebook } from "./types";
import { sectionColorHex } from "./section-colors";
import { isSectionGroup } from "./section-groups";
import { plural } from "./plural";
import { selectNotebookExportSections, selectSectionPages } from "./section-tree";
import { buildSectionDivider } from "./notebook-divider";

/**
 * Export every alive section (and its alive pages) of `notebookId` as ONE
 * paginated PDF and download it as `<notebook name>.pdf`. Throws
 * ExportError (code "emptyNotebook") when the notebook has no alive
 * sections at all; sections WITHOUT pages still open on their divider
 * sheet (OneNote exports empty sections too — the footer keeps the name).
 */
export async function exportNotebookPdf(
  notebookId: string,
  notebookName: string,
  orientation: PdfOrientation,
): Promise<PdfRenderResult> {
  const [notebooks, sections, pages] = await Promise.all([
    listNotebooks(),
    listSections(),
    listPages(),
  ]);
  const notebook = notebooks.find((n) => n.id === notebookId);
  const rows = selectNotebookExportSections(sections, notebookId);
  if (!rows.length) {
    throw new ExportError(
      "Nothing to export — this notebook has no sections yet.",
      "emptyNotebook",
    );
  }
  const colorSource: Pick<Notebook, "color"> = notebook ?? { color: "violet" };
  const inputs: PdfSceneInput[] = [];
  for (const section of rows) {
    const secPages = selectSectionPages(pages, section.id);
    const parent = section.parentId
      ? sections.find((g) => g.id === section.parentId && !g.deletedAt)
      : null;
    inputs.push(
      buildSectionDivider({
        sectionName: section.name,
        colorHex: sectionColorHex(section, colorSource),
        pageCount: secPages.length,
        groupName: parent && isSectionGroup(parent) ? parent.name : null,
      }),
    );
    const contents = await Promise.all(secPages.map((p) => getPageContent(p.id)));
    for (let i = 0; i < secPages.length; i++) {
      const bg = secPages[i].background;
      inputs.push({
        title: secPages[i].title,
        background: isPageBackground(bg) ? bg : "plain",
        elements: contents[i]?.elements ?? [],
        files: contents[i]?.files ?? null,
      });
    }
  }
  const result = await renderPdfDocument(inputs, orientation);
  downloadBlob(result.blob, titleToFilename(notebookName, "pdf"));
  return result;
}
