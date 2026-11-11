/// <reference types="bun-types" />
/**
 * Edge tests for cross-page search — aspects beyond search.test.ts: OCR text
 * extraction, score composition (term frequency + title boost), stable
 * tie-breaks, code-point-safe snippet capping (issue #101), result limits,
 * unicode/CJK matching and degraded index inputs (orphan pages, missing
 * content).
 */
import { describe, expect, it } from "bun:test";
import { buildSearchIndex, extractSearchableText, searchIndex } from "../search";
import type { Notebook, PageMeta, Section } from "../types";

const nb: Notebook = {
  id: "nb1",
  name: "Research",
  color: "teal",
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const sec: Section = {
  id: "s1",
  notebookId: "nb1",
  name: "Notes",
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const page = (
  id: string,
  title: string,
  content: string | null,
  sectionId = "s1"
): PageMeta & { content: string | null } => ({
  id,
  sectionId,
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

/** A page whose only content is a scanned image with recognized text. */
const ocrScene = (ocrText: unknown) =>
  JSON.stringify({
    elements: [{ type: "image", id: "i1", customData: { ocrText } }],
    files: {},
  });

describe("search — OCR text (docs/test-plans/ocr.md)", () => {
  it("extracts ocrText from image elements only", () => {
    expect(extractSearchableText(ocrScene("scanned receipt total 42"))).toEqual([
      "scanned receipt total 42",
    ]);
    expect(extractSearchableText(ocrScene("   "))).toEqual([]); // blank OCR never indexes
    const notAnImage = JSON.stringify({
      elements: [{ type: "rectangle", id: "r1", customData: { ocrText: "x" } }],
      files: {},
    });
    expect(extractSearchableText(notAnImage)).toEqual([]);
  });

  it("finds pages by OCR'd text through the index", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("p1", "Scans", ocrScene("whiteboard brainstorm from photo")),
      page("p2", "Other", scene("no match here")),
    ]);
    const hits = searchIndex(idx, "whiteboard");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p1");
    expect(hits[0].snippet).toContain("whiteboard brainstorm");
  });
});

describe("search — ranking and limits", () => {
  it("ranks by term frequency across content elements", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("sparse", "Journal", scene("quantum once")),
      page("dense", "Journal", scene("quantum here", "quantum again", "nothing else")),
    ]);
    const hits = searchIndex(idx, "quantum");
    expect(hits).toHaveLength(2);
    expect(hits[0].pageId).toBe("dense"); // two matching elements beat one
  });

  it("breaks score ties in catalog order (stable ranking)", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("t1", "Alpha", scene("needle in one")),
      page("t2", "Beta", scene("needle in two")),
      page("t3", "Gamma", scene("nothing relevant here")),
    ]);
    expect(searchIndex(idx, "needle").map((h) => h.pageId)).toEqual(["t1", "t2"]);
  });

  it("respects the result limit and caps large result sets at the default 30", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("top", "needle central", scene("unrelated body")),
      ...Array.from({ length: 4 }, (_, i) => page(`p${i}`, "Filler", scene(`needle ${i}`))),
    ]);
    const hits = searchIndex(idx, "needle", 2);
    expect(hits.map((h) => h.pageId)).toEqual(["top", "p0"]); // title boost wins, then catalog order

    const many = Array.from({ length: 32 }, (_, i) => page(`m${i}`, "Filler", scene(`needle ${i}`)));
    const bigIdx = buildSearchIndex([nb], [sec], many);
    expect(searchIndex(bigIdx, "needle")).toHaveLength(30); // default limit
  });
});

describe("search — snippets", () => {
  it("caps snippets at 140 code points without splitting astral characters (issue #101)", () => {
    const idx = buildSearchIndex([nb], [sec], [page("p1", "Emojis", scene("🚀".repeat(150)))]);
    const hits = searchIndex(idx, "🚀");
    expect(hits).toHaveLength(1);
    const snippet = hits[0].snippet;
    expect(Array.from(snippet)).toHaveLength(140);
    // every code point is an intact rocket — a UTF-16 slice would leave a lone half
    expect(Array.from(snippet).every((cp) => cp === "🚀")).toBe(true);
  });
});

describe("search — unicode and CJK matching", () => {
  it("matches CJK substrings and folds case for accented latin letters", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("c1", "周会", scene("会议记录：项目排期与预算")),
      page("c2", "杂记", scene("会议记录：只有排期")),
      page("u1", "Menus", scene("Café ordering in Paris")),
    ]);
    expect(searchIndex(idx, "会议").map((h) => h.pageId)).toEqual(["c1", "c2"]);
    expect(searchIndex(idx, "排期 预算").map((h) => h.pageId)).toEqual(["c1"]); // AND over unspaced text
    expect(searchIndex(idx, "预算 会议").map((h) => h.pageId)).toEqual(["c1"]); // term order is irrelevant
    expect(searchIndex(idx, "CAFÉ")).toHaveLength(1); // non-ASCII lowercasing
  });
});

describe("search — degraded index inputs", () => {
  it("still searches orphan pages and pages whose scene never loaded", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page("orphan", "Ghost notes", scene("orphan body"), "missing-section"),
      page("empty", "Blank canvas", null),
    ]);
    const orphan = searchIndex(idx, "orphan")[0];
    expect(orphan.pageId).toBe("orphan");
    expect(orphan.notebookId).toBe(""); // section gone → no notebook either
    expect(orphan.pagePath).toBe("… / …"); // placeholder path, never a crash
    expect(orphan.sectionId).toBe("missing-section");

    const empty = searchIndex(idx, "blank")[0];
    expect(empty.pageId).toBe("empty");
    expect(empty.snippet).toBe(""); // no contents to quote — hit still surfaces the title
  });
});
