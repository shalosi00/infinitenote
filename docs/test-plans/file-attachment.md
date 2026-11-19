# Test plan — general file attachments (OneNote "Insert > File Attachment" parity)

Feature: ANY file — zip, spreadsheet, source file, anything — can be
**attached to a page** through the Import menu's new "File attachment
(any file)…" item, or simply dropped onto the canvas even when no importer
handles it. The file lands as a **file chip** (extension badge + name +
human-readable size) that keeps the ORIGINAL bytes embedded in the scene,
so the exact file can be viewed or downloaded back at any time, even after
a reload (offline-first: no copy of the file exists anywhere else).

Status: **shipped** — issue #278; generalizes the shipped PDF-chip pattern
(docs/test-plans/pdf-attachment.md) rather than adding new machinery.

| Aspect | Decision |
|---|---|
| Scene element | Excalidraw **embeddable** (the audio/PDF pattern): `link: "infinitenote:file"` marker scheme, `customData: { fileName, fileData, fileSize, fileMime }` carries the ORIGINAL bytes as a data: URL plus the recorded MIME and byte size |
| Entry points | (1) Import menu → **File attachment (any file)…** — a picker with NO `accept` restriction (that is the feature); (2) **drag-drop / import input of any file `classifyFile` calls "unknown"** — previously a dead end ("Some files were skipped (unsupported type)"), now an attachment. Both routes go through `attachFiles` |
| Attach ≠ printout | A PDF dropped on the canvas keeps the shipped printout + red PDF chip flow; a PDF picked through the explicit attach path embeds as a plain generic chip with NO printout pages (OneNote's own split: drop may convert, Insert > File Attachment never does) |
| Size cap | `MAX_FILE_ATTACHMENT_BYTES = 10 MiB` inclusive (the PDF/audio stance — the payload rides every autosave, snapshot and sync copy); oversize = explicit skip toast, no scene mutation |
| Chip | Neutral slate styling (stroke `#475569`, background `#f1f5f9`) distinct from the red PDF chip; badge = uppercased extension capped at 4 chars ("ZIP", "DOCX", "GZ"), fallback "FILE"; name truncated; right-aligned human size (`formatFileSize`: 1024-based B/KB/MB/GB, one decimal below 10 of a unit) |
| Menu | The SAME three-item menu as PDF chips — View file / Download file / Copy file name — now fed by a combined hit-test over both kinds (`hitTestAttachment`); the blob decodes with the URL's own MIME (`fileDataUrlToBlob`) |
| Undo | ONE `updateScene` per attach batch; no programmatic selection (the HWR-E05/E06 focus-race lesson). Excalidraw coalesces consecutive history snapshots, so several rapid batches may share one undo entry — the honest contract is "undo removes the attach" (FA-E15), not "one press per batch" |
| Search | `extractSearchableText` emits `customData.fileName` (audio/PDF-name parity) — "archive" finds the page holding archive.zip |
| MIME honesty | Files with an empty MIME (common for drag-dropped unknown types) store `application/octet-stream`; `withFileMime` rebuilds the octet-stream default to the recorded MIME and preserves URL params |
| Version history / exports | No changes: snapshots store the full scene JSON, so the chip rides along in every version; the chip exports as a vector rectangle + its badge/name live in the DOM overlay, same as PDF chips |
| Non-goals | No previewing arbitrary formats on canvas (the chip IS the interface), no Office-object embedding, no size-lifting, no rename/delete menu actions (Excalidraw's own menu already deletes the element), supported importers (docx/html/mht/text/…) keep their conversion routes |

## Unit tests — `src/lib/__tests__/file-attachment.test.ts` (+ `-edges`)

### Marker & payload extraction

| ID | Assertion |
|---|---|
| ATT-F01 | `isFileAttachmentLink("infinitenote:file")` true, suffix tolerated; `"infinitenote:pdf"`, `"infinitenote:fil"`, `"infinitenote:files"`, URLs, data URLs, null/undefined false |
| ATT-F02 | `MAX_FILE_ATTACHMENT_BYTES` is 10 MiB; `isFileAttachmentTooLarge` inclusive at the cap, true +1 |
| ATT-F03 | `isFileDataUrl` accepts base64 data URLs of any MIME (incl. empty MIME); rejects non-data URLs, URL-encoded payloads, empty payloads |
| ATT-F04 | `withFileMime` keeps a real MIME verbatim, rebuilds the octet-stream default (and empty MIME) to the recorded MIME preserving params, falls back to octet-stream, returns null for non-data URLs |
| ATT-F05 | `fileAttachmentOf` extracts `{ id, name, dataUrl, mime, size }` from a well-formed chip; rejects tombstones, wrong types, marker misses, and corrupt customData field-by-field (missing/blank name, missing/non-data payload, missing MIME/blank MIME, missing/negative/NaN size); accepts size 0 and octet-stream |
| ATT-F06 | `fileDataUrlToBlob` round-trips bytes exactly and stamps the URL's MIME; empty-MIME URLs become octet-stream; throws on non-base64 URLs |
| ATT-F07 | `formatFileSize`: 0/1/1023 → B; whole KiB/MB without decimals (4096 → "4 KB"); fractional with one decimal (5000 → "4.9 KB", 2,400,000 → "2.3 MB"); GB; NaN/negative → "0 B" |
| ATT-F08 | `fileBadgeLabel`: "archive.zip" → ZIP, "report.docx" → DOCX, last extension wins ("bundle.tar.gz" → GZ), 4-char cap ("w.three1" → THRE), no extension/dot-only/non-alnum → FILE |
| ATT-F09 | Toast lines exact: skip toast names the file + cap; `fileAttachedToast` pluralizes |
| ATT-F10 | Chip geometry matches the PDF strip (280×44) |

### Edges (`file-attachment-edges.test.ts`)

| ID | Assertion |
|---|---|
| ATT-FE01 | `hitTestAttachment` hits a generic chip inside bounds, is rotation-exact (90° chip hit inside the rotated strip, miss inside the unrotated box), misses +1 off each edge, never hits corrupt geometry |
| ATT-FE02 | Mixed scenes: PDF chips report kind=pdf, generic chips kind=file; overlapping chips resolve by topmost z-order ACROSS kinds; tombstones / non-embeddables / corrupt chips are skipped but a valid chip underneath still hits |
| ATT-FE03 | `fileAttachmentOf` accepts anonymous elements (id → ""), huge finite sizes, octet-stream; rejects Infinity and negative fractional sizes |
| ATT-FE04 | Formatter boundaries: 1 MiB − 1 → "1024 KB", 10 KiB → "10 KB", 1.5 MiB → "1.5 MB"; badge with dotted names, digits ("x.7z" → 7Z), spaces |

## E2E — `e2e/file-attachment.spec.ts` (FA-E01…E15)

| ID | Behavior |
|---|---|
| FA-E01 | Picker input → toast "Attached 1 file", scene gains exactly one `infinitenote:file` embeddable with the original bytes/MIME/size |
| FA-E02 | Chip renders: badge "ZIP", name, exact byte size |
| FA-E03–E07 | Shared menu: three items; Escape/canvas-right-click close; Download round-trips byte-exact; Copy file name toasts + clipboard; View opens a blob: popup |
| FA-E08 | Reload: chip + payload persist |
| FA-E09 | Ctrl+K search finds the page by the attached file name |
| FA-E10 | 10 MiB + 1 KiB file → explicit skip toast, no new chip |
| FA-E11 | PDF via the explicit path: chip only, ZERO printout images, badge "PDF" |
| FA-E12 | Unsupported type through the IMPORT input (the old dead end) attaches |
| FA-E13 | Import menu → "File attachment (any file)…" drives the REAL file chooser |
| FA-E14 | Same menu item at phone width (390 px) |
| FA-E15 | Undo removes the attach (bounded presses; coalesced history never eats back past the first chip) |
