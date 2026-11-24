/**
 * Dexie (IndexedDB) persistence layer.
 *
 * Design notes (senior-simple):
 * - Primary keys are nanoid-style strings so records can be created offline
 *   and merged without server allocation.
 * - Soft delete via `deletedAt` for a OneNote-like trash experience.
 * - Page content (the Excalidraw scene) lives on the page row; tree queries
 *   use `.toArray()` then filter in memory — a personal notes app has
 *   hundreds of rows, not millions, so scans are fine and keep code simple.
 * - v2 (sync, v1.5): `tombstones` remembers purges so a stale sync folder
 *   can never resurrect a purged row; `syncMeta` holds the last-synced
 *   manifest. Both are additive stores — no data migration needed.
 * - v3 (version history): `pageVersions` holds per-page scene snapshots
 *   (auto / manual / pre-restore) with a FIFO budget — additive again.
 * - v4 (page templates, issue #279): `templates` stores reusable page
 *   scenes under user-chosen names — additive once more; templates are
 *   local-only by design (OneNote semantics) and ride in notebook backups.
 */
import Dexie, { type Table } from "dexie";
import { generatedNames } from "./generated-names";
import { RestoreError } from "./restore-error";
import { safeTags } from "./tags";
import { byOrder } from "./types";
import { safeSectionColor } from "./section-colors";
import { isSectionGroup, normalizeSectionKind } from "./section-groups";
import { ancestorSectionIds, canReparent, subtreeSectionIds } from "./section-tree";
import { canMakeSubpage, parentOf as parentPageOf, subtreePageIds } from "./page-tree";
import {
  buildPageVersion,
  pruneToCapacity,
  shouldAutoSnapshot,
  sortVersionsNewestFirst,
  type PageVersionRow,
  type PageVersionSource,
  type PageVersionSummary,
} from "./version-history";
import type {
  Notebook,
  NotebookColor,
  PageMeta,
  PageRow,
  ScenePayload,
  Section,
} from "./types";
import {
  MAX_TEMPLATE_BYTES,
  TemplateError,
  buildTemplateRow,
  parseTemplateContent,
  sortTemplatesForPicker,
  validateTemplateName,
  type TemplateRow,
  type TemplateSummary,
} from "./page-templates";

/** Purge tombstone — `purged: true` entries of the sync trash log. */
export interface TombstoneRow {
  /** id of the purged row (same table key space as the row tables) */
  id: string;
  kind: "notebook" | "section" | "page";
  at: number;
  title?: string;
}

/** Small key-value store for sync state (e.g. the last-synced manifest). */
export interface SyncMetaRow {
  key: string;
  value: unknown;
}

export class InfiniteNoteDB extends Dexie {
  notebooks!: Table<Notebook, string>;
  sections!: Table<Section, string>;
  pages!: Table<PageRow, string>;
  tombstones!: Table<TombstoneRow, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  pageVersions!: Table<PageVersionRow, string>;
  templates!: Table<TemplateRow, string>;

  constructor() {
    super("infinitenote");
    this.version(1).stores({
      notebooks: "id, order, deletedAt",
      sections: "id, notebookId, order, deletedAt",
      pages: "id, sectionId, order, deletedAt, [sectionId+deletedAt]",
    });
    this.version(2).stores({
      notebooks: "id, order, deletedAt",
      sections: "id, notebookId, order, deletedAt",
      pages: "id, sectionId, order, deletedAt, [sectionId+deletedAt]",
      tombstones: "id",
      syncMeta: "key",
    });
    this.version(3).stores({
      notebooks: "id, order, deletedAt",
      sections: "id, notebookId, order, deletedAt",
      pages: "id, sectionId, order, deletedAt, [sectionId+deletedAt]",
      tombstones: "id",
      syncMeta: "key",
      pageVersions: "id, pageId, createdAt",
    });
    this.version(4).stores({
      notebooks: "id, order, deletedAt",
      sections: "id, notebookId, order, deletedAt",
      pages: "id, sectionId, order, deletedAt, [sectionId+deletedAt]",
      tombstones: "id",
      syncMeta: "key",
      pageVersions: "id, pageId, createdAt",
      templates: "id, name, createdAt",
    });
  }
}

export const db = new InfiniteNoteDB();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function newId(): string {
  // crypto.randomUUID is available in all modern browsers + bun
  return crypto.randomUUID();
}

const now = () => Date.now();

/** Fallback name for backup templates whose name field is blank/missing. */
const RESTORED_TEMPLATE_NAME = "Restored template";

/** All alive rows sorted by order (nulls/deleted filtered). */
function alive<T extends { order: number; createdAt: number; id: string; deletedAt: number | null }>(
  rows: T[]
): T[] {
  return rows.filter((r) => r.deletedAt === null).sort(byOrder);
}

/* ------------------------------------------------------------------ */
/* notebooks                                                           */
/* ------------------------------------------------------------------ */

export async function listNotebooks(): Promise<Notebook[]> {
  return alive(await db.notebooks.toArray());
}

