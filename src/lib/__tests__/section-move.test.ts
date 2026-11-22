/// <reference types="bun-types" />
/**
 * Sub-sections phase 2 — section moves (issue #325), wave 18.
 *
 * Three layers pinned here:
 *   1. the pure reparent policy (src/lib/section-tree.ts) — a section can
 *      never become its own descendant, cycle-safe (SM-P1..P3);
 *   2. the Dexie move primitive (src/lib/notes-db.ts) against
 *      fake-indexeddb — cross-notebook moves carry the whole subtree,
 *      invalid targets are rejected with zero writes, colors survive
 *      (SM-P4..P12);
 *   3. sync + backup — whole-row LWW carries the move for free and a
 *      backup round-trip preserves the moved structure (SM-P13..P14).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import { buildManifest, type LibrarySnapshot } from "../sync/format";
import { computeSyncPlan, type SyncInputs } from "../sync/merge";
import { canReparent, sectionSiblingKey } from "../section-tree";
import { effectiveSectionColor } from "../section-colors";

/* ------------------------------------------------------------------ */
/* factories                                                           */
/* ------------------------------------------------------------------ */

const T = 1_700_000_000_000;

const sec = (id: string, notebookId: string, over: Partial<Section> = {}): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "violet",
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});

const pg = (id: string, sectionId: string, over: Partial<PageRow> = {}): PageRow => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  content: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* 1. pure reparent policy                                             */
/* ------------------------------------------------------------------ */

