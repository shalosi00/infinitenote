/// <reference types="bun-types" />
/**
 * Unit tests for the pure sync merge engine: three-way LWW, conflict
 * copies, delete-vs-edit semantics, purge tombstones, order normalization.
 * No I/O — plain objects.
 *
 * Pattern: build ONE canonical library (`base`), clone it for `local` (this
 * device) and `remote` (the folder), then introduce divergence explicitly —
 * exactly how two devices that last synced at `base` diverge in the wild.
 */
import { describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import {
  buildManifest,
  type LibrarySnapshot,
  type SyncManifest,
  type TrashEntry,
} from "../sync/format";
import { computeSyncPlan, conflictTitle, eventTime, type SyncInputs } from "../sync/merge";

/* ------------------------------ factories ------------------------------ */

const T = 1_700_000_000_000; // 2023-11-14 — fixed clock base
const MERGE_NOW = 1_700_049_600_000; // 2023-11-15T12:00:00Z — mid-day, TZ-safe

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "violet",
  order: 1,
  createdAt: T + 1,
  updatedAt: T + 1,
  deletedAt: null,
  ...over,
});

const sec = (id: string, notebookId: string, over: Partial<Section> = {}): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: 1,
  createdAt: T + 1,
  updatedAt: T + 1,
  deletedAt: null,
  ...over,
});

const pg = (id: string, sectionId: string, over: Partial<PageRow> = {}): PageRow => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order: 1,
  createdAt: T + 1,
  updatedAt: T + 1,
  deletedAt: null,
  content: null,
  ...over,
});

const scene = (mark: string) => JSON.stringify({ elements: [{ mark }], files: {} });

/** Canonical two-page library: nb1 / s1 / {p1 "Alpha", p2 "Beta"}. */
function canonical(): LibrarySnapshot {
  return {
    notebooks: [nb("nb1")],
    sections: [sec("s1", "nb1")],
    pages: [
      pg("p1", "s1", { title: "Alpha", content: scene("base"), order: 1 }),
      pg("p2", "s1", { title: "Beta", content: scene("base2"), order: 2 }),
    ],
  };
}

const clone = (s: LibrarySnapshot): LibrarySnapshot => JSON.parse(JSON.stringify(s)) as LibrarySnapshot;
const manifestOf = (s: LibrarySnapshot, exportedAt = T): SyncManifest => buildManifest(s, exportedAt);

const run = (i: SyncInputs) =>
  computeSyncPlan(i, { now: MERGE_NOW, newId: () => "fresh-copy-id" });

/* ------------------------------ basics --------------------------------- */

describe("eventTime / conflictTitle", () => {
  it("eventTime counts a delete as a mutation", () => {
    expect(eventTime({ updatedAt: 10, deletedAt: null })).toBe(10);
    expect(eventTime({ updatedAt: 10, deletedAt: 50 })).toBe(50);
  });

  it("conflictTitle embeds the local date", () => {
    expect(conflictTitle("Ideas", MERGE_NOW)).toBe("Ideas (conflict 2023-11-15)");
  });
});

/* --------------------------- no-op / fast paths ------------------------- */

describe("no-op syncs", () => {
  it("identical local and remote → plan equals local, zero summary", () => {
    const base = canonical();
    const plan = run({ local: clone(base), remote: clone(base), base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.notebooks).toEqual(base.notebooks);
    expect(plan.sections).toEqual(base.sections);
    expect(plan.pages).toEqual(base.pages);
    expect(plan.summary).toEqual({
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
    });
  });

  it("unchanged local vs changed remote is a pure pull", () => {
    const base = canonical();
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: T + 10 };
    const plan = run({ local: clone(base), remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("remote"));
    expect(plan.summary.pagesUpdated).toBe(1);
    expect(plan.summary.pagesAdded).toBe(0);
  });
});

/* ------------------------------- adds ----------------------------------- */

describe("adds", () => {
  it("both sides appended a page → union keeps both, dense orders, no conflicts", () => {
    const base = canonical();
    const local = clone(base);
    local.pages.push(pg("pL", "s1", { title: "Local new", content: scene("L"), order: 3, createdAt: T + 50, updatedAt: T + 50 }));
    const remote = clone(base);
    remote.pages.push(pg("pR", "s1", { title: "Remote new", content: scene("R"), order: 3, createdAt: T + 60, updatedAt: T + 60 }));

    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.map((p) => p.id).sort()).toEqual(["p1", "p2", "pL", "pR"]);
    expect(plan.summary.pagesAdded).toBe(1); // only the remote page is new here
    expect(plan.summary.pagesConflicted).toBe(0);
    // dense renumbering: base pages keep 1,2; appends get 3,4 (createdAt order)
    const orders = new Map(plan.pages.map((p) => [p.id, p.order]));
    expect(orders.get("p1")).toBe(1);
    expect(orders.get("p2")).toBe(2);
    expect(new Set([orders.get("pL"), orders.get("pR")])).toEqual(new Set([3, 4]));
  });

  it("first sync (base null) with a divergent shared page creates one conflict copy", () => {
    const shared = canonical();
    const local = clone(shared);
    local.pages[0] = { ...local.pages[0], content: scene("local"), updatedAt: T + 20 };
    const remote = clone(shared);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: T + 30 };

    const plan = run({ local, remote, base: null, localPurges: [], remoteTrash: [] });
    // remote newer → wins the shared id; local becomes a dated copy
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("remote"));
    const copy = plan.pages.find((p) => p.id === "fresh-copy-id")!;
    expect(copy.title).toBe("Alpha (conflict 2023-11-15)");
    expect(copy.content).toBe(scene("local"));
    expect(copy.sectionId).toBe("s1");
    expect(copy.deletedAt).toBeNull();
    expect(plan.summary.pagesConflicted).toBe(1);
    expect(plan.summary.pagesAdded).toBe(1); // the copy itself is new
  });
});

