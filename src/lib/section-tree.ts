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
import type { Section } from "./types";
import { byOrder } from "./types";

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
 * Stable sibling-order key for whole-row normalization (sync merge):
 * sections of different parents never share a group, so renumbering one
 * parent's siblings cannot touch another parent's.
 */
export function sectionSiblingKey(s: Section): string {
  return `${s.notebookId}|${parentOf(s) ?? ""}`;
}
