# AGENTS.md — working guide for AI agents and human contributors

This repo is developed with AI-agent assistance as well as human contributors.
Follow this guide to work effectively without wasting context reading the whole tree.

## Read order (mandatory for agents)

1. `PROJECT_STATUS.md` — where the project stands right now (~2 min)
2. `docs/ARCHITECTURE.md` — module map and data flow
3. `docs/PIPELINE.md` — branching, PR rules, required checks
4. Only then read the specific `src/` files you need (see repo map in PROJECT_STATUS.md)

## Hard rules

- **Never commit secrets.** `.env` is gitignored and must stay that way. CI greps for
  leaked token patterns (`ghp_`, `github_pat_`, `sk-`) and fails the build on a match.
- **Never commit local-only paths**: `db/`, `download/`, `worklog.md`, `examples/`,
  `tests/` (the shell scripts), `skills/`, `Caddyfile`, `e2e-artifacts/` — all gitignored;
  they belong to the dev sandbox, not the app.
- **Every PR updates `PROJECT_STATUS.md`** (status rows, `In flight`, or `Next up`).
- `main` and `develop` are protected: PRs only, required checks
  `lint-typecheck-test` and `build-smoke` must be green before merge.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`) for all
  commits; squash-merge feature PRs, merge-commit releases.
- New logic in `src/lib/` requires unit tests in `src/lib/__tests__/`.
  The suite (`bun test src/lib/__tests__`) must stay green — no exceptions.

## Commands

| What | Command |
|---|---|
| Install | `bun install` |
| Dev server | `bun run dev` (port 3000) |
| Unit tests | `make test` |
| Lint / typecheck | `make lint` / `make typecheck` |
| E2E | `make e2e` (Playwright; boots the app if :3000 is free) |
| Status snapshot | `make status` |
| Build / run prod | `make build` / `make start` |

## E2E harness (how it works)

- The app exposes test hooks **only** when loaded with `?e2e=1`:
  `window.__NOTE_E2E__` (scene/element accessors) and `window.__NOTE_RESET__()`
  (hard data reset for deterministic runs).
- `e2e/` holds the Playwright specs (7 files, 24 checks); fixtures live in
  `e2e/fixtures/`. Every spec resets its own browser context (isolated
  IndexedDB) via `resetToSeed()` in `e2e/helpers.ts`, so spec files run fully
  parallel.
- `make e2e` (or `bunx playwright test`) — Playwright reuses a dev server on
  :3000 when present, otherwise boots `bun run dev:e2e` itself. In CI it
  builds the production standalone server and drives that instead.
- Failure artifacts: HTML report in `e2e-report/`, traces/screenshots in
  `test-results/` (gitignored; CI uploads the report on failure).

## History note

The initial sandbox scaffolding (`src/lib/db.ts`, `prisma/`, `src/app/api/route.ts`)
was removed in v1.1: the app is fully local-first (client-side IndexedDB via
Dexie) and has no server database.

## Conventions

- Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, shadcn/Radix,
  Zustand + Dexie, Excalidraw, pdfjs-dist. Package manager is **bun** (lockfile committed).
- Client-heavy app: browser-only modules live behind `excalidraw-client.ts`; keep
  `excalidraw-utils.ts` SSR-safe (pure functions only).
- Data model changes go through `src/lib/notes-db.ts` with Dexie versioned migrations;
  bump the schema version and write a migration, never mutate existing shape in place.
