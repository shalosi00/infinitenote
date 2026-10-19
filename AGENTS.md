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
| Install | `bun install && bun run db:generate` |
| Dev server | `bun run dev` (port 3000) |
| Unit tests | `make test` |
| Lint / typecheck | `make lint` / `make typecheck` |
| E2E (local) | dev server running, then `make e2e` |
| Status snapshot | `make status` |
| Build / run prod | `make build` / `make start` |

## E2E harness (how it works)

- The app exposes test hooks **only** when loaded with `?e2e=1`:
  `window.__NOTE_E2E__` (scene/element accessors) and `window.__NOTE_RESET__()`
  (hard data reset for deterministic runs).
- `scripts/e2e.sh` drives a headless browser (`agent-browser`) with real mouse and
  keyboard events, asserts state via the hooks, and writes screenshots to
  `e2e-artifacts/` (override dir with `E2E_SHOTS=...`). Fixtures live in
  `scripts/e2e-fixtures/`.
- CI runs lint + typecheck + unit tests + production build + boot smoke test.
  The full browser E2E suite is currently run locally before releases;
  porting it to Playwright-in-CI is roadmap item v1.1 (issue #3).

## Known template leftovers (safe to ignore, do not "fix" casually)

`src/lib/db.ts` + `prisma/` + `src/app/api/route.ts` are sandbox scaffolding, unused
by the app (all note data is client-side IndexedDB). They are kept only because the
typecheck pipeline expects the generated Prisma client (`bun run db:generate`).
Removing them is roadmap item #4 — remove together with the `db:generate` step in CI.

## Conventions

- Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, shadcn/Radix,
  Zustand + Dexie, Excalidraw, pdfjs-dist. Package manager is **bun** (lockfile committed).
- Client-heavy app: browser-only modules live behind `excalidraw-client.ts`; keep
  `excalidraw-utils.ts` SSR-safe (pure functions only).
- Data model changes go through `src/lib/notes-db.ts` with Dexie versioned migrations;
  bump the schema version and write a migration, never mutate existing shape in place.
