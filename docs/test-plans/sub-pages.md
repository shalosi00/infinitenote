# Test plan — sub-pages (OneNote page hierarchy parity, issue #359)

Feature: a page can indent under another page of the SAME section —
OneNote's "Make subpage" command ("You can indent a page underneath a
page to create a subpage. In the page list, right-click a page that you
want to indent, and then click Make subpage" — support.microsoft.com;
desktop's drag-right gesture is the same operation), depth-capped at
TWO tiers of subpages (main page → subpage → sub-subpage — OneNote's own
cap). The page menu (the keyboard/touch path) gains **Make subpage**
(demote under the previous sibling in its own scope) and **Promote**
(raise one level, onto the grandparent or to the top). Joplin has no
note hierarchy at all (laurent22/joplin#451, open since 2018) — this is
OneNote-only parity, phase 1 (menu-first); drag-to-indent is the named
phase-2 candidate.

Status: **shipped** — generalizes the shipped sub-section machinery
(issues #314/#325/#337) one level down the tree; the data-model change is
the section-parentId precedent exactly: `Page.parentId?: string | null`,
optional, NOT indexed, no Dexie version bump, old rows / backups / sync
folders stay valid.

| Aspect | Decision |
|---|---|
| Pure policy | `src/lib/page-tree.ts` (no Dexie imports — the wave-21 poisoning lesson): `visiblePageTree` (the sidebar AND export-order projection), `canMakeSubpage`, `makeSubpageTarget`, `promoteTarget`, `subtreePageIds` (RAW like `subtreeSectionIds` — trashed rows stay reachable so cascades act through them), `subtreeHeight`, `pageDepth` |
| Depth cap | `MAX_PAGE_DEPTH = 2`: a demote is refused unless the WHOLE moved subtree fits (`depth(target) + 1 + subtreeHeight(page) ≤ 2`) — the item hides instead of failing |
| Sibling scopes | `order` is scoped to (sectionId, parentId) everywhere: `createPage` takes the max within the target scope (the createSection convention), `movePage` swaps within the page's OWN scope (the visible neighbor one scope away is never touched), `duplicatePage` keeps the indent level and appends within its scope, `movePagesToSection` slots roots after the target's TOP-level pages |
| Writes | `setPageParent(pageId, target)`: "moved" / "noop" / "invalid" like moveSectionTo — invalid (zero writes) for missing/trashed/foreign targets, self/descendant cycles and cap violations; the mover lands at the END of the target sibling scope; descendants NEVER rewrite (the subtree rides implicitly) |
| Trash family | `trashPage` cascades the same `deletedAt` to the alive subtree; `restorePage` restores same-ts members AND resurrects trashed ancestor pages (the restoreSection pattern one level up); `purgePage` removes the whole raw subtree with one tombstone per row and version cleanup |
| Bulk ops | `trashPages` cascades each selected page's subtree under one shared ts; `movePagesToSection` carries every mover's whole raw subtree (alive + trashed, stamps untouched) while the root flattens to the top level — a selected child whose parent is also moving RIDES (never ripped out); the returned count is roots only |
| Read tolerance | The sync folder is human-editable JSON, so `parentId` gets hand-edited: a page whose parent row is missing, trashed, foreign to the section or in a cycle renders as a TOP-LEVEL root (visible, never dropped, never hanging a traversal); a deeper-than-cap chain renders clamped at the cap without rewriting data |
| Backup | `buildBackup` spreads whole rows (parentId rides); `restoreBackup` re-attaches through the section's two-phase pattern: fresh ids first, original archive parent ids remembered, re-attached within the same section — a dangling archive parent restores top level |
| Sync | Additive carry: `SyncPageFile` gains optional `parentId` (written ONLY when set — pre-#359 rows keep the exact old file shape), the parser reads absent as top level; `pagesEqual` compares parentId (a reparent-only divergence conflicts, never collapses); `normalizeOrders` scopes pages by `sectionId|parentId` (the sectionSiblingKey precedent) — pre-#359 rows group exactly as before; a pre-feature device's round cannot flatten the structure (whole-row LWW, local wins ties) |
| Export order | `selectSectionPages` (issue #344) now returns the section's VISIBLE tree order: a subpage exports right after its parent (OneNote exports the indented order); flat sections order exactly as before |
| Delete selection | `nextSelectionAfterPageDelete` excludes the deleted page's whole SUBTREE (they are cascaded away in the same write) and keeps the pinned flat contract for the survivor: first candidate at-or-after the deleted page's order — ties resolve to the tied survivor, a stale id falls back to the last candidate |
| Sidebar | Pages render in `visiblePageTree` order with a `data-depth` marker and a 16px-per-level indent; NO collapse state (a parent keeps its pages visible, so a fresh subpage can never land in a hidden branch); the kebab menu gains **Make subpage** (`page-make-subpage`) and **Promote** (`page-promote`), each rendered only when the policy allows |

## Unit pins (src/lib/__tests__/page-tree*.test.ts)

- **PG-P*** (pure policy, 15): sibling scopes; raw depth-first subtree with
  trashed intermediates; cycle-safe walks; dangling/trashed/foreign-parent
  roots; cycle rendering; clamp-at-cap display; canMakeSubpage's
  section/cycle/cap matrix; makeSubpageTarget hiding; promote targets;
  visible order skipping trashed rows
- **PG-D*** (fake-indexeddb, 9): scoped create orders + no-field row shape;
  setPageParent moved/noop/invalid matrix incl. the dangling-parent heal;
  scoped movePage; duplicate keeps level; trash cascade timestamps;
  restore family + ancestor resurrection; purge subtree + tombstones;
  bulk-move subtree carry + ride-along; backup two-phase re-attach +
  dangling tolerance
- **PG-S*** (sync format/merge, 3): subpage folder round-trip + old-shape
  flat file; old folder parses top level; per-(section, parent) order
  renumbering

## E2E (e2e/sub-pages.spec.ts, 4 checks)

- **SUBP-01** Make subpage: the first page offers NEITHER command (no
  previous sibling, nothing to promote); "Page 2" demotes under "Start
  here" → visible order `[[Start here, 0], [Page 2, 1]]` via data-depth
- **SUBP-02** Promote: back to `[[Start here, 0], [Page 2, 0]]`
- **SUBP-03** family trash: trashing the parent removes BOTH rows; the
  trash dialog holds both; restoring the parent restores the indented
  pair
- **SUBP-04** export order: one-line scenes on both pages → a 2-sheet
  portrait PDF, both markers inflate out, global "1 / 2"…"2 / 2", and
  the parent's marker precedes the subpage's marker in the streams


## Phase 2 — drag-to-indent (issue #365, shipped 2026-11-24)

The gesture half of the feature (OneNote's desktop page-list operation):
a page dropped on another page indents under it; a page dropped on its
OWN section row promotes one level. The gesture reuses the #325 drag
stack exactly (PointerSensor 6px activation, listeners-only rows,
pointerWithin, invalid targets never highlight) one level down the tree,
and flows through one new store action `setPageParent(id, targetParentId)`
(the #359 db write, already pinned) — the menu commands stay untouched.

| Aspect | Decision |
|---|---|
| Drop on page | `canMakeSubpage(st.pages, activeId, overId)` — the SAME pure gate the menu item uses (same section, cycle-safe, two-tier cap for the whole moved subtree); success toast `Made "A" a subpage of "B"` on "moved" |
| Drop on own section row | `canPromoteWithin` (alive, THAT section, carries a parent) → `promoteTarget` (grandparent id, or null = top) — one level, the menu Promote semantics; groups and foreign sections never accept; a top-level page dropped on its own section is a no-op |
| Notebook rows | highlight for SECTION drags only (#325 semantics) — a page dragged over a notebook row neither highlights nor drops (pages never re-home by drag; the bulk-move dialog stays the cross-section path) |
| Highlight | the target row gates its own `data-drop-active` through the pure policy — a cycle, cap, cross-section or group target never highlights, and an unhighlighted drop is an unhandled id (zero writes) |
| Read-only | zero data-model change, zero sync surface, no Dexie migration |

## Phase-2 unit pins (src/lib/__tests__/page-tree-drag.test.ts)

- **PG-P15** drop-on-page accepts exactly what the menu command accepts:
  same-section indent, already-a-child → gate passes / db answers noop,
  self-subtree cycle refusal, cross-section refusal (both directions)
- **PG-P16** the cap rejects the gesture for oversized subtrees: the
  height-2 family under a top-level target reads depth 3 → refused;
  exact-fit and safe directions accepted
- **PG-P17** drop-on-own-section accepts only subpages of THAT section:
  subpage → top level (promoteTarget answers the grandparent = null),
  sub-subpage → the grandparent, top-level page → no-op, foreign section
  → refused, trashed source → refused, dangling parent still promotes
  (write-heal)

## Phase-2 E2E (e2e/sub-pages-drag.spec.ts, 5 checks)

- **PGD-N01** drag "Page 2" onto "Start here" with the mid-drag
  `data-drop-active` assert on the REAL dnd-kit pipeline → visible order
  `[[Start here, 0], [Page 2, 1]]`
- **PGD-N02** the subpage dragged onto its section row highlights it and
  promotes back to the top level
- **PGD-N03** a two-tier chain built purely by drags
  (`[[Start here, 0], [Page 2, 1], [Page 3, 2]]`); the root dragged onto
  its own descendant never highlights and the chain is unchanged
- **PGD-N04** the cap rejects the height-2 family under a top-level
  target (no highlight, structure unchanged); a page dragged over the
  notebook row never highlights it (section-drags-only gate)
- **PGD-N05** a foreign section's page row rejects the drag (no
  re-home); the drag-built chain survives a reload
