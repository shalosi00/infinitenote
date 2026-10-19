/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  defaultExpandedState,
  firstPageSelection,
  nextSelectionAfterPageDelete,
  type Selection,
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

describe("firstPageSelection", () => {
  it("returns the first page of the preferred notebook", () => {
    const sel = firstPageSelection(fixture(), "nb2");
    expect(sel?.pageId).toBe("p4");
    expect(sel?.notebookId).toBe("nb2");
  });

  it("falls back to the very first page with no preference", () => {
    const sel = firstPageSelection(fixture());
    expect(sel?.pageId).toBe("p1");
  });

  it("returns null on an empty tree", () => {
    expect(firstPageSelection({ notebooks: [], sections: [], pages: [] })).toBeNull();
  });

  it("skips sections with no pages", () => {
    const tree = fixture();
    tree.pages = tree.pages.filter((p) => p.sectionId !== "s1");
    const sel = firstPageSelection(tree, "nb1");
    expect(sel?.pageId).toBe("p3");
  });
});

describe("nextSelectionAfterPageDelete", () => {
  it("prefers the next sibling", () => {
    const sel = nextSelectionAfterPageDelete(fixture(), {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "p1",
    });
    expect(sel?.pageId).toBe("p2");
  });

  it("falls back to the previous sibling when deleting the last", () => {
    const sel = nextSelectionAfterPageDelete(fixture(), {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "p2",
    });
    expect(sel?.pageId).toBe("p1");
  });

  it("falls back to first page in the notebook when the section becomes empty", () => {
    const sel = nextSelectionAfterPageDelete(fixture(), {
      notebookId: "nb1",
      sectionId: "s2",
      pageId: "p3",
    });
    expect(sel?.pageId).toBe("p1");
  });

  it("returns null when deleting the only page everywhere", () => {
    const tree = fixture();
    tree.notebooks = [mkNotebook("nb1", 1)];
    tree.sections = [mkSection("s1", "nb1", 1)];
    tree.pages = [mkPage("p1", "s1", 1)];
    const sel = nextSelectionAfterPageDelete(tree, {
      notebookId: "nb1",
      sectionId: "s1",
      pageId: "p1",
    });
    expect(sel).toBeNull();
  });
});

describe("defaultExpandedState", () => {
  it("expands the selected notebook + section", () => {
    const selection: Selection = { notebookId: "nb2", sectionId: "s3", pageId: "p4" };
    const open = defaultExpandedState(fixture(), selection);
    expect(open.has("nb2")).toBe(true);
    expect(open.has("s3")).toBe(true);
    expect(open.size).toBe(2);
  });

  it("without selection opens the first notebook's first section", () => {
    const open = defaultExpandedState(fixture(), null);
    expect(open.has("nb1")).toBe(true);
    expect(open.has("s1")).toBe(true);
  });
});
