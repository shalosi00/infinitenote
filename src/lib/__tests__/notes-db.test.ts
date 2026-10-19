/// <reference types="bun-types" />
/**
 * Integration tests for the Dexie data layer, run against fake-indexeddb.
 *
 * The side-effect import must complete before notes-db.ts is evaluated
 * (it constructs the Dexie instance at module scope), so both are loaded
 * dynamically inside beforeAll.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

/** Fresh database for every test — no cross-test pollution. */
beforeEach(async () => {
  await notes.db.delete();
  // fake-indexeddb settles deletes asynchronously — give it a beat before
  // reopening so the new connection never races the teardown
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

describe("notebooks crud", () => {
  it("creates, lists and orders notebooks", async () => {
    const a = await notes.createNotebook("Alpha", "violet");
    const b = await notes.createNotebook("Beta", "teal");
    const list = await notes.listNotebooks();
    expect(list.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
    expect(a.order).toBeLessThan(b.order);
  });

  it("renames notebooks", async () => {
    const nb = await notes.createNotebook("Rename me", "rose");
    await notes.renameNotebook(nb.id, "Renamed");
    const list = await notes.listNotebooks();
    expect(list.find((n) => n.id === nb.id)?.name).toBe("Renamed");
  });

  it("moves notebooks up and down, no-op at the edges", async () => {
    const n1 = await notes.createNotebook("first", "violet");
    const n2 = await notes.createNotebook("second", "teal");
    await notes.moveNotebook(n2.id, -1);
    let names = (await notes.listNotebooks()).map((n) => n.name);
    expect(names.indexOf("second")).toBeLessThan(names.indexOf("first"));
    // "second" is now on top → moving up is a no-op
    await notes.moveNotebook(n2.id, -1);
    names = (await notes.listNotebooks()).map((n) => n.name);
    expect(names.indexOf("second")).toBeLessThan(names.indexOf("first"));
    // "first" is at the bottom → moving down is a no-op
    await notes.moveNotebook(n1.id, 1);
    names = (await notes.listNotebooks()).map((n) => n.name);
    expect(names.indexOf("second")).toBeLessThan(names.indexOf("first"));
    expect(names).toHaveLength(2);
  });

  it("recolors notebooks", async () => {
    const nb = await notes.createNotebook("colorful", "violet");
    await notes.setNotebookColor(nb.id, "emerald");
    const list = await notes.listNotebooks();
    expect(list.find((n) => n.id === nb.id)?.color).toBe("emerald");
  });
});

describe("sections and pages", () => {
  it("creates sections inside a notebook and orders them", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const s1 = await notes.createSection(nb.id, "One");
    const s2 = await notes.createSection(nb.id, "Two");
    expect(s1.order).toBeLessThan(s2.order);
    const list = await notes.listSections();
    expect(list.filter((s) => s.notebookId === nb.id).map((s) => s.name)).toEqual(["One", "Two"]);
  });

  it("creates pages with content and reads them back", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const content = JSON.stringify({
      elements: [{ type: "text", text: "hello" }],
      files: { f1: { id: "f1", dataURL: "data:image/png;base64,x", mimeType: "image/png", created: 1 } },
    });
    const page = await notes.createPage(sec.id, "With content", content);
    const back = await notes.getPageContent(page.id);
    expect(back).not.toBeNull();
    expect(back?.elements).toHaveLength(1);
    expect(back?.files.f1.dataURL).toContain("base64");
  });

  it("savePageContent overwrites", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P", null);
    expect(await notes.getPageContent(page.id)).toBeNull();
    await notes.savePageContent(page.id, {
      elements: [{ type: "rectangle" }],
      files: {},
    });
    const back = await notes.getPageContent(page.id);
    expect(back?.elements).toEqual([{ type: "rectangle" }]);
  });

  it("moves pages within a section", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const p1 = await notes.createPage(sec.id, "A");
    const p2 = await notes.createPage(sec.id, "B");
    const p3 = await notes.createPage(sec.id, "C");
    await notes.movePage(p3.id, -1); // C B A
    await notes.movePage(p1.id, 1); // C A B
    const names = (await notes.listPages())
      .filter((p) => p.sectionId === sec.id)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.title);
    expect(names).toEqual(["C", "A", "B"]);
  });

  it("duplicates a page: fresh id, (copy) suffix, last order, content preserved", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    await notes.createPage(sec.id, "First");
    const src = await notes.createPage(
      sec.id,
      "Notes",
      JSON.stringify({ elements: [{ type: "text", text: "hello" }], files: {} })
    );

    const copy = await notes.duplicatePage(src.id);

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(src.id);
    expect(copy!.sectionId).toBe(sec.id);
    expect(copy!.title).toBe("Notes (copy)");

    const pages = (await notes.listPages()).filter((p) => p.sectionId === sec.id);
    expect(pages).toHaveLength(3);
    expect(pages.sort((a, b) => a.order - b.order).map((p) => p.title)).toEqual([
      "First",
      "Notes",
      "Notes (copy)",
    ]);

    const content = await notes.getPageContent(copy!.id);
    expect(content?.elements).toEqual([{ type: "text", text: "hello" }]);
    // the original keeps its own id and content untouched
    expect((await notes.getPageContent(src.id))?.elements).toEqual([{ type: "text", text: "hello" }]);
  });

  it("duplicatePage returns null for missing or trashed sources", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const doomed = await notes.createPage(sec.id, "Doomed");
    await notes.trashPage(doomed.id);
    expect(await notes.duplicatePage(doomed.id)).toBeNull();
    expect(await notes.duplicatePage("no-such-id")).toBeNull();
  });
});

