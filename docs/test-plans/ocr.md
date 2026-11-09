# Test plan — OCR for Images & PDF Printouts

Feature: on-device OCR (tesseract.js, vendored — no CDN, no network) makes
imported images and PDF-printout pages full-text searchable via Ctrl+K.

Status: **planned, TDD** — tests first (red), then implementation (green).

## Design summary

| Aspect | Decision |
|---|---|
| Engine | tesseract.js **6.0.1** UMD, loaded lazily via `<script>` from `/ocr/` — never bundled, so webpack/Next can never break worker resolution |
| Assets (vendored, `public/ocr/`) | `tesseract.min.js` (63 KB), `worker.min.js` (111 KB), `core/tesseract-core-simd-lstm.wasm.js` + `core/tesseract-core-lstm.wasm.js` (≈ 3.95 MB each — SIMD + fallback for older WebKitGTK), `lang/eng.traineddata.gz` (1.98 MB, tessdata 4.0.0_fast) |
| Offline story | Service worker gets a `"/ocr/"` static prefix (cache-first, runtime fill) — first use caches the engine for life; no CDN at any point, matching the F-Droid/TWA offline stance |
| Trigger | Explicit "Recognize text in images" item in the Page-actions (⋯) menu — predictable cost, no surprise CPU burn |
| Data flow | flushSave → read page content → OCR every image element's file dataURL → attach `customData.ocrText` (+ `ocrAt`) → write back → canvas remount (sync-proven path) |
| Search | `extractSearchableText` additionally emits image `customData.ocrText` — OCR text becomes content: matches AND snippets |
| Storage cap | Recognized text normalized (whitespace collapsed) and capped at 20 000 **code points** (surrogate-safe, issue #101 parity) |
| Errors | Typed `OcrError` ("load-failed" / "init-failed" / "recognize-failed") with English messages; per-image failures never abort the batch |
| E2E determinism | Real tesseract against a committed fixture PNG with crisp uppercase words — the full wasm path runs in CI, no mocks |

Unit tests never spin up the real wasm engine: the orchestrator
(`recognizeAllImages`) takes an **injected** `recognize` function, so all
data-flow logic is tested with fakes; the real engine is proven by the E2E.

## Unit tests — `src/lib/__tests__/ocr.test.ts`

### `normalizeOcrText`

| ID | Assertion |
|---|---|
| OCR-P01 | `\r\n`, tabs and repeated spaces collapse to single spaces; result trimmed |
| OCR-P02 | Whitespace-only input ⇒ `""` |
| OCR-P03 | Cap is surrogate-safe: astral-plane pairs are never split (issue #101 parity) |
| OCR-P04 | Exactly at the cap ⇒ unchanged; one over ⇒ truncated to the cap |

### `ocrTargets` (which elements can be recognized)

| ID | Assertion |
|---|---|
| OCR-P10 | Image element with fileId + file dataURL ⇒ listed with that dataURL |
| OCR-P11 | Image without fileId ⇒ excluded |
| OCR-P12 | Image whose file is missing from `files` ⇒ excluded |
| OCR-P13 | Image whose file has an empty dataURL ⇒ excluded |
| OCR-P14 | Non-image elements (text, audio embeddables) ⇒ excluded |
| OCR-P15 | Soft-deleted tombstone elements ⇒ excluded (sanitizer parity) |
| OCR-P16 | Multiple images ⇒ all listed, in element order |

### `applyOcrResults` (writing results back into the scene)

| ID | Assertion |
|---|---|
| OCR-P20 | Matching image element gains `customData.ocrText` + `ocrAt`; untouched elements deep-equal their originals |
| OCR-P21 | Pre-existing customData fields on the same element survive (merge, not replace) |
| OCR-P22 | Empty recognized text ⇒ `ocrText: ""` + `ocrAt` set (scanned-but-blank ≠ never scanned) |
| OCR-P23 | Unknown elementId in the results ⇒ ignored; `applied` counts only real hits |
| OCR-P24 | Results for several images apply in one pass |
| OCR-P25 | The input payload object is never mutated |
| OCR-P26 | Raw text is normalized before storage (newlines ⇒ single spaces) |

### `ocrStatus` / `recognizeAllImages` (orchestration with injected engine)

| ID | Assertion |
|---|---|
| OCR-P30 | `ocrStatus` counts images / scanned (has ocrAt) / withText (non-empty ocrText) on a mixed payload |
| OCR-P31 | Payload without images ⇒ all zeros |
| OCR-P32 | `recognizeAllImages` calls the injected engine once per target, with that target's dataURL, and reports progress 1..N |
| OCR-P33 | One target's engine failure ⇒ the rest still apply; `failed = 1` |
| OCR-P34 | Every target fails ⇒ `applied = 0`, payload structurally unchanged, `failed = N` |
| OCR-P35 | No targets ⇒ engine never called, immediate no-op |
| OCR-P36 | `ocrRunSummary` produces the exact toast lines: scanned-with-text, none-with-text, and nothing-to-do variants |

### Search integration (`extractSearchableText` / `searchIndex`)

| ID | Assertion |
|---|---|
| OCR-S01 | A scanned image's `ocrText` is emitted as searchable content |
| OCR-S02 | Empty `ocrText` is NOT emitted (no empty haystack entries) |
| OCR-S03 | End-to-end index+rank: a page whose ONLY match is OCR text is found by `searchIndex`, and the snippet carries the recognized word |

### Asset integrity — `src/lib/__tests__/ocr-assets.test.ts` (drift guard, issue #103 pattern)

| ID | Assertion |
|---|---|
| OCR-A01 | `public/ocr/assets.json` parses, declares exactly the vendored files, and every file exists with the declared byte size |
| OCR-A02 | Every vendored file's sha256 matches the manifest — an accidentally swapped asset fails loudly |
| OCR-A03 | Versions stay pinned: tesseract.js 6.0.1, core 6.0.0 (the version embedded in the 6.0.1 worker), tessdata 4.0.0_fast |
| OCR-A04 | `public/sw.js` serves the `/ocr/` prefix from cache (source-level check) — assets and offline policy cannot drift apart |

## E2E — `e2e/ocr.spec.ts`

| ID | Scenario |
|---|---|
| OCR-E01 | All five vendored assets answer HTTP 200 from the dev server (no 404 surprises later in the run) |
| OCR-E02 | Full path: import the fixture image ("QUOKKA NOTEBOOK" PNG) → Page-actions → "Recognize text in images" → success toast → Ctrl+K search for "QUOKKA" finds the page with the word in the snippet |
| OCR-E03 | Persistence: reload the page after OCR → search still finds the recognized text (ocrText survived the scene round-trip) |
| OCR-E04 | A page with no images → info toast, no engine load, no console errors |
| OCR-E05 | The browser stays error-free across the whole spec (standard console collector) |

Fixture: `e2e/fixtures/ocr-text.png`, generated deterministically (Pillow,
DejaVu Sans Bold, black on white, 480×120) and committed — the same bytes in
every CI run.

## Non-goals (documented on purpose)

- English-only recognition (matches the English-only UI; more languages would
  balloon the vendored traineddata — a later opt-in download could add them).
- No auto-OCR on import (explicit action only), no handwriting recognition
  (that is the separate v1.11 research track), no OCR of the visible canvas
  bitmap — only image/pdf-printout elements.
