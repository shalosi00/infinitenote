/// <reference types="bun-types" />
/**
 * Edge-case tests for the sync-folder format (src/lib/sync/format.ts) beyond
 * the round trips and validation basics pinned in sync-format.test.ts:
 * empty libraries, manifest sort stability, corrupt legacy page content,
 * background/tags round trips, tombstone shapes for every row kind,
 * reduceTrash boundary rules (equal timestamps, sticky purges, titles), the
 * strict pages/<id>.json path scheme, and the stable SyncFormatError codes.
 * Pure — no IndexedDB, no I/O.
 */
import { describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import {
  MANIFEST_PATH,
  SYNC_ERROR_MESSAGES,
  TRASH_PATH,
  buildManifest,
  buildSyncFolderFiles,
  pageFilePath,
  parseSyncFolder,
  reduceTrash,
  SyncFormatError,
  type LibrarySnapshot,
  type SyncErrorCode,
  type TrashEntry,
} from "../sync/format";

const t0 = 1_700_000_000_000;

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "teal",
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
  ...over,
});

const sec = (id: string, notebookId: string, over: Partial<Section> = {}): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
  ...over,
});

const pg = (id: string, sectionId: string, over: Partial<PageRow> = {}): PageRow => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
  content: null,
  ...over,
});

const onePageSnap = (): LibrarySnapshot => ({
  notebooks: [nb("nb1")],
  sections: [sec("s1", "nb1")],
  pages: [pg("p1", "s1", { content: JSON.stringify({ elements: [], files: {} }) })],
});

/** A minimal valid folder to mutate per test (fresh copy each call). */
const validFolder = () => buildSyncFolderFiles(onePageSnap(), [], t0);

describe("buildManifest edge cases", () => {
  it("exports an empty library as a well-formed empty manifest", () => {
    const m = buildManifest({ notebooks: [], sections: [], pages: [] }, t0 + 5);
    expect(m).toEqual({
      app: "infinitenote",
      format: "sync-folder",
      version: 1,
      exportedAt: t0 + 5,
      notebooks: [],
      sections: [],
      pages: [],
    });
  });

  it("sorts rows by order, then createdAt, regardless of input order", () => {
    const snap: LibrarySnapshot = {
      notebooks: [
        nb("nb3", { order: 3 }),
        nb("nb1", { order: 1 }),
        nb("nbB", { order: 2, createdAt: t0 + 5 }),
        nb("nbA", { order: 2, createdAt: t0 + 2 }),
      ],
      sections: [],
      pages: [],
    };
    expect(buildManifest(snap, t0).notebooks.map((n) => n.id)).toEqual(["nb1", "nbA", "nbB", "nb3"]);
  });
});

describe("buildSyncFolderFiles edge cases", () => {
  it("exports corrupt legacy page content as a null scene instead of crashing", () => {
    const snap: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [pg("p1", "s1", { content: "definitely { not json" })],
    };
    const files = buildSyncFolderFiles(snap, [], t0);
    const pageFile = JSON.parse(files[pageFilePath("p1")]) as { scene: unknown; title: string };
    expect(pageFile.scene).toBeNull();
    expect(pageFile.title).toBe("Page p1");
  });

  it("carries background and tags into page files and drops empty tag lists", () => {
    const snap: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [
        pg("p1", "s1", { background: "grid", tags: ["work", "ideas"] }),
        pg("p2", "s1", { tags: [] }),
      ],
    };
    const files = buildSyncFolderFiles(snap, [], t0);
    const f1 = JSON.parse(files[pageFilePath("p1")]) as Record<string, unknown>;
    expect(f1.background).toBe("grid");
    expect(f1.tags).toEqual(["work", "ideas"]);
    const f2 = JSON.parse(files[pageFilePath("p2")]) as Record<string, unknown>;
    expect("tags" in f2).toBe(false);
    // and both survive a parse round trip
    const parsed = parseSyncFolder(files);
    expect(parsed.pages.get("p1")?.background).toBe("grid");
    expect(parsed.pages.get("p1")?.tags).toEqual(["work", "ideas"]);
    expect(parsed.pages.get("p2")?.tags).toBeUndefined();
  });

  it("derives soft tombstones for sections and notebooks with kind and name", () => {
    const snap: LibrarySnapshot = {
      notebooks: [nb("nb1"), nb("nbX", { deletedAt: t0 + 30, updatedAt: t0 + 30 })],
      sections: [sec("s1", "nb1"), sec("sX", "nb1", { deletedAt: t0 + 20, updatedAt: t0 + 20 })],
      pages: [pg("p1", "s1")],
    };
    const files = buildSyncFolderFiles(snap, [], t0);
    const entries = files[TRASH_PATH].trim().split("\n").map((l) => JSON.parse(l) as TrashEntry);
    expect(entries).toEqual([
      { id: "sX", kind: "section", at: t0 + 20, purged: false, title: "Section sX" },
      { id: "nbX", kind: "notebook", at: t0 + 30, purged: false, title: "Notebook nbX" },
    ]);
  });

  it("writes an empty trash log (a single newline) when nothing is deleted", () => {
    const files = buildSyncFolderFiles(onePageSnap(), [], t0);
    expect(files[TRASH_PATH]).toBe("\n");
  });
});

