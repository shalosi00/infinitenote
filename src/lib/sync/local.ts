/**
 * Local-device sync state + export (issue #37).
 *
 * Split from db.ts so the browser-only pieces (folder-handle persistence)
 * stay separate from the engine orchestration. All state lives in the
 * `syncMeta` table: the last-synced manifest (the merge base) and — where
 * supported — the connected File System Access folder handle.
 */

import { db, listPurgeTombstones, writeLastSyncManifest } from "../notes-db";
import { buildManifest, buildSyncFolderFiles, type SyncFolderFiles } from "./format";
import type { FsaDirectoryHandle } from "./fsa";

export const SYNC_FOLDER_KEY = "syncFolderHandle";

/**
 * Snapshot the current library as a fresh sync folder WITHOUT merging, and
 * remember it as the sync base — exporting to carry your notes to another
 * device is a legit sync point. (Re-importing the very same ZIP right after
 * is a no-op; local edits made since win the next merge.)
 */
export async function exportSyncFolder(): Promise<SyncFolderFiles> {
  const exportedAt = Date.now();
  const [notebooks, sections, pages] = await Promise.all([
    db.notebooks.toArray(),
    db.sections.toArray(),
    db.pages.toArray(),
  ]);
  const purges = await listPurgeTombstones();
  const manifest = buildManifest({ notebooks, sections, pages }, exportedAt);
  await writeLastSyncManifest(manifest);
  return buildSyncFolderFiles(
    { notebooks, sections, pages },
    purges.map((t) => ({ ...t, purged: true })),
    exportedAt
  );
}

/** Persist the connected folder handle (structured-cloneable in Chromium). */
export async function saveSyncFolderHandle(handle: FsaDirectoryHandle): Promise<void> {
  await db.syncMeta.put({ key: SYNC_FOLDER_KEY, value: handle });
}

/** The previously connected folder handle, or null when none/unsupported. */
export async function loadSyncFolderHandle(): Promise<FsaDirectoryHandle | null> {
  const row = await db.syncMeta.get(SYNC_FOLDER_KEY);
  return (row?.value as FsaDirectoryHandle | undefined) ?? null;
}

export async function clearSyncFolderHandle(): Promise<void> {
  await db.syncMeta.delete(SYNC_FOLDER_KEY);
}
