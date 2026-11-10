/// <reference types="bun-types" />
/**
 * Edge-case tests for the sync I/O helpers beyond sync-local.test.ts and
 * sync-summary.test.ts: exportSyncFolder on empty, cascaded-trash and purged
 * libraries (local.ts), the ZIP adapter's input/output boundaries (zip.ts —
 * Uint8Array input, empty maps, empty-string files), and the full English
 * label surface of the change summary (summary.ts). IndexedDB-backed parts
 * run on fake-indexeddb.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { formatSyncSummary, summaryPartLabel, type SummaryPart } from "../sync/summary";
import type { SyncSummary } from "../sync/merge";
import type * as Format from "../sync/format";
import type * as Notes from "../notes-db";
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

const trashLines = (folder: Format.SyncFolderFiles): Format.TrashEntry[] =>
  folder["trash.jsonl"].trim().split("\n").map((l) => JSON.parse(l) as Format.TrashEntry);

describe("exportSyncFolder (local.ts) edge cases", () => {
  it("exports an empty library as a valid, empty sync folder and base", async () => {
    const folder = await local.exportSyncFolder();
    expect(Object.keys(folder).sort()).toEqual(["manifest.json", "trash.jsonl"]);
    expect(folder["trash.jsonl"]).toBe("\n");
    const parsed = format.parseSyncFolder(folder);
    expect(parsed.manifest.notebooks).toEqual([]);
    expect(parsed.manifest.sections).toEqual([]);
    expect(parsed.manifest.pages).toEqual([]);
    const base = (await notes.readLastSyncManifest()) as Format.SyncManifest | null;
    expect(base?.app).toBe("infinitenote");
    expect(base?.pages).toEqual([]);
  });

  it("exports purge tombstones as final (purged) trash entries", async () => {
    const nb = await notes.createNotebook("Journal", "teal");
    const sec = await notes.createSection(nb.id, "Daily");
    const page = await notes.createPage(sec.id, "Alpha");
    await notes.trashPage(page.id);
    await notes.purgePage(page.id);

    const folder = await local.exportSyncFolder();

    expect(folder[`pages/${page.id}.json`]).toBeUndefined();
    expect(Object.keys(folder).sort()).toEqual(["manifest.json", "trash.jsonl"]);
    const entries = trashLines(folder);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: page.id, kind: "page", purged: true, title: "Alpha" });
    expect(entries[0].at).toBeGreaterThan(0);
  });

  it("cascades notebook trash into notebook/section/page tombstones", async () => {
    const nb = await notes.createNotebook("Work", "rose");
    const sec = await notes.createSection(nb.id, "Projects");
    await notes.createPage(sec.id, "Roadmap");
    await notes.trashNotebook(nb.id);

    const folder = await local.exportSyncFolder();

    const entries = trashLines(folder);
    expect(entries.map((e) => e.kind).sort()).toEqual(["notebook", "page", "section"]);
    expect(entries.every((e) => e.purged === false)).toBe(true);
    expect(entries.find((e) => e.kind === "notebook")?.title).toBe("Work");
    expect(format.parseSyncFolder(folder).manifest.notebooks).toEqual([]); // nothing alive
  });
});

describe("zip adapter (zip.ts) edge cases", () => {
  it("parses a Uint8Array directly, identically to an ArrayBuffer", async () => {
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
      "trash.jsonl": "\n",
      "pages/p1.json": JSON.stringify({ id: "p1", sectionId: "s1", title: "Alpha", scene: null }),
    };
    const blob = await zip.zipSyncFolder(files);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(await zip.parseSyncZip(bytes)).toEqual(files);
    expect(await zip.parseSyncZip(buffer)).toEqual(files);
  });

  it("round-trips an empty file map and preserves empty-string file contents", async () => {
    const empty = await zip.parseSyncZip(await (await zip.zipSyncFolder({})).arrayBuffer());
    expect(empty).toEqual({});
    const withEmptyFile = await zip.parseSyncZip(
      await (await zip.zipSyncFolder({ "trash.jsonl": "" })).arrayBuffer()
    );
    expect(withEmptyFile).toEqual({ "trash.jsonl": "" });
  });
});

describe("summary labels (summary.ts) edge cases", () => {
  const EMPTY: SyncSummary = {
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
  };

  it("renders the one/other branch for every part key", () => {
    const expected: Record<SummaryPart["key"], [string, string]> = {
      wNotebooks: ["1 notebook", "2 notebooks"],
      wSections: ["1 section", "2 sections"],
      wPagesPulled: ["1 page pulled", "2 pages pulled"],
      wPagesUpdated: ["1 page updated", "2 pages updated"],
      wConflicts: ["1 conflict copy", "2 conflict copies"],
      wTrashed: ["1 item moved to trash", "2 items moved to trash"],
      wTreeUpdated: ["1 notebook/section updated", "2 notebooks/sections updated"],
      wPurged: ["1 item purged", "2 items purged"],
    };
    for (const key of Object.keys(expected) as SummaryPart["key"][]) {
      expect(summaryPartLabel({ key, count: 1 })).toBe(expected[key][0]);
      expect(summaryPartLabel({ key, count: 2 })).toBe(expected[key][1]);
    }
  });

  it("formats a whole-library sync sentence and single-part variants", () => {
    const everything: SyncSummary = {
      ...EMPTY,
      notebooksAdded: 1,
      sectionsAdded: 1,
      pagesAdded: 1,
      pagesUpdated: 1,
      pagesConflicted: 1,
      pagesDeleted: 1,
      treeDeleted: 1,
      treeUpdated: 1,
      pagesPurged: 1,
      treePurged: 1,
    };
    expect(formatSyncSummary(everything)).toBe(
      "1 notebook · 1 section · 1 page pulled · 1 page updated · 1 conflict copy · " +
        "2 items moved to trash · 1 notebook/section updated · 2 items purged."
    );
    expect(formatSyncSummary({ ...EMPTY, pagesUpdated: 3 })).toBe("3 pages updated.");
    expect(formatSyncSummary({ ...EMPTY, treePurged: 1 })).toBe("1 item purged.");
  });
});
