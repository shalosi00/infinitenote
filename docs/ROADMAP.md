# Roadmap

Progress is tracked in [PROJECT_STATUS.md](../PROJECT_STATUS.md) and GitHub
milestones/issues. This file is the plan; the status file is the reality.

## v1.0.0 — Foundation release (shipped 2026-10-19)

- [x] Notebook → Section → Page hierarchy with rename, reorder, colors
- [x] Infinite canvas (Excalidraw), draw + type on anything
- [x] Autosave with reload persistence
- [x] Imports: image, text, Markdown, PDF printout (multi-page), .excalidraw
- [x] Exports: PNG, SVG, scene JSON, notebook backup / restore
- [x] Cross-page search (Ctrl+K)
- [x] Trash: soft delete, restore, purge
- [x] Dark mode, mobile drawer
- [x] PWA: installable + offline on Linux and Android
- [x] 47 unit tests + 34 E2E checks, lint/typecheck clean
- [x] CI pipeline, branch protection, release flow (v1.0.0 tag + GitHub Release)

## v1.1 — Quality & continuity (shipped in v1.1.0)

- [x] Port E2E suite to Playwright and run it in CI (issue #3)
- [x] OneNote import, phase 1: `.docx` and OneNote-exported HTML import (issue #4)
- [x] OneNote import, phase 2: `.mht` single-file pages with embedded images +
  Microsoft Graph export runbook (issue #12)
- [x] Duplicate page action (shipped to `develop` after v1.0.0; releases with v1.1.0)
- [x] Page templates: plain / ruled / grid paper per page (issue #13)
- [x] Remove unused template scaffolding (`db.ts`, `prisma/`, `api/route.ts`)

## v1.3 — Notebook power features

- [x] Tags / labels on pages with tag filter view (issue #18)
- [x] Quick notes and a "today" smart page (issue #19) — "Quick note" button
  + Ctrl/Cmd+Alt+N, pinned Today daily page
- [x] Print-friendly page export (paginated PDF) (issue #20) — A4
  portrait/landscape, vector text, sliced images, paper-aware
- [x] Multi-select in the sidebar (bulk move/delete) (issue #27) — shipped in v1.4.0
- [x] Keyboard shortcut cheatsheet in-app (issue #28) — shipped in v1.4.0

## Sync & collaboration — research (v1.3–v1.5 planning)

- [x] File-based sync option (export/import with conflict-free merge via CRDT study) — researched in [docs/sync-research.md](sync-research.md); phased plan: page-granular merge with conflict copies (v1.5) → Yjs merge core (v2.0)
- [x] Optional end-to-end encrypted sync backend (self-hostable, opt-in) — design outline in [docs/sync-research.md](sync-research.md) §5; implementation post-2.0
- [x] Shared notebooks (research; depends on sync model) — scoped in [docs/sync-research.md](sync-research.md) §7; blocked on the sync server phase

## v1.5 — File-based sync, phase 1 (shipped in v1.5.0)

- [x] Sync engine: sync-folder format, three-way merge with conflict copies,
      purge tombstones, Dexie v2 (issue #36)
- [x] Sync UI: connect folder (File System Access) or merge via ZIP,
      "Sync now", foreground re-scan, change summaries (issue #37)
- [ ] Yjs CRDT merge core + optional E2EE server (v2.0+ — docs/sync-research.md §8)

## v1.6 — Distribution (shipped in v1.6.0)

- [x] Tauri 2 desktop shell — static-export build path, `src-tauri/` config
      + icons, Linux artifact workflow (issue #44)
- [x] Android TWA project scaffold + tested assetlinks.json generator
      (issue #45)
- [x] Flatpak packaging — AppStream metainfo, flatpak-builder manifest
      (extra-data AppImage), Flathub runbook (issue #46)

## v1.8 — Offline-first Android & canvas depth (shipped in v1.8.0)

- [x] Audio on pages: import audio files + record in-app (issue #67) —
      playable `<audio>` blocks on the canvas (embeddable elements, payload in
      customData + `infinitenote:audio` link marker), draw over clips,
      clip names in full-text search
- [x] Import-matrix overlay E2E: every file type on one canvas, then write &
      draw on top (issue #68) — 36 imported elements in one batch, freedraw
      stroke + text annotation over everything, reload persistence
- [x] Localized first-run seed content + generated page/notebook names
      (issue #63) — shipped by bug-hunt wave 2 (PR #111); the locale layer
      itself was removed again in v1.9 (English-only UI)

## v1.9 — Focus: one language, same depth (shipped in v1.9.0)

- [x] English-only UI — the v1.7 en/zh-CN i18n layer (next-intl, message
      catalogs, language toggle, locale-aware generated names) is removed;
      every string is a plain English literal. CJK *content* (titles, tags,
      search, IME-safe input, CJK-aware import layout, PDF footers) stays
      fully supported.
- [x] English-only UI shipped as PR #116 (issue #117) — see the v1.9.0
      release notes

## v1.10 — Offline-first Android & canvas depth (shipped in v1.10.0)

- [x] Bundled-asset TWA (WebViewAssetLoader) for full F-Droid offline
      compliance (issue #64) — the wrapper serves the static export from
      APK assets (appassets.androidplatform.net) with the deployed PWA as
      fallback (PR #128)
- [x] Drawing shape library beyond Excalidraw defaults (issue #65) —
      curated catalog (blocks, arrow variants, elbow connectors, sticky
      notes with bound labels) inserted as native elements from the header
      toolbar, auto-selected, theme-aware via the current toolbar colors
- [x] Manual-pass fixes from 2026-11-07: imported images can no longer
      persist with a stale "pending" status once their data is saved
      (issue #122) and the app reopens the last-opened page on reload
      (issue #123)

## v1.11 — Recoverable & searchable pages (shipped in v1.11.0)

- [x] Page version history: per-page snapshot timeline (auto ≥ 5 min on
      structural change / manual "Save version now" / automatic pre-restore
      safety copy), restore to any version, 25-per-page FIFO budget,
      newest-first dialog — fully TDD (docs/test-plans/version-history.md)
- [x] OneNote-style PDF file chips: every printout import embeds the
  original bytes in a file-icon chip (badge + file name) above the pages;
  right-click menu with View file / Download file (byte-exact, offline) /
  Copy file name; 10 MiB cap with explicit skip toast; names searchable
  (docs/test-plans/pdf-attachment.md).
- [x] On-device OCR for images & PDF printouts (English + German): tesseract.js vendored under
      `public/ocr/` (no CDN, offline after first use, sha256-pinned),
      "Recognize text in images" makes scanned content full-text searchable
      — fully TDD (docs/test-plans/ocr.md)
- [x] Fix: clicks right after closing a dialog are no longer swallowed
      (Radix body pointer-events + closed-overlay guard; regression-pinned)

## v1.12 — Handwriting recognition (research; shipped 2026-11-10)

- [x] Handwriting recognition research: on-device HTR options for the
      offline-first PWA + Android wrapper, data flow from freedraw strokes,
      privacy stance, recommendation + phased plan (issue #133) —
      [docs/handwriting-research.md](handwriting-research.md);
      recommendation: pursue in phases — Phase A handwriting search via
      trocr-small-handwritten (≈64 MB quantized ONNX, MIT, lazy-loaded),
      Phase B ink-to-text gated on Phase A accuracy; cloud, proprietary
      (MyScript) and OS-API-only (WICG) paths rejected; CJK deferred

## v1.13 — Handwriting search (shipped in v1.13.0)

- [x] Phase A — handwriting search (metadata-only): explicit per-page
      "Recognize handwriting (English)" action, union-find line
      segmentation from freedraw geometry, height-normalized rasterizer,
      vendored trocr-small-handwritten ONNX (q8 ≈ 64 MB, first use,
      sha256-pinned, no CDN), recognized text stored as machine-generated
      stroke metadata and indexed by the existing full-text search
      (docs/test-plans/handwriting.md; issue #175 — shipped 2026-11-10)
- [x] Phase B — ink-to-text conversion (issue #176, shipped 2026-11-11):
      "Convert handwriting to text" turns each recognized line into a
      real, editable Excalidraw text element at the ink's position while
      keeping the strokes (OneNote behavior); per-page and per-group
      (selection-scoped) conversion, no new model or engine calls —
      reuses the stored recognition metadata; idempotent by structural
      detection (a text element at the line's position = converted), one
      native scene update = one undo step (docs/test-plans/handwriting.md
      Phase B section, incl. the measured Excalidraw 0.18 captureUpdate
      and post-undo store findings)

## v1.14 — Hardening & acceleration (current)

- [x] Independent verification of the v1.13.0 desktop artifacts (issue #194,
      shipped 2026-11-12): fresh AppImage download re-verified — valid type-2
      runtime + FUSE-less extraction, 174 bundled ELFs objdump-scanned with
      overall max GLIBC_2.35 (main app binary 2.34, nothing over the floor),
      .desktop entry + icons correct, versionCode 230 / 1.13.0 parity across
      all six version files, and the vendored handwriting model confirmed
      embedded in the Tauri binary (all 10 public/hwr/ asset paths — the
      model ships with the app, nothing downloads at runtime). Evidence
      table: docs/desktop.md "Artifact verification log"
- [ ] WebGPU handwriting acceleration — measure first, gate on capability
      (issue #193): benchmark per-line recognition WASM vs WebGPU on
      representative hardware and record the evidence table before any
      WebGPU path ships; `navigator.gpu` adapter probe with silent WASM
      fallback (identical results either way); on-device privacy invariant
      and the zero-cross-origin E2E tripwire unchanged; non-goals: CJK
      (deferred), vendored model unchanged

## v1.7 — Internationalization & polish (shipped in v1.7.0)

- [x] i18n with next-intl — English + 简体中文 UI, persisted locale switch
      (issue #54, PR #58) — full chrome catalogs with ICU plurals, sidebar
      Language toggle, catalog-parity unit tests, 5 E2E locale checks
- [x] Themes gallery beyond dark/light (issue #55, PR #59) — six accent
      themes (violet default, ocean, forest, sunset, rose, graphite) layered
      over light/dark via `data-theme` on <html>, sidebar gallery with live
      swatches, pre-hydration restore script, persisted choice, i18n-parity
      unit tests, 4 E2E checks
- [x] F-Droid build recipe + runbook (issue #56, PR #60) —
      `packaging/fdroid/` metadata with the repo-wide versionCode scheme
      (major×100+minor×10+patch), `scripts/fdroid-check.mjs` validator
      (Bun.YAML parse + invariants), cross-file version parity with the TWA
      scaffold, docs/fdroid.md runbook (fdroidserver test-build, fdroiddata
      submission, policy notes), 21 unit tests

## Backlog (unscheduled)

- (empty — handwriting phases live under the v1.13 candidate, see
  docs/handwriting-research.md)