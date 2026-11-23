# Test plan — export notebook as PDF (issue #351, wave 22)

OneNote "Export notes as a PDF (Notebook)" parity: the notebook actions menu
gains "Export as PDF" → A4 portrait / A4 landscape — every ALIVE section of
the notebook opens on a divider sheet (section name, page count, color
accent bar, parent group name when nested), then every ALIVE page of the
section flows on fresh A4 sheets — ONE paginated document, GLOBAL footer
sheet counter (dividers included). Read-only: zero data-model change, zero
sync surface.

## Evidence (majors pass)

- OneNote desktop File > Export, "Export Current" = Page / Section /
  Notebook, PDF format, static snapshot — "Any changes you make later in
  OneNote won't get changed in the PDF"
  (support.microsoft.com, "Export notes from OneNote as a PDF";
  learn.microsoft.com/answers spells out the three-scope flow).
- Joplin prints PDFs per note only; its multi-note export is JEX/Markdown
  (joplinapp.org/help/apps/import_export) — the notebook leg is OneNote-only
  parity. Until this wave, exporting a notebook here meant exporting its
  sections one by one (issue #344 shipped the section leg).

## Design pins (unit — `src/lib/__tests__/notebook-pdf.test.ts`)

| Pin | Expectation |
|---|---|
| select-order | `selectNotebookExportSections` walks the sidebar depth-first: top-level sections in `order`, a group's children export at the group's sidebar position, group containers are never entries, trashed rows and foreign-notebook rows are excluded |
| orphans | a plain section whose parent row is missing/trashed still exports — appended after the visible tree in sibling order (an export never silently drops pages) |
| cycle-safety | a corrupted `parentId` loop terminates; both members still export |
| empty policy | an empty notebook selects nothing → the exporter turns it into `emptyNotebook` |
| divider | `buildSectionDivider` carries the section name as the sheet title (footer), prints name + pluralized page count + color accent bar (fill = stroke = effective color hex), plain background |
| group line | the divider names the parent section group only when the section lives in one |
| assembly | divider + tall page (5 sheets) + divider + blank page = 8 portrait sheets, `pdfPageCount` 8, global footer numbering "1 / 8" … "8 / 8", markers and footers inflate out of the streams |
| landscape | divider + tall page (11) + divider = 13 landscape sheets |
| typed error | `emptyNotebook` message: "Nothing to export — this notebook has no sections yet.", stable code |

The divider builder lives in the PURE `notebook-divider.ts` (no notes-db
import) — the wave-21 lesson: a Dexie module-scope instantiation in a test
import chain poisons every db-sharing test file.

## E2E (`e2e/notebook-pdf-export.spec.ts`, 4 checks)

Seed: Welcome Notebook / Getting Started / "Start here"; Welcome Notebook /
Ideas / "Brainstorm"; My Notebook / New Section / "Page 1".

| Check | Flow |
|---|---|
| NP-N01 | inject the deterministic 40-line tall scene into "Start here" (5 portrait sheets), export Welcome Notebook portrait → `Welcome-Notebook.pdf`, exactly 8 pages (divider + 5 + divider + 1 blank), inflated text carries both section names, "1 page", the marker text, the blank page's footer "Brainstorm", global numbering "1 / 8" + "8 / 8" |
| NP-N02 | export My Notebook landscape → `My-Notebook.pdf`, exactly 2 pages (divider + 1), divider name "New Section", numbering "1 / 2" + "2 / 2" |
| NP-N03 | trash "Brainstorm" via its page menu → next Welcome Notebook export is 7 pages, the trashed page's footer is gone while its SECTION still exports empty on its divider ("Ideas", "0 pages") |
| NP-N04 | trash My Notebook's only section → notebook export surfaces the typed "Nothing to export" toast and NO download event fires |

Console-error collector pinned across the whole serial run (helpers pattern);
Radix submenu driven by hover → waitFor → click; scenes flushed with the
`saveNow` hook before any export; stacked toasts filtered by text.

## Non-goals

- Notebook-level export does not include page versions (local-only, like the
  sync folder) and does not touch the trash.
- OneNote's web app cannot export notebooks to PDF at all (its export is a
  OneNote package on personal OneDrive) — no web-parity candidate exists.
