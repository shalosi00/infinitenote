# Security audit — main branch, 2026-11-15

Scope: a deep and wide security scan of `main` on GitHub (history, GitHub
security surfaces, CI workflows, branch protection, dependency graph),
executed with the repo's own tooling plus the GitHub REST API. Every number
below comes from an actual run on 2026-11-15 (CI logs, API responses,
`git`/`bun` output). Follow-up remediation landed in the dependency-sweep PR
tracked by issue #235.

## 1. Repository history secret scan — CLEAN

- Corpus: all 157 commits on `origin/main`, every unique blob reachable from
  them: **1,346 blobs**, scanned for 15 credential pattern classes (GitHub
  tokens `ghp_/gho_/ghs_/ghr_/github_pat_`, AWS `AKIA…` + secret keys,
  PEM/OPENSSH/PGP private-key blocks, Slack tokens, Google API keys,
  OpenAI/Anthropic keys, JWTs, credentialed database/AMQP URIs, npm
  `_authToken`, password assignments, credentialed GitHub remote URLs,
  `x-access-token:` URLs).
- The **live token** (the one embedded in the `origin` remote URL) never
  appears in any blob on `main`'s full history.
- Two pattern hits, both verified false positives:
  - `AKIA…` inside the vendored Tesseract WASM builds
    (`public/ocr/core/tesseract-core*-lstm.wasm.js`) — coincidental
    byte sequences inside compiled WASM payloads, not key material.
  - A credentialed-URL-shaped string in an early revision of
    `scripts/ghapi.py` — the docstring's placeholder example
    (`https://user:TOKEN@github.com`); the shipped helper reads the token
    from the remote URL at runtime and never embeds it.
- Tracked-path hygiene: the only credential-adjacent file on main is
  `.env.example`, which contains a benign local SQLite `DATABASE_URL`
  reference and no secrets.

## 2. GitHub security surfaces — ALL ON, ZERO ALERTS

Repo is public. Verified via the REST API:

| Surface | State |
|---|---|
| Secret scanning | enabled |
| Secret scanning push protection | enabled |
| Code scanning (CodeQL, `javascript-typescript`) | active on push/PR to main+develop + weekly schedule; **0 open alerts** |
| Dependabot alerts | **0 open** |
| Dependabot security updates (`vulnerability-alerts`) | enabled (HTTP 204) |
| Automated security fixes | enabled, not paused |
| Deploy keys | 0 |
| Repository webhooks | 0 |
| Secret-scanning non-provider patterns / validity checks | disabled (no findings to validate — acceptable; revisit if non-provider secret types become relevant) |

## 3. CI workflow review — HARDENED, NO FINDINGS

`.github/workflows/ci.yml`, `codeql.yml`, `desktop.yml` reviewed line by line:

- No `pull_request_target` anywhere; no fork-head checkout; no untrusted
  `${{ github.event.* }}` interpolation into `run:` blocks (script-injection
  class absent).
- Least privilege: `ci.yml` and `codeql.yml` run with top-level
  `permissions: contents: read`; only CodeQL's analyze job adds
  `security-events: write`. `desktop.yml` needs `contents: write` for release
  uploads and only triggers on pushes to `main` and `v*` tags (write-access
  holders) — never on PRs.
- All third-party actions are SHA-pinned (checkout, setup-bun,
  upload-artifact, codeql-action, rust-toolchain, rust-cache,
  action-gh-release) with Dependabot keeping the pins updated.
- `ci.yml` runs a leaked-secret guard step over the tree on every job.
- Concurrency groups with `cancel-in-progress` limit parallel-run abuse.

## 4. Branch protection on main — VERIFIED

- Required status checks: `lint-typecheck-test`, `build-smoke`, `e2e` —
  **strict** (branches must be up to date before merge).
- `enforce_admins`: enabled (no bypass path, including the owner).
- `allow_force_pushes`: disabled. `allow_deletions`: disabled.
- No rulesets configured (classic branch protection only) — consistent with
  the sync-PR flow that intentionally puts merge commits on main.
- Note: the strict up-to-date gate plus the develop→main merge-commit
  convention means sync PRs re-run the full 3-check suite on every
  develop tip; the documented E06 flake made those merges wait (see the
  2026-11-15 worklog entry and issue #231 — root-caused and fixed).

## 5. Dependency graph — 35 FINDINGS → 1 DOCUMENTED RESIDUE

`bun audit` on main's lockfile: **35 vulnerabilities (25 high / 9 moderate /
1 low)** across six packages. Full trace of every stale copy, the bun
override semantics measured on the way (flat overrides only — nested and
yarn `resolutions` are ignored; a flat override on a multi-major name forces
every consumer), and the per-package fix matrix: see issue #235.

Shipped remediation (same-day PR, then synced to main):

| Package | Was | Now | How |
|---|---|---|---|
| minimatch (3.x line) | 3.1.2 x6 | 3.1.5 | fresh lockfile resolution |
| brace-expansion | 1.1.12 x6 | 1.1.22 / 5.0.13 | follows minimatch + fresh resolution |
| zod | 4.3.5 | 4.6.7 | fresh lockfile resolution |
| picomatch (2.x line) | 2.3.1 x3 | 2.3.2 | fresh lockfile resolution |
| katex | 0.16.47 | **0.18.2** | flat `overrides` entry |
| nanoid | 3.3.3 (+4.0.2) | **3.3.20** (single copy) | flat `overrides` entry |
| minimatch (10.x line) | 10.2.6 | 10.2.6 — **documented accepted risk** | upstream-blocked (typescript-eslint 8.72.2 still pins `^10.2.2`; advisory fixed in 11.0.1; forcing 11 would break eslint's CJS chain). Revisit on the next typescript-eslint bump. |

Post-fix `bun audit`: **1 vulnerability (1 moderate)** — the documented
minimatch residue above. The Advisory-DB cross-check behind the #221 recipe
ships as `scripts/audit-lockfile.py` (extract bun.lock pairs → server-side
`affects=` filtering → in-range re-filter); it is a local gate command
(`python3 scripts/audit-lockfile.py`), NOT a CI step — required CI stays
lint-typecheck-test / e2e / build-smoke, and ongoing dependency protection in
CI comes from Dependabot alerts + Dependabot security updates. Measured
Advisory-DB view on the swept lockfile: **3 documented residues, 0 new
findings** — minimatch@10.2.6 (moderate, upstream-blocked), braces@3.0.3
(advisory withdrawn, no fixed release — #221 policy), uuid@11.1.1 (LOW,
fix=14.0.0 major bump — #221 documented residue). `bun audit` sees only the
minimatch one because the braces advisory is withdrawn and the uuid advisory
is marked duplicate by GitHub. Correction history: an earlier revision of
this report said the script "runs in the sweep's CI gate"; that was wrong —
the sweep ran it in the sandbox, the script itself was only committed later
(verified: `git log --all` empty for the path before the commit).

## 6. Environment hygiene

- `/tmp/.ghcred` (a historical token file) deleted in this cycle; it was
  never committed and the live token never appears in history (section 1).
- Stale one-off `/tmp` artifacts from prior release cycles removed.
- The remaining credential surface is the token embedded in the `origin`
  remote URL of the development sandbox — by design, never printed, never
  committed (verified by the history scan).
