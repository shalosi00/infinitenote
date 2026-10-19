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
 */
import Dexie, { type Table } from "dexie";
import { byOrder } from "./types";
import type { Notebook, PageMeta, PageRow, ScenePayload, Section } from "./types";

export class InfiniteNoteDB extends Dexie {
  notebooks!: Table<Notebook, string>;
  sections!: Table<Section, string>;
  pages!: Table<PageRow, string>;

  constructor() {
    super("infinitenote");
    this.version(1).stores({
      notebooks: "id, order, deletedAt",
      sections: "id, notebookId, order, deletedAt",
      pages: "id, sectionId, order, deletedAt, [sectionId+deletedAt]",
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
  await db.transaction("rw", [db.notebooks, db.sections, db.pages], async () => {
    const sections = await db.sections.where("notebookId").equals(id).toArray();
    for (const s of sections) {
      await db.pages.where("sectionId").equals(s.id).delete();
      await db.sections.delete(s.id);
    }
    await db.notebooks.delete(id);
  });
}

/* ------------------------------------------------------------------ */
/* sections                                                            */
/* ------------------------------------------------------------------ */

export async function listSections(): Promise<Section[]> {
  return alive(await db.sections.toArray());
}

export async function createSection(notebookId: string, name: string): Promise<Section> {
  const siblings = await db.sections.where("notebookId").equals(notebookId).toArray();
  const maxOrder = Math.max(0, ...siblings.map((s) => s.order));
  const sec: Section = {
    id: newId(),
    notebookId,
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

export async function moveSection(id: string, dir: -1 | 1): Promise<void> {
  const sec = await db.sections.get(id);
  if (!sec) return;
  const siblings = (await db.sections.where("notebookId").equals(sec.notebookId).toArray())
    .filter((s) => s.deletedAt === null)
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

export async function trashSection(id: string): Promise<void> {
  const ts = now();
  await db.transaction("rw", [db.sections, db.pages], async () => {
    await db.sections.update(id, { deletedAt: ts, updatedAt: ts });
    const pages = await db.pages.where("sectionId").equals(id).toArray();
    for (const p of pages) {
      if (p.deletedAt !== null) continue; // already trashed on its own
      await db.pages.update(p.id, { deletedAt: ts });
    }
  });
}

export async function restoreSection(id: string): Promise<void> {
  const sec = await db.sections.get(id);
  if (!sec?.deletedAt) return;
  const ts = sec.deletedAt;
  await db.transaction("rw", [db.sections, db.pages, db.notebooks], async () => {
    await db.sections.update(id, { deletedAt: null, updatedAt: now() });
    const nb = await db.notebooks.get(sec.notebookId);
    // if parent notebook is still trashed, bring it back too (OneNote-like)
    if (nb?.deletedAt) await db.notebooks.update(nb.id, { deletedAt: null });
    const pages = await db.pages.where("sectionId").equals(id).toArray();
    for (const p of pages) if (p.deletedAt === ts) await db.pages.update(p.id, { deletedAt: null });
  });
}

export async function purgeSection(id: string): Promise<void> {
  await db.transaction("rw", [db.sections, db.pages], async () => {
    await db.pages.where("sectionId").equals(id).delete();
    await db.sections.delete(id);
  });
}

/* ------------------------------------------------------------------ */
/* pages                                                               */
/* ------------------------------------------------------------------ */

export async function listPages(): Promise<PageMeta[]> {
  return alive(await db.pages.toArray()).map(({ content: _content, ...meta }) => meta);
}

export async function createPage(
  sectionId: string,
  title: string,
  content: string | null = null
): Promise<PageMeta> {
  const siblings = await db.pages.where("sectionId").equals(sectionId).toArray();
  const maxOrder = Math.max(0, ...siblings.map((p) => p.order));
  const page: PageRow = {
    id: newId(),
    sectionId,
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

export async function movePage(id: string, dir: -1 | 1): Promise<void> {
  const page = await db.pages.get(id);
  if (!page) return;
  const siblings = (await db.pages.where("sectionId").equals(page.sectionId).toArray())
    .filter((p) => p.deletedAt === null)
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

export async function trashPage(id: string): Promise<void> {
  await db.pages.update(id, { deletedAt: now(), updatedAt: now() });
}

export async function restorePage(id: string): Promise<void> {
  const page = await db.pages.get(id);
  if (!page?.deletedAt) return;
  await db.transaction("rw", [db.pages, db.sections, db.notebooks], async () => {
    await db.pages.update(id, { deletedAt: null, updatedAt: now() });
    // bring back ancestors so the page is reachable (OneNote-like)
    const sec = await db.sections.get(page.sectionId);
    if (sec?.deletedAt) {
      await db.sections.update(sec.id, { deletedAt: null });
      const nb = await db.notebooks.get(sec.notebookId);
      if (nb?.deletedAt) await db.notebooks.update(nb.id, { deletedAt: null });
    }
  });
}

export async function purgePage(id: string): Promise<void> {
  await db.pages.delete(id);
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
  await db.pages.update(id, { content: JSON.stringify(payload), updatedAt: now() });
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

export async function eraseAllData(): Promise<void> {
  await db.transaction("rw", [db.notebooks, db.sections, db.pages], async () => {
    await db.notebooks.clear();
    await db.sections.clear();
    await db.pages.clear();
  });
}

/* ------------------------------------------------------------------ */
/* backup / restore (whole-library archive)                            */
/* ------------------------------------------------------------------ */

export async function buildBackup(): Promise<string> {
  const [notebooks, sections, pages] = await Promise.all([
    db.notebooks.toArray(),
    db.sections.toArray(),
    db.pages.toArray(),
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
  };
  return JSON.stringify(backup, null, 2);
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
        name?: string;
        pages?: Array<{ title?: string; content?: string | null }>;
      }>;
    }>;
  };
  if (parsed?.app !== "infinitenote" || !Array.isArray(parsed.notebooks)) {
    throw new Error("Not an InfiniteNote backup file");
  }
  let pageCount = 0;
  const ts = now();
  await db.transaction("rw", [db.notebooks, db.sections, db.pages], async () => {
    const notebooks = await db.notebooks.toArray();
    let maxOrder = Math.max(0, ...notebooks.map((n) => n.order));
    for (const nb of parsed.notebooks!) {
      const nbId = newId();
      maxOrder += 1;
      await db.notebooks.add({
        id: nbId,
        name: nb.name?.trim() || "Restored notebook",
        color: nb.color ?? "violet",
        order: maxOrder,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      });
      let secOrder = 0;
      for (const sec of nb.sections ?? []) {
        const secId = newId();
        secOrder += 1;
        await db.sections.add({
          id: secId,
          notebookId: nbId,
          name: sec.name?.trim() || "Restored section",
          order: secOrder,
          createdAt: ts,
          updatedAt: ts,
          deletedAt: null,
        });
        let pageOrder = 0;
        for (const page of sec.pages ?? []) {
          pageOrder += 1;
          pageCount += 1;
          await db.pages.add({
            id: newId(),
            sectionId: secId,
            title: page.title?.trim() || "Restored page",
            order: pageOrder,
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
            content: page.content ?? null,
          });
        }
      }
    }
  });
  return pageCount;
}
