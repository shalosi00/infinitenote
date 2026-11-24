/**
 * Sub-page tree policy (issue #359) — pure helpers, no I/O, no Dexie.
 *
 * OneNote "Make subpage" parity: a page can indent under another page of
 * the SAME section, capped at TWO subpage tiers (main page → subpage →
 * sub-subpage) — OneNote's own depth cap. A page carries an optional
 * `parentId` (null/absent = top level, the pre-#359 shape); these helpers
 * are the single place that decides what a "sibling", a "subtree", an
 * "ancestor chain" and the VISIBLE page order are, so the sidebar, the
 * data-layer cascades and the section-PDF export all agree.
 *
 * Read-time tolerance (the sync folder is human-editable JSON, so
 * `parentId` gets hand-edited): a page whose parent row is missing,
 * trashed, foreign to the section or part of a `parentId` cycle renders
 * as a TOP-LEVEL root — visible and safe, never hidden, never hanging a
 * traversal (every walk carries a visitor set, the section-tree
 * discipline). A hand-edited chain deeper than the OneNote cap renders
 * clamped at the cap without rewriting the data.
 *
 * Everything here is pure so the export-order input assembly and the
 * sidebar projection are unit-testable without Dexie — the wave-21
 * lesson: a test that pulls notes-db poisons every db-sharing test file.
 *
 * Test plan: docs/test-plans/sub-pages.md (ids PG-P1..PG-P14).
 */
import type { PageMeta, PageRow } from "./types";
import { byOrder } from "./types";

/** OneNote's own cap: main page + at most two tiers of subpages. */
export const MAX_PAGE_DEPTH = 2;

/** The effective parent id of a page (absent field = top level). */
export function parentOf(p: { parentId?: string | null }): string | null {
  return p.parentId ?? null;
}

type TreePage = Pick<PageRow, "id" | "sectionId" | "order" | "createdAt" | "deletedAt" | "parentId">;

/** Alive pages of one section sitting directly under it, in sibling order. */
export function topLevelPages(
  pages: readonly TreePage[],
  sectionId: string
): TreePage[] {
  return pages
    .filter((p) => p.sectionId === sectionId && !p.deletedAt && parentOf(p) === null)
    .sort(byOrder);
}

/** Alive direct children of one page, in sibling order. */
export function childPages(pages: readonly TreePage[], parentId: string): TreePage[] {
  return pages.filter((p) => !p.deletedAt && parentOf(p) === parentId).sort(byOrder);
}

/**
 * The root page plus every descendant, depth-first in sibling order (root
 * first). RAW like its section-tree twin subtreeSectionIds: TRASHED rows
 * stay reachable, so the data-layer cascades (trash/restore/purge/move)
 * can act through a separately-trashed intermediate row and the family
 * never fragments. Callers filter by deletedAt as their semantics need.
 * Cycle-safe: an id already visited terminates that branch.
 */
