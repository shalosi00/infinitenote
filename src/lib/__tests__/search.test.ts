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

const taggedPage = (
  id: string,
  title: string,
  tags: string[],
  content: string | null
): PageMeta & { content: string | null } => ({
  ...page(id, title, content),
  tags,
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

  it("finds pages by tag", () => {
    const idx = buildSearchIndex([nb], [sec], [
      taggedPage("pt", "Untitled", ["quantumfrog"], scene("nothing relevant here")),
      page("po", "Other", scene("quantumfrog appears in body")),
    ]);
    const hits = searchIndex(idx, "quantumfrog");
    expect(hits).toHaveLength(2);
    // tag and body match tie on content count; tag-only page still ranked
    expect(hits.map((h) => h.pageId)).toContain("pt");
  });

  it("AND-search works across title + tag", () => {
    const idx = buildSearchIndex([nb], [sec], [
      taggedPage("pt", "Garden", ["perennial"], scene("roses")),
    ]);
    expect(searchIndex(idx, "garden perennial")).toHaveLength(1);
    expect(searchIndex(idx, "garden annual")).toHaveLength(0);
  });
});

describe("search — audio clip names (issue #67)", () => {
  const audioScene = (name: string) =>
    JSON.stringify({
      elements: [
        { type: "text", text: "Lecture notes", id: "el0" },
        { type: "embeddable", id: "el1", customData: { audioName: name } },
      ],
      files: {},
    });

  it("extracts audio clip filenames from embeddable customData", () => {
    expect(extractSearchableText(audioScene("interview with Ada.mp3"))).toEqual([
      "Lecture notes",
      "interview with Ada.mp3",
    ]);
  });

  it("finds pages by audio filename through the index", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("p1", "Field trip", audioScene("birdsong recording.wav")),
    ]);
    const hits = searchIndex(idx, "birdsong");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p1");
  });

  it("ignores audio blocks without a usable name", () => {
    expect(extractSearchableText(audioScene("   "))).toEqual(["Lecture notes"]);
    expect(extractSearchableText(audioScene(""))).toEqual(["Lecture notes"]);
    // non-embeddable elements carrying customData stay out of search
    const otherScene = JSON.stringify({
      elements: [{ type: "rectangle", id: "r", customData: { audioName: "x.mp3" } }],
      files: {},
    });
    expect(extractSearchableText(otherScene)).toEqual([]);
  });
});

describe("search — PDF attachment names (docs/test-plans/pdf-attachment.md, ATT-S*)", () => {
  const pdfChipScene = (name: unknown) =>
    JSON.stringify({
      elements: [
        { type: "embeddable", id: "chip1", link: "infinitenote:pdf", customData: { pdfName: name } },
      ],
      files: {},
    });

  it("ATT-S01: emits the chip's pdfName as searchable content", () => {
    expect(extractSearchableText(pdfChipScene("quarterly-report.pdf"))).toEqual([
      "quarterly-report.pdf",
    ]);
  });

  it("ATT-S02: blank names are not emitted", () => {
    expect(extractSearchableText(pdfChipScene("   "))).toEqual([]);
    expect(extractSearchableText(pdfChipScene(""))).toEqual([]);
  });

  it("ATT-S03: non-embeddable elements carrying pdfName stay out of search", () => {
    const otherScene = JSON.stringify({
      elements: [{ type: "image", id: "i1", customData: { pdfName: "x.pdf" } }],
      files: {},
    });
    expect(extractSearchableText(otherScene)).toEqual([]);
  });

  it("ATT-S04: a page whose only content is a chip is found by the file name", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("p1", "Meeting", pdfChipScene("quarterly-report.pdf")),
      page("p2", "Other", scene("unrelated body text")),
    ]);
    const hits = searchIndex(idx, "quarterly");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p1");
    expect(hits[0].snippet).toContain("quarterly-report.pdf");
  });
});
