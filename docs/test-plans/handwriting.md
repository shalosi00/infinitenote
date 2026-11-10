# Test plan — Handwriting search (Phase A)

Feature: on-device handwriting recognition (Transformers.js + the vendored
trocr-small-handwritten ONNX — no CDN, no network) makes freehand ink
full-text searchable via Ctrl+K. Explicit per-page action, the ink is never
mutated, recognized text is machine-generated metadata on the strokes.
**English-only** (the model is trained on IAM-class English handwriting —
the menu item says so). Phase B (ink-to-text, issue #176) and CJK are out
of scope. Basis: docs/handwriting-research.md §4 (issue #133), issue #175.

Status: **shipped 2026-11-10** — all evidence below is from actual runs.

## Design summary

| Aspect | Decision |
|---|---|
| Engine | `@huggingface/transformers` **4.3.2** ESM bundle, vendored as a **bun-bundled, gzipped closure** at `public/hwr/transformers.web.bundle.js.gz` — the raw dist files cannot run from a blob URL (`transformers.min.js` is node-flavored: "this.processor is not a function"; the web build lazily imports bare specifiers like "onnxruntime-web/webgpu" that blob modules cannot resolve — both measured 2026-11-10 — and the npm-dependency route made the cold CI build flaky), so the vendor step inlines every bare specifier into one self-contained ESM file and gzips it; the drift test verifies the uncompressed bundle's sha256 (HWR-A03b) — fetched same-origin, decompressed in the browser (`DecompressionStream`) and imported as a blob URL. Why gzipped: the raw bundle is rejected by GitHub push protection (false-positive "Mistral AI API Key" on a provider-template string) and the npm-dependency route made the cold CI build flaky (Turbopack postcss IPC timeouts); the drift test gunzips and verifies the ORIGINAL sha256 (HWR-A03b) |
| Model (vendored, `public/hwr/models/trocr-small-handwritten/`) | Xenova/trocr-small-handwritten **q8**: encoder 23,082,942 B + decoder-merged 40,527,613 B (HF-verified sizes, sha256-pinned in `public/hwr/assets.json`) + tokenizer/config JSONs |
| Runtime (vendored, `public/hwr/ort/`) | onnxruntime-web **1.31.0-dev.20260914** `ort-wasm-simd-threaded.asyncify.mjs` + `.wasm` — the exact pair the browser fetches in a non-cross-origin-isolated page (measured 2026-11-10 request log), served from `wasmPaths = "/hwr/ort/"` |
| Offline story | Service worker `"/hwr/"` static prefix (cache-first, runtime fill) — first use caches the ≈92 MB bundle for the profile's life; `env.allowRemoteModels = false` means a misconfiguration can never phone home |
| Trigger | Explicit "Recognize handwriting (English)" item in the Page-actions (⋯) menu — predictable cost, no surprise CPU burn, never background processing |
| Segmentation | Pure geometry in `hwr.ts`: strokes → absolute bboxes → union-find over pairwise `sameLine` (vertical overlap ≥ 55% of the smaller height + horizontal gap ≤ 2.5×height + 8 px) → min/max size filters (drops i-dots/drawings) → lines ordered top→bottom, strokes left→right |
| Rasterization | `hwr-raster.ts` (browser-only): per line, ink scaled to 88 px height (clamp 0.05–4×), fixed 4 px pen (≈ 0.045 pen-to-height, the band validated against the real model), round caps/joins, black on white, 6 px margin; single points render as dots |
| Data flow | flushSave → read page content → segment → rasterize + recognize per line → `customData.hwrText` (+ `hwrAt`) on each line's FIRST (leftmost) stroke → write back → canvas remount (sync-proven path) |
| Idempotency | Re-running first strips stale `hwrText`/`hwrAt` from every live freedraw stroke (an ink edit re-segments honestly), then annotates; a stroke whose only metadata was stale drops the empty `customData` bag entirely |
| Search | `extractSearchableText` additionally emits freedraw `customData.hwrText` — handwriting becomes content: matches AND snippets |
| Cap | Recognized text normalized (whitespace collapsed) and capped at 20 000 **code points** per line (surrogate-safe, issue #101 parity) |
| Errors | Typed `HwrError` ("load-failed" / "init-failed" / "recognize-failed") with English messages; per-line failures never abort the batch |
| E2E determinism | Real TrOCR against a committed freedraw fixture (block letters tracing "CAT", tight 80 px spacing — letters crowds so the model does not emit inter-letter spaces); the full wasm path runs in CI, no mocks |

Unit tests never spin up the real engine: the orchestrator
(`recognizeAllHandwriting`) takes injected `render` + `recognize` functions,
so all data-flow logic is tested with fakes; the real engine is proven by
e2e/handwriting.spec.ts against the vendored bundle.

## Unit tests — `src/lib/__tests__/hwr.test.ts`

| ID | Assertion |
|---|---|
| HWR-P01..P19 | stroke extraction: type/isDeleted filtering, relative→absolute points, pressure-triplet tolerance, NaN/finite guards, bbox math |
| HWR-P20..P29 | `sameLine` predicate + `segmentLines`: vertical-overlap ratio, horizontal-gap budget (word gaps in, two columns out), union-find order-independence, left-to-right/top-to-bottom ordering, min/max line filters |
| HWR-P30..P36 | `applyHwrResults`: first-stroke carries the line, empty text stored ("" ≠ never-run), stale annotations cleared on re-run (empty bag dropped), other customData preserved, input never mutated, unknown line indexes ignored, text normalized |
| HWR-P40..P41 | `hwrStatus` accounting (strokes/lines/recognized/withText) |
| HWR-P50..P59 | `recognizeAllHandwriting` orchestration with fakes: progress (done, total), one failing line never aborts, no lines → engine never called, outcome counts |
| HWR-P60..P62 | `hwrRunSummary` exact toast lines |
| HWR-P70..P72 | search integration: `hwrText` extracted as content, AND-semantics through `buildSearchIndex`/`searchIndex`, unrecognized ink stays invisible |

## Unit tests — `src/lib/__tests__/hwr-raster.test.ts`

| ID | Assertion |
|---|---|
| HWR-R01..R05 | `rasterParams`: scale clamping (giant drawings shrink, tiny writing grows ≤ 4×), pen + margin sizing, centering offsets, degenerate 1-px ink |

## Asset integrity — `src/lib/__tests__/hwr-assets.test.ts` (drift guard)

| ID | Assertion |
|---|---|
| HWR-A01 | every declared asset exists with the declared byte size |
| HWR-A02 | every asset's sha256 matches the manifest |
| HWR-A03 | versions pinned: transformers.js 4.3.2, onnxruntime-web 1.31.0-dev.20260914-8d85527a0, model Xenova/trocr-small-handwritten, q8, language "eng" |
| HWR-A03b | manifest declares exactly the files on disk (no strays; directories filtered) |
| HWR-A04 | the two ONNX weights are the HF-verified byte sizes (23,082,942 / 40,527,613) |

## E2E — `e2e/handwriting.spec.ts` (real engine, committed fixture)

| ID | Scenario | Result (2026-11-10 local run) |
|---|---|---|
| HWR-E01 | all seven vendored engine assets are served | ✅ pass (1.9 s) |
| HWR-E02 | import `e2e/fixtures/handwriting-cat.excalidraw` (5 freedraw strokes) → "Recognize handwriting (English)" → success toast → `Ctrl+K` "CAT" finds the page → **zero cross-origin requests** during the whole flow | ✅ pass (16.7 s) |
| HWR-E03 | recognized text persists across a reload; ink untouched (5 strokes) | ✅ pass (3.2 s) |
| HWR-E04 | a page without ink is a friendly no-op | ✅ pass (0.8 s) |

The fixture letters are drawn with the same constraints the segmentation
enforces (every stroke > 0 px tall, ≥ 55 % vertical overlap with its
neighbours) — the A crossbar and T top bar are slightly slanted so they
segment into the line and render completely.

## Latency (measured 2026-11-10, headless Chromium, WASM device)

| Measurement | Value | Source |
|---|---|---|
| Per-line recognition (q8, WASM) | **≈ 3.2 s** (3 153 ms, one 88 px line) | engine log `[handwriting] line: 3153ms (wasm)`, asserted + printed by HWR-E02 |
| First-use total (fresh profile): fetch ≈92 MB from same-origin + pipeline init + recognize + toast | **≈ 11.9 s** (11 919 ms) | HWR-E02 timing log (each Playwright run is a fresh profile) |
| WebGPU | **not enabled in Phase A** — `hwr-client.ts` pins `device: "wasm"`; the vendored asyncify wasm is the CPU build. WebGPU stays a measured follow-up (issue #176 cycle), not a claim | design decision in hwr-client.ts |
| Model sanity (outside CI) | trocr-small-handwritten q8 reads block-letter pen strokes "CAT" at ≈ 0.35–0.6 s/line on native CPU (Node + onnxruntime-node), 2026-11-10 pre-implementation validation | validation harness, docs/handwriting-research.md §3.1 sizes re-verified |

## Non-goals (documented on purpose)

- **Ink-to-text conversion** — Phase B (issue #176), gated on Phase A
  accuracy proving out in dogfooding.
- **CJK / multi-language handwriting** — deferred (no open on-device CJK
  HTR model in the browser-runnable class; docs/handwriting-research.md §6).
- **Background recognition** — never; recognition is an explicit per-page
  action with a visible cost.
- **Cloud recognition** — rejected (privacy stance, research doc §2.2).

## Vendor upgrade procedure

1. Run `public/hwr/fetch-vendor.sh` (idempotent; byte-size guard on the
   weights; rebuilds `assets.json`).
2. Update the pinned versions in `hwr-assets.test.ts` (HWR-A03) and the
   `HWR_ENGINE` block in `hwr-client.ts` if they changed.
3. `bun test src/lib/__tests__/hwr-assets.test.ts` and the full e2e spec.
