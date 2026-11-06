/// <reference types="bun-types" />
/**
 * Unit tests for the sync adapters: ZIP round trips (fflate) and the
 * local-device sync state (export-only folder, handle persistence).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type * as Notes from "../notes-db";
import type * as Format from "../sync/format";
import type * as Local from "../sync/local";
import type * as Zip from "../sync/zip";

let notes: typeof Notes;
let format: typeof Format;
let local: typeof Local;
let zip: typeof Zip;

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  format = await import("../sync/format");
  local = await import("../sync/local");
  zip = await import("../sync/zip");
});

beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

describe("zip adapter", () => {
  it("round-trips a folder file map (unicode-safe)", async () => {
    const files: Format.SyncFolderFiles = {
      "manifest.json": JSON.stringify({
        app: "infinitenote",
        format: "sync-folder",
        version: 1,
        exportedAt: 1,
        notebooks: [],
        sections: [],
        pages: [],
      }),
      "trash.jsonl": '{"id":"p1","kind":"page","at":5,"purged":false,"title":"Ünïcode ✓"}\n',
      "pages/p1.json": JSON.stringify({ id: "p1", title: "Zoë's notes — ✓", scene: null }),
      "pages/p_2-x.json": "null",
    };
    const blob = await zip.zipSyncFolder(files);
    const back = await zip.parseSyncZip(await blob.arrayBuffer());
    expect(back).toEqual(files);
  });

  it("is accepted by the folder parser (end-to-end through a ZIP)", async () => {
    const nb = await notes.createNotebook("Journal", "teal");
    const sec = await notes.createSection(nb.id, "Daily");
    await notes.createPage(sec.id, "Alpha");
    const folder = await local.exportSyncFolder();
    const blob = await zip.zipSyncFolder(folder);
    const parsed = format.parseSyncFolder(await zip.parseSyncZip(await blob.arrayBuffer()));
    expect(parsed.manifest.notebooks.map((n) => n.name)).toEqual(["Journal"]);
    expect(parsed.manifest.pages.map((p) => p.title)).toEqual(["Alpha"]);
  });
});

describe("exportSyncFolder (local.ts)", () => {
  it("snapshots the library and remembers it as the sync base", async () => {
    const nb = await notes.createNotebook("Work", "rose");
    const sec = await notes.createSection(nb.id, "Projects");
    await notes.createPage(sec.id, "Roadmap");

    const folder = await local.exportSyncFolder();
    expect(Object.keys(folder).sort()).toEqual(
      ["manifest.json", "trash.jsonl", `pages/${(await notes.listPages())[0].id}.json`].sort()
    );
    const base = (await notes.readLastSyncManifest()) as Format.SyncManifest | null;
    expect(base?.notebooks.map((n) => n.name)).toEqual(["Work"]);
    // trashed rows are NOT exported but appear as soft tombstones
    const page = (await notes.listPages())[0];
    await notes.trashPage(page.id);
    const folder2 = await local.exportSyncFolder();
    expect(folder2[`pages/${page.id}.json`]).toBeUndefined();
    expect(JSON.parse(folder2["trash.jsonl"].trim())).toMatchObject({ id: page.id, purged: false });
  });

  it("persists and clears the sync folder handle", async () => {
    expect(await local.loadSyncFolderHandle()).toBeNull();
    const fakeHandle = { kind: "directory", name: "notes-sync" } as never;
    await local.saveSyncFolderHandle(fakeHandle);
    expect((await local.loadSyncFolderHandle())?.name).toBe("notes-sync");
    await local.clearSyncFolderHandle();
    expect(await local.loadSyncFolderHandle()).toBeNull();
  });
});
