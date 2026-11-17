# Pipeline

How work moves from idea to release. Applies to humans and AI agents alike.

## Branching model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Released, stable code | Protected: PR only, required checks, no force push, no delete |
| `develop` | Integration of finished features | Protected: same rules as `main` |
| `feature/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` | Work units | Short-lived; branch off `develop` |

## Required checks (both protected branches)

| Check | What it does |
|---|---|
| `lint-typecheck-test` | ESLint, `tsc --noEmit`, 1038 unit tests (78 files, measured 2026-11-17), plus a secret-leak grep |
| `build-smoke` | `next build` production build + boots standalone server + HTTP 200 probe |
| `e2e` | Playwright browser E2E against the production build (175 checks in 40 files, measured 2026-11-16) |

CI: `.github/workflows/ci.yml`, runs on every push to `main`/`develop` and every PR
targeting them. Concurrency group cancels superseded runs on the same ref
(the majors' redundant-CI cancellation — Excalidraw's `cancel.yml`).

Every CI job restores bun's install cache through SHA-pinned `actions/cache`
(v6.1.0, keyed on `bun.lock` with a prefix restore-key) — the majors'
CI-caching practice (Logseq's `build.yml` combines setup-node's `cache:`
input with explicit `actions/cache@v4` steps; setup-bun has no cache input,
verified against its `action.yml`, so the cache is an explicit step here).
e2e additionally caches Playwright's Chromium, keyed exactly on the lockfile
with no restore-key — a stale browser must never satisfy the cache. Caches
restore only from the run's own branch or the default branch (`main`), so a
fresh PR branch is warm only after a `main` push has saved the cache.

When the CI workflow completes with failure on a same-repo PR, a follow-up
workflow comments on that PR naming the failed jobs and linking the run —
Joplin's `comment-on-failure.yml` practice (majors-research wave 5),
implemented here as plain `gh api` calls instead of the mutable-tag-pinned
third-party action Joplin uses, keeping the SHA-pinning and least-privilege
invariants. Push failures and fork PRs are skipped by design; the comment is
informational only — merge gating stays with the required checks.

Four additional non-required checks accompany every PR (adopted from the
comparable majors — Excalidraw/Joplin/AFFiNE gate PR titles, Logseq/AFFiNE
auto-label from changed paths, Excalidraw's size-limit watches the payload,
Excalidraw's test-coverage-pr reports unit coverage):

| Check | What it does |
|---|---|
| `PR title / conventional-commit title` | runs `src/lib/pr-title.ts` (the same module its unit tests pin) against the PR title — `type: subject` or `type(scope): subject`, Conventional Commits |
| `PR labeler / label from changed paths` | [`actions/labeler` v7 (SHA-pinned)](https://github.com/actions/labeler) applies `.github/labeler.yml` globs → `github_actions` / `documentation` / `dependencies` / `area:ui` / `area:canvas` / `area:data` / `area:import`; runs on `pull_request` (never `pull_request_target`) and only uses labels that already exist |
| `Bundle size / size-report` | builds the production bundle, sums every `.js` file under `.next/static/chunks/` and compares against the committed budget in `scripts/size-budget.json` (measured 2026-11-16: 9,909.1 KiB across 173 files → budget 10,400 KiB, ~5% headroom); over budget → red run + job summary, but never a blocked merge; budgets move only via a new measurement (the validator rejects a ceiling more than 20% above the recorded one) |
| `Coverage report / unit-coverage` | runs the unit suite with bun's built-in coverage and writes the table to the job summary — informational only (no thresholds, never blocks a merge), and the report renders even when tests fail (`if: always()`, Excalidraw's `test-coverage-pr.yml` pattern); measured 2026-11-17 at develop `f939459`: aggregate 93.60% funcs / 95.69% lines, coverage overhead 4.65s vs 4.54s on the 1038-test suite |

## Pull requests

1. Branch off `develop`, implement, add/adjust unit tests, run `make test make lint make typecheck` locally.
2. PR title follows Conventional Commits (`feat: duplicate page action`) —
   enforced by the non-required `PR title` check (see above).
3. Fill in the PR template (summary, testing, checklist) — the checklist includes
   updating `PROJECT_STATUS.md`.
4. Link issues (`Closes #N`). Wait for all required checks to be green.
5. **Squash-merge** into `develop`. The PR body becomes the squash commit message.

## Releases

1. When `develop` has accumulated a version's worth of merged features:
   open a **release PR** `develop → main` titled `release: vX.Y.Z` containing version
   bump (if applicable) + final `PROJECT_STATUS.md` update + notes draft.
2. Wait for checks, **merge-commit** it (preserves the release's individual history).
3. Tag `vX.Y.Z` on the merge commit, push the tag, publish a GitHub Release with
   the notes (feature list, test evidence, upgrade notes).
4. Close the matching milestone; open the next one.

## Commits

Conventional Commits on feature branches (they are squashed anyway):

```
feat: duplicate page action
fix: flush pending autosave before page switch
chore(ci): cache bun install
docs(adr): record e2e strategy
test: cover duplicate-page id remapping
```

## Issue triage

- Labels: `area:ui` `area:canvas` `area:data` `area:import` `area:ci`, plus GitHub
  defaults (`bug`, `enhancement`, `good first issue`, ...). Every PR is
  auto-labeled from its changed paths (see the PR labeler above); the
  `area:*` labels on issues stay human-assigned.
- Milestones: one open per upcoming version; PRs/Issues carry the milestone.
- Every non-trivial PR references an issue.

## Local loop (before you push)

```bash
make test         # must be green
make lint         # must be clean
make typecheck    # must be clean
make e2e          # full browser suite (Playwright; boots the app if needed)
make status       # orient yourself: branch, tests, status file head
```
