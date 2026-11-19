# Test plan — custom page templates (issue #279)

OneNote "Page Templates" parity. Save any page as a reusable template under a
user-chosen name; create new pages from a template picker; templates are
per-machine by design (OneNote's own semantics — local-only). A template
stores the page's full scene payload (elements + files) plus the page's paper
style, so a page created from a template is a true copy of the page it was
saved from.

Pure policy lives in `src/lib/page-templates.ts` (no Dexie, no DOM, no
Excalidraw imports — the version-history.ts pattern); the data layer lives in
`src/lib/notes-db.ts` (additive `templates` store, **schema v4** — the v3
version-history bump is the precedent, no existing-store migration); the UI
lives in `save-template-dialog.tsx` (name input, pre-filled with the current
page title — OneNote's own default) and `templates-dialog.tsx` (picker +
manager); orchestration (flush → read persisted scene → DB write) lives in
`note-app.tsx` next to the version-history handlers.

## Behavior under test

- Save as template: page-actions (⋯) → "Save as template…" → named dialog →
  the persisted scene (after `flushSave`) + the page's `background` land in
  the `templates` store. An EMPTY page saves as STATIONERY (OneNote's own
  case — a template may carry just the paper style): a fresh page's first
  autosave writes an empty scene, which normalizes to a zero-element payload
  (measured, deterministic — a null payload normalizes the same way).
- Names: trimmed; empty/whitespace refused; 120-character cap — all via the
  typed `TemplateError` (`invalid-name`), surfaced as an explicit toast.
- Size cap: the serialized payload is capped at the file-attachment policy
  (`MAX_TEMPLATE_BYTES = MAX_FILE_ATTACHMENT_BYTES`, 10 MiB) — a template's
  payload duplicates on every page created from it, the same rationale as
  the attachment cap; oversize refuses with `too-large` + explicit toast.
- Create from template: two entry points — the sidebar's section menu and
  the page-actions menu (targets the open page's own section). The picker
  lists templates by name (case-insensitive A→Z, newest first on ties) with
  a measured meta line (live element count · KB · relative age). Creating
  writes the payload onto a fresh page row, carries the paper style over,
  refreshes, selects and focuses the canvas (the proven `addPage` path).
- Delete: per-row trash button with a confirm dialog; deleting a template
  never touches pages already created from it; the picker re-lists after
  every delete and shows an explicit empty state when none are left.
- Local-only by design: template rows do NOT join the sync folder (the sync
  model stays page-granular, docs/sync-research.md) and no tombstones are
  written for them (they are not tree rows). They DO ride in notebook
  backups: `buildBackup` embeds every template (name, content, background);
  `restoreBackup` brings them back with fresh ids under the same tolerance
  contract as pages — corrupt scenes, missing content and oversize payloads
  skip silently rather than crash the restore, and blank names fall back to
  "Restored template". Old archives without a `templates` field restore
  untouched (optional field, backup `version` stays 1).
- Templates survive page purges (independent of the tree) and are cleared by
  the settings hard reset together with every other store.

## Unit suite

Pure policy (`src/lib/__tests__/page-templates.test.ts`, ids PT-P*):

- PT-P01..P04 — name validation (trim; empty/whitespace/non-string refused;
  120-char boundary; every error code carries a toast-ready message).
- PT-P10..P13 — row building (live element count excludes tombstones; byte
  size equals the serialized content; plain background stored absent, not
  null; the cap equals the attachment policy, boundary measured empirically
  at exactly the cap = allowed, one byte over = refused).
- PT-P20..P23 — content parsing (round-trip; corrupt JSON → null; wrong
  shapes → null; null/absent files legal).
- PT-P30..P32 — picker order (case-insensitive name sort; newer wins ties;
  id breaks timestamp ties; input never mutated).
- PT-P40 — row type shape (row = summary + content).

Data layer (`src/lib/__tests__/templates-db.test.ts`, fake-indexeddb, ids
PT-D*):

- PT-D01..D03 — save + list (summary fields only; picker order; typed
  refusals leave the store untouched).
- PT-D04..D06 — row/content reads and deletes (full row vs summary; missing
  ids → null; corrupt rows restore nothing; delete is a no-op for unknown
  ids).
- PT-D07 — templates survive page purges (independent of the tree).
- PT-D08 — eraseAllData clears templates too.
- PT-D10..D14 — backup/restore (buildBackup embeds every template; restore
  creates fresh ids with valid content; field-tolerant restore skips
  corrupt/wrong-shape/oversize/non-object entries; blank names fall back to
  "Restored template"; old archives without the field restore untouched).

Store (`src/lib/__tests__/` existing store suites stay green):
`createPageFromTemplate` follows the proven `addPage` selection/focus path;
its failure contract (dead section, unreadable template → `false`, picker
stays) is exercised through the same store-level integration patterns.

## E2E (`e2e/page-templates.spec.ts`, ids PT-E01..E05)

- PT-E01: save the welcome page as a template — dialog pre-filled with the
  page title, renamed, success toast, picker row with the measured meta
  ("2 elements").
- PT-E02: create a page from the template via the section menu — the scene
  comes back (2 elements), the sidebar grows by one page row.
- PT-E03: the paper style rides along — grid saved → created page shows the
  Grid label; picker reached through the page-actions entry this time.
- PT-E04: a fresh page saves as stationery — paper style without content
  (the picker lists the zero-element template, the created page keeps the
  Ruled background and an empty canvas).
- PT-E05: delete flow with the confirm step for both templates, empty state
  at the end.

## Measured results (filled at gate time)

- Unit suite: **1142 tests across 84 files, 0 fail** (base 8f3f091 was
  1113/82 — this wave adds the 16 PT-P pure tests and 13 PT-D db tests).
- E2E: PT-E01..E05 green on the PR branch (5/5); neighbors re-run green
  (version-history + crud + background + ui-overlap, 20/20); full suite
  counted at 206 checks across 43 files.