/* --------------------------- plain LWW updates -------------------------- */

describe("last-writer-wins", () => {
  it("local-only edit is kept (push), remote-only edit is taken (pull)", () => {
    const base = canonical();

    const push = clone(base);
    push.notebooks[0] = { ...push.notebooks[0], name: "Renamed locally", updatedAt: T + 100 };
    const pushPlan = run({ local: push, remote: clone(base), base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(pushPlan.notebooks[0].name).toBe("Renamed locally");
    expect(pushPlan.summary.treeUpdated).toBe(0); // local already has it

    const pull = clone(base);
    pull.notebooks[0] = { ...pull.notebooks[0], name: "Renamed remotely", updatedAt: T + 100 };
    const pullPlan = run({ local: clone(base), remote: pull, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(pullPlan.notebooks[0].name).toBe("Renamed remotely");
    expect(pullPlan.summary.treeUpdated).toBe(1);
  });

  it("divergent notebook rename: newer side wins", () => {
    const base = canonical();
    const local = clone(base);
    local.notebooks[0] = { ...local.notebooks[0], name: "Local wins", updatedAt: T + 50 };
    const remote = clone(base);
    remote.notebooks[0] = { ...remote.notebooks[0], name: "Remote wins", updatedAt: T + 60 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.notebooks[0].name).toBe("Remote wins");
  });
});

/* ------------------------------ conflicts -------------------------------- */

describe("page conflicts", () => {
  const bothEdited = (lTime: number, rTime: number) => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("local"), updatedAt: lTime };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: rTime };
    return run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
  };

  it("both changed: newer wins, loser becomes a conflict copy appended last", () => {
    const plan = bothEdited(T + 20, T + 30);
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("remote"));
    const copy = plan.pages.find((p) => p.id === "fresh-copy-id")!;
    expect(copy.content).toBe(scene("local"));
    expect(copy.title).toBe("Alpha (conflict 2023-11-15)");
    expect(copy.order).toBe(plan.pages.length); // appended after every sibling
    expect(plan.summary.pagesConflicted).toBe(1);
  });

  it("both changed, local newer: local wins, remote is the copy", () => {
    const plan = bothEdited(T + 40, T + 30);
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("local"));
    expect(plan.pages.find((p) => p.id === "fresh-copy-id")!.content).toBe(scene("remote"));
  });

  it("both changed identically (converged) → no conflict copy", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("same"), updatedAt: T + 20 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("same"), updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages).toHaveLength(2);
    expect(plan.summary.pagesConflicted).toBe(0);
  });

  it("title-only divergence is still a conflict (page-granular merge)", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], title: "Local title", updatedAt: T + 20 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], title: "Remote title", updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.summary.pagesConflicted).toBe(1);
    expect(plan.pages.find((p) => p.id === "p1")!.title).toBe("Remote title");
    expect(plan.pages.find((p) => p.id === "fresh-copy-id")!.title).toBe("Local title (conflict 2023-11-15)");
  });
});

/* ------------------------- deletes & tombstones -------------------------- */

