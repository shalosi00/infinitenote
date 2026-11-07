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

## v1.10 — Offline-first Android & canvas depth (current)

- [ ] Bundled-asset TWA (WebViewAssetLoader) for full F-Droid offline
      compliance (issue #64) — follow-up to the F-Droid policy notes
- [ ] Drawing shape library beyond Excalidraw defaults (issue #65)
- [x] Manual-pass fixes from 2026-11-07: imported images can no longer
      persist with a stale "pending" status once their data is saved
      (issue #122) and the app reopens the last-opened page on reload
      (issue #123)

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

- Handwriting recognition (research).