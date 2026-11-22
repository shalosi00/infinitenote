# Test plan — Sub-sections (nested sections)

Feature: sections can nest — a section's actions menu gains "New sub-section"
(OneNote's right-click section tab → New Section Group flow; Joplin's
sub-notebooks model), any section can hold pages AND child sections at the
same time, and the trash/restore/purge cascades cover the whole subtree.
Basis: the wave-16 evidence pass (issue #314 — OneNote "Create a section
group in OneNote" help page, Joplin "Sub-notebooks" help page).

Status: **shipped to develop 2026-11-21 (releases with v1.18.0)** — all
evidence below is from actual runs. Phase 2 (moves) shipped 2026-11-22
(issue #325 — see the phase-2 section at the bottom).

## Design summary

| Aspect | Decision |
|---|---|
| Data model | `Section.parentId?: string \| null` — optional, additive, NOT indexed (no Dexie version bump; old rows and old sync folders stay valid; `parentId ?? null` is the canonical read) |
| Sibling scopes | order/move/create count siblings that share BOTH notebook and parent (`parentId ?? null` grouping); children of different parents never influence each other's order |
| Tree policy | pure `src/lib/section-tree.ts`: `topLevelSections`, `childSections`, `subtreeSectionIds` (root-first depth-first, cycle-safe), `ancestorSectionIds` (nearest-parent-first, cycle-safe), `sectionSiblingKey` (the sync normalizer's group key) |
| Trash cascade | `trashSection` stamps every ALIVE subtree section (the notebook-cascade pattern one level generalized) and every alive page of the subtree at ONE timestamp; separately-trashed descendants keep their own timestamp |
| Restore | `restoreSection` brings back subtree members stamped at the section's own `deletedAt`, plus resurrects trashed ancestors — each resurrected ancestor also restores the pages stamped at ITS delete time (end state equals restoring it directly); separately-trashed descendants stay in trash; the trashed parent-notebook rule is unchanged |
| Purge | `purgeSection` hard-deletes the whole subtree: one tombstone per row, pages die with their version snapshots |
| Sync | manifests flow `parentId` through whole-row LWW for free; `normalizeOrders` groups sections by `notebookId\|parentId` so one parent's renumbering can never interleave with another's (SB-P9) |
| Backup | `buildBackup` spreads whole rows (ids included); `restoreBackup` re-maps original section ids to fresh ids in two phases — parents re-attach only within the same notebook, a dangling `parentId` restores as top level |
| Sidebar | recursive `SectionNode`: pages first, then child sections, then "Add page"; the notebook node renders only top-level sections; "New sub-section" auto-expands the parent; selection restore expands the ancestor chain (`defaultExpandedState`) |
| Multi-select | unchanged semantics: "select all" still means pages of the EXPANDED sections the user can see (`visiblePageIds` is per-node) |
| Out of scope (phase 2 candidates) | ~~drag-to-reparent, cross-notebook section moves~~ — shipped 2026-11-22 as phase 2 (issue #325, the section below); "section groups" as a separate row type stays out (phase 3 candidate) |

## Unit tests — `src/lib/__tests__/sub-sections.test.ts`

| ID | Assertion |
|---|---|
| SB-P1 | `parentOf`: absent field and null both read as top level |
| SB-P2 | `topLevelSections` keeps only the notebook's top level, in sibling order |
| SB-P3 | `childSections` returns direct children only, in sibling order |
| SB-P4 | `subtreeSectionIds` is root-first depth-first in sibling order |
| SB-P5 | `subtreeSectionIds` survives a parentId cycle without hanging |
| SB-P6 | `ancestorSectionIds` walks nearest-parent-first, stops at a missing parent |
| SB-P7 | `ancestorSectionIds` survives a cycle |
| SB-P8 | `sectionSiblingKey` groups by notebook + parent, never across parents |
| SB-P9 | sync merge: children of different parents never interleave when orders collide; the parent link survives the merge |
| SB-P10 | `createSection(…, parentId)` orders children among their own parent's siblings only |
| SB-P11 | `moveSection` swaps within the parent scope only; edges stay no-ops |
| SB-P12 | `trashSection` soft-deletes the alive subtree + its pages at one timestamp; separately-trashed rows keep their own stamps |
| SB-P13 | `restoreSection` restores the subtree trashed together, resurrects trashed ancestors with their pages, leaves separately-trashed descendants in trash |
| SB-P14 | `purgeSection` hard-deletes the subtree with tombstones and version snapshots |
| SB-P15 | backup round-trip preserves nesting through fresh ids (top → child → grandchild) |
| SB-P15b | a dangling `parentId` in a hand-edited archive restores as top level |
| SB-P16 | `defaultExpandedState` expands the ancestor chain of a nested selection; top-level behavior unchanged |
| SB-P16b | `restoreBackup` still rejects non-InfiniteNote archives |

## E2E checks — `e2e/sub-sections.spec.ts`

| ID | Assertion |
|---|---|
| SB-N01 | the section menu gains "New sub-section"; the child nests under the parent, auto-expanded |
| SB-N02 | a page inside a nested section opens on the canvas and renders in the tree under its parent |
| SB-N03 | reload restores the nested selection with the whole ancestor chain expanded |
| SB-N04 | trashing a parent takes the subtree to trash (sections + pages listed); restoring the parent brings the family back |
| SB-N05 | siblings reorder within their own parent scope ("Move up"), top-level structure untouched |

---

# Phase 2 — Section moves (issue #325, 2026-11-22)

Feature: a section can now MOVE — with its whole subtree — to a new parent
or a new notebook, via two paths: the drag gesture (dnd-kit, already a
declared dependency, never imported before) and a "Move to…" dialog in the
section menu (the OneNote "Move or Copy" flow — and the keyboard/touch path
Joplin lacks entirely; its community keeps asking for exactly this,
discourse.joplinapp.org "We need better ways to move notebooks", 2024).
OneNote evidence: drag-and-drop of section tabs between notebooks / into
section groups, plus the right-click → "Move or Copy" dialog; the official
mobile help documents the same capability as "Move to another notebook"
(support.microsoft.com).

## Design summary

| Aspect | Decision |
|---|---|
| Move primitive | `moveSectionTo(id, targetNotebookId, targetParentId)` in notes-db.ts → `"moved" \| "noop" \| "invalid"`; the moved root gets `{notebookId, parentId, order}` appended to the END of the target sibling scope (the movePagesToSection convention), every descendant keeps its own parentId/order and follows the root's `notebookId` — trashed descendants included, their `deletedAt` stamps untouched, so the subtree stays restorable in its new notebook |
| Pages | no writes at all — pages carry only `sectionId` and follow their section |
| Rejection rules | trashed source/target notebook/target parent, dangling parent id, a parent in a different notebook than the declared target, self/descendant parents (zero writes on every "invalid") |
| No-op rule | dropping a section on its own current parent = "noop", zero writes — an accidental drop must never reorder the siblings it landed on |
| Pure policy | `canReparent(sections, sectionId, targetParentId)` in section-tree.ts: not self, not inside the moved subtree — cycle-safe (the SB-P5/P7 visitor-set pattern) |
| Drag gesture | @dnd-kit/core DndContext (PointerSensor, 6px activation distance so clicks/double-click-rename/menus never turn into drags), `pointerWithin` collision; section rows are draggable AND droppable, notebook rows droppable. Listeners only — NOT the full `attributes` spread, which would give the row div `role="button"` named by all its text and collide with every existing `getByRole` locator; keyboard users use the dialog |
| Drop semantics | onto a section = nest under it; onto a notebook = that notebook's top level (cross-notebook allowed); invalid targets never highlight (`data-drop-active` only when `canReparent` passes) and never accept |
| Dialog | `move-section-dialog.tsx`: per notebook a "Top level of {nb}" target plus its sections as nest targets; the moved subtree's rows and the current home are disabled; shared store action `moveSectionTo` |
| Store | on "moved": refresh + expand the new ancestor chain (target notebook, the target parent's ancestor chain, the parent, the moved section); selection ids are untouched by the move (id-stable) so open pages keep working |
| Sync | zero merge logic — whole-row LWW carries `{notebookId, parentId, order}` for free; `sectionSiblingKey` moves with the section so `normalizeOrders` renormalizes inside the NEW scope (SM-P13) |
| Backup | nothing special — the round-trip preserves placement and nesting through the two-phase id re-map (SM-P14, restored into an EMPTY library — the SC-P9 lesson) |
| Out of scope (phase 3) | "section groups" as a separate row type; drag-to-reorder (Move up/Move down stays); page moves (movePagesToSection unchanged); auto-expand-on-hover mid-drag |

## Unit tests — `src/lib/__tests__/section-move.test.ts`

| ID | Assertion |
|---|---|
| SM-P1 | canReparent: rejects the section itself; accepts a sibling |
| SM-P2 | rejects the whole own subtree (child + grandchild); accepts a foreign notebook's sections |
| SM-P3 | survives a corrupted parentId cycle (a→b→a) without hanging; targets outside the loop read as valid |
| SM-P4 | cross-notebook top-level move: root lands at the END of the target scope; descendants follow the notebookId and keep their structure; the old notebook is empty |
| SM-P5 | nesting under a section of another notebook: parentId set, appended after the target's existing children, no renumbering |
| SM-P6 | drop on its own parent = "noop" with zero writes (updatedAt/order/parentId untouched) |
| SM-P7 | self and own-descendant parents are "invalid" with zero writes |
| SM-P8 | trashed source, trashed target notebook, trashed target parent (and its cascaded children), dangling parent id, and a parent in a different notebook than the target are all "invalid"; a fresh alive parent lands |
| SM-P9 | pages follow their sections — page rows byte-identical (sectionId + updatedAt untouched) |
| SM-P10 | a separately-trashed descendant follows the notebook but keeps its own deletedAt stamp; a second identical move is a noop |
| SM-P11 | a color override survives the move; a non-overridden section reads as the NEW notebook's color |
| SM-P12 | the move appends to the end of the target sibling scope (B1, B2, mover) |
| SM-P13 | whole-row LWW carries the move — notebookId/parentId survive the merge; the sibling key moves to the new scope |
| SM-P14 | backup round-trip after a cross-notebook move preserves placement + nesting (restored into an empty library) |

## E2E checks — `e2e/section-move.spec.ts`

| ID | Assertion |
|---|---|
| SM-N01 | the "Move to…" dialog moves a section to another notebook's top level (its own notebook's top level is disabled) |
| SM-N02 | the dialog nests a section under another (itself disabled as a target); the moved row renders INSIDE the target's subtree, auto-expanded |
| SM-N03 | dragging a section onto another nests it — the target highlights (`data-drop-active`) mid-drag before the drop lands |
| SM-N04 | dropping a parent onto its own child is rejected — no highlight, structure unchanged |
| SM-N05 | the moved subtree survives reload and trash/restore as a family in its new notebook |
