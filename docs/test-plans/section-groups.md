# Test plan — Section groups (OneNote "Section Groups" parity)

Feature: a section group is a notebook container that keeps related sections
together and holds NO pages of its own — OneNote's "New Section Group" flow
(sub-sections phase 3, issue #337; the phase-3 candidate named by the
wave-18/wave-19 pointers and PROJECT_STATUS "Next up").

Basis: the wave-20 evidence pass (2026-11-23) — OneNote's help ("A bit like
folders on a hard drive, section groups keep related sections together. A
section group can hold as many sections as you want, along with all their
pages"; creation = right-click any section tab → "New Section Group", the
group lands as a peer of the section tabs — support.microsoft.com "Create a
section group in OneNote"), the Microsoft Graph OneNote model (a sectionGroup
carries `parentSectionGroup` plus a nested `sectionGroups` collection: groups
nest under groups, sections never contain groups), and Joplin as the
counter-example (no group type at all — only desktop drag-only sub-notebooks,
joplinapp.org/help/apps/subnotebooks).

Status: **shipped to develop 2026-11-23 (releases with v1.20.0)** — all
evidence below is from actual runs.

## Design summary

| Aspect | Decision |
|---|---|
| Data model | `Section.kind?: "group" \| null` — optional, additive, NOT indexed (the `parentId` #314 / `color` #319 precedent: no Dexie version bump; old rows and old sync folders stay valid; `kind ?? null` is the canonical read; plain sections carry NO kind field) |
| Pure policy | `src/lib/section-groups.ts`: `isSectionGroup`, `normalizeSectionKind` (only "group" passes; anything hand-edited degrades to null = plain section, the safeTags/safeSectionColor contract) |
| Placement rules | a group's parents are the notebook top level and other groups (the Graph model); a group can never nest under a plain section — enforced by `canReparent` (drag) AND `moveSectionTo` (write layer), both zero-write "invalid"; anything may nest UNDER a group |
| Creation | notebook menu + section menu gain "New section group"; both land the group at the NOTEBOOK top level, appended to the end of the sibling scope (the OneNote right-click-a-section-tab path); generated name "Section group N" (the registry in generated-names.ts); the notebook row auto-expands |
| Pages | groups hold no pages: no "New page"/templates/color menu on group rows; the expanded body's tail button is "Add section"; the bulk-move dialog omits groups; `movePagesToSection` answers 0 with zero writes |
| Group row | folder glyph (FolderClosed/FolderOpen) instead of the color swatch — OneNote: "a bit like folders on a hard drive"; groups carry no color of their own |
| Menu | group rows: New section / Rename / Move to… / Move up / Move down / Move to trash |
| Drag & drop | group rows are draggable AND droppable through the wave-18 dnd-kit pipeline; drop validity is `canReparent`'s group rules (a group highlights only over notebooks and other groups) |
| Move dialog | the "Move to…" dialog lists groups as nest targets (folder glyph); a group mover has its plain-section targets disabled |
| Trash/restore/purge | unchanged — the #314 subtree machinery covers group subtrees (one timestamp per cascade; restore resurrects the family; purge hard-deletes it) |
| Sync | zero merge logic — whole-row LWW carries `kind` for free; the manifest builder writes it through; plain sections serialize WITHOUT a kind key (old folders byte-stable) |
| Backup | `buildBackup` spreads whole rows; `restoreBackup` normalizes kind via `normalizeSectionKind` — hand-edited "folder"/wrong types restore as plain sections, never crash |
| openFirstPage | the notebook row's open-first-page skips groups — the first PAGE-carrying top-level row wins |

## Unit tests — `src/lib/__tests__/section-groups.test.ts`

| ID | Assertion |
|---|---|
| SG-P1 | `normalizeSectionKind` passes only "group"; "folder"/"Group"/""/undefined/null/42/objects all degrade to null |
| SG-P2 | `isSectionGroup` reads the canonical shape; absent kind = plain section (the pre-#337 row shape) |
| SG-P3 | a section may nest under a group; plain-section nesting is unchanged |
| SG-P4 | a group never nests under a plain section (the Graph OneNote model) |
| SG-P5 | a group nests under another group — even across notebooks |
| SG-P6 | the self / own-subtree rules hold for groups too |
| SG-P7 | creating a group lands it at the END of the notebook's top-level scope with kind "group"; plain sections carry no kind field at all |
| SG-P8 | a group under a plain section is rejected at creation (zero writes); a group under a group nests |
| SG-P9 | a plain section nests under a group; the group's sibling key matches its section siblings (one order space) |
| SG-P10 | moving a group to another notebook's top level carries the whole subtree; kind survives; pages follow untouched |
| SG-P11 | moving a group under a group works; under a plain section is invalid with zero writes |
| SG-P12 | moving a plain section under a group works; its children follow |
| SG-P13 | `movePagesToSection` into a group answers 0 with zero writes; the positive control still moves |
| SG-P14 | trashing a group stamps the whole subtree at one timestamp; restore brings the family back; purge hard-deletes it |
| SG-P15 | whole-row LWW carries kind — a group row survives the merge untouched, sibling key normal |
| SG-P16 | the manifest builder writes kind through; plain sections serialize WITHOUT a kind key (old folders byte-stable) |
| SG-P17 | a backup round-trip preserves kind and nesting (restored into an EMPTY library — the SC-P9 lesson) |
| SG-P18 | a hand-edited archive kind ("folder") restores as a PLAIN section, not a crash |

## E2E checks — `e2e/section-groups.spec.ts`

| ID | Assertion |
|---|---|
| SG-N01 | section menu "New section group" lands a group at the notebook top level (folder glyph, no color swatch); the group menu holds New section/Rename/Move to… but NOT New page/templates/Color; the notebook menu path creates one too |
| SG-N02 | the group menu's "New section" nests a child inside the group's subtree (auto-expanded); the expanded body offers "Add section", never "Add page"; the child is a plain section (color swatch, no folder glyph) |
| SG-N03 | the bulk-move picker omits groups — pages cannot live in a group |
| SG-N04 | dragging a fresh section onto the group nests it (the REAL dnd-kit pipeline, `data-drop-active` mid-drag); the family survives reload |
| SG-N05 | trashing the group takes the whole subtree to trash (group + sections + pages listed); restoring the group brings the family back |

Every test is SELF-CONTAINED (resets to the seed and performs its own
steps) — the wave-18 CI lesson.