export async function createNotebook(name: string, color: Notebook["color"]): Promise<Notebook> {
  const all = await db.notebooks.toArray();
  const maxOrder = Math.max(0, ...all.map((n) => n.order));
  const nb: Notebook = {
    id: newId(),
    name,
    color,
    order: maxOrder + 1,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.notebooks.add(nb);
  return nb;
}

export async function renameNotebook(id: string, name: string): Promise<void> {
  await db.notebooks.update(id, { name, updatedAt: now() });
}

export async function setNotebookColor(id: string, color: Notebook["color"]): Promise<void> {
  await db.notebooks.update(id, { color, updatedAt: now() });
}

/** Swap order with the neighbor in the given direction (-1 up, +1 down). */
export async function moveNotebook(id: string, dir: -1 | 1): Promise<void> {
  const list = await listNotebooks();
  const idx = list.findIndex((n) => n.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= list.length) return;
  const a = list[idx];
  const b = list[target];
  await db.transaction("rw", db.notebooks, async () => {
    await db.notebooks.update(a.id, { order: b.order });
    await db.notebooks.update(b.id, { order: a.order });
  });
}

/**
 * Soft-delete a notebook and cascade the same `deletedAt` timestamp to its
 * sections/pages. Cascade keeps restore semantics simple: restoring the
 * notebook restores exactly the children that were deleted with it.
 */
export async function trashNotebook(id: string): Promise<void> {
  const ts = now();
  await db.transaction("rw", [db.notebooks, db.sections, db.pages], async () => {
    await db.notebooks.update(id, { deletedAt: ts, updatedAt: ts });
    const sections = await db.sections.where("notebookId").equals(id).toArray();
    for (const s of sections) {
      if (s.deletedAt !== null) continue; // already trashed on its own → keep its own ts
      await db.sections.update(s.id, { deletedAt: ts });
      const pages = await db.pages.where("sectionId").equals(s.id).toArray();
      for (const p of pages) {
        if (p.deletedAt !== null) continue; // same for pages
        await db.pages.update(p.id, { deletedAt: ts });
      }
    }
  });
}

export async function restoreNotebook(id: string): Promise<void> {
  const nb = await db.notebooks.get(id);
  if (!nb?.deletedAt) return;
  await db.transaction("rw", [db.notebooks, db.sections, db.pages], async () => {
    const ts = nb.deletedAt!;
    await db.notebooks.update(id, { deletedAt: null, updatedAt: now() });
    // restore children that were deleted together with the notebook
    const sections = await db.sections.where("notebookId").equals(id).toArray();
    for (const s of sections) {
      if (s.deletedAt !== ts) continue; // was trashed earlier → keep in trash
      await db.sections.update(s.id, { deletedAt: null });
      const pages = await db.pages.where("sectionId").equals(s.id).toArray();
      for (const p of pages) {
        if (p.deletedAt === ts) await db.pages.update(p.id, { deletedAt: null });
      }
    }
  });
}

export async function purgeNotebook(id: string): Promise<void> {
  await db.transaction("rw", [db.notebooks, db.sections, db.pages, db.tombstones, db.pageVersions], async () => {
    const nb = await db.notebooks.get(id);
    if (nb) await db.tombstones.put({ id: nb.id, kind: "notebook", at: now(), title: nb.name });
    const sections = await db.sections.where("notebookId").equals(id).toArray();
    for (const s of sections) {
      await purgeRowsOfSection(s);
    }
    await db.notebooks.delete(id);
  });
}

/** Tombstone + hard-delete a section and all of its pages (shared by purge paths). */
async function purgeRowsOfSection(s: Section): Promise<void> {
  await db.tombstones.put({ id: s.id, kind: "section", at: now(), title: s.name });
  const pages = await db.pages.where("sectionId").equals(s.id).toArray();
  for (const p of pages) {
    await db.tombstones.put({ id: p.id, kind: "page", at: now(), title: p.title });
    // version history is page-scoped — it dies with the page (v3)
    await db.pageVersions.where("pageId").equals(p.id).delete();
  }
  await db.pages.where("sectionId").equals(s.id).delete();
  await db.sections.delete(s.id);
}

/* ------------------------------------------------------------------ */
/* sections                                                            */
/* ------------------------------------------------------------------ */

export async function listSections(): Promise<Section[]> {
  return alive(await db.sections.toArray());
}

export async function createSection(
  notebookId: string,
  name: string,
  parentId: string | null = null,
  kind: Section["kind"] = null
): Promise<Section> {
  // siblings share the parent: top-level sections and children of other
  // sections never influence a new row's order (issue #314)
  const all = await db.sections.where("notebookId").equals(notebookId).toArray();
  // section groups (issue #337): a group's parents are the notebook top
  // level and other groups (the Graph OneNote model) — never a plain
  // section, which holds pages. The UI only ever creates top-level groups
  // (the OneNote right-click-a-section-tab path); this guard keeps the
  // data layer honest for any future caller.
  if (kind === "group" && parentId !== null) {
    const parent = all.find((s) => s.id === parentId);
    if (!parent || parent.deletedAt !== null || !isSectionGroup(parent)) {
      throw new Error("a section group can only live at the notebook top level or inside another section group");
    }
  }
  const siblings = all.filter((s) => (s.parentId ?? null) === parentId);
  const maxOrder = Math.max(0, ...siblings.map((s) => s.order));
  const sec: Section = {
    id: newId(),
    notebookId,
    parentId,
    // plain sections carry NO kind field at all — the pre-#337 row shape
    // (structured clone drops undefined properties, old rows stay valid)
    kind: kind ?? undefined,
    name,
    order: maxOrder + 1,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.sections.add(sec);
  return sec;
}

export async function renameSection(id: string, name: string): Promise<void> {
  await db.sections.update(id, { name, updatedAt: now() });
}

/**
 * OneNote "Section Color" parity (issue #319): set an explicit section
 * color override; null clears the override so the row inherits the
 * notebook's color again. The render policy lives in section-colors.ts.
 */
export async function setSectionColor(
  id: string,
  color: NotebookColor | null,
): Promise<void> {
  await db.sections.update(id, { color, updatedAt: now() });
}

export async function moveSection(id: string, dir: -1 | 1): Promise<void> {
  const sec = await db.sections.get(id);
  if (!sec) return;
  const siblings = (await db.sections.where("notebookId").equals(sec.notebookId).toArray())
    .filter((s) => s.deletedAt === null && (s.parentId ?? null) === (sec.parentId ?? null))
    .sort(byOrder);
  const idx = siblings.findIndex((s) => s.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[target];
  await db.transaction("rw", db.sections, async () => {
    await db.sections.update(a.id, { order: b.order });
    await db.sections.update(b.id, { order: a.order });
  });
}

/** Result of moveSectionTo (issue #325). */
export type SectionMoveResult = "moved" | "noop" | "invalid";

/**
 * Sub-sections phase 2 (issue #325): move a section — with its whole
 * subtree — to a new home. `targetParentId` null = top level of
 * `targetNotebookId`; a section id = nested under that section
 * (cross-notebook allowed — the OneNote drag-the-section-tab flow, with
 * the "Move or Copy" dialog as the keyboard/touch path).
 *
 * - the moved root gets `{notebookId, parentId, order}` (appended to the
 *   end of the target sibling scope, movePagesToSection's convention)
 * - every descendant keeps its own parentId/order (the subtree moves
 *   as-is) and follows the root's notebookId — trashed descendants
 *   included, their deletedAt stamps untouched, so the subtree stays
 *   restorable in its new notebook
 * - pages need no writes: they follow their sectionId
 * - invalid targets (trashed source/targets, a self/descendant parent,
 *   a dangling parent id, a group mover under a plain section) return
 *   "invalid" with zero writes
 * - a section already living at the target returns "noop" with zero
 *   writes (drop on its own parent must not reorder)
 */
export async function moveSectionTo(
  id: string,
  targetNotebookId: string,
  targetParentId: string | null
): Promise<SectionMoveResult> {
  const sec = await db.sections.get(id);
  if (!sec || sec.deletedAt !== null) return "invalid";
  const nb = await db.notebooks.get(targetNotebookId);
  if (!nb || nb.deletedAt !== null) return "invalid";
  const all = await db.sections.toArray();
  if (targetParentId !== null) {
    const parent = all.find((s) => s.id === targetParentId);
    if (!parent || parent.deletedAt !== null) return "invalid";
    if (parent.notebookId !== targetNotebookId) return "invalid";
    // section groups (issue #337): a group never nests under a plain
    // section (the Graph OneNote model) — zero-write "invalid", mirroring
    // the canReparent drag rule at the write layer
    if (isSectionGroup(sec) && !isSectionGroup(parent)) return "invalid";
    if (!canReparent(all, id, targetParentId)) return "invalid";
  }

  // already there → a successful no-op (drop on its own parent must
  // never reorder the siblings it landed on)
  if (sec.notebookId === targetNotebookId && (sec.parentId ?? null) === targetParentId) {
    return "noop";
  }

  const siblings = all.filter(
    (s) =>
      s.deletedAt === null &&
      s.notebookId === targetNotebookId &&
      (s.parentId ?? null) === targetParentId
  );
  const maxOrder = Math.max(0, ...siblings.map((s) => s.order));
  const ts = now();
  await db.transaction("rw", db.sections, async () => {
    await db.sections.update(id, {
      notebookId: targetNotebookId,
      parentId: targetParentId,
      order: maxOrder + 1,
      updatedAt: ts,
    });
    const descendantIds = subtreeSectionIds(all, id).filter((sid) => sid !== id);
    for (const sid of descendantIds) {
      await db.sections.update(sid, { notebookId: targetNotebookId, updatedAt: ts });
    }
  });
  return "moved";
}

export async function trashSection(id: string): Promise<void> {
  const ts = now();
  await db.transaction("rw", [db.sections, db.pages], async () => {
    // the cascade covers the whole subtree (issue #314) — the notebook
    // cascade pattern one level generalized: only ALIVE members are
    // stamped, so separately-trashed children keep their own timestamp
    // and are never resurrected by a later restore of the parent
    const all = await db.sections.toArray();
    const ids = subtreeSectionIds(all, id);
    for (const sid of ids) {
      const s = all.find((row) => row.id === sid);
      if (!s || s.deletedAt !== null) continue; // already trashed on its own
      await db.sections.update(sid, { deletedAt: ts, updatedAt: ts });
      const pages = await db.pages.where("sectionId").equals(sid).toArray();
      for (const p of pages) {
        if (p.deletedAt !== null) continue; // already trashed on its own
        await db.pages.update(p.id, { deletedAt: ts });
      }
    }
  });
}

export async function restoreSection(id: string): Promise<void> {
  const sec = await db.sections.get(id);
  if (!sec?.deletedAt) return;
  const ts = sec.deletedAt;
  await db.transaction("rw", [db.sections, db.pages, db.notebooks], async () => {
    const all = await db.sections.toArray();
    // subtree members trashed together with the restored section (same ts)
    const subtree = subtreeSectionIds(all, id);
    // trashed ancestors come back too (OneNote-like: the family restores);
    // each resurrected ancestor also brings back the pages stamped at its
    // own delete time, so the end state matches restoring it directly
    const ancestors = ancestorSectionIds(all, id);
    const resurrect: Section[] = [];
    for (const sid of subtree) {
      const s = all.find((row) => row.id === sid);
      if (s && s.deletedAt === ts) resurrect.push(s);
    }
    for (const aid of ancestors) {
      const s = all.find((row) => row.id === aid);
      if (s && s.deletedAt !== null) resurrect.push(s);
    }
    for (const s of resurrect) {
      await db.sections.update(s.id, { deletedAt: null, updatedAt: now() });
      const pages = await db.pages.where("sectionId").equals(s.id).toArray();
      for (const p of pages) {
        if (p.deletedAt === s.deletedAt) await db.pages.update(p.id, { deletedAt: null });
      }
    }
    const nb = await db.notebooks.get(sec.notebookId);
    // if parent notebook is still trashed, bring it back too (OneNote-like)
    if (nb?.deletedAt) await db.notebooks.update(nb.id, { deletedAt: null });
  });
}

export async function purgeSection(id: string): Promise<void> {
  await db.transaction("rw", [db.sections, db.pages, db.tombstones, db.pageVersions], async () => {
    // the whole subtree dies: every descendant section, its pages, their
    // version snapshots and one tombstone per row (issue #314)
    const all = await db.sections.toArray();
    const ids = subtreeSectionIds(all, id);
    for (const sid of ids) {
      const sec = all.find((row) => row.id === sid);
      if (sec) await purgeRowsOfSection(sec);
    }
  });
}

/* ------------------------------------------------------------------ */
/* quick notes home (OneNote-style quick capture)                      */
/* ------------------------------------------------------------------ */

export interface QuickNotesHome {
  notebook: Notebook;
  section: Section;
}

/**
 * Find-or-create the "Quick Notes" notebook + its "Quick Notes" section.
 * Idempotent: matches alive rows by name case-insensitively, so renaming or
 * trashing the home simply results in a fresh one on the next call.
 */
export async function ensureQuickNotesHome(
  notebookName: string,
  sectionName: string
): Promise<QuickNotesHome> {
  const notebooks = await listNotebooks();
  let notebook = notebooks.find((n) => n.name.toLowerCase() === notebookName.toLowerCase());
  if (!notebook) {
    notebook = await createNotebook(notebookName, "amber");
  }
  const sections = await listSections();
  let section = sections.find(
    (s) => s.notebookId === notebook.id && s.name.toLowerCase() === sectionName.toLowerCase()
  );
  if (!section) {
    section = await createSection(notebook.id, sectionName);
  }
  return { notebook, section };
}

/* ------------------------------------------------------------------ */
/* pages                                                               */
/* ------------------------------------------------------------------ */

export async function listPages(): Promise<PageMeta[]> {
  return alive(await db.pages.toArray()).map(({ content: _content, ...meta }) => meta);
}

/** First alive page with EXACTLY this title inside the section (null when absent). */
export async function findPageByTitle(sectionId: string, title: string): Promise<PageMeta | null> {
  const rows = await db.pages.where("sectionId").equals(sectionId).toArray();
  const hit = alive(rows).find((p) => p.title === title);
  if (!hit) return null;
  const { content: _c, ...meta } = hit;
  return meta;
}

export async function createPage(
  sectionId: string,
  title: string,
  content: string | null = null,
  parentId: string | null = null
): Promise<PageMeta> {
  // sub-pages (issue #359): a new subpage's order is scoped to its parent's
  // sibling scope — top-level pages and children of other pages never
  // influence it (the createSection convention, issue #314)
  const all = await db.pages.where("sectionId").equals(sectionId).toArray();
  if (parentId !== null) {
    const parent = all.find((p) => p.id === parentId);
    if (!parent || parent.deletedAt !== null) {
      throw new Error("a subpage's parent must be an alive page of the same section");
    }
  }
  const siblings = all.filter((p) => parentPageOf(p) === parentId);
  const maxOrder = Math.max(0, ...siblings.map((p) => p.order));
  const page: PageRow = {
    id: newId(),
    sectionId,
    // top-level pages carry NO parentId field at all — the pre-#359 row
    // shape (the plain-section kind precedent, issue #337: a conditional
    // spread, not a null, so structured clones keep the old shape)
    ...(parentId ? { parentId } : {}),
    title,
    order: maxOrder + 1,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
    content,
  };
  await db.pages.add(page);
  const { content: _c, ...meta } = page;
  return meta;
}

export async function renamePage(id: string, title: string): Promise<void> {
  await db.pages.update(id, { title, updatedAt: now() });
}

/** Set the paper style of a page (plain / ruled / grid). */
export async function setPageBackground(id: string, background: PageRow["background"]): Promise<void> {
  await db.pages.update(id, { background, updatedAt: now() });
}

/** Replace a page's tag list (caller normalizes via lib/tags). */
export async function setPageTags(id: string, tags: string[]): Promise<void> {
  await db.pages.update(id, { tags, updatedAt: now() });
}

export async function movePage(id: string, dir: -1 | 1): Promise<void> {
  const page = await db.pages.get(id);
  if (!page) return;
  // sub-pages (issue #359): up/down moves within the page's OWN sibling
  // scope (same section, same parent) — the moveSection convention; the
  // visible neighbor one scope away is never touched
  const siblings = (await db.pages.where("sectionId").equals(page.sectionId).toArray())
    .filter((p) => p.deletedAt === null && parentPageOf(p) === parentPageOf(page))
    .sort(byOrder);
  const idx = siblings.findIndex((p) => p.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[target];
  await db.transaction("rw", db.pages, async () => {
    await db.pages.update(a.id, { order: b.order });
    await db.pages.update(b.id, { order: a.order });
  });
}

/** Result of setPageParent (issue #359). */
export type PageMoveResult = "moved" | "noop" | "invalid";

/**
 * Sub-pages (issue #359): re-parent a page — to another page of the same
 * section (demote: OneNote "Make subpage", or one-level promote onto the
 * grandparent) or to the section's top level (target null). The page's
 * whole subtree rides along implicitly: every descendant keeps its own
 * parentId, so the hierarchy below the mover never rewrites.
 *
 * - invalid (zero writes): missing/trashed mover or target, a target in
 *   another section, a self/descendant target, or a OneNote depth-cap
 *   violation for the moved subtree (canMakeSubpage)
 * - noop (zero writes): the page already lives under the target
 * - moved: the mover lands at the END of the target sibling scope
 *   (moveSectionTo's convention); a dangling target-parent id heals to
 *   the top level (the visiblePageTree read-time tolerance, made durable)
 */
export async function setPageParent(
  pageId: string,
  targetParentId: string | null
): Promise<PageMoveResult> {
  const page = await db.pages.get(pageId);
  if (!page || page.deletedAt !== null) return "invalid";
  const siblingsAll = await db.pages
    .where("sectionId")
    .equals(page.sectionId)
    .toArray();
  if (targetParentId !== null) {
    const target = siblingsAll.find((p) => p.id === targetParentId);
    if (!target || target.deletedAt !== null) return "invalid";
    if (!canMakeSubpage(siblingsAll, pageId, targetParentId)) return "invalid";
  }
  if (parentPageOf(page) === targetParentId) return "noop";

  const siblings = siblingsAll.filter(
    (p) => p.deletedAt === null && parentPageOf(p) === targetParentId
  );
  const maxOrder = Math.max(0, ...siblings.map((p) => p.order));
  await db.pages.update(pageId, {
    parentId: targetParentId,
    order: maxOrder + 1,
    updatedAt: now(),
  });
  return "moved";
}

/**
 * Duplicate a page inside its section: fresh row id, title suffixed " (copy)",
 * scene content copied as-is (scenes are self-contained per page — files live
 * inside the content JSON), indent level kept (a subpage's copy stays its
 * parent's child — OneNote duplicates keep the level), order placed last
 * among its OWN sibling scope. Returns the new page meta, or null when the
 * source page is missing or trashed.
 */
export async function duplicatePage(id: string): Promise<PageMeta | null> {
  const page = await db.pages.get(id);
  if (!page || page.deletedAt !== null) return null;
  const all = await db.pages.where("sectionId").equals(page.sectionId).toArray();
  const siblings = all.filter((p) => parentPageOf(p) === parentPageOf(page));
  const maxOrder = Math.max(0, ...siblings.map((p) => p.order));
  const copy: PageRow = {
    ...page,
    id: newId(),
    title: generatedNames().copy(page.title), // localized suffix (issue #63)
    order: maxOrder + 1,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.pages.add(copy);
  const { content: _c, ...meta } = copy;
  return meta;
}

/**
 * Soft-delete a page and cascade the same `deletedAt` timestamp to its
 * alive SUBTREE (issue #359 — the trashSection pattern): a parent page's
 * subpages go to the trash with it, so the family restores as one. Only
 * ALIVE members are stamped, so separately-trashed children keep their
 * own timestamp and are never resurrected by a later restore of the
 * parent. Cycle-safe (the visitor set).
 */
export async function trashPage(id: string): Promise<void> {
  const ts = now();
  await db.transaction("rw", db.pages, async () => {
    const all = await db.pages.toArray();
    for (const pid of subtreePageIds(all, id)) {
      const row = all.find((p) => p.id === pid);
      if (!row || row.deletedAt !== null) continue; // already trashed on its own
      await db.pages.update(pid, {
        deletedAt: ts,
        ...(pid === id ? { updatedAt: ts } : {}),
      });
    }
  });
}

/**
 * Bulk operations for sidebar multi-select (issue #27). Both are
 * transactional, idempotent w.r.t. duplicates, and silently skip rows that
 * are missing or already trashed — a stale checkbox must never corrupt the
 * move/delete of the rest.
 */

/**
 * Move the given pages into a target section, appending them after its
 * existing top-level pages while preserving their sidebar-visible order
 * (notebook → section → page). Sub-pages (issue #359) mirror the
 * moveSectionTo subtree rule: a moved page's WHOLE subtree follows it
 * (descendants keep their own parentId/order — alive and trashed alike,
 * so the hierarchy and the trash stay restorable), and the moved root
 * itself lands at the target's TOP level (parentId cleared). A selected
 * page whose parent row is also being moved simply rides along — it is
 * never ripped out of the moving subtree. Pages already in the target
 * (and trashed/unknown ids) are skipped. Returns how many pages actually
 * moved (roots only); 0 also when the target section is missing, trashed,
 * or a section group (groups hold no pages, issue #337).
 */
export async function movePagesToSection(
  pageIds: readonly string[],
  targetSectionId: string
): Promise<number> {
  const target = await db.sections.get(targetSectionId);
  if (!target || target.deletedAt !== null) return 0;
  // section groups hold no pages (issue #337, OneNote semantics: groups
  // keep sections together, sections hold pages) — the dialog omits them,
  // the data layer answers 0 with zero writes
  if (isSectionGroup(target)) return 0;
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return 0;

  // `order` is a sibling index within one parent scope, so the batch's
  // visible order must be derived from the whole tree (read outside the
  // write tx)
  const [allSections, allNotebooks] = await Promise.all([
    db.sections.toArray(),
    db.notebooks.toArray(),
  ]);
  const sectionById = new Map(allSections.map((s) => [s.id, s]));
  const notebookOrder = new Map(allNotebooks.map((n) => [n.id, n.order]));
  const treeKey = (p: PageRow): [number, number, number] => {
    const sec = sectionById.get(p.sectionId);
    return [sec ? (notebookOrder.get(sec.notebookId) ?? 0) : 0, sec?.order ?? 0, p.order];
  };
  const byTreeKey = (a: PageRow, b: PageRow) => {
    const ka = treeKey(a);
    const kb = treeKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || byOrder(a, b);
  };

  let moved = 0;
  await db.transaction("rw", db.pages, async () => {
    const allRows = await db.pages.toArray();
    const selected = new Set(ids);
    const movers = allRows.filter(
      (p) =>
        selected.has(p.id) &&
        p.deletedAt === null &&
        p.sectionId !== targetSectionId &&
        // a page whose parent row is also moving rides along — the root
        // write would rip it out of the moving subtree
        !(
          parentPageOf(p) !== null &&
          allRows.some(
            (m) =>
              m.id === parentPageOf(p) &&
              selected.has(m.id) &&
              m.deletedAt === null &&
              m.sectionId !== targetSectionId
          )
        )
    );
    if (movers.length === 0) return;
    // every mover's whole RAW subtree follows (moveSectionTo's rule): alive
    // AND trashed descendants carry over with deletedAt stamps untouched, so
    // the family stays together and restorable in its new section — the raw
    // walk reaches through separately-trashed intermediates (the
    // subtreeSectionIds contract; callers filter by deletedAt as needed)
    const followers = new Set<string>();
    for (const m of movers) {
      for (const sid of subtreePageIds(allRows, m.id)) {
        if (sid !== m.id) followers.add(sid);
      }
    }
    const topSiblings = await db.pages
      .where("sectionId")
      .equals(targetSectionId)
      .toArray()
      .then((rows) => rows.filter((p) => parentPageOf(p) === null));
    const maxOrder = Math.max(0, ...topSiblings.map((p) => p.order));
    movers.sort(byTreeKey);
    for (const [i, p] of movers.entries()) {
      await db.pages.update(p.id, {
        sectionId: targetSectionId,
        parentId: null,
        order: maxOrder + 1 + i,
        updatedAt: now(),
      });
    }
    for (const sid of followers) {
      await db.pages.update(sid, { sectionId: targetSectionId, updatedAt: now() });
    }
    moved = movers.length;
  });
  return moved;
}

/**
 * Soft-delete many pages with one shared timestamp (single undo epoch, each
 * row individually restorable). Each selected page's alive subtree cascades
 * with it (issue #359), so a batch that selects a parent and a child still
 * stamps every affected row once. Returns how many rows were trashed.
 */
export async function trashPages(pageIds: readonly string[]): Promise<number> {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return 0;
  const ts = now();
  let trashed = 0;
  await db.transaction("rw", db.pages, async () => {
    const all = await db.pages.toArray();
    const cascade = new Set<string>();
    for (const id of ids) {
      for (const pid of subtreePageIds(all, id)) cascade.add(pid);
    }
    for (const pid of cascade) {
      const row = all.find((p) => p.id === pid);
      if (!row || row.deletedAt !== null) continue;
      await db.pages.update(pid, {
        deletedAt: ts,
        updatedAt: ids.includes(pid) ? ts : row.updatedAt,
      });
      trashed += 1;
    }
  });
  return trashed;
}

export async function restorePage(id: string): Promise<void> {
  const page = await db.pages.get(id);
  if (!page?.deletedAt) return;
  const ts = page.deletedAt;
  await db.transaction("rw", [db.pages, db.sections, db.notebooks], async () => {
    // subtree members trashed together with the restored page (same ts)
    // come back with it (issue #359 — the restoreSection pattern);
    // separately-trashed children keep their own timestamp and stay put
    const all = await db.pages.toArray();
    for (const pid of subtreePageIds(all, id)) {
      const row = all.find((p) => p.id === pid);
      if (row && row.deletedAt === ts) await db.pages.update(pid, { deletedAt: null });
    }
    // trashed ANCESTOR pages come back too (OneNote-like: the family
    // restores, restoreSection's ancestor resurrection one level up)
    const byId = new Map(all.map((p) => [p.id, p] as const));
    let cur = parentPageOf(page);
    const seenAncestors = new Set<string>([id]);
    while (cur !== null && !seenAncestors.has(cur)) {
      const row = byId.get(cur);
      if (!row) break; // dangling parent id — the chain ends here
      if (row.deletedAt !== null) await db.pages.update(cur, { deletedAt: null });
      seenAncestors.add(cur);
      cur = parentPageOf(row);
    }
    await db.pages.update(id, { updatedAt: now() });
    // bring back section/notebook ancestors so the page is reachable
    // (OneNote-like)
    const sec = await db.sections.get(page.sectionId);
    if (sec?.deletedAt) {
      await db.sections.update(sec.id, { deletedAt: null });
      const nb = await db.notebooks.get(sec.notebookId);
      if (nb?.deletedAt) await db.notebooks.update(nb.id, { deletedAt: null });
    }
  });
}

export async function purgePage(id: string): Promise<void> {
  await db.transaction("rw", [db.pages, db.tombstones, db.pageVersions], async () => {
    // the whole subtree dies (issue #359 — the purgeSection pattern): every
    // descendant page, its version snapshots, one tombstone per row
    const all = await db.pages.toArray();
    for (const pid of subtreePageIds(all, id)) {
      const page = all.find((p) => p.id === pid);
      if (!page) continue;
      await db.tombstones.put({ id: page.id, kind: "page", at: now(), title: page.title });
      await db.pageVersions.where("pageId").equals(pid).delete();
      await db.pages.delete(pid);
    }
  });
}

/* ------------------------------------------------------------------ */
/* page content (Excalidraw scenes)                                    */
/* ------------------------------------------------------------------ */

export async function getPageContent(id: string): Promise<ScenePayload | null> {
  const page = await db.pages.get(id);
  if (!page?.content) return null;
  try {
    return JSON.parse(page.content) as ScenePayload;
  } catch {
    return null;
  }
}

export async function savePageContent(id: string, payload: ScenePayload): Promise<void> {
  const updated = await db.pages.update(id, {
    content: JSON.stringify(payload),
    updatedAt: now(),
  });
  // Dexie's update() is a silent no-op when the key is missing (issue #78):
  // the page row can vanish under an open canvas (purged in another tab, or
  // removed by a sync round). Reporting success then would be a lie — throw
  // so the autosave indicator shows the error instead of "Saved".
  if (updated === 0) {
    throw new Error(`savePageContent: page row "${id}" no longer exists`);
  }
}

/* ------------------------------------------------------------------ */
/* page version history (v3, docs/test-plans/version-history.md)        */
/* ------------------------------------------------------------------ */

/** Record one version of a page's scene and prune the per-page budget. */
export async function recordPageVersion(
  pageId: string,
  payload: ScenePayload,
  source: PageVersionSource,
  at: number = now(),
): Promise<PageVersionSummary> {
  const row = buildPageVersion(pageId, payload, source, at);
  await db.transaction("rw", db.pageVersions, async () => {
    await db.pageVersions.add(row);
    const all = await db.pageVersions.where("pageId").equals(pageId).toArray();
    const doomed = pruneToCapacity(all);
    if (doomed.length > 0) await db.pageVersions.bulkDelete(doomed);
  });
  const { content: _content, ...summary } = row;
  return summary;
}

/** A page's versions, newest first — summaries only (content stays in the DB). */
export async function listPageVersions(pageId: string): Promise<PageVersionSummary[]> {
  const rows = await db.pageVersions.where("pageId").equals(pageId).toArray();
  return sortVersionsNewestFirst(rows).map(({ content: _content, ...summary }) => summary);
}

/** The newest full version row of a page (content included), or null. */
async function lastPageVersionRow(pageId: string): Promise<PageVersionRow | null> {
  const rows = await db.pageVersions.where("pageId").equals(pageId).toArray();
  return sortVersionsNewestFirst(rows)[0] ?? null;
}

/**
 * The autosave hook: record an AUTO version when the policy says so
 * (≥ 5 min since the newest version AND the structure really changed).
 * Returns whether a version was recorded. Callers treat failures as
 * non-fatal — a failed snapshot must never fail the save itself.
 */
export async function maybeRecordAutoVersion(
  pageId: string,
  payload: ScenePayload,
): Promise<boolean> {
  const last = await lastPageVersionRow(pageId);
  if (!shouldAutoSnapshot(last, payload, Date.now())) return false;
  await recordPageVersion(pageId, payload, "auto");
  return true;
}

/**
 * The scene a stored version holds, validated against the requesting page:
 * null when the version is missing, belongs to another page, or its content
 * no longer parses (corrupt rows restore nothing rather than garbage).
 */
export async function getPageVersionContent(
  pageId: string,
  versionId: string,
): Promise<ScenePayload | null> {
  const row = await db.pageVersions.get(versionId);
  if (!row || row.pageId !== pageId) return null;
  try {
    return JSON.parse(row.content) as ScenePayload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* page templates (v4, issue #279 — OneNote page templates parity)      */
/* ------------------------------------------------------------------ */

/**
 * Save a scene payload as a reusable template. Validates the name and
 * enforces the attachment-size cap (a template's payload duplicates on
 * every page created from it — the same rationale as the attachment cap).
 * Throws TemplateError (typed) so the UI maps the code to an explicit toast.
 */
export async function saveTemplate(
  rawName: string,
  payload: ScenePayload,
  background?: PageRow["background"],
): Promise<TemplateSummary> {
  const name = validateTemplateName(rawName);
  const row = buildTemplateRow(name, payload, background, now());
  if (row.byteSize > MAX_TEMPLATE_BYTES) throw new TemplateError("too-large");
  await db.templates.add(row);
  const { content: _content, ...summary } = row;
  return summary;
}

/** All templates in picker order — summaries only (content stays in the DB). */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const rows = await db.templates.toArray();
  return sortTemplatesForPicker(rows).map(({ content: _content, ...summary }) => summary);
}

/** Full row of one template (content included), or null. */
export async function getTemplateRow(id: string): Promise<TemplateRow | null> {
  const row = await db.templates.get(id);
  return row ?? null;
}

/**
 * The scene a stored template holds. Corrupt rows (bad JSON, wrong shape)
 * restore nothing rather than garbage — null means "skip", never "crash".
 */
export async function getTemplateContent(id: string): Promise<ScenePayload | null> {
  const row = await db.templates.get(id);
  if (!row) return null;
  return parseTemplateContent(row.content);
}

/**
 * Hard-delete a template. Templates have no trash: they are labels plus
 * scenes, not pages — pages already created from a template are untouched.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}

/* ------------------------------------------------------------------ */
/* trash listing                                                       */
/* ------------------------------------------------------------------ */

export interface TrashSnapshot {
  notebooks: Notebook[];
  sections: Section[];
  pages: PageRow[];
}

export async function listTrash(): Promise<TrashSnapshot> {
  const [notebooks, sections, pages] = await Promise.all([
    db.notebooks.toArray(),
    db.sections.toArray(),
    db.pages.toArray(),
  ]);
  return {
    notebooks: notebooks.filter((n) => n.deletedAt !== null).sort((a, b) => b.deletedAt! - a.deletedAt!),
    sections: sections.filter((s) => s.deletedAt !== null).sort((a, b) => b.deletedAt! - a.deletedAt!),
    pages: pages
      .filter((p) => p.deletedAt !== null)
      .map(({ content: _c, ...meta }) => meta)
      .sort((a, b) => b.deletedAt! - a.deletedAt!),
  };
}

/* ------------------------------------------------------------------ */
/* destructive reset (settings)                                        */
/* ------------------------------------------------------------------ */

/**
 * Hard reset (settings + E2E seed). Also drops tombstones and sync state so
 * the device is a clean slate: a stale sync folder can be re-imported fresh
 * instead of being blocked by tombstones for rows the user just erased.
 */
export async function eraseAllData(): Promise<void> {
  await db.transaction("rw", [db.notebooks, db.sections, db.pages, db.tombstones, db.syncMeta, db.pageVersions, db.templates], async () => {
    await db.notebooks.clear();
    await db.sections.clear();
    await db.pages.clear();
    await db.tombstones.clear();
    await db.syncMeta.clear();
    await db.pageVersions.clear();
    await db.templates.clear();
  });
}

/* ------------------------------------------------------------------ */
/* backup / restore (whole-library archive)                            */
/* ------------------------------------------------------------------ */

export async function buildBackup(): Promise<string> {
  const [notebooks, sections, pages, templates] = await Promise.all([
    db.notebooks.toArray(),
    db.sections.toArray(),
    db.pages.toArray(),
    db.templates.toArray(),
  ]);
  const sorted = <T extends { order: number; createdAt: number; id: string }>(arr: T[]) =>
    [...arr].sort(byOrder);
  const backup = {
    app: "infinitenote" as const,
    version: 1 as const,
    exportedAt: now(),
    notebooks: sorted(notebooks)
      .filter((n) => n.deletedAt === null)
      .map((n) => ({
        ...n,
        sections: sorted(sections)
          .filter((s) => s.notebookId === n.id && s.deletedAt === null)
          .map((s) => ({
            ...s,
            pages: sorted(pages)
              .filter((p) => p.sectionId === s.id && p.deletedAt === null)
              .map((p) => ({ ...p })),
          })),
      })),
    // templates ride in backups (issue #279) — they are the user's
    // reusable content, unlike pageVersions (page-scoped machinery)
    templates: sortTemplatesForPicker(templates).map((t) => ({
      name: t.name,
      createdAt: t.createdAt,
      elementCount: t.elementCount,
      byteSize: t.byteSize,
      background: t.background,
      content: t.content,
    })),
  };
  return JSON.stringify(backup, null, 2);
}

/* ------------------------------------------------------------------ */
/* sync state (v1.5 file-based sync, phase 1)                           */
/* ------------------------------------------------------------------ */

/** All purge tombstones recorded on this device (for trash.jsonl export). */
export async function listPurgeTombstones(): Promise<TombstoneRow[]> {
  return db.tombstones.toArray();
}

export const LAST_SYNC_KEY = "lastSyncManifest";

/** The manifest as of this device's last successful sync (null = never). */
export async function readLastSyncManifest(): Promise<unknown> {
  const row = await db.syncMeta.get(LAST_SYNC_KEY);
  return row?.value ?? null;
}

export async function writeLastSyncManifest(manifest: unknown): Promise<void> {
  await db.syncMeta.put({ key: LAST_SYNC_KEY, value: manifest });
}

export async function clearSyncState(): Promise<void> {
  await db.syncMeta.clear();
}

/**
 * Import a backup archive as NEW records (fresh ids) so it never collides
 * with or overwrites existing data. Returns count of restored pages.
 */
export async function restoreBackup(json: string): Promise<number> {
  const parsed = JSON.parse(json) as {
    app?: string;
    notebooks?: Array<{
      name?: string;
      color?: Notebook["color"];
      sections?: Array<{
        id?: string;
        parentId?: string | null;
        color?: NotebookColor;
        kind?: unknown;
        name?: string;
        pages?: Array<{
        id?: string;
        parentId?: string | null;
        title?: string;
        content?: string | null;
        background?: PageRow["background"];
        tags?: string[];
      }>;
      }>;
    }>;
    templates?: Array<{
      name?: string;
      content?: string | null;
      background?: PageRow["background"];
    }>;
  };
  if (parsed?.app !== "infinitenote" || !Array.isArray(parsed.notebooks)) {
    throw new RestoreError("Not an InfiniteNote backup file");
  }
  let pageCount = 0;
  const ts = now();
  await db.transaction("rw", [db.notebooks, db.sections, db.pages, db.templates], async () => {
    const notebooks = await db.notebooks.toArray();
    let maxOrder = Math.max(0, ...notebooks.map((n) => n.order));
    for (const nb of parsed.notebooks!) {
      const nbId = newId();
      maxOrder += 1;
      await db.notebooks.add({
        id: nbId,
        name: nb.name?.trim() || generatedNames().restoredNotebook,
        color: nb.color ?? "violet",
        order: maxOrder,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      });
      let secOrder = 0;
      // phase 1 — create every section as a fresh row and remember which
      // ORIGINAL archive id it came from, so nesting (issue #314) can be
      // re-attached in phase 2 with the new ids
      const sectionIdMap = new Map<string, string>();
      const createdSections: Array<{
        newId: string;
        oldId: string | null;
        oldParentId: string | null;
      }> = [];
      for (const sec of nb.sections ?? []) {
        const secId = newId();
        secOrder += 1;
        await db.sections.add({
          id: secId,
          notebookId: nbId,
          name: sec.name?.trim() || generatedNames().restoredSection,
          // an off-palette archive color restores as inherit, not a crash
          // (the safeTags contract, issue #319)
          color: safeSectionColor(sec.color) ?? undefined,
          // a hand-edited archive kind restores as a plain section, not a
          // crash (the same tolerance contract, issue #337)
          kind: normalizeSectionKind(sec.kind) ?? undefined,
          order: secOrder,
          createdAt: ts,
          updatedAt: ts,
          deletedAt: null,
        });
        createdSections.push({
          newId: secId,
          oldId: typeof sec.id === "string" ? sec.id : null,
          oldParentId: typeof sec.parentId === "string" ? sec.parentId : null,
        });
        if (typeof sec.id === "string") sectionIdMap.set(sec.id, secId);
      }
      // phase 2 — re-attach parents: only within the same notebook and only
      // when the archive row exists; anything else restores as top level
      for (const row of createdSections) {
        if (!row.oldParentId) continue;
        const mapped = sectionIdMap.get(row.oldParentId);
        if (mapped) {
          await db.sections.update(row.newId, { parentId: mapped, updatedAt: ts });
        }
      }
      // phase 3 — pages, index-aligned with the section creation order;
      // sub-pages (issue #359) restore through the same two-phase re-attach
      // the sections use: fresh ids first, original archive parent ids
      // remembered, re-attached in phase 4 — anything dangling (parent row
      // missing, or pointing outside its own section) restores as top level
      let sectionIndex = 0;
      for (const sec of nb.sections ?? []) {
        const secId = createdSections[sectionIndex]?.newId;
        sectionIndex += 1;
        let pageOrder = 0;
        const createdPages: Array<{ newId: string; oldParentId: string | null }> = [];
        for (const page of sec.pages ?? []) {
          pageOrder += 1;
          pageCount += 1;
          // tags/content are hand-editable backup fields: a "tags": "work"
          // string or a non-string "content" must restore as absent rather
          // than crash the sidebar/search later (same contract as
          // parseSyncFolder on the sync side).
          const tags = safeTags(page.tags);
          const rowId = newId();
          await db.pages.add({
            id: rowId,
            sectionId: secId,
            title: page.title?.trim() || generatedNames().restoredPage,
            order: pageOrder,
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
            content: typeof page.content === "string" ? page.content : null,
            background: page.background,
            tags: tags.length ? tags : undefined,
          });
          createdPages.push({
            newId: rowId,
            oldParentId: typeof page.parentId === "string" ? page.parentId : null,
          });
        }
        // phase 4 — re-attach page parents within the same section: only
        // when the archive parent id maps to a page created from THIS
        // section's archive rows; anything else restores as top level
        const pageIdMap = new Map<string, string>();
        const archivePages = sec.pages ?? [];
        createdPages.forEach((row, i) => {
          const oldId = archivePages[i]?.id;
          if (typeof oldId === "string") pageIdMap.set(oldId, row.newId);
        });
        for (const row of createdPages) {
          if (!row.oldParentId) continue;
          const mapped = pageIdMap.get(row.oldParentId);
          if (mapped) {
            await db.pages.update(row.newId, { parentId: mapped, updatedAt: ts });
          }
        }
      }
    }
    // templates ride in backups (issue #279). Same tolerance contract as
    // pages: corrupt scenes, missing names and oversize payloads skip
    // silently rather than crash the restore — a backup restores as much
    // as it honestly can.
    for (const tpl of parsed.templates ?? []) {
      if (typeof tpl !== "object" || tpl === null) continue;
      if (typeof tpl.content !== "string") continue;
      const payload = parseTemplateContent(tpl.content);
      if (!payload) continue;
      const row = buildTemplateRow(
        typeof tpl.name === "string" && tpl.name.trim() ? tpl.name.trim() : RESTORED_TEMPLATE_NAME,
        payload,
        tpl.background,
        ts,
      );
      if (row.byteSize > MAX_TEMPLATE_BYTES) continue;
      await db.templates.add(row);
    }
  });
  return pageCount;
}
