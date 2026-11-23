/**
 * Sub-section tree policy (issue #314) — pure helpers, no I/O, no Dexie.
 *
 * Sections can nest: a section carries an optional `parentId` pointing at
 * its parent section (null/absent = top level under the notebook, the
 * pre-#314 shape). These helpers are the single place that decides what a
 * "sibling", a "subtree" and an "ancestor chain" are, so the sidebar, the
 * data-layer cascades and the sync normalizer all agree.
 *
 * Everything is cycle-safe: a `parentId` loop (only writable through a
 * future reparent feature or a hand-edited sync folder) can never hang a
 * traversal — the visitor set short-circuits it.
 *
 * Test plan: docs/test-plans/sub-sections.md (ids SB-P1..P12).
 */
import type { PageRow, Section } from "./types";
import { byOrder } from "./types";
import { isSectionGroup } from "./section-groups";

/** The effective parent id of a section (absent field = top level). */
export function parentOf(s: Section): string | null {
  return s.parentId ?? null;
}

/** Sections of one notebook that sit directly under it, in sibling order. */
export function topLevelSections(
  sections: readonly Section[],
  notebookId: string
): Section[] {
  return sections
    .filter((s) => s.notebookId === notebookId && parentOf(s) === null)
    .sort(byOrder);
}

/** Direct children of one section, in sibling order. */
export function childSections(sections: readonly Section[], parentId: string): Section[] {
  return sections.filter((s) => parentOf(s) === parentId).sort(byOrder);
}

/**
 * The root section plus every descendant, depth-first in sibling order
 * (root first). Cycle-safe: an id already visited terminates that branch.
 */
export function subtreeSectionIds(sections: readonly Section[], rootId: string): string[] {
  const byParent = new Map<string, Section[]>();
  for (const s of sections) {
    const key = parentOf(s);
    if (key === null) continue;
    const list = byParent.get(key) ?? [];
    list.push(s);
    byParent.set(key, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return; // cycle guard
    seen.add(id);
    out.push(id);
    for (const child of (byParent.get(id) ?? []).sort(byOrder)) visit(child.id);
  };
  visit(rootId);
  return out;
}

/**
 * The ancestor chain of a section, nearest parent first (excluding the
 * section itself). Cycle-safe for the same reason.
 */
export function ancestorSectionIds(
  sections: readonly Section[],
  rootId: string
): string[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  let cur = byId.get(rootId) ? parentOf(byId.get(rootId)!) : null;
  while (cur !== null && !seen.has(cur)) {
    const next = byId.get(cur);
    if (!next) break; // dangling parent id — the chain ends here
    out.push(cur);
    seen.add(cur);
    cur = parentOf(next);
  }
  return out;
}

/**
 * Whether `sectionId` may be re-parented under `targetParentId` (phase 2,
 * issue #325 — drag-to-reparent + cross-notebook moves). A section can
 * never become its own descendant: the target must not be the section
 * itself nor anything inside its subtree. Cycle-safe — the check runs on
 * subtreeSectionIds' visitor set, so a corrupted `parentId` loop cannot
 * hang a drag. Notebook-level targets (top-level moves) carry no parent
 * id and are validated by the data layer instead.
 *
 * Section groups (issue #337, sub-sections phase 3): a GROUP's parents are
 * the notebook top level and other groups — the Microsoft Graph OneNote
 * model — so a group can never nest under a plain section; any row may
 * nest UNDER a group (that is a group's whole purpose).
 */
export function canReparent(
  sections: readonly Section[],
  sectionId: string,
  targetParentId: string
): boolean {
  if (sectionId === targetParentId) return false;
  if (subtreeSectionIds(sections, sectionId).includes(targetParentId)) return false;
  const mover = sections.find((s) => s.id === sectionId);
  if (mover && isSectionGroup(mover)) {
    const target = sections.find((s) => s.id === targetParentId);
    if (!target || !isSectionGroup(target)) return false;
  }
  return true;
}

/**
 * Stable sibling-order key for whole-row normalization (sync merge):
 * sections of different parents never share a group, so renumbering one
 * parent's siblings cannot touch another parent's.
 */
export function sectionSiblingKey(s: Section): string {
  return `${s.notebookId}|${parentOf(s) ?? ""}`;
}

/**
 * The alive pages of one section, in export order (issue #344): the
 * section→pages projection the sidebar order implies — alive rows only,
 * sorted by `order`, tie-broken by creation time so equal orders stay
 * deterministic. Pure so the section-PDF exporter's input assembly is
 * unit-testable without Dexie.
 */
export function selectSectionPages(
  pages: readonly PageRow[],
  sectionId: string
): PageRow[] {
  return pages
    .filter((p) => p.sectionId === sectionId && !p.deletedAt)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/**
 * The alive plain sections of one notebook, in export order (issue #351,
 * wave 22): the notebook→sections projection the sidebar implies — a
 * depth-first walk of the section tree in sibling order (sections inside
 * section groups export at their sidebar position; group containers are
 * never entries themselves), trashed rows excluded. Cycle-safe like every
 * traversal here.
 *
 * Orphan tolerance: a plain section whose parent row is missing, trashed or
 * foreign is invisible in the sidebar but still ALIVE data — an export
 * never silently drops pages, so such orphans append after the visible
 * tree in sibling order.
 */
export function selectNotebookExportSections(
  sections: readonly Section[],
  notebookId: string
): Section[] {
  const inNotebook = sections.filter(
    (s) => s.notebookId === notebookId && !s.deletedAt
  );
  const out: Section[] = [];
  const seen = new Set<string>();
  const visitChildren = (parentId: string | null) => {
    for (const child of inNotebook
      .filter((s) => parentOf(s) === parentId)
      .sort(byOrder)) {
      if (seen.has(child.id)) continue; // cycle guard
      seen.add(child.id);
      if (!isSectionGroup(child)) out.push(child);
      visitChildren(child.id); // groups AND sections can hold children
    }
  };
  visitChildren(null);
  // orphans: alive plain sections the visible tree never reached
  out.push(
    ...inNotebook
      .filter((s) => !isSectionGroup(s) && !seen.has(s.id))
      .sort(byOrder)
  );
  return out;
}
