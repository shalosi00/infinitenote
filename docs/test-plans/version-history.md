# Test plan — Page Version History

Feature: a local, per-page timeline of scene snapshots with point-in-time
restore (OneNote "page versions" parity), fully offline.

Status: **planned, TDD** — every test below is written FIRST, watched fail
(red), then implemented (green). Test ids are stable and referenced from the
worklog.

## Design summary

| Aspect | Decision |
|---|---|
| Storage | New Dexie table `pageVersions` (schema **v3**), additive — no existing data migrates |
| Row shape | `{ id, pageId, createdAt, source, content (serialized ScenePayload), elementCount, byteSize }` |
| Snapshot triggers | **auto** (successful autosave, ≥ 5 min since the page's newest version AND structure changed), **manual** ("Save version now"), **pre-restore** (safety copy of the state being replaced) |
| Dedupe gate | Structural fingerprint (`structuralSceneJson`, same semantics as the autosave gate): identical structure ⇒ no new version, even after the interval |
| Capacity | 25 versions per page, FIFO prune (newest 25 kept, ties broken by id) — all sources share one budget |
| Restore | `flushSave` → snapshot current scene as **pre-restore** → write the stored payload over the page row → `discardPendingEdits` + canvas remount (the proven sync-remount path) |
| Cascades | soft-delete (trash) keeps versions; **purge** (page / section / notebook) and `eraseAllData` delete them; `duplicatePage` starts a fresh history |
| Scope | Versions are LOCAL-ONLY: excluded from backups and the v1 sync-folder format (size + format stability) |
| UI | One "Page actions" (⋯) menu in the page title bar → "Version history…" dialog; no new title-bar buttons, so the 1280→320px overlap audit keeps passing |

Why restore reuses the DB-write + remount path instead of
`updateScene`: it is the exact machinery the sync feature already exercises
(save → discardPendingEdits → `sceneEpoch` bump), so there is one code path
that can desync the canvas from the DB, not two.

## Unit tests — `src/lib/__tests__/version-history.test.ts`

### `buildPageVersion` (policy: row construction)

| ID | Assertion |
|---|---|
| VH-P01 | Row carries pageId, createdAt = the given clock, the given source, and a fresh id (uuid shape) |
| VH-P02 | `elementCount` equals the payload's live element count (tombstones excluded) |
| VH-P03 | `byteSize` equals the serialized content's JSON length |
| VH-P04 | `content` round-trips: `JSON.parse(row.content)` deep-equals the payload |
| VH-P05 | Each of the three sources ("auto", "manual", "pre-restore") is recorded verbatim |
| VH-P06 | An empty scene (0 elements) still produces a valid row with elementCount 0 |

### `shouldAutoSnapshot` (policy: when autosave records a version)

| ID | Assertion |
|---|---|
| VH-P10 | No previous version ⇒ true (first snapshot always fires) |
| VH-P11 | Structure identical to the newest version ⇒ false, even long after the interval |
| VH-P12 | Structure changed + interval elapsed (≥ 5 min) ⇒ true |
| VH-P13 | Structure changed + interval NOT elapsed ⇒ false |
| VH-P14 | Boundary: elapsed time exactly equals the interval ⇒ true |
| VH-P15 | Newest version has corrupt (unparseable) content ⇒ treated as changed ⇒ true (defensive) |
| VH-P16 | Only volatile metadata differs (version/versionNonce/updated bumps) ⇒ structure unchanged ⇒ false — same absorb rule as the autosave gate |

### `pruneToCapacity` (policy: FIFO pruning)

| ID | Assertion |
|---|---|
| VH-P20 | Fewer rows than capacity ⇒ nothing to delete |
| VH-P21 | Exactly capacity ⇒ nothing deleted |
| VH-P22 | Capacity + 1 ⇒ exactly the oldest row's id is returned |
| VH-P23 | Far over capacity ⇒ the newest `keep` survive, all others are returned for deletion |
| VH-P24 | createdAt ties ⇒ deterministic: later id kept (id desc as the tie-break) |
| VH-P25 | `keep = 0` ⇒ every id returned (pure function, no hidden floor) |

### `sortVersionsNewestFirst` / `relativeVersionTime` (policy: presentation)

| ID | Assertion |
|---|---|
| VH-P30 | Rows sort by createdAt descending; empty input tolerated |
| VH-P31 | relative buckets: "just now" (< 10 s), seconds, minutes, hours, days |
| VH-P32 | "over a month ago" (> 30 d) and "over a year ago" (> 365 d) — deterministic, locale-free |

### Data layer (extend `notes-db.test.ts`, fake-indexeddb)

| ID | Assertion |
|---|---|
| VH-D01 | `recordPageVersion` stores the row; `listPageVersions` returns summaries (no `content`) newest-first |
| VH-D02 | Inserting 30 versions keeps exactly 25, and the survivors are the newest |
| VH-D03 | `getPageVersionContent` parses and returns the stored payload |
| VH-D04 | `getPageVersionContent` returns null for a version belonging to a different page |
| VH-D05 | `getPageVersionContent` returns null for a missing version id |
| VH-D06 | `getPageVersionContent` returns null for hand-corrupted content JSON |
| VH-D07 | `purgePage` deletes that page's versions; another page's versions survive |
| VH-D08 | `purgeSection` cascades to every page's versions under it |
| VH-D09 | `purgeNotebook` cascades through its sections to page versions |
| VH-D10 | `eraseAllData` clears the version table |
| VH-D11 | `trashPage` (soft delete) KEEPS the page's versions |
| VH-D12 | `duplicatePage` yields a copy with an empty version history |
| VH-D13 | Schema upgrade: a database created at v2 (pre-feature) with live rows upgrades in place — all rows readable, `pageVersions` usable (no data loss) |

## E2E — `e2e/version-history.spec.ts`

| ID | Scenario |
|---|---|
| VH-E01 | Fresh page: open the dialog from the Page-actions menu — empty state copy shows, no console errors |
| VH-E02 | "Save version now" creates a row instantly: meta shows "2 elements", source label "Manual" |
| VH-E03 | Full restore round-trip: seed (2) → draw rectangle (3) → save version → type text (4) → restore the 3-element version → canvas settles at 3 elements; the replaced 4-element state appears as a "Before restore" row |
| VH-E04 | Restore persists: reload after a VH-E03-style restore → the scene still settles at the restored element count |
| VH-E05 | The browser stays error-free across the whole spec (standard console collector) |

Determinism note: the **auto** trigger needs a 5-minute clock, which E2E
cannot fake — it is covered exhaustively by VH-P10..P16 with an injected
clock; E2E drives the deterministic manual + pre-restore paths instead.

## Non-goals (documented on purpose)

- No version diffing UI (element-level diff), no per-version preview canvas.
- No export of single versions (restore, then export the page).
- Versions do not ride backups or the sync folder; the formats stay stable.
