# Project Status

> **READ THIS FIRST.** This file is the single source of truth for "where does the
> project stand". It is small on purpose: humans and AI agents should get a complete
> picture in ~2 minutes without reading the codebase. Every merged PR must update it.

| | |
|---|---|
| **Last updated** | 2026-10-19 |
| **Current version** | v1.2.0 (tagged, GitHub Release published) |
| **Phase** | v1.2.0 shipped — v1.3 planning |
| **Overall state** | v1.2.0 released; 97 unit + 34 E2E green, CI green |

## TL;DR

InfiniteNote is an open-source OneNote-style notebook for Linux and Android:
Notebook → Section → Page hierarchy on an infinite canvas (Excalidraw), draw/write
on anything, import images / text / Markdown / PDF printouts / .excalidraw scenes,
Word documents, OneNote-exported HTML and OneNote `.mht` single-file pages
(embedded images included), export PNG / SVG / scenes / full backups, full-text
search, soft-delete trash, dark mode, per-page paper styles (plain / ruled /
grid), and a fully offline installable PWA. All data is local (IndexedDB).
v1.1 added the duplicate-page action, Playwright E2E as a required CI check and
OneNote import phase 1 (.docx + HTML). v1.2 adds OneNote import phase 2 (`.mht`
single-file pages with embedded images + Graph export runbook) and page paper
styles (plain/ruled/grid).

## What works today (verified by tests)

| Area | State | Evidence |
|---|---|---|
| Notebook/Section/Page CRUD, rename, colors, reorder, duplicate page | Working | 34 E2E checks + unit tests |
| Infinite canvas, draw + type on anything | Working | E2E (real mouse draw, per-key typing) |
| Autosave + persistence across reloads | Working | E2E (autosave, flush-on-switch) |
| Page paper styles: plain / ruled / grid, persisted, zoom/pan-synced | Working | E2E background.spec (6 checks) |
| Imports: image, text, Markdown, PDF printout, `.docx`, OneNote HTML, **OneNote `.mht` with embedded images**, `.excalidraw` | Working | 30 E2E checks with fixture files |
| Exports: PNG, SVG, .excalidraw, notebook backup | Working | E2E serialization check |
| Cross-page search (Ctrl+K), trash restore/purge | Working | Unit + E2E |
| Dark mode, mobile drawer navigation | Working | E2E + visual review |
| PWA install (Linux + Android), offline SW | Working | E2E asset checks |
| OneNote migration runbook (manual + Microsoft Graph script) | Documented | docs/onenote-migration.md, scripts/graph-export.mjs |
| CI: lint, typecheck, unit tests, build, smoke boot, browser E2E | Required checks on every PR | GitHub Actions |

**Totals: 97 unit tests, 34 Playwright E2E checks (required in CI), 0 known bugs, 0 TODOs in `src/`.**

## In flight

- Nothing open — v1.2.0 is live on `main`. (CI must stay green on both branches.)

## Next up — v1.2 highlights (see [docs/ROADMAP.md](docs/ROADMAP.md))

1. Tags / labels on pages with a tag filter view.
2. Quick notes and a "today" smart page.
3. Print-friendly page export (paginated PDF).

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
| `src/lib/mht-import.ts` | OneNote phase-2: `.mht` MIME parser (QP/base64 parts, cid/location map) |
| `scripts/graph-export.mjs` | Microsoft Graph OneNote export → self-contained HTML per page |
| `src/components/notes/*` | App UI: sidebar, search, trash, canvas wiring |
| `src/app/` | Next.js App Router entry + layout |
| `public/` | PWA manifest, service worker, icons, self-hosted Excalidraw fonts, pdf.js worker |
| `e2e/` + `playwright.config.ts` | Playwright E2E suite — 34 checks, runs in CI (issue #3) |
| `.github/workflows/ci.yml` | CI: lint-typecheck-test + build-smoke (required) |
| `docs/` | Architecture, roadmap, decisions, pipeline |

## Commands cheat-sheet

```bash
bun install                            # first-time setup
bun run dev                          # dev server on :3000
make test                            # 97 unit tests
make e2e                             # 34 E2E checks (Playwright; boots the app if needed)
make status                          # quick status snapshot (this file's head + git info)
```

## Recent history

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