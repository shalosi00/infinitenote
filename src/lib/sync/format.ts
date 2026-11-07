/**
 * Sync-folder format — phase 1 of file-based sync (docs/sync-research.md §4).
 *
 * The folder is the *contract* between devices; everything here is plain,
 * human-inspectable JSON so a Syncthing/Nextcloud user can always see (and
 * rescue) their data with a text editor:
 *
 * ```text
 * <sync-folder>/
 *   manifest.json     # tree snapshot: alive notebooks/sections/pages + updatedAt
 *   pages/<id>.json   # one page incl. its Excalidraw scene (null when empty)
 *   trash.jsonl       # append-only tombstones: soft deletes + purges
 * ```
 *
 * Pure functions only — no I/O, no Dexie. The ZIP/FSA adapters in the UI
 * layer just materialize the file map this module produces.
 */

import type {
  Notebook,
  PageBackground,
  PageRow,
  ScenePayload,
  Section,
} from "../types";
import { byOrder } from "../types";
import { generatedNames } from "../generated-names";

export const MANIFEST_PATH = "manifest.json";
export const TRASH_PATH = "trash.jsonl";

/** Folder-layout identity written into every manifest. */
export const SYNC_FORMAT = "sync-folder" as const;
export const SYNC_VERSION = 1 as const;

/** Tombstone kinds mirror the three row tables. */
export type TrashKind = "notebook" | "section" | "page";

/**
 * One delete event. `purged: true` rows are final — they must never be
 * resurrected by a stale remote; `purged: false` is a soft delete whose
 * timestamp participates in normal last-writer-wins merging.
 */
export interface TrashEntry {
  id: string;
  kind: TrashKind;
  /** epoch ms of the delete (soft) or purge (hard) event */
  at: number;
  purged: boolean;
  /** human context only — never used for matching */
  title?: string;
}

/** Manifest row shapes: full row metadata minus content / deletedAt. */
export type ManifestNotebook = Omit<Notebook, "deletedAt">;
export type ManifestSection = Omit<Section, "deletedAt">;
export type ManifestPage = Omit<PageRow, "content" | "deletedAt">;

/** `manifest.json` — the tree snapshot of the writing device's library. */
export interface SyncManifest {
  app: "infinitenote";
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  exportedAt: number;
  notebooks: ManifestNotebook[];
  sections: ManifestSection[];
  pages: ManifestPage[];
}

/** `pages/<id>.json` — a page plus its parsed scene. */
export interface SyncPageFile {
  id: string;
  sectionId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  background?: PageBackground;
  tags?: string[];
  scene: ScenePayload | null;
}

/** A whole folder as text files: path → UTF-8 content. */
export type SyncFolderFiles = Record<string, string>;

/** Full library state used by the merge engine (local or remote). */
export interface LibrarySnapshot {
  notebooks: Notebook[];
  sections: Section[];
  /** full rows incl. `content`; trashed rows included (tombstone source) */
  pages: PageRow[];
}

/** Everything `parseSyncFolder` hands to the merge engine. */
export interface ParsedSyncFolder {
  manifest: SyncManifest;
  /** full page rows reconstructed from `pages/<id>.json` (alive pages only) */
  pages: Map<string, PageRow>;
  /** id → latest trash entry (purges sticky) */
  trash: Map<string, TrashEntry>;
}

/** Thrown when a folder does not look like an InfiniteNote sync folder. */
export class SyncFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncFormatError";
  }
}

/* ------------------------------------------------------------------ */
/* build (library → folder)                                            */
/* ------------------------------------------------------------------ */

export function pageFilePath(id: string): string {
  return `pages/${id}.json`;
}

/** Alive manifest rows, deterministically ordered (stable folder diffs). */
export function buildManifest(
  snapshot: LibrarySnapshot,
  exportedAt: number
): SyncManifest {
  const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
    rows.filter((r) => r.deletedAt === null);
  const strip = <T extends { deletedAt: number | null }>({
    deletedAt: _d,
    ...rest
  }: T): Omit<T, "deletedAt"> => rest;
  return {
    app: "infinitenote",
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    exportedAt,
    notebooks: alive(snapshot.notebooks)
      .sort(byOrder)
      .map(strip) as ManifestNotebook[],
    sections: alive(snapshot.sections)
      .sort(byOrder)
      .map(strip) as ManifestSection[],
    pages: alive(snapshot.pages)
      .sort(byOrder)
      .map(({ content: _c, ...rest }) => strip(rest)) as ManifestPage[],
  };
}

/**
 * Materialize the whole folder as a file map.
 *
 * `trash.jsonl` is the union of soft tombstones (derived from the snapshot's
 * trashed rows) and the caller-supplied purge tombstones (persisted in the
 * local DB), reduced to the latest entry per id — purges are sticky.
 */