describe("canReparent policy (issue #325)", () => {
  const tree: Section[] = [
    sec("topA", "nb1", { order: 1 }),
    sec("topB", "nb1", { order: 2 }),
    sec("child", "nb1", { parentId: "topA", order: 1 }),
    sec("grand", "nb1", { parentId: "child", order: 1 }),
    sec("otherNb", "nb2", { order: 1 }),
    sec("otherChild", "nb2", { parentId: "otherNb", order: 1 }),
  ];

  it("SM-P1: rejects the section itself; accepts a sibling target", () => {
    expect(canReparent(tree, "topA", "topA")).toBe(false);
    expect(canReparent(tree, "topA", "topB")).toBe(true);
    expect(canReparent(tree, "child", "topB")).toBe(true);
  });

  it("SM-P2: rejects the whole own subtree — child and grandchild; accepts a foreign notebook's sections", () => {
    expect(canReparent(tree, "topA", "child")).toBe(false);
    expect(canReparent(tree, "topA", "grand")).toBe(false);
    // cross-notebook nest target — allowed (the OneNote drag across notebooks)
    expect(canReparent(tree, "topA", "otherNb")).toBe(true);
    expect(canReparent(tree, "topA", "otherChild")).toBe(true);
  });

  it("SM-P3: survives a corrupted parentId cycle without hanging", () => {
    const cyclic = [
      sec("a", "nb1", { parentId: "b" }), // a → b → a: a corrupted loop
      sec("b", "nb1", { parentId: "a" }),
      sec("outside", "nb1"),
    ];
    // these must ANSWER (false), never hang on the loop
    expect(canReparent(cyclic, "a", "b")).toBe(false);
    expect(canReparent(cyclic, "b", "a")).toBe(false);
    // a target outside the looping subtree still reads as valid
    expect(canReparent(cyclic, "a", "outside")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Dexie move primitive (fake-indexeddb)                            */
/* ------------------------------------------------------------------ */

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

beforeEach(async () => {
  await notes.db.delete();
  // fake-indexeddb settles deletes asynchronously — give it a beat before
  // reopening so the new connection never races the teardown
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

describe("moveSectionTo data layer (issue #325)", () => {
  it("SM-P4: cross-notebook top-level move carries the whole subtree", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const topB = await notes.createSection(nbB.id, "Existing top of B");
    const moved = await notes.createSection(nbA.id, "Mover");
    const child = await notes.createSection(nbA.id, "Child", moved.id);
    const grand = await notes.createSection(nbA.id, "Grandchild", child.id);

    const result = await notes.moveSectionTo(moved.id, nbB.id, null);
    expect(result).toBe("moved");

    const byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    // the root landed at the END of nbB's top-level scope
    expect(byId.get(moved.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(moved.id)!.parentId ?? null).toBeNull();
    expect(byId.get(moved.id)!.order).toBe(topB.order + 1);
    // descendants followed the notebook but kept their own structure
    expect(byId.get(child.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(child.id)!.parentId).toBe(moved.id);
    expect(byId.get(child.id)!.order).toBe(1);
    expect(byId.get(grand.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(grand.id)!.parentId).toBe(child.id);
    // nothing was left behind in the old notebook
    const nbASections = (await notes.listSections()).filter((s) => s.notebookId === nbA.id);
    expect(nbASections).toEqual([]);
  });

  it("SM-P5: nesting under a section of another notebook lands at the end of its children", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const target = await notes.createSection(nbB.id, "Target");
    const tChild = await notes.createSection(nbB.id, "Target child", target.id);
    const mover = await notes.createSection(nbA.id, "Mover");

    const result = await notes.moveSectionTo(mover.id, nbB.id, target.id);
    expect(result).toBe("moved");

    const byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(mover.id)!.parentId).toBe(target.id);
    expect(byId.get(mover.id)!.notebookId).toBe(nbB.id);
    // appended after the target's existing children
    expect(byId.get(mover.id)!.order).toBe(tChild.order + 1);
    // the target's own children were not renumbered
    expect(byId.get(tChild.id)!.order).toBe(1);
  });

  it("SM-P6: dropping on the section's own parent is a noop with zero writes", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const parent = await notes.createSection(nbA.id, "Parent");
    const child = await notes.createSection(nbA.id, "Child", parent.id);

    const before = (await notes.listSections()).find((s) => s.id === child.id)!;
    const result = await notes.moveSectionTo(child.id, nbA.id, parent.id);
    expect(result).toBe("noop");
    const after = (await notes.listSections()).find((s) => s.id === child.id)!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.order).toBe(before.order);
    expect(after.parentId).toBe(parent.id);
  });

  it("SM-P7: self and own-descendant parents are invalid with zero writes", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const parent = await notes.createSection(nbA.id, "Parent");
    const child = await notes.createSection(nbA.id, "Child", parent.id);
    const grand = await notes.createSection(nbA.id, "Grand", child.id);

    const before = (await notes.listSections()).map((s) => [s.id, s.updatedAt]);
    expect(await notes.moveSectionTo(parent.id, nbA.id, parent.id)).toBe("invalid");
    expect(await notes.moveSectionTo(parent.id, nbA.id, child.id)).toBe("invalid");
    expect(await notes.moveSectionTo(parent.id, nbA.id, grand.id)).toBe("invalid");
    const after = (await notes.listSections()).map((s) => [s.id, s.updatedAt]);
    expect(after).toEqual(before);
  });

  it("SM-P8: trashed sources/targets, dangling parents and cross-notebook parents are invalid", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const mover = await notes.createSection(nbA.id, "Mover");
    const bTop = await notes.createSection(nbB.id, "B top");
    const bChild = await notes.createSection(nbB.id, "B child", bTop.id);
    const dead = await notes.createSection(nbA.id, "Dead");

    await notes.trashSection(mover.id);
    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("invalid");

    const alive = await notes.createSection(nbA.id, "Alive");
    await notes.trashSection(dead.id);
    // trashed TARGET notebook
    const nbDead = await notes.createNotebook("Dead nb", "amber");
    await notes.trashNotebook(nbDead.id);
    expect(await notes.moveSectionTo(alive.id, nbDead.id, null)).toBe("invalid");
    // trashed target PARENT + dangling parent id
    await notes.trashSection(bTop.id);
    expect(await notes.moveSectionTo(alive.id, nbB.id, bTop.id)).toBe("invalid");
    // bChild died with its parent in the same cascade — also invalid
    expect(await notes.moveSectionTo(alive.id, nbB.id, bChild.id)).toBe("invalid");
    expect(await notes.moveSectionTo(alive.id, nbB.id, dead.id)).toBe("invalid");
    expect(await notes.moveSectionTo(alive.id, nbB.id, "no-such-id")).toBe("invalid");
    // a parent that lives in a DIFFERENT notebook than the declared target
    expect(await notes.moveSectionTo(alive.id, nbA.id, dead.id)).toBe("invalid");
    // positive control: a fresh alive parent in its OWN notebook lands
    const bAlive = await notes.createSection(nbB.id, "B alive");
    expect(await notes.moveSectionTo(alive.id, nbB.id, bAlive.id)).toBe("moved");
  });

  it("SM-P9: pages follow their sections — no page rows written", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const mover = await notes.createSection(nbA.id, "Mover");
    const child = await notes.createSection(nbA.id, "Child", mover.id);
    const stay = await notes.createSection(nbA.id, "Stays");
    const movedPage = await notes.createPage(mover.id, "Moved page");
    const childPage = await notes.createPage(child.id, "Child page");
    const stayPage = await notes.createPage(stay.id, "Stay page");

    const pagesBefore = (await notes.db.pages.toArray()).map((p) => [p.id, p.updatedAt]);
    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("moved");

    const pageById = new Map((await notes.db.pages.toArray()).map((p) => [p.id, p]));
    // sections changed; the pages' sectionId and updatedAt did not
    expect(pageById.get(movedPage.id)!.sectionId).toBe(mover.id);
    expect(pageById.get(childPage.id)!.sectionId).toBe(child.id);
    expect(pageById.get(stayPage.id)!.sectionId).toBe(stay.id);
    const pagesAfter = (await notes.db.pages.toArray()).map((p) => [p.id, p.updatedAt]);
    expect(pagesAfter).toEqual(pagesBefore);
  });

  it("SM-P10: a separately-trashed descendant follows the notebook but keeps its own stamp", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const mover = await notes.createSection(nbA.id, "Mover");
    const dead = await notes.createSection(nbA.id, "Trashed child", mover.id);
    await notes.trashSection(dead.id);

    const stampBefore = (await notes.db.sections.get(dead.id))!.deletedAt!;
    expect(stampBefore).toBeGreaterThan(0);
    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("moved");

    const row = (await notes.db.sections.get(dead.id))!;
    expect(row.notebookId).toBe(nbB.id);
    expect(row.deletedAt).toBe(stampBefore); // own stamp untouched
    // a second identical move is a noop (already there)
    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("noop");
  });

  it("SM-P11: a color override survives the move; a non-overridden section reads as the NEW notebook's color", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const override = await notes.createSection(nbA.id, "Override");
    const plain = await notes.createSection(nbA.id, "Plain");
    await notes.setSectionColor(override.id, "emerald");

    expect(await notes.moveSectionTo(override.id, nbB.id, null)).toBe("moved");
    expect(await notes.moveSectionTo(plain.id, nbB.id, null)).toBe("moved");

    const byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(override.id)!.color).toBe("emerald"); // scalar survives
    expect(byId.get(plain.id)!.color ?? null).toBeNull(); // still inherit
    const nbBRow = { color: "rose" as const };
    expect(effectiveSectionColor(byId.get(plain.id)!, nbBRow)).toBe("rose");
    expect(effectiveSectionColor(byId.get(override.id)!, nbBRow)).toBe("emerald");
  });

  it("SM-P12: a move appends to the end of the target sibling scope", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const b1 = await notes.createSection(nbB.id, "B1");
    const b2 = await notes.createSection(nbB.id, "B2");
    const mover = await notes.createSection(nbA.id, "Mover");

    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("moved");
    const siblings = (await notes.listSections())
      .filter((s) => s.notebookId === nbB.id && (s.parentId ?? null) === null)
      .sort((a, b) => a.order - b.order);
    expect(siblings.map((s) => s.id)).toEqual([b1.id, b2.id, mover.id]);
    expect(siblings[2].order).toBeGreaterThan(siblings[1].order);
  });
});

