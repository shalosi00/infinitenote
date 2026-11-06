/// <reference types="bun-types" />
/**
 * Store-level tests for sidebar multi-select bulk actions (issue #27):
 * bulkMovePages and bulkDeletePages drive the real Dexie layer
 * (fake-indexeddb) through the zustand store, asserting tree updates,
 * selection follow/recovery and expansion side effects.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");
let store: typeof import("../store");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  store = await import("../store");
});

beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

const state = () => store.useAppStore.getState();

/** Deterministic fixture: 2 notebooks × (1–2 sections) × pages. */
async function seed() {
  const nbA = await notes.createNotebook("Alpha", "violet");
  const nbB = await notes.createNotebook("Beta", "teal");
  const sA1 = await notes.createSection(nbA.id, "A1");
  const sA2 = await notes.createSection(nbA.id, "A2");
  const sB1 = await notes.createSection(nbB.id, "B1");
  const p1 = await notes.createPage(sA1.id, "One");
  const p2 = await notes.createPage(sA1.id, "Two");
  const p3 = await notes.createPage(sA1.id, "Three");
  const p4 = await notes.createPage(sB1.id, "Four");
  await state().refresh();
  return { nbA, nbB, sA1, sA2, sB1, p1, p2, p3, p4 };
}

describe("bulkMovePages", () => {
  it("moves the batch cross-section, appending after existing pages in visible order", async () => {
    const { sA1, sA2, p1, p2, p3, p4 } = await seed();

    const moved = await state().bulkMovePages([p3.id, p1.id, p2.id], sA2.id);

    expect(moved).toBe(3);
    const s = state();
    expect(s.pages.find((p) => p.id === p1.id)?.sectionId).toBe(sA2.id);
    expect(s.pages.find((p) => p.id === p2.id)?.sectionId).toBe(sA2.id);
    expect(s.pages.find((p) => p.id === p3.id)?.sectionId).toBe(sA2.id);
    // relative order preserved (p1 before p2 before p3), appended after nothing
    const inTarget = s.pages
      .filter((p) => p.sectionId === sA2.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.title);
    expect(inTarget).toEqual(["One", "Two", "Three"]);
    // untouched page stays put
    expect(s.pages.find((p) => p.id === p4.id)?.sectionId).not.toBe(sA2.id);
  });

  it("appends after existing target pages", async () => {
    const { sA1, sA2, p1, p4 } = await seed();
    await state().bulkMovePages([p4.id], sA2.id); // target now has "Four"
    await state().bulkMovePages([p1.id], sA2.id); // "One" must land after it

    const inTarget = state()
      .pages.filter((p) => p.sectionId === sA2.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.title);
    expect(inTarget).toEqual(["Four", "One"]);
  });

  it("selection follows the open page and the target section is expanded", async () => {
    const { nbB, sB1, sA1, p1 } = await seed();
    // open p1 explicitly
    state().selectPage({ notebookId: sA1.notebookId, sectionId: sA1.id, pageId: p1.id });

    await state().bulkMovePages([p1.id], sB1.id);

    const s = state();
    expect(s.selection?.pageId).toBe(p1.id);
    expect(s.selection?.sectionId).toBe(sB1.id);
    expect(s.selection?.notebookId).toBe(nbB.id);
    expect(s.expanded.has(sB1.id)).toBe(true);
    expect(s.expanded.has(nbB.id)).toBe(true);
  });

  it("is a no-op returning 0 for an empty batch or all-already-there batch", async () => {
    const { sA1, p1 } = await seed();
    expect(await state().bulkMovePages([], sA1.id)).toBe(0);
    expect(await state().bulkMovePages([p1.id], sA1.id)).toBe(0);
  });

  it("skips trashed pages and unknown ids", async () => {
    const { sA1, sA2, p1, p2 } = await seed();
    await notes.trashPage(p2.id);

    const moved = await state().bulkMovePages([p1.id, p2.id, "nope"], sA2.id);

    expect(moved).toBe(1);
    const s = state();
    expect(s.pages.find((p) => p.id === p1.id)?.sectionId).toBe(sA2.id);
    // trashed page is not in the alive listing at all
    expect(s.pages.find((p) => p.id === p2.id)).toBeUndefined();
  });
});

describe("bulkDeletePages", () => {
  it("trashes the whole batch with one shared timestamp", async () => {
    const { sA1, p1, p2, p3 } = await seed();

    const trashed = await state().bulkDeletePages([p1.id, p2.id, p3.id]);

    expect(trashed).toBe(3);
    const alive = state().pages.filter((p) => p.sectionId === sA1.id);
    expect(alive).toEqual([]);
    const trash = await notes.listTrash();
    expect(trash.pages.map((p) => p.title).sort()).toEqual(["One", "Three", "Two"]);
    const timestamps = new Set(trash.pages.filter((p) => ["One", "Two", "Three"].includes(p.title)).map((p) => p.deletedAt));
    expect(timestamps.size).toBe(1);
  });

  it("never lands the next selection on another deleted page", async () => {
    const { sA1, p1, p2, p3, p4 } = await seed();
    // open the middle page, delete all three of its section
    state().selectPage({ notebookId: sA1.notebookId, sectionId: sA1.id, pageId: p2.id });

    await state().bulkDeletePages([p1.id, p2.id, p3.id]);

    const sel = state().selection;
    expect(sel).not.toBeNull();
    expect([p1.id, p2.id, p3.id]).not.toContain(sel?.pageId);
    expect(sel?.pageId).toBe(p4.id); // first page anywhere else
  });

  it("keeps the current selection when it is not part of the batch", async () => {
    const { sA1, sB1, p1, p4 } = await seed();
    state().selectPage({ notebookId: sB1.notebookId, sectionId: sB1.id, pageId: p4.id });

    await state().bulkDeletePages([p1.id]);

    expect(state().selection?.pageId).toBe(p4.id);
  });

  it("skips already-trashed pages and dedupes ids", async () => {
    const { p1, p2 } = await seed();
    await notes.trashPage(p1.id);

    const trashed = await state().bulkDeletePages([p1.id, p2.id, p2.id]);

    expect(trashed).toBe(1);
    const trash = await notes.listTrash();
    expect(trash.pages).toHaveLength(2);
  });
});
