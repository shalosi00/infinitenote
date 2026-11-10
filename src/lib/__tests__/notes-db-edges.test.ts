/// <reference types="bun-types" />
/**
 * Edge-case tests for the Dexie data layer, run against fake-indexeddb.
 * Complements notes-db.test.ts with aspects it does not pin: listing
 * order tie-breaks, order-slot allocation around trashed siblings,
 * restore/purge guard clauses on alive or missing rows, tombstone
 * bookkeeping, per-row trash timestamps, corrupt-content lookups,
 * silent no-op writes, sync metadata, backup nesting and restore
 * fallbacks, the autosave version throttle and the full erase scope.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { RestoreError } from "../restore-error";

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

/** Fresh database for every test — no cross-test pollution. */
beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

/** fake-indexeddb settles writes asynchronously; distinct trash timestamps need a beat. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One notebook → one section, the minimal page host. */
async function host() {
  const nb = await notes.createNotebook("NB", "violet");
  const sec = await notes.createSection(nb.id, "S");
  return { nb, sec };
}

describe("ordering guarantees", () => {
  it("listPages breaks order ties by createdAt, then by id (byOrder contract)", async () => {
    const { sec } = await host();
    const row = (id: string, order: number, createdAt: number) => ({
      id,
      sectionId: sec.id,
      title: `T-${id}`,
      order,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      content: null,
    });
    await notes.db.pages.add(row("page-aaa", 5, 100));
    await notes.db.pages.add(row("page-bbb", 5, 100)); // same order AND createdAt → id decides
    await notes.db.pages.add(row("page-zzz", 5, 50)); // same order, older createdAt → first

    const titles = (await notes.listPages()).map((p) => p.title);
    expect(titles).toEqual(["T-page-zzz", "T-page-aaa", "T-page-bbb"]);
  });

  it("createPage and duplicatePage never reuse a trashed sibling's order slot", async () => {
    const { sec } = await host();
    const a = await notes.createPage(sec.id, "A"); // order 1
    await notes.createPage(sec.id, "B"); // order 2
    const c = await notes.createPage(sec.id, "C"); // order 3
    await notes.trashPage(c.id);

    const d = await notes.createPage(sec.id, "D");
    expect(d.order).toBe(4); // above the trashed row's slot, not filling it

    const copy = await notes.duplicatePage(a.id);
    expect(copy).not.toBeNull();
    expect(copy!.order).toBe(5); // duplicates also stay above trashed siblings

    const titles = (await notes.listPages())
      .filter((p) => p.sectionId === sec.id)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.title);
    expect(titles).toEqual(["A", "B", "D", "A (copy)"]);
  });
});

describe("restore / purge guard clauses", () => {
  it("restorePage / restoreSection / restoreNotebook on alive rows change nothing", async () => {
    const { nb, sec } = await host();
    const p1 = await notes.createPage(sec.id, "P1");
    const p2 = await notes.createPage(sec.id, "P2");
    await notes.trashPage(p2.id);

    await notes.restorePage(p1.id); // alive → no-op
    await notes.restoreSection(sec.id); // alive → must not resurrect p2
    await notes.restoreNotebook(nb.id); // alive → no-op

    expect((await notes.listPages()).map((p) => p.id)).toEqual([p1.id]);
    expect((await notes.listTrash()).pages.map((p) => p.id)).toEqual([p2.id]);
  });

  it("purgePage / purgeSection / purgeNotebook on missing ids are silent no-ops", async () => {
    const { sec } = await host();
    await notes.createPage(sec.id, "Keeper");

    await notes.purgePage("missing");
    await notes.purgeSection("missing");
    await notes.purgeNotebook("missing");

    expect(await notes.listPages()).toHaveLength(1);
    expect(await notes.listPurgeTombstones()).toEqual([]); // nothing tombstoned
  });

  it("purge records tombstones: a lone page first, then the full notebook cascade", async () => {
    const nb = await notes.createNotebook("NB1", "violet");
    const s1 = await notes.createSection(nb.id, "S1");
    const s2 = await notes.createSection(nb.id, "S2");
    const p1 = await notes.createPage(s1.id, "P1");
    const p2 = await notes.createPage(s1.id, "P2");
    const p3 = await notes.createPage(s2.id, "P3");

    await notes.purgePage(p1.id);
    let stones = await notes.listPurgeTombstones();
    expect(stones).toHaveLength(1);
    expect(stones[0]).toMatchObject({ id: p1.id, kind: "page", title: "P1" });

    await notes.purgeNotebook(nb.id); // takes s1, s2, p2, p3 with it
    stones = await notes.listPurgeTombstones();
    expect(stones).toHaveLength(6); // p1 + nb1 + s1 + s2 + p2 + p3
    const kindById = new Map(stones.map((s) => [s.id, s.kind]));
    expect(kindById.get(nb.id)).toBe("notebook");
    expect(kindById.get(s1.id)).toBe("section");
    expect(kindById.get(s2.id)).toBe("section");
    expect(kindById.get(p2.id)).toBe("page");
    expect(kindById.get(p3.id)).toBe("page");
    expect(await notes.listNotebooks()).toEqual([]);
    expect(await notes.listSections()).toEqual([]);
    expect(await notes.listPages()).toEqual([]);
  });
});

