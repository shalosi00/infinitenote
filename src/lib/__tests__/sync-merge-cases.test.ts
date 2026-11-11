/// <reference types="bun-types" />
/**
 * Additional conflict/precedence cases for the pure sync merge engine
 * (src/lib/sync/merge.ts) beyond sync-merge.test.ts: tie-breaks at equal
 * timestamps, section moves (one-sided and concurrent), metadata divergence
 * (tags/background), order-only divergence, delete-vs-delete, trash-log
 * ordering, order-normalization boundaries (trashed rows keep their order,
 * per-notebook renumbering), base-only rows, full-subtree remote purges and
 * multi-conflict rounds. Pure — plain objects, injected clock and id factory.
 */
import { describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import { buildManifest, type LibrarySnapshot, type SyncManifest } from "../sync/format";
import { computeSyncPlan, conflictTitle, eventTime, type SyncInputs } from "../sync/merge";

const T = 1_700_000_000_000; // fixed clock base
const NOW = T + 1_000_000; // injected merge clock

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

const scene = (mark: string) => JSON.stringify({ elements: [{ mark }], files: {} });

/** Canonical library: nb1 / {s1, s2} / p1 "Alpha" + p2 "Beta" in s1. */
function library(): LibrarySnapshot {
  return {
    notebooks: [nb("nb1")],
    sections: [sec("s1", "nb1", { order: 1 }), sec("s2", "nb1", { order: 2 })],
    pages: [
      pg("p1", "s1", { title: "Alpha", content: scene("p1"), order: 1 }),
      pg("p2", "s1", { title: "Beta", content: scene("p2"), order: 2 }),
    ],
  };
}

const clone = (s: LibrarySnapshot): LibrarySnapshot => JSON.parse(JSON.stringify(s)) as LibrarySnapshot;
const manifestOf = (s: LibrarySnapshot, exportedAt = T): SyncManifest => buildManifest(s, exportedAt);

/** Run with an injected clock and per-run conflict-copy ids (copy-1, copy-2…). */
const run = (i: SyncInputs) => {
  let n = 0;
  return computeSyncPlan(i, { now: NOW, newId: () => `copy-${++n}` });
};

/* --------------------------- time boundaries ---------------------------- */

describe("eventTime / conflictTitle boundaries", () => {
  it("eventTime ignores an absent or older deletedAt", () => {
    expect(eventTime({ updatedAt: 42 })).toBe(42);
    expect(eventTime({ updatedAt: 100, deletedAt: 50 })).toBe(100);
  });

  it("conflictTitle zero-pads month/day and renders leap-day dates", () => {
    // noon UTC keeps the local calendar date stable in any reasonable timezone
    expect(conflictTitle("Pad", Date.UTC(2023, 0, 5, 12))).toBe("Pad (conflict 2023-01-05)");
    expect(conflictTitle("Leap", Date.UTC(2024, 1, 29, 12))).toBe("Leap (conflict 2024-02-29)");
    expect(conflictTitle("Late", Date.UTC(2023, 11, 31, 12))).toBe("Late (conflict 2023-12-31)");
  });
});

/* ------------------------------ tie-breaks ------------------------------- */

describe("tie-breaks at equal timestamps", () => {
  it("divergent page edits at the exact same time keep the local side", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("local"), updatedAt: T + 30 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote"), updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("local"));
    expect(plan.pages.find((p) => p.id === "copy-1")!.content).toBe(scene("remote"));
    expect(plan.summary.pagesConflicted).toBe(1);
  });

  it("divergent notebook renames at the exact same time keep the local side", () => {
    const base = library();
    const local = clone(base);
    local.notebooks[0] = { ...local.notebooks[0], name: "Local tie", updatedAt: T + 30 };
    const remote = clone(base);
    remote.notebooks[0] = { ...remote.notebooks[0], name: "Remote tie", updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.notebooks.find((n) => n.id === "nb1")!.name).toBe("Local tie");
  });
});

/* ----------------------------- section moves ----------------------------- */

