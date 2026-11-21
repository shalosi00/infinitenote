# Test plan — Sub-sections (nested sections)

Feature: sections can nest — a section's actions menu gains "New sub-section"
(OneNote's right-click section tab → New Section Group flow; Joplin's
sub-notebooks model), any section can hold pages AND child sections at the
same time, and the trash/restore/purge cascades cover the whole subtree.
Basis: the wave-16 evidence pass (issue #314 — OneNote "Create a section
group in OneNote" help page, Joplin "Sub-notebooks" help page).

Status: **shipped to develop 2026-11-21 (releases with v1.18.0)** — all
evidence below is from actual runs.

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
| Out of scope (phase 2 candidates) | drag-to-reparent, cross-notebook section moves, "section groups" as a separate row type |

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