describe("per-row trash timestamps", () => {
  it("trashSection keeps individually-trashed pages on their own timestamp; restoreSection leaves them trashed", async () => {
    const { sec } = await host();
    const p1 = await notes.createPage(sec.id, "P1");
    const p2 = await notes.createPage(sec.id, "P2");

    await notes.trashPage(p1.id);
    await sleep(5);
    await notes.trashSection(sec.id); // cascades onto p2 only

    const trash = await notes.listTrash();
    const rowP1 = trash.pages.find((p) => p.id === p1.id)!;
    const rowP2 = trash.pages.find((p) => p.id === p2.id)!;
    expect(rowP1.deletedAt!).toBeLessThan(rowP2.deletedAt!); // p1 kept its earlier stamp

    await notes.restoreSection(sec.id);
    expect((await notes.listPages()).map((p) => p.id)).toEqual([p2.id]); // p1 stays in trash
    expect((await notes.listSections()).map((s) => s.id)).toEqual([sec.id]);
  });

  it("restorePage revives its trashed section and notebook (ancestor cascade)", async () => {
    const { nb, sec } = await host();
    const page = await notes.createPage(sec.id, "P");

    await notes.trashNotebook(nb.id); // cascades to sec and page
    await notes.restorePage(page.id);

    expect((await notes.listNotebooks()).map((n) => n.id)).toEqual([nb.id]);
    expect((await notes.listSections()).map((s) => s.id)).toEqual([sec.id]);
    expect((await notes.listPages()).map((p) => p.id)).toEqual([page.id]);
  });

  it("listTrash sorts newest-first and never leaks page content", async () => {
    const { nb, sec } = await host();
    const p1 = await notes.createPage(
      sec.id,
      "P1",
      JSON.stringify({ elements: [{ type: "text", text: "secret" }], files: {} })
    );
    const p2 = await notes.createPage(sec.id, "P2");

    await notes.trashPage(p1.id);
    await sleep(5);
    await notes.trashPage(p2.id);
    await sleep(5);
    await notes.trashNotebook(nb.id); // children already trashed keep their stamps

    const trash = await notes.listTrash();
    expect(trash.pages.map((p) => p.id)).toEqual([p2.id, p1.id]); // newest first
    expect("content" in trash.pages[0]).toBe(false); // heavy scene payload stays out
    expect(trash.sections.map((s) => s.id)).toEqual([sec.id]);
    expect(trash.notebooks.map((n) => n.id)).toEqual([nb.id]);
  });
});

describe("lookup failures and silent no-op writes", () => {
  it("getPageContent returns null for corrupt JSON and for missing rows", async () => {
    const { sec } = await host();
    const corrupt = await notes.createPage(sec.id, "Corrupt", "{corrupt json");

    expect(await notes.getPageContent(corrupt.id)).toBeNull(); // unparseable, not garbage
    expect(await notes.getPageContent("no-such-row")).toBeNull();
  });

  it("renames, recolors, metadata writes and moves against missing rows are silent no-ops", async () => {
    const { nb } = await host();
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");

    await notes.renameNotebook("missing", "X");
    await notes.renameSection("missing", "X");
    await notes.renamePage("missing", "X");
    await notes.setNotebookColor("missing", "teal");
    await notes.setPageBackground("missing", "grid");
    await notes.setPageTags("missing", ["t"]);
    await notes.moveNotebook("missing", 1);
    await notes.moveSection("missing", 1);
    await notes.movePage("missing", 1);

    const nbs = await notes.listNotebooks();
    expect(nbs).toHaveLength(1);
    expect(nbs[0].name).toBe("NB");
    const pages = await notes.listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].background).toBeUndefined();
    expect(pages[0].tags).toBeUndefined();
  });
});

describe("sync metadata store", () => {
  it("manifest round-trips, replaces on overwrite and clears via clearSyncState", async () => {
    expect(notes.LAST_SYNC_KEY).toBe("lastSyncManifest");
    expect(await notes.readLastSyncManifest()).toBeNull(); // never synced

    await notes.writeLastSyncManifest({ pages: 3, at: 123 });
    expect(await notes.readLastSyncManifest()).toEqual({ pages: 3, at: 123 });

    await notes.writeLastSyncManifest({ pages: 4 });
    expect(await notes.readLastSyncManifest()).toEqual({ pages: 4 }); // replaced, not merged

    await notes.clearSyncState();
    expect(await notes.readLastSyncManifest()).toBeNull();
  });
});