describe("delete vs edit", () => {
  it("remote soft-deleted an untouched local page → page lands in the trash", () => {
    const base = canonical();
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local: clone(base),
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 500, purged: false, title: "Alpha" }],
    });
    expect(plan.pages.find((p) => p.id === "p1")!.deletedAt).toBe(T + 500);
    expect(plan.summary.pagesDeleted).toBe(1);
  });

  it("a newer local edit survives an older remote delete", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("newer"), updatedAt: T + 900 };
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local,
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 500, purged: false, title: "Alpha" }],
    });
    const p = plan.pages.find((x) => x.id === "p1")!;
    expect(p.deletedAt).toBeNull();
    expect(p.content).toBe(scene("newer"));
  });

  it("delete beats an older edit, but the trashed row keeps the edit's content", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("edited"), updatedAt: T + 200 };
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local,
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 500, purged: false, title: "Alpha" }],
    });
    const p = plan.pages.find((x) => x.id === "p1")!;
    expect(p.deletedAt).toBe(T + 500);
    expect(p.content).toBe(scene("edited")); // nothing lost — trash holds the newest content
  });

  it("local delete vs untouched remote → stays deleted and propagates via trashLog", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], deletedAt: T + 100, updatedAt: T + 100 };
    const plan = run({ local, remote: clone(base), base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.find((p) => p.id === "p1")!.deletedAt).toBe(T + 100);
    expect(plan.trashLog).toContainEqual({ id: "p1", kind: "page", at: T + 100, purged: false, title: "Alpha" });
  });

  it("local delete vs newer remote edit → edit wins (page resurrects)", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], deletedAt: T + 100, updatedAt: T + 100 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: T + 300 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    const p = plan.pages.find((x) => x.id === "p1")!;
    expect(p.deletedAt).toBeNull();
    expect(p.content).toBe(scene("remote"));
  });

  it("remote purge tombstone drops the row entirely", () => {
    const base = canonical();
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local: clone(base),
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 500, purged: true, title: "Alpha" }],
    });
    expect(plan.pages.find((p) => p.id === "p1")).toBeUndefined();
    expect(plan.summary.pagesPurged).toBe(1);
    expect(plan.trashLog.find((e) => e.id === "p1")?.purged).toBe(true);
  });

  it("local purge tombstone blocks a remote resurrection", () => {
    const base = canonical();
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: T + 900 };
    const local = clone(base);
    local.pages = local.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local,
      remote,
      base: manifestOf(base),
      localPurges: [{ id: "p1", kind: "page", at: T + 100, purged: true, title: "Alpha" }],
      remoteTrash: [],
    });
    expect(plan.pages.find((p) => p.id === "p1")).toBeUndefined();
    expect(plan.summary.pagesAdded).toBe(0);
  });

  it("stale soft tombstones are dropped from the export log when an edit won", () => {
    const base = canonical();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("newer"), updatedAt: T + 900 };
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local,
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 500, purged: false, title: "Alpha" }],
    });
    expect(plan.trashLog.find((e) => e.id === "p1")).toBeUndefined();
  });
});

/* ------------------------------ tree deletes ----------------------------- */

describe("tree deletes", () => {
  it("remote trashed a section local still has → section trashed, its pages untouched", () => {
    const base = canonical();
    const remote = clone(base);
    remote.sections = remote.sections.filter((s) => s.id !== "s1");
    const plan = run({
      local: clone(base),
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "s1", kind: "section", at: T + 500, purged: false, title: "Section s1" }],
    });
    expect(plan.sections.find((s) => s.id === "s1")!.deletedAt).toBe(T + 500);
    expect(plan.pages.every((p) => p.deletedAt === null)).toBe(true);
    expect(plan.summary.treeDeleted).toBe(1);
  });

  it("local purge of a notebook tombstones its whole subtree on export", () => {
    const base = canonical();
    const local = clone(base);
    local.notebooks = [];
    local.sections = [];
    local.pages = [];
    const plan = run({
      local,
      remote: clone(base),
      base: manifestOf(base),
      localPurges: [
        { id: "nb1", kind: "notebook", at: T + 50, purged: true, title: "Notebook nb1" },
        { id: "s1", kind: "section", at: T + 50, purged: true, title: "Section s1" },
        { id: "p1", kind: "page", at: T + 50, purged: true, title: "Alpha" },
        { id: "p2", kind: "page", at: T + 50, purged: true, title: "Beta" },
      ],
      remoteTrash: [],
    });
    expect(plan.notebooks).toHaveLength(0);
    expect(plan.sections).toHaveLength(0);
    expect(plan.pages).toHaveLength(0);
    expect(plan.trashLog.filter((e) => e.purged)).toHaveLength(4);
  });
});

/* ------------------------------- manifest -------------------------------- */

