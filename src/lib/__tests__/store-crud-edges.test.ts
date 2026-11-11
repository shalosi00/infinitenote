/// <reference types="bun-types" />
/**
 * Store-level tests for the CRUD edges the other store suites do not pin:
 * refresh/selection/expansion semantics, rename + recolor flows, move
 * no-ops at list edges, add* numbering defaults, duplicate/delete
 * selection behavior, page metadata, UI slice setters, trash
 * restore/purge round-trips and the destructive reset — all driven
 * through the real Dexie layer (fake-indexeddb) via the zustand store.
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
  // The store module is a singleton shared by every file in this suite —
  // normalize it so assertions never depend on tests that ran before.
  store.useAppStore.setState({
    loaded: false,
    loadError: null,
    notebooks: [],
    sections: [],
    pages: [],
    selection: null,
    expanded: new Set<string>(),
    saveIndicator: "idle",
    searchOpen: false,
    trashOpen: false,
    shortcutsOpen: false,
    historyOpen: false,
    tagFilter: null,
    canvasFocus: 0,
  });
});

const state = () => store.useAppStore.getState();

/** Deterministic fixture: 2 notebooks × (1–2 sections) × pages.
 * A short pause before Beta's section keeps createdAt strictly ordered, so
 * the byOrder tie-break (order 1 vs order 1 across notebooks) never falls
 * through to the random uuid comparison. */
async function seed() {
  const nbA = await notes.createNotebook("Alpha", "violet");
  const nbB = await notes.createNotebook("Beta", "teal");
  const sA1 = await notes.createSection(nbA.id, "A1");
  const sA2 = await notes.createSection(nbA.id, "A2");
  await new Promise((r) => setTimeout(r, 5));
  const sB1 = await notes.createSection(nbB.id, "B1");
  const p1 = await notes.createPage(sA1.id, "One");
  const p2 = await notes.createPage(sA1.id, "Two");
  const p3 = await notes.createPage(sA1.id, "Three");
  const p4 = await notes.createPage(sB1.id, "Four");
  await state().refresh();
  return { nbA, nbB, sA1, sA2, sB1, p1, p2, p3, p4 };
}

/** Alive pages of one section in sidebar order. */
const titlesIn = (sectionId: string) =>
  state()
    .pages.filter((p) => p.sectionId === sectionId)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.title);