describe("reduceTrash boundary rules", () => {
  it("reduces no entries to an empty map and keeps the first entry on equal timestamps", () => {
    expect(reduceTrash([]).size).toBe(0);
    const out = reduceTrash([
      { id: "a", kind: "page", at: 5, purged: false, title: "first" },
      { id: "a", kind: "page", at: 5, purged: false, title: "second" },
    ]);
    expect(out.get("a")?.title).toBe("first");
  });

  it("keeps the newer timestamp when an older purge follows a newer soft delete", () => {
    const out = reduceTrash([
      { id: "a", kind: "page", at: 20, purged: false, title: "soft" },
      { id: "a", kind: "page", at: 10, purged: true },
    ]);
    expect(out.get("a")).toEqual({ id: "a", kind: "page", at: 20, purged: true, title: "soft" });
  });

  it("takes the title from the winning (latest) entry", () => {
    const out = reduceTrash([
      { id: "a", kind: "page", at: 10, purged: false, title: "old" },
      { id: "a", kind: "page", at: 20, purged: false, title: "new" },
    ]);
    expect(out.get("a")?.title).toBe("new");
  });
});

describe("parseSyncFolder edge cases", () => {
  it("rejects a manifest whose row collections are not arrays", () => {
    for (const key of ["notebooks", "sections", "pages"] as const) {
      const manifest = JSON.parse(validFolder()[MANIFEST_PATH]) as Record<string, unknown>;
      manifest[key] = {}; // object, not array
      let threw = false;
      try {
        parseSyncFolder({ ...validFolder(), [MANIFEST_PATH]: JSON.stringify(manifest) });
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(SyncFormatError);
        expect((e as SyncFormatError).code).toBe("badManifest");
        expect((e as Error).message).toContain(`"${key}" must be an array`);
      }
      expect(threw).toBe(true);
    }
  });

  it("rejects a page file that is valid JSON but has no id/sectionId", () => {
    expect(() =>
      parseSyncFolder({ ...validFolder(), [pageFilePath("p1")]: JSON.stringify({ id: "p1" }) })
    ).toThrow(/missing id\/sectionId/);
    let threw = false;
    try {
      parseSyncFolder({ ...validFolder(), "pages/p9.json": "null" });
    } catch (e) {
      threw = true;
      expect((e as SyncFormatError).code).toBe("badPageFile");
    }
    expect(threw).toBe(true);
  });

  it("accepts only strict pages/<urlsafe-id>.json paths", () => {
    const good = JSON.stringify({ id: "ok1", sectionId: "s1" });
    const parsed = parseSyncFolder({
      ...validFolder(),
      "pages/sub/inner.json": good, // nested directory → ignored
      "pages/has space.json": good, // space is not url-safe → ignored
      "pages/upper.JSON": good, // extension must be lowercase → ignored
      "pages/A-b_C9.json": good, // letters, digits, "-" and "_" are fine
    });
    expect(parsed.pages.has("ok1")).toBe(true);
    expect(parsed.pages.size).toBe(2); // p1 from the fixture + ok1
  });

  it("normalizes malformed tombstone fields instead of failing", () => {
    const lines =
      [
        JSON.stringify({ id: "k1", kind: "weird-kind", at: 5, purged: "yes", title: 42 }),
        JSON.stringify({ id: "k2", kind: "notebook", at: 6 }),
        JSON.stringify({ id: "k3", kind: "section", at: 7, purged: true }),
      ].join("\n") + "\n";
    const parsed = parseSyncFolder({ ...validFolder(), [TRASH_PATH]: lines });
    const k1 = parsed.trash.get("k1")!;
    expect(k1.kind).toBe("page"); // unknown kind falls back to "page"
    expect(k1.purged).toBe(false); // only the literal true counts
    expect(k1.title).toBeUndefined(); // non-string titles are dropped
    expect(parsed.trash.get("k2")?.kind).toBe("notebook");
    expect(parsed.trash.get("k3")?.purged).toBe(true);
  });

  it("surfaces a stable error code per failure and an English message per code", () => {
    const codeOf = (files: Record<string, string>): SyncErrorCode => {
      try {
        parseSyncFolder(files);
      } catch (e) {
        expect(e).toBeInstanceOf(SyncFormatError);
        expect((e as Error).name).toBe("SyncFormatError");
        return (e as SyncFormatError).code;
      }
      throw new Error("expected parseSyncFolder to throw");
    };
    expect(codeOf({})).toBe("noManifest");
    expect(codeOf({ ...validFolder(), [MANIFEST_PATH]: "{oops" })).toBe("badManifest");
    expect(
      codeOf({
        ...validFolder(),
        [MANIFEST_PATH]: JSON.stringify({
          ...JSON.parse(validFolder()[MANIFEST_PATH]),
          version: 2,
        }),
      })
    ).toBe("badVersion");
    expect(codeOf({ ...validFolder(), [pageFilePath("p1")]: "{oops" })).toBe("badPageFile");
    expect(codeOf({ ...validFolder(), [TRASH_PATH]: '{"id":1,"at":2}\n' })).toBe("badTrash");
    for (const c of ["noManifest", "badManifest", "badVersion", "badPageFile", "badTrash"] as const) {
      expect(SYNC_ERROR_MESSAGES[c].length).toBeGreaterThan(0);
    }
  });
});
