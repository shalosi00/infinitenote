/// <reference types="bun-types" />
/**
 * Unit tests for the sync-folder format (build → parse round trips,
 * validation, tombstone reduction). Pure — no IndexedDB.
 */
import { describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import {
  MANIFEST_PATH,
  TRASH_PATH,
  buildManifest,
  buildSyncFolderFiles,
  pageFilePath,
  parseSyncFolder,
  reduceTrash,
  SyncFormatError,
  type LibrarySnapshot,
  type TrashEntry,
} from "../sync/format";

/* ------------------------------ factories ------------------------------ */

const t0 = 1_700_000_000_000;
/** Deterministic timestamp per id — the same id always yields the same row. */
const tsOf = (id: string) => t0 + (parseInt(id.replace(/\D/g, ""), 10) || 1);
const orderCounters = new Map<string, number>();
const nextOrder = (parent: string) => {
  const n = (orderCounters.get(parent) ?? 0) + 1;
  orderCounters.set(parent, n);
  return n;
};

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "violet",
  order: nextOrder("nb"),
  createdAt: tsOf(id),
  updatedAt: tsOf(id),
  deletedAt: null,
  ...over,
});

const sec = (id: string, notebookId: string, over: Partial<Section> = {}): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: nextOrder(`sec:${notebookId}`),
  createdAt: tsOf(id),
  updatedAt: tsOf(id),
  deletedAt: null,
  ...over,
});

const pg = (id: string, sectionId: string, over: Partial<PageRow> = {}): PageRow => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order: nextOrder(`pg:${sectionId}`),
  createdAt: tsOf(id),
  updatedAt: tsOf(id),
  deletedAt: null,
  content: over.content ?? null,
  ...over,
});

const snapshot = (over: Partial<LibrarySnapshot> = {}): LibrarySnapshot => ({
  notebooks: [nb("nb1")],
  sections: [sec("s1", "nb1")],
  pages: [pg("p1", "s1")],
  ...over,
});

/* ------------------------------- tests --------------------------------- */

