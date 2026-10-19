# Contributing to InfiniteNote

Thanks for helping build the open OneNote for Linux and Android.

## Quick start

```bash
git clone https://github.com/shalosi00/infinitenote.git
cd infinitenote
bun install
bun run db:generate
bun run dev        # http://localhost:3000
```

## Before you push

- `make test` — the 47 unit tests must be green; add tests for new `src/lib` logic.
- `make lint` and `make typecheck` — must be clean.
- `make e2e` (needs the dev server) before releases or risky changes.

## Ground rules

1. Read [PROJECT_STATUS.md](PROJECT_STATUS.md) first — it is the 2-minute orientation.
2. Work on `feature/…` branches off `develop`; open PRs against `develop`.
3. Conventional Commits for PR titles; PRs are squash-merged.
4. Never commit secrets or local-only files (`.env`, `db/`, `download/`, logs).
5. Every PR updates `PROJECT_STATUS.md`.
6. CI must be green — both `lint-typecheck-test` and `build-smoke` are required checks.

See [docs/PIPELINE.md](docs/PIPELINE.md) for the full workflow and
[AGENTS.md](AGENTS.md) for repo conventions (also used by AI coding agents).

## Reporting bugs

Open an issue with the bug template: what happened, what you expected, steps to
reproduce, platform (Linux/Android + browser), and whether you installed it as a PWA.
