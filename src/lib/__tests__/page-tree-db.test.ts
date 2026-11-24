/// <reference types="bun-types" />
/**
 * Sub-page data-layer pins (issue #359) — the write surface against
 * fake-indexeddb: sibling-scoped orders, setPageParent guards, subtree
 * trash/restore/purge cascades, the bulk-move subtree carry and the
 * backup two-phase parent re-attach.
 *
 * The side-effect import must complete before notes-db.ts is evaluated
 * (it constructs the Dexie instance at module scope), so both are loaded
 * dynamically inside beforeAll (the notes-db.test.ts harness).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");
let mod: typeof import("../page-tree");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  mod = await import("../page-tree");
});

/** Fresh database for every test — no cross-test pollution. */
beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

/** One notebook + one section, fresh ids per test. */
async function home() {
  const nb = await notes.createNotebook("Subs", "teal");
  const sec = await notes.createSection(nb.id, "Pages");
  return { nb, sec };
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("sub-page data layer (issue #359)", () => {
  it("PG-D1: createPage scopes new-page orders to the parent's sibling scope", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const b = await notes.createPage(sec.id, "B");
    const rows = await notes.db.pages.where("sectionId").equals(sec.id).toArray();
    const top = rows.filter((p) => mod.parentOf(p) === null).sort((x, y) => x.order - y.order);
    const kids = rows.filter((p) => mod.parentOf(p) === a.id).sort((x, y) => x.order - y.order);
    expect(titles(top)).toEqual(["A", "B"]);
    expect(titles(kids)).toEqual(["A1"]);
    // B's order (2) is independent of A1's order (1) — sibling scopes
    expect(top[1].order).toBe(2);
    expect(kids[0].order).toBe(1);
    expect(a1.parentId).toBe(a.id);
    // a top-level row carries NO parentId field at all (the pre-#359 shape;
    // re-read through the structured clone — in-memory undefined drops)
    const bRow = await notes.db.pages.get(b.id);
    expect("parentId" in (bRow as object)).toBe(false);
    // a trashed parent id is rejected with zero rows written
    await notes.trashPage(a.id);
    await expect(notes.createPage(sec.id, "X", null, a.id)).rejects.toThrow(/alive page/);
  });

  it("PG-D2: setPageParent demotes, noops, and refuses invalid targets", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const b = await notes.createPage(sec.id, "B");
    expect(await notes.setPageParent(b.id, a.id)).toBe("moved");
    const after = await notes.db.pages.get(b.id);
    expect(after?.parentId).toBe(a.id);
    // already there → zero-write noop
    expect(await notes.setPageParent(b.id, a.id)).toBe("noop");
    // self / descendant targets are cycles
    expect(await notes.setPageParent(a.id, a.id)).toBe("invalid");
    expect(await notes.setPageParent(a.id, b.id)).toBe("invalid");
    // unknown target id
    expect(await notes.setPageParent(b.id, "nope")).toBe("invalid");
    // depth 2 exists: a sub-subpage under B
    const a11 = await notes.createPage(sec.id, "A11", null, b.id);
    expect(a11.parentId).toBe(b.id);
    // the depth cap is OneNote's own: A's subtree is two tall (B → A11),
    // so demoting A anywhere (0 + 1 + 2 = 3) is refused with zero writes
    const c = await notes.createPage(sec.id, "C");
    expect(await notes.setPageParent(a.id, c.id)).toBe("invalid");
    // promote back to top level
    expect(await notes.setPageParent(b.id, null)).toBe("moved");
    expect((await notes.db.pages.get(b.id))?.parentId ?? null).toBeNull();
    // a dangling parent id heals to top level through the same write
    await notes.db.pages.update(b.id, { parentId: "ghost" });
    expect(await notes.setPageParent(b.id, null)).toBe("moved");
    expect((await notes.db.pages.get(b.id))?.parentId ?? null).toBeNull();
  });

  it("PG-D3: movePage swaps within the sibling scope only", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const b = await notes.createPage(sec.id, "B");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    // A1's up neighbor is NOTHING (first child) — the swap must never
    // touch the top-level scope (the pre-#359 bug shape)
    const before = (await notes.db.pages.get(a1.id))?.order;
    await notes.movePage(a1.id, -1);
    expect((await notes.db.pages.get(a1.id))?.order).toBe(before);
    await notes.movePage(b.id, -1); // top-level swap: B ↔ A
    const rows = await notes.db.pages.where("sectionId").equals(sec.id).toArray();
    const top = rows.filter((p) => mod.parentOf(p) === null).sort((x, y) => x.order - y.order);
    expect(titles(top)).toEqual(["B", "A"]);
  });

  it("PG-D4: duplicatePage keeps the indent level and its sibling scope", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const copy = await notes.duplicatePage(a1.id);
    expect(copy?.parentId).toBe(a.id);
    expect(copy?.title).toBe("A1 (copy)");
    const b = await notes.createPage(sec.id, "B");
    // a top-level duplicate appends after the TOP-level scope
    const bCopy = await notes.duplicatePage(b.id);
    expect(bCopy).toBeTruthy();
    const rows = await notes.db.pages.where("sectionId").equals(sec.id).toArray();
    const top = rows.filter((p) => mod.parentOf(p) === null).sort((x, y) => x.order - y.order);
    expect(top[top.length - 1].id).toBe(bCopy!.id);
    expect(copy).toBeTruthy();
  });

  it("PG-D5: trashPage cascades the subtree with one timestamp", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const a11 = await notes.createPage(sec.id, "A11", null, a1.id);
    const b = await notes.createPage(sec.id, "B");
    await notes.trashPage(a.id);
    const rows = await notes.db.pages.bulkGet([a.id, a1.id, a11.id, b.id]);
    const ts = rows[0]?.deletedAt;
    expect(ts).not.toBeNull();
    expect(rows[1]?.deletedAt).toBe(ts);
    expect(rows[2]?.deletedAt).toBe(ts);
    expect(rows[3]?.deletedAt).toBeNull(); // outside the subtree
  });

  it("PG-D6: restorePage brings the same-ts family and trashed ancestors back", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const b = await notes.createPage(sec.id, "B");
    await notes.trashPage(a.id); // A + A1 one ts
    await notes.trashPage(b.id); // B its own, later ts
    await notes.restorePage(a.id);
    const rows = await notes.db.pages.bulkGet([a.id, a1.id, b.id]);
    expect(rows[0]?.deletedAt).toBeNull();
    expect(rows[1]?.deletedAt).toBeNull(); // same-ts child rides along
    expect(rows[2]?.deletedAt).not.toBeNull(); // separately-trashed stays
    // restoring a SUBPAGE resurrects its trashed parent chain (the family)
    await notes.trashPage(a.id);
    await notes.restorePage(a1.id);
    const family = await notes.db.pages.bulkGet([a.id, a1.id]);
    expect(family[0]?.deletedAt).toBeNull();
    expect(family[1]?.deletedAt).toBeNull();
  });

  it("PG-D7: purgePage removes the whole subtree, tombstones and versions", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const b = await notes.createPage(sec.id, "B");
    await notes.trashPage(a.id);
    await notes.purgePage(a.id);
    const rows = await notes.db.pages.bulkGet([a.id, a1.id, b.id]);
    expect(rows[0]).toBeUndefined();
    expect(rows[1]).toBeUndefined();
    expect(rows[2]?.title).toBe("B");
    const tombstones = await notes.db.tombstones.toArray();
    expect(tombstones.filter((t) => t.kind === "page").map((t) => t.id).sort()).toEqual([a.id, a1.id].sort());
  });

  it("PG-D8: movePagesToSection carries the subtree and flattens the root", async () => {
    const { sec, nb } = await home();
    const other = await notes.createSection(nb.id, "Other");
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const a11 = await notes.createPage(sec.id, "A11", null, a1.id);
    const b = await notes.createPage(sec.id, "B");
    // moving the root A takes the whole subtree; the root lands top-level
    const moved = await notes.movePagesToSection([a.id], other.id);
    expect(moved).toBe(1);
    const rows = await notes.db.pages.bulkGet([a.id, a1.id, a11.id, b.id]);
    expect(rows[0]?.sectionId).toBe(other.id);
    expect(rows[0]?.parentId ?? null).toBeNull();
    expect(rows[1]?.sectionId).toBe(other.id);
    expect(rows[1]?.parentId).toBe(a.id); // hierarchy rides along
    expect(rows[2]?.sectionId).toBe(other.id);
    expect(rows[2]?.parentId).toBe(a1.id);
    expect(rows[3]?.sectionId).toBe(sec.id); // B untouched
    // selecting a root AND its child moves one root — the child rides
    const c = await notes.createPage(sec.id, "C");
    const c1 = await notes.createPage(sec.id, "C1", null, c.id);
    const moved2 = await notes.movePagesToSection([c.id, c1.id], other.id);
    expect(moved2).toBe(1);
    const c1Row = await notes.db.pages.get(c1.id);
    expect(c1Row?.parentId).toBe(c.id);
    expect(c1Row?.sectionId).toBe(other.id);
  });

  it("PG-D9: restoreBackup re-attaches subpage parents with fresh ids", async () => {
    const { sec } = await home();
    const a = await notes.createPage(sec.id, "A");
    const a1 = await notes.createPage(sec.id, "A1", null, a.id);
    const a11 = await notes.createPage(sec.id, "A11", null, a1.id);
    const json = await notes.buildBackup();
    // fresh ids mean the restore lands beside the originals — erase first
    // so the restored rows are unambiguous by title
    await notes.eraseAllData();
    const restored = await notes.restoreBackup(json);
    expect(restored).toBe(3);
    const rows = await notes.db.pages.toArray();
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    const newA = byTitle.get("A")!;
    const newA1 = byTitle.get("A1")!;
    const newA11 = byTitle.get("A11")!;
    expect(newA.parentId ?? null).toBeNull();
    expect(newA1.parentId).toBe(newA.id);
    expect(newA11.parentId).toBe(newA1.id);
    // fresh ids everywhere — no archive id ever collides
    expect(new Set([newA.id, newA1.id, newA11.id]).has(a.id)).toBe(false);
    // a dangling archive parentId restores as top level (tolerance).
    // Address the archive row by TITLE, not index: sibling-scoped orders
    // tie at 1 here, so the archive array order is uuid-tie-broken and
    // varies between runs (the deterministic id tie-break)
    const handEdited = JSON.parse(json);
    const a1Archive = handEdited.notebooks[0].sections[0].pages.find(
      (p: { title?: string }) => p.title === "A1"
    );
    a1Archive.parentId = "ghost-id";
    await notes.eraseAllData();
    const restored2 = await notes.restoreBackup(JSON.stringify(handEdited));
    expect(restored2).toBe(3);
    const rows2 = await notes.db.pages.toArray();
    const a1s = rows2.filter((r) => r.title === "A1");
    expect(a1s).toHaveLength(1);
    expect(a1s[0].parentId ?? null).toBeNull(); // dangling → top level, never ghost
  });
});
