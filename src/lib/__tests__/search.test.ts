/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { buildSearchIndex, extractSearchableText, searchIndex } from "../search";
import type { Notebook, PageMeta, Section } from "../types";

const nb: Notebook = {
  id: "nb1",
  name: "Physics",
  color: "violet",
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const sec: Section = {
  id: "s1",
  notebookId: "nb1",
  name: "Mechanics",
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const page = (id: string, title: string, content: string | null): PageMeta & { content: string | null } => ({
  id,
  sectionId: "s1",
  title,
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  content,
});

const scene = (...texts: string[]) =>
  JSON.stringify({
    elements: texts.map((text, i) => ({ type: "text", text, id: `el${i}` })),
    files: {},
  });

describe("extractSearchableText", () => {
  it("collects text element bodies", () => {
    const out = extractSearchableText(scene("hello world", "second element"));
    expect(out).toEqual(["hello world", "second element"]);
  });

  it("ignores non-text elements", () => {
    const out = extractSearchableText(
      JSON.stringify({ elements: [{ type: "rectangle", id: "r1" }, { type: "text", text: "only this" }] })
    );
    expect(out).toEqual(["only this"]);
  });

  it("handles null / invalid json / empty", () => {
    expect(extractSearchableText(null)).toEqual([]);
    expect(extractSearchableText("")).toEqual([]);
    expect(extractSearchableText("not json at all {")).toEqual([]);
    expect(extractSearchableText(JSON.stringify({ elements: [] }))).toEqual([]);
  });

  it("skips empty strings", () => {
    expect(extractSearchableText(scene("  ", ""))).toEqual([]);
  });
});

describe("searchIndex", () => {
  const index = buildSearchIndex([nb], [sec], [
    page("p1", "Newton laws", scene("An object at rest stays at rest", "F = ma")),
    page("p2", "Thermodynamics", scene("Entropy tends to increase")),
  ]);

  it("finds by title", () => {
    const hits = searchIndex(index, "newton");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p1");
    expect(hits[0].title).toBe("Newton laws");
  });

  it("finds by body content", () => {
    const hits = searchIndex(index, "entropy");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p2");
    expect(hits[0].snippet).toContain("Entropy tends to increase");
  });

  it("requires all terms (AND)", () => {
    expect(searchIndex(index, "entropy newton")).toHaveLength(0);
    expect(searchIndex(index, "object rest")).toHaveLength(1);
  });

  it("ranks title matches higher", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("pa", "Other page", scene("quantum mentioned in body")),
      page("pb", "Quantum title", scene("unrelated body")),
    ]);
    const hits = searchIndex(idx, "quantum");
    expect(hits[0].pageId).toBe("pb");
  });

  it("empty query returns nothing", () => {
    expect(searchIndex(index, "")).toEqual([]);
    expect(searchIndex(index, "   ")).toEqual([]);
  });

  it("exposes the notebook path", () => {
    const hits = searchIndex(index, "thermo");
    expect(hits[0].pagePath).toBe("Physics / Mechanics");
    expect(hits[0].notebookId).toBe("nb1");
  });
});