describe("refresh / selection / expansion", () => {
  it("loads the tree, marks the store loaded and opens the first page with default expansion", async () => {
    const { nbA, sA1, p1 } = await seed();

    const s = state();
    expect(s.loaded).toBe(true);
    expect(s.notebooks.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
    expect(s.sections).toHaveLength(3);
    expect(s.pages).toHaveLength(4);
    expect(s.selection).toEqual({ notebookId: nbA.id, sectionId: sA1.id, pageId: p1.id });
    // default expansion reveals exactly the ancestors of the open page
    expect(s.expanded).toEqual(new Set([nbA.id, sA1.id]));
  });

  it("keeps a still-valid selection on refresh and replaces a stale one with the first page", async () => {
    const { nbA, sA1, p1, nbB, sB1, p4 } = await seed();

    state().selectPage({ notebookId: nbB.id, sectionId: sB1.id, pageId: p4.id });
    await state().refresh();
    expect(state().selection?.pageId).toBe(p4.id); // valid → kept

    await notes.trashPage(p4.id);
    await state().refresh();
    // trashed page → selection re-derived from the alive tree
    expect(state().selection).toEqual({ notebookId: nbA.id, sectionId: sA1.id, pageId: p1.id });
  });

  it("selectPage changes only the selection, revealSelection also expands the ancestors", async () => {
    const { nbA, sA1, nbB, sB1, p4 } = await seed();
    const p4sel = { notebookId: nbB.id, sectionId: sB1.id, pageId: p4.id };

    state().selectPage(p4sel);
    expect(state().selection).toEqual(p4sel);
    expect(state().expanded.has(sB1.id)).toBe(false); // plain select reveals nothing

    state().revealSelection(p4sel);
    const exp = state().expanded;
    // search/tag jumps must SHOW where the user landed…
    expect(exp.has(nbB.id)).toBe(true);
    expect(exp.has(sB1.id)).toBe(true);
    // …without collapsing what was already open (union, not replace)
    expect(exp.has(nbA.id)).toBe(true);
    expect(exp.has(sA1.id)).toBe(true);
  });

  it("toggleExpanded flips membership without mutating the previous set", async () => {
    const { nbA } = await seed();
    const before = state().expanded;

    state().toggleExpanded(nbA.id);
    expect(state().expanded.has(nbA.id)).toBe(false);
    expect(before.has(nbA.id)).toBe(true); // old set untouched (immutability)

    state().toggleExpanded(nbA.id);
    expect(state().expanded.has(nbA.id)).toBe(true);

    state().toggleExpanded("never-expanded-id");
    expect(state().expanded.has("never-expanded-id")).toBe(true);
  });
});

describe("notebook edits", () => {
  it("addNotebook generates 'Notebook N', cycles default colors and auto-expands; blank names fall back, explicit ones are kept", async () => {
    await seed();

    await state().addNotebook(); // 3rd notebook
    await state().addNotebook("   "); // whitespace-only → generated
    await state().addNotebook("Custom");

    const s = state();
    expect(s.notebooks.map((n) => n.name)).toEqual([
      "Alpha",
      "Beta",
      "Notebook 3",
      "Notebook 4",
      "Custom",
    ]);
    // color cycle: violet, teal, [rose, amber,] violet (wraps at 4)
    expect(s.notebooks.map((n) => n.color)).toEqual([
      "violet",
      "teal",
      "rose",
      "amber",
      "violet",
    ]);
    for (const nb of s.notebooks.slice(2)) {
      expect(s.expanded.has(nb.id)).toBe(true); // fresh notebook is revealed
    }
  });

  it("renameNotebook / renameSection / renamePage all flow through refresh into state", async () => {
    const { nbA, sA1, p1 } = await seed();

    await state().renameNotebook(nbA.id, "Renamed NB");
    await state().renameSection(sA1.id, "Renamed Sec");
    await state().renamePage(p1.id, "Renamed Page");

    const s = state();
    expect(s.notebooks.find((n) => n.id === nbA.id)?.name).toBe("Renamed NB");
    expect(s.sections.find((sec) => sec.id === sA1.id)?.name).toBe("Renamed Sec");
    expect(s.pages.find((p) => p.id === p1.id)?.title).toBe("Renamed Page");
  });
});

describe("reorder edges", () => {
  it("moveNotebook / moveSection / movePage are no-ops at the edges of their scope", async () => {
    const { nbA, nbB, sA1, sA2, sB1, p1, p3 } = await seed();

    await state().moveNotebook(nbA.id, -1); // already first
    await state().moveNotebook(nbB.id, 1); // already last
    await state().moveSection(sA2.id, 1); // last section of Alpha
    await state().moveSection(sB1.id, -1); // only section of Beta
    await state().movePage(p1.id, -1); // first page of A1
    await state().movePage(p3.id, 1); // last page of A1

    const s = state();
    expect(s.notebooks.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
    expect(
      s.sections.filter((sec) => sec.notebookId === nbA.id).map((sec) => sec.name)
    ).toEqual(["A1", "A2"]);
    expect(titlesIn(sA1.id)).toEqual(["One", "Two", "Three"]);
  });

  it("moveNotebook / moveSection / movePage swap only with siblings inside their own scope", async () => {
    const { nbA, nbB, sA1, sB1, p2 } = await seed();

    await state().moveNotebook(nbB.id, -1); // Beta above Alpha
    await state().moveSection(sA1.id, 1); // A1 below A2 (inside Alpha only)
    await state().movePage(p2.id, -1); // Two above One (inside A1 only)

    const s = state();
    expect(s.notebooks.map((n) => n.name)).toEqual(["Beta", "Alpha"]);
    expect(
      s.sections.filter((sec) => sec.notebookId === nbA.id).map((sec) => sec.name)
    ).toEqual(["A2", "A1"]);
    // Beta's single section and its page are untouched by Alpha's swaps
    expect(titlesIn(sA1.id)).toEqual(["Two", "One", "Three"]);
    expect(titlesIn(sB1.id)).toEqual(["Four"]);
  });
});

describe("subtree deletes", () => {
  it("deleteNotebook removes the whole subtree from state and re-selects the first page elsewhere", async () => {
    const { nbA, nbB, sB1, p4 } = await seed();
    expect(state().selection?.pageId).toBeDefined(); // something is open in Alpha

    await state().deleteNotebook(nbA.id);

    const s = state();
    expect(s.notebooks.map((n) => n.id)).toEqual([nbB.id]);
    expect(s.sections.map((sec) => sec.id)).toEqual([sB1.id]);
    expect(s.pages.map((p) => p.id)).toEqual([p4.id]);
    expect(s.selection).toEqual({ notebookId: nbB.id, sectionId: sB1.id, pageId: p4.id });
  });

  it("deleteSection drops its pages and moves the selection to the first page anywhere else", async () => {
    const { nbB, sA1, sA2, sB1, p2, p4 } = await seed();
    state().selectPage({ notebookId: sA1.notebookId, sectionId: sA1.id, pageId: p2.id });

    await state().deleteSection(sA1.id);

    const s = state();
    expect(s.sections.map((sec) => sec.id).sort()).toEqual([sA2.id, sB1.id].sort());
    expect(s.pages.map((p) => p.id)).toEqual([p4.id]); // A1's pages are gone
    // A2 has no pages → selection lands on the first page anywhere (B1/Four)
    expect(s.selection).toEqual({ notebookId: nbB.id, sectionId: sB1.id, pageId: p4.id });
  });
});

describe("addSection / addPage defaults", () => {
  it("addSection numbers per notebook, expands itself and leaves the selection alone", async () => {
    const { nbA, nbB, p1 } = await seed();

    await state().addSection(nbA.id); // Alpha already has A1, A2
    await state().addSection(nbB.id); // Beta has B1

    const s = state();
    expect(
      s.sections.filter((sec) => sec.notebookId === nbA.id).map((sec) => sec.name)
    ).toEqual(["A1", "A2", "Section 3"]);
    expect(
      s.sections.filter((sec) => sec.notebookId === nbB.id).map((sec) => sec.name)
    ).toEqual(["B1", "Section 2"]);
    for (const name of ["Section 3", "Section 2"]) {
      const sec = s.sections.find((x) => x.name === name);
      expect(sec).toBeDefined();
      expect(s.expanded.has(sec!.id)).toBe(true);
    }
    expect(s.selection?.pageId).toBe(p1.id); // adding a section must not steal focus
  });

  it("addPage numbers per section, selects the fresh page and bumps canvasFocus exactly once per add", async () => {
    const { nbA, sA1, sA2 } = await seed();

    await state().addPage(sA2.id); // empty section → "Page 1"
    let s = state();
    expect(s.pages.find((p) => p.id === s.selection?.pageId)?.title).toBe("Page 1");
    expect(s.selection?.sectionId).toBe(sA2.id);
    expect(s.selection?.notebookId).toBe(nbA.id); // resolved via the section
    expect(s.expanded.has(sA2.id)).toBe(true);
    expect(s.canvasFocus).toBe(1);

    await state().addPage(sA1.id); // A1 holds 3 pages → "Page 4"
    s = state();
    expect(s.pages.find((p) => p.id === s.selection?.pageId)?.title).toBe("Page 4");
    expect(s.canvasFocus).toBe(2);
  });
});

describe("duplicatePage", () => {
  it("selects the copy (fresh id, '(copy)' suffix, last order) and bumps canvasFocus", async () => {
    const { nbA, sA1, p2 } = await seed();

    await state().duplicatePage(p2.id);

    const s = state();
    expect(s.selection?.pageId).not.toBe(p2.id);
    expect(s.selection?.sectionId).toBe(sA1.id);
    expect(s.selection?.notebookId).toBe(nbA.id);
    const copy = s.pages.find((p) => p.id === s.selection?.pageId);
    expect(copy?.title).toBe("Two (copy)");
    expect(titlesIn(sA1.id)).toEqual(["One", "Two", "Three", "Two (copy)"]);
    expect(s.canvasFocus).toBe(1); // the duplicate grabs keyboard focus (issue #81)
  });

  it("duplicatePage of a vanished row leaves the store completely untouched", async () => {
    await seed();
    const before = state();

    await state().duplicatePage("no-such-page"); // db returns null → early return

    const after = state();
    expect(after.selection).toEqual(before.selection);
    expect(after.pages).toHaveLength(before.pages.length);
    expect(after.canvasFocus).toBe(before.canvasFocus);
  });
});

describe("deletePage selection semantics", () => {
  it("deleting the open page selects the next sibling in the same section", async () => {
    const { nbA, sA1, p2, p3 } = await seed();
    state().selectPage({ notebookId: sA1.notebookId, sectionId: sA1.id, pageId: p2.id });

    await state().deletePage(p2.id);

    expect(state().selection).toEqual({ notebookId: nbA.id, sectionId: sA1.id, pageId: p3.id });
  });

  it("deleting a page that is not open keeps the current selection", async () => {
    const { sA1, sB1, p2, p4 } = await seed();
    state().selectPage({ notebookId: sB1.notebookId, sectionId: sB1.id, pageId: p4.id });

    await state().deletePage(p2.id);

    expect(state().selection?.pageId).toBe(p4.id);
    expect(titlesIn(sA1.id)).toEqual(["One", "Three"]);
  });

  it("deleting the very last page in the library clears the selection", async () => {
    const nb = await notes.createNotebook("Solo", "violet");
    const sec = await notes.createSection(nb.id, "Only");
    const page = await notes.createPage(sec.id, "Lonely");
    await state().refresh();
    expect(state().selection?.pageId).toBe(page.id);

    await state().deletePage(page.id);

    const s = state();
    expect(s.pages).toEqual([]);
    expect(s.selection).toBeNull(); // nothing left to open
  });
});

describe("page metadata and UI slices", () => {
  it("setPageBackground and setPageTags update the page meta in state", async () => {
    const { p1 } = await seed();

    await state().setPageBackground(p1.id, "grid");
    await state().setPageTags(p1.id, ["alpha", "beta"]);

    const page = state().pages.find((p) => p.id === p1.id);
    expect(page?.background).toBe("grid");
    expect(page?.tags).toEqual(["alpha", "beta"]);
  });

  it("tagFilter, saveIndicator, dialog flags and canvasFocus counters update their slices", async () => {
    await seed();

    state().setTagFilter("work");
    expect(state().tagFilter).toBe("work");
    state().setTagFilter(null);
    expect(state().tagFilter).toBeNull();

    state().setSaveIndicator("saving");
    expect(state().saveIndicator).toBe("saving");

    state().setSearchOpen(true);
    state().setTrashOpen(true);
    state().setShortcutsOpen(true);
    state().setHistoryOpen(true);
    const s = state();
    expect(s.searchOpen).toBe(true);
    expect(s.trashOpen).toBe(true);
    expect(s.shortcutsOpen).toBe(true);
    expect(s.historyOpen).toBe(true);

    const before = s.canvasFocus;
    state().requestCanvasFocus();
    expect(state().canvasFocus).toBe(before + 1);
  });
});

describe("trash round-trips and destructive reset", () => {
  it("restoreFromTrash brings a page back and purgeFromTrash removes it permanently", async () => {
    const { p2 } = await seed();

    await state().deletePage(p2.id); // soft delete
    expect((await notes.listTrash()).pages.map((p) => p.title)).toEqual(["Two"]);

    await state().restoreFromTrash("page", p2.id);
    expect(state().pages.find((p) => p.id === p2.id)).toBeDefined();
    expect((await notes.listTrash()).pages).toEqual([]);

    await state().deletePage(p2.id); // trash again…
    await state().purgeFromTrash("page", p2.id); // …then purge for good
    expect(state().pages.find((p) => p.id === p2.id)).toBeUndefined();
    expect((await notes.listTrash()).pages).toEqual([]);
    expect(await notes.db.pages.get(p2.id)).toBeUndefined(); // row is gone, not hidden
  });

  it("eraseEverything wipes the library and reseeds the welcome content", async () => {
    await seed();

    await state().eraseEverything();

    const s = state();
    expect(s.loaded).toBe(true);
    expect(s.notebooks.map((n) => n.name)).toEqual(["Welcome Notebook", "My Notebook"]);
    expect(s.pages.map((p) => p.title).sort()).toEqual(["Brainstorm", "Page 1", "Start here"]);
    // selection is re-derived onto one of the freshly seeded pages
    expect(s.selection).not.toBeNull();
    expect(s.pages.find((p) => p.id === s.selection?.pageId)).toBeDefined();
  });
});
