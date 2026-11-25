# InfiniteNote — instructions for GitHub Copilot

InfiniteNote is an open OneNote-style notebook with an infinite canvas: a
local-first PWA for Linux & Android (Next.js 16 App Router, React 19,
TypeScript strict, Tailwind 4, Zustand + Dexie/IndexedDB, Excalidraw,
pdfjs-dist). Package manager is **bun**. There is no server database — the
app is fully client-side.

## Read before touching anything

1. `PROJECT_STATUS.md` — the 2-minute "where the project stands" snapshot.
2. `AGENTS.md` — repo conventions (this is the source of truth; Copilot
   should follow it too).
3. `docs/ARCHITECTURE.md` — module map and data flow.
4. `docs/PIPELINE.md` — branching and PR rules.
5. `docs/WORKLOG.md` — latest entry says what is in flight.

## Hard rules

- Never commit secrets (`.env` is gitignored) or local-only paths
  (`db/`, `download/`, `examples/`, `tests/`, `skills/`, `e2e-artifacts/`).
- Branch per feature off `develop` (`feat/…`, `fix/…`, `chore/…`); PRs
  target `develop`; `main` and `develop` are protected — PRs only, required
  checks `lint-typecheck-test` and `build-smoke` must be green.
- Conventional Commits for PR titles (`feat:`, `fix:`, `chore:`, `docs:`,
  `ci:`, `test:`).
- New logic in `src/lib/` needs unit tests in `src/lib/__tests__/`
  (`bun test src/lib/__tests__` must stay green).
- Data-model changes go through `src/lib/notes-db.ts` with a Dexie versioned
  migration — bump the schema version, never mutate an existing shape.
- Keep `excalidraw-utils.ts` SSR-safe (pure functions only); browser-only
  modules live behind `excalidraw-client.ts`.
- Every PR updates `PROJECT_STATUS.md`.

## Verify your work

```bash
bun install          # restore dependencies
bun run lint         # ESLint
bunx tsc --noEmit    # typecheck
bun test src/lib/__tests__   # 1382 unit tests / 100 files (measured 2026-11-25 on the wave-25 branch, base b90e1ff)
bunx playwright test # E2E: 274 checks / 57 files (boots the app if :3000 is free)
```

If you cannot run the E2E suite, say so — do not claim it passed.