describe("trash", () => {
  it("soft-deletes and restores a page", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");
    await notes.trashPage(page.id);
    expect((await notes.listPages()).find((p) => p.id === page.id)).toBeUndefined();
    await notes.restorePage(page.id);
    expect((await notes.listPages()).find((p) => p.id === page.id)).toBeDefined();
  });

  it("cascades notebook trash and restores exactly its children", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const s1 = await notes.createSection(nb.id, "S1");
    const s2 = await notes.createSection(nb.id, "S2");
    const p1 = await notes.createPage(s1.id, "P1");
    const p2 = await notes.createPage(s2.id, "P2");

    // trash a lone page first (earlier timestamp → must stay trashed)
    await notes.trashPage(p1.id);
    await new Promise((r) => setTimeout(r, 5)); // ensure distinct timestamps

    await notes.trashNotebook(nb.id); // cascades to s1, s2, p2 with same ts
    expect(await notes.listNotebooks()).not.toContainEqual(expect.objectContaining({ id: nb.id }));
    expect((await notes.listPages()).length).toBe(0);

    await notes.restoreNotebook(nb.id);
    const sections = await notes.listSections();
    const pages = await notes.listPages();
    // s2 + p2 restored with the notebook; s1 restored as well (same cascade),
    // but p1 (trashed earlier with its own ts) must remain in trash
    expect(sections.map((s) => s.name).sort()).toEqual(["S1", "S2"]);
    expect(pages.map((p) => p.title)).toEqual(["P2"]);
  });

  it("restoring a section un-trashes its notebook", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    await notes.createPage(sec.id, "P");
    await notes.trashNotebook(nb.id);
    await notes.restoreSection(sec.id);
    expect((await notes.listNotebooks()).find((n) => n.id === nb.id)).toBeDefined();
    expect((await notes.listPages()).length).toBe(1);
  });

  it("purges permanently", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");
    await notes.trashNotebook(nb.id);
    await notes.purgeNotebook(nb.id);
    expect((await notes.listTrash()).notebooks).toHaveLength(0);
    expect((await notes.listSections()).length).toBe(0);
    expect((await notes.listPages()).length).toBe(0);
    expect(await notes.getPageContent(page.id)).toBeNull();
  });
});

describe("backup / restore", () => {
  it("round-trips a full library through buildBackup + restoreBackup", async () => {
    const nb = await notes.createNotebook("Backup NB", "teal");
    const s1 = await notes.createSection(nb.id, "Sec One");
    const s2 = await notes.createSection(nb.id, "Sec Two");
    await notes.createPage(s1.id, "Page A", JSON.stringify({ elements: [{ type: "text", text: "content A" }], files: {} }));
    await notes.createPage(s1.id, "Page B", null);
    await notes.createPage(s2.id, "Page C", null);

    // also add trashed items — must NOT be part of the backup
    const trashed = await notes.createNotebook("Trashed NB", "rose");
    await notes.trashNotebook(trashed.id);

    const json = await notes.buildBackup();
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe("infinitenote");
    expect(parsed.version).toBe(1);
    expect(parsed.notebooks).toHaveLength(1);
    expect(parsed.notebooks[0].name).toBe("Backup NB");
    expect(parsed.notebooks[0].sections).toHaveLength(2);

    const beforeSections = (await notes.listSections()).length;
    const restoredPages = await notes.restoreBackup(json);
    expect(restoredPages).toBe(3);

    // restore merges as NEW records (no collisions, nothing overwritten)
    const sectionsAfter = await notes.listSections();
    expect(sectionsAfter.length).toBe(beforeSections + 2);
    const pagesAfter = await notes.listPages();
    expect(pagesAfter.filter((p) => p.title === "Page A")).toHaveLength(2);
    // restored content survives
    const restoredA = pagesAfter.filter((p) => p.title === "Page A")[0];
    const content = await notes.getPageContent(restoredA.id);
    expect(content?.elements).toEqual([{ type: "text", text: "content A" }]);
  });

  it("rejects foreign files", async () => {
    expect(notes.restoreBackup('{"app":"other","notebooks":[]}')).rejects.toThrow("Not an InfiniteNote");
  });

  it("eraseAllData wipes everything", async () => {
    const nb = await notes.createNotebook("Doomed", "violet");
    const sec = await notes.createSection(nb.id, "S");
    await notes.createPage(sec.id, "P", null);
    await notes.eraseAllData();
    expect(await notes.listNotebooks()).toHaveLength(0);
    expect(await notes.listSections()).toHaveLength(0);
    expect(await notes.listPages()).toHaveLength(0);
  });
});
