/**
 * File System Access adapter for the sync folder (issue #37, Chromium
 * desktop). The same folder layout as the ZIP adapter, but written to a real
 * directory that Syncthing/Nextcloud/Dropbox can replicate.
 *
 * Everything is feature-detected and null-safe: on browsers without the API
 * the sync dialog simply shows the ZIP flow instead. Types are structural
 * and minimal — no @types/wicg-file-system-access dependency.
 */

import { MANIFEST_PATH, TRASH_PATH, type SyncFolderFiles } from "./format";

export interface FsaWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

export interface FsaFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsaWritable>;
}

export interface FsaDirectoryHandle {
  kind: "directory";
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FsaFileHandle | FsaDirectoryHandle]>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FsaDirectoryHandle>;
};

/** True when this browser can connect a real folder (Chromium desktop). */
export function isFsaSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

/**
 * Open the directory picker. Resolves null when the API is missing or the
 * user cancels — never throws.
 */
export async function pickSyncFolder(): Promise<FsaDirectoryHandle | null> {
  const picker = (typeof window !== "undefined" ? (window as PickerWindow).showDirectoryPicker : undefined);
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite", id: "infinitenote-sync" });
  } catch {
    return null; // user dismissed the picker or denied access
  }
}

/**
 * Ensure read/write permission. `requestPermission` must run inside a user
 * gesture (button click) — callers therefore only invoke this from handlers.
 */
export async function ensurePermission(dir: FsaDirectoryHandle, mode: "read" | "readwrite"): Promise<boolean> {
  if (!dir.queryPermission) return true; // pre-permission-API handle: assume ok
  if ((await dir.queryPermission({ mode })) === "granted") return true;
  if (!dir.requestPermission) return false;
  try {
    return (await dir.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

/** Read manifest.json, trash.jsonl and pages/*.json from the folder. */
export async function readSyncFolder(dir: FsaDirectoryHandle): Promise<SyncFolderFiles> {
  const files: SyncFolderFiles = {};
  for (const path of [MANIFEST_PATH, TRASH_PATH]) {
    try {
      const handle = await dir.getFileHandle(path);
      files[path] = await (await handle.getFile()).text();
    } catch {
      /* absent — first sync into an empty folder */
    }
  }
  try {
    const pagesDir = await dir.getDirectoryHandle("pages");
    for await (const [name, handle] of pagesDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      const file = await handle.getFile();
      files[`pages/${name}`] = await file.text();
    }
  } catch {
    /* no pages directory yet */
  }
  return files;
}

/** Write the folder files; stale page files are removed so the folder mirrors the library exactly. */
export async function writeSyncFolder(dir: FsaDirectoryHandle, files: SyncFolderFiles): Promise<void> {
  let pagesDir: FsaDirectoryHandle | null = null;
  const pageNames = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith("pages/")) {
      if (!pagesDir) pagesDir = await dir.getDirectoryHandle("pages", { create: true });
      const name = path.slice("pages/".length);
      const handle = await pagesDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      pageNames.add(name);
    } else {
      const handle = await dir.getFileHandle(path, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    }
  }
  // The merged folder is the source of truth — drop page files we did not
  // write. This must also run when ZERO page files were written (every page
  // deleted since the last sync): the folder has to mirror the library
  // exactly, or a stale page file resurrects its page on the next device.
  if (!pagesDir) {
    pagesDir = await dir.getDirectoryHandle("pages", { create: true }).catch(() => null);
  }
  if (pagesDir) {
    for await (const [name, handle] of pagesDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      if (!pageNames.has(name)) await pagesDir.removeEntry(name).catch(() => undefined);
    }
  }
}
