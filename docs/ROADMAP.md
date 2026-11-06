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

## v1.7 — Internationalization & polish (current)

- [ ] i18n with next-intl — English + 简体中文 UI, persisted locale switch
      (issue #54)
- [ ] Themes gallery beyond dark/light (issue #55)
- [ ] F-Droid build recipe + runbook from the Tauri source (issue #56)

## Backlog (unscheduled)

- Drawing shape library beyond Excalidraw defaults, handwriting recognition
  (research), localized first-run seed content + generated page/notebook names
  (needs a stable quick-notes marker, Dexie v3).