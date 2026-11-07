/// <reference types="bun-types" />
/**
 * savePageContent contract (issue #78): saving against a vanished page row
 * (purged in another tab / removed by a sync round) must REJECT — Dexie's
 * update() silently no-ops on a missing key, which previously made the
 * autosave indicator report "Saved" while the content was discarded.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

describe("savePageContent (issue #78)", () => {
  it("persists the payload for an existing page and reads it back", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");

    const payload = { elements: [{ id: "e1", type: "rectangle" }], files: {} };
    await notes.savePageContent(page.id, payload);

    const back = await notes.getPageContent(page.id);
    expect(back).not.toBeNull();
    expect(back!.elements).toHaveLength(1);
  });

  it("rejects when the page row is gone (no silent data loss)", async () => {
    const payload = { elements: [], files: {} };
    await expect(notes.savePageContent("no-such-row", payload)).rejects.toThrow(
      /no longer exists/,
    );
  });

  it("still saves trashed pages — the row exists, only soft-deleted", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");
    await notes.trashPage(page.id);

    const payload = { elements: [], files: {} };
    await notes.savePageContent(page.id, payload); // must not throw
    const back = await notes.getPageContent(page.id);
    expect(back).not.toBeNull();
  });
});