export function subtreePageIds(pages: readonly TreePage[], rootId: string): string[] {
  const byParent = new Map<string, TreePage[]>();
  for (const p of pages) {
    const key = parentOf(p);
    if (key === null) continue;
    const list = byParent.get(key) ?? [];
    list.push(p);
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
 * The ancestor chain of a page, nearest parent first (excluding the page
 * itself). Cycle-safe; stops at a dangling parent id.
 */
export function ancestorPageIds(pages: readonly TreePage[], rootId: string): string[] {
  const byId = new Map(pages.map((p) => [p.id, p] as const));
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const start = byId.get(rootId);
  let cur = start && !start.deletedAt ? parentOf(start) : null;
  while (cur !== null && !seen.has(cur)) {
    const next = byId.get(cur);
    if (!next || next.deletedAt) break; // dangling/trashed parent — chain ends
    out.push(cur);
    seen.add(cur);
    cur = parentOf(next);
  }
  return out;
}

/**
 * The effective depth of one alive page (0 = top-level). A broken parent
 * chain (missing row, trashed row, foreign section, cycle) reads as 0 —
 * the page renders as a root instead of disappearing.
 */
export function pageDepth(pages: readonly TreePage[], pageId: string): number {
  const byId = new Map(pages.map((p) => [p.id, p] as const));
  let depth = 0;
  let cur = byId.get(pageId);
  const sectionId = cur?.sectionId;
  const seen = new Set<string>([pageId]);
  while (cur) {
    const pid = parentOf(cur);
    if (pid === null) break;
    const parent = byId.get(pid);
    // broken chain: missing/trashed/foreign-section parent → this page is
    // a visible root at the depth reached so far
    if (!parent || parent.deletedAt || parent.sectionId !== sectionId || seen.has(pid)) break;
    depth += 1;
    seen.add(pid);
    cur = parent;
  }
  return depth;
}

/** One row of the sidebar projection: the page plus its visible depth. */
export interface VisiblePage<T extends TreePage = PageMeta> {
  page: T;
  depth: number;
}

/**
 * The alive pages of one section in VISIBLE tree order (issue #359): every
 * top-level page in sibling order followed by its subtree depth-first, the
 * order the sidebar renders and the section-PDF export follows (a subpage
 * exports right after its parent — OneNote exports the indented order).
 *
 * Orphan tolerance: a page whose parent row is missing, trashed or foreign
 * is still ALIVE data — it renders as a top-level root instead of being
 * dropped. A `parentId` cycle (A→B→A, only writable by a hand-edited sync
 * folder) can never hang the walk: cycle members that were never reached
 * append after the visible tree in sibling order. Deep hand-edited chains
 * render clamped at MAX_PAGE_DEPTH — structure preserved, OneNote cap kept.
 */
export function visiblePageTree<T extends TreePage>(
  pages: readonly T[],
  sectionId: string
): Array<VisiblePage<T>> {
  const inSection = pages.filter((p) => p.sectionId === sectionId && !p.deletedAt);
  const byId = new Map(inSection.map((p) => [p.id, p] as const));
  const out: Array<VisiblePage<T>> = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return; // cycle guard
    seen.add(id);
    const page = byId.get(id)!;
    out.push({ page, depth: Math.min(depth, MAX_PAGE_DEPTH) });
    for (const child of inSection
      .filter((p) => parentOf(p) === id)
      .sort(byOrder)) {
      visit(child.id, depth + 1);
    }
  };
  // roots: explicit top-level pages, then broken-chain pages (missing /
  // trashed / foreign parent), then cycle members — all in sibling order,
  // appended after the explicitly rooted tree (an export never drops pages)
  const broken = inSection
    .filter((p) => {
      const pid = parentOf(p);
      if (pid === null) return false;
      const parent = byId.get(pid);
      return !parent || parent.deletedAt || parent.sectionId !== sectionId;
    })
    .sort(byOrder);
  for (const root of inSection
    .filter((p) => parentOf(p) === null)
    .sort(byOrder)) {
    visit(root.id, 0);
  }
  for (const root of broken) visit(root.id, 0);
  // cycle members the walks never reached
  for (const rest of inSection.filter((p) => !seen.has(p.id)).sort(byOrder)) {
    visit(rest.id, 0);
  }
  return out;
}

/**
 * The alive pages of one section in export order — the section→pages
 * projection the sidebar implies (issue #359: tree order, the wave-21
 * flat order generalized). Kept as a named export so the section-PDF
 * exporter's input assembly stays policy-driven.
 */
export function visiblePageOrder<T extends TreePage>(
  pages: readonly T[],
  sectionId: string
): T[] {
  return visiblePageTree(pages, sectionId).map((v) => v.page);
}

/**
 * The immediately preceding alive page in this page's OWN sibling scope —
 * the target OneNote's "Make subpage" demotes under. null when the page
 * is the first child of its parent (the command hides).
 */
export function previousSiblingOf(
  pages: readonly TreePage[],
  pageId: string
): TreePage | null {
  const self = pages.find((p) => p.id === pageId && !p.deletedAt);
  if (!self) return null;
  const key = parentOf(self);
  const siblings = pages
    .filter((p) => !p.deletedAt && p.sectionId === self.sectionId && parentOf(p) === key)
    .sort(byOrder);
  const idx = siblings.findIndex((p) => p.id === pageId);
  return idx > 0 ? siblings[idx - 1] : null;
}

/**
 * Whether `pageId` may re-parent under `targetParentId` (issue #359).
 * Rules: both alive, same section (sub-pages never cross sections —
 * OneNote indents within the page list), the target is not the page
 * itself nor inside its subtree (cycle-safe via the visitor set), and the
 * WHOLE moved subtree stays within the OneNote depth cap: the page lands
 * at depth(target) + 1 and its deepest descendant rides at + its own
 * offset, so `depth(target) + 1 + subtreeHeight(page) <= MAX_PAGE_DEPTH`.
 */
export function canMakeSubpage(
  pages: readonly TreePage[],
  pageId: string,
  targetParentId: string
): boolean {
  if (pageId === targetParentId) return false;
  const mover = pages.find((p) => p.id === pageId && !p.deletedAt);
  const target = pages.find((p) => p.id === targetParentId && !p.deletedAt);
  if (!mover || !target) return false;
  if (mover.sectionId !== target.sectionId) return false;
  if (subtreePageIds(pages, pageId).includes(targetParentId)) return false;
  const height = subtreeHeight(pages, pageId);
  return pageDepth(pages, targetParentId) + 1 + height <= MAX_PAGE_DEPTH;
}

/**
 * Height of a page's alive subtree: the largest offset of any descendant
 * below the page (0 = leaf). Cycle-safe.
 */
export function subtreeHeight(pages: readonly TreePage[], rootId: string): number {
  const depthById = new Map(pages.map((p) => [p.id, p] as const));
  let max = 0;
  const walk = (id: string, offset: number, seen: Set<string>) => {
    if (seen.has(id)) return; // cycle guard
    seen.add(id);
    max = Math.max(max, offset);
    for (const child of pages
      .filter((p) => !p.deletedAt && parentOf(p) === id)
      .sort(byOrder)) {
      walk(child.id, offset + 1, seen);
    }
  };
  const root = depthById.get(rootId);
  if (!root || root.deletedAt) return 0;
  walk(rootId, 0, new Set<string>());
  return max;
}

/**
 * Whether the page menu offers "Promote" (issue #359): the page carries a
 * parent id. A dangling parent id (hand-edited sync folder) still offers
 * Promote — the data layer clears the dangling reference (a write-heal).
 */
export function canPromote(pages: readonly TreePage[], pageId: string): boolean {
  const self = pages.find((p) => p.id === pageId && !p.deletedAt);
  return !!self && parentOf(self) !== null;
}

/**
 * The demote target for the page menu's "Make subpage" (issue #359): the
 * previous sibling in the page's own scope, when the OneNote depth cap
 * allows the whole moved subtree to fit. null hides the menu item.
 */
export function makeSubpageTarget(
  pages: readonly TreePage[],
  pageId: string
): TreePage | null {
  const prev = previousSiblingOf(pages, pageId);
  if (!prev) return null;
  return canMakeSubpage(pages, pageId, prev.id) ? prev : null;
}

/**
 * The promote target for the page menu's "Promote" (issue #359): the
 * grandparent id (one level up), null = top level. null result also means
 * "already top level" — the menu item hides.
 */
export function promoteTarget(
  pages: readonly TreePage[],
  pageId: string
): string | null {
  const self = pages.find((p) => p.id === pageId && !p.deletedAt);
  if (!self) return null;
  const pid = parentOf(self);
  if (pid === null) return null;
  const parent = pages.find((p) => p.id === pid && !p.deletedAt);
  return parent ? parentOf(parent) : null;
}
