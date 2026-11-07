# Project Status

> **READ THIS FIRST.** This file is the single source of truth for "where does the
> project stand". It is small on purpose: humans and AI agents should get a complete
> picture in ~2 minutes without reading the codebase. Every merged PR must update it.

| | |
|---|---|
| **Last updated** | 2026-11-08 |
| **Current version** | v1.9.0 (tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.9.0)) |
| **Phase** | v1.9.0 shipped — v1.10.0 open (features #64/#65) |
| **Overall state** | 401 unit + 86 E2E green; 0 known bugs |

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
| Autosave + persistence across reloads | Working | E2E (autosave, flush-on-switch) |
| Page paper styles: plain / ruled / grid, persisted, zoom/pan-synced | Working | E2E background.spec (6 checks) |
| Imports: image, text, Markdown, PDF printout (20-page cap **with an explicit truncation notice**), `.docx`, OneNote HTML, **OneNote `.mht` with embedded images**, `.excalidraw`, **audio** — all types at once on one canvas, then ink + text on top; import toasts with explicit feedback | Working | 36 E2E checks with fixture files (incl. e2e/import-overlay.spec.ts, e2e/import-pdf-truncation.spec.ts) |
| Exports: PNG, SVG, .excalidraw, **paginated PDF (A4 portrait/landscape — vector text, sliced images, paper-aware, audio blocks as labeled player strips, non-Latin footer titles rasterized, unrotated shapes as true vectors)**, notebook backup — filenames follow the current page title (renames included) and keep CJK/Unicode characters; export errors are localized toasts | Working | 19 policy unit tests + 6 E2E checks (e2e/pdf-export.spec.ts, e2e/pdf-wave2.spec.ts) + e2e/export-filename.spec.ts |
| Cross-page search (Ctrl+K — content index reloads on every open), trash restore/purge (list refreshes live), search/tag jumps reveal their target in a collapsed tree | Working | Unit + 6 E2E checks (search-trash, state-freshness specs) |
| Page tags: add/remove in header, sidebar chips, tag filter view, search | Working | 14 unit tests + 4 E2E checks |
| Audio blocks (issue #67): import audio files + in-app recording (MediaRecorder), playable `<audio>` players on canvas, draw over clips, persisted via customData payload | Working | 31 unit tests + 7 E2E checks (e2e/audio.spec.ts) |
| Quick capture: "Quick note" button + Ctrl/Cmd+Alt+N, pinned Today daily page | Working | 17 unit tests + 4 E2E checks |
| Themes gallery (issue #55): six accent themes over light/dark, live swatches, persisted + pre-hydration restore, localized labels | Working | 19 unit tests + 4 E2E checks (e2e/themes.spec.ts) |
| Sidebar multi-select: checkboxes, select-all (expanded sections), bulk move (cross-notebook) + bulk delete → trash | Working | 26 unit tests + 4 E2E checks |
| Keyboard shortcut cheatsheet (? / Ctrl+Cmd+/, sidebar button, platform-aware ⌘/Ctrl) | Working | 11 unit tests + 3 E2E checks |
| Dark mode, mobile drawer navigation | Working | E2E + visual review |
| UI: English-only chrome (the v1.7 en/zh-CN i18n layer — next-intl, catalogs, language toggle — was removed in v1.9; single locale, no switcher); CJK content (titles, tags, search, IME-safe input) fully supported | Working | plural/sync-summary/generated-names unit tests + E2E (IME renames, themes labels) |
| PWA install (Linux + Android), offline SW | Working | E2E asset checks |
| Hardened platform: autosave verifies the write landed (no false "Saved"), failed boots offer Retry, shape library survives reloads, recordings survive mic failures and minute-collisions, e2e hooks require a `NEXT_PUBLIC_E2E=1` build, pdfjs-dist pinned to the vendored worker with a drift test, `next build` fails on type errors | Working | hardening/boot-retry/save-content/reveal-focus unit tests + recorder-library/state-freshness E2E |
| OneNote migration runbook (manual + Microsoft Graph script) | Documented | docs/onenote-migration.md, scripts/graph-export.mjs |
| Sync & collaboration research (CRDT survey, file-based sync, E2EE server, phased plan) | Documented | docs/sync-research.md |
| CI: lint, typecheck, unit tests, build, smoke boot, browser E2E | Required checks on every PR | GitHub Actions |
| File-based sync (phase 1): folder/ZIP export + merge, conflict copies, purge tombstones, foreground re-scan | Working | 46 sync unit tests + 4 E2E checks (e2e/sync.spec.ts) |
| Desktop shell (Tauri 2): static-export build path, `src-tauri/` config + icons, Linux artifact workflow | Working — export build verified; binaries built by CI on `main`/tags | desktop-config unit tests + `.github/workflows/desktop.yml` (docs/desktop.md) |
| Android TWA: wrapper scaffold (Gradle/manifest/resources) + tested assetlinks.json generator | Working — generator CLI verified; APK built per docs/android-twa.md on a contributor machine | assetlinks + android-config unit tests, `scripts/generate-assetlinks.mjs`, `android-twa/`, docs/android-twa.md |
| Flatpak packaging: AppStream metainfo, flatpak-builder manifest (extra-data AppImage), extradata pinning tool, Flathub runbook | Working — recipe pinned by unit tests; checksums pinned after each release by scripts/flatpak-extradata.mjs | packaging-config unit tests, `packaging/flatpak/`, `scripts/flatpak-extradata.mjs`, docs/flathub.md |
| F-Droid packaging (issue #56): build metadata YAML, versionCode scheme (major×100+minor×10+patch), fdroid-check validator, runbook | Working — metadata + tool verified by 21 unit tests + a real CLI run | fdroid-config unit tests, `packaging/fdroid/`, `scripts/fdroid-check.mjs`, docs/fdroid.md |

**Totals: 401 unit tests, 86 Playwright E2E checks (required in CI), 0 known bugs, 0 TODOs in `src/`.**

## In flight

- Bug-hunt wave 1 (issues #72–#75) and **wave 2** (issues #63, #77–#105,
  #107) are fixed on `develop`. Wave 2 shipped as six PRs (#106–#112):
  state/data integrity (boot retry, honest autosave, fresh search/trash,
  focus + reveal), PDF fidelity (audio blocks, CJK footers, vector shapes,
  capped printouts, localized errors), imports (CJK-aware layout, SVG
  fallback, docx hard breaks, audio size cap, batched updates), recording +
  library (onerror handling, no-page guard, seconds-resolution names,
  library restore), i18n (localized generated names + seed, IME-safe
  Enter, surrogate-safe truncation) and hardening (localized sync errors,
  tag feedback, flag-gated e2e hooks, pinned pdf.js, honest build,
  folder-init sync). Every fix carries unit and/or E2E regression coverage.

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
make test                            # 401 unit tests
make e2e                             # 86 E2E checks (Playwright; boots the app if needed)
make status                          # quick status snapshot (this file's head + git info)
```

## Recent history

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