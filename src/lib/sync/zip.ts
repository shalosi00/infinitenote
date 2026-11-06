/**
 * Sync-folder ZIP adapter — the universal transport (issue #37).
 *
 * Every browser can download a ZIP and pick one to merge, so the sync folder
 * works on Firefox/Android too; on Chromium desktop the File System Access
 * adapter (fsa.ts) writes the same layout to a real folder instead.
 *
 * fflate is imported on demand — the main bundle stays untouched (same
 * pattern as jsPDF in pdf-export.ts).
 */

import type { SyncFolderFiles } from "./format";

/** Pack the folder file map into a downloadable ZIP blob. */
export async function zipSyncFolder(files: SyncFolderFiles): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const data: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) {
    data[path] = strToU8(text);
  }
  const zipped = zipSync(data, { level: 6 });
  return new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
}

/** Unpack a sync ZIP back into the folder file map (UTF-8 text per file). */
export async function parseSyncZip(input: ArrayBuffer | Uint8Array): Promise<SyncFolderFiles> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const unzipped = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input));
  const files: SyncFolderFiles = {};
  for (const [path, bytes] of Object.entries(unzipped)) {
    if (path.endsWith("/")) continue; // directory entries
    files[path] = strFromU8(bytes);
  }
  return files;
}
