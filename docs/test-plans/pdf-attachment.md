# Test plan — OneNote-style PDF file attachments (printout icon + context menu)

Feature: when a PDF is inserted as a printout, a small **file-icon chip**
lands on the canvas above the rendered pages, showing the PDF's file name.
Right-clicking the chip opens a context menu with **multiple options** —
View file, Download file, Copy file name. The chip keeps the ORIGINAL PDF
bytes embedded in the scene, so the exact file can be downloaded back at
any time, even after a reload (offline-first: no copy of the file exists
anywhere else).

Status: **planned, TDD** — tests first (red), then implementation (green).

Follow-up to #155 (PDF printouts, `docs/test-plans/ocr.md`) and the audio
embeddables of issue #67, whose proven patterns this feature mirrors:

| Aspect | Decision |
|---|---|
| Scene element | Excalidraw **embeddable** (the audio-block pattern): moves/zooms/exports/selects like any element, and its `customData` survives scene restore while `link` carries a marker scheme that survives `sanitizeUrl` |
| Marker | `link: "infinitenote:pdf"` — accepted by the canvas's `validateEmbeddable` gate next to `infinitenote:audio`; nothing else may mount |
| Payload | `customData: { pdfName: string, pdfData: data:application/pdf;base64,… }` — the ORIGINAL file bytes; NOT in `scene.files` (the sanitizer drops files only image elements reference) |
| Placement | Chip at the insert anchor, printout pages directly below it (chip height + 24 px); chip and pages go into ONE `updateScene` call, so a single undo removes the whole import |
| Size cap | `MAX_PDF_ATTACHMENT_BYTES = 10 MiB` inclusive (audio's issue-#91 stance, sized for documents): bigger files still import as a printout, but WITHOUT the embedded copy + a skip toast — a multi-hundred-MB base64 payload must never blow the IndexedDB quota (nor multiply into the 25-version history) |
| Hit-testing | Right-click is intercepted in the **capture phase** on the canvas wrapper: client → scene coords via Excalidraw's `viewportCoordsToSceneCoords`, then a rotation-exact rectangle test against every live pdf-attachment element (topmost z-order wins). React bubbles `onContextMenu` at the app root, so a capture listener on the wrapper provably fires first; `stopPropagation` keeps Excalidraw's own context menu from appearing |
| Menu | Minimal fixed-position menu (role=menu) with three items: **View file** (blob URL in a new tab — browser/PWA; best-effort in the Tauri shell), **Download file** (byte-exact original via the proven `downloadBlob`), **Copy file name** (clipboard + toast). Closes on Escape, click-away, wheel/pan, or a contextmenu that misses the chip |
| Search | `extractSearchableText` emits `customData.pdfName` (audio-name parity) — "contract" finds the page holding contract.pdf |
| Version history | No changes: snapshots store the full scene JSON, so the chip (and its payload) rides along in every version and survives restore |
| Non-goals | No rename/delete-file menu actions (Excalidraw's own menu already deletes the element), no attachment chip for non-PDF files, no cloud re-fetch (there is no cloud) |

## Unit tests — `src/lib/__tests__/pdf-attachment.test.ts`

### Marker & payload extraction

| ID | Assertion |
|---|---|
| ATT-P01 | `isPdfAttachmentLink("infinitenote:pdf")` is true; `"infinitenote:pdf:xyz"` (suffix tolerated) is true; `"infinitenote:audio"`, `"https://…"`, `""`, `null`, `undefined` are false |
| ATT-P02 | `pdfAttachmentOf` on a well-formed chip (type `embeddable`, marker link, `customData.pdfName` + valid pdf dataURL) returns `{ id, name, dataUrl }` |
| ATT-P03 | `pdfAttachmentOf` returns null for: non-embeddable type, marker link without customData, missing/blank/non-string `pdfName`, `pdfData` that is not a `data:application/pdf` URL, a soft-deleted tombstone, and a `null` element |
| ATT-P04 | `pdfDataUrlToBlob` decodes base64 byte-exactly (round-trips a real binary buffer containing 0x00/0xFF/high bytes) and stamps `type: "application/pdf"` |
| ATT-P05 | `pdfDataUrlToBlob` throws on: a non-data URL, an `image/png` data URL, and malformed base64 — callers catch and toast |

### Import size cap

| ID | Assertion |
|---|---|
| ATT-P10 | `isPdfAttachmentTooLarge(10 * 1024 * 1024)` is false — the cap is inclusive |
| ATT-P11 | `isPdfAttachmentTooLarge(10 * 1024 * 1024 + 1)` is true |
| ATT-P12 | `0`, `1` and typical document sizes (2095 bytes, the e2e fixture) are false |

### Right-click hit-testing (scene coordinates)

| ID | Assertion |
|---|---|
| ATT-P20 | A scene point inside a chip's bounds returns that chip; points just outside each edge return null |
| ATT-P21 | Two overlapping chips: the element LATER in the array (topmost z-order) wins |
| ATT-P22 | Non-attachment elements (image, text, audio embeddable with `infinitenote:audio`) are never hit, even at points inside their bounds |
| ATT-P23 | A soft-deleted (`isDeleted: true`) chip is never hit |
| ATT-P24 | Rotation-exact: for a chip rotated 90°, a point inside the rotated rectangle but outside its axis-aligned bounding box HITS, and a point inside the bounding box but outside the rotated rectangle MISSES |
| ATT-P25 | A corrupt chip (zero or negative width/height) never hits |

### Toast lines (exact strings)

| ID | Assertion |
|---|---|
| ATT-P30 | `pdfPrintoutToast({rendered: 2, total: 2, attachment: "stored"}, "test.pdf")` ⇒ `Inserted PDF printout "test.pdf" (2 pages)` |
| ATT-P31 | Truncation: `{rendered: 20, total: 25, attachment: "stored"}` ⇒ `Inserted PDF printout "test.pdf" (first 20 of 25 pages) — the render cap is 20 pages` |
| ATT-P32 | Singular page: `{rendered: 1, total: 1, …}` ⇒ `… (1 page)` |
| ATT-P33 | `attachment: "skipped-large"` produces the SAME printout line (the printout itself did land, name and all) |
| ATT-P34 | `pdfAttachmentSkippedToast("big.pdf")` ⇒ `Skipped the file attachment for "big.pdf" — larger than 10 MB, too big to store reliably.` |

### Search integration (`src/lib/__tests__/search.test.ts` additions)

| ID | Assertion |
|---|---|
| ATT-S01 | An embeddable chip's `pdfName` is emitted as searchable content |
| ATT-S02 | A blank/whitespace `pdfName` is NOT emitted (no empty haystack entries) |
| ATT-S03 | A non-embeddable element carrying `pdfName` in customData is NOT emitted (audio-rule parity) |
| ATT-S04 | End-to-end index+rank: a page whose ONLY content is a chip is found by `searchIndex("quarterly")` and the snippet carries the file name |

## E2E — `e2e/pdf-attachment.spec.ts` (serial; real canvas, no mocks)

| ID | Scenario |
|---|---|
| PA-E01 | Import `test.pdf` (uploaded as `quarterly-report.pdf`) on a fresh page → scene = 2 printout images + 1 embeddable; serialized: `link === "infinitenote:pdf"`, `customData.pdfName === "quarterly-report.pdf"`, `pdfData` starts with `data:application/pdf;base64,` |
| PA-E02 | The chip renders on-canvas: badge + file name visible (`data-testid="pdf-attachment-chip"`, `pdf-attachment-name`) |
| PA-E03 | Right-click on the chip → the attachment menu opens with all three items (View file / Download file / Copy file name) |
| PA-E04 | Escape closes the menu; a right-click on empty canvas NEVER opens it |
| PA-E05 | Download file → a Playwright download event fires with `suggestedFilename === "quarterly-report.pdf"` and the saved bytes are BYTE-IDENTICAL to the uploaded fixture (round-trip proof) |
| PA-E06 | Copy file name → toast `Copied "quarterly-report.pdf" to the clipboard.` |
| PA-E07 | View file → a popup page opens with a `blob:` URL |
| PA-E08 | Reload → chip element AND its payload survive (serialize + visible chip) |
| PA-E09 | Ctrl+K search for `quarterly` finds the page via the embedded file name |
| PA-E10 | An oversized (10 MB+) valid PDF imports as a printout WITHOUT a chip: 1 image, 0 embeddables, printout toast + skip toast both visible |
| PA-E11 | OCR tie-in: run recognition on the imported printout → search `PRINTOUT` (text printed on the fixture pages) finds the page |

Oversized fixture is generated in-spec: a minimal valid 1-page PDF whose
content stream is padded past 10 MiB with whitespace (legal PDF tokens),
so pdfjs parses it like any real document.

## Non-goals (documented on purpose)

- No progress UI on download (browser takes over).
- No chip for image/audio/text imports (they already keep their data).
- No "open printout at page N" action — the printout is right below the
  chip on the canvas.