describe("page moves across sections", () => {
  it("a one-sided move into another section sticks (LWW keeps the local move)", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], sectionId: "s2", updatedAt: T + 20 };
    const plan = run({ local, remote: clone(base), base: manifestOf(base), localPurges: [], remoteTrash: [] });
    const p1 = plan.pages.find((p) => p.id === "p1")!;
    expect(p1.sectionId).toBe("s2");
    expect(p1.order).toBe(1); // only alive page in s2 now
    expect(plan.summary.pagesConflicted).toBe(0);
  });

  it("concurrent moves into different sections conflict; the copy keeps the loser's section", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], sectionId: "s2", updatedAt: T + 20 };
    const remote = clone(base);
    remote.sections.push(sec("s3", "nb1", { order: 3 }));
    remote.pages[0] = { ...remote.pages[0], sectionId: "s3", updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.find((p) => p.id === "p1")!.sectionId).toBe("s3");
    expect(plan.pages.find((p) => p.id === "copy-1")!.sectionId).toBe("s2");
    expect(plan.summary.pagesConflicted).toBe(1);
  });
});

/* -------------------------- metadata divergence -------------------------- */

describe("metadata divergence", () => {
  it("tags vs background edits conflict; the copy preserves the loser's tags", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], tags: ["urgent"], updatedAt: T + 20 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], background: "grid", updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages.find((p) => p.id === "p1")!.background).toBe("grid");
    const copy = plan.pages.find((p) => p.id === "copy-1")!;
    expect(copy.tags).toEqual(["urgent"]);
    expect(plan.summary.pagesConflicted).toBe(1);
  });

  it("order-only divergence converges without a conflict copy (order is not content)", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], order: 5, updatedAt: T + 20 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], order: 9, updatedAt: T + 30 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.pages).toHaveLength(2);
    expect(plan.summary.pagesConflicted).toBe(0);
    // both sides agree p1 comes after p2 → the dense order reflects that
    const orders = new Map(plan.pages.map((p) => [p.id, p.order]));
    expect(orders.get("p2")).toBe(1);
    expect(orders.get("p1")).toBe(2);
  });
});

/* ---------------------------- delete vs delete ---------------------------- */

describe("delete vs delete", () => {
  it("both sides soft-deleted the page → the newer delete timestamp wins", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], deletedAt: T + 100, updatedAt: T + 100 };
    const remote = clone(base);
    remote.pages = remote.pages.filter((p) => p.id !== "p1");
    const plan = run({
      local,
      remote,
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [{ id: "p1", kind: "page", at: T + 200, purged: false, title: "Alpha" }],
    });
    const p1 = plan.pages.find((p) => p.id === "p1")!;
    expect(p1.deletedAt).toBe(T + 200);
    expect(p1.content).toBe(scene("p1")); // the trashed row keeps its content
    expect(plan.trashLog.find((e) => e.id === "p1")?.at).toBe(T + 200);
  });
});

/* ------------------------------ trash log -------------------------------- */

describe("trash log export", () => {
  it("is sorted by timestamp first, then by id", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], deletedAt: T + 100, updatedAt: T + 100 };
    local.pages[1] = { ...local.pages[1], deletedAt: T + 100, updatedAt: T + 100 };
    const plan = run({
      local,
      remote: clone(base),
      base: manifestOf(base),
      localPurges: [],
      // tombstone for a row this device never saw (must survive the export)
      remoteTrash: [{ id: "p9", kind: "page", at: T + 50, purged: false, title: "Never seen" }],
    });
    expect(plan.trashLog.map((e) => e.id)).toEqual(["p9", "p1", "p2"]);
  });
});

/* -------------------------- order normalization --------------------------- */

