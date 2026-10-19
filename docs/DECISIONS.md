# Decision log (ADRs)

Short-form architecture decision records. Newest last. Each entry: context → decision → consequence.

## ADR-001 — Canvas engine: Excalidraw (not tldraw, not Flutter/Qt)

- **Context**: the product is an infinite-canvas OneNote-style notebook that must ship
  on Linux and Android with minimal code and maximal reuse of proven open source.
- **Decision**: build on `@excalidraw/excalidraw` (MIT). Rejected tldraw (custom
  watermark-attribution license, not clean OSS); rejected Flutter/Qt (single-purpose
  rewrite of an engine we get for free; PWA delivery covers both target platforms).
- **Consequence**: canvas feature set == Excalidraw's; self-hosted fonts/worker needed
  (done in `public/`); license stays MIT-compatible.

## ADR-002 — Local-first storage: Dexie/IndexedDB, no server DB

- **Context**: OneNote users expect offline notebooks and data ownership.
- **Decision**: all note data lives client-side (Dexie 4). No server, no accounts.
- **Consequence**: offline-first by construction; sync is deferred to a dedicated
  v1.3 research track; backups provide data continuity today.

## ADR-003 — Delivery: PWA for both Linux and Android

- **Context**: two platforms, one codebase, no store gates.
- **Decision**: installable PWA (manifest + custom service worker). Native shells
  (Tauri, TWA, Flathub) are roadmap v1.4 polish, not launch blockers.
- **Consequence**: instant install path today; deep-OS integration (palm rejection,
  stylus pressure) arrives with native shells later.

## ADR-004 — E2E: agent-browser locally today, Playwright in CI tomorrow

- **Context**: full browser E2E was built with the available headless-browser tooling;
  CI runners need a standard, reproducible runner.
- **Decision**: `scripts/e2e.sh` (34 checks) is the pre-release gate locally;
  CI enforces lint + typecheck + unit + build + boot smoke. The Playwright port is
  the first v1.1 item (issue #3).
- **Consequence**: the strongest guarantee in CI today is unit-level; E2E is a
  documented, repeatable manual gate until #3 lands.

## ADR-005 — SSR-safe module split for the canvas

- **Context**: Next.js renders on the server; Excalidraw is browser-only.
- **Decision**: `excalidraw-utils.ts` (pure, SSR-safe) vs `excalidraw-client.ts`
  (browser runtime), with dynamic `ssr:false` import in `canvas-editor.tsx`.
- **Consequence**: no hydration errors; testable pure logic; one dynamic boundary.

## ADR-006 — Bun as toolchain

- **Context**: fastest dev loop for a Next.js 16 app in this environment; lockfile
  available for CI reproducibility.
- **Decision**: bun for install/dev/test; GitHub Actions via `oven-sh/setup-bun`.
- **Consequence**: contributors need bun 1.3+; documented in README/AGENTS.

## ADR-007 — Repository layout: workspace root with gitignored sandbox dirs

- **Context**: the app is developed inside a sandbox workspace that also contains
  tooling that is not part of the product (`db/`, `download/`, `examples/`, `skills/`, ...).
- **Decision**: repo root == app root; sandbox artifacts are explicitly gitignored.
- **Consequence**: zero-copy pushes; the ignore list is the contract of what is
  product vs workspace (see `.gitignore` and AGENTS.md "never commit" list).

## ADR-008 — Pipeline: main + develop, required checks, squash for features

- **Context**: single-maintainer velocity with pro-team guarantees.
- **Decision**: `main` (releases) and `develop` (integration) protected; PRs required;
  `lint-typecheck-test` and `build-smoke` are required checks; feature PRs are
  squash-merged; releases are merge commits tagged `vX.Y.Z` with a GitHub Release.
- **Consequence**: history stays linear and meaningful; nothing reaches `main`
  or `develop` without green CI.
