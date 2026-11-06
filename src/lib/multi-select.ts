/**
 * Pure multi-select helpers for the sidebar (issue #27).
 *
 * Selection state itself lives in the sidebar component (UI-layer only);
 * these functions keep the set algebra testable without a DOM.
 */
import type { PageMeta, Section } from "./types";

/** Toggle one page id in an immutable selection set. */
export function toggleSelected(selected: ReadonlySet<string>, pageId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(pageId)) next.delete(pageId);
  else next.add(pageId);
  return next;
}

/**
 * Ids of alive pages inside expanded sections — what "select all" means in
 * the sidebar. Collapsed sections are skipped so the action never selects
 * something the user cannot see.
 */
export function visiblePageIds(
  pages: readonly PageMeta[],
  sections: readonly Section[],
  expanded: ReadonlySet<string>
): string[] {
  const open = new Set(sections.filter((s) => expanded.has(s.id)).map((s) => s.id));
  return pages.filter((p) => open.has(p.sectionId)).map((p) => p.id);
}

/** True when `ids` is non-empty and every id is selected. */
export function allSelected(selected: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** True when at least one of `ids` is selected (partial state for a tri-state). */
export function someSelected(selected: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.some((id) => selected.has(id));
}

/**
 * Ids from `selection` that still exist in `pages` — prunes stale ids after
 * the tree changes (e.g. a selected page was trashed elsewhere).
 */
export function pruneSelected(
  selected: ReadonlySet<string>,
  pages: readonly PageMeta[]
): Set<string> {
  const alive = new Set(pages.map((p) => p.id));
  return new Set([...selected].filter((id) => alive.has(id)));
}
