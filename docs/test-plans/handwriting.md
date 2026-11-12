# Test plan — Handwriting (Phase A search + Phase B ink-to-text)

Feature: on-device handwriting recognition (Transformers.js + the vendored
trocr-small-handwritten ONNX — no CDN, no network) makes freehand ink
full-text searchable via Ctrl+K. Explicit per-page action, the ink is never
mutated, recognized text is machine-generated metadata on the strokes.
**English-only** (the model is trained on IAM-class English handwriting —
the menu item says so). Phase B reuses Phase A's recognition entirely:
"Convert handwriting to text" turns a recognized line into an editable
text element at the ink's position while KEEPING the strokes (OneNote
behavior) — no new model, no new privacy surface. CJK is out of scope.
Basis: docs/handwriting-research.md §4 (issue #133), issues #175 (Phase A)
and #176 (Phase B).

Status: **shipped 2026-11-10 (Phase A) / 2026-11-11 (Phase B)** — all
evidence below is from actual runs.

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
| HWR-P30..P38 | `applyHwrResults`: first-stroke carries the line, empty text stored ("" ≠ never-run), stale annotations cleared on re-run (empty bag dropped), re-recognition also resets the Phase B `hwrConvertedAt` conversion mark (P37: fresh run is convertible again; P38: a converted line that fails to re-recognize loses ALL metadata), other customData preserved, input never mutated, unknown line indexes ignored, text normalized |
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

## Phase B — ink-to-text conversion (`hwr-convert.ts`, issue #176)

Pure policy module (mirrors shape-library.ts: no @excalidraw imports, so it
runs in bun tests); the runtime materialization lives in
`excalidraw-client.ts` (`convertHandwritingToText`) and is exercised by the
real-engine E2E checks below.

| Aspect | Decision |
|---|---|
| Trigger | "Convert handwriting to text" in the Page-actions (⋯) menu — right below "Recognize handwriting (English)" |
| Scope | Per-page when no ink is selected; per-group when ink is selected (a line converts when ANY of its strokes is in the live selection — selecting one word converts its whole line). The scope decision counts FREEDRAW ink only: a conversion auto-selects its own text output, and that must not hijack the next conversion into group mode (found by HWR-E05, fixed 2026-11-11) |
| Source data | ONLY the metadata recognition stored (`hwrText`/`hwrAt` on the line's first stroke) — conversion never calls the engine; a page without recognition gets an honest guidance toast |
| Output | Real, editable Excalidraw text element per recognized line: at the ink bbox top-left, fontSize = inkHeight / 1.25 (clamped 12–96), fontFamily 2 (clean Normal font), stroke color = the user's current toolbar color (INHERIT_STROKE sentinel — visible in dark mode) |
| Ink | KEPT, never mutated, never deleted (OneNote behavior) — the text lands on top of the z-order |
| Idempotency | STRUCTURAL: a line counts as converted when a text element already sits at its ink position (HWR_CONVERT_POSITION_EPSILON = 12 px — Excalidraw's text-box padding shifts the created element ~8 px off the skeleton position, measured in HWR-E05). Re-runs skip converted lines and say so; undoing or deleting the text block makes the line convertible again. Deliberately NO customData flag: Excalidraw's undo does NOT revert customData (measured 2026-11-11, HWR-E06 — an undo removed the text but kept a flag, which would make "already converted" lie) |
| Undo-safety | ONE native `updateScene` call with `captureUpdate: CaptureUpdateAction.IMMEDIATELY` = one undo step (Ctrl+Z removes the converted text) and one autosave cycle. The capture action matters: Excalidraw 0.18's default (EVENTUALLY) defers the history capture, and the deferred capture gets reconciled away — the inserted text silently vanished ~1 s after the call (measured with the HWR-E05/E06 scene probes: count 6 at +800 ms, 5 at +1200 ms, no tombstone) |
| Persistence | The converted text + mark flow through the normal autosave, reload, backup/restore, sync and export paths (native elements) |

### Unit tests — `src/lib/__tests__/hwr-convert.test.ts`

| ID | Assertion |
|---|---|
| HWR-C01..C04 | `fontSizeForInkHeight`: height/1.25, clamp 12–96, non-finite/non-positive fallback, whole-size rounding |
| HWR-C10..C20 | `planHwrConversion`: per-page target position/size/text, first-stroke-only metadata, unreadable metadata never converts (empty/whitespace/missing hwrAt/non-string), already-converted detected structurally (text at the ink position within the epsilon; elsewhere → still convertible; 20 px away → converts), per-group any-member selection semantics, selected-but-unreadable counted, drawings beyond the line caps produce no targets, reading order, input never mutated, deleted ink invisible, empty selection converts nothing |
| HWR-C30..C32 | `conversionSkeletons`: one text skeleton per target in reading order (type/x/y/text/fontSize/fontFamily 2/INHERIT_STROKE), empty in → empty out, stable placeholder ids re-id'd at insert time |
| HWR-C40..C45 | `hwrConvertSummary` exact toast lines: guidance (page + selection scopes), already-converted (both scopes), single/multi conversion, already-converted tail, plural forms |
| HWR-C50..C52 | round-trip with `applyHwrResults`: recognize → convert once → re-run says already-converted (text at the position); undo (text removed) makes the line convertible again; a fresh re-recognition under an existing converted text block stays a no-op (no duplicate over the user's possibly edited text) |

### E2E — Phase B additions to `e2e/handwriting.spec.ts` (same serial chain, real engine)

| ID | Scenario | Result (2026-11-11 local run) |
|---|---|---|
| HWR-E05 | after E03's recognized page: "Convert handwriting to text" → toast "Converted 1 line…" → 6 elements (5 ink + 1 text), the text contains "cat" and sits within 12 px of the ink's position, re-run says "All recognized handwriting is already converted to text." and adds nothing | ✅ pass (2026-11-11 local run) |
| HWR-E06 | Ctrl+Z returns the page to ink-only (undo-safe); the undone scene PERSISTS — a reload shows 5 strokes, no text | ✅ pass (2026-11-11 local run) |
| HWR-E07 | on the fresh-mount ink-only page: Ctrl+A → convert converts exactly the selected line (per-group branch) → 6 elements; a never-recognized page shows the guidance toast pointing at "Recognize handwriting" | ✅ pass (2026-11-11 local run) |

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

## Known Excalidraw 0.18 limitation (documented 2026-11-11)

A conversion issued IMMEDIATELY after undoing a previous conversion can
still be dropped by the Excalidraw store ~1 s later (measured with the
scene probes: applied at +0 ms, gone at +1200 ms, no tombstone) — an
Excalidraw 0.18 store/history interplay, also present for other
programmatic element inserts in that state. The reliable path is
re-recognizing first (the recognition flow remounts the canvas, resetting
history). Unit + E2E coverage deliberately keeps every conversion on a
fresh-mount canvas; the toast always tells the truth about what the user
will find on the page.

## Latency (measured 2026-11-10, headless Chromium, WASM device)

| Measurement | Value | Source |
|---|---|---|
| Per-line recognition (q8, WASM) | **≈ 3.2 s** (3 153 ms, one 88 px line) | engine log `[handwriting] line: 3153ms (wasm)`, asserted + printed by HWR-E02 |
| First-use total (fresh profile): fetch ≈92 MB from same-origin + pipeline init + recognize + toast | **≈ 11.9 s** (11 919 ms) | HWR-E02 timing log (each Playwright run is a fresh profile) |
| WebGPU | **not enabled in Phase A** — `hwr-client.ts` pins `device: "wasm"`; the vendored asyncify wasm is the CPU build. WebGPU stays a measured follow-up (issue #176 cycle), not a claim | design decision in hwr-client.ts |
| Model sanity (outside CI) | trocr-small-handwritten q8 reads block-letter pen strokes "CAT" at ≈ 0.35–0.6 s/line on native CPU (Node + onnxruntime-node), 2026-11-10 pre-implementation validation | validation harness, docs/handwriting-research.md §3.1 sizes re-verified |

## v1.14 — WebGPU follow-up (issue #193): asset audit answered + WebGPU arm measured (2026-11-12)

Issue #193's order of operations: **verify the vendored asset set covers
WebGPU → measure → gate → only ship a WebGPU path on a measured win.**
Steps 1-2 landed across two cycles; the measurement below is the first
WebGPU evidence table.

1. **Asset audit — answered with a measurement, not an assumption.** The
   runtime closure is ALREADY webgpu-capable: the raw transformers web
   build's only ORT reference is `import("onnxruntime-web/webgpu")`, and
   bun inlines that export (`ort.webgpu.bundle.min.mjs`) into the vendored
   gzip bundle — `requestDevice`/`GPUShaderStage`/`createBindGroup`
   markers verified in the shipped bytes (2026-11-12). Decisively: with
   the device forced to webgpu, the request log shows the session fetches
   exactly the SAME `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` pair as
   the wasm device — the jsep/plain/jspi variants are never requested, so
   **no additional ORT wasm files are vendored** (the 28 MB jsep pair was
   staged during this cycle, measured unnecessary, and removed again —
   the drift-test stray-file check HWR-A03c caught the leftovers).
2. **Capability gate (step 1, unchanged)**: `src/lib/hwr-device.ts` —
   `probeWebGPU` (never throws, silent fallback) + `resolveHwrDevice`
   (evidence-locked) + `pickHwrDevice`/`readDeviceOverride` (the
   verification seam the benchmark uses to force the device; production
   pages never set `__HWR_DEVICE__`). 22 unit tests (HWR-D01–D22); the
   engine logs the resolved device per line.
3. **Measured evidence table** (2026-11-12, committed CI-neutral
   benchmark `e2e/hwr-bench.spec.ts`, `HWR_BENCH=1 [HWR_BENCH_DEVICE=webgpu]`,
   real vendored engine, q8 trocr-small-handwritten, one 88 px "CAT"
   line, this sandbox — CPU is shared-sandbox, so absolute numbers are
   trend lines, not representative hardware):

   | Arm | Environment | Cold per-line | Warm per-line | Recognized text | /hwr/ requests |
   |---|---|---|---|---|---|
   | wasm | headless Chromium (default) | 3 614 ms (click→toast 12 740 ms) | 1 097 / 1 169 / 1 214 ms — mean **1 160 ms** | searchable CAT hit | asyncify pair + model + runtime bundle |
   | webgpu | full Chromium + `--enable-unsafe-webgpu` + `--enable-unsafe-swiftshader` (software adapter obtained) | **83 008 ms** (click→toast 93 093 ms) | **77 773 ms** (1 warm sample) | searchable CAT hit — IDENTICAL acceptance outcome | asyncify pair + model + runtime bundle — no jsep files |

   Warm webgpu/wasm on software rendering: ≈ **67× slower**. The webgpu
   path produces the same recognition result (identity verified through
   the app's real search flow), but software WebGPU is the opposite of a
   win for this q8 model. Without `--enable-unsafe-webgpu` the adapter is
   null and the engine's per-line failure path reports
   "no available backend found" honestly (partial-failure toast — the
   app's behavior is correct; an earlier bench draft accepted that toast
   as success, fixed before shipping).

4. **Gate decision (unchanged, now evidence-backed)**:
   `HWR_WEBGPU_EVIDENCE` stays false. Software WebGPU measured 67×
   slower; hardware WebGPU remains untested (no GPU in any sandbox this
   project builds in). Flipping the gate requires: a representative-
   hardware measurement with the committed benchmark (one command:
   `HWR_BENCH=1 HWR_BENCH_DEVICE=webgpu bunx playwright test
   e2e/hwr-bench.spec.ts`) showing a real, reproducible win AND identical
   results — nothing else changes; the seam, the gate and the benchmark
   already ship.
5. **Privacy invariant**: unchanged — both arms fetch everything from
   same-origin /hwr/ (request-log verified), zero cross-origin requests.

## Non-goals (documented on purpose)

- **CJK / multi-language handwriting** — deferred (no open on-device CJK
  HTR model in the browser-runnable class; docs/handwriting-research.md §6).
- **Background recognition** — never; recognition is an explicit per-page
  action with a visible cost, and conversion only reads stored metadata.
- **Cloud recognition** — rejected (privacy stance, research doc §2.2).
- **Replacing the ink after conversion** — deliberately not OneNote's
  "ink becomes gray": the strokes stay as drawn so nothing is lost when
  the model misreads a word; delete the text block (or undo) and edit the
  ink freely, re-recognize anytime.

## Vendor upgrade procedure

1. Run `public/hwr/fetch-vendor.sh` (idempotent; byte-size guard on the
   weights; rebuilds `assets.json`).
2. Update the pinned versions in `hwr-assets.test.ts` (HWR-A03) and the
   `HWR_ENGINE` block in `hwr-client.ts` if they changed.
3. `bun test src/lib/__tests__/hwr-assets.test.ts` and the full e2e spec.
