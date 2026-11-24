/**
 * Pure tree operations — trivially unit-testable, no I/O.
 */
import type { Notebook, PageMeta, Section } from "./types";
import { byOrder } from "./types";
import { subtreePageIds, visiblePageOrder } from "./page-tree";

export interface TreeSnapshot {
  notebooks: Notebook[];
  sections: Section[];
  pages: PageMeta[];
}

export interface Selection {
  notebookId: string;
  sectionId: string;
  pageId: string;
}

/**
 * After removing the currently open page, pick the next page to open —
 * OneNote behavior: next page → previous page → first page in section →
 * first page in notebook → first page anywhere → null.
 *
 * Candidates exclude the page's whole SUBTREE (issue #359): trashing a
 * parent cascades to its subpages in the same write, so none of them is
 * ever a valid next selection. Candidates list in the section's VISIBLE
 * tree order (sibling-scoped orders alone no longer imply the flat
 * sequence once pages can indent), then keep the pinned flat-order
 * contract: the first candidate at-or-after the deleted page's `order`
 * wins — equal-order ties resolve to the tied survivor — and a stale id
 * (deletedOrder = +Infinity) falls back to the last candidate.
 */
export function nextSelectionAfterPageDelete(
  tree: TreeSnapshot,
  current: Selection
): Selection | null {
  const doomed = new Set(subtreePageIds(tree.pages, current.pageId)); // self + descendants
  const withoutDeleted: TreeSnapshot = {
    notebooks: tree.notebooks,
    sections: tree.sections,
    pages: tree.pages.filter((p) => !doomed.has(p.id)),
  };
  const inSection = visiblePageOrder(withoutDeleted.pages, current.sectionId);
  if (inSection.length) {
    const deletedOrder =
      tree.pages.find((orig) => orig.id === current.pageId)?.order ?? Number.POSITIVE_INFINITY;
    const idx = inSection.findIndex((p) => p.order >= deletedOrder);
    const next = idx >= 0 ? inSection[idx] : inSection[inSection.length - 1];
    return { notebookId: current.notebookId, sectionId: current.sectionId, pageId: next.id };
  }
  return firstPageSelection(withoutDeleted, current.notebookId);
}

/** First page of a notebook (first section that has pages), else first page anywhere. */
export function firstPageSelection(
  tree: TreeSnapshot,
  preferNotebookId?: string
): Selection | null {
  const pick = (notebookId?: string): Selection | null => {
    const sections = tree.sections
      .filter((s) => (notebookId ? s.notebookId === notebookId : true))
      .sort(byOrder);
    for (const sec of sections) {
      const page = tree.pages
        .filter((p) => p.sectionId === sec.id)
        .sort(byOrder)[0];
      if (page) {
        return { notebookId: sec.notebookId, sectionId: sec.id, pageId: page.id };
      }
    }
    return null;
  };
  return (preferNotebookId && pick(preferNotebookId)) || pick();
}

export function findNotebookOfSection(
  tree: TreeSnapshot,
  sectionId: string
): Notebook | undefined {
  const sec = tree.sections.find((s) => s.id === sectionId);
  return sec ? tree.notebooks.find((n) => n.id === sec.notebookId) : undefined;
}

/** Expand/collapse state helpers for the sidebar tree. */
export function defaultExpandedState(tree: TreeSnapshot, selection: Selection | null): Set<string> {
  const open = new Set<string>();
  if (selection) {
    open.add(selection.notebookId);
    open.add(selection.sectionId);
    // sub-sections (issue #314): a restored page nested deep in the tree
    // is only visible when its whole ancestor chain is expanded too
    const byId = new Map(tree.sections.map((s) => [s.id, s]));
    const seen = new Set<string>([selection.sectionId]);
    let cur = byId.get(selection.sectionId)?.parentId ?? null;
    while (cur && !seen.has(cur)) {
      open.add(cur);
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  } else if (tree.notebooks[0]) {
    open.add(tree.notebooks[0].id);
    const sec = tree.sections
      .filter((s) => s.notebookId === tree.notebooks[0].id)
      .sort(byOrder)[0];
    if (sec) open.add(sec.id);
  }
  return open;
}
