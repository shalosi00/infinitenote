/// <reference types="bun-types" />
/**
 * Sub-sections (nested sections, issue #314) — wave 16.
 *
 * Three layers pinned here:
 *   1. the pure tree policy (src/lib/section-tree.ts) — sibling scopes,
 *      subtree/ancestor traversals with cycle guards (SB-P1..P8, P16);
 *   2. the pure sync merge engine — per-parent sibling-order normalization
 *      keeps nested orders from interleaving with other parents (SB-P9);
 *   3. the Dexie data layer against fake-indexeddb — per-parent creation
 *      orders, subtree trash/restore/purge cascades, and a backup
 *      round-trip that preserves nesting (SB-P10..P15).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import { buildManifest, type LibrarySnapshot } from "../sync/format";
import { computeSyncPlan, type SyncInputs } from "../sync/merge";
import {
  ancestorSectionIds,
  childSections,
  parentOf,
  sectionSiblingKey,
  subtreeSectionIds,
  topLevelSections,
} from "../section-tree";
import { defaultExpandedState } from "../tree-ops";
import { RestoreError } from "../restore-error";

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
/* 1. pure tree policy                                                 */
/* ------------------------------------------------------------------ */

describe("section-tree policy (issue #314)", () => {
  const tree = (): Section[] => [
    sec("topA", "nb1", { order: 1 }),
    sec("topB", "nb1", { order: 2 }),
    sec("childA1", "nb1", { parentId: "topA", order: 1 }),
    sec("childA2", "nb1", { parentId: "topA", order: 2 }),
    sec("grandA1a", "nb1", { parentId: "childA1", order: 1 }),
    sec("otherNb", "nb2", { order: 1 }),
  ];

  it("SB-P1: parentOf treats an absent field and null the same", () => {
    const absent = sec("x", "nb1");
    const explicit = sec("y", "nb1", { parentId: null });
    const nested = sec("z", "nb1", { parentId: "x" });
    expect(parentOf(absent)).toBeNull();
    expect(parentOf(explicit)).toBeNull();
    expect(parentOf(nested)).toBe("x");
  });

  it("SB-P2: topLevelSections keeps only the notebook's top level, in order", () => {
    const tops = topLevelSections(tree(), "nb1");
    expect(tops.map((s) => s.id)).toEqual(["topA", "topB"]);
  });

  it("SB-P3: childSections returns direct children only, in sibling order", () => {
    const kids = childSections(tree(), "topA");
    expect(kids.map((s) => s.id)).toEqual(["childA1", "childA2"]);
    expect(childSections(tree(), "childA1").map((s) => s.id)).toEqual(["grandA1a"]);
    expect(childSections(tree(), "topB")).toEqual([]);
  });

  it("SB-P4: subtreeSectionIds is root-first depth-first in sibling order", () => {
    const ids = subtreeSectionIds(tree(), "topA");
    expect(ids).toEqual(["topA", "childA1", "grandA1a", "childA2"]);
  });

  it("SB-P5: subtreeSectionIds survives a parentId cycle without hanging", () => {
    const cyclic: Section[] = [
      sec("a", "nb1", { order: 1 }),
      sec("b", "nb1", { parentId: "a", order: 1 }),
      sec("c", "nb1", { parentId: "b", order: 1 }),
    ];
    // hand-edited data making c the parent of a again — a loop
    cyclic[0].parentId = "c";
    const ids = subtreeSectionIds(cyclic, "a");
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids.filter((id) => id === "a")).toHaveLength(1);
  });

  it("SB-P6: ancestorSectionIds walks nearest-parent-first and stops at a missing parent", () => {
    expect(ancestorSectionIds(tree(), "grandA1a")).toEqual(["childA1", "topA"]);
    expect(ancestorSectionIds(tree(), "topA")).toEqual([]);
    const orphan = [sec("o", "nb1", { parentId: "gone" })];
    expect(ancestorSectionIds(orphan, "o")).toEqual([]);
  });

  it("SB-P7: ancestorSectionIds survives a cycle", () => {
    const cyclic = [sec("a", "nb1"), sec("b", "nb1", { parentId: "a" })];
    cyclic[0].parentId = "b";
    expect(ancestorSectionIds(cyclic, "b").sort()).toEqual(["a"]);
    expect(ancestorSectionIds(cyclic, "a").sort()).toEqual(["b"]);
  });

  it("SB-P8: sectionSiblingKey groups by notebook + parent", () => {
    expect(sectionSiblingKey(sec("a", "nb1"))).toBe("nb1|");
    expect(sectionSiblingKey(sec("b", "nb1", { parentId: null }))).toBe("nb1|");
    expect(sectionSiblingKey(sec("c", "nb1", { parentId: "a" }))).toBe("nb1|a");
    expect(sectionSiblingKey(sec("d", "nb2", { parentId: "a" }))).toBe("nb2|a");
    expect(sectionSiblingKey(sec("a", "nb1"))).not.toBe(sectionSiblingKey(sec("c", "nb1", { parentId: "a" })));
  });

  it("SB-P16: defaultExpandedState expands the ancestor chain of the selected page's section", () => {
    const snapshot = {
      notebooks: [nb("nb1")],
      sections: tree(),
      pages: [],
    };
    // selection inside a nested section — the parent must open too
    const nested = defaultExpandedState(snapshot, {
      notebookId: "nb1",
      sectionId: "grandA1a",
      pageId: "p",
    });
    expect(nested.has("nb1")).toBe(true);
    expect(nested.has("grandA1a")).toBe(true);
    expect(nested.has("childA1")).toBe(true);
    expect(nested.has("topA")).toBe(true);
    // top-level selection stays exactly as before #314
    const plain = defaultExpandedState(snapshot, {
      notebookId: "nb1",
      sectionId: "topA",
      pageId: "p",
    });
    expect(plain.has("topA")).toBe(true);
    expect(plain.has("childA1")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. sync merge — per-parent sibling order                            */
/* ------------------------------------------------------------------ */

describe("sync merge keeps per-parent sibling order (issue #314)", () => {
  it("SB-P9: children of different parents never interleave when orders collide", () => {
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [
        sec("top", "nb1", { order: 2 }),
        sec("x", "nb1", { parentId: "top", order: 5 }),
        sec("y", "nb1", { parentId: "top", order: 9 }),
        sec("z", "nb1", { parentId: "other", order: 5 }),
      ],
      pages: [],
    };
    const manifest = buildManifest(local, T);
    const inputs: SyncInputs = {
      local,
      localPurges: [],
      remote: { notebooks: [], sections: [], pages: [] },
      remoteTrash: [],
      base: manifest,
    };
    const plan = computeSyncPlan(inputs, { now: T + 1_000 });
    const byId = new Map(plan.sections.map((s) => [s.id, s]));
    // same-parent siblings keep their relative order
    expect(byId.get("x")!.order).toBeLessThan(byId.get("y")!.order);
    // a different parent's child is normalized in its OWN group — it can
    // share a numeric order with the first parent's children without
    // breaking their relative order
    expect(byId.get("z")!.order).toBeGreaterThan(0);
    // the parent link survives the merge untouched
    expect(byId.get("x")!.parentId).toBe("top");
    expect(byId.get("z")!.parentId).toBe("other");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Dexie data layer — subtree cascades (fake-indexeddb)             */
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

describe("sub-section data layer (issue #314)", () => {
  it("SB-P10: createSection orders children among their own parent's siblings", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const topA = await notes.createSection(nbA.id, "Top A");
    const topB = await notes.createSection(nbA.id, "Top B");
    const c1 = await notes.createSection(nbA.id, "Child 1", topA.id);
    const c2 = await notes.createSection(nbA.id, "Child 2", topA.id);
    const gc = await notes.createSection(nbA.id, "Grandchild", c1.id);
    const bc = await notes.createSection(nbA.id, "B child", topB.id);
    const all = await notes.listSections();
    const byId = new Map(all.map((s) => [s.id, s]));
    expect(byId.get(topA.id)!.order).toBe(1);
    expect(byId.get(topB.id)!.order).toBe(2);
    expect(byId.get(c1.id)!.order).toBe(1);
    expect(byId.get(c2.id)!.order).toBe(2);
    expect(byId.get(gc.id)!.order).toBe(1);
    expect(byId.get(bc.id)!.order).toBe(1);
    expect(byId.get(c1.id)!.parentId).toBe(topA.id);
    expect(byId.get(gc.id)!.parentId).toBe(c1.id);
  });

  it("SB-P11: moveSection swaps within the parent scope only", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    const other = await notes.createSection(nbA.id, "Other top");
    const c1 = await notes.createSection(nbA.id, "C1", top.id);
    const c2 = await notes.createSection(nbA.id, "C2", top.id);
    const c3 = await notes.createSection(nbA.id, "C3", top.id);
    await notes.moveSection(c1.id, 1); // c1 <-> c2 among top's children
    const all = await notes.listSections();
    const byId = new Map(all.map((s) => [s.id, s]));
    expect(byId.get(c1.id)!.order).toBe(2);
    expect(byId.get(c2.id)!.order).toBe(1);
    expect(byId.get(c3.id)!.order).toBe(3);
    // the top-level siblings were not touched
    expect(byId.get(top.id)!.order).toBe(1);
    expect(byId.get(other.id)!.order).toBe(2);
    // edges stay no-ops
    await notes.moveSection(c1.id, 1);
    await notes.moveSection(c3.id, 1);
    const after = (await notes.listSections()).find((s) => s.id === c3.id);
    expect(after!.order).toBe(3);
  });

  it("SB-P12: trashSection soft-deletes the alive subtree and its pages at one timestamp", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    const child = await notes.createSection(nbA.id, "Child", top.id);
    const grand = await notes.createSection(nbA.id, "Grand", child.id);
    const outside = await notes.createSection(nbA.id, "Outside");
    const pTop = await notes.createPage(top.id, "P top");
    const pChild = await notes.createPage(child.id, "P child");
    const pGrand = await notes.createPage(grand.id, "P grand");
    const pOutside = await notes.createPage(outside.id, "P outside");
    // a page the user trashed on its own earlier — must keep its own stamp
    const pOwn = await notes.createPage(child.id, "P own");
    const ownTs = Date.now() - 5_000;
    await notes.db.pages.update(pOwn.id, { deletedAt: ownTs });

    await notes.trashSection(top.id);

    const sections = await notes.db.sections.toArray();
    const byId = new Map(sections.map((s) => [s.id, s]));
    const ts = byId.get(top.id)!.deletedAt!;
    expect(ts).not.toBeNull();
    expect(byId.get(child.id)!.deletedAt).toBe(ts);
    expect(byId.get(grand.id)!.deletedAt).toBe(ts);
    expect(byId.get(outside.id)!.deletedAt).toBeNull();
    const pages = await notes.db.pages.toArray();
    const pageById = new Map(pages.map((p) => [p.id, p]));
    expect(pageById.get(pTop.id)!.deletedAt).toBe(ts);
    expect(pageById.get(pChild.id)!.deletedAt).toBe(ts);
    expect(pageById.get(pGrand.id)!.deletedAt).toBe(ts);
    expect(pageById.get(pOutside.id)!.deletedAt).toBeNull();
    expect(pageById.get(pOwn.id)!.deletedAt).toBe(ownTs); // untouched
  });

  it("SB-P13: restoreSection brings back the subtree trashed together plus trashed ancestors", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    const child = await notes.createSection(nbA.id, "Child", top.id);
    const grand = await notes.createSection(nbA.id, "Grand", child.id);
    const pTop = await notes.createPage(top.id, "P top");
    const pGrand = await notes.createPage(grand.id, "P grand");
    // the grandchild was trashed on its own EARLIER — it stays in trash
    await notes.trashSection(grand.id);
    const grandOwnTs = (await notes.db.sections.get(grand.id))!.deletedAt!;
    // the restore discriminator is the delete TIMESTAMP: the two trash
    // calls must land in different milliseconds (measured 2026-11-21: a
    // fast CI runner runs both within one ms, the two deletes become
    // indistinguishable and the separately-trashed rule cannot apply)
    await new Promise((r) => setTimeout(r, 5));
    // then the top was trashed (child + its pages go with it)
    await notes.trashSection(top.id);
    const ts = (await notes.db.sections.get(top.id))!.deletedAt!;

    await notes.restoreSection(child.id); // restoring a MIDDLE node

    const byId = new Map((await notes.db.sections.toArray()).map((s) => [s.id, s]));
    expect(byId.get(top.id)!.deletedAt).toBeNull(); // ancestor resurrected
    expect(byId.get(child.id)!.deletedAt).toBeNull();
    expect(byId.get(grand.id)!.deletedAt).toBe(grandOwnTs); // separately trashed: stays
    const pageById = new Map((await notes.db.pages.toArray()).map((p) => [p.id, p]));
    // resurrecting the ancestor top restores the pages that were trashed
    // together with it (same ts) — exactly what restoring top directly does
    expect(pageById.get(pTop.id)!.deletedAt).toBeNull();
    expect(pageById.get(pGrand.id)!.deletedAt).not.toBeNull(); // grand's page stays trashed
    // full round-trip: restoring the top also restores pages stamped at its ts
    await notes.trashSection(top.id);
    await notes.restoreSection(top.id);
    const again = new Map((await notes.db.pages.toArray()).map((p) => [p.id, p]));
    expect(again.get(pTop.id)!.deletedAt).toBeNull();
  });

  it("SB-P14: purgeSection hard-deletes the whole subtree with tombstones and versions", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    const child = await notes.createSection(nbA.id, "Child", top.id);
    const outside = await notes.createSection(nbA.id, "Outside");
    const pChild = await notes.createPage(child.id, "P child");
    const pOutside = await notes.createPage(outside.id, "P outside");
    // a version snapshot on the child's page — must die with the page
    const ts = Date.now();
    await notes.db.pageVersions.add({
      id: "v1",
      pageId: pChild.id,
      createdAt: ts,
      source: "manual",
      elementCount: 0,
      byteSize: 2,
      content: "{}",
    });

    await notes.purgeSection(top.id);

    const sections = await notes.db.sections.toArray();
    expect(sections.find((s) => s.id === top.id)).toBeUndefined();
    expect(sections.find((s) => s.id === child.id)).toBeUndefined();
    expect(sections.find((s) => s.id === outside.id)!.id).toBe(outside.id);
    const pages = await notes.db.pages.toArray();
    expect(pages.find((p) => p.id === pChild.id)).toBeUndefined();
    expect(pages.find((p) => p.id === pOutside.id)!.id).toBe(pOutside.id);
    expect(await notes.db.pageVersions.where("pageId").equals(pChild.id).count()).toBe(0);
    const tombs = await notes.db.tombstones.toArray();
    expect(tombs.find((t) => t.id === top.id)!.kind).toBe("section");
    expect(tombs.find((t) => t.id === child.id)!.kind).toBe("section");
    expect(tombs.find((t) => t.id === pChild.id)!.kind).toBe("page");
  });

  it("SB-P15: a backup round-trip preserves nesting through fresh ids", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    const child = await notes.createSection(nbA.id, "Child", top.id);
    const grand = await notes.createSection(nbA.id, "Grand", child.id);
    await notes.createPage(grand.id, "Deep page");

    const backup = await notes.buildBackup();
    // restore imports as NEW records without wiping — import into an EMPTY
    // library (the real-world restore flow) so the find-by-name asserts
    // below can never be ambiguous between the setup generation and the
    // restored one (full-suite evidence surfaced by the section-colors
    // file landing, issue #319)
    await notes.eraseAllData();
    const restoredCount = await notes.restoreBackup(backup);
    expect(restoredCount).toBe(1);

    const notebooks = await notes.listNotebooks();
    const newNb = notebooks.find((n) => n.name === "A")!;
    const sections = await notes.listSections();
    const tops = sections.filter((s) => s.notebookId === newNb.id && !s.parentId);
    expect(tops).toHaveLength(1);
    const newTop = tops[0];
    const kids = sections.filter((s) => s.parentId === newTop.id);
    expect(kids.map((s) => s.name)).toEqual(["Child"]);
    const grandKids = sections.filter((s) => s.parentId === kids[0].id);
    expect(grandKids.map((s) => s.name)).toEqual(["Grand"]);
    const pages = await notes.listPages();
    expect(pages.find((p) => p.title === "Deep page")!.sectionId).toBe(grandKids[0].id);
  });

  it("SB-P15b: a dangling parentId in a backup restores as a top-level section", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const top = await notes.createSection(nbA.id, "Top");
    await notes.createPage(top.id, "Page");
    const backup = JSON.parse(await notes.buildBackup()) as {
      notebooks: Array<{ sections: Array<{ id: string; parentId?: string }> }>;
    };
    // hand-edited archive: the child points at a parent id that was removed
    backup.notebooks[0].sections[0].parentId = "deleted-parent";
    await expect(notes.restoreBackup(JSON.stringify(backup))).resolves.toBe(1);
    const sections = await notes.listSections();
    expect(sections.every((s) => !s.parentId)).toBe(true);
  });

  it("restoreBackup still rejects non-InfiniteNote archives", async () => {
    await expect(notes.restoreBackup(JSON.stringify({ app: "other" }))).rejects.toBeInstanceOf(
      RestoreError
    );
  });
});