describe("order normalization boundaries", () => {
  it("trashed rows keep their old order while alive siblings are renumbered", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], deletedAt: T + 100, updatedAt: T + 100 };
    const remote = clone(base);
    remote.pages.push(
      pg("p3", "s1", { title: "Gamma", order: 3, createdAt: T + 50, updatedAt: T + 50 })
    );
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    const byId = new Map(plan.pages.map((p) => [p.id, p]));
    expect(byId.get("p1")!.deletedAt).toBe(T + 100);
    expect(byId.get("p1")!.order).toBe(1); // trash is never renumbered
    expect(byId.get("p2")!.order).toBe(1); // dense among the alive siblings
    expect(byId.get("p3")!.order).toBe(2);
  });

  it("renumbers sections densely per notebook, independently", () => {
    const base: LibrarySnapshot = {
      notebooks: [nb("nb1"), nb("nb2")],
      sections: [
        sec("s1", "nb1", { order: 1 }),
        sec("t1", "nb2", { order: 1 }),
        sec("t2", "nb2", { order: 2 }),
      ],
      pages: [],
    };
    const local = clone(base);
    local.sections.push(sec("s2", "nb1", { order: 5, createdAt: T + 10, updatedAt: T + 10 }));
    const remote = clone(base);
    remote.sections.push(sec("t3", "nb2", { order: 9, createdAt: T + 20, updatedAt: T + 20 }));
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    const orders = new Map(plan.sections.map((s) => [s.id, s.order]));
    expect(orders.get("s1")).toBe(1);
    expect(orders.get("s2")).toBe(2);
    expect(orders.get("t1")).toBe(1);
    expect(orders.get("t2")).toBe(2);
    expect(orders.get("t3")).toBe(3);
  });
});

/* ------------------------- purge / base coverage -------------------------- */

describe("base and purge coverage", () => {
  it("a row that exists only in the base (gone on both sides) is dropped", () => {
    const base = library();
    const withGone = clone(base);
    withGone.pages.push(
      pg("pGone", "s1", { title: "Gone", order: 3, createdAt: T + 5, updatedAt: T + 5 })
    );
    const plan = run({
      local: clone(base),
      remote: clone(base),
      base: manifestOf(withGone),
      localPurges: [],
      remoteTrash: [],
    });
    expect(plan.pages.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(plan.summary.pagesPurged).toBe(0); // it was never on this device
  });

  it("a remote notebook purge with subtree tombstones wipes the whole tree", () => {
    const base = library();
    const plan = run({
      local: clone(base),
      remote: { notebooks: [], sections: [], pages: [] },
      base: manifestOf(base),
      localPurges: [],
      remoteTrash: [
        { id: "nb1", kind: "notebook", at: T + 50, purged: true, title: "Notebook nb1" },
        { id: "s1", kind: "section", at: T + 50, purged: true, title: "Section s1" },
        { id: "s2", kind: "section", at: T + 50, purged: true, title: "Section s2" },
        { id: "p1", kind: "page", at: T + 50, purged: true, title: "Alpha" },
        { id: "p2", kind: "page", at: T + 50, purged: true, title: "Beta" },
      ],
    });
    expect(plan.notebooks).toHaveLength(0);
    expect(plan.sections).toHaveLength(0);
    expect(plan.pages).toHaveLength(0);
    expect(plan.summary.treePurged).toBe(3); // nb1 + s1 + s2
    expect(plan.summary.pagesPurged).toBe(2);
    expect(plan.trashLog.filter((e) => e.purged)).toHaveLength(5);
  });

  it("two concurrent conflicts produce two copies carrying the losers' content", () => {
    const base = library();
    const local = clone(base);
    local.pages[0] = { ...local.pages[0], content: scene("local1"), updatedAt: T + 20 };
    local.pages[1] = { ...local.pages[1], content: scene("local2"), updatedAt: T + 25 };
    const remote = clone(base);
    remote.pages[0] = { ...remote.pages[0], content: scene("remote1"), updatedAt: T + 30 };
    remote.pages[1] = { ...remote.pages[1], content: scene("remote2"), updatedAt: T + 35 };
    const plan = run({ local, remote, base: manifestOf(base), localPurges: [], remoteTrash: [] });
    expect(plan.summary.pagesConflicted).toBe(2);
    expect(plan.pages.find((p) => p.id === "p1")!.content).toBe(scene("remote1"));
    expect(plan.pages.find((p) => p.id === "p2")!.content).toBe(scene("remote2"));
    expect(plan.pages.find((p) => p.id === "copy-1")!.content).toBe(scene("local1"));
    expect(plan.pages.find((p) => p.id === "copy-2")!.content).toBe(scene("local2"));
    expect(plan.summary.pagesAdded).toBe(2);
  });
});
