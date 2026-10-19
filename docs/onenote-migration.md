# Migrating from OneNote

OneNote stores notebooks in the proprietary, binary `.one` format, which is
not documented for external tools. The practical migration path is therefore
**export from OneNote → import into InfiniteNote**. This guide covers every
supported path (phase 1 + 2).

## TL;DR

| You have | Do this | Comes in as |
|---|---|---|
| Single pages or whole sections | OneNote → *File → Export → Word document* (`.docx`), then drag the file onto an InfiniteNote page | Structured text blocks (headings, lists, tables) |
| Pages with formatting you want as documents | OneNote → *File → Export → Page* (`.html`), then import | Text blocks + embedded images |
| Single-file web page exports | OneNote → *File → Export → Single File Web Page* (`.mht`), then import | Text blocks + embedded images |
| Whole notebooks (many pages) | **Microsoft Graph export script** (below) or export section by section | Same as above |
| PDFs | OneNote → *File → Export → PDF*, or use any PDF | A printout image per PDF page |
| `.one` / `.onepkg` files | Not supported — use one of the paths above instead | — |

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
- Custom fonts and colors

## Importing OneNote-exported HTML (`.html`)

1. In OneNote, choose **File → Export → Current Page → Web Page** (`.html`).
2. Import the file the same way (picker or drag & drop).

What is preserved: headings, paragraphs, line breaks, nested bullet and
numbered lists, table rows, text entities, and **images with `data:` URLs**
(self-contained pages — Graph exports and most "Web Page, filtered" saves).

## Importing single-file web pages (`.mht`) — phase 2

`.mht` (MIME HTML) is OneNote's most convenient per-page export: **one file
that contains the HTML and every image**, base64- or quoted-printable-encoded.

1. In OneNote, choose **File → Export → Current Page → Single File Web Page**
   (`.mht`).
2. Import the `.mht` file (picker or drag & drop) — no other files needed.

What is preserved:

- Everything from the HTML import above
- **Embedded images**, placed in their document position between the text
  blocks, with their authored width/height when present
- `Content-Location` image matching (exact, percent-decoded, basename and
  `cid:` forms all resolve)

What is flattened: inline character formatting, custom fonts and colors,
audio/video attachments.

## Whole notebooks: Microsoft Graph export runbook

For more than a handful of pages, use the official API instead of clicking
through OneNote's export dialogs. `scripts/graph-export.mjs` walks every
notebook → section → page you can see, downloads each page's HTML plus its
image resources, inlines the images as `data:` URLs and writes one
self-contained `.html` per page — exactly what the InfiniteNote importer
eats.

### 1. Get an access token

1. Open <https://developer.microsoft.com/graph/graph-explorer> and sign in
   with the Microsoft account that owns the notebooks.
2. In the *Sample queries* panel pick any `me/onenote/notebooks` request (or
   paste `https://graph.microsoft.com/v1.0/me/onenote/notebooks` into the
   request box) and run it once — this ensures the **Notes.Read** permission
   is consented.
3. Open the *Access token* tab and copy the token (valid ~1 hour).

### 2. Run the export

```bash
# all notebooks
node scripts/graph-export.mjs --token <ACCESS_TOKEN> --out onenote-export

# only notebooks whose name contains "Work" or "Personal"
node scripts/graph-export.mjs --token <ACCESS_TOKEN> --notebooks "Work,Personal"
```

Output layout:

```
onenote-export/
  <notebook>/<section>/<page title>.html
```

The script throttles itself politely, retries on Graph 429/503 (honoring
`Retry-After`), and never touches `.one` binaries — pages come out as HTML.

### 3. Import into InfiniteNote

1. Open (or create) the page that should hold the content.
2. Drag the exported `.html` files onto the canvas — or use
   **Import → Images, PDF, Word, HTML, text…** and multi-select them.
   Each file lands as text blocks + images below existing content, so you
   can import several pages onto one canvas, or one page at a time.
3. Mirror your OneNote structure in the sidebar, then take a
   **Export → Full backup (.json)** snapshot when you're happy.

### Troubleshooting

- **401 Unauthorized** — the token expired (~1 hour). Generate a fresh one.
- **429 throttled** — the script waits and retries on its own; large
  accounts may take a while. Keep the token valid for the whole run, or
  re-run per notebook with `--notebooks`.
- **Some images missing** — OneNote sometimes references resources the API
  doesn't list; the page text still imports.
- **Personal OneNote (no Microsoft account)?** The Graph path needs a cloud
  account — use the per-page `.mht` / `.docx` exports instead.

## Tips for large notebooks

- Export one section at a time (manual path) — OneNote's exporter handles
  that more reliably than whole-notebook exports.
- In InfiniteNote, mirror your OneNote structure: one notebook per OneNote
  notebook, one section per section, one page per page. The sidebar's
  inline rename (double-click) makes tidying names quick.
- Use **Export → Full backup (.json)** after each import session so you
  always have a restorable snapshot.

## Not yet supported

- `.one` / `.onepkg` offline archives — no public format documentation;
  re-export from the OneNote app instead.
- Ink (handwriting) strokes from OneNote pages — these arrive as part of
  rendered images at best; native ink translation is a research topic.

Track progress in [docs/ROADMAP.md](ROADMAP.md).
