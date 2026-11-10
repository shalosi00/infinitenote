/// <reference types="bun-types" />
/**
 * Edge-case unit tests for the pure tree operations (tree-ops.ts) — the
 * boundary and tie-break behavior the base suite (tree-ops.test.ts) does
 * not pin: findNotebookOfSection, equal-order and interstitial (fractional)
 * page orders from drag-drop inserts, cross-notebook fallbacks after a
 * delete, stale selections, unknown notebook preferences, section-order
 * precedence over array order, and degenerate-tree expansion defaults.
 */
import { describe, expect, it } from "bun:test";
import {
  defaultExpandedState,
  findNotebookOfSection,
  firstPageSelection,
  nextSelectionAfterPageDelete,
  type TreeSnapshot,
} from "../tree-ops";
import type { Notebook, PageMeta, Section } from "../types";

const mkNotebook = (id: string, order: number): Notebook => ({
  id,
  name: id,
  color: "violet",
  order,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const mkSection = (id: string, notebookId: string, order: number): Section => ({
  id,
  notebookId,
  name: id,
  order,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const mkPage = (id: string, sectionId: string, order: number): PageMeta => ({
  id,
  sectionId,
  title: id,
  order,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

/** Like mkPage but with an explicit createdAt — needed for order-tie cases. */
const mkPageAt = (id: string, sectionId: string, order: number, createdAt: number): PageMeta => ({
  id,
  sectionId,
  title: id,
  order,
  createdAt,
  updatedAt: createdAt,
  deletedAt: null,
});

function fixture(): TreeSnapshot {
  return {
    notebooks: [mkNotebook("nb1", 1), mkNotebook("nb2", 2)],
    sections: [mkSection("s1", "nb1", 1), mkSection("s2", "nb1", 2), mkSection("s3", "nb2", 1)],
    pages: [
      mkPage("p1", "s1", 1),
      mkPage("p2", "s1", 2),
      mkPage("p3", "s2", 1),
      mkPage("p4", "s3", 1),
    ],
  };
}

describe("findNotebookOfSection", () => {
  it("returns undefined for an unknown section and for an orphaned section", () => {
    expect(findNotebookOfSection(fixture(), "no-such-section")).toBeUndefined();
    // the section row exists but its notebook no longer does (stale snapshot)
    const orphaned = fixture();
    orphaned.notebooks = orphaned.notebooks.filter((n) => n.id !== "nb1");
    expect(findNotebookOfSection(orphaned, "s1")).toBeUndefined();
  });
});

describe("nextSelectionAfterPageDelete — order edges", () => {
  it("deleting a middle page picks the next sibling and keeps the full selection scope", () => {
    const tree: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1)],
      sections: [mkSection("s1", "nb1", 1)],
      pages: [mkPage("a", "s1", 1), mkPage("b", "s1", 2), mkPage("c", "s1", 3)],
    };
    const sel = nextSelectionAfterPageDelete(tree, {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "b",
    });
    // both neighbors exist — OneNote picks the NEXT page, not the previous
    expect(sel).toEqual({ notebookId: "nb1", sectionId: "s1", pageId: "c" });
  });

  it("equal-order ties resolve to the tied survivor, not the strictly later page", () => {
    // a and b share order 1 (drag-drop collision); byOrder breaks the tie by createdAt
    const tied = (): TreeSnapshot => ({
      notebooks: [mkNotebook("nb1", 1)],
      sections: [mkSection("s1", "nb1", 1)],
      pages: [
        mkPageAt("a", "s1", 1, 10),
        mkPageAt("b", "s1", 1, 20),
        mkPageAt("c", "s1", 2, 30),
      ],
    });
    const deletePage = (pageId: string): string | undefined =>
      nextSelectionAfterPageDelete(tied(), { notebookId: "nb1", sectionId: "s1", pageId })
        ?.pageId;
    expect(deletePage("b")).toBe("a");
    expect(deletePage("a")).toBe("b");
  });

  it("interstitial fractional orders (mid-list drag-drop inserts) keep next-page semantics", () => {
    const tree: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1)],
      sections: [mkSection("s1", "nb1", 1)],
      pages: [mkPage("a", "s1", 1), mkPage("mid", "s1", 1.5), mkPage("b", "s1", 2)],
    };
    const sel = nextSelectionAfterPageDelete(tree, {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "mid",
    });
    expect(sel?.pageId).toBe("b");
  });
});

describe("nextSelectionAfterPageDelete — fallback edges", () => {
  it("deleting the only page of a notebook falls through to the first page anywhere", () => {
    const tree: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1), mkNotebook("nb2", 2)],
      sections: [mkSection("s1", "nb1", 1), mkSection("s2", "nb2", 1)],
      pages: [mkPage("p1", "s1", 1), mkPage("p9", "s2", 1)],
    };
    const sel = nextSelectionAfterPageDelete(tree, {
      notebookId: "nb2",
      sectionId: "s2",
      pageId: "p9",
    });
    // nb2 is now pageless → the very first page anywhere (nb1/s1) is opened
    expect(sel).toEqual({ notebookId: "nb1", sectionId: "s1", pageId: "p1" });
  });

  it("a stale page id (already absent from the tree) lands on the last page of the section", () => {
    const tree: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1)],
      sections: [mkSection("s1", "nb1", 1)],
      pages: [mkPage("p1", "s1", 1), mkPage("p2", "s1", 2), mkPage("p3", "s1", 3)],
    };
    const sel = nextSelectionAfterPageDelete(tree, {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "ghost",
    });
    // deletedOrder defaults to +Infinity → no survivor sorts after it → last page
    expect(sel?.pageId).toBe("p3");
  });
});

describe("firstPageSelection — edges", () => {
  it("an unknown preferred notebook falls back to the global first page", () => {
    const sel = firstPageSelection(fixture(), "no-such-notebook");
    expect(sel).toEqual({ notebookId: "nb1", sectionId: "s1", pageId: "p1" });
  });

  it("follows section order, not the order sections appear in the array", () => {
    const tree: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1)],
      sections: [mkSection("sLate", "nb1", 2), mkSection("sEarly", "nb1", 1)],
      pages: [mkPage("latePage", "sLate", 1), mkPage("earlyPage", "sEarly", 5)],
    };
    const sel = firstPageSelection(tree);
    expect(sel).toEqual({ notebookId: "nb1", sectionId: "sEarly", pageId: "earlyPage" });
  });
});

describe("defaultExpandedState — degenerate trees", () => {
  it("opens only the notebook when the first notebook has no sections, and nothing on an empty tree", () => {
    const sectionless: TreeSnapshot = {
      notebooks: [mkNotebook("nb1", 1), mkNotebook("nb2", 2)],
      sections: [mkSection("s2", "nb2", 1)],
      pages: [mkPage("p", "s2", 1)],
    };
    const open = defaultExpandedState(sectionless, null);
    expect(open.has("nb1")).toBe(true);
    // must NOT fall through to a section of a different notebook
    expect(open.size).toBe(1);

    const empty = defaultExpandedState({ notebooks: [], sections: [], pages: [] }, null);
    expect(empty.size).toBe(0);
  });
});
