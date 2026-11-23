# Test plan — Export section as PDF (OneNote "Export notes as a PDF (Section)" parity)

Feature: the section actions menu gains "Export as PDF" (A4 portrait /
landscape) — every ALIVE page of the section, in sidebar order, flows into
ONE paginated A4 document (issue #344; wave 21 of the product-parity
direction, per the wave-20 pointer "further candidates from a fresh majors
evidence pass").

Basis: the wave-21 evidence pass (2026-11-23) — OneNote's "Export notes
from OneNote as a PDF" (support.microsoft.com): "On the page you want to
export, choose File > Export. Under **Export Current**, choose what you
want to export. Choose PDF (*.pdf) > Export"; the desktop app's
"Export Current" scope enumerates Page / Section / Notebook and a saved PDF
is a static snapshot ("Any changes you make later in OneNote won't get
changed in the PDF"); OneNote for the web is page-scoped only. Joplin is
the counter-example: PDF output is per-note print-to-PDF, multi-note export
is JEX / Markdown / HTML (joplinapp.org/help/apps/import_export) — no
section- or notebook-level PDF exists, so this leg is OneNote-only parity.
Until this wave, exporting a section here meant exporting its pages one by
one.

Status: **shipped to develop 2026-11-23 (releases with v1.21.0)** — all
evidence below is from actual runs.

## Design summary

| Aspect | Decision |
|---|---|
| Read-only | ZERO data-model change, zero sync surface — the export reads persisted scenes and writes nothing |
| Shared core | `src/lib/pdf-sheet-render.ts`: `PdfSceneInput {title, background, elements, files}` → `renderPdfDocument(pages, orientation)` → ONE jsPDF document. The proven issue-#20 band math (pdf-layout.ts) is untouched; `pdf-export.ts` becomes the thin canvas adapter feeding the live scene into the same core |
| Sheets | every input page starts on a fresh A4 sheet; its bands follow the deterministic pagination math (40-line scene → exactly 5 portrait / 11 landscape sheets, the numbers pinned since issue #20) |
| Blank pages | a page without printable ink renders as a blank sheet carrying paper + footer (OneNote exports empty pages the same way) — the CALLER decides whether that is an error: the page export throws "Nothing to export" before calling the core, the section export throws only when the section has NO pages at all (`ExportError` code `emptySection`) |
| Footer | the footer keeps the NOTE title per sheet (non-Latin titles rasterized, issue #84); the sheet counter is GLOBAL 1..N across the document — for a single-page export that equals the per-page band count, so the issue-#20 behavior is byte-compatible |
| Raster fallback | rotated shapes/images and rotated or non-Latin text rasterize exactly as before (issue #107 policy) — @excalidraw/excalidraw is loaded DYNAMICALLY inside the fallback so headless unit tests over pure vector scenes never pull the canvas runtime |
| Page order | `selectSectionPages` (pure, in `src/lib/section-tree.ts`): alive pages of the section sorted by `order`, ties broken by `createdAt` — deterministic |
| Paper style | each page's persisted `background` (plain / ruled / grid) is honored per sheet; absent fields default to plain |
| Scene source | persisted scenes via `getPageContent` — the LIVE canvas is not needed, so a section exports without opening its pages; the exporting section's pages are flushed by the normal autosave (the E2E flushes with the `saveNow` hook before exporting) |
| UI | the section menu (plain sections only — groups hold no pages) gains "Export as PDF" → "A4 portrait" / "A4 landscape"; toasts: "Exporting section to PDF…" → "Section PDF exported — N sheets."; errors map through `EXPORT_ERROR_MESSAGES` (issue #85) |
| Filename | `titleToFilename(section name, "pdf")` — the export-filename convention ("Getting Started" → "Getting-Started.pdf", CJK preserved) |
| Phase-2 candidate | notebook-level export with section divider sheets (OneNote's third scope) |

## Unit tests — `src/lib/__tests__/section-pdf.test.ts`

The render core runs HEADLESS under bun (verified by probe: jsPDF prints
page objects and the compressed streams inflate back to the vector text —
the proven zlib pattern). All band math is deterministic.

| ID | Assertion |
|---|---|
| SP-P1 | `selectSectionPages` keeps only the alive pages of the requested section, sorted by `order` (other sections and trashed pages excluded) |
| SP-P2 | equal `order` values tie-break by `createdAt` — the export order is deterministic |
| SP-P3 | two note pages (tall 40-line + single-line) render ONE document: sheetCount 6 portrait, `/Type /Page` objects = 6, both markers recovered from the inflated streams, both footer titles present, global numbering "1 / 6" … "6 / 6" |
| SP-P4 | the same pages in landscape re-paginate: 11 + 1 = 12 sheets |
| SP-P5 | a page without ink between two content pages renders as a blank sheet that keeps its footer title; sheetCount 5 + 1 + 1 = 7, "7 / 7" in the streams |
| SP-P6 | an empty page list is a typed `ExportError`, never an empty PDF |
| SP-P7 | `EXPORT_ERROR_MESSAGES.emptySection` carries the stable user-facing message; the `ExportError` carries code "emptySection" |

## E2E checks — `e2e/section-pdf-export.spec.ts`

| ID | Assertion |
|---|---|
| SP-N01 | a two-page section exports as ONE 6-sheet portrait PDF: filename "Getting-Started.pdf", %PDF header, 6 `/Type /Page` objects, both pages' markers AND the first page's footer title recovered from the inflated streams, global "1 / 6" / "6 / 6" numbering |
| SP-N02 | the same section exports landscape as ONE 12-sheet PDF (orientation re-paginates, same content) |
| SP-N03 | trashing the second page excludes it from the next export: 5 sheets, the second marker gone, the first still present |
| SP-N04 | an empty section surfaces the typed error toast ("Nothing to export — this section has no pages yet.") instead of a file; no download event ever fires |

Every test is SELF-CONTAINED in its serial flow (resets to the seed and
performs its own steps) — the wave-18 CI lesson. The scenes are flushed
with the `saveNow` hook before exporting because the section export reads
PERSISTED scenes, not the live canvas.

## Neighbors verified on the branch

pdf-export (the issue-#20 page path — byte-compatible), pdf-wave2,
export-filename, section-colors, section-groups, sub-sections — 22/22.
