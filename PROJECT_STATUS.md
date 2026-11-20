# Project Status

> **READ THIS FIRST.** This file is the single source of truth for "where does the
> project stand". It is small on purpose: humans and AI agents should get a complete
> picture in ~2 minutes without reading the codebase. Every merged PR must update it.

| | |
|---|---|
| **Last updated** | 2026-11-20 (4) (in-page find — OneNote "Find on this page" parity, issue #301, wave 14 of the product-parity direction: Ctrl/Cmd+F now finds on the CURRENT page. Evidence was in the wave-13 pass (filed from it this cycle together with #302 checklists): OneNote's help page states "Ctrl + F searches within the current page only" (Ctrl + E expands to all notebooks; support.microsoft.com), Joplin ships a Ctrl+F find-in-note box (upstream focus issue laurent22/joplin#16174), Logseq has in-page search — while ours only had the cross-page Ctrl+K dialog, which never highlights anything on the canvas. Design: pure policy in src/lib/page-find.ts (no Excalidraw imports — the table-insert/page-links pattern): findable text = VISIBLE text elements only (standalone text + bound labels of containers/arrows/table cells; OCR/HWR/file-name metadata deliberately stay Ctrl+K material), case-insensitive occurrence matching (non-overlapping, needle-length stepping — browser semantics), reading order (top→bottom, left→right, stable sort), wrap-around step helper; the canvas exposes CanvasApi.findMatches/gotoFindMatch over the LIVE scene — navigation selects via appState.selectedElementIds (the shape-library precedent) + api.scrollToContent, DOM focus NEVER moves so the find input keeps Enter/Shift+Enter cycling; the find bar (src/components/notes/find-bar.tsx) is a floating NON-modal browser-find-shaped bar with ZERO effects (every state change event-driven — the react-hooks/set-state-in-effect rule and the wave-12 prefill lesson respected by construction), mounted only while findOpen, unmounting on close (fresh reopen) and closed by the store on EVERY page switch (selectPage/revealSelection set findOpen:false — stale element ids can never navigate); note-app's capture-phase handler adds Ctrl/Cmd+F (preventDefault kills the browser find; a second Ctrl+F re-focuses the input) and Esc-closes-first-while-open (stopPropagation keeps Excalidraw's deselect out; focus returns via requestCanvasFocus); entry surfaces: the shortcuts cheatsheet (truthful by construction) + the ⋯ page-actions menu "Find on page" (the mobile surface — the header hides below 640px). Three e2e lessons measured: closing the find bar bumps canvasFocus whose delayed .focus() STEALS focus from a text editor opened right after (the editor cancels and the tool flips back to selection — the spec deselects and settles before creating text); gotoFindMatch's selection means the next text-tool click would EDIT the selected element (deselect-first); PF-E01's query is derived from the seed scene itself so seed wording can drift safely. Gate: 1192 unit / 87 files, 0 fail (base 049c29d: 1161/85 — +31 PF-P pins); 219 e2e / 46 files (`playwright --list`); new spec PF-E01..E08 8/8; neighbors shortcuts + ui-overlap + crud + search-trash + dialog-close-click + page-templates + version-history 25/25; counts swept in README badge + commands table and .github/copilot-instructions.md) |
| **Last updated** | 2026-11-20 (3) (internal page links — OneNote "Copy Link to Page" parity, issue #295, wave 13 of the product-parity direction: pages can now LINK to each other. Evidence pass (2026-11-20): every comparable exposes first-class page linking — OneNote's right-click page tab → Copy Link to Page, Joplin's Tools → Link to note with `:/noteId` markdown links, Logseq's `[[wiki-links]]` + backlinks, AppFlowy's mention-a-page inline block, AFFiNE's bi-directional links — while ours had NO internal link mechanism (the `infinitenote:` schemes existed only as audio/PDF/file payload markers; cross-page navigation was Ctrl+K search alone). Design: a page link is a normal, editable TEXT element whose Excalidraw `link` field carries the `infinitenote:page/<id>` marker scheme (the audio/PDF/file marker precedent — the scheme survives `sanitizeUrl`) with NO payload (the target lives in the same local database), built via `convertToExcalidrawElements` so Excalidraw's own text metrics size the click target; pure policy in `src/lib/page-links.ts` (scheme build/parse/validate, foreign-link rejection including prefix-spoofing, toast lines); three insertion surfaces (OneNote's trio): sidebar page menu "Copy link to page", "Link to page…" picker in the Import menu (every alive page with "notebook / section" breadcrumb meta, case-insensitive, the current page excluded), and paste interception (onPaste → linked title element instead of a plain text); navigation via cancelable onLinkOpen (preventDefault stops Excalidraw's default window.open), the page AND its ancestors must be alive or the click toasts "broken link" without navigating; no data-model change — link fields ride the existing scene persistence, sync folders, backups and version history untouched. Two Excalidraw mechanics MEASURED live and one UX bug fixed: element links in 0.18.1 desktop editing open ONLY via the anchor icon at the element's top-right corner (body clicks just select; icon center at scene (x2+8, y1−8), DEFAULT_LINK_SIZE 14 + dashed-line margin), so the E2E clicks the icon; onPaste returning FALSE aborts the default paste while true CONTINUES it (first implementation had the polarity inverted and Excalidraw also created a plain text element); and Excalidraw preventDefaults its canvas pointer events so clicking the canvas never focuses it — after a sidebar action (the link copy) Excalidraw's paste guard (`activeElement` inside the container) silently swallowed the next Ctrl+V, fixed with a wrapper-level capture-phase pointer-down listener that focuses the interactive canvas. Gate: 1161 unit / 85 files, 0 fail (base 32ed4b1: 1142/84 — +19 PL-P pins); 211 e2e / 45 files measured on this tree (`playwright --list`); new spec PL-E01..E04 4/4; neighbors imports + file-attachment + pdf-attachment + save-indicator-calm + shortcuts 42/42 and crud + page-templates + table + ui-overlap + dialog-close-click + version-history 31/31; counts swept in README badge + commands table and .github/copilot-instructions.md (both previously 1142/206)) |
| **Last updated** | 2026-11-20 (v1.16.0 released — the release train executed live: release-prep PR #289 (version files to 1.16.0 / versionCode 260 across package.json, tauri.conf.json, Cargo.toml, the TWA gradle + bubblewrap manifest, fdroid Builds entry, flatpak metainfo 1.16.0 entry), the sync-PR unblock PR #291 (develop recorded main's tip as an ancestor with an EMPTY -s ours merge, tree byte-identical — the #237/#228 precedent, required because main requires strict up-to-date and carried sync merge commits develop lacked), release PR #290 develop-to-main as MERGE commit `570f75d` (checks re-run on the post-unblock head), tag v1.16.0 pushed, hand-measured notes published first under the wave-9 convention (theme: OneNote everyday parity — tables #277, file attachments #278, page templates #279; measured close: 1142 unit / 84 files, 206 e2e / 43 files), the tag-build-verify + ensure-github-release workflows fired on the tag (the ensure step leaves the hand-written notes untouched), milestones rotated (v1.16.0 closed with all three implementable issues shipped; v1.17.0 #18 opened with hardware-blocked #193 moved forward, the v1.15.0/v1.16.0 precedent) |
| **Last updated** | 2026-11-20 (v1.16.0 release train — version files bumped to 1.16.0 / versionCode 260 across package.json, tauri.conf.json, Cargo.toml, the TWA gradle + bubblewrap manifest, and a new fdroid Builds entry; the flatpak metainfo <releases> block gains the 1.16.0 entry (the AppImage extra-data checksum re-pin follows the release once the tag's artifacts exist — scripts/flatpak-extradata.mjs); PROJECT_STATUS Current version row refreshed; the wave-12 counts are already measured on this tree: 1142 unit / 84 files, 206 e2e / 43 files) |
| **Last updated** | 2026-11-20 (custom page templates — OneNote "Page Templates" parity, issue #279, wave 12 of the product-parity direction: save any page as a reusable template from its page-actions menu; create pages from a template picker reachable from BOTH the sidebar's section menu and the page-actions menu. Evidence was already in the issue (probed 2026-11-19): OneNote ships page templates saved per-machine, Joplin ships a Templates plugin, Logseq/AppFlowy solve the adjacent need with page duplication, and ours offered only paper styles (no content) plus same-section page duplication. Design: the version-history.ts pure-policy pattern — new `src/lib/page-templates.ts` (name validation with the typed TemplateError + toast-ready messages, the 10 MiB payload cap REUSED from the attachment policy because a template's payload duplicates on every page created from it, scene parsing that restores nothing from corrupt rows, case-insensitive picker order), an ADDITIVE Dexie v4 `templates` store (no existing-store migration — the v2/v3 bumps are the precedent), `createPageFromTemplate` in the store (the proven addPage selection/focus path + paper-style carry-over), two dialogs (save with the page title pre-filled at OPEN time via the rename-draft pattern — the new react-hooks set-state-in-effect lint rule forbids prefill-in-effect; picker with measured meta lines, confirm-guarded delete, explicit empty state), and templates INCLUDED in notebook backups under the pages' field-tolerance contract (corrupt/oversize/blank-name entries skip silently, fresh ids on restore, old archives restore untouched — the backup version stays 1). One product decision MEASURED live: a fresh page's first autosave writes an EMPTY scene, so saving it is OneNote's STATIONERY case — allowed (paper style without content), not refused; the E2E spec pins it (PT-E04). Gate: 1142 unit / 84 files, 0 fail; 206 e2e / 43 files; new spec page-templates 5/5; neighbors version-history + crud + background + ui-overlap 20/20) |
| **Last updated** | 2026-11-19 (2) (general file attachments — OneNote "Insert > File Attachment" parity, issue #278, wave 11 of the product-parity direction the wave-10 entry carried forward: ANY file — zip, spreadsheet, source file — now attaches to a page. Evidence was already in the issue (probed 2026-11-19): OneNote's Insert > File Attachment embeds any file that stays downloadable from the page, Joplin/Logseq treat attachments as core, and ours shipped only two special-cased embeddables (audio #67, PDF #204) — a generic file died on "unsupported type". Design: a generalization, not new machinery — the shipped PDF-chip pattern end to end: a new pure `src/lib/file-attachment.ts` (marker scheme `infinitenote:file`, 10 MiB cap, MIME-honest data-URL normalization, validated extraction, generic base64→Blob decode, human size + extension-badge formatters, and a combined rotation-exact hit-test across BOTH chip kinds), `makeFileAttachmentElement`/`attachFiles` in excalidraw-client (one updateScene per batch, no programmatic selection — the HWR focus-race lesson), the neutral-slate chip (extension badge capped at 4 chars + name + human size), the Import menu's new "File attachment (any file)…" picker with NO accept restriction, drag-drop/import of any `classifyFile` "unknown" file now attaches instead of dying ("a drop is never a dead end"), the shared three-item context menu, and `fileName` search indexing. Two design facts measured live: a PDF through the explicit attach path embeds WITHOUT printout pages (OneNote's own split — drop may convert, Insert > File Attachment never does), and Excalidraw coalesces consecutive history snapshots so undo is honest as "removes the attach" rather than "one press per batch" (FA-E15, the handwriting-undo lesson). Gate: 1113 unit / 82 files, 0 fail; 201 e2e / 42 files measured on this branch; neighbors pdf-attachment 11/11, ui-overlap 5/5, table+canvas 14/14) |
| **Last updated** | 2026-11-19 (release-notes convention + PR feature preview, wave 9 of the majors-research directive — the beyond-workflows direction the wave-8 worklog named: (1) **release-notes convention written down** in docs/PIPELINE.md — evidence pulled from the API (2026-11-19): the four reachable comparables each ship a recognizable release-notes convention (Joplin: flat type-prefixed bullets with no headings and inline external credits `- New: … (#123)` / `- Improved: … (#456 by @user)`; Logseq: category headings Features/Enhancements/Fixed issues/Thanks with user-facing sentences; AppFlowy: version heading + New Features/Improvements/Bug Fixes plus a ⚠️ Action Required section for post-upgrade user steps; Excalidraw: Highlights/Breaking changes with one PR link per bullet), while AFFiNE is the counter-example — all 29 of its most recent release bodies are machine-generated channel blobs; the gap here: our notes have been strong but ad hoc — three different shapes measured across the v1.13.0/v1.14.0/v1.15.0 bodies (v1.15.0's hand-measured body: 4,438 bytes) and PIPELINE.md step 3 said only "feature list, test evidence, upgrade notes"; adopted: a written convention + template codifying what v1.13.0-v1.15.0 already do in practice (opening line with theme → Highlights with issue/PR-linked measured bullets → Upgrade notes only when users must act (AppFlowy's practice) → Joplin-style inline credit for external PRs → unit/E2E counts measured on the merged tip); (2) **PR feature preview** — AppFlowy's PR template asks for a video/screenshot of new user-facing features; our template already had the conventional title (CI-enforced since wave 2) and tests but no preview ask — a Feature preview section added for feature PRs; also probed for a reviewer-facing "how we review" doc and found nothing to adopt: no comparable ships one on-repo (Joplin's CONTRIBUTING.md now exists on master — 7,000 bytes, contributor-journey, not reviewer-facing — and its readme/dev on the dev branch lists build/style/accessibility docs only; Excalidraw's stays a 100-byte stub; Logseq's is a contributor journey; AppFlowy/AFFiNE carry PR-template checklists only — AFFiNE's template 404s by branch name and lives on the default branch); counts re-measured in this cycle's gate: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-18 (4) (v1.15.0 released — the release train executed live and the wave-6 Release workflow exercised for real: release-prep PR #270 (9/9 checks, squash `7da4046`), release PR #271 develop-to-main as MERGE commit `f34a4365` (13/13 check-runs), tag v1.15.0 pushed, hand-measured notes published first and left untouched by the workflow's ensure step (log: 'Release v1.15.0 already exists — leaving its notes untouched.'), tag-build-verify success, Desktop green with 3 artifacts (AppImage 152,926,712 bytes, deb, rpm); milestones rotated (v1.15.0 closed, v1.16.0 #17 open with #193); the flatpak per-release step skipped since v1.7.0 caught up — extra-data repinned to the real v1.15.0 AppImage via scripts/flatpak-extradata.mjs and the metainfo <releases> block backfilled for 1.7.0-1.15.0; counts re-measured on the merged tip: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-18 (3) (v1.15.0 release train — version files bumped to 1.15.0 / versionCode 250 across package.json, tauri.conf.json, Cargo.toml, the TWA gradle + bubblewrap manifest, and a new fdroid Builds entry; PROJECT_STATUS refreshed: Current version, Phase, In flight (was stale at v1.11.1-era content), Next up (was stale at v1.10), Recent history (was stale at 2026-11-09 — the v1.11.0-v1.14.0 release entries live in their GitHub Release notes + the worklog); the release is the first live exercise of the wave-6 Release workflow on a real tag; counts re-measured on the release-prep branch: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-18 (2) (CONTRIBUTING gateway + repo-wide stale-count sweep + size-report promoted to required, wave 7 of the majors-research directive — (1) **size-report promotion**: the wave-3 bundle-size guard's budget (recorded 2026-11-16 at develop `7b24224`: 9,909.1 KiB measured → 10,400 KiB ceiling) is now aged — green on every PR since it landed (#258 through #266: nine green size-report runs on nine PR heads, zero non-green — API-counted, the e2e rerun on #264 re-ran only that job) — so `size-report` was added to the required status checks on both protected branches via the branch-protection API (contexts now `lint-typecheck-test`, `build-smoke`, `e2e`, `size-report`; strict-up-to-date retained; enforce-admins/no-reviews/no-force-push/no-deletions unchanged; PUT + GET verified); the check keeps its policy in code — a budget below its own measurement is invalid, a ceiling >20% above the recording is rejected — so a failing check can never be silenced by cranking the number; (2) **CONTRIBUTING.md rewritten as a contributor-journey gateway** — evidence: the five comparables' contributing docs pulled from the API — only Logseq has a deep root CONTRIBUTING.md (10 KB: conduct → ways to help → question → bug → feature → submit issue → PR guidelines), Excalidraw's is a 100-byte stub pointing at its docs site, Joplin/AFFiNE/AppFlowy keep theirs off-repo (probed paths 404) — so the adoption is Logseq's structure with ours' accuracy: ways to contribute (code/tests/docs/triage, with #193's real-GPU benchmark named as a concrete open task), question flow (Discussions disabled — API-verified — so issues + the existing `question` label), bug/feature flows via the existing YAML forms, PR guidelines with the four-required-checks table, Thank-you closer; the Excalidraw-stub pattern rejected deliberately — a stub pointing at docs would lose the repo's self-containment (no external docs site exists); (3) **stale-count sweep** — the recurring drift bit again: CONTRIBUTING.md said 961 unit/75 files + 171 e2e/39 files (last touched wave 1) and .github/copilot-instructions.md the same, PROJECT_STATUS.md's module map said "34 checks" for the E2E suite and "564 unit tests"/"152 E2E tests" in the commands cheat-sheet, and the ci.yml module-map row omitted e2e; all fixed from a fresh same-call measurement at develop `5c2b00d`: 1038 unit / 78 files, 175 e2e / 40 files; counts unchanged |
| **Last updated** | 2026-11-18 (tag-push release automation, wave 6 of the majors-research directive — releases are CI-driven in every comparable: none of the five uses release-please or changesets (`release-please-config.json` / `.release-please-manifest.json` / `.changeset/config.json` probed via the API: 404 in all five), instead AppFlowy's `release.yml` triggers on tag push and creates the GitHub Release before attaching artifacts, Excalidraw's `autorelease-excalidraw.yml` releases from CI tooling, Logseq's `build-*-release.yml` builds tagged releases; the gap here: the web/PWA production build was never verified on tags (desktop.yml verifies only the Tauri build), and desktop.yml's artifact step (`softprops/action-gh-release`, already SHA-pinned) would create the release with an empty body if the hand-written notes were not published first — an interrupted release flow hazard; adopted: `.github/workflows/release.yml` fires on `v*` tags — `tag-build-verify` runs the full build-smoke recipe (frozen install + `bun run build` with the webpack retry recipe + :3000 boot probe) against the tagged commit, then `ensure-github-release` creates the release with GitHub's auto-generated notes only if it does not exist (`gh release view` first, `gh release create --verify-tag --generate-notes` behind it) — idempotent by design, hand-measured notes published first are never overwritten, and a race with desktop.yml's artifact step degrades to a warning; invariants kept: plain `gh release` calls (no third-party release action, the wave-5 precedent), SHA-pinned actions only, `contents: read` workflow-wide with `contents: write` confined to the ensure job; skipped with evidence this cycle: coverage thresholds/trends (no comparable sets any — re-verified from the workflow inventories, Excalidraw's coverage stays threshold-free), size-report promotion to required (budget recorded 2026-11-16 is 2 days / a handful of green runs old — the aged criterion not met; also a branch-protection settings change, not PR-able code — re-evaluate next cycle), i18n locale-coverage lint (Excalidraw `locales-coverage.yml`, AppFlowy `ninja_i18n.yml`/`translation_notify.yml` — N/A, UI English-only since v1.9), CLA (Joplin `cla.yml` — external third-party app, repo invariant is no external bots), nightly web deploys (Logseq `deploy-web-*` — a product/infra decision, not on the roadmap); first live exercise is the next release tag; counts unchanged: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-17 (2) (CI failure commentary, wave 5 of the majors-research directive — the last remaining comparables-verified workflow practice: Joplin's `comment-on-failure.yml` posts a PR comment when the CI workflow completes with failure on a same-repo PR, naming the failed jobs and linking the run; adopted with one upgrade — Joplin pins quipper/comment-failure-action@v0.1.1 by mutable tag, here it is plain `gh api` calls (no third-party code, keeping the SHA-pinning invariant) behind a least-privilege block (actions: read + pull-requests: write + contents: read); skips by design: push failures (no PR to comment on) and fork PRs (empty `pull_requests` list in workflow_run events — GitHub's security boundary); the comment is informational only, merge gating stays with the required checks; also evaluated and skipped with evidence: dependency-review and first-interaction greetings (none of the four reachable comparables uses either — workflow inventories re-pulled from the API); cache-effect measurement (wave 4 follow-through): CI run durations pulled from the API show runner variance dominating (e2e job 429-648s for identical content), and no PR run has been cache-warm yet — caches restore only from the run's own branch or the default branch (`main`), whose first cache-saving push happened after every wave-4 PR had already run; the first warm-capable PR is this cycle's own, log-verified hit/miss + durations recorded in the worklog; counts unchanged: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-17 (CI acceleration + coverage report, wave 4 of the majors-research directive — the five comparables' workflow inventories re-pulled from the API this cycle; adopted: (1) **CI caching** — Logseq's `build.yml` practice (setup-node `cache: 'pnpm'` + explicit `actions/cache@v4` steps): every CI job, size-report and coverage now restores bun's install cache (`~/.bun/install/cache`) via SHA-pinned `actions/cache` v6.1.0 (`55cc834`, dependabot keeps it current) keyed on `bun.lock` with a prefix restore-key so a lockfile change downloads only the delta; e2e additionally caches Playwright's Chromium keyed exactly on the lockfile with NO restore-key (a stale browser must never satisfy the cache — a miss is today's behavior); setup-bun has no cache input — verified against its `action.yml` — so the cache is an explicit step; (2) **unit-coverage report on PRs** — Excalidraw's `test-coverage-pr.yml` practice as a new non-required `Coverage report / unit-coverage` check (`.github/workflows/coverage.yml`): `bun test --coverage` writes the table to the job summary (the bundle-size guard's channel — no third-party PR-comment action added to the supply chain), `if: always()` so the report renders even on failing tests, no thresholds, never blocks a merge; measured at develop `f939459`: aggregate 93.60% funcs / 95.69% lines, coverage overhead 4.65s vs 4.54s on the 1038-test suite; skipped with evidence: CODEOWNERS (none of the four reachable comparables has one — API-checked), dependabot auto-merge (Joplin's practice; #244's grouped action-pin PR included a major codeql bump that needed manual review — auto-merging would have skipped that); also fixed PIPELINE.md's stale unit count (1013/77 → 1038/78); counts unchanged: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-16 (3) (bundle-size guard — wave 3 of the majors-research directive, the Excalidraw `size-limit.yml` practice deferred from wave 2 until a real measured budget existed: measured the production build's client JavaScript at develop `7b24224` — 9,909.1 KiB across 173 `.js` files under `.next/static/chunks/` (initial + lazy, the full PWA payload; largest chunk 1,776.7 KiB) — and committed `scripts/size-budget.json` with a 10,400 KiB ceiling (~5% headroom) whose `measured` block pins the date/commit/values; new non-required `Bundle size / size-report` check (`.github/workflows/size.yml`, SHA-pinned actions as everywhere) builds the bundle and runs `scripts/check-bundle-size.mjs` — pure helpers (evaluateBudget/validateBudgetConfig/collectJsStats/formatKib/renderSummary) exported and pinned by 25 new unit tests in the normal suite, same pattern as fdroid-check.mjs; policy in code: a budget below its own recorded measurement is invalid, and a ceiling more than 20% above the recording is rejected so a failing check can never be silenced by cranking the number; over budget = red run + job summary, never a blocked merge; also fixed the stale README tests badge (983 — missed by the #241 and #251 sweeps) and re-measured counts: 1038 unit / 78 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-16 (2) (PR-hygiene adoption, wave 2 of the majors-research directive — verified the five comparables' `.github/workflows` via the GitHub API: Excalidraw `semantic-pr-title.yml` + `size-limit.yml` + `cancel.yml`, Joplin `check-pr-title.yml` + `close-stale-issues.yml`, Logseq `pr-labeler.yml` + `stale-issues.yml`, AppFlowy `commit_lint.yml`, AFFiNE `auto-labeler.yml` + `pr-title-lint.yml`; the redundancy-cancel practice was already here (ci.yml concurrency block, Excalidraw `cancel.yml` pattern), stale-issue handling skipped (one open issue), size-limit deferred; adopted: (1) **PR title check** — `.github/workflows/pr-title.yml` runs `src/lib/pr-title.ts` (`bun src/lib/pr-title.ts`, title via PR_TITLE env, never argv) enforcing `type: subject` / `type(scope): subject` with the 11 Conventional-Commit types — the practice docs/PIPELINE.md already mandated and every merged PR to date follows, now enforced; the validator is pinned by 30 new unit tests (real merged-PR titles as positives, queried from the API — no invented data); (2) **path-based PR labeler** — `.github/workflows/pr-labeler.yml` + `.github/labeler.yml` (actions/labeler v7.0.0 SHA-pinned bf12e9b) maps changed paths to existing labels (github_actions / documentation / dependencies / area:ui / area:canvas / area:data / area:import), runs on `pull_request` (never `pull_request_target` — repo invariant), no checkout needed, no `issues: write` (v7 doesn't create labels — all 7 pre-exist, API-verified); (3) docs/PIPELINE.md corrected — stale counts (75 unit tests, 24 e2e checks — missed by the #241 sweep) → re-measured 1013/77 unit + 175/40 e2e, the two new checks documented, PR-title step notes the enforcement; counts re-measured this cycle: 1013 unit / 77 files, 175 e2e / 40 files) |
| **Last updated** | 2026-11-16 (web share target capture — issue #247: the installed PWA now registers a `share_target` (POST multipart to `/share-target`), the service worker intercepts the OS share-sheet POST before the network, stashes it in a raw-IndexedDB mailbox (`infinitenote-share-inbox`) and redirects to /, and the boot drain lands each share as a Quick Notes page via the regular import pipeline — shared title becomes the page title (capped 80), body = text + url composed, files pass through to the existing importers (image/audio/pdf/text), URL-only shares fall back to the dated quick-note title, a share always produces a page; atomic read+clear drain so two tabs can never double-import; standalone fallback page for the pre-SW edge; sw.js mirrors the share-inbox constants — pinned in sync by unit tests; counts re-measured: 983 unit / 76 files, 175 e2e checks / 40 files; also fixed the stale README badge (858/156 — missed by the #241 count sweep) and the stale PROJECT_STATUS Totals line (564/152)) |
| **Last updated** | 2026-11-15 (community-practices adoption, researched from the comparable majors — Excalidraw, Logseq, Joplin, AppFlowy, AFFiNE: SECURITY.md added on the Joplin pattern — supported versions, private-vulnerability-reporting channel (already enabled, re-verified), reporting rules, and an explicit out-of-threat-model section adapted to local-first (DoS via imported content, physically-local attacks, plain data at rest, dependency advisories -> upstream); CODE_OF_CONDUCT.md added (Contributor Covenant 2.1); markdown issue templates converted to YAML issue forms (bug_report.yml + feature_request.yml + config.yml — every comparable with templates uses forms, none markdown); .github/copilot-instructions.md added (Excalidraw pattern) pointing Copilot at AGENTS.md's read order; CONTRIBUTING.md refreshed — dead `bun run db:generate` removed (script gone since v1.1 removed the server DB), stale counts fixed; stale counts fixed across README (858→961 unit, 156→171 e2e), PR template (34→171), AGENTS.md (7 files/24 checks→39/171), all re-measured (bun test: 961/75 files; playwright --list: 171/39 files); dependabot groups added — npm minor+patch one monthly PR, action-pin moves one weekly PR; CHANGELOG.md deliberately skipped: GitHub Releases carry the notes (v1.12-v1.14 bodies measured) and 3 of 5 comparables also rely on Releases alone; community health was 71% pre-change, re-measured post-merge) |
| **Last updated** | 2026-11-15 (2) (community health measured at **100%** after the #243 sync — was 71%; code_of_conduct credited, `issue_template` field still null by GitHub quirk though the forms work; first grouped dependabot PR #244 handled: 4 action-pin moves in one PR — codeql-action v3->v4.39.3 (breaking changes reviewed: bundle-version floors, not input-surface; validated by the PR's own CodeQL run on the new pins) + rust-cache within v2; retargeted to develop per #216 precedent, squash-merged 4e2aa5c, synced to main) |
| **Current version** | v1.16.0 (version files bumped via the release flow; tag + GitHub Release published at the end of the flow) |
| **Phase** | v1.15.0 released (release train executed 2026-11-18 — first live exercise of the wave-6 Release workflow); v1.16.0 released (release train executed 2026-11-20 — tables #277, file attachments #278, page templates #279 all shipped); v1.17.0 milestone (#18) open with hardware-blocked #193 + wave-13's #295 and wave-14's #301 shipped; majors-research waves 1-14 landed (community practices, PR hygiene, bundle-size guard, CI caching + coverage, failure commentary, tag-push release automation, CONTRIBUTING gateway + size-report promotion, the release train itself, release-notes convention + PR feature preview, product parity: tables on pages, general file attachments, custom page templates, internal page links, in-page find) |
| **Overall state** | 2026-11-20 (4): 1192 unit (87 files) + the 219-check E2E suite green, and **four required checks** per PR since 2026-11-18 (lint-typecheck-test + build-smoke + e2e + the promoted size-report; title check + path labeler + unit-coverage report stay non-required/informational); bun audit at 1 documented moderate (upstream-blocked minimatch@10.2.6 — see docs/SECURITY_AUDIT_2026-11-15.md); required checks + CodeQL (0 open alerts) + secret scanning + push protection + Dependabot security updates all on; CI failures on same-repo PRs post an informational summary comment (Joplin's practice, wave 5); `v*` tag pushes are CI-verified with the full build-smoke recipe and the release object is guaranteed to exist with at least auto-generated notes (AppFlowy's practice, wave 6); known issues: 0 |

## TL;DR

InfiniteNote is an open-source OneNote-style notebook for Linux and Android:
Notebook → Section → Page hierarchy on an infinite canvas (Excalidraw), draw/write
on anything, import images / text / Markdown / PDF printouts / .excalidraw scenes,
Word documents, OneNote-exported HTML and OneNote `.mht` single-file pages
(embedded images included), audio clips (import a file or record straight into
the page, playable on-canvas), export PNG / SVG / scenes / full backups,
full-text search, soft-delete trash, dark mode, per-page paper styles (plain /
ruled / grid), page tags with a tag filter view, and a fully offline
installable PWA.
All data is local (IndexedDB). The UI is English-only (the v1.7 English/简体中文 layer was removed in v1.9); CJK note *content* remains fully supported. v1.5 adds file-based sync phase 1: a sync folder
(or ZIP) with page-granular merge and conflict copies. v1.6 adds distribution:
a Tauri 2 Linux desktop shell (deb/rpm/AppImage artifacts on releases), an
Android TWA wrapper scaffold with tested Digital Asset Links tooling, and a
Flatpak/Flathub packaging recipe. v1.7 adds UI internationalization
(English + 简体中文), a themes gallery — six accent themes layered over
light/dark via a sidebar gallery with live swatches — and the F-Droid build
recipe with its validation tooling.
v1.10 adds a curated shape library — a OneNote-style Shapes toolbar
(desktop + mobile) inserting blocks/frames, arrow variants, elbow connectors
and sticky notes with bound labels as native Excalidraw elements — plus a
bundled-asset Android wrapper: the TWA serves the static export from APK
assets via WebViewAssetLoader, so airplane-mode first run renders the app
(F-Droid offline compliance). Imported images can no longer persist with a
stale "pending" status, and a full reload reopens the last-opened page.
**Bug-hunt wave 2** (issues #63, #77–#105, #107 — 31 fixes across 6 PRs) hardened
the whole surface: honest autosave + boot retry, always-fresh search/trash,
audio blocks and true vector shapes in PDF exports (CJK-safe footers),
CJK-aware import layout, IME-safe text input, localized generated names +
welcome seed (en/zh-CN), recorder error handling, shape-library persistence,
localized sync errors, flag-gated e2e hooks, an exactly-pinned pdf.js worker
pair and a TypeScript-honest build.
v1.1 added the duplicate-page action, Playwright E2E as a required CI check and
OneNote import phase 1 (.docx + HTML). v1.2 adds OneNote import phase 2 (`.mht`
single-file pages with embedded images + Graph export runbook) and page paper
styles (plain/ruled/grid). v1.3 adds page tags, OneNote-style quick capture
("Quick note" button + Ctrl/Cmd+Alt+N, a pinned **Today** daily page that is
created on first open and reused all day), and print-friendly paginated PDF
export (A4 portrait/landscape, vector text, sliced images).
v1.15 hardens the platform (strict desktop CSP, web security headers,
least-privilege CI with CodeQL, Advisory-DB-audited lockfiles) and adds
OS share capture: the installed PWA registers a Web Share Target, so
shares from the Android share sheet or desktop share UIs land as Quick
Notes pages.

## What works today (verified by tests)

| Area | State | Evidence |
|---|---|---|
| Notebook/Section/Page CRUD, rename, colors, reorder, duplicate page | Working | 34 E2E checks + unit tests |
| Infinite canvas, draw + type on anything | Working | E2E (real mouse draw, per-key typing) |
| Autosave + persistence across reloads | Working | E2E (autosave, flush-on-switch, save-indicator-calm: steady label under viewport-only churn, undo-inside-debounce never persists) |
| Page paper styles: plain / ruled / grid, persisted, zoom/pan-synced | Working | E2E background.spec (6 checks) |
| Imports: image, text, Markdown, PDF printout (20-page cap **with an explicit truncation notice**), `.docx`, OneNote HTML, **OneNote `.mht` with embedded images**, `.excalidraw`, **audio** — all types at once on one canvas, then ink + text on top; import toasts with explicit feedback; **PDF imports land a OneNote-style file chip (badge + file name) with the original bytes embedded** | Working | 36 E2E checks with fixture files (incl. e2e/import-overlay.spec.ts, e2e/import-pdf-truncation.spec.ts) |
| Exports: PNG, SVG, .excalidraw, **paginated PDF (A4 portrait/landscape — vector text, sliced images, paper-aware, audio blocks as labeled player strips, non-Latin footer titles rasterized, unrotated shapes as true vectors)**, notebook backup — filenames follow the current page title (renames included) and keep CJK/Unicode characters; export errors are localized toasts; the full backup restores into a wiped app through the UI | Working | 19 policy unit tests + 6 E2E checks (e2e/pdf-export.spec.ts, e2e/pdf-wave2.spec.ts) + e2e/export-filename.spec.ts + e2e/import-export-roundtrip.spec.ts (PNG magic/IHDR bytes, SVG markup content, scene export → re-import round-trip, backup export → wipe → UI restore round-trip, 8 checks) |
| Cross-page search (Ctrl+K — content index reloads on every open and is built once per open, not per keystroke), trash restore/purge (list refreshes live), search/tag jumps reveal their target in a collapsed tree | Working | Unit + 6 E2E checks (search-trash, state-freshness specs) |
| Page tags: add/remove in header, sidebar chips, tag filter view, search | Working | 14 unit tests + 4 E2E checks |
| Audio blocks (issue #67): import audio files + in-app recording (MediaRecorder), playable `<audio>` players on canvas, draw over clips, persisted via customData payload | Working | 31 unit tests + 7 E2E checks (e2e/audio.spec.ts) |
| Quick capture: "Quick note" button + Ctrl/Cmd+Alt+N, pinned Today daily page | Working | 17 unit tests + 4 E2E checks |
| **OS share capture (Web Share Target, issue #247)**: the installed PWA (Android share sheet, desktop share UIs) receives shared title/text/url + files (image/audio/pdf/text); the service worker stashes the POST in a raw-IDB mailbox and the boot drain lands each share as a Quick Notes page — shared title → page title (capped), body = text + url composed, files through the regular import pipeline; URL-only shares fall back to the dated title; a share always produces a page; atomic read+clear drain (two tabs never double-import) | Working | 22 unit tests (composition + fake-indexeddb mailbox + manifest/sw/app cross-pins) + 4 E2E checks (e2e/share-target.spec.ts — real POST through the registered service worker) |
| **Page version history**: per-page snapshot timeline (auto ≥ 5 min on structural change / manual "Save version now" / automatic pre-restore safety copy), restore to any version (DB-write + canvas remount — the proven sync path), 25-per-page FIFO budget, newest-first dialog; versions are local-only (excluded from backups and the sync folder), trash keeps them, purge cascades | Working | 35 unit tests + 5 E2E checks (docs/test-plans/version-history.md) |
| **OCR (on-device)**: "Recognize text in images" (Page actions ⋯) runs tesseract.js 6.0.1 — vendored under `public/ocr/` (engine, LSTM cores ×2, **German fast model — recognizes English AND German incl. umlauts/ß**; no CDN, offline after first use; the eng+deu combination modes strip umlauts, evidence in docs/test-plans/ocr.md) — over every image element, stores `customData.ocrText` (normalized, 20k-code-point cap) in the scene, and the recognized text becomes full-text-searchable content with snippets; per-image failures never abort a batch; typed error toasts; assets pinned by sha256 drift tests | Working | 37 unit tests + 5 E2E checks with the real engine, incl. the German fixture (docs/test-plans/ocr.md) |
| **PDF file chips (OneNote-style)**: every PDF printout import embeds the ORIGINAL file bytes in an Excalidraw embeddable chip above the rendered pages (red PDF badge + file name, survives restore/version history); right-clicking the chip opens a context menu — **View file** (blob URL, new tab), **Download file** (byte-exact original, offline forever), **Copy file name** (clipboard + toast); files over the 10 MiB cap import as plain printouts with an explicit skip toast; chip names are full-text-searchable | Working | 29 unit tests + 11 E2E checks incl. byte-exact round-trip (docs/test-plans/pdf-attachment.md) |
| Themes gallery (issue #55): six accent themes over light/dark, live swatches, persisted + pre-hydration restore, localized labels | Working | 19 unit tests + 4 E2E checks (e2e/themes.spec.ts) |
| Sidebar multi-select: checkboxes, select-all (expanded sections), bulk move (cross-notebook) + bulk delete → trash | Working | 26 unit tests + 4 E2E checks |
| Keyboard shortcut cheatsheet (? / Ctrl+Cmd+/, sidebar button, platform-aware ⌘/Ctrl) | Working | 11 unit tests + 3 E2E checks |
| Dark mode, mobile drawer navigation | Working | E2E + visual review | 
| App-surface overlap/clipping sweep: every first-party dialog, dropdown, popover, context menu and the mobile drawer — pairwise bounding-box + viewport-clipping audit of all interactive controls at 1280/900/768/390/320, zero-console-error guard, named-controls a11y pin | Working | 6 E2E checks (e2e/ui-surface-sweep.spec.ts, also verified against a production build) |
| UI: English-only chrome (the v1.7 en/zh-CN i18n layer — next-intl, catalogs, language toggle — was removed in v1.9; single locale, no switcher); CJK content (titles, tags, search, IME-safe input) fully supported | Working | plural/sync-summary/generated-names unit tests + E2E (IME renames, themes labels) |
| PWA install (Linux + Android), offline SW | Working | E2E asset checks |
| Hardened platform: autosave verifies the write landed (no false "Saved"), failed boots offer Retry, shape library survives reloads, recordings survive mic failures and minute-collisions, e2e hooks require a `NEXT_PUBLIC_E2E=1` build, pdfjs-dist pinned to the vendored worker with a drift test, `next build` fails on type errors | Working | hardening/boot-retry/save-content/reveal-focus unit tests + recorder-library/state-freshness E2E |
| OneNote migration runbook (manual + Microsoft Graph script) | Documented | docs/onenote-migration.md, scripts/graph-export.mjs |
| Sync & collaboration research (CRDT survey, file-based sync, E2EE server, phased plan) | Documented | docs/sync-research.md |
| CI: lint, typecheck, unit tests, build, smoke boot, browser E2E | Required checks on every PR | GitHub Actions |
| File-based sync (phase 1): folder/ZIP export + merge, conflict copies, purge tombstones, foreground re-scan; out-of-contract folders heal (a stale page file + its tombstone merges as deleted — restorable, never resurrected) | Working | 56 sync unit tests (46 + 10 in sync-fsa/sync-merge) + 5 E2E checks (e2e/sync.spec.ts) |
| Desktop shell (Tauri 2): static-export build path, `src-tauri/` config + icons, Linux artifact workflow | Working — export build verified; binaries built by CI on `main`/tags | desktop-config unit tests + `.github/workflows/desktop.yml` (docs/desktop.md) |
| Android TWA: wrapper scaffold (Gradle/manifest/resources) + tested assetlinks.json generator | Working — generator CLI verified; APK built per docs/android-twa.md on a contributor machine | assetlinks + android-config unit tests, `scripts/generate-assetlinks.mjs`, `android-twa/`, docs/android-twa.md |
| Flatpak packaging: AppStream metainfo, flatpak-builder manifest (extra-data AppImage), extradata pinning tool, Flathub runbook | Working — recipe pinned by unit tests; checksums pinned after each release by scripts/flatpak-extradata.mjs | packaging-config unit tests, `packaging/flatpak/`, `scripts/flatpak-extradata.mjs`, docs/flathub.md |
| F-Droid packaging (issue #56): build metadata YAML, versionCode scheme (major×100+minor×10+patch), fdroid-check validator, runbook | Working — metadata + tool verified by 21 unit tests + a real CLI run | fdroid-config unit tests, `packaging/fdroid/`, `scripts/fdroid-check.mjs`, docs/fdroid.md |

**Totals: 1192 unit tests, 219 Playwright E2E tests (required in CI), 0 known bugs, 0 TODOs in `src/`.**

## In flight

- **v1.16.0 release train** (next): version bump + release PR
  develop-to-main (merge commit) + tag v1.16.0 + GitHub Release with
  hand-written notes under the wave-9 convention, then milestones
  rotate (v1.16.0 closed with hardware-blocked #193 moved forward, the
  v1.15.0 precedent; v1.17.0 opened). Shipped since v1.15.0: tables on
  pages (#277), general file attachments (#278), custom page templates
  (#279) — the three OneNote everyday-parity features of the
  product-parity direction (waves 10-12).
- **#193** (real-GPU HWR benchmark) hardware-blocked, carried forward
  at each release (the v1.15.0 precedent): the measurement needs a
  real-GPU machine; the capability gate + measured WASM baseline
  already shipped (v1.14.0).

## Next up — the v1.16.0 release, then v1.17 (see [docs/ROADMAP.md](docs/ROADMAP.md))

1. Cut v1.16.0 (the release train above) — the milestone's three
   implementable issues (#277/#278/#279) are all shipped
2. #193 real-GPU HWR benchmark — hardware-blocked, carried forward
3. Further product-parity candidates from the majors research
   (evidence-first, wave by wave)

## Repo map (30 seconds)

| Path | What it is |
|---|---|
| `src/lib/types.ts` | Data model: Notebook/Section/Page, BackupFile |
| `src/lib/notes-db.ts` | Dexie schema + CRUD + trash cascade + backup/restore |
| `src/lib/tree-ops.ts` | OneNote-style selection semantics after delete |
| `src/lib/search.ts` | Scene text extraction + ranked search |
| `src/lib/store.ts` | Zustand store, single-flight load, welcome seed |
| `src/lib/excalidraw-utils.ts` / `-client.ts` | SSR-safe canvas API contract / browser runtime |
| `src/lib/docx-import.ts` / `html-import.ts` / `import-blocks.ts` | OneNote phase-1 importers: Word + HTML → structured text blocks |
| `src/lib/page-templates.ts` | Page templates policy: names, 10 MiB cap, scene parsing, picker order (issue #279) |
| `src/lib/tags.ts` | Page tags: normalization, dedupe, collect + filter helpers |
| `src/lib/quick-notes.ts` | Quick capture: date keys, quick-note/daily-page titles |
| `src/lib/audio-notes.ts` | Audio blocks: classification, recorder mime/extension picking, duration + filename helpers, link-scheme markers, import size cap (issue #67, #91, #95) |
| `src/lib/generated-names.ts` + `src/lib/e2e-gate.ts` | Generated names, English set (issue #63) + e2e-hook build gate (issue #102) |
| `src/lib/pdf-layout.ts` | Print pagination math: page bands, box banding, text line flow |
| `src/lib/pdf-export.ts` | jsPDF renderer: A4 sheets, vector text, clipped slices, paper + footer |
| `src/lib/mht-import.ts` | OneNote phase-2: `.mht` MIME parser (QP/base64 parts, cid/location map) |
| `src/lib/sync/` | File-based sync phase 1: folder format, merge engine (LWW + conflict copies), runSync, ZIP + File System Access adapters, folder-handle state |
| `src/components/notes/sync-dialog.tsx` | Sync UI: connect folder / Sync now / merge or download sync ZIP, change summary |
| `scripts/graph-export.mjs` | Microsoft Graph OneNote export → self-contained HTML per page |
| `src/components/notes/*` | App UI: sidebar, search, trash, canvas wiring |
| `src/app/` | Next.js App Router entry + layout |
| `public/` | PWA manifest, service worker, icons, self-hosted Excalidraw fonts, pdf.js worker |
| `e2e/` + `playwright.config.ts` | Playwright E2E suite — 219 checks in 46 files, runs in CI (issue #3; measured 2026-11-20) |
| `.github/workflows/ci.yml` | CI: lint-typecheck-test + build-smoke + e2e (required) |
| `docs/` | Architecture, roadmap, decisions, pipeline |
| `.agents/skills/` | Vendored agent-engineering skill set (mattpocock/skills, MIT) — repo tooling for AI-assisted development, not app code |

## Commands cheat-sheet

```bash
bun install                            # first-time setup
bun run dev                          # dev server on :3000
make test                            # 1192 unit tests
make e2e                             # 219 E2E tests (Playwright; boots the app if needed)
make status                          # quick status snapshot (this file's head + git info)
```

## Recent history

- **2026-11-18 — v1.15.0 released**: release train executed per
  docs/PIPELINE.md — version-bump PR, release PR develop-to-main (merge
  commit), tag v1.15.0 + GitHub Release with hand-measured notes,
  milestones rotated (v1.15.0 closed, v1.16.0 opened with #193 moved
  over); the tag push is the first live exercise of the wave-6 Release
  workflow. Ships vs v1.14.0: OS share capture into Quick Notes (Web
  Share Target, #247), HWR conversion integrity + focus fixes
  (#205/#231/#234), stale-dialog dismissal guard (#226), desktop CSP
  (#218) + web security headers (#206), least-privilege CI + CodeQL +
  Dependabot (#208/#212/#216), transitive-lockfile audit remediation
  (#222/#224/#230/#235) + scripts/audit-lockfile.py (#238), community
  practices (SECURITY.md, CoC, YAML issue forms, copilot guide, #241),
  and majors waves 2-7 (#251/#255/#258/#261/#264/#267). Note: Recent
  history entries for the v1.11.0-v1.14.0 releases live in their GitHub
  Release notes + the worklog (this section had drifted to 2026-11-09);
  re-measured at the release-prep branch: 1038 unit / 78 files, 175 e2e /
  40 files, 0 known bugs.
- **2026-11-09 — verification pass on the top-2 features + E2E click
  hardening**: full gate re-run on the merge state of #154/#155 —
  lint/typecheck clean, 531/531 unit, E2E in CI mode (production build,
  workers=2, retries=1) 140/140 first-try, both feature specs green in
  isolation. Two dev-mode-only flakes hardened the #152 way (both
  once-only clicks inside open Radix dialogs under the
  memory-constrained serial dev-server run): the bulk-move target row
  (the freshly-opened dialog's overlay once intercepted the click for
  the whole action timeout) and the sync ZIP download (click once
  silently dropped) now retry — final attempt uncaught, assertions
  unchanged. Stale cheat-sheet counts corrected (451/122 → 531/140).
- **2026-11-09 — OneNote-style PDF file chips (fully TDD)**: user
  requirement — a PDF printout must carry a small file icon with its name,
  and right-clicking it must offer multiple options incl. downloading the
  file. Design mirrors the audio embeddables (#67): an Excalidraw
  embeddable whose `link` carries the `infinitenote:pdf` marker scheme
  (survives link sanitization) and whose `customData` holds the payload —
  the ORIGINAL file bytes as a data: application/pdf URL — so the chip
  moves/zooms/exports/restores like any element and the file stays
  downloadable byte-exactly, offline, forever. Right-click is intercepted
  in the capture phase on the canvas wrapper (client → scene coords via
  Excalidraw's own transform helper, rotation-exact hit-test — React
  bubbles contextmenu at the app root, so the wrapper capture provably
  beats both the native and Excalidraw menus). Menu: View file (blob URL,
  new tab), Download file (the proven downloadBlob), Copy file name
  (clipboard + toast). 10 MiB attachment cap checked BEFORE scene mutation
  (audio #91 stance): oversized PDFs keep importing as plain printouts +
  skip toast. One updateScene per import → single undo removes chip+pages.
  Chip names searchable (audio-name parity). Plan-first: docs/test-plans/
  pdf-attachment.md; +29 unit (564) incl. rotation-exact hit-testing and
  base64→Blob byte-exactness; +11 E2E (152) incl. the byte-exact download
  round-trip and the oversized skip; count cascades updated in
  imports/import-overlay/import-pdf-truncation specs (+1 element each).
  Env findings: headless Chromium needs clipboard-write permission grants
  and cannot commit top-level blob: PDF navigations (assertions adjusted;
  headed Chrome renders the viewer).
- **2026-11-09 — German OCR model swap (fully TDD)**: user requirement
  "OCR must understand German too." Probed the real tesseract.js 6.0.1 with
  the vendored `.traineddata.gz` bytes: the combination modes `eng+deu` /
  `deu+eng` let the English model outvote the umlauts away (Ä→A, Ö→O, Ü→U —
  1/9 and 3/9 German probe words correct), while the single German fast
  model aced all nine German probes AND every English probe. `deu` now
  drives the engine; `eng` is dropped (−1.98 MB). New: OCR-L01/L02 policy
  exports, OCR-A05 policy↔manifest drift guard, OCR-A06 driver drift guard,
  OCR-E05 German E2E (GÄSTEBUCH / MÜNCHEN STRAßE fixture, umlauts intact
  through engine→customData→search); OCR-E02 (English) unchanged as the
  regression net and still green. +4 unit (535), +1 E2E (141).
- **2026-11-09 — On-device OCR for images & PDF printouts (fully TDD)**:
  "Recognize text in images" (Page actions ⋯) makes imported images and
  PDF printouts full-text searchable. The engine (tesseract.js 6.0.1 +
  LSTM cores + English fast model, ≈10 MB) is vendored under `public/ocr/`
  — no CDN at any point, cache-first via the service worker after first
  use (offline-first / F-Droid stance); a sha256 manifest with drift tests
  pins every byte. Results attach to the scene (`customData.ocrText`,
  whitespace-normalized, surrogate-safe 20k cap) and flow into the existing
  search index as content. Unit tests drive an injected engine (the wasm
  never runs in unit tests); the E2E runs the REAL engine against a
  committed fixture ("QUOKKA NOTEBOOK") and proves the whole path:
  import → recognize → search hit → reload persistence. +35 unit (531),
  +4 E2E (140).

- **2026-11-09 — Page version history (fully TDD)**: a local, per-page
  timeline of scene snapshots with point-in-time restore (OneNote "page
  versions" parity). New `pageVersions` table (Dexie schema v3, additive —
  a v2 database upgrades in place, test-pinned), a pure policy module
  (interval-throttled auto snapshots gated by the autosave gate's own
  structural fingerprint, FIFO pruning, locale-free relative times), a
  History dialog behind one "Page actions" (⋯) menu button (the title bar
  stays overlap-audit-clean), and restore via flush → pre-restore safety
  snapshot → DB write → canvas remount. TDD: the full matrix
  (docs/test-plans/version-history.md — 30 policy + 13 data-layer + 5 E2E
  cases) was written first and watched fail, then implemented to green;
  the E2E also exposed the dialog-close click-swallow fixed in #153.
  +35 unit (496), +5 E2E (136).

- **2026-11-09 — closing a dialog no longer swallows the next click**: the
  first canvas interaction within ~100 ms of closing any dialog was silently
  dropped. Two stacked causes, both fixed: Radix keeps `pointer-events:
  none` on `<body>` until the exit-animated layer unmounts (the Dialog and
  Sheet wrappers now clear it the moment `open` flips false), and the
  closing overlay itself still carried an inline `pointer-events: auto`
  (a `!important` closed-state rule in globals.css, modal overlays only).
  Found by the new version-history E2E while it drove the canvas right
  after a dialog close; regression-pinned by e2e/dialog-close-click.spec.ts
  (style probe + functional raw click). +1 E2E check (131).
- **2026-11-09 — proactive investigation cycle (#148/#149/#150)**: probe-first
  sweep of three untouched surfaces in the established style. (1) Console
  sweep: a scripted driver exercised 16 flow phases (draw, CJK text,
  rename, undo/redo, shapes, image/text/Markdown/audio/PDF imports, PNG
  export, search, tags, trash, themes, quick note, shortcuts, paper
  style, reload) capturing every console warning/error — **clean**; the
  scary-looking click-blocker cascade during probing was root-caused to
  probe artifacts (an open Radix menu blocks outside pointer events by
  design; wrong shape testids), not an app defect. (2) Sync deep-dive
  (#148): the merge's remote-only branch ignored remote tombstones, so a
  folder carrying BOTH a stale page file and its tombstone (partial
  replication, crashed write, or a zero-page write whose cleanup was
  skipped) resurrected deleted pages on every fresh device; both halves
  fixed (shared `applyRemoteTombstone`, unconditional stale-file
  cleanup) with 10 unit + 1 E2E regressions. (3) Focus management
  (#149/#150): every controlled dialog, the mobile drawer and the
  rename editor dropped focus to `<body>` on close (WCAG 2.4.3); a
  global outside-focus memory restores it, and the rename fix uncovered
  a keydown-activation subtlety (React flushes the focus-return effect
  inside the Enter dispatch — `preventDefault` keeps the browser from
  clicking the newly focused title button) with 9 E2E regressions.
  461 unit + 122 E2E green on develop.
- **2026-11-08 — app-surface sweep (follow-up to the overlap audit in the
  same style: probe first, then fix, then pin)**: extended the
  five-viewport overlap audit from app chrome to EVERY first-party
  surface — six dialogs, five dropdown menus, the tag popover, page-row
  context menus and the mobile navigation drawer — plus a
  zero-console-error guard across the whole run (clean). Four real
  defects fixed: (1) the search dialog's input ran under its close
  button, so a click near the input's right edge closed the dialog and
  lost the query — the input row now keeps clear of the X (pinned by a
  mis-click E2E); (2) the mobile drawer's close X sat on top of the
  "Add notebook" button — the sheet content now starts below it; (3)
  the export menu's PDF flyout submenu flipped off-screen left below
  ~640px, making both orientations unreachable on phones — at mobile
  widths the orientations flatten into plain menu items; (4) the trash
  dialog's row forced the dialog wider than a 320px viewport (Radix
  ScrollArea's table-layout viewport measures at preferred width) and
  its purge button was an unnamed icon — plain overflow container +
  aria-label. Also: the header's Search/Import/Export triggers keep
  accessible names below sm/lg (icon-only but labeled), and the search
  dialog no longer rebuilds its full-page JSON.parse index on every
  keystroke (index memo split from the query memo). 451 unit + 120 E2E
  green (dev + production build for the new spec).
- **2026-11-08 — save-indicator calm pass (user report: "Saved" flickered;
  "check if any buttons overlap")**: Excalidraw's onChange fires for
  appState-only updates (pan, zoom, selection, tool switches) and each one
  used to schedule an autosave of identical content — every viewport
  interaction blinked the indicator. Autosave is now gated on a
  `sceneSignature` (id@version:status per element + file set,
  order-independent) primed from `initialData`; a scene that returns to the
  persisted state (edit undone inside the debounce window) drops its pending
  stash instead of letting a stale timer write it; the "Saving…" label is
  deferred 200ms so fast IndexedDB commits never flash it. Root-causing the
  undo path found a real data bug: onChange delivers `isDeleted` tombstones
  (undo/redo leftovers), and they were persisted — `sanitizeScene` now drops
  them (and their files), so DB rows, sync folders and backups stop
  accumulating invisible garbage; tombstone-polluted pages self-heal through
  one normalizing save. The new five-viewport chrome overlap audit found one
  real defect: below 360px the header pushed the theme toggle past the
  viewport edge — it now yields below 360px (theming stays reachable via the
  sidebar gallery). New tests: 10 sceneSignature + 5 structural-fingerprint + 2
  tombstone-filter unit tests; E2E `save-indicator-calm.spec.ts` (organic autosave, steady label,
  undo-never-persists) and `ui-overlap.spec.ts` (1280/900/768/390/320 audit);
  dev probes `scripts/flicker-probe.ts` (50ms label sampling) and
  `scripts/header-probe.ts` (320px header boxes). 451 unit + 114 E2E green.

- **2026-11-08 — full import/export verification pass**: every transfer
  surface now has content-level E2E. New e2e/import-export-roundtrip.spec.ts
  (8 checks): PNG export bytes (magic + IHDR + non-stub size), SVG export
  markup (typed text survives as vector text), .excalidraw scene export →
  re-import round-trip (elements, typed text, image dataURL, persistence),
  full-backup export → wiped app → UI restore round-trip (tree + content
  intact), and the wrong-file restore error toast. Two fixes fell out of the
  pass: restoreBackup now throws a typed RestoreError (code `notABackup`,
  issue #85 parity — expected failures toast without console.error noise),
  and the shared createTextElement e2e helper clicks right of the Shapes
  island, killing a full-suite flake in state-freshness.spec. 434 unit +
  107 E2E green.
- **2026-11-08 — v1.10.0 released**: release PR #131 merge-committed to main
  (9ee3809), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.10.0)
  and published; v1.10.0 milestone closed (#64/#65/#122/#123), v1.11.0 opened
  with the handwriting recognition research issue (#133). Ships the curated
  shape library (#65), the bundled-asset Android TWA (#64), and the
  manual-pass fixes (#122 pending-status invariant + single-sourced drops,
  #123 last-opened page restore).
- **2026-11-07 — v1.9.0 released**: release PR #119 merge-committed to main
  (1797bb2), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.9.0)
  and published; v1.9.0 milestone closed (#117), v1.10.0 opened with
  #64/#65. The release ships exactly one change — the English-only
  interface — deliberately small and easy to review.
- **2026-11-07 — English-only interface (#117, PR #116)**: the v1.7 next-intl
  layer (en/zh-CN catalogs, provider, sidebar Language toggle, locale-aware
  generated names) removed end to end, net −1,607 lines. English literals at
  every call site, a tiny `plural()` helper for ICU plurals, labels moved
  into the shortcuts/themes data modules, export/sync error codes mapped to
  English messages, sync summaries via `formatSyncSummary()`. CJK *content*
  support kept (IME-safe input, CJK layout/footers/filenames,
  surrogate-safe truncation). Also fixed the #94 no-page toast that
  referenced a catalog key that never existed. 401 unit + 86 E2E green.
- **2026-11-07 — v1.8.0 released**: release PR #115 merge-committed to main
  (2cea610), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.8.0)
  and published — audio blocks (#67), the full import-overlay matrix (#68),
  localized seed (#63) and bug-hunt waves 1–2 (35 fixes); v1.8.0 milestone
  closed (33 issues).

- **2026-11-07 — Bug-hunt wave 1 (issues #72–#75)**: a full audit (gates +
  manual code review of audio/imports/exports/sync/i18n) surfaced four real
  defects, all fixed in one PR: exports captured stale mount-time
  title/paper (#72 — latest-value refs in the canvas api surface), canvas
  import toasts were hardcoded English (#73 — new `canvas.*` message
  namespace, en + zh-CN), non-ASCII page titles collapsed to "untitled" in
  export filenames (#74 — Unicode-aware `titleToFilename` + shared
  `downloadBlob` for backups), and PDF printout imports silently truncated
  at the 20-page cap (#75 — explicit "first 20 of N pages" notice, blank
  text files no longer counted as imported). +10 unit tests (368), +7 E2E
  checks (85).
- **2026-11-07 — v1.7.0 released**: release PR #62 merge-committed to main
  (60e9d3a), [tagged](https://github.com/shalosi00/infinitenote/releases/tag/v1.7.0)
  and published with release notes; v1.7.0 milestone closed, v1.8.0 opened
  with issues #63/#64/#65 from the backlog. The v1.7 cycle shipped i18n
  (#54/#58), the themes gallery (#55/#59) and the F-Droid recipe (#56/#60) —
  326 unit tests, 65 E2E checks, all required CI green on every PR.
- **2026-11-07 — Themes gallery (issue #55)** — six accent themes (violet
  default, ocean, forest, sunset, rose, graphite) layered over light/dark
  via `data-theme` on `<html>`: pure catalog (`lib/themes.ts`), sidebar
  gallery dialog with live light/dark swatches, pre-paint restore script in
  the root layout, persisted choice, full en/zh-CN catalogs. 19 new unit
  tests (+4 E2E checks). PR #59.
- **2026-11-07 — F-Droid recipe (issue #56)** — `packaging/fdroid/`
  build metadata, `scripts/fdroid-check.mjs` validator (required fields,
  versionCode scheme major×100+minor×10+patch, ascending builds, tag refs),
  cross-file version parity with the TWA scaffold pinned by 21 unit tests,
  `docs/fdroid.md` runbook (fdroidserver test-build → fdroiddata submission
  → policy notes incl. the bundled-asset TWA follow-up). PR #60.
- **2026-11-07 — housekeeping (#57)** — development journal is now a tracked
  file (`docs/WORKLOG.md`); gitignore/AGENTS updated so working state can
  never silently live in untracked files; roadmap v1.6/v1.7 sections
  refreshed with issue ties.
- **2026-11-07 — UI i18n (issue #54)** — the whole app chrome speaks English
  and 简体中文: message catalogs with ICU plurals for both locales, a client
  AppI18nProvider (localStorage-persisted locale + browser detection + `<html
  lang>` sync, no i18n routing — works in the static Tauri export), a
  Language toggle in the sidebar footer, localized shortcuts cheatsheet
  (data now carries stable ids) and localized sync change summaries
  (describeSummary → pure summaryParts + formatter hook). Catalog parity
  (key sets, non-empty values, placeholder sets) is enforced by unit tests.
  Generated data names ("Quick Notes" notebook, dated quick-note titles)
  stay English until a stable quick-notes marker exists — tracked in the
  backlog. 286 unit tests (+20), 61 E2E checks (+5).

- **2026-11-07 — v1.5.0 live**: release PR #42 merge-committed to main (c70513f),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.5.0);
  v1.5.0 milestone closed, v1.6.0 milestone opened. Issues #36/#37 closed.
- **2026-11-07 — sync UI (issue #37)** — Sync dialog in the sidebar footer:
  connect a sync folder (File System Access, Chromium desktop) with
  "Sync now" + background re-scan on window focus, or download/merge a sync
  ZIP on any browser (fflate, loaded on demand). Merges surface a change
  summary; the open page reloads after a sync without flushing stale
  canvas state. 227 unit tests (+4), 56 E2E checks (+4).
- **2026-11-07 — sync engine re-landed (issue #36, PR #39)** — #38 merged
  empty due to a sandbox glitch (branch ref reset before the PR opened);
  #39 re-landed the identical engine: folder format, three-way merge with
  conflict copies, purge tombstones, Dexie v2, runSync. 42 unit tests.
- **2026-11-06 — v1.4.0 live**: release PR #34 merge-committed to main (cf99ae4),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.4.0);
  v1.4.0 milestone closed, v1.5.0 milestone opened. Issues #27/#28/#29 closed.
- **2026-11-06 — sync & collaboration research (issue #29)** —
  docs/sync-research.md: why snapshot/LWW sync cannot work for scenes,
  Yjs-vs-Automerge survey (recommendation: Yjs for the no-WASM,
  any-transport update-log fit), Option A file-based sync folder design
  (manifest + per-page docs, phased: conflict copies → CRDT merge), Option B
  self-hostable E2EE blob server (Argon2id passphrase → wrapped content
  keys, blind server), shared-notebook scoping, and a v1.5/v2.0/post-2.0
  phased plan. Docs-only; no runtime changes.
- **2026-11-06 — shortcuts cheatsheet (issue #28)** — `?` (Shift+/) or
  Ctrl/Cmd+/ (and the sidebar footer button) opens a grouped cheatsheet:
  General (search, quick note, dialogs), Organizing (rename), Canvas tools
  and Canvas editing — every entry verified against the real handlers (tool
  keys probed through the embedded Excalidraw appState; ⌘/Ctrl rendered per
  platform). 181 unit tests (+11), 52 E2E checks (+3).
- **2026-11-06 — sidebar multi-select (issue #27)** — a list-checks toggle in
  the sidebar header turns on checkbox selection for page rows (clicking a
  row toggles instead of navigating); the bulk bar offers select-all scoped
  to expanded sections, "Move to…" (any section, cross-notebook, appended in
  sidebar-visible order, no-op targets disabled) and "Delete" (soft delete
  with one shared timestamp). The open page follows a bulk move; bulk delete
  recomputes the selection so it never lands on a deleted page. 170 unit
  tests (+26), 49 E2E checks (+4).

- **2026-11-06 — v1.3.0 live**: release PR #25 merge-committed to main (f3e154d),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.3.0);
  v1.3.0 milestone closed, v1.4.0 milestone opened. Issues #18/#19/#20 closed.
- **2026-11-06 — paginated PDF export (issue #20)** — "Export → PDF — print
  (A4)" renders the scene onto fixed A4 portrait/landscape sheets: content is
  scaled to the printable width and sliced into page bands; images and shapes
  print as continuous clipped slices across pages while text flows line-by-line
  (never cut mid-glyph) as selectable vector Helvetica; rotated elements and
  non-Latin text fall back to 2× raster snippets; paper style (ruled/grid) and
  a title/page-number footer are drawn per sheet; always light paper. New dep:
  jspdf (loaded on demand). 144 unit tests (+16), 45 E2E checks (+3).
- **2026-11-06 — quick notes + Today page (issue #19)** — "Quick note" button in
  the sidebar and Ctrl/Cmd+Alt+N append a dated page to an auto-bootstrapped
  "Quick Notes" notebook/section and focus the canvas for typing; a pinned
  **Today** entry opens (or creates) the daily page named after the local date,
  reusing it all day. Quick notes are ordinary pages — search and tags see them.
  128 unit tests (+17), 42 E2E checks (+4).
- **2026-10-19 — v1.3 starts: page tags (issue #18)** — tag picker in the page
  header (chips + quick-add), tag chips on sidebar page rows, a cross-notebook
  tag filter view, search matches tags; backup/restore now also preserves
  paper style (pre-existing gap found while wiring tags through). 111 unit
  tests (+14), 38 E2E checks (+4).
- **2026-10-19 — v1.2.0 live**: release PR #16 merge-committed to main (aae09ed),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.2.0);
  v1.2.0 milestone closed, v1.3.0 milestone opened.
- **2026-10-19 — v1.2.0 release**: OneNote import phase 2 merged via PR #14
  (all three required CI checks green); version bumped to 1.2.0.
- **2026-10-19 — v1.1 close-out PR**: OneNote import phase 2 — `.mht` single-file
  pages with embedded images (placed between text blocks), HTML `data:`-image
  import, Microsoft Graph export runbook + script; page paper styles
  (plain/ruled/grid) with a viewport-synced ruled overlay. 97 unit tests
  (22 new), 34 E2E checks (8 new).
- **2026-10-19 — v1.1.0 live**: release PR #10 merge-committed to main (a2ec743),
  tagged, [GitHub Release published](https://github.com/shalosi00/infinitenote/releases/tag/v1.1.0);
  v1.1.0 milestone closed, v1.2.0 milestone opened.
- **2026-10-19 — v1.1.0 release**: 4 PRs — duplicate page (#5), Playwright E2E
  required in CI (#6), OneNote import phase 1 (#7), scaffolding cleanup (#8).
  75 unit tests, 26 E2E checks, three required CI checks.
- **2026-10-19 — scaffolding cleanup**: unused Prisma/template leftovers removed;
  `bun install` is now the only setup step and CI no longer generates a client.
- **2026-10-19 — OneNote import phase 1 (issue #4)**: Word (`.docx`) and OneNote-HTML
  pages import as structured text blocks (headings, nested lists, tables); pure
  extractors, 25 new unit tests, 2 new E2E checks, migration guide added.
- **2026-10-19 — E2E in CI (issue #3)**: the 34-check agent-browser shell harness
  became a 24-check Playwright suite (7 parallel spec files, deterministic
  `resetToSeed`, console-error guard) that CI runs against the production build.
- **2026-10-19 — duplicate page**: first feature PR through the full pipeline (branch →
  PR → required CI checks → squash merge into `develop`, closes #2). 49 unit tests.
- **2026-10-19 — v1.0.0**: First public release. Full app, tests, CI pipeline,
  branch protection, release flow (see GitHub Releases for notes).
- **2026-10-19 — bootstrap**: repository moved to GitHub, pro pipeline established
  (PR flow, required checks, docs, status system).

## Update protocol

1. Every PR updates the relevant row(s) above (or `In flight` / `Next up`).
2. On merge, refresh `Last updated` and `Recent history`.
3. `In flight` must always name the branch or issue currently being worked on.