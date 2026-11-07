/**
 * Persist the last-opened page selection (issue #123).
 *
 * OneNote reopens where you left off; muscle memory expects the same. The
 * selection is per-device UX state — not note data — so localStorage is the
 * right home (IndexedDB holds the notebooks; this survives even when the
 * canvas last rendered on a page that has since been reorganized).
 *
 * Everything here is defensive: storage may be blocked, full, or missing
 * (SSR) — a stale or unreadable key must never break boot. Shape validation
 * happens in loadLastSelection, tree validation in pickRestoredSelection,
 * so a page trashed or deleted between sessions falls back gracefully.
 */

import type { Selection, TreeSnapshot } from "./tree-ops";

export const LAST_PAGE_STORAGE_KEY = "infinitenote.lastPage";

/** Persist a selection; silently no-ops when storage is unavailable. */
export function saveLastSelection(sel: Selection): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_PAGE_STORAGE_KEY, JSON.stringify(sel));
  } catch {
    /* storage full or blocked — non-critical UX state */
  }
}

/**
 * Read + shape-validate the stored selection. Anything missing, malformed,
 * or not a triple of non-empty strings returns null (never throws).
 */
export function loadLastSelection(): Selection | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LAST_PAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Selection> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const { notebookId, sectionId, pageId } = parsed;
    if (
      typeof notebookId !== "string" ||
      typeof sectionId !== "string" ||
      typeof pageId !== "string" ||
      !notebookId ||
      !sectionId ||
      !pageId
    ) {
      return null;
    }
    return { notebookId, sectionId, pageId };
  } catch {
    return null;
  }
}

/**
 * Validate a stored selection against the freshly loaded tree. The page is
 * the anchor: its CURRENT parent chain (section → notebook) is re-derived
 * from the tree, so a page that was moved between sessions still reopens
 * correctly under its new home. A page that was trashed or deleted between
 * sessions is absent from `tree.pages` (listPages returns alive rows only)
 * → null, and boot keeps its firstPageSelection default.
 */
export function pickRestoredSelection(
  stored: Selection | null,
  tree: TreeSnapshot,
): Selection | null {
  if (!stored) return null;
  const page = tree.pages.find((p) => p.id === stored.pageId);
  if (!page) return null;
  const section = tree.sections.find((s) => s.id === page.sectionId);
  if (!section) return null;
  const notebook = tree.notebooks.find((n) => n.id === section.notebookId);
  if (!notebook) return null;
  return { notebookId: notebook.id, sectionId: section.id, pageId: page.id };
}
