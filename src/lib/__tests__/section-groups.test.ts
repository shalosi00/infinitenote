/// <reference types="bun-types" />
/**
 * Section groups — OneNote "Section Groups" parity (issue #337),
 * sub-sections phase 3, wave 20.
 *
 * Layers pinned here:
 *   1. the pure policy (src/lib/section-groups.ts) — kind normalization
 *      and group detection (SG-P1..P2);
 *   2. the reparent policy (src/lib/section-tree.ts) — a group never
 *      nests under a plain section, anything may nest under a group
 *      (SG-P3..P6);
 *   3. the Dexie layer against fake-indexeddb — creation, moves, the
 *      pages-never-live-in-groups invariant, trash/restore/purge of a
 *      group subtree (SG-P7..P14);
 *   4. sync + backup — whole-row LWW carries `kind` for free and a
 *      backup round-trip preserves it, while hand-edited unknown kinds
 *      degrade to plain sections (SG-P15..P18).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import { buildManifest, type LibrarySnapshot } from "../sync/format";
import { computeSyncPlan, type SyncInputs } from "../sync/merge";
import { canReparent, sectionSiblingKey } from "../section-tree";
import { isSectionGroup, normalizeSectionKind, SECTION_GROUP_KIND } from "../section-groups";

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
/* 1. pure policy                                                      */
/* ------------------------------------------------------------------ */

