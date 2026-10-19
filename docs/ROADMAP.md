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

## v1.1 — Quality & continuity (next)

- [x] Port E2E suite to Playwright and run it in CI (issue #3)
- [ ] OneNote import, phase 1: `.docx` and OneNote-exported HTML import (issue #4)
- [ ] OneNote import, phase 2: migration guide using a Microsoft Graph export script
- [x] Duplicate page action (shipped to `develop` after v1.0.0; releases with v1.1.0)
- [ ] Page templates (ruled/grid paper backgrounds)
- [ ] Remove unused template scaffolding (`db.ts`, `prisma/`, `api/route.ts`)

## v1.2 — Notebook power features

- [ ] Tags / labels on pages with tag filter view
- [ ] Quick notes and a "today" smart page
- [ ] Print-friendly page export (paginated PDF)
- [ ] Multi-select in the sidebar (bulk move/delete)
- [ ] Keyboard shortcut cheatsheet in-app

## v1.3 — Sync & collaboration (research)

- [ ] File-based sync option (export/import with conflict-free merge via CRDT study)
- [ ] Optional end-to-end encrypted sync backend (self-hostable, opt-in)
- [ ] Shared notebooks (research; depends on sync model)

## v1.4 — Distribution

- [ ] Tauri wrapper for a native Linux desktop launcher/installer
- [ ] Android Trusted Web Activity build for direct APK distribution
- [ ] Publish to Flathub (Linux) once the Tauri shell lands

## Backlog (unscheduled)

- i18n (next-intl), themes gallery, drawing shape library beyond Excalidraw defaults,
  handwriting recognition (research), F-Droid packaging.
