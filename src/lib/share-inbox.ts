/**
 * Web Share Target inbox (PWA "share into the app") — issue #247.
 *
 * The installed PWA declares a `share_target` (public/manifest.webmanifest):
 * the OS share sheet (Android share sheet, desktop PWA share UIs) can POST
 * shared text, links and files to `/share-target`. The service worker
 * (public/sw.js) intercepts that POST before the network, stashes the
 * payload in a small IndexedDB mailbox and redirects the user into the app;
 * on the next boot the app drains the mailbox and lands each share as a
 * Quick Notes page via the regular import pipeline (CanvasApi.importFiles).
 *
 * This module is the mailbox contract shared by BOTH sides:
 *  - the service worker is a standalone classic script (no bundler, no
 *    imports), so it re-implements the same DB name, store name, field
 *    names and entry shape inline — `share-inbox.test.ts` pins the two
 *    copies in sync so they cannot drift;
 *  - the app side drains via `drainSharedEntries()` and converts entries
 *    with the pure helpers below.
 *
 * The mailbox lives OUTSIDE the Dexie database on purpose: the SW must be
 * able to write before the app ever boots (first run, or while a tab is
 * closed), and a tiny raw-IDB schema keeps the SW dependency-free.
 */

/** IndexedDB database + object store that backs the mailbox (SW and app). */
export const SHARE_INBOX_DB = "infinitenote-share-inbox";
export const SHARE_INBOX_STORE = "shares";

/** The POST endpoint the manifest's share_target declares and the SW intercepts. */
export const SHARE_TARGET_PATH = "/share-target";

/** Form field names the share sheet fills in (manifest `params`). */
export const SHARE_TEXT_FIELDS = ["title", "text", "url"] as const;
export const SHARE_FILE_FIELD = "files";

/** Filename of the synthetic text file the body text is imported as. */
export const SHARE_TEXT_FILENAME = "shared-text.txt";

/** One file carried by a share entry (structured-cloned Blob — a File stays a File). */
export interface SharedFile {
  name: string;
  type: string;
  blob: Blob;
}

/** One captured share, exactly what the SW stashed for one POST. */
export interface SharedEntry {
  /** Shared title, "" when the share had none. */
  title: string;
  /** Shared text body, "" when the share had none. */
  text: string;
  /** Shared URL, "" when the share had none. */
  url: string;
  files: SharedFile[];
  /** epoch ms when the SW stashed the share. */
  receivedAt: number;
}

/**
 * Compose the note body for a captured share: the shared text, then the
 * URL on its own paragraph (a URL-only share still captures the link).
 * Empty parts vanish; the result is "" when the share carries no body.
 */
export function shareBodyText(entry: Pick<SharedEntry, "text" | "url">): string {
  return [entry.text, entry.url]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * True when the entry carries nothing the drain could land — no title,
 * no body text, no URL and no files. The SW still stashes such shares
 * (the user tapped "share"), but the drain skips creating an empty page.
 * A title-only share is still captured: it becomes a titled, empty page
 * (OneNote behavior — a share always produces a page).
 */
export function isEmptyShare(
  entry: Pick<SharedEntry, "title" | "text" | "url" | "files">
): boolean {
  return (
    !entry.title.trim() && !shareBodyText(entry) && entry.files.length === 0
  );
}

/**
 * The page title for a captured share: the shared title when it has one
 * (trimmed, hard-capped so a 10 000-character share title cannot blow the
 * sidebar layout), otherwise the regular quick-note title the caller built.
 */
export function sharePageTitle(entry: Pick<SharedEntry, "title">, fallback: string, cap = 80): string {
  const trimmed = entry.title.trim();
  if (!trimmed) return fallback;
  return trimmed.length > cap ? `${trimmed.slice(0, cap - 1)}…` : trimmed;
}

/**
 * Build the File[] the canvas import pipeline consumes: the composed body
 * as a synthetic plain-text file (when non-empty) plus every shared file
 * unchanged — unknown types flow into the existing "unsupported type"
 * toast, so the mailbox never needs its own MIME filter.
 */
export function sharedEntryToFiles(entry: SharedEntry): File[] {
  const files: File[] = [];
  const body = shareBodyText(entry);
  if (body) {
    files.push(new File([body], SHARE_TEXT_FILENAME, { type: "text/plain" }));
  }
  for (const f of entry.files) {
    files.push(new File([f.blob], f.name, { type: f.type }));
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* mailbox I/O (app side — the SW mirrors this inline)                  */
/* ------------------------------------------------------------------ */

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_INBOX_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_INBOX_STORE)) {
        // autoIncrement keys keep stash order stable across drains
        req.result.createObjectStore(SHARE_INBOX_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("share inbox open failed"));
  });
}

/**
 * Stash one share (window-side mirror of the SW's inline stash; the unit
 * tests use it to seed the mailbox without going through a service worker).
 */
export async function stashSharedEntry(entry: SharedEntry): Promise<void> {
  const db = await openInbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE, "readwrite");
      tx.objectStore(SHARE_INBOX_STORE).add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("share stash failed"));
      tx.onabort = () => reject(tx.error ?? new Error("share stash aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Read every pending share and clear the mailbox in ONE readwrite
 * transaction: with two tabs open, exactly one drain can ever see a given
 * entry, so a share is never imported twice. Resolves [] when the mailbox
 * is empty (the common boot) or IndexedDB is unavailable (non-secure
 * contexts) — a failed drain must never block app boot.
 */
export async function drainSharedEntries(): Promise<SharedEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  let db: IDBDatabase;
  try {
    db = await openInbox();
  } catch {
    return [];
  }
  try {
    return await new Promise<SharedEntry[]>((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE, "readwrite");
      const store = tx.objectStore(SHARE_INBOX_STORE);
      const getAll = store.getAll();
      const clear = store.clear();
      tx.oncomplete = () => {
        const rows = (getAll.result ?? []) as SharedEntry[];
        // drop malformed rows defensively — a hand-edited or future-format
        // mailbox must not crash the boot loop
        resolve(rows.filter((r) => r && typeof r === "object" && Array.isArray(r.files)));
      };
      tx.onerror = () => reject(tx.error ?? new Error("share drain failed"));
      tx.onabort = () => reject(tx.error ?? new Error("share drain aborted"));
      void clear; // runs inside the same transaction
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}
