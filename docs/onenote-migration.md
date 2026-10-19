# Migrating from OneNote

OneNote stores notebooks in the proprietary, binary `.one` format, which is
not documented for external tools. The practical migration path is therefore
**export from OneNote → import into InfiniteNote**. This guide covers what
works today (phase 1) and what is planned (phase 2).

## TL;DR

| You have | Do this | Comes in as |
|---|---|---|
| Single pages or whole sections | OneNote → *File → Export → Word document* (`.docx`), then drag the file onto an InfiniteNote page | Structured text blocks (headings, lists, tables) |
| Pages with formatting you want as documents | OneNote → *File → Export → Page* (`.html`), then import | Structured text blocks |
| Whole notebooks (many pages) | Export section by section; create one InfiniteNote page per exported page | Same as above |
| PDFs | OneNote → *File → Export → PDF*, or use any PDF | A printout image per PDF page |
| `.one` / `.onepkg` files | Not supported yet — see phase 2 | — |

## Importing Word documents (`.docx`)

1. In OneNote (Windows desktop app), select a page — or multiple pages — and
   choose **File → Export → Current Page → Word document**.
   To export a whole section, right-click the section tab → *Export*.
2. Open InfiniteNote, navigate to (or create) the page you want the content on.
3. Click **Import → Images, PDF, Word, HTML, text…** and pick the `.docx`
   file — or simply drag it onto the canvas.

What is preserved:

- Headings and the document title (rendered as larger text)
- Paragraph text, hard line breaks
- Bullet and numbered lists, including nesting
- Tables (each row becomes a `cell | cell` text block)
- All text content and entities; ordering matches the document

What is flattened:

- Inline character formatting (bold/italic) — Excalidraw text is plain
- Images embedded in the document (phase 2)
- Custom fonts and colors

## Importing OneNote-exported HTML

1. In OneNote, choose **File → Export → Current Page → Single File Web Page**
   (`.mht`) or **Web Page** (`.html` / folder with assets).
   Phase 1 supports the plain `.html` variant; `.mht` is phase 2.
2. Import the `.html` file the same way (picker or drag & drop).

What is preserved: headings, paragraphs, line breaks, nested bullet and
numbered lists, table rows, and text entities. Images (which OneNote emits
as separate files or data URIs) are phase 2.

## Tips for large notebooks

- Export one section at a time; OneNote's exporter handles that more
  reliably than whole-notebook exports.
- In InfiniteNote, mirror your OneNote structure: one notebook per OneNote
  notebook, one section per section, one page per page. The sidebar's
  inline rename (double-click) makes tidying names quick.
- Use **Export → Full backup (.json)** after each import session so you
  always have a restorable snapshot.

## Phase 2 (planned)

- `.mht` (MIME HTML) single-file pages — the most common OneNote HTML export
- Embedded images from `.docx` and HTML exports
- A Microsoft Graph export script (documented runbook) that walks your
  entire OneNote account via the official API and produces a backup that
  InfiniteNote can restore — the cleanest path for large migrations
- `.one` / `.onepkg` investigation for offline, non-Cloud notebooks

Track progress in [docs/ROADMAP.md](ROADMAP.md) and the v1.1 milestone.
