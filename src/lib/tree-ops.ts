/**
 * Pure tree operations — trivially unit-testable, no I/O.
 */
import type { Notebook, PageMeta, Section } from "./types";
import { byOrder } from "./types";

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
 * OneNote behavior: next sibling → previous sibling → first page in
 * section → first page in notebook → first page anywhere → null.
 *
 * The page being deleted is excluded from all candidates.
 */
export function nextSelectionAfterPageDelete(
  tree: TreeSnapshot,
  current: Selection
): Selection | null {
  const withoutDeleted: TreeSnapshot = {
    notebooks: tree.notebooks,
    sections: tree.sections,
    pages: tree.pages.filter((p) => p.id !== current.pageId),
  };
  const inSection = withoutDeleted.pages
    .filter((p) => p.sectionId === current.sectionId)
    .sort(byOrder);
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
  } else if (tree.notebooks[0]) {
    open.add(tree.notebooks[0].id);
    const sec = tree.sections
      .filter((s) => s.notebookId === tree.notebooks[0].id)
      .sort(byOrder)[0];
    if (sec) open.add(sec.id);
  }
  return open;
}
