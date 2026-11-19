# Contributing to InfiniteNote

Thanks for helping build the open OneNote for Linux and Android. Every kind of
contribution is welcome — code, docs, bug reports, reproductions, and tests.

## Code of conduct

By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1). Report
unacceptable behavior through the issue forms marked as conduct matters.

## Ways to contribute

- **Code** — check [docs/ROADMAP.md](docs/ROADMAP.md) for what's planned and
  the [`good first issue`](https://github.com/shalosi00/infinitenote/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/shalosi00/infinitenote/labels/help%20wanted)
  labels for entry points. Parity with OneNote's everyday behavior is a
  project goal — restoring OneNote behavior you miss is always a valid
  feature request.
- **Tests** — the E2E suite (`e2e/`, Playwright) and unit suite
  (`src/lib/__tests__/`) both grow from contributor findings. One open,
  concrete example: issue #193 needs the committed handwriting benchmark run
  on real GPU hardware — the measurement, not the code, is the blocker.
- **Documentation** — the docs in `docs/` and this file are kept current by
  contributors; corrections with evidence (a measured count, a repro) merge
  fast.
- **Bug triage** — reproducing reported bugs on your platform (Linux/Android,
  Chromium/Firefox) and commenting with exact steps is as valuable as fixes.

## Got a question?

GitHub Discussions is not enabled for this repo. Open a regular issue and add
the `question` label (or just pick the "question" option in the issue chooser)
— questions are triaged like any other issue. Search
[existing issues](https://github.com/shalosi00/infinitenote/issues?q=is%3Aissue)
first; if your question reveals a documentation gap, a docs PR fixing it is
the fastest path to an answer for everyone.

## Found a bug?

Use the **bug report form** (it asks for the platform, browser, app version
and reproduction steps that triage actually needs). Before filing, search
existing issues — a "+1" comment on a duplicate is more useful than a second
report. If the bug has a security dimension (XSS through note content, data
corruption, packaging), do **not** open a public issue — see [Security](#security).

## Missing a feature?

Use the **feature request form** and describe the OneNote behavior you are
restoring — parity is a project goal. The feature goes on
[docs/ROADMAP.md](docs/ROADMAP.md) if accepted; milestone issues are created
from the roadmap, so a well-argued request shapes the plan directly.

## Submitting a pull request

1. Branch off `develop` (`feature/<slug>`, `fix/<slug>`, `docs/<slug>`).
2. Conventional-Commit PR title (`feat: …`, `fix(scope): …`) — enforced by a
   CI check, so a wrong title fails fast.
3. Fill in the PR template; every PR updates `PROJECT_STATUS.md` (the
   2-minute state of the project).
4. Link issues with plain `Closes #N` lines in the body so they auto-close on
   merge.
5. Let all four required checks go green — see the table below — then the PR
   is squash-merged into `develop`. The full workflow (including releases) is
   documented in [docs/PIPELINE.md](docs/PIPELINE.md).

### The checks a PR runs

| Required (merge-blocking) | What it does |
|---|---|
| `lint-typecheck-test` | ESLint, `tsc --noEmit`, the unit suite, secret-leak grep |
| `build-smoke` | production build + standalone server boot + HTTP probe |
| `e2e` | Playwright suite against the production build |
| `size-report` | builds the bundle and enforces the committed size budget (promoted to required 2026-11-18 after the budget had aged; details in docs/PIPELINE.md) |

Non-required, informational: conventional-commit title, path-based labeler,
unit-coverage summary (failures on the required `lint-typecheck-test` job
also trigger an automatic PR comment naming the failed jobs).

## Before you push

```bash
bun install
bun run lint         # must be clean
bunx tsc --noEmit    # must be clean
bun test src/lib/__tests__    # 1065 unit tests across 80 files (measured 2026-11-19 on the wave-10 branch, base 460d0ff)
bunx playwright test # 186 checks across 41 files (boots the app automatically if :3000 is free)
```

Add unit tests for new `src/lib` logic in `src/lib/__tests__/`. `make help`
lists every developer command.

## Platform builds

The web app is the product; the desktop and Android shells wrap it:

- Desktop (Tauri 2, deb/rpm/AppImage): [docs/desktop.md](docs/desktop.md) —
  `bun run tauri` workflows, plus the glibc-floor guard explained there.
- Android (TWA): [docs/android-twa.md](docs/android-twa.md); F-Droid recipe:
  [docs/fdroid.md](docs/fdroid.md); Flatpak: [docs/flathub.md](docs/flathub.md).

## Security

Found something with a security dimension — XSS through note content, data
corruption, anything in the packaging? Do **not** open a public issue.
Report it privately via
[private vulnerability reporting](https://github.com/shalosi00/infinitenote/security/advisories/new);
see [SECURITY.md](SECURITY.md) for scope, the threat model and reporting
rules.

## Thank you

Every merged PR lands with your changes in the release notes of the next tag
— this project's history is its contributors' record. Read
[PROJECT_STATUS.md](PROJECT_STATUS.md) first: it is the 2-minute orientation
to everything above.
