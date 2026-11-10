/// <reference types="bun-types" />
/**
 * Edge-case integration tests for the sync I/O layer (src/lib/sync/db.ts)
 * beyond sync-db.test.ts, running on fake-indexeddb: snapshot completeness
 * (trashed rows keep their content), first sync into an empty folder,
 * SyncFormatError propagation out of runSync, injected export timestamps,
 * remote purges persisting tombstones, soft-delete push into a stale folder,
 * conflict copies in the rebuilt folder, and applySyncPlan idempotency plus
 * its never-downgrade rule for persisted purge tombstones.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { computeSyncPlan } from "../sync/merge"; // pure — safe to import statically
import type * as Format from "../sync/format";
import type * as Notes from "../notes-db";
import type * as SyncDb from "../sync/db";

let notes: typeof Notes;
let format: typeof Format;
let syncdb: typeof SyncDb;

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  format = await import("../sync/format");
  syncdb = await import("../sync/db");
});

beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

const T = 1_700_000_000_000;
const scene = (mark: string) => JSON.stringify({ elements: [{ mark }], files: {} });
const emptySnapshot = (): Format.LibrarySnapshot => ({ notebooks: [], sections: [], pages: [] });

/** Deterministic seed: nb1 / s1 / p1 with explicit timestamps (no wall clock). */
async function seedExplicit(): Promise<void> {
  await notes.db.notebooks.put({
    id: "nb1",
    name: "Journal",
    color: "teal",
    order: 1,
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
  });
  await notes.db.sections.put({
    id: "s1",
    notebookId: "nb1",
    name: "Daily",
    order: 1,
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
  });
  await notes.db.pages.put({
    id: "p1",
    sectionId: "s1",
    title: "Alpha",
    order: 1,
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
    content: scene("alpha"),
  });
}

describe("readLocalSnapshot", () => {
  it("returns full rows including trashed pages with their content", async () => {
    const nb = await notes.createNotebook("Journal", "teal");
    const sec = await notes.createSection(nb.id, "Daily");
    const page = await notes.createPage(sec.id, "Alpha");
    await notes.savePageContent(page.id, { elements: [{ mark: "keep" }], files: {} });
    await notes.trashPage(page.id);

    const snap = await syncdb.readLocalSnapshot();
    expect(snap.notebooks).toHaveLength(1);
    expect(snap.sections).toHaveLength(1);
    const trashed = snap.pages.find((p) => p.id === page.id)!;
    expect(trashed.deletedAt).not.toBeNull();
    expect(trashed.title).toBe("Alpha");
    expect(trashed.content).toContain("keep");
  });
});

