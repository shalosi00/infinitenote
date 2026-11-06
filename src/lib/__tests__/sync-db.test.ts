/// <reference types="bun-types" />
/**
 * Integration tests for the sync I/O layer (sync/db.ts) against
 * fake-indexeddb: full two-device round trips through the folder format,
 * conflict copies on concurrent edits, purge protection, and summary
 * honesty. "Devices" are simulated by wiping the DB (but not the in-memory
 * folder variables) between phases.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type * as Format from "../sync/format";
import type * as Notes from "../notes-db";
import type * as SyncDb from "../sync/db";

let notes: typeof Notes;
let syncdb: typeof SyncDb;
let format: typeof Format;

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

const scene = (mark: string) => JSON.stringify({ elements: [{ mark }], files: {} });

/** Seed a small library: Notebook/Section/{Alpha, Beta}. */
async function seedLibrary() {
  const nb = await notes.createNotebook("Journal", "teal");
  const sec = await notes.createSection(nb.id, "Daily");
  const alpha = await notes.createPage(sec.id, "Alpha");
  await notes.savePageContent(alpha.id, { elements: [{ mark: "alpha" }], files: {} });
  const beta = await notes.createPage(sec.id, "Beta");
  return { nb, sec, alpha, beta };
}

describe("export → import round trip (fresh device)", () => {
  it("a second device pulls the whole library from the folder", async () => {
    const { alpha } = await seedLibrary();
    // device A exports
    const aSnap = await syncdb.readLocalSnapshot();
    const folder = format.buildSyncFolderFiles(aSnap, [], Date.now());

    // device B: empty DB, first sync
    await notes.eraseAllData();
    const result = await syncdb.runSync(folder);

    const pages = await notes.listPages();
    expect(pages.map((p) => p.title).sort()).toEqual(["Alpha", "Beta"]);
    const content = await notes.getPageContent(alpha.id);
    expect(content?.elements).toEqual([{ mark: "alpha" }]);
    expect(result.summary.pagesAdded).toBe(2);
    expect(result.summary.pagesUpdated).toBe(0);
    // folder reflects the merged state — idempotent for B
    expect(Object.keys(result.folder).sort()).toEqual(
      ["manifest.json", "trash.jsonl", `pages/${alpha.id}.json`, `pages/${pages.find((p) => p.title === "Beta")!.id}.json`].sort()
    );
  });

  it("syncing the same folder twice is a no-op the second time", async () => {
    await seedLibrary();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder);
    const second = await syncdb.runSync(folder);
    expect(second.summary.pagesAdded).toBe(0);
    expect(second.summary.pagesUpdated).toBe(0);
    expect(second.summary.pagesConflicted).toBe(0);
  });
});

describe("push: local edits flow into the folder", () => {
  it("an edit made offline is pushed and the folder carries it", async () => {
    const { alpha } = await seedLibrary();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder); // device B joins

    await notes.renamePage(alpha.id, "Alpha renamed on B");
    const result = await syncdb.runSync(folder);
    expect(result.summary.pagesUpdated).toBe(0); // B already has its own edit
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.manifest.pages.find((p) => p.id === alpha.id)?.title).toBe("Alpha renamed on B");
  });
});