describe("plan manifest", () => {
  it("describes the merged state and is stable across runs", () => {
    const base = canonical();
    const local = clone(base);
    local.pages.push(pg("pL", "s1", { title: "Local new", order: 3, createdAt: T + 50, updatedAt: T + 50 }));
    const remote = clone(base);
    remote.pages.push(pg("pR", "s1", { title: "Remote new", order: 3, createdAt: T + 60, updatedAt: T + 60 }));
    const i: SyncInputs = { local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] };
    const a = run(i);
    const b = run(i);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.manifest.pages.map((p) => p.id).sort()).toEqual(["p1", "p2", "pL", "pR"]);
    expect(a.manifest.exportedAt).toBe(MERGE_NOW);
  });
});

/* ----------------- out-of-contract folders (stale + tombstone) ----------- */

describe("out-of-contract folders: stale rows heal against their tombstones", () => {
  // The folder can carry BOTH a stale row and its tombstone: a page file the
  // writer could not remove, a partially replicated directory (Syncthing
  // replicates file-by-file), a crashed write. A device that never saw the
  // row must merge it as DELETED — resurrecting it would flip-flop against
  // every device that holds the trashed row.

  it("a stale remote page file plus its tombstone stays deleted on a fresh device", () => {
    // Fresh device: only ever saw p1.
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [pg("p1", "s1", { title: "Alpha", content: scene("l"), order: 1 })],
    };
    // Folder: p2's page file (stale, alive-looking) AND p2's tombstone.
    const remote: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [
        pg("p1", "s1", { title: "Alpha", content: scene("l"), order: 1 }),
        pg("p2", "s1", { title: "Beta", content: scene("stale"), order: 2 }),
      ],
    };
    const plan = run({
      local,
      remote,
      base: null,
      localPurges: [],
      remoteTrash: [{ id: "p2", kind: "page", at: T + 100, purged: false, title: "Beta" }],
    });

    const p2 = plan.pages.find((p) => p.id === "p2");
    expect(p2?.deletedAt).toBe(T + 100); // deleted, not resurrected
    expect(p2?.content).toBe(scene("stale")); // stale content survives → restorable
    // the re-exported tombstone log still carries the delete
    expect(plan.trashLog.find((e) => e.id === "p2")?.at).toBe(T + 100);
    // and the summary does not count a resurrected add
    expect(plan.summary.pagesAdded).toBe(0);
  });

  it("a stale remote section row plus its tombstone stays deleted", () => {
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [],
    };
    const remote: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1"), sec("s2", "nb1", { name: "Ghost", order: 2 })],
      pages: [],
    };
    const plan = run({
      local,
      remote,
      base: null,
      localPurges: [],
      remoteTrash: [{ id: "s2", kind: "section", at: T + 100, purged: false, title: "Ghost" }],
    });
    expect(plan.sections.find((s) => s.id === "s2")?.deletedAt).toBe(T + 100);
  });

  it("a remote row NEWER than its tombstone still wins (newer edit resurrects)", () => {
    // A device resurrected the page and edited it at T+200; the tombstone
    // (T+100) is the older event → the newer edit wins, exactly like the
    // delete-vs-edit rule for rows both sides have.
    const local: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [],
    };
    const remote: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [pg("p9", "s1", { title: "Edited after delete", updatedAt: T + 200 })],
    };
    const plan = run({
      local,
      remote,
      base: null,
      localPurges: [],
      remoteTrash: [{ id: "p9", kind: "page", at: T + 100, purged: false, title: "Old title" }],
    });
    const p9 = plan.pages.find((p) => p.id === "p9");
    expect(p9?.deletedAt).toBeNull(); // alive — the newer edit resurrects
    expect(plan.summary.pagesAdded).toBe(1);
    // the stale tombstone is dropped from the re-export (it lost)
    expect(plan.trashLog.find((e) => e.id === "p9")).toBeUndefined();
  });

  it("a purge tombstone still wins over a stale row, no matter its timestamp", () => {
    const local: LibrarySnapshot = { notebooks: [], sections: [], pages: [] };
    const remote: LibrarySnapshot = {
      notebooks: [nb("nb1")],
      sections: [sec("s1", "nb1")],
      pages: [pg("pz", "s1", { title: "Purged", updatedAt: T + 500 })],
    };
    const plan = run({
      local,
      remote,
      base: null,
      localPurges: [],
      remoteTrash: [{ id: "pz", kind: "page", at: T + 100, purged: true, title: "Purged" }],
    });
    expect(plan.pages.find((p) => p.id === "pz")).toBeUndefined(); // purge: final
  });
});
