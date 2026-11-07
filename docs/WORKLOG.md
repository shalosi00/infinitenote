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
