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
| `lint-typecheck-test` | ESLint, `tsc --noEmit`, 47 unit tests, plus a secret-leak grep |
| `build-smoke` | `next build` production build + boots standalone server + HTTP 200 probe |

CI: `.github/workflows/ci.yml`, runs on every push to `main`/`develop` and every PR
targeting them. Concurrency group cancels superseded runs on the same ref.

## Pull requests

1. Branch off `develop`, implement, add/adjust unit tests, run `make test make lint make typecheck` locally.
2. PR title follows Conventional Commits (`feat: duplicate page action`).
3. Fill in the PR template (summary, testing, checklist) — the checklist includes
   updating `PROJECT_STATUS.md`.
4. Link issues (`Closes #N`). Wait for both required checks to be green.
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
  defaults (`bug`, `enhancement`, `good first issue`, ...).
- Milestones: one open per upcoming version; PRs/Issues carry the milestone.
- Every non-trivial PR references an issue.

## Local loop (before you push)

```bash
make test         # must be green
make lint         # must be clean
make typecheck    # must be clean
make e2e          # before releases / risky changes (needs dev server)
make status       # orient yourself: branch, tests, status file head
```