describe("conflict: both devices edited the same page", () => {
  it("the merging device keeps the newer side and materializes the loser as a copy", async () => {
    const { alpha } = await seedLibrary();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder); // B has Alpha

    // B edits offline
    await notes.savePageContent(alpha.id, { elements: [{ mark: "B-edit" }], files: {} });
    // A (simulated) also edited — rebuild the folder with a newer page file
    const aParsed = format.parseSyncFolder(folder);
    const aPage = aParsed.pages.get(alpha.id)!;
    const newer = Date.now() + 10_000; // A's clock is ahead → A wins the shared id
    const aFolder: Format.SyncFolderFiles = {
      ...folder,
      [`pages/${alpha.id}.json`]: JSON.stringify({
        ...JSON.parse(folder[`pages/${alpha.id}.json`]!),
        title: "Alpha (edited on A)",
        updatedAt: newer,
        scene: { elements: [{ mark: "A-edit" }], files: {} },
      }),
      "manifest.json": JSON.stringify(
        {
          ...aParsed.manifest,
          exportedAt: newer,
          pages: aParsed.manifest.pages.map((p) =>
            p.id === alpha.id ? { ...p, title: "Alpha (edited on A)", updatedAt: newer } : p
          ),
        },
        null,
        2
      ),
    };

    const result = await syncdb.runSync(aFolder);
    expect(result.summary.pagesConflicted).toBe(1);

    const pages = await notes.listPages();
    const winner = pages.find((p) => p.id === alpha.id)!;
    expect(winner.title).toBe("Alpha (edited on A)");
    // B's row (titled "Alpha", content B-edit) survives as a dated conflict copy
    const copy = pages.find((p) => p.id !== alpha.id && p.title.startsWith("Alpha (conflict"));
    expect(copy).toBeDefined();
    const copyContent = await notes.getPageContent(copy!.id);
    expect(copyContent?.elements).toEqual([{ mark: "B-edit" }]);
  });
});

describe("deletes across devices", () => {
  it("a page trashed on the other device lands in this device's trash", async () => {
    const { alpha } = await seedLibrary();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder);

    // A trashed the page: manifest without it + soft tombstone
    const parsed = format.parseSyncFolder(folder);
    const at = Date.now() + 1000;
    const trashLines = folder["trash.jsonl"].trim().split("\n");
    const aFolder: Format.SyncFolderFiles = {
      ...folder,
      "manifest.json": JSON.stringify(
        { ...parsed.manifest, pages: parsed.manifest.pages.filter((p) => p.id !== alpha.id) },
        null,
        2
      ),
      "trash.jsonl":
        [...trashLines, JSON.stringify({ id: alpha.id, kind: "page", at, purged: false, title: "Alpha" })].join("\n") +
        "\n",
    };
    delete aFolder[`pages/${alpha.id}.json`];

    const result = await syncdb.runSync(aFolder);
    expect(result.summary.pagesDeleted).toBe(1);
    const trash = await notes.listTrash();
    expect(trash.pages.map((p) => p.id)).toContain(alpha.id);
  });

  it("a purge on this device beats a stale folder that still has the page", async () => {
    const { alpha } = await seedLibrary();
    const folder = format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now());
    await notes.eraseAllData();
    await syncdb.runSync(folder);

    // B purges the page (tombstone recorded by notes-db)
    await notes.trashPage(alpha.id);
    await notes.purgePage(alpha.id);
    const result = await syncdb.runSync(folder); // folder is stale: still lists alpha

    expect(await notes.db.pages.get(alpha.id)).toBeUndefined();
    expect(result.summary.pagesAdded).toBe(0);
    const parsed = format.parseSyncFolder(result.folder);
    expect(parsed.trash.get(alpha.id)?.purged).toBe(true); // tombstone re-exported
    expect(parsed.manifest.pages.some((p) => p.id === alpha.id)).toBe(false);
  });
});

describe("sync state persistence", () => {
  it("stores the last-synced manifest and purges forget with a hard reset", async () => {
    await seedLibrary();
    await syncdb.runSync(
      format.buildSyncFolderFiles(await syncdb.readLocalSnapshot(), [], Date.now())
    );
    const base = await notes.readLastSyncManifest();
    expect((base as Format.SyncManifest | null)?.app).toBe("infinitenote");

    await notes.purgePage((await notes.listPages())[0].id);
    expect((await notes.listPurgeTombstones()).length).toBe(1);
    await notes.eraseAllData();
    expect(await notes.readLastSyncManifest()).toBeNull();
    expect(await notes.listPurgeTombstones()).toHaveLength(0);
  });

  it("purging a notebook tombstones its whole subtree", async () => {
    const { nb, sec, alpha, beta } = await seedLibrary();
    await notes.trashNotebook(nb.id);
    await notes.purgeNotebook(nb.id);
    const tombstones = await notes.listPurgeTombstones();
    expect(tombstones.map((t) => t.id).sort()).toEqual([alpha.id, beta.id, nb.id, sec.id].sort());
    expect(await notes.db.notebooks.toArray()).toHaveLength(0);
  });
});