describe("backup / restore edges", () => {
  it("buildBackup nests only alive rows: an individually trashed section (and its pages) is excluded", async () => {
    const nb1 = await notes.createNotebook("NB1", "violet");
    const nb2 = await notes.createNotebook("NB2", "teal");
    const s1 = await notes.createSection(nb1.id, "S1");
    const s2 = await notes.createSection(nb1.id, "S2");
    const s3 = await notes.createSection(nb2.id, "S3");
    await notes.createPage(s1.id, "Pa");
    await notes.createPage(s1.id, "Pb");
    await notes.createPage(s2.id, "Pc");
    await notes.createPage(s3.id, "Pd");
    await notes.trashSection(s2.id);

    const parsed = JSON.parse(await notes.buildBackup());

    expect(parsed.notebooks.map((n: { name: string }) => n.name)).toEqual(["NB1", "NB2"]);
    expect(parsed.notebooks[0].sections.map((s: { name: string }) => s.name)).toEqual(["S1"]);
    expect(
      parsed.notebooks[0].sections[0].pages.map((p: { title: string }) => p.title)
    ).toEqual(["Pa", "Pb"]);
    expect(parsed.notebooks[1].sections.map((s: { name: string }) => s.name)).toEqual(["S3"]);
    expect(typeof parsed.exportedAt).toBe("number");
    expect(parsed.exportedAt).toBeGreaterThan(0);
  });

  it("restoreBackup rejects a non-array notebooks field with the typed error; an empty array restores 0", async () => {
    await expect(
      notes.restoreBackup('{"app":"infinitenote","notebooks":{}}')
    ).rejects.toThrow("Not an InfiniteNote");

    try {
      await notes.restoreBackup('{"app":"infinitenote","notebooks":42}');
      expect.unreachable("restoreBackup must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe("notABackup");
    }

    expect(await notes.restoreBackup('{"app":"infinitenote","notebooks":[]}')).toBe(0);
    expect(await notes.listNotebooks()).toEqual([]); // nothing was written
  });

  it("restoreBackup fills generated fallback names for blank or missing fields", async () => {
    const json = JSON.stringify({
      app: "infinitenote",
      notebooks: [
        {
          name: "   ", // whitespace-only
          sections: [{ name: "", pages: [{ title: "  " }] }], // empty / whitespace
        },
      ],
    });

    expect(await notes.restoreBackup(json)).toBe(1);
    expect((await notes.listNotebooks())[0].name).toBe("Restored notebook");
    expect((await notes.listSections())[0].name).toBe("Restored section");
    expect((await notes.listPages())[0].title).toBe("Restored page");
  });

  it("restoreBackup appends fresh-id rows after existing ones without touching them", async () => {
    const { nb, sec } = await host();
    const kept = await notes.createPage(
      sec.id,
      "Kept",
      JSON.stringify({ elements: [], files: {} })
    );
    const backup = await notes.buildBackup(); // holds the "NB"/"S"/"Kept" tree

    expect(await notes.restoreBackup(backup)).toBe(1);

    const notebooks = await notes.listNotebooks();
    expect(notebooks).toHaveLength(2);
    expect(new Set(notebooks.map((n) => n.id)).size).toBe(2); // fresh ids, no collision
    const original = notebooks.find((n) => n.id === nb.id)!;
    const restored = notebooks.find((n) => n.id !== nb.id)!;
    expect(original.name).toBe("NB");
    expect(restored.name).toBe("NB"); // same content, new row
    expect(restored.order).toBeGreaterThan(original.order); // appended at the end

    const pages = await notes.listPages();
    expect(pages).toHaveLength(2);
    expect(pages.find((p) => p.id === kept.id)).toBeDefined(); // original untouched
    const restoredPage = pages.find((p) => p.id !== kept.id)!;
    expect(restoredPage.title).toBe("Kept");
    expect(await notes.getPageContent(restoredPage.id)).not.toBeNull(); // content survived
  });
});

describe("autosave version throttle", () => {
  it("maybeRecordAutoVersion records the first snapshot and throttles immediate repeats", async () => {
    const { sec } = await host();
    const page = await notes.createPage(sec.id, "P");
    const sceneA = { elements: [{ type: "text", text: "a" }], files: {} };
    const sceneB = { elements: [{ type: "text", text: "b" }], files: {} };

    expect(await notes.maybeRecordAutoVersion(page.id, sceneA)).toBe(true); // first ever
    expect(await notes.maybeRecordAutoVersion(page.id, sceneA)).toBe(false); // same scene
    expect(await notes.maybeRecordAutoVersion(page.id, sceneB)).toBe(false); // changed but inside the 5-min window

    const versions = await notes.listPageVersions(page.id);
    expect(versions).toHaveLength(1); // exactly one snapshot was stored
    expect(versions[0].source).toBe("auto");
  });
});

describe("destructive reset scope", () => {
  it("eraseAllData clears tombstones and sync state as well as the tree", async () => {
    const { sec } = await host();
    const page = await notes.createPage(sec.id, "P");
    await notes.purgePage(page.id); // leaves a tombstone behind
    await notes.writeLastSyncManifest({ pages: 1 });

    await notes.eraseAllData();

    expect(await notes.listPurgeTombstones()).toEqual([]);
    expect(await notes.readLastSyncManifest()).toBeNull();
    expect(await notes.listNotebooks()).toEqual([]);
    expect(await notes.listSections()).toEqual([]);
    expect(await notes.listPages()).toEqual([]);
  });
});
