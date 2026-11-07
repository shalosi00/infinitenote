# Worklog — development journal

> **Purpose.** This is the durable, versioned working journal for InfiniteNote.
> It exists so that working state (what was done, what is in flight, what is
> next, and hard-won environment lessons) can never be lost again — everything
> here is committed and pushed with the repo. It complements
> [PROJECT_STATUS.md](../PROJECT_STATUS.md) (the 2-minute snapshot) with
> session-level detail.
>
> **Protocol.** Append a dated entry at the top when a work session starts and
> update it before the session ends. Keep entries concise; link PRs/issues.
> Releases are recorded in PROJECT_STATUS.md "Recent history" — do not
> duplicate them here beyond a one-liner.

## Session protocol (for agents and humans)

1. On resume: read PROJECT_STATUS.md, then this file's latest entry.
2. Branch per feature (`feat/…`, `chore/…`), PR into `develop`, required
   checks must be green before merge.
3. **Commit and push early and often** — every meaningful milestone lands on
   the remote feature branch the moment it compiles/tests. Nothing valuable
   may exist only in the working tree.
4. Before ending a session: ensure `develop` and any open PRs reflect reality,
   update this file, push.

## Environment lessons (sandbox hazards)

- The development sandbox is periodically restored: `HEAD` can snap back to
  `main` and the working tree resets — sometimes mid-command. Branch refs,
  pushed commits, remotes and some untracked files survive; **uncommitted
  working-tree changes and gitignored files do not**.
- Consequences (all learned the hard way):
  - Push feature branches immediately after each green milestone.
  - Do `checkout` + verification in a single shell call.
  - If a rebase goes wrong, recover via `git reflog` / orphaned commits and
    cherry-pick; nothing pushed is ever truly lost.
  - This file replaced a gitignored local `worklog.md` that was wiped by a
    restore (2026-11-07). Never keep working state in untracked files.
- The GitHub token lives in the remote URL only; it is never committed.

## 2026-11-07 — v1.8.0 + v1.9.0 releases: English-only interface

- Cycle-start audit: working tree clean, local develop = origin/develop at
  1e44ba1 (wave 2 merged); develop 13 commits ahead of main; v1.8.0
  milestone 33/35 closed with only features #64/#65 open. Auth fix: the
  token in the remote URL is `user:token` — cut on the colon for the API.
- **v1.8.0 released**: bump PR #114 → release PR #115 (merge commit
  2cea610) → annotated tag v1.8.0 → GitHub Release; v1.8.0 milestone
  closed (33 issues), #64/#65 moved forward.
