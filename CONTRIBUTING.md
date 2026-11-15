# Contributing to InfiniteNote

Thanks for helping build the open OneNote for Linux and Android.

## Quick start

```bash
git clone https://github.com/shalosi00/infinitenote.git
cd infinitenote
bun install
bun run dev        # http://localhost:3000
```

That's it — the app is fully local-first (IndexedDB in the browser); there is
no server database to provision. `make help` lists every developer command.

## Before you push

- `make test` — the 961 unit tests across 75 files must be green; add tests
  for new `src/lib` logic in `src/lib/__tests__/`.
- `make lint` and `make typecheck` — must be clean.
- `make e2e` (Playwright, 171 checks across 39 files; boots the app
  automatically if :3000 is free) before releases or risky/UI changes.

## Ground rules

1. Read [PROJECT_STATUS.md](PROJECT_STATUS.md) first — it is the 2-minute orientation.
2. Work on `feature/…` branches off `develop`; open PRs against `develop`.
3. Conventional Commits for PR titles; PRs are squash-merged.
4. Never commit secrets or local-only files (`.env`, `db/`, `download/`, `examples/`, logs).
5. Every PR updates `PROJECT_STATUS.md`.
6. CI must be green — `lint-typecheck-test`, `build-smoke` and `e2e` are
   required checks.

See [docs/PIPELINE.md](docs/PIPELINE.md) for the full workflow,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map, and
[AGENTS.md](AGENTS.md) for repo conventions (also used by AI coding agents —
`.github/copilot-instructions.md` points Copilot at the same rules).

## Platform builds

The web app is the product; the desktop and Android shells wrap it:

- Desktop (Tauri): [docs/desktop.md](docs/desktop.md) — `bun run tauri` workflows.
- Android (TWA): [docs/android-twa.md](docs/android-twa.md).

## Reporting bugs and ideas

Use the issue forms — they ask for what triage actually needs (platform,
browser, app version, reproduction steps). Feature requests that restore
OneNote behavior are especially welcome; parity is a project goal.

## Security

Found something with a security dimension — XSS through note content, data
corruption, anything in the packaging? Do **not** open a public issue.
Report it privately via
[private vulnerability reporting](https://github.com/shalosi00/infinitenote/security/advisories/new);
see [SECURITY.md](SECURITY.md) for scope, the threat model and reporting
rules.
