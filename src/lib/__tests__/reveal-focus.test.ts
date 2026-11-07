/// <reference types="bun-types" />
/**
 * revealSelection (issue #82) and canvas-focus on create/duplicate
 * (issue #81) — store-level behavior only, driven through the real Dexie
 * layer (fake-indexeddb).
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

async function seed() {
  const nbA = await notes.createNotebook("Alpha", "violet");
  const nbB = await notes.createNotebook("Beta", "teal");
  const sB1 = await notes.createSection(nbB.id, "B1");
  const p1 = await notes.createPage(sB1.id, "Deep page");
  await state().refresh();
  return { nbA, nbB, sB1, p1 };
}

describe("revealSelection (issue #82)", () => {
  it("selects the page AND expands its collapsed ancestors", async () => {
    const { nbB, sB1, p1 } = await seed();

    // collapse everything first — the jump target is invisible
    store.useAppStore.setState({ expanded: new Set<string>() });
    expect(state().expanded.has(nbB.id)).toBe(false);
    expect(state().expanded.has(sB1.id)).toBe(false);

    state().revealSelection({ notebookId: nbB.id, sectionId: sB1.id, pageId: p1.id });

    expect(state().selection?.pageId).toBe(p1.id);
    expect(state().expanded.has(nbB.id)).toBe(true);
    expect(state().expanded.has(sB1.id)).toBe(true);
  });

  it("keeps previously expanded nodes open (additive reveal)", async () => {
    const { nbA, nbB, sB1, p1 } = await seed();
    store.useAppStore.setState({ expanded: new Set<string>([nbA.id]) });

    state().revealSelection({ notebookId: nbB.id, sectionId: sB1.id, pageId: p1.id });

    expect(state().expanded.has(nbA.id)).toBe(true);
    expect(state().expanded.has(sB1.id)).toBe(true);
  });

  it("plain selectPage still only moves the selection (no expansion)", async () => {
    const { nbB, sB1, p1 } = await seed();
    store.useAppStore.setState({ expanded: new Set<string>() });

    state().selectPage({ notebookId: nbB.id, sectionId: sB1.id, pageId: p1.id });

    expect(state().selection?.pageId).toBe(p1.id);
    expect(state().expanded.has(sB1.id)).toBe(false);
  });
});

describe("canvas focus on create / duplicate (issue #81)", () => {
  it("addPage bumps the canvasFocus counter", async () => {
    const { sB1 } = await seed();
    const before = state().canvasFocus;
    await state().addPage(sB1.id, "New page");
    expect(state().canvasFocus).toBe(before + 1);
    const selected = state().pages.find((p) => p.id === state().selection?.pageId);
    expect(selected?.title).toBe("New page");
  });

  it("duplicatePage bumps the canvasFocus counter", async () => {
    const { p1 } = await seed();
    const before = state().canvasFocus;
    await state().duplicatePage(p1.id);
    expect(state().canvasFocus).toBe(before + 1);
  });
});