/* ------------------------------------------------------------------ */
/* 3. sync + backup                                                    */
/* ------------------------------------------------------------------ */

describe("section moves flow through sync and backup (issue #325)", () => {
  it("SM-P13: whole-row LWW carries the move — new notebookId and parentId survive the merge", () => {
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1"), nb("nb2")],
      sections: [
        sec("mover", "nb2", { parentId: "target", order: 2, updatedAt: T + 9_000 }),
        sec("target", "nb2", { order: 1 }),
        sec("stay", "nb1", { order: 1 }),
      ],
      pages: [],
    };
    const base = buildManifest(
      {
        notebooks: [nb("nb1"), nb("nb2")],
        sections: [sec("mover", "nb1", { order: 1 }), sec("target", "nb2"), sec("stay", "nb1")],
        pages: [],
      },
      T
    );
    const inputs: SyncInputs = {
      local,
      localPurges: [],
      remote: { notebooks: [], sections: [], pages: [] },
      remoteTrash: [],
      base,
    };
    const plan = computeSyncPlan(inputs, { now: T + 10_000 });
    const byId = new Map(plan.sections.map((s) => [s.id, s]));
    expect(byId.get("mover")!.notebookId).toBe("nb2");
    expect(byId.get("mover")!.parentId).toBe("target");
    // the sibling key moved with the section — it now normalizes inside
    // nb2|target's group, never against nb1's scope
    expect(sectionSiblingKey(byId.get("mover")!)).toBe(`nb2|target`);
    expect(sectionSiblingKey(byId.get("stay")!)).toBe(`nb1|`);
  });

  it("SM-P14: a backup round-trip after a cross-notebook move preserves placement and nesting", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const mover = await notes.createSection(nbA.id, "Mover");
    const child = await notes.createSection(nbA.id, "Child", mover.id);
    await notes.createPage(mover.id, "Mover page");
    expect(await notes.moveSectionTo(mover.id, nbB.id, null)).toBe("moved");

    const backup = await notes.buildBackup();
    // restoreBackup imports as NEW records WITHOUT wiping (the SC-P9
    // lesson) — import into an EMPTY library so find-by-name asserts are
    // deterministic instead of a coin flip between generations
    await notes.eraseAllData();
    const restored = await notes.restoreBackup(backup);
    expect(restored).toBe(1); // the mover page came back

    const nbByName = new Map((await notes.db.notebooks.toArray()).map((n) => [n.name, n]));
    const restoredB = nbByName.get("B")!;
    const sections = await notes.listSections();
    const byName = new Map(sections.map((s) => [s.name, s]));
    const rMover = byName.get("Mover")!;
    const rChild = byName.get("Child")!;
    expect(rMover.notebookId).toBe(restoredB.id); // moved placement preserved
    expect(rMover.parentId ?? null).toBeNull();
    expect(rChild.parentId).toBe(rMover.id); // nesting preserved
    expect(rChild.notebookId).toBe(restoredB.id); // subtree followed
    const nbAId = nbByName.get("A")!.id;
    expect(sections.filter((s) => s.notebookId === nbAId)).toEqual([]);
  });
});