describe("buildManifest", () => {
  it("exports alive rows only, deterministically ordered", () => {
    const snap = snapshot({
      notebooks: [nb("nb1", { order: 1 }), nb("nb2", { order: 2 }), nb("nbX", { order: 3, deletedAt: t0 })],
      sections: [sec("s1", "nb1"), sec("s2", "nb1"), sec("sX", "nb1", { deletedAt: t0 })],
      pages: [pg("p1", "s1"), pg("p2", "s1"), pg("pX", "s1", { deletedAt: t0 })],
    });
    const m = buildManifest(snap, t0);
    expect(m.app).toBe("infinitenote");
    expect(m.format).toBe("sync-folder");
    expect(m.version).toBe(1);
    expect(m.notebooks.map((n) => n.id)).toEqual(["nb1", "nb2"]);
    expect(m.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(m.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect("deletedAt" in m.notebooks[0]).toBe(false);
    expect("content" in m.pages[0]).toBe(false);
  });
});

describe("buildSyncFolderFiles", () => {
  it("writes manifest, one page file per alive page, and a trash log", () => {
    const scene = JSON.stringify({ elements: [], files: {} });
    const snap = snapshot({
      pages: [pg("p1", "s1", { content: scene }), pg("p2", "s1"), pg("pT", "s1", { deletedAt: t0 + 99, updatedAt: t0 + 99 })],
    });
    const files = buildSyncFolderFiles(snap, [], t0 + 500);
    expect(Object.keys(files).sort()).toEqual(
      [MANIFEST_PATH, TRASH_PATH, pageFilePath("p1"), pageFilePath("p2")].sort()
    );
    const pageFile = JSON.parse(files[pageFilePath("p1")]);
    expect(pageFile.scene).toEqual({ elements: [], files: {} });
    expect(pageFile.title).toBe("Page p1");
    // empty scene → null, not "null"
    expect(JSON.parse(files[pageFilePath("p2")]).scene).toBeNull();
    // soft tombstone derived from the trashed row
    const trashLines = files[TRASH_PATH].trim().split("\n").map((l) => JSON.parse(l) as TrashEntry);
    expect(trashLines).toEqual([{ id: "pT", kind: "page", at: t0 + 99, purged: false, title: "Page pT" }]);
  });

  it("unions soft tombstones with purge tombstones, latest per id, purges sticky", () => {
    const snap = snapshot({
      pages: [pg("p1", "s1"), pg("pT", "s1", { deletedAt: t0 + 10, updatedAt: t0 + 10 })],
    });
    const purges: TrashEntry[] = [
      { id: "pGone", kind: "page", at: t0 + 50, purged: true, title: "Gone" },
      { id: "pT", kind: "page", at: t0 + 5, purged: true }, // older than the soft delete
    ];
    const files = buildSyncFolderFiles(snap, purges, t0 + 500);
    const trash = files[TRASH_PATH].trim().split("\n").map((l) => JSON.parse(l) as TrashEntry);
    expect(trash).toEqual([
      { id: "pT", kind: "page", at: t0 + 10, purged: true, title: "Page pT" }, // latest wins, purge sticky
      { id: "pGone", kind: "page", at: t0 + 50, purged: true, title: "Gone" },
    ]);
  });
});

describe("reduceTrash", () => {
  it("keeps the latest entry per id and never un-purges", () => {
    const out = reduceTrash([
      { id: "a", kind: "page", at: 10, purged: true },
      { id: "a", kind: "page", at: 20, purged: false },
      { id: "b", kind: "section", at: 30, purged: false },
      { id: "b", kind: "section", at: 20, purged: false },
    ]);
    expect(out.get("a")).toEqual({ id: "a", kind: "page", at: 20, purged: true });
    expect(out.get("b")?.at).toBe(30);
  });
});

describe("parseSyncFolder", () => {
  const valid = buildSyncFolderFiles(
    snapshot({
      pages: [pg("p1", "s1", { content: JSON.stringify({ elements: [1], files: {} }) })],
    }),
    [{ id: "pGone", kind: "page", at: t0, purged: true }],
    t0
  );

  it("round-trips a built folder", () => {
    const parsed = parseSyncFolder(valid);
    expect(parsed.manifest.notebooks.map((n) => n.id)).toEqual(["nb1"]);
    expect(parsed.pages.get("p1")?.content).toBe(JSON.stringify({ elements: [1], files: {} }));
    expect(parsed.pages.get("p1")?.deletedAt).toBeNull();
    expect(parsed.trash.get("pGone")?.purged).toBe(true);
  });

  it("ignores unknown files (forward-compatible)", () => {
    const parsed = parseSyncFolder({ ...valid, "pages/notes.txt": "hello", "README.md": "# hi" });
    expect(parsed.pages.size).toBe(1);
  });

  it("rejects a missing manifest", () => {
    const { [MANIFEST_PATH]: _m, ...rest } = valid;
    expect(() => parseSyncFolder(rest)).toThrow(SyncFormatError);
  });

  it("rejects a manifest from another app or version", () => {
    const wrongApp = { ...valid, [MANIFEST_PATH]: JSON.stringify({ ...JSON.parse(valid[MANIFEST_PATH]), app: "other" }) };
    expect(() => parseSyncFolder(wrongApp)).toThrow(/unexpected app\/format/);
    const wrongVersion = { ...valid, [MANIFEST_PATH]: JSON.stringify({ ...JSON.parse(valid[MANIFEST_PATH]), version: 99 }) };
    expect(() => parseSyncFolder(wrongVersion)).toThrow(/Unsupported sync-folder version/);
  });

  it("rejects corrupt JSON in the manifest, a page file, or the trash log", () => {
    expect(() => parseSyncFolder({ ...valid, [MANIFEST_PATH]: "{nope" })).toThrow(/not valid JSON/);
    expect(() => parseSyncFolder({ ...valid, [pageFilePath("p1")]: "{nope" })).toThrow(/not valid JSON/);
    expect(() => parseSyncFolder({ ...valid, [TRASH_PATH]: '{"id":"x","at":"not-a-number"}\n' })).toThrow(/tombstone/);
  });

  it("tolerates blank lines and missing trash log", () => {
    const parsed = parseSyncFolder({ ...valid, [TRASH_PATH]: "\n\n" });
    expect(parsed.trash.size).toBe(0);
    const noTrash = { ...valid };
    delete noTrash[TRASH_PATH];
    expect(parseSyncFolder(noTrash).trash.size).toBe(0);
  });

  it("defaults malformed page fields instead of throwing", () => {
    const minimal = { ...valid, [pageFilePath("p1")]: JSON.stringify({ id: "p1", sectionId: "s1" }) };
    const parsed = parseSyncFolder(minimal);
    const page = parsed.pages.get("p1")!;
    expect(page.title).toBe("Untitled");
    expect(page.order).toBe(0);
    expect(page.content).toBeNull();
  });
});
