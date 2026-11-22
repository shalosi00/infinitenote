/**
 * Section group policy (issue #337) — pure helpers, no I/O, no Dexie, no DOM.
 *
 * OneNote "Section Groups" parity (sub-sections phase 3): a section group
 * is a notebook container that keeps related sections together — "a bit
 * like folders on a hard drive, section groups keep related sections
 * together. A section group can hold as many sections as you want, along
 * with all their pages" (support.microsoft.com, "Create a section group in
 * OneNote"). OneNote creates one by right-clicking any section tab →
 * "New Section Group", and the group lands as a peer of the section tabs.
 *
 * Placement follows the Microsoft Graph OneNote data model: a sectionGroup
 * carries `parentSectionGroup` plus a nested `sectionGroups` collection —
 * groups nest under groups, while sections never contain groups (a section
 * holds pages). Joplin has no group type at all (its sub-notebooks are
 * drag-only desktop organization).
 *
 * Every external read goes through these helpers so the sidebar, the data
 * layer and the dialogs all agree on what a group is — the section-colors
 * contract: outside input never crashes, it degrades to the default shape.
 *
 * Test plan: docs/test-plans/section-groups.md (ids SG-P1..P2).
 */
import type { Section } from "./types";

/** The one `kind` value that marks a row as a section group. */
export const SECTION_GROUP_KIND = "group";

export type SectionKind = typeof SECTION_GROUP_KIND;

/**
 * Whether this row is a OneNote-style section group. Absent/null kind =
 * a plain section (the pre-#337 shape — old rows and old sync folders
 * carry no `kind` field at all).
 */
export function isSectionGroup(section: Pick<Section, "kind">): boolean {
  return section.kind === SECTION_GROUP_KIND;
}

/**
 * Canonical read of a section `kind` from outside input (a hand-edited
 * archive or sync folder). Only "group" passes; anything else — unknown
 * strings, wrong types, null, absent — reads as null, i.e. a plain
 * section. A corrupt row can never crash the sidebar (the safeTags /
 * safeSectionColor contract).
 */
export function normalizeSectionKind(raw: unknown): SectionKind | null {
  return raw === SECTION_GROUP_KIND ? SECTION_GROUP_KIND : null;
}
