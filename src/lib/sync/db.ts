/**
 * Sync I/O layer — bridges the pure engine (format.ts / merge.ts) and Dexie.
 *
 * `runSync` is the whole phase-1 round trip used by every adapter (sync
 * folder via File System Access, sync ZIP download/upload):
 *
 *   read local DB → parse folder → compute plan → apply plan to DB
 *   → rebuild the folder from the post-merge DB → remember it as `base`
 *
 * The returned folder files are what the adapter writes back, so the folder
 * always ends up holding exactly the merged state — the other device's next
 * sync becomes a fast-forward.
 */

import {
  db,
  listPurgeTombstones,
  readLastSyncManifest,
  writeLastSyncManifest,
} from "../notes-db";
import type { Notebook, PageRow, Section } from "../types";
import type { Table } from "dexie";
import {
  buildSyncFolderFiles,
  parseSyncFolder,
  type LibrarySnapshot,
  type SyncFolderFiles,
  type SyncManifest,
  type TrashEntry,
} from "./format";
import { computeSyncPlan, type SyncPlan, type SyncSummary } from "./merge";

/** This device's full state — every row incl. trashed, with content. */
export async function readLocalSnapshot(): Promise<LibrarySnapshot> {
  const [notebooks, sections, pages] = await Promise.all([
    db.notebooks.toArray(),
    db.sections.toArray(),
    db.pages.toArray(),
  ]);
  return { notebooks, sections, pages };
}

function isSyncManifest(v: unknown): v is SyncManifest {
  const m = v as SyncManifest | null;
  return (
    !!m &&
    m.app === "infinitenote" &&
    m.format === "sync-folder" &&
    m.version === 1 &&
    Array.isArray(m.notebooks) &&
    Array.isArray(m.sections) &&
    Array.isArray(m.pages)
  );
}

/** Rows equal on every persisted field (key order differs between sources). */
function rowsEqual<T extends { id: string }>(a: T | undefined, b: T | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a as Record<string, unknown>)[k] ?? null;
    const bv = (b as Record<string, unknown>)[k] ?? null;
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) return false;
  }
  return true;
}

/**
 * Apply a computed plan to the DB in one transaction: upsert changed rows,
 * hard-delete rows the plan dropped (purges), persist remote purge
 * tombstones (so they keep protecting future syncs), and remember the merged
 * manifest as the next sync's base. Returns what actually changed.
 */
export async function applySyncPlan(plan: SyncPlan): Promise<SyncSummary> {
  const summary: SyncSummary = {
    notebooksAdded: 0,
    sectionsAdded: 0,
    pagesAdded: 0,
    pagesUpdated: 0,
    treeUpdated: 0,
    pagesConflicted: plan.summary.pagesConflicted, // merge-level fact, not a DB diff
    pagesDeleted: 0,
    treeDeleted: 0,
    pagesPurged: 0,
    treePurged: 0,
  };
  await db.transaction(
    "rw",
    [db.notebooks, db.sections, db.pages, db.tombstones, db.syncMeta],
    async () => {
      const apply = async <T extends { id: string; deletedAt: number | null }>(
        table: Table<T, string>,
        merged: T[],
        onAdd: () => void,
        onUpdate: () => void,
        onDelete: () => void,
        onPurge: () => void
      ) => {
        const current = await table.toArray();
        const currentById = new Map(current.map((r) => [r.id, r]));
        const mergedIds = new Set(merged.map((r) => r.id));
        for (const row of merged) {
          const prev = currentById.get(row.id);
          if (!prev) {
            if (row.deletedAt === null) onAdd();
            else onDelete();
            await table.put(row);
          } else if (!rowsEqual(prev, row)) {
            if (prev.deletedAt === null && row.deletedAt !== null) onDelete();
            else onUpdate();
            await table.put(row);
          }
        }
        for (const r of current) {
          if (!mergedIds.has(r.id)) {
            onPurge();
            await table.delete(r.id);
          }
        }
      };
      await apply(
        db.notebooks,
        plan.notebooks,
        () => (summary.notebooksAdded += 1),
        () => (summary.treeUpdated += 1),
        () => (summary.treeDeleted += 1),
        () => (summary.treePurged += 1)
      );
      await apply(
        db.sections,
        plan.sections,
        () => (summary.sectionsAdded += 1),
        () => (summary.treeUpdated += 1),
        () => (summary.treeDeleted += 1),
        () => (summary.treePurged += 1)
      );
      await apply(
        db.pages,
        plan.pages,
        () => (summary.pagesAdded += 1),
        () => (summary.pagesUpdated += 1),
        () => (summary.pagesDeleted += 1),
        () => (summary.pagesPurged += 1)
      );

      // Remote purge tombstones must survive until the next export.
      for (const e of plan.trashLog) {
        if (!e.purged) continue;
        const prev = await db.tombstones.get(e.id);
        if (!prev || prev.at < e.at) {
          await db.tombstones.put({ id: e.id, kind: e.kind, at: e.at, title: e.title });
        }
      }
      await writeLastSyncManifest(plan.manifest);
    }
  );
  return summary;
}

export interface SyncResult {
  summary: SyncSummary;
  /** the merged library as folder files — write back via the adapter */
  folder: SyncFolderFiles;
}

/** One full phase-1 sync against the given folder contents. */
export async function runSync(
  folderFiles: SyncFolderFiles,
  exportedAt: number = Date.now()
): Promise<SyncResult> {
  const parsed = parseSyncFolder(folderFiles);
  const baseRaw = await readLastSyncManifest();
  const base = isSyncManifest(baseRaw) ? baseRaw : null;
  const local = await readLocalSnapshot();
  const purges = await listPurgeTombstones();

  const remote: LibrarySnapshot = {
    notebooks: parsed.manifest.notebooks.map((n) => ({ ...n, deletedAt: null })),
    sections: parsed.manifest.sections.map((s) => ({ ...s, deletedAt: null })),
    pages: [...parsed.pages.values()],
  };

  const plan = computeSyncPlan(
    {
      local,
      localPurges: purges.map((t) => ({ ...t, purged: true })),
      remote,
      remoteTrash: [...parsed.trash.values()],
      base,
    },
    { now: exportedAt }
  );
  const summary = await applySyncPlan(plan);

  // Rebuild the folder from the post-merge DB (single source of truth).
  const merged = await readLocalSnapshot();
  const mergedPurges = await listPurgeTombstones();
  const folder = buildSyncFolderFiles(
    merged,
    mergedPurges.map((t) => ({ ...t, purged: true })),
    exportedAt
  );
  return { summary, folder };
}
