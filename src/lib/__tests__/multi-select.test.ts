/// <reference types="bun-types" />
/**
 * Unit tests for the pure multi-select helpers (issue #27).
 */
import { describe, expect, it } from "bun:test";
import {
  allSelected,
  pruneSelected,
  someSelected,
  toggleSelected,
  visiblePageIds,
} from "../multi-select";
import type { PageMeta, Section } from "../types";

const page = (id: string, sectionId: string, order: number): PageMeta => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order,
  createdAt: order,
  updatedAt: order,
  deletedAt: null,
});

const section = (id: string, notebookId: string, order: number): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order,
  createdAt: order,
  updatedAt: order,
  deletedAt: null,
});

describe("toggleSelected", () => {
  it("adds an id to an empty set", () => {
    expect(toggleSelected(new Set(), "a")).toEqual(new Set(["a"]));
  });

  it("toggles an existing id off and leaves others untouched", () => {
    const next = toggleSelected(new Set(["a", "b"]), "a");
    expect(next).toEqual(new Set(["b"]));
  });

  it("never mutates the input set", () => {
    const input = new Set(["a"]);
    toggleSelected(input, "b");
    expect(input).toEqual(new Set(["a"]));
  });
});

describe("visiblePageIds", () => {
  const sections = [section("s1", "n1", 1), section("s2", "n1", 2)];
  const pages = [page("p1", "s1", 1), page("p2", "s1", 2), page("p3", "s2", 1)];

  it("returns only pages inside expanded sections", () => {
    expect(visiblePageIds(pages, sections, new Set(["s1"]))).toEqual(["p1", "p2"]);
    expect(visiblePageIds(pages, sections, new Set(["s1", "s2"]))).toEqual(["p1", "p2", "p3"]);
  });

  it("is empty when nothing is expanded", () => {
    expect(visiblePageIds(pages, sections, new Set())).toEqual([]);
  });

  it("ignores pages of sections missing from the sections list", () => {
    expect(visiblePageIds([page("orphan", "gone", 1)], sections, new Set(["s1", "s2"]))).toEqual([]);
  });
});

describe("allSelected / someSelected", () => {
  it("allSelected is false for an empty candidate list", () => {
    expect(allSelected(new Set(["a"]), [])).toBe(false);
  });

  it("allSelected requires every id to be present", () => {
    expect(allSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(allSelected(new Set(["a"]), ["a", "b"])).toBe(false);
  });

  it("someSelected matches at least one id", () => {
    expect(someSelected(new Set(["a"]), ["a", "b"])).toBe(true);
    expect(someSelected(new Set(["c"]), ["a", "b"])).toBe(false);
    expect(someSelected(new Set(), [])).toBe(false);
  });
});

describe("pruneSelected", () => {
  it("drops ids that no longer exist among alive pages", () => {
    const pages = [page("p1", "s1", 1), page("p2", "s1", 2)];
    expect(pruneSelected(new Set(["p1", "gone"]), pages)).toEqual(new Set(["p1"]));
  });

  it("returns an empty set unchanged for an empty selection", () => {
    expect(pruneSelected(new Set(), [page("p1", "s1", 1)])).toEqual(new Set());
  });
});