- **English-only interface (#117, PR #116)** — product decision: the app
  ships one language. Removed the v1.7 next-intl layer end to end
  (net −1,607 lines): message catalogs, provider, sidebar Language toggle,
  locale-aware generated names. Every UI string is a plain English literal
  at its call site; ICU plurals became `plural()` (src/lib/plural.ts);
  shortcuts/themes data modules carry their labels; export/sync error
  codes map to English messages next to the codes; sync summaries render
  via `formatSyncSummary()`. CJK CONTENT support kept (IME #99, layout
  #88, PDF footers #84, filenames #74, truncation #101). Also fixed the
  #94 no-page recording toast that referenced a catalog key that never
  existed in any locale. Built as a codemod staged under
  `examples/staging/remove-chinese/` that reads messages/en.json and
  rewrites all 10 components, failing loudly on anything it cannot
  resolve — doubling as a full code↔catalog audit.
- **v1.9.0 released**: bump PR #118 → release PR #119 (merge 1797bb2) →
  annotated tag v1.9.0 + Release; v1.9.0 milestone closed (#117), v1.10.0
  opened with #64/#65.
- Verified counts (real runs): 401 unit + 86 E2E green.
- Environment lessons this cycle: intermediate pipe output can garble file
  reads across resets (a dep array read as `}, andleRunSync,` while od
  showed `}, [handleRunSync,`) — when a read looks impossible, verify with
  od/an AST probe before acting on it. Playwright's browser cache can
  vanish on sandbox recycle — `bunx playwright install chromium` (without
  --with-deps; there is no sudo).

## 2026-11-07 — bug-hunt wave 1: audit + four fixes (#72–#75)

- Cycle-start audit against `origin/develop` (bbfc8cb): lint / tsc / 358 unit
  / 78 E2E all green, 0 open issues — so this wave hunted defects manually:
  full read-through of audio-notes, the whole import pipeline (client,
  docx/html/mht parsers), pdf-export, notes-db, sync/merge, store, search,
  i18n, themes and both big components.
- Four real bugs found, filed as #72–#75, fixed in one PR
  (`fix/bugfix-wave-1`, staged under `examples/staging/bugfix-wave-1/`):
  1. **#72 stale export surface** — Excalidraw invokes `excalidrawAPI` once
     per mount and the canvas only remounts on pageId change, so PNG/SVG/
     scene/PDF exports closed over the mount-time title and paper style.
     Rename a page → export still used the old filename; switch paper → PDF
     kept the old ruling. Fix: latest-value refs (title/background/translator)
     refreshed in an effect (`react-hooks/refs` forbids render-time writes)
     and read at interaction time.
  2. **#73 unlocalized import toasts** — the canvas built every import
     toast as hardcoded English template strings; zh-CN users got English
     feedback. Fix: new `canvas.*` message namespace (11 keys, en + zh-CN,
     ICU plurals preserving the exact legacy English strings), translator
     read through the same latest-value ref so a mid-session locale switch
     localizes the very next toast.
  3. **#74 "untitled" exports** — `titleToFilename` used ASCII-only `\w`,
     so 会议记录 exported as untitled.png. Fix: Unicode-aware slug
     (keep `\p{L}\p{N}`, strip hostile chars, cap by code points — never
     mid-surrogate). Backup export now reuses `downloadBlob` (the hand-rolled
     anchor revoked its URL synchronously — racy in Safari/Firefox).
  4. **#75 silent PDF truncation** — printout imports cap at 20 rendered
     pages without telling the user, and blank text files counted as
     imported. Fix: `importPdfAsPrintout` returns `{rendered, total}` and
     the toast says "first 20 of 25 pages"; `importTextFiles` counts only
     files that produced content ("Some files had no importable content").
- Tests: +10 unit (368 total — 5 filename cases, 5 canvas-i18n key/
  placeholder parity cases) and +7 E2E checks (85 total) across
  `export-filename.spec.ts` (rename → download name), `import-toast-locale.
  spec.ts` (en + zh-CN toasts incl. the localized truncation notice) and
  `import-pdf-truncation.spec.ts` (generated 25-page fixture, 20 land on
  canvas with the notice; blank .txt not reported). Fixture generator
  committed as `e2e/fixtures/gen-pdf-fixture.py` (dependency-free).
- Environment note: mid-session tree flips hit hard this cycle — one
  snapshot read a stale tree and nearly staged pre-audio sources; the
  staging scaffold now re-verifies HEAD (bbfc8cb guard) before copying, and
  every gate/E2E invocation re-applies from staging first.
- Next: v1.8.0 roadmap order — #63 localized seed content, #64 bundled-asset
  TWA, #65 shape library.

## 2026-11-07 — audio blocks (#67) + full import matrix (#68) shipped to develop

- Cycle start: v1.7.0 released (main 60e9d3a), v1.8.0 milestone open with
  #63/#64/#65. New work came in as a direct user request: test importing
  every file type + writing/drawing on top of it all, and add audio
  recording + import. Filed as #67/#68 in the v1.8.0 milestone, implemented
  in roadmap order.
- Audio blocks (PR #69, closes #67): `lib/audio-notes.ts` (classification,
  recorder mime preference order, extension mapping, duration format,
  recording filenames, data-URL repair), `importAudioFiles` → embeddable
  elements, header Mic button → getUserMedia + MediaRecorder with a live
  mm:ss timer, native `<audio controls>` players via Excalidraw's
  `renderEmbeddable`, clip names in full-text search, en/zh-CN strings.
- **Two Excalidraw 0.18 landmines documented for the future:**
  1. `validateEmbeddable={false}` rejects EVERY embeddable — the render gate
     (`renderEmbeddables()`) only mounts elements whose link passes
     `embeddableURLValidator`. Fixed with a predicate fn that accepts only
     our `infinitenote:audio` marker scheme.
  2. Scene restore runs every element `link` through sanitizeUrl, which
     rewrites ALL `data:` URLs to `about:blank` — payloads can never ride on
     `link`. Audio bytes live in `customData.audioData` (restore and both
     export clearers pass customData through untouched); `link` carries only
     the marker.
- Import-matrix overlay spec (PR #70, closes #68): all nine kinds in ONE
  batch → 36 elements on one canvas, freedraw + typed annotation on top,
  reload persistence. Two more E2E-only gotchas: the floating Shapes island
  swallows pointer events left-of-center on the canvas (strokes/typing must
  start right of it), and embeddable players only mount when the element
  intersects the viewport — tall pages need `scrollToContent(…,
  { fitToViewport: true })` before asserting players after a reload.
- Quality: 358 unit tests (+31), 78 E2E checks (+7 audio, +6 matrix), all
  three required CI checks green on both PRs, 0 known bugs.
- v1.8.0 continues with #63 (localized seed content), #64 (bundled-asset
  TWA), #65 (shape library).

## 2026-11-08 — themes gallery (#55) + F-Droid (#56) shipped; v1.7.0 released

- Themes gallery (PR #59, closes #55): six accent themes over light/dark via
  `data-theme` on <html> — pure catalog (`lib/themes.ts`), sidebar gallery
  dialog with live swatches, pre-paint restore script generated by
  `themePreloadScript()`, persisted choice, en/zh-CN catalogs. 19 unit
  tests, 4 E2E checks. One staging leak caught before PR review: the
  `__tests_stage__` scaffolding dir got committed by the first ship —
  apply.sh now excludes it and the branch was force-pushed pre-PR.
- F-Droid recipe (PR #60, closes #56): `packaging/fdroid/` metadata,
  `scripts/fdroid-check.mjs` validator (Bun.YAML), repo-wide versionCode
  scheme major×100+minor×10+patch pinned against the TWA scaffold,
  docs/fdroid.md runbook with F-Droid policy notes. 21 unit tests.
- Release flow: version bump PR #61 (all version-bearing files + the F-Droid
  metadata entry in lockstep), release PR #62 (merge commit) → main
  (60e9d3a), tag v1.7.0, GitHub Release published, v1.7.0 milestone closed,
  v1.8.0 opened with issues #63/#64/#65 from the backlog.
- Automation note: closing keywords in PR bodies only auto-close issues when
  the PR merges into the DEFAULT branch — develop merges always need the
  explicit API close (observed on #55).
- Totals: 326 unit + 65 E2E checks, 0 known bugs.

## 2026-11-08 — i18n (issue #54) shipped to develop

- PR #57 (housekeeping) and PR #58 (i18n, closes #54) both merged with all
  three required CI checks green; develop = b3f06d6. Issue #54 closed.
- What landed: en/zh-CN chrome catalogs (ICU plurals), localStorage-persisted
  locale + browser detection, sidebar Language toggle, localized shortcuts
  cheatsheet (id-based data) and sync summaries (summaryParts + formatter
  hook), catalog-parity unit tests — 286 unit / 61 E2E checks total.
- The sandbox restore fired ~6 times this session, twice landing commits on
  `main` (one pushed before protection caught it; repaired by force-pushing
  `main` back to ae7eda4 behind a temporary protection lift — twice).
  Protocol hardened: EVERY bash call begins with `git checkout <branch>`;
  docs edits use exact-anchor python scripts that assert before writing;
  local lint/typecheck must run on the verified branch.
- Next up for v1.7.0: themes gallery (#55), F-Droid recipe (#56).

## 2026-11-07 — v1.7.0 cycle begins (i18n)

- Resumed after v1.6.0 shipped (Tauri shell, Android TWA, Flatpak packaging;
  release + Linux artifacts live, milestone closed).
- Found the gitignored local `worklog.md` wiped by an environment restore —
  local-only working state is now forbidden; this tracked file replaces it.
- Roadmap cleanup: the stale "v1.4 — Distribution" section (those items
  actually shipped in v1.6.0) is folded into a proper v1.6 section; a v1.7
  section (i18n #54, themes gallery #55, F-Droid #56) replaces the backlog
  lines; the duplicated v1.3 research heading is retitled.
- Next: implement issue #54 — UI i18n with next-intl (English + 简体中文),
  client-side locale switch persisted in localStorage, catalog parity unit
  tests, E2E locale spec. `next-intl` 4.7.0 is already installed.
- Scope decision: UI chrome is translated; first-run seed content and
  generated data names ("Quick Notes" notebook, "Quick note …" titles) stay
  English for now — renaming them needs a stable notebook marker (Dexie v3);
  tracked as follow-up work after v1.7.0.

## 2026-11-07 — bug-hunt wave 2: 31 issues fixed (#63, #77–#105, #107)

- Trigger: "Fix 30 more issues" after the wave-1 follow-up. The tracker held
  only the three open v1.8.0 feature issues, so the wave started with a deep
  audit of the real `origin/develop` tree (the sandbox repeatedly reverted
  the working copy to a stale snapshot — every read went through
  `git show origin/develop:` or a pristine export under
  `examples/staging/ref/`).
- The audit produced 30 NEW verified defects (filed as #77–#105 and #107)
  plus the open #63; all 31 were fixed in six squash-merged PRs, each with
  unit and/or E2E regression coverage:
  - #106 state/data integrity — boot-retry instead of a cached rejected
    promise (#77), savePageContent verifies the Dexie update count (#78),
    search re-indexes on every open (#79), trash refreshes live (#80),
    canvas focus on create/duplicate (#81), revealSelection for
    search/tag jumps (#82).
  - #108 PDF fidelity — audio embeddables print as labeled strips (#83),
    non-Latin footer titles rasterize (#84), typed ExportError → localized
    toasts (#85), printout render capped at 1600px (#87), and the raster
    fallback restricted to rotated elements so unrotated shapes draw as
    true vectors again — the vector path had been dead since v1 (#107).
  - #109 imports — CJK-aware line estimates (#88), SVG intrinsic-size
    fallback (#89), spaced `<w:br />` recognition (#90), 30 MB audio cap
    (#91), batched text-import scene updates (#92).
  - #110 recording + library — MediaRecorder.onerror (#93), detached-canvas
    guard (#94), seconds-resolution names (#95), shape-library restore (#96).
  - #111 i18n — generated-names registry localizes every generated name and
    the welcome seed (#63), localized canvas loading/aria strings (#97,
    #98), IME-safe Enter on all three text-committing inputs (#99),
    surrogate-safe tag/snippet truncation (#101).
  - #112 hardening — SyncFormatError codes → localized sync errors (#86),
    tag-cap feedback (#100), e2e hooks behind a NEXT_PUBLIC_E2E=1 build
    flag so ordinary production bundles never ship the reset backdoor
    (#102), pdfjs-dist pinned exactly to the vendored worker + drift test
    (#103), ignoreBuildErrors removed (#104), manifest-less folders
    initialize on "Sync now" (#105).
- Process incidents worth remembering:
  - A wave PR rebuilt messages/*.json from a stale snapshot and silently
    deleted earlier PRs' catalog keys — caught by CI (MISSING_MESSAGE).
    Fixed forward AND guarded: a catalog-freeze test now pins the complete
    key set, and every PR overlay derives its catalogs from current
    develop.
  - `grep -q` under `set -o pipefail` false-negatives when the upstream
    `git show` is still writing (SIGPIPE) — the staging apply-scripts now
    use `grep … >/dev/null` for their merge markers.
  - The PR-112 merge initially failed on a truncated SHA (40-char
    required); the e2e CI caught the first #102 attempt because CI runs
    Playwright against a production build — the final design gates on the
    build flag rather than NODE_ENV.
- Verified end state: 419 unit tests + 96 E2E checks green in CI on every
  required job; 0 open bugs; v1.8.0 continues with #64/#65.
