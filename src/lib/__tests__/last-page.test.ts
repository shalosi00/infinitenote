/// <reference types="bun-types" />
import { afterEach, describe, expect, it } from "bun:test";
import {
  LAST_PAGE_STORAGE_KEY,
  loadLastSelection,
  pickRestoredSelection,
  saveLastSelection,
} from "../last-page";
import type { Selection, TreeSnapshot } from "../tree-ops";
import type { Notebook, PageMeta, Section } from "../types";

/**
 * Bun has no localStorage — stub the global the module reads. The stub is
 * installed per-test so the "storage missing" path is also testable.
 */
type LocalStorageStub = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};
const backing = new Map<string, string>();
function installStub(): void {
  (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
  };
}
function removeStub(): void {
  delete (globalThis as unknown as { localStorage?: LocalStorageStub }).localStorage;
  backing.clear();
}

const sel = (notebookId: string, sectionId: string, pageId: string): Selection => ({
  notebookId,
  sectionId,
  pageId,
});

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
  background: "plain",
  tags: [],
} as unknown as PageMeta);

const TREE: TreeSnapshot = {
  notebooks: [mkNotebook("nb1", 0), mkNotebook("nb2", 1)],
  sections: [mkSection("s1", "nb1", 0), mkSection("s2", "nb1", 1), mkSection("s3", "nb2", 0)],
  pages: [mkPage("p1", "s1", 0), mkPage("p2", "s2", 0), mkPage("p3", "s3", 0)],
};

afterEach(removeStub);

describe("saveLastSelection / loadLastSelection", () => {
  it("round-trips a selection through storage", () => {
    installStub();
    saveLastSelection(sel("nb1", "s2", "p2"));
    expect(loadLastSelection()).toEqual(sel("nb1", "s2", "p2"));
    expect(backing.get(LAST_PAGE_STORAGE_KEY)).toBe(
      JSON.stringify(sel("nb1", "s2", "p2")),
    );
  });

  it("returns null when nothing was stored", () => {
    installStub();
    expect(loadLastSelection()).toBeNull();
  });

  it("returns null when storage is unavailable (SSR)", () => {
    removeStub();
    saveLastSelection(sel("nb1", "s1", "p1")); // must not throw
    expect(loadLastSelection()).toBeNull();
  });

  it("rejects malformed JSON and wrong shapes instead of throwing", () => {
    installStub();
    for (const bad of [
      "not json",
      "null",
      "42",
      '"string"',
      "[]",
      JSON.stringify({ pageId: "p1" }),
      JSON.stringify({ notebookId: "nb1", sectionId: "s1" }),
      JSON.stringify({ notebookId: "", sectionId: "s1", pageId: "p1" }),
      JSON.stringify({ notebookId: 1, sectionId: "s1", pageId: "p1" }),
    ]) {
      backing.set(LAST_PAGE_STORAGE_KEY, bad);
      expect(loadLastSelection()).toBeNull();
    }
  });
});

describe("pickRestoredSelection — graceful fallback (issue #123)", () => {
  it("restores a still-valid selection", () => {
    expect(pickRestoredSelection(sel("nb1", "s2", "p2"), TREE)).toEqual(sel("nb1", "s2", "p2"));
  });

  it("re-derives the parent chain when the page was moved between sessions", () => {
    // stale ids, but the page itself still exists → resolved to its real home
    expect(pickRestoredSelection(sel("nb2", "s3", "p1"), TREE)).toEqual(sel("nb1", "s1", "p1"));
  });

  it("falls back to null for a page trashed or deleted between sessions", () => {
    expect(pickRestoredSelection(sel("nb1", "s1", "deleted-page"), TREE)).toBeNull();
  });

  it("falls back to null when the stored value is null", () => {
    expect(pickRestoredSelection(null, TREE)).toBeNull();
  });
});