describe("section-group policy (issue #337)", () => {
  it("SG-P1: normalizeSectionKind passes only 'group'; anything hand-edited degrades to null", () => {
    expect(normalizeSectionKind("group")).toBe(SECTION_GROUP_KIND);
    // every plausible hand-edit reads as a plain section, never a crash
    expect(normalizeSectionKind("folder")).toBeNull();
    expect(normalizeSectionKind("Group")).toBeNull();
    expect(normalizeSectionKind("")).toBeNull();
    expect(normalizeSectionKind(undefined)).toBeNull();
    expect(normalizeSectionKind(null)).toBeNull();
    expect(normalizeSectionKind(42)).toBeNull();
    expect(normalizeSectionKind({ kind: "group" })).toBeNull();
  });

  it("SG-P2: isSectionGroup reads the canonical shape; absent kind = plain section (old rows)", () => {
    expect(isSectionGroup({ kind: "group" })).toBe(true);
    expect(isSectionGroup({})).toBe(false); // the pre-#337 row shape
    expect(isSectionGroup({ kind: null })).toBe(false);
    expect(isSectionGroup({ kind: undefined })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. reparent policy                                                  */
/* ------------------------------------------------------------------ */

describe("canReparent with groups (issue #337)", () => {
  const tree: Section[] = [
    sec("topA", "nb1", { order: 1 }),
    sec("topB", "nb1", { order: 2 }),
    sec("groupA", "nb1", { kind: "group", order: 3 }),
    sec("child", "nb1", { parentId: "topA", order: 1 }),
    sec("inGroup", "nb1", { parentId: "groupA", order: 1 }),
    sec("otherGroup", "nb2", { kind: "group", order: 1 }),
  ];

  it("SG-P3: a section may nest under a group (the group's whole purpose); plain-section nesting is unchanged", () => {
    expect(canReparent(tree, "topA", "groupA")).toBe(true);
    expect(canReparent(tree, "topB", "topA")).toBe(true);
    expect(canReparent(tree, "topA", "topB")).toBe(true);
  });

  it("SG-P4: a group never nests under a plain section (the Graph OneNote model)", () => {
    expect(canReparent(tree, "groupA", "topA")).toBe(false);
    expect(canReparent(tree, "groupA", "topB")).toBe(false);
    expect(canReparent(tree, "groupA", "child")).toBe(false);
  });

  it("SG-P5: a group nests under another group — even across notebooks", () => {
    expect(canReparent(tree, "groupA", "otherGroup")).toBe(true);
  });

  it("SG-P6: the self / own-subtree rules hold for groups too", () => {
    expect(canReparent(tree, "groupA", "groupA")).toBe(false);
    expect(canReparent(tree, "groupA", "inGroup")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Dexie layer (fake-indexeddb)                                     */
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

describe("section groups in the data layer (issue #337)", () => {
  it("SG-P7: creating a group lands it at the END of the notebook's top-level scope with kind 'group'", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const s1 = await notes.createSection(nbk.id, "First");
    const s2 = await notes.createSection(nbk.id, "Second");
    const group = await notes.createSection(nbk.id, "Projects", null, "group");

    expect(group.kind).toBe("group");
    expect(isSectionGroup(group)).toBe(true);
    const siblings = (await notes.listSections())
      .filter((s) => s.notebookId === nbk.id && (s.parentId ?? null) === null)
      .sort((a, b) => a.order - b.order);
    // the OneNote path appends the group after the existing tabs
    expect(siblings.map((s) => s.id)).toEqual([s1.id, s2.id, group.id]);
    // plain sections carry NO kind field at all (the pre-#337 row shape)
    expect(s1.kind).toBeUndefined();
    expect((await notes.db.sections.get(s1.id))!.kind).toBeUndefined();
  });

  it("SG-P8: a group under a plain section is rejected at creation; a group under a group nests", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const plain = await notes.createSection(nbk.id, "Plain");
    const group = await notes.createSection(nbk.id, "Group", null, "group");

    const before = (await notes.listSections()).length;
    expect(() => notes.createSection(nbk.id, "Bad", plain.id, "group")).toThrow(
      /section group/
    );
    expect((await notes.listSections()).length).toBe(before); // zero writes

    const nested = await notes.createSection(nbk.id, "Nested group", group.id, "group");
    expect(nested.parentId).toBe(group.id);
    expect(isSectionGroup(nested)).toBe(true);
  });

  it("SG-P9: a plain section nests under a group; the group's sibling key matches its section siblings", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const group = await notes.createSection(nbk.id, "Group", null, "group");
    const child = await notes.createSection(nbk.id, "Child", group.id);

    expect(child.parentId).toBe(group.id);
    expect(child.kind).toBeUndefined(); // children of groups are PLAIN sections
    // OneNote's tab bar mixes sections and group tabs in one order space
    expect(sectionSiblingKey(group)).toBe(sectionSiblingKey({ ...group, kind: undefined }));
    expect(sectionSiblingKey(child)).toBe(`${nbk.id}|${group.id}`);
  });

  it("SG-P10: moveSectionTo moves a group — with its subtree — to another notebook's top level", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const bTop = await notes.createSection(nbB.id, "B top");
    const group = await notes.createSection(nbA.id, "Group", null, "group");
    const member = await notes.createSection(nbA.id, "Member", group.id);
    const page = await notes.createPage(member.id, "Member page");

    expect(await notes.moveSectionTo(group.id, nbB.id, null)).toBe("moved");

    const byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(group.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(group.id)!.kind).toBe("group"); // kind survives the move
    expect(byId.get(group.id)!.parentId ?? null).toBeNull();
    expect(byId.get(group.id)!.order).toBe(bTop.order + 1);
    expect(byId.get(member.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(member.id)!.parentId).toBe(group.id);
    // pages follow their sections untouched (the SM-P9 convention)
    expect((await notes.db.pages.get(page.id))!.sectionId).toBe(member.id);
    expect((await notes.listSections()).filter((s) => s.notebookId === nbA.id)).toEqual([]);
  });

  it("SG-P11: moving a group under a group works — under a plain section is invalid with zero writes", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const mover = await notes.createSection(nbA.id, "Mover", null, "group");
    const target = await notes.createSection(nbB.id, "Target group", null, "group");
    const plain = await notes.createSection(nbB.id, "Plain section");

    expect(await notes.moveSectionTo(mover.id, nbB.id, plain.id)).toBe("invalid");
    let byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(mover.id)!.notebookId).toBe(nbA.id); // untouched
    expect(byId.get(mover.id)!.parentId ?? null).toBeNull();

    expect(await notes.moveSectionTo(mover.id, nbB.id, target.id)).toBe("moved");
    byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(mover.id)!.parentId).toBe(target.id);
    expect(byId.get(mover.id)!.notebookId).toBe(nbB.id);
  });

  it("SG-P12: moving a plain section under a group works; its children follow", async () => {
    const nbA = await notes.createNotebook("A", "violet");
    const nbB = await notes.createNotebook("B", "rose");
    const group = await notes.createSection(nbB.id, "Group", null, "group");
    const mover = await notes.createSection(nbA.id, "Mover");
    const child = await notes.createSection(nbA.id, "Child", mover.id);

    expect(await notes.moveSectionTo(mover.id, nbB.id, group.id)).toBe("moved");
    const byId = new Map((await notes.listSections()).map((s) => [s.id, s]));
    expect(byId.get(mover.id)!.parentId).toBe(group.id);
    expect(byId.get(mover.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(child.id)!.notebookId).toBe(nbB.id);
    expect(byId.get(child.id)!.parentId).toBe(mover.id);
  });

  it("SG-P13: pages never live in a group — movePagesToSection answers 0 with zero writes", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const group = await notes.createSection(nbk.id, "Group", null, "group");
    const member = await notes.createSection(nbk.id, "Member", group.id);
    const page = await notes.createPage(member.id, "Wants to move");

    expect(await notes.movePagesToSection([page.id], group.id)).toBe(0);
    expect((await notes.db.pages.get(page.id))!.sectionId).toBe(member.id);
    // positive control: the same page still moves into a plain section
    const plain = await notes.createSection(nbk.id, "Plain");
    expect(await notes.movePagesToSection([page.id], plain.id)).toBe(1);
  });

  it("SG-P14: trashing a group takes the whole subtree at one stamp; restore brings the family back; purge hard-deletes it", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const group = await notes.createSection(nbk.id, "Group", null, "group");
    const member = await notes.createSection(nbk.id, "Member", group.id);
    const page = await notes.createPage(member.id, "Member page");

    await notes.trashSection(group.id);
    let g = (await notes.db.sections.get(group.id))!;
    let m = (await notes.db.sections.get(member.id))!;
    const p = (await notes.db.pages.get(page.id))!;
    expect(g.deletedAt).not.toBeNull();
    expect(m.deletedAt).toBe(g.deletedAt); // one shared timestamp
    expect(p.deletedAt).toBe(g.deletedAt);

    await notes.restoreSection(group.id);
    g = (await notes.db.sections.get(group.id))!;
    m = (await notes.db.sections.get(member.id))!;
    expect(g.deletedAt).toBeNull();
    expect(m.deletedAt).toBeNull();
    expect((await notes.db.pages.get(page.id))!.deletedAt).toBeNull();

    await notes.purgeSection(group.id);
    expect(await notes.db.sections.get(group.id)).toBeUndefined();
    expect(await notes.db.sections.get(member.id)).toBeUndefined();
    expect(await notes.db.pages.get(page.id)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 4. sync + backup                                                    */
/* ------------------------------------------------------------------ */

describe("section groups flow through sync and backup (issue #337)", () => {
  it("SG-P15: whole-row LWW carries kind — a group row survives the merge untouched", () => {
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1"), nb("nb2")],
      sections: [
        sec("group", "nb2", { kind: "group", order: 2, updatedAt: T + 9_000 }),
        sec("stay", "nb1", { order: 1 }),
      ],
      pages: [],
    };
    const base = buildManifest(
      {
        notebooks: [nb("nb1"), nb("nb2")],
        sections: [sec("group", "nb1", { order: 1 }), sec("stay", "nb1")],
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
    expect(byId.get("group")!.kind).toBe("group"); // whole-row LWW, zero merge logic
    expect(isSectionGroup(byId.get("group")!)).toBe(true);
    // the group normalizes inside its own sibling scope like any section
    expect(sectionSiblingKey(byId.get("group")!)).toBe("nb2|");
  });

  it("SG-P16: the manifest builder writes kind through — old folders without kind stay valid", () => {
    const manifest = buildManifest(
      {
        notebooks: [nb("nb1")],
        sections: [sec("group", "nb1", { kind: "group" }), sec("plain", "nb1")],
        pages: [],
      },
      T
    );
    const rows = manifest.sections as Array<{ id: string; kind?: string }>;
    expect(rows.find((s) => s.id === "group")!.kind).toBe("group");
    // plain sections serialize WITHOUT a kind key at all
    expect("kind" in rows.find((s) => s.id === "plain")!).toBe(false);
  });

  it("SG-P17: a backup round-trip preserves kind (restored into an EMPTY library)", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    const group = await notes.createSection(nbk.id, "Group", null, "group");
    const member = await notes.createSection(nbk.id, "Member", group.id);
    await notes.createPage(member.id, "Member page");

    const backup = await notes.buildBackup();
    await notes.eraseAllData();
    const restored = await notes.restoreBackup(backup);
    expect(restored).toBe(1); // the member page came back

    const byName = new Map((await notes.listSections()).map((s) => [s.name, s]));
    expect(isSectionGroup(byName.get("Group")!)).toBe(true);
    expect(byName.get("Group")!.kind).toBe("group");
    expect(byName.get("Member")!.parentId).toBe(byName.get("Group")!.id);
  });

  it("SG-P18: a hand-edited archive kind restores as a PLAIN section, not a crash", async () => {
    const nbk = await notes.createNotebook("A", "violet");
    await notes.createSection(nbk.id, "Group", null, "group");
    await notes.createPage(
      (await notes.listSections()).find((s) => s.name === "Group")!.id,
      "hold one page so the archive carries one"
    );

    const backup = JSON.parse(await notes.buildBackup()) as {
      notebooks: Array<{ sections: Array<{ kind?: string }> }>;
    };
    // hand-edits: an unknown kind and a wrong type
    backup.notebooks[0].sections[0].kind = "folder";
    await notes.eraseAllData();
    const restored = await notes.restoreBackup(JSON.stringify(backup));
    expect(restored).toBe(1);

    const byName = new Map((await notes.listSections()).map((s) => [s.name, s]));
    expect(byName.get("Group")!.kind).toBeUndefined(); // degraded to plain
    expect(isSectionGroup(byName.get("Group")!)).toBe(false);
  });
});