export function buildSyncFolderFiles(
  snapshot: LibrarySnapshot,
  purges: readonly TrashEntry[],
  exportedAt: number
): SyncFolderFiles {
  const files: SyncFolderFiles = {
    [MANIFEST_PATH]: JSON.stringify(buildManifest(snapshot, exportedAt), null, 2),
  };
  for (const page of snapshot.pages) {
    if (page.deletedAt !== null) continue;
    let scene: ScenePayload | null = null;
    if (page.content) {
      try {
        scene = JSON.parse(page.content) as ScenePayload;
      } catch {
        scene = null; // corrupt legacy row → export an empty scene, never crash
      }
    }
    const file: SyncPageFile = {
      id: page.id,
      sectionId: page.sectionId,
      title: page.title,
      order: page.order,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      background: page.background,
      tags: page.tags?.length ? page.tags : undefined,
      scene,
    };
    files[pageFilePath(page.id)] = JSON.stringify(file);
  }
  const soft: TrashEntry[] = snapshot.pages
    .filter((p) => p.deletedAt !== null)
    .map((p) => ({ id: p.id, kind: "page", at: p.deletedAt!, purged: false, title: p.title }));
  for (const s of snapshot.sections) {
    if (s.deletedAt !== null)
      soft.push({ id: s.id, kind: "section", at: s.deletedAt, purged: false, title: s.name });
  }
  for (const n of snapshot.notebooks) {
    if (n.deletedAt !== null)
      soft.push({ id: n.id, kind: "notebook", at: n.deletedAt, purged: false, title: n.name });
  }
  files[TRASH_PATH] =
    [...reduceTrash([...soft, ...purges]).values()]
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n";
  return files;
}

/* ------------------------------------------------------------------ */
/* parse (folder → library)                                            */
/* ------------------------------------------------------------------ */

const PAGE_FILE_RE = /^pages\/[0-9A-Za-z_-]+\.json$/;

/** Union many trash entries by id: latest `at` wins, `purged` is sticky. */
export function reduceTrash(entries: readonly TrashEntry[]): Map<string, TrashEntry> {
  const out = new Map<string, TrashEntry>();
  for (const e of entries) {
    const prev = out.get(e.id);
    if (!prev || e.at > prev.at) {
      out.set(e.id, e.purged || prev?.purged ? { ...e, purged: true } : e);
    } else if (e.purged && prev && !prev.purged) {
      out.set(e.id, { ...prev, purged: true });
    }
  }
  return out;
}

/**
 * Parse + validate a foreign sync folder. Unknown files are ignored (the
 * folder may carry future extras); a bad manifest or corrupt trash log
 * throws `SyncFormatError` so callers can surface a clear message instead
 * of half-merging garbage.
 */
export function parseSyncFolder(files: SyncFolderFiles): ParsedSyncFolder {
  const manifestRaw = files[MANIFEST_PATH];
  if (manifestRaw === undefined) {
    throw new SyncFormatError("Not an InfiniteNote sync folder: manifest.json is missing");
  }
  let manifest: SyncManifest;
  try {
    manifest = JSON.parse(manifestRaw) as SyncManifest;
  } catch {
    throw new SyncFormatError("manifest.json is not valid JSON");
  }
  if (manifest?.app !== "infinitenote" || manifest?.format !== SYNC_FORMAT) {
    throw new SyncFormatError("Not an InfiniteNote sync folder: unexpected app/format");
  }
  if (manifest.version !== SYNC_VERSION) {
    throw new SyncFormatError(
      `Unsupported sync-folder version ${String(manifest.version)} (expected ${String(SYNC_VERSION)})`
    );
  }
  for (const key of ["notebooks", "sections", "pages"] as const) {
    if (!Array.isArray(manifest[key])) {
      throw new SyncFormatError(`manifest.json: "${key}" must be an array`);
    }
  }

  const pages = new Map<string, PageRow>();
  for (const [path, raw] of Object.entries(files)) {
    if (!PAGE_FILE_RE.test(path)) continue;
    let file: SyncPageFile;
    try {
      file = JSON.parse(raw) as SyncPageFile;
    } catch {
      throw new SyncFormatError(`${path} is not valid JSON`);
    }
    if (typeof file?.id !== "string" || typeof file?.sectionId !== "string") {
      throw new SyncFormatError(`${path} is missing id/sectionId`);
    }
    pages.set(file.id, {
      id: file.id,
      sectionId: file.sectionId,
      title: typeof file.title === "string" ? file.title : generatedNames().untitled,
      order: typeof file.order === "number" ? file.order : 0,
      createdAt: typeof file.createdAt === "number" ? file.createdAt : 0,
      updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : 0,
      deletedAt: null,
      background: file.background,
      tags: file.tags?.length ? file.tags : undefined,
      content: file.scene ? JSON.stringify(file.scene) : null,
    });
  }

  const trash: TrashEntry[] = [];
  const trashRaw = files[TRASH_PATH] ?? "";
  for (const [i, line] of trashRaw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as TrashEntry;
      if (typeof e?.id !== "string" || typeof e?.at !== "number") {
        throw new Error("bad shape");
      }
      trash.push({
        id: e.id,
        kind: e.kind === "notebook" || e.kind === "section" ? e.kind : "page",
        at: e.at,
        purged: e.purged === true,
        title: typeof e.title === "string" ? e.title : undefined,
      });
    } catch {
      throw new SyncFormatError(`trash.jsonl line ${i + 1} is not a valid tombstone`);
    }
  }

  return { manifest, pages, trash: reduceTrash(trash) };
}
