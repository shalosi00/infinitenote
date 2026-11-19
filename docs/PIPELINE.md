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
| `lint-typecheck-test` | ESLint, `tsc --noEmit`, 1065 unit tests (80 files, measured 2026-11-19 on the wave-10 branch, base `460d0ff`), plus a secret-leak grep |
| `build-smoke` | `next build` production build + boots standalone server + HTTP 200 probe |
| `e2e` | Playwright browser E2E against the production build (186 checks in 41 files, measured 2026-11-19 on the wave-10 branch, base `460d0ff`) |
| `size-report` | builds the production bundle and **enforces** the committed budget in `scripts/size-budget.json` (measured 2026-11-16 at develop `7b24224`: 9,909.1 KiB across 173 `.js` files → 10,400 KiB ceiling, ~5% headroom; budgets move only via a new measurement — the validator rejects a ceiling more than 20% above the recorded one); promoted from non-required to required on both protected branches on 2026-11-18 once the budget had aged — green on every PR since it landed (#258 → #266); over budget → red run and a blocked merge |

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

Three additional non-required checks accompany every PR (adopted from the
comparable majors — Excalidraw/Joplin/AFFiNE gate PR titles, Logseq/AFFiNE
auto-label from changed paths, Excalidraw's test-coverage-pr reports unit
coverage):

| Check | What it does |
|---|---|
| `PR title / conventional-commit title` | runs `src/lib/pr-title.ts` (the same module its unit tests pin) against the PR title — `type: subject` or `type(scope): subject`, Conventional Commits |
| `PR labeler / label from changed paths` | [`actions/labeler` v7 (SHA-pinned)](https://github.com/actions/labeler) applies `.github/labeler.yml` globs → `github_actions` / `documentation` / `dependencies` / `area:ui` / `area:canvas` / `area:data` / `area:import`; runs on `pull_request` (never `pull_request_target`) and only uses labels that already exist |
| `Coverage report / unit-coverage` | runs the unit suite with bun's built-in coverage and writes the table to the job summary — informational only (no thresholds, never blocks a merge), and the report renders even when tests fail (`if: always()`, Excalidraw's `test-coverage-pr.yml` pattern); measured 2026-11-17 at develop `f939459`: aggregate 93.60% funcs / 95.69% lines, coverage overhead 4.65s vs 4.54s on the 1038-test suite |

Releases are CI-driven too (majors-research wave 6 — AppFlowy's `release.yml`
creates the GitHub Release on tag push; Excalidraw's `autorelease` and
Logseq's `build-*-release.yml` release from CI as well; none of the five
comparables uses release-please or changesets — all probed via the API).
Pushing a `v*` tag triggers `.github/workflows/release.yml`:
`tag-build-verify` runs the full build-smoke recipe against the tagged
commit (desktop.yml already verifies the Tauri build on tags — this covers
the web/PWA build), and `ensure-github-release` creates the release with
GitHub's auto-generated notes only if it does not exist yet, so an
interrupted release flow can never leave an empty release body. The ensure
step never touches an existing release: hand-measured notes published first
stay as published. Implemented as plain `gh release` calls (the wave-5
precedent — no third-party release action); `contents: write` lives only in
that job.

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
   the notes (feature list, test evidence, upgrade notes). The tag push itself
   fires the `Release` workflow: the tagged commit is verified with the full
   build-smoke recipe (`tag-build-verify`), and if the release object does not
   exist when that finishes, `ensure-github-release` creates it with
   auto-generated notes — a safety net, never an overwrite (see the Releases
   are CI-driven paragraph above).
4. Close the matching milestone; open the next one.

### Release notes convention (majors-research wave 9)

Release notes follow one written structure — author-agnostic, so every
release reads the same regardless of who writes it. Evidence (release
bodies pulled from the API, 2026-11-19): each of the four reachable
comparables ships a recognizable convention — **Joplin** publishes flat
type-prefixed bullets with no headings (`- New: … (#123)`,
`- Improved: … (#456 by @user)`, `- Fixed: …`), crediting external
contributors inline per bullet; **Logseq** uses category headings
(`## Features`, `## Enhancements`, `## Fixed issues`, `## Thanks`) with
user-facing sentences; **AppFlowy** publishes `### vX.Y.Z` under which
`#### New Features` / `#### Improvements` / `#### Bug Fixes` appear plus a
`#### ⚠️ Action Required` section whenever the user must do something after
upgrading; **Excalidraw** publishes `### Highlights` / `### Breaking
changes` with one PR link per bullet. AFFiNE is the counter-example: all 29
of its most recent release bodies are machine-generated channel blobs
(checked via the API) — not a convention to adopt. The gap here: our notes
have been strong but ad hoc — three different shapes measured across
v1.13.0, v1.14.0 and v1.15.0, and step 3 above said only "feature list,
test evidence, upgrade notes". The convention below codifies what those
three releases already do in practice, plus the two majors' practices worth
adding (AppFlowy's Action Required, Joplin's inline contributor credit):

1. **Opening line** — `vX.Y.Z — **theme**.` plus one sentence naming what
   ships and why it matters.
2. **`## Highlights`** — one bullet per shipped issue/PR, bold
   `#issue / PR #N —`, each bullet carrying a measured number or an
   evidence pointer (bytes, milliseconds, check counts, doc links), written
   user-facing ("you can now …", not "refactor of …"). Sub-sections under
   Highlights when one feature dominates the release (v1.13.0:
   Phase A / Phase B / Hardening + quality).
3. **`## Upgrade notes`** — only when users must act: data migration,
   changed shortcuts, packaging catch-up steps (AppFlowy's Action Required
   practice). Omit the section entirely when there is nothing to act on —
   an empty upgrade section is noise.
4. **Contributor credit** — when a merged PR is authored outside the
   maintainer team, credit it inline in its bullet, Joplin-style
   (`… (PR #N by @user)`).
5. **Measured close** — the unit/E2E counts as measured on the merged tip
   for this release, never carried over from a previous release's notes.

Template — fill per release in the release PR body:

```markdown
vX.Y.Z — **<theme>**. <One sentence: what ships and why it matters.>

## Highlights

- **#<issue> / PR #<N> — <user-facing what>**: <measured evidence>
- …

## Upgrade notes

<only if users must act; delete the whole section otherwise>

Unit suite: <N tests across M files, measured on the merged tip>; E2E:
<K checks across J files>.
```

Every number in the notes comes from a run on the merged tip and every
evidence claim names the doc or log that backs it — the same rule
PROJECT_STATUS.md lives by.

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
