# Project Status

> **READ THIS FIRST.** This file is the single source of truth for "where does the
> project stand". It is small on purpose: humans and AI agents should get a complete
> picture in ~2 minutes without reading the codebase. Every merged PR must update it.

| | |
|---|---|
| **Last updated** | 2026-11-12 (issue #193 step 2 shipped — WebGPU arm MEASURED end to end: the vendored runtime closure is already webgpu-capable (bun inlines the webgpu build; requestDevice/GPUShaderStage markers verified in the shipped bytes) and, decisively, the webgpu device fetches exactly the SAME asyncify wasm pair as the wasm device (request-log capture) — no jsep/plain/jspi files are ever requested, so none are vendored (the 28 MB jsep pair was staged, measured unnecessary, removed; the drift test's stray-file check caught the leftovers); committed benchmark e2e/hwr-bench.spec.ts gained a WebGPU arm (HWR_BENCH_DEVICE=webgpu: full Chromium + --enable-unsafe-webgpu + --enable-unsafe-swiftshader, software adapter obtained) and a verification seam (pickHwrDevice/readDeviceOverride in hwr-device.ts — production behavior unchanged, gate still pins wasm); MEASURED: wasm cold 3 614 ms/line, warm mean 1 160 ms (3 samples) vs webgpu-software cold 83 008 ms/line, warm 77 773 ms — ≈67× slower on SwiftShader; recognition identity verified (both arms produce the searchable CAT hit through the app's real search flow); HWR_WEBGPU_EVIDENCE stays false — flipping requires a representative-hardware win with identical results (one committed command); without the flags the adapter is null and the engine's per-line failure path is honest (partial-failure toast; an earlier bench draft accepted that toast as success — fixed before shipping); +5 unit tests (HWR-D18–D22, suite 908/908 across 70 files with lint + typecheck clean); step 1:  — WebGPU capability gate + vendored-asset audit + measured WASM baseline: new pure module src/lib/hwr-device.ts (probeWebGPU never-throw adapter probe + resolveHwrDevice evidence-locked to “wasm” until the jsep runtime assets are vendored AND a measured win exists — behavior byte-identical to the old unconditional pin); hwr-client.ts selects its device through the gate and logs the resolved device per line; +17 unit tests (hwr-device.test.ts, ids HWR-D01–D17) lift the suite to 903/903 across 70 files with lint + typecheck clean; committed CI-neutral benchmark spec e2e/hwr-bench.spec.ts (runs only with HWR_BENCH=1) measured the real vendored engine in headless Chromium: cold round 4 452 ms/line incl. first-use model load, warm single-line mean 1 127 ms (1 113/1 124/1 144 over 3 samples) — audit FINDING: no .jsep (WebGPU EP) assets are vendored, so a WebGPU arm requires vendoring the jsep pair + re-bundling before any comparison; evidence table in docs/test-plans/handwriting.md “v1.14 — WebGPU follow-up” section); 2026-11-12 (v1.13.0 desktop artifacts independently re-verified — issue #194: fresh AppImage download from the release page (152,889,848 bytes, sha256 bc5102ade5aad106c0413005d4a546b2d3a1ac9e4e87107a83b9a9af1464e5f3), valid type-2 runtime + FUSE-less extraction, objdump scan of all 174 bundled ELFs — overall max GLIBC_2.35 set by the webkit stack (libcairo/libjavascriptcoregtk/libwebkit2gtk from the pinned ubuntu-22.04 runner), main app binary GLIBC_2.34, nothing over the floor, embedded .desktop entry + hicolor icons correct, versionCode 230/1.13.0 parity across package.json + android-twa gradle/twa-manifest + src-tauri Cargo.toml/tauri.conf.json + F-Droid recipe (commit v1.13.0), and the vendored handwriting model confirmed EMBEDDED in the Tauri binary (all 10 public/hwr/ asset paths present in usr/bin/infinitenote — Tauri v2 embeds the whole frontendDist static export, so nothing downloads at runtime); evidence table added to docs/desktop.md “Artifact verification log”; ROADMAP gained the v1.14 section (v1.13 re-labeled shipped); docs/WORKLOG.md backfilled with concise 11-10/11-11 entries; docs-only cycle — no code changes; the PR gate re-verified lint + typecheck + the full unit suite at 886/886 across 69 files); 2026-11-11 (v1.13.0 RELEASED: Phase A handwriting search (#175 via #178) + Phase B ink-to-text conversion (#176 via #188) — milestone complete; release PR #191 merged as merge commit 408dee9; tag v1.13.0 + GitHub Release published; version files at 1.13.0/versionCode 230 via #189; CI moved to webpack builds via #190 after Turbopack's postcss worker IPC deadline failed 9 consecutive CI builds on slower runners — 9 fatal panics at ~6m42s per attempt vs 5m01s on fast runners, `next build --webpack` is the supported Next 16 fix and restores the proven pre-16 build path; suite at 886 unit + 159 E2E); 2026-11-11 (CI hardening — the production build moved to webpack (`next build --webpack` in both the web and desktop build scripts): Turbopack's PostCSS worker IPC deadline elapsed deterministically on slower shared runners — 9 consecutive FATAL panics ("Failed to write app endpoint /page", ~6m42s into each build attempt, while faster runners finished in 5m01s) blocked the release flow's e2e checks; `--webpack` is a supported Next 16 flag and restores the proven pre-Next-16 build path; the retry chains in build-smoke and the e2e webServer stay as belt-and-braces; local webpack build verified; 886/886 unit green); 2026-11-11 (Phase B ink-to-text shipped: "Convert handwriting to text" in the Page-actions menu turns each recognized handwriting line into a real, editable Excalidraw text element at the ink's position while keeping the strokes — OneNote behavior; per-page and per-group (selection-scoped: the scope decision counts freedraw ink only, so a conversion's auto-selected text cannot hijack the next run); idempotent by STRUCTURAL detection (a text element at the line's ink position within a 12 px epsilon = converted — deliberately no customData flag, because Excalidraw's undo does not revert customData, measured); three real findings from the test-first build: (1) applyHwrResults returned the ORIGINAL payload whenever no line carried a result, silently keeping stale recognition metadata (uniform lifecycle fix + regression tests), (2) Excalidraw 0.18's default captureUpdate EVENTUALLY defers the history capture and the deferred capture is reconciled away — the inserted text vanished ~1 s after updateScene (scene probes: 6 elements at +800 ms, 5 at +1200 ms) — fixed with CaptureUpdateAction.IMMEDIATELY, (3) the known post-undo re-conversion store drop is documented with the reliable workaround (re-recognize first — it remounts the canvas); 886 unit + 156 E2E green, handwriting spec 7/7 incl. 3 real-engine Phase B checks; 2026-11-11 (README rework + screenshot pipeline: README rewritten — hero + highlights table + 7-shot gallery + Privacy + Roadmap sections; new screenshots captured from the real app by the committed capture pipeline scripts/gen-readme-scenes.py + capture-readme-shots.mjs + install-readme-shots.py (seeds a tagged notebook tree, imports generated .excalidraw scenes, runs the real handwriting engine for an authentic toast, shoots light/dark heroes, search over recognized ink, version history, themes, mobile); the capture pass FOUND A REAL BUG — dark mode rendered a washed-out light-gray canvas because Excalidraw 0.18 inverts canvas pixels (.theme--dark canvas { filter: invert(93%) hue-rotate(180deg) }) while the app painted a dark viewBackgroundColor — double inversion; fix: paint white paper in both themes (white inverts to ~#121212), matching all export paths that already pin #ffffff; the e2e theme spec now asserts appState.theme via canvasTheme() instead of the raw bg flip that encoded the bug); 2026-11-10 (corrupt-input hardening: hand-edited sync/backup data can no longer crash the sidebar, search or imports — 5 fixes + 43 adversarial tests) |
| **Current version** | v1.13.0 (tagged 408dee9 on the release merge commit, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.13.0); Desktop artifacts build via the tagged-release Desktop workflow) |
| **Phase** | v1.14.0 milestone open — #194 CLOSED (desktop artifacts verified 2026-11-12, evidence in docs/desktop.md) and #193 step 1 shipped (vendored-asset audit: no jsep WebGPU assets vendored — WebGPU arm blocked on vendoring them first; capability gate live; WASM baseline measured); #193 remains open for the representative-hardware WebGPU measurement (the committed benchmark makes it one command; the gate flips only on a measured win with identical results); ROADMAP carries the v1.14 section; v1.13.0 released, milestone #14 closed; CJK deferred) | v1.13.0 history: Phase A handwriting search shipped — Phase A handwriting search shipped (#175: transformers.js 4.3.2 + trocr-small-handwritten q8 vendored under public/hwr/ with sha256 manifest + drift tests; union-find line segmentation; height-normalized rasterizer; per-line first-stroke hwrText metadata; Ctrl+K indexing; service-worker /hwr/ prefix; measured 2026-11-10: ≈3.2 s per line WASM, ≈11.9 s first-use total, zero cross-origin requests asserted by E2E; 614 unit + 156 E2E); then v1.11.1 shipped (desktop launch fix #164 + README rework #165 via PRs #166/#167/#169; issues auto-closed on the main merge); main carries the release as a merge commit and shares ancestry with develop again; the suspected workflow-trigger corruption proved to be an output-display artifact, not a file defect (see the worklog addendum); handwriting research shipped 2026-11-10 (docs/handwriting-research.md, issue #133: pursue phased — Phase A metadata-only handwriting search via trocr-small-handwritten ≈64 MB quantized ONNX, Phase B ink-to-text gated on accuracy; cloud/proprietary/OS-API-only paths rejected; CJK deferred); v1.12.0 shipped (docs-only release: handwriting research merged via #172 closing #133; version files at 1.12.0/versionCode 220 via #173; release PR #174 merged as merge commit dbdd5c2; tag v1.12.0 + GitHub Release published; milestone v1.12.0 closed); unit-suite growth cycle after Phase A: +200 tests in 21 new files (#179, unit suite 814) closing the src/lib coverage gaps found by a LOC-vs-tests survey; **v1.13.0 milestone complete pending release** — Phase B ink-to-text shipped in this cycle (#176): conversion is metadata-only (no new model, no engine calls), per-page and per-group via live selection (ink-only scope), structural idempotency, one native undo step via CaptureUpdateAction.IMMEDIATELY (docs/test-plans/handwriting.md Phase B section carries the measured findings incl. the 0.18 store quirks); unit suite 886/886 across 69 files with lint + typecheck clean, E2E 156 checks with the handwriting spec 7/7 (real engine); main and develop share ancestry again |
| **Overall state** | 908 unit + 156 E2E green (2026-11-12 issue #193 step 2: +5 verification-seam tests (HWR-D18–D22) lift the suite from 903; WebGPU arm measured end to end — wasm warm mean 1 160 ms/line vs webgpu-on-SwiftShader 77 773 ms/line (≈67× slower), identity verified, no extra wasm files needed (request-log evidence); step 1 earlier the same day: +17 probe unit tests (ids HWR-D01–D17) lift the suite from 886, lint + typecheck clean; the committed HWR_BENCH benchmark measured the WASM baseline — cold 4 452 ms/line incl. model load, warm mean 1 127 ms/line over 3 samples; the WebGPU arm stays evidence-gated OFF, blocked on vendoring the jsep runtime pair (audit finding); docs-only #194 verification cycle earlier the same day — issue #194 executed: v1.13.0 AppImage freshly downloaded and re-verified (valid type-2 runtime, FUSE-less extraction, 174 bundled ELFs objdump-scanned with overall max GLIBC_2.35 and the main app binary at 2.34, embedded .desktop entry + icons correct, versionCode 230 parity across all six version files, vendored hwr model confirmed embedded in the Tauri binary); no code changes; the PR gate re-verified lint + typecheck + 886/886 unit across 69 files); previously 2026-11-11 Phase B cycle — 886/886 across 69 files with lint + typecheck clean; +28 tests: hwr-convert.test.ts (27, ids HWR-C*) + 2 reworked applyHwrResults regression tests netting +1 on hwr.test.ts; E2E: handwriting spec 7/7 in isolation (three consecutive runs), full-suite run hit the sandbox's 4 GB memory ceiling with a tab crash inside the real-engine test (environment, not code — the test passes isolated; CI validates the full suite); 2026-11-10 corrupt-input hardening wave — "test unexpected cases like humans do": the sync folder and backup file are documented human-editable JSON, and replaying those hand-edits found 5 real defects — (1) search `extractSearchableText` crashed the whole index build with `TypeError: not iterable` on a shape-corrupt `"scene": {"elements": 42}` page file, (2) `buildSearchIndex` spread a hand-edited `"tags": "work"` string into single-char haystack entries (or a `{length:5}` object into a spread crash), (3) `collectTags`/`pageHasTag`/`removeTag`/`normalizeTags` crashed on non-string tag entries from imported rows, (4) `parseSyncFolder` accepted scene/tags of any shape (garbage flowed straight into the DB), (5) `importExcalidrawFile` failed a whole import batch with a bare SyntaxError on a truncated/renamed .excalidraw file; plus the deferred `addTagWithResult` finding: over-cap imported tag lists reported "added" while silently dropping the tag. Fixes: `safeTags` coercion boundary in tags.ts used by every tag consumer, `Array.isArray` guards in search.ts, strict `badPageFile` scene validation + tags coercion in parseSyncFolder, new pure `parseSceneFileText` seam so scene-file import fails with the file named and the reason, restoreBackup validates tags/content; 43 new adversarial tests in corrupt-input.test.ts, full local run 858/858 across 68 files with lint + typecheck clean; 2026-11-10 docx-import fix: a self-closing <w:p/> (empty paragraph, common in real Word exports) no longer makes the NEXT paragraph import twice — found while writing the #179 tests, fixed with a regression test pinning both the bare and the attributed form; 2026-11-10 test-growth cycle #179: +200 unit tests in 21 new files — sync format/db/merge cases, store CRUD, notes-db edges, docx/html/mht/import-blocks importers, shape library, themes, search ranking, tags, tree ops, shortcuts, generated names, excalidraw-utils, pdf-layout, audio notes, ocr-client — test-only PR, zero behavior changes; full local run 814/814 across 67 files with lint + typecheck clean (815/815 after the docx fix); 2026-11-10 handwriting cycle: +46 HWR unit tests across hwr/hwr-raster/hwr-assets, +4 real-engine E2E checks — full local run 614/614 with lint + typecheck clean; previously 567 unit + 152 E2E re-verified 2026-11-10: unit 567/567 across 43 files, full E2E 152/152 in 6.8m; 2026-11-09: CI-mode E2E against the production build, 152 passed in 3.7m; the released v1.11.0 tag re-verified from a fresh clone — install/build/boot smoke + 564/564 unit at that time; Desktop artifacts attached to the release); **2026-11-10 incident #164**: the v1.11.0 AppImage silently failed to launch when double-clicked on current LTS distros — linuxdeploy copied webkit2gtk/glib from the ubuntu-latest runner (26.04, glibc 2.43) into the bundle, raising the real floor to GLIBC_2.42+ while the app binary itself only needs 2.39; fix pins the Desktop workflow to ubuntu-22.04 (floor 2.35) and adds a post-build guard that fails the job if any bundled ELF requires GLIBC > 2.35, plus user-facing AppImage troubleshooting (README + docs/desktop.md); the shipped v1.11.1 AppImage was independently re-verified 2026-11-10 by a fresh download — valid type-2 runtime, FUSE-less extraction OK, objdump scan of every bundled ELF max GLIBC_2.35, embedded .desktop entry correct (full GUI boot untestable in the bare sandbox: host libEGL.so.1 absent — consistent with the prior Xvfb boot); a suspected trigger corruption (`branches: ain]`) turned out to be an output-display artifact — the file always carried the correct filter (13 main-push Desktop runs predate this cycle) and the new unit-test pin now guards it for real; version history + OCR shipped 2026-11-09 and verified; PDF printouts now land a OneNote-style file chip — right-click menu with byte-exact download (docs/test-plans/pdf-attachment.md); OCR now recognizes German (the one deu fast model covers EN+DE — combination modes proven worse, docs/test-plans/ocr.md evidence table); two dev-mode-only dialog-click E2E flakes hardened (retry-tolerant, assertions unchanged); dialog-close click-swallow fixed (regression-pinned); 0 known bugs (post-#164-fix); proactive investigation cycle 2026-11-09 — full-flow console sweep clean (0 warnings/0 errors across 16 phases), sync out-of-contract-folder healing (#148: deleted rows can no longer resurrect from stale page files + tombstones; the sync folder mirrors the library exactly), overlay + rename focus return (#149/#150: every dialog, the mobile drawer and the rename editor return focus to the pre-open element, WCAG 2.4.3); app-surface sweep 2026-11-08 (all dialogs/menus/popover/drawer audited at 5 viewports, 4 layout/a11y defects fixed); save-indicator calm pass 2026-11-08 (content-gated autosave, tombstone filter, <360px header fix); full manual pass 2026-11-07 — findings #122/#123 fixed |

## TL;DR

InfiniteNote is an open-source OneNote-style notebook for Linux and Android:
Notebook → Section → Page hierarchy on an infinite canvas (Excalidraw), draw/write
on anything, import images / text / Markdown / PDF printouts / .excalidraw scenes,
Word documents, OneNote-exported HTML and OneNote `.mht` single-file pages
(embedded images included), audio clips (import a file or record straight into
the page, playable on-canvas), export PNG / SVG / scenes / full backups,
full-text search, soft-delete trash, dark mode, per-page paper styles (plain /
ruled / grid), page tags with a tag filter view, and a fully offline
installable PWA.
All data is local (IndexedDB). The UI is English-only (the v1.7 English/简体中文 layer was removed in v1.9); CJK note *content* remains fully supported. v1.5 adds file-based sync phase 1: a sync folder
(or ZIP) with page-granular merge and conflict copies. v1.6 adds distribution:
a Tauri 2 Linux desktop shell (deb/rpm/AppImage artifacts on releases), an
Android TWA wrapper scaffold with tested Digital Asset Links tooling, and a
Flatpak/Flathub packaging recipe. v1.7 adds UI internationalization
(English + 简体中文), a themes gallery — six accent themes layered over
light/dark via a sidebar gallery with live swatches — and the F-Droid build
recipe with its validation tooling.
v1.10 adds a curated shape library — a OneNote-style Shapes toolbar
(desktop + mobile) inserting blocks/frames, arrow variants, elbow connectors
and sticky notes with bound labels as native Excalidraw elements — plus a
bundled-asset Android wrapper: the TWA serves the static export from APK
assets via WebViewAssetLoader, so airplane-mode first run renders the app
(F-Droid offline compliance). Imported images can no longer persist with a
stale "pending" status, and a full reload reopens the last-opened page.
**Bug-hunt wave 2** (issues #63, #77–#105, #107 — 31 fixes across 6 PRs) hardened
the whole surface: honest autosave + boot retry, always-fresh search/trash,
audio blocks and true vector shapes in PDF exports (CJK-safe footers),
CJK-aware import layout, IME-safe text input, localized generated names +
welcome seed (en/zh-CN), recorder error handling, shape-library persistence,
localized sync errors, flag-gated e2e hooks, an exactly-pinned pdf.js worker
pair and a TypeScript-honest build.
v1.1 added the duplicate-page action, Playwright E2E as a required CI check and
OneNote import phase 1 (.docx + HTML). v1.2 adds OneNote import phase 2 (`.mht`
single-file pages with embedded images + Graph export runbook) and page paper
styles (plain/ruled/grid). v1.3 adds page tags, OneNote-style quick capture
("Quick note" button + Ctrl/Cmd+Alt+N, a pinned **Today** daily page that is
created on first open and reused all day), and print-friendly paginated PDF
export (A4 portrait/landscape, vector text, sliced images).

## What works today (verified by tests)

| Area | State | Evidence |
|---|---|---|
| Notebook/Section/Page CRUD, rename, colors, reorder, duplicate page | Working | 34 E2E checks + unit tests |
| Infinite canvas, draw + type on anything | Working | E2E (real mouse draw, per-key typing) |
| Autosave + persistence across reloads | Working | E2E (autosave, flush-on-switch, save-indicator-calm: steady label under viewport-only churn, undo-inside-debounce never persists) |
| Page paper styles: plain / ruled / grid, persisted, zoom/pan-synced | Working | E2E background.spec (6 checks) |
| Imports: image, text, Markdown, PDF printout (20-page cap **with an explicit truncation notice**), `.docx`, OneNote HTML, **OneNote `.mht` with embedded images**, `.excalidraw`, **audio** — all types at once on one canvas, then ink + text on top; import toasts with explicit feedback; **PDF imports land a OneNote-style file chip (badge + file name) with the original bytes embedded** | Working | 36 E2E checks with fixture files (incl. e2e/import-overlay.spec.ts, e2e/import-pdf-truncation.spec.ts) |
| Exports: PNG, SVG, .excalidraw, **paginated PDF (A4 portrait/landscape — vector text, sliced images, paper-aware, audio blocks as labeled player strips, non-Latin footer titles rasterized, unrotated shapes as true vectors)**, notebook backup — filenames follow the current page title (renames included) and keep CJK/Unicode characters; export errors are localized toasts; the full backup restores into a wiped app through the UI | Working | 19 policy unit tests + 6 E2E checks (e2e/pdf-export.spec.ts, e2e/pdf-wave2.spec.ts) + e2e/export-filename.spec.ts + e2e/import-export-roundtrip.spec.ts (PNG magic/IHDR bytes, SVG markup content, scene export → re-import round-trip, backup export → wipe → UI restore round-trip, 8 checks) |
| Cross-page search (Ctrl+K — content index reloads on every open and is built once per open, not per keystroke), trash restore/purge (list refreshes live), search/tag jumps reveal their target in a collapsed tree | Working | Unit + 6 E2E checks (search-trash, state-freshness specs) |
| Page tags: add/remove in header, sidebar chips, tag filter view, search | Working | 14 unit tests + 4 E2E checks |
| Audio blocks (issue #67): import audio files + in-app recording (MediaRecorder), playable `<audio>` players on canvas, draw over clips, persisted via customData payload | Working | 31 unit tests + 7 E2E checks (e2e/audio.spec.ts) |
| Quick capture: "Quick note" button + Ctrl/Cmd+Alt+N, pinned Today daily page | Working | 17 unit tests + 4 E2E checks |
| **Page version history**: per-page snapshot timeline (auto ≥ 5 min on structural change / manual "Save version now" / automatic pre-restore safety copy), restore to any version (DB-write + canvas remount — the proven sync path), 25-per-page FIFO budget, newest-first dialog; versions are local-only (excluded from backups and the sync folder), trash keeps them, purge cascades | Working | 35 unit tests + 5 E2E checks (docs/test-plans/version-history.md) |
| **OCR (on-device)**: "Recognize text in images" (Page actions ⋯) runs tesseract.js 6.0.1 — vendored under `public/ocr/` (engine, LSTM cores ×2, **German fast model — recognizes English AND German incl. umlauts/ß**; no CDN, offline after first use; the eng+deu combination modes strip umlauts, evidence in docs/test-plans/ocr.md) — over every image element, stores `customData.ocrText` (normalized, 20k-code-point cap) in the scene, and the recognized text becomes full-text-searchable content with snippets; per-image failures never abort a batch; typed error toasts; assets pinned by sha256 drift tests | Working | 37 unit tests + 5 E2E checks with the real engine, incl. the German fixture (docs/test-plans/ocr.md) |
| **PDF file chips (OneNote-style)**: every PDF printout import embeds the ORIGINAL file bytes in an Excalidraw embeddable chip above the rendered pages (red PDF badge + file name, survives restore/version history); right-clicking the chip opens a context menu — **View file** (blob URL, new tab), **Download file** (byte-exact original, offline forever), **Copy file name** (clipboard + toast); files over the 10 MiB cap import as plain printouts with an explicit skip toast; chip names are full-text-searchable | Working | 29 unit tests + 11 E2E checks incl. byte-exact round-trip (docs/test-plans/pdf-attachment.md) |
| Themes gallery (issue #55): six accent themes over light/dark, live swatches, persisted + pre-hydration restore, localized labels | Working | 19 unit tests + 4 E2E checks (e2e/themes.spec.ts) |
| Sidebar multi-select: checkboxes, select-all (expanded sections), bulk move (cross-notebook) + bulk delete → trash | Working | 26 unit tests + 4 E2E checks |
| Keyboard shortcut cheatsheet (? / Ctrl+Cmd+/, sidebar button, platform-aware ⌘/Ctrl) | Working | 11 unit tests + 3 E2E checks |
| Dark mode, mobile drawer navigation | Working | E2E + visual review | 
| App-surface overlap/clipping sweep: every first-party dialog, dropdown, popover, context menu and the mobile drawer — pairwise bounding-box + viewport-clipping audit of all interactive controls at 1280/900/768/390/320, zero-console-error guard, named-controls a11y pin | Working | 6 E2E checks (e2e/ui-surface-sweep.spec.ts, also verified against a production build) |
| UI: English-only chrome (the v1.7 en/zh-CN i18n layer — next-intl, catalogs, language toggle — was removed in v1.9; single locale, no switcher); CJK content (titles, tags, search, IME-safe input) fully supported | Working | plural/sync-summary/generated-names unit tests + E2E (IME renames, themes labels) |
| PWA install (Linux + Android), offline SW | Working | E2E asset checks |
| Hardened platform: autosave verifies the write landed (no false "Saved"), failed boots offer Retry, shape library survives reloads, recordings survive mic failures and minute-collisions, e2e hooks require a `NEXT_PUBLIC_E2E=1` build, pdfjs-dist pinned to the vendored worker with a drift test, `next build` fails on type errors | Working | hardening/boot-retry/save-content/reveal-focus unit tests + recorder-library/state-freshness E2E |
| OneNote migration runbook (manual + Microsoft Graph script) | Documented | docs/onenote-migration.md, scripts/graph-export.mjs |
| Sync & collaboration research (CRDT survey, file-based sync, E2EE server, phased plan) | Documented | docs/sync-research.md |
| CI: lint, typecheck, unit tests, build, smoke boot, browser E2E | Required checks on every PR | GitHub Actions |
| File-based sync (phase 1): folder/ZIP export + merge, conflict copies, purge tombstones, foreground re-scan; out-of-contract folders heal (a stale page file + its tombstone merges as deleted — restorable, never resurrected) | Working | 56 sync unit tests (46 + 10 in sync-fsa/sync-merge) + 5 E2E checks (e2e/sync.spec.ts) |
| Desktop shell (Tauri 2): static-export build path, `src-tauri/` config + icons, Linux artifact workflow | Working — export build verified; binaries built by CI on `main`/tags | desktop-config unit tests + `.github/workflows/desktop.yml` (docs/desktop.md) |
| Android TWA: wrapper scaffold (Gradle/manifest/resources) + tested assetlinks.json generator | Working — generator CLI verified; APK built per docs/android-twa.md on a contributor machine | assetlinks + android-config unit tests, `scripts/generate-assetlinks.mjs`, `android-twa/`, docs/android-twa.md |
| Flatpak packaging: AppStream metainfo, flatpak-builder manifest (extra-data AppImage), extradata pinning tool, Flathub runbook | Working — recipe pinned by unit tests; checksums pinned after each release by scripts/flatpak-extradata.mjs | packaging-config unit tests, `packaging/flatpak/`, `scripts/flatpak-extradata.mjs`, docs/flathub.md |
| F-Droid packaging (issue #56): build metadata YAML, versionCode scheme (major×100+minor×10+patch), fdroid-check validator, runbook | Working — metadata + tool verified by 21 unit tests + a real CLI run | fdroid-config unit tests, `packaging/fdroid/`, `scripts/fdroid-check.mjs`, docs/fdroid.md |

**Totals: 564 unit tests, 152 Playwright E2E tests (required in CI), 0 known bugs, 0 TODOs in `src/`.**

## In flight

- **v1.11.1 patch — desktop artifact glibc fix (#164) + README rework (#165)**:
  the v1.11.0 AppImage bundled libraries from the ubuntu-latest runner
  (glibc 2.43) and failed to launch on Ubuntu 24.04 / Debian 13 / Mint 22
  (silent dynamic-linker abort — "double-click does nothing"). Fix: Desktop
  workflow pinned to ubuntu-22.04 (glibc 2.35 floor), a post-build guard that
  extracts the AppImage and fails on any GLIBC requirement above the floor,
  the trigger/test pins (the trigger was correct on disk all along — the suspected corruption was an output-display artifact; see the worklog addendum), a full README rework (real test counts, AppImage install +
  troubleshooting) and an end-user troubleshooting section in docs/desktop.md.
  Verified by a dispatched Desktop workflow run on the fix branch before
  merge; shipped as v1.11.1 with rebuilt artifacts.
  Next per the roadmap: the v1.12 handwriting-recognition research (#133).

## Next up — v1.10 (see [docs/ROADMAP.md](docs/ROADMAP.md))

1. Bundled-asset TWA (WebViewAssetLoader) for full F-Droid offline compliance (#64)
2. Drawing shape library beyond Excalidraw defaults (#65)

## Repo map (30 seconds)

| Path | What it is |
|---|---|
| `src/lib/types.ts` | Data model: Notebook/Section/Page, BackupFile |
| `src/lib/notes-db.ts` | Dexie schema + CRUD + trash cascade + backup/restore |
| `src/lib/tree-ops.ts` | OneNote-style selection semantics after delete |
| `src/lib/search.ts` | Scene text extraction + ranked search |
| `src/lib/store.ts` | Zustand store, single-flight load, welcome seed |
| `src/lib/excalidraw-utils.ts` / `-client.ts` | SSR-safe canvas API contract / browser runtime |
| `src/lib/docx-import.ts` / `html-import.ts` / `import-blocks.ts` | OneNote phase-1 importers: Word + HTML → structured text blocks |
| `src/lib/tags.ts` | Page tags: normalization, dedupe, collect + filter helpers |
| `src/lib/quick-notes.ts` | Quick capture: date keys, quick-note/daily-page titles |
| `src/lib/audio-notes.ts` | Audio blocks: classification, recorder mime/extension picking, duration + filename helpers, link-scheme markers, import size cap (issue #67, #91, #95) |
| `src/lib/generated-names.ts` + `src/lib/e2e-gate.ts` | Generated names, English set (issue #63) + e2e-hook build gate (issue #102) |
| `src/lib/pdf-layout.ts` | Print pagination math: page bands, box banding, text line flow |
| `src/lib/pdf-export.ts` | jsPDF renderer: A4 sheets, vector text, clipped slices, paper + footer |
| `src/lib/mht-import.ts` | OneNote phase-2: `.mht` MIME parser (QP/base64 parts, cid/location map) |
| `src/lib/sync/` | File-based sync phase 1: folder format, merge engine (LWW + conflict copies), runSync, ZIP + File System Access adapters, folder-handle state |
| `src/components/notes/sync-dialog.tsx` | Sync UI: connect folder / Sync now / merge or download sync ZIP, change summary |
| `scripts/graph-export.mjs` | Microsoft Graph OneNote export → self-contained HTML per page |
| `src/components/notes/*` | App UI: sidebar, search, trash, canvas wiring |
| `src/app/` | Next.js App Router entry + layout |
| `public/` | PWA manifest, service worker, icons, self-hosted Excalidraw fonts, pdf.js worker |
| `e2e/` + `playwright.config.ts` | Playwright E2E suite — 34 checks, runs in CI (issue #3) |
| `.github/workflows/ci.yml` | CI: lint-typecheck-test + build-smoke (required) |
| `docs/` | Architecture, roadmap, decisions, pipeline |
| `.agents/skills/` | Vendored agent-engineering skill set (mattpocock/skills, MIT) — repo tooling for AI-assisted development, not app code |

## Commands cheat-sheet

```bash
bun install                            # first-time setup
bun run dev                          # dev server on :3000
make test                            # 564 unit tests
make e2e                             # 152 E2E tests (Playwright; boots the app if needed)
make status                          # quick status snapshot (this file's head + git info)
```

## Recent history

- **2026-11-09 — verification pass on the top-2 features + E2E click
  hardening**: full gate re-run on the merge state of #154/#155 —
  lint/typecheck clean, 531/531 unit, E2E in CI mode (production build,
  workers=2, retries=1) 140/140 first-try, both feature specs green in
  isolation. Two dev-mode-only flakes hardened the #152 way (both
  once-only clicks inside open Radix dialogs under the
  memory-constrained serial dev-server run): the bulk-move target row
  (the freshly-opened dialog's overlay once intercepted the click for
  the whole action timeout) and the sync ZIP download (click once
  silently dropped) now retry — final attempt uncaught, assertions
  unchanged. Stale cheat-sheet counts corrected (451/122 → 531/140).
- **2026-11-09 — OneNote-style PDF file chips (fully TDD)**: user
  requirement — a PDF printout must carry a small file icon with its name,
  and right-clicking it must offer multiple options incl. downloading the
  file. Design mirrors the audio embeddables (#67): an Excalidraw
  embeddable whose `link` carries the `infinitenote:pdf` marker scheme
  (survives link sanitization) and whose `customData` holds the payload —
  the ORIGINAL file bytes as a data: application/pdf URL — so the chip
  moves/zooms/exports/restores like any element and the file stays
  downloadable byte-exactly, offline, forever. Right-click is intercepted
  in the capture phase on the canvas wrapper (client → scene coords via
  Excalidraw's own transform helper, rotation-exact hit-test — React
  bubbles contextmenu at the app root, so the wrapper capture provably
  beats both the native and Excalidraw menus). Menu: View file (blob URL,
  new tab), Download file (the proven downloadBlob), Copy file name
  (clipboard + toast). 10 MiB attachment cap checked BEFORE scene mutation
  (audio #91 stance): oversized PDFs keep importing as plain printouts +
  skip toast. One updateScene per import → single undo removes chip+pages.
  Chip names searchable (audio-name parity). Plan-first: docs/test-plans/
  pdf-attachment.md; +29 unit (564) incl. rotation-exact hit-testing and
  base64→Blob byte-exactness; +11 E2E (152) incl. the byte-exact download
  round-trip and the oversized skip; count cascades updated in
  imports/import-overlay/import-pdf-truncation specs (+1 element each).
  Env findings: headless Chromium needs clipboard-write permission grants
  and cannot commit top-level blob: PDF navigations (assertions adjusted;
  headed Chrome renders the viewer).
- **2026-11-09 — German OCR model swap (fully TDD)**: user requirement
  "OCR must understand German too." Probed the real tesseract.js 6.0.1 with
  the vendored `.traineddata.gz` bytes: the combination modes `eng+deu` /
  `deu+eng` let the English model outvote the umlauts away (Ä→A, Ö→O, Ü→U —
  1/9 and 3/9 German probe words correct), while the single German fast
  model aced all nine German probes AND every English probe. `deu` now
  drives the engine; `eng` is dropped (−1.98 MB). New: OCR-L01/L02 policy
  exports, OCR-A05 policy↔manifest drift guard, OCR-A06 driver drift guard,
  OCR-E05 German E2E (GÄSTEBUCH / MÜNCHEN STRAßE fixture, umlauts intact
  through engine→customData→search); OCR-E02 (English) unchanged as the
  regression net and still green. +4 unit (535), +1 E2E (141).
- **2026-11-09 — On-device OCR for images & PDF printouts (fully TDD)**:
  "Recognize text in images" (Page actions ⋯) makes imported images and
  PDF printouts full-text searchable. The engine (tesseract.js 6.0.1 +
  LSTM cores + English fast model, ≈10 MB) is vendored under `public/ocr/`
  — no CDN at any point, cache-first via the service worker after first
  use (offline-first / F-Droid stance); a sha256 manifest with drift tests
  pins every byte. Results attach to the scene (`customData.ocrText`,
  whitespace-normalized, surrogate-safe 20k cap) and flow into the existing
  search index as content. Unit tests drive an injected engine (the wasm
  never runs in unit tests); the E2E runs the REAL engine against a
  committed fixture ("QUOKKA NOTEBOOK") and proves the whole path:
  import → recognize → search hit → reload persistence. +35 unit (531),
  +4 E2E (140).

- **2026-11-09 — Page version history (fully TDD)**: a local, per-page
  timeline of scene snapshots with point-in-time restore (OneNote "page
  versions" parity). New `pageVersions` table (Dexie schema v3, additive —
  a v2 database upgrades in place, test-pinned), a pure policy module
  (interval-throttled auto snapshots gated by the autosave gate's own
  structural fingerprint, FIFO pruning, locale-free relative times), a
  History dialog behind one "Page actions" (⋯) menu button (the title bar
  stays overlap-audit-clean), and restore via flush → pre-restore safety
  snapshot → DB write → canvas remount. TDD: the full matrix
  (docs/test-plans/version-history.md — 30 policy + 13 data-layer + 5 E2E
  cases) was written first and watched fail, then implemented to green;
  the E2E also exposed the dialog-close click-swallow fixed in #153.
  +35 unit (496), +5 E2E (136).

- **2026-11-09 — closing a dialog no longer swallows the next click**: the
  first canvas interaction within ~100 ms of closing any dialog was silently
  dropped. Two stacked causes, both fixed: Radix keeps `pointer-events:
  none` on `<body>` until the exit-animated layer unmounts (the Dialog and
  Sheet wrappers now clear it the moment `open` flips false), and the
  closing overlay itself still carried an inline `pointer-events: auto`
  (a `!important` closed-state rule in globals.css, modal overlays only).
  Found by the new version-history E2E while it drove the canvas right
  after a dialog close; regression-pinned by e2e/dialog-close-click.spec.ts
  (style probe + functional raw click). +1 E2E check (131).
- **2026-11-09 — proactive investigation cycle (#148/#149/#150)**: probe-first
  sweep of three untouched surfaces in the established style. (1) Console
  sweep: a scripted driver exercised 16 flow phases (draw, CJK text,
  rename, undo/redo, shapes, image/text/Markdown/audio/PDF imports, PNG
  export, search, tags, trash, themes, quick note, shortcuts, paper
  style, reload) capturing every console warning/error — **clean**; the
  scary-looking click-blocker cascade during probing was root-caused to
  probe artifacts (an open Radix menu blocks outside pointer events by
  design; wrong shape testids), not an app defect. (2) Sync deep-dive
  (#148): the merge's remote-only branch ignored remote tombstones, so a
  folder carrying BOTH a stale page file and its tombstone (partial
  replication, crashed write, or a zero-page write whose cleanup was
  skipped) resurrected deleted pages on every fresh device; both halves
  fixed (shared `applyRemoteTombstone`, unconditional stale-file
  cleanup) with 10 unit + 1 E2E regressions. (3) Focus management
  (#149/#150): every controlled dialog, the mobile drawer and the
  rename editor dropped focus to `<body>` on close (WCAG 2.4.3); a
  global outside-focus memory restores it, and the rename fix uncovered
  a keydown-activation subtlety (React flushes the focus-return effect
  inside the Enter dispatch — `preventDefault` keeps the browser from
  clicking the newly focused title button) with 9 E2E regressions.
  461 unit + 122 E2E green on develop.
- **2026-11-08 — app-surface sweep (follow-up to the overlap audit in the
  same style: probe first, then fix, then pin)**: extended the
  five-viewport overlap audit from app chrome to EVERY first-party
  surface — six dialogs, five dropdown menus, the tag popover, page-row
  context menus and the mobile navigation drawer — plus a
  zero-console-error guard across the whole run (clean). Four real
  defects fixed: (1) the search dialog's input ran under its close
  button, so a click near the input's right edge closed the dialog and
  lost the query — the input row now keeps clear of the X (pinned by a
  mis-click E2E); (2) the mobile drawer's close X sat on top of the
  "Add notebook" button — the sheet content now starts below it; (3)
  the export menu's PDF flyout submenu flipped off-screen left below
  ~640px, making both orientations unreachable on phones — at mobile
  widths the orientations flatten into plain menu items; (4) the trash
  dialog's row forced the dialog wider than a 320px viewport (Radix
  ScrollArea's table-layout viewport measures at preferred width) and
  its purge button was an unnamed icon — plain overflow container +
  aria-label. Also: the header's Search/Import/Export triggers keep
  accessible names below sm/lg (icon-only but labeled), and the search
  dialog no longer rebuilds its full-page JSON.parse index on every
  keystroke (index memo split from the query memo). 451 unit + 120 E2E
  green (dev + production build for the new spec).
- **2026-11-08 — save-indicator calm pass (user report: "Saved" flickered;
  "check if any buttons overlap")**: Excalidraw's onChange fires for
  appState-only updates (pan, zoom, selection, tool switches) and each one
  used to schedule an autosave of identical content — every viewport
  interaction blinked the indicator. Autosave is now gated on a
  `sceneSignature` (id@version:status per element + file set,
  order-independent) primed from `initialData`; a scene that returns to the
  persisted state (edit undone inside the debounce window) drops its pending
  stash instead of letting a stale timer write it; the "Saving…" label is
  deferred 200ms so fast IndexedDB commits never flash it. Root-causing the
  undo path found a real data bug: onChange delivers `isDeleted` tombstones
  (undo/redo leftovers), and they were persisted — `sanitizeScene` now drops
  them (and their files), so DB rows, sync folders and backups stop
  accumulating invisible garbage; tombstone-polluted pages self-heal through
  one normalizing save. The new five-viewport chrome overlap audit found one
  real defect: below 360px the header pushed the theme toggle past the
  viewport edge — it now yields below 360px (theming stays reachable via the
  sidebar gallery). New tests: 10 sceneSignature + 5 structural-fingerprint + 2
  tombstone-filter unit tests; E2E `save-indicator-calm.spec.ts` (organic autosave, steady label,
  undo-never-persists) and `ui-overlap.spec.ts` (1280/900/768/390/320 audit);
  dev probes `scripts/flicker-probe.ts` (50ms label sampling) and
  `scripts/header-probe.ts` (320px header boxes). 451 unit + 114 E2E green.

- **2026-11-08 — full import/export verification pass**: every transfer
  surface now has content-level E2E. New e2e/import-export-roundtrip.spec.ts
  (8 checks): PNG export bytes (magic + IHDR + non-stub size), SVG export
  markup (typed text survives as vector text), .excalidraw scene export →
  re-import round-trip (elements, typed text, image dataURL, persistence),
  full-backup export → wiped app → UI restore round-trip (tree + content
  intact), and the wrong-file restore error toast. Two fixes fell out of the
  pass: restoreBackup now throws a typed RestoreError (code `notABackup`,
  issue #85 parity — expected failures toast without console.error noise),
  and the shared createTextElement e2e helper clicks right of the Shapes
  island, killing a full-suite flake in state-freshness.spec. 434 unit +
  107 E2E green.
- **2026-11-08 — v1.10.0 released**: release PR #131 merge-committed to main
  (9ee3809), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.10.0)
  and published; v1.10.0 milestone closed (#64/#65/#122/#123), v1.11.0 opened
  with the handwriting recognition research issue (#133). Ships the curated
  shape library (#65), the bundled-asset Android TWA (#64), and the
  manual-pass fixes (#122 pending-status invariant + single-sourced drops,
  #123 last-opened page restore).
- **2026-11-07 — v1.9.0 released**: release PR #119 merge-committed to main
  (1797bb2), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.9.0)
  and published; v1.9.0 milestone closed (#117), v1.10.0 opened with
  #64/#65. The release ships exactly one change — the English-only
  interface — deliberately small and easy to review.
- **2026-11-07 — English-only interface (#117, PR #116)**: the v1.7 next-intl
  layer (en/zh-CN catalogs, provider, sidebar Language toggle, locale-aware
  generated names) removed end to end, net −1,607 lines. English literals at
  every call site, a tiny `plural()` helper for ICU plurals, labels moved
  into the shortcuts/themes data modules, export/sync error codes mapped to
  English messages, sync summaries via `formatSyncSummary()`. CJK *content*
  support kept (IME-safe input, CJK layout/footers/filenames,
  surrogate-safe truncation). Also fixed the #94 no-page toast that
  referenced a catalog key that never existed. 401 unit + 86 E2E green.
- **2026-11-07 — v1.8.0 released**: release PR #115 merge-committed to main
  (2cea610), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.8.0)
  and published — audio blocks (#67), the full import-overlay matrix (#68),
  localized seed (#63) and bug-hunt waves 1–2 (35 fixes); v1.8.0 milestone
  closed (33 issues).

- **2026-11-07 — Bug-hunt wave 1 (issues #72–#75)**: a full audit (gates +
  manual code review of audio/imports/exports/sync/i18n) surfaced four real
  defects, all fixed in one PR: exports captured stale mount-time
  title/paper (#72 — latest-value refs in the canvas api surface), canvas
  import toasts were hardcoded English (#73 — new `canvas.*` message
  namespace, en + zh-CN), non-ASCII page titles collapsed to "untitled" in
  export filenames (#74 — Unicode-aware `titleToFilename` + shared
  `downloadBlob` for backups), and PDF printout imports silently truncated
  at the 20-page cap (#75 — explicit "first 20 of N pages" notice, blank
  text files no longer counted as imported). +10 unit tests (368), +7 E2E
  checks (85).
- **2026-11-07 — v1.7.0 released**: release PR #62 merge-committed to main
  (60e9d3a), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.7.0)
  and published with release notes; v1.7.0 milestone closed, v1.8.0 opened
  with issues #63/#64/#65 from the backlog. The v1.7 cycle shipped i18n
  (#54/#58), the themes gallery (#55/#59) and the F-Droid recipe (#56/#60) —
  326 unit tests, 65 E2E checks, all required CI green on every PR.
- **2026-11-07 — Themes gallery (issue #55)** — six accent themes (violet
  default, ocean, forest, sunset, rose, graphite) layered over light/dark
  via `data-theme` on `<html>`: pure catalog (`lib/themes.ts`), sidebar
  gallery dialog with live light/dark swatches, pre-paint restore script in
  the root layout, persisted choice, full en/zh-CN catalogs. 19 new unit
  tests (+4 E2E checks). PR #59.
- **2026-11-07 — F-Droid recipe (issue #56)** — `packaging/fdroid/`
  build metadata, `scripts/fdroid-check.mjs` validator (required fields,
  versionCode scheme major×100+minor×10+patch, ascending builds, tag refs),
  cross-file version parity with the TWA scaffold pinned by 21 unit tests,
  `docs/fdroid.md` runbook (fdroidserver test-build → fdroiddata submission
  → policy notes incl. the bundled-asset TWA follow-up). PR #60.
- **2026-11-07 — housekeeping (#57)** — development journal is now a tracked
  file (`docs/WORKLOG.md`); gitignore/AGENTS updated so working state can
  never silently live in untracked files; roadmap v1.6/v1.7 sections
  refreshed with issue ties.
- **2026-11-07 — UI i18n (issue #54)** — the whole app chrome speaks English
  and 简体中文: message catalogs with ICU plurals for both locales, a client
  AppI18nProvider (localStorage-persisted locale + browser detection + `<html
  lang>` sync, no i18n routing — works in the static Tauri export), a
  Language toggle in the sidebar footer, localized shortcuts cheatsheet
  (data now carries stable ids) and localized sync change summaries
  (describeSummary → pure summaryParts + formatter hook). Catalog parity
  (key sets, non-empty values, placeholder sets) is enforced by unit tests.
  Generated data names ("Quick Notes" notebook, dated quick-note titles)
  stay English until a stable quick-notes marker exists — tracked in the
  backlog. 286 unit tests (+20), 61 E2E checks (+5).

- **2026-11-07 — v1.5.0 live**: release PR #42 merge-committed to main (c70513f),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.5.0);
  v1.5.0 milestone closed, v1.6.0 milestone opened. Issues #36/#37 closed.
- **2026-11-07 — sync UI (issue #37)** — Sync dialog in the sidebar footer:
  connect a sync folder (File System Access, Chromium desktop) with
  "Sync now" + background re-scan on window focus, or download/merge a sync
  ZIP on any browser (fflate, loaded on demand). Merges surface a change
  summary; the open page reloads after a sync without flushing stale
  canvas state. 227 unit tests (+4), 56 E2E checks (+4).
- **2026-11-07 — sync engine re-landed (issue #36, PR #39)** — #38 merged
  empty due to a sandbox glitch (branch ref reset before the PR opened);
  #39 re-landed the identical engine: folder format, three-way merge with
  conflict copies, purge tombstones, Dexie v2, runSync. 42 unit tests.
- **2026-11-06 — v1.4.0 live**: release PR #34 merge-committed to main (cf99ae4),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.4.0);
  v1.4.0 milestone closed, v1.5.0 milestone opened. Issues #27/#28/#29 closed.
- **2026-11-06 — sync & collaboration research (issue #29)** —
  docs/sync-research.md: why snapshot/LWW sync cannot work for scenes,
  Yjs-vs-Automerge survey (recommendation: Yjs for the no-WASM,
  any-transport update-log fit), Option A file-based sync folder design
  (manifest + per-page docs, phased: conflict copies → CRDT merge), Option B
  self-hostable E2EE blob server (Argon2id passphrase → wrapped content
  keys, blind server), shared-notebook scoping, and a v1.5/v2.0/post-2.0
  phased plan. Docs-only; no runtime changes.
- **2026-11-06 — shortcuts cheatsheet (issue #28)** — `?` (Shift+/) or
  Ctrl/Cmd+/ (and the sidebar footer button) opens a grouped cheatsheet:
  General (search, quick note, dialogs), Organizing (rename), Canvas tools
  and Canvas editing — every entry verified against the real handlers (tool
  keys probed through the embedded Excalidraw appState; ⌘/Ctrl rendered per
  platform). 181 unit tests (+11), 52 E2E checks (+3).
- **2026-11-06 — sidebar multi-select (issue #27)** — a list-checks toggle in
  the sidebar header turns on checkbox selection for page rows (clicking a
  row toggles instead of navigating); the bulk bar offers select-all scoped
  to expanded sections, "Move to…" (any section, cross-notebook, appended in
  sidebar-visible order, no-op targets disabled) and "Delete" (soft delete
  with one shared timestamp). The open page follows a bulk move; bulk delete
  recomputes the selection so it never lands on a deleted page. 170 unit
  tests (+26), 49 E2E checks (+4).

- **2026-11-06 — v1.3.0 live**: release PR #25 merge-committed to main (f3e154d),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.3.0);
  v1.3.0 milestone closed, v1.4.0 milestone opened. Issues #18/#19/#20 closed.
- **2026-11-06 — paginated PDF export (issue #20)** — "Export → PDF — print
  (A4)" renders the scene onto fixed A4 portrait/landscape sheets: content is
  scaled to the printable width and sliced into page bands; images and shapes
  print as continuous clipped slices across pages while text flows line-by-line
  (never cut mid-glyph) as selectable vector Helvetica; rotated elements and
  non-Latin text fall back to 2× raster snippets; paper style (ruled/grid) and
  a title/page-number footer are drawn per sheet; always light paper. New dep:
  jspdf (loaded on demand). 144 unit tests (+16), 45 E2E checks (+3).
- **2026-11-06 — quick notes + Today page (issue #19)** — "Quick note" button in
  the sidebar and Ctrl/Cmd+Alt+N append a dated page to an auto-bootstrapped
  "Quick Notes" notebook/section and focus the canvas for typing; a pinned
  **Today** entry opens (or creates) the daily page named after the local date,
  reusing it all day. Quick notes are ordinary pages — search and tags see them.
  128 unit tests (+17), 42 E2E checks (+4).
- **2026-10-19 — v1.3 starts: page tags (issue #18)** — tag picker in the page
  header (chips + quick-add), tag chips on sidebar page rows, a cross-notebook
  tag filter view, search matches tags; backup/restore now also preserves
  paper style (pre-existing gap found while wiring tags through). 111 unit
  tests (+14), 38 E2E checks (+4).
- **2026-10-19 — v1.2.0 live**: release PR #16 merge-committed to main (aae09ed),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.2.0);
  v1.2.0 milestone closed, v1.3.0 milestone opened.
- **2026-10-19 — v1.2.0 release**: OneNote import phase 2 merged via PR #14
  (all three required CI checks green); version bumped to 1.2.0.
- **2026-10-19 — v1.1 close-out PR**: OneNote import phase 2 — `.mht` single-file
  pages with embedded images (placed between text blocks), HTML `data:`-image
  import, Microsoft Graph export runbook + script; page paper styles
  (plain/ruled/grid) with a viewport-synced ruled overlay. 97 unit tests
  (22 new), 34 E2E checks (8 new).
- **2026-10-19 — v1.1.0 live**: release PR #10 merge-committed to main (a2ec743),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.1.0);
  v1.1.0 milestone closed, v1.2.0 milestone opened.
- **2026-10-19 — v1.1.0 release**: 4 PRs — duplicate page (#5), Playwright E2E
  required in CI (#6), OneNote import phase 1 (#7), scaffolding cleanup (#8).
  75 unit tests, 26 E2E checks, three required CI checks.
- **2026-10-19 — scaffolding cleanup**: unused Prisma/template leftovers removed;
  `bun install` is now the only setup step and CI no longer generates a client.
- **2026-10-19 — OneNote import phase 1 (issue #4)**: Word (`.docx`) and OneNote-HTML
  pages import as structured text blocks (headings, nested lists, tables); pure
  extractors, 26 new unit tests, 2 new E2E checks, migration guide added.
- **2026-10-19 — E2E in CI (issue #3)**: the 34-check agent-browser shell harness
  became a 24-check Playwright suite (7 parallel spec files, deterministic
  `resetToSeed`, console-error guard) that CI runs against the production build.
- **2026-10-19 — duplicate page**: first feature PR through the full pipeline (branch →
  PR → required CI checks → squash merge into `develop`, closes #2). 49 unit tests.
- **2026-10-19 — v1.0.0**: First public release. Full app, tests, CI pipeline,
  branch protection, release flow (see GitHub Releases for notes).
- **2026-10-19 — bootstrap**: repository moved to GitHub, pro pipeline established
  (PR flow, required checks, docs, status system).

## Update protocol

1. Every PR updates the relevant row(s) above (or `In flight` / `Next up`).
2. On merge, refresh `Last updated` and `Recent history`.
3. `In flight` must always name the branch or issue currently being worked on.