describe("runSync edge cases", () => {
  it("a first sync into an empty folder pushes the whole local library", async () => {
    const nb = await notes.createNotebook("Journal", "teal");
    const sec = await notes.createSection(nb.id, "Daily");
    const alpha = await notes.createPage(sec.id, "Alpha");
    const beta = await notes.createPage(sec.id, "Beta");

    const result = await syncdb.runSync(format.buildSyncFolderFiles(emptySnapshot(), [], T), T + 1000);

    expect(result.summary.pagesAdded).toBe(0); // everything was already local
    expect(result.summary.pagesUpdated).toBe(0);
    expect(Object.keys(result.folder).sort()).toEqual(
      ["manifest.json", "trash.jsonl", `pages/${alpha.id}.json`, `pages/${beta.id}.json`].sort()
    );
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.manifest.notebooks.map((n) => n.name)).toEqual(["Journal"]);
    expect(parsed.manifest.pages.map((p) => p.title).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("propagates SyncFormatError (with its code) for a folder without a manifest", async () => {
    let threw = false;
    try {
      await syncdb.runSync({ "trash.jsonl": "\n" });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(format.SyncFormatError);
      expect((e as Format.SyncFormatError).code).toBe("noManifest");
    }
    expect(threw).toBe(true);
  });

  it("stamps the injected export time into the rebuilt folder and the remembered base", async () => {
    await seedExplicit();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], T);
    const result = await syncdb.runSync(folder, T + 5000);

    expect(JSON.parse(result.folder["manifest.json"]).exportedAt).toBe(T + 5000);
    const base = (await notes.readLastSyncManifest()) as Format.SyncManifest | null;
    expect(base?.exportedAt).toBe(T + 5000);
    expect(base?.pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("a remote purge tombstone hard-deletes the row and persists for future exports", async () => {
    await seedExplicit();
    const folder = format.buildSyncFolderFiles(
      emptySnapshot(),
      [{ id: "p1", kind: "page", at: T + 100, purged: true, title: "Alpha" }],
      T
    );
    const result = await syncdb.runSync(folder, T + 200);

    expect(result.summary.pagesPurged).toBe(1);
    expect(await notes.db.pages.get("p1")).toBeUndefined();
    const tombstones = await notes.listPurgeTombstones();
    expect(tombstones.find((t) => t.id === "p1")).toMatchObject({ kind: "page", at: T + 100 });
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.trash.get("p1")?.purged).toBe(true);
  });

  it("a local soft delete wins over the stale alive folder and is pushed into it", async () => {
    await seedExplicit();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], T);
    // the device then trashes the page (explicit timestamp, newer than the folder)
    await notes.db.pages.update("p1", { deletedAt: T + 500, updatedAt: T + 500 });

    const result = await syncdb.runSync(folder, T + 600);

    expect((await notes.db.pages.get("p1"))?.deletedAt).toBe(T + 500); // still restorable
    expect(result.folder["pages/p1.json"]).toBeUndefined();
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.manifest.pages).toHaveLength(0);
    expect(parsed.trash.get("p1")).toMatchObject({ purged: false, at: T + 500 });
  });

  it("an empty library against an empty folder is a clean no-op", async () => {
    const result = await syncdb.runSync(format.buildSyncFolderFiles(emptySnapshot(), [], T), T);
    expect(result.summary).toEqual({
      notebooksAdded: 0,
      sectionsAdded: 0,
      pagesAdded: 0,
      pagesUpdated: 0,
      treeUpdated: 0,
      pagesConflicted: 0,
      pagesDeleted: 0,
      treeDeleted: 0,
      pagesPurged: 0,
      treePurged: 0,
    });
    expect(Object.keys(result.folder).sort()).toEqual(["manifest.json", "trash.jsonl"]);
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.manifest.notebooks).toEqual([]);
    expect(parsed.manifest.pages).toEqual([]);
  });

  it("exports a conflict copy into the rebuilt folder for the other device", async () => {
    const nb = await notes.createNotebook("Journal", "teal");
    const sec = await notes.createSection(nb.id, "Daily");
    const alpha = await notes.createPage(sec.id, "Alpha");
    await notes.savePageContent(alpha.id, { elements: [{ mark: "base" }], files: {} });
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder); // this device joins

    // this device edits offline…
    await notes.savePageContent(alpha.id, { elements: [{ mark: "local" }], files: {} });
    // …while the folder carries a newer remote edit (clock ahead)
    const newer = Date.now() + 10_000;
    const parsedFolder = format.parseSyncFolder(folder);
    const aFolder: Format.SyncFolderFiles = {
      ...folder,
      [`pages/${alpha.id}.json`]: JSON.stringify({
        ...JSON.parse(folder[`pages/${alpha.id}.json`]!),
        title: "Alpha (remote)",
        updatedAt: newer,
        scene: { elements: [{ mark: "remote" }], files: {} },
      }),
      "manifest.json": JSON.stringify(
        {
          ...parsedFolder.manifest,
          exportedAt: newer,
          pages: parsedFolder.manifest.pages.map((p) =>
            p.id === alpha.id ? { ...p, title: "Alpha (remote)", updatedAt: newer } : p
          ),
        },
        null,
        2
      ),
    };

    const result = await syncdb.runSync(aFolder);
    expect(result.summary.pagesConflicted).toBe(1);
    const parsed = format.parseSyncFolder(result.folder);
    const copyMeta = parsed.manifest.pages.find((p) => p.id !== alpha.id)!;
    expect(copyMeta.title).toMatch(/^Alpha \(conflict /);
    expect(parsed.pages.get(copyMeta.id)!.content).toContain("local"); // loser content survives
    expect(parsed.manifest.pages.find((p) => p.id === alpha.id)?.title).toBe("Alpha (remote)");
  });
});

describe("applySyncPlan edge cases", () => {
  it("applying the same plan twice reports no row changes the second time", async () => {
    await seedExplicit();
    const before = await syncdb.readLocalSnapshot();
    const base = format.buildManifest(before, T);
    // the device edits p1…
    await notes.db.pages.update("p1", { content: scene("local"), updatedAt: T + 20 });
    const local = await syncdb.readLocalSnapshot();
    // …while the folder carries a newer remote edit of the same page
    const remote: Format.LibrarySnapshot = {
      notebooks: before.notebooks,
      sections: before.sections,
      pages: [{ ...before.pages[0], content: scene("remote"), updatedAt: T + 30 }],
    };
    const plan = computeSyncPlan(
      { local, localPurges: [], remote, remoteTrash: [], base },
      { now: T + 1000, newId: () => "copy-1" }
    );

    const first = await syncdb.applySyncPlan(plan);
    expect(first.pagesUpdated).toBe(1);
    expect(first.pagesAdded).toBe(1);
    expect(first.pagesConflicted).toBe(1);

    const second = await syncdb.applySyncPlan(plan);
    expect(second.pagesAdded).toBe(0);
    expect(second.pagesUpdated).toBe(0);
    expect(second.pagesConflicted).toBe(1); // merge-level fact, reported on every apply
    expect((await notes.db.pages.toArray()).map((p) => p.id).sort()).toEqual(["copy-1", "p1"]);
  });

  it("never downgrades an already-newer persisted purge tombstone", async () => {
    await seedExplicit();
    // this device already recorded a NEWER purge record for p1
    await notes.db.tombstones.put({ id: "p1", kind: "page", at: T + 9000, title: "Alpha" });
    const local = await syncdb.readLocalSnapshot();
    const base = format.buildManifest(local, T);
    const remote: Format.LibrarySnapshot = {
      notebooks: local.notebooks,
      sections: local.sections,
      pages: [],
    };
    const plan = computeSyncPlan(
      {
        local,
        localPurges: [],
        remote,
        remoteTrash: [{ id: "p1", kind: "page", at: T + 1000, purged: true, title: "Alpha" }],
        base,
      },
      { now: T + 10000, newId: () => "unused" }
    );

    const summary = await syncdb.applySyncPlan(plan);
    expect(summary.pagesPurged).toBe(1);
    expect(await notes.db.pages.get("p1")).toBeUndefined();
    const tombstones = await notes.listPurgeTombstones();
    expect(tombstones.find((t) => t.id === "p1")?.at).toBe(T + 9000); // not downgraded to T+1000
  });
});
