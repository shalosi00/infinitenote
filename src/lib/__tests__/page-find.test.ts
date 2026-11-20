/**
 * Unit pins for the in-page-find pure policy (wave 14, OneNote
 * "Find on this page" parity, issue #301). Every function below comes
 * from src/lib/page-find.ts — the find bar and the canvas navigation
 * only consume its results.
 */
import { describe, expect, test } from "bun:test";
import {
  collectFindableTexts,
  countOccurrences,
  findPageMatches,
  stepMatchIndex,
  type FindableElementLike,
} from "../page-find";

/** Build a text element the way the live scene carries it. */
function text(id: string, body: string, x = 0, y = 0): FindableElementLike {
  return { id, type: "text", text: body, x, y, isDeleted: false };
}

describe("collectFindableTexts", () => {
  test("collects visible text elements in scene order", () => {
    const texts = collectFindableTexts([
      text("a", "alpha"),
      text("b", "beta", 10, 5),
    ]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toEqual({ elementId: "a", text: "alpha", x: 0, y: 0 });
    expect(texts[1]).toEqual({ elementId: "b", text: "beta", x: 10, y: 5 });
  });

  test("includes bound labels — they are text elements too", () => {
    // a table cell label / arrow label carries containerId; the matcher
    // must see it because it IS visible page text
    const texts = collectFindableTexts([
      { id: "cell", type: "text", text: "revenue Q1", containerId: "container-1" },
    ]);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("revenue Q1");
  });

  test("skips deleted tombstones, non-text elements and empty text", () => {
    const texts = collectFindableTexts([
      text("gone", "deleted ink", 0, 0) && { ...text("gone", "deleted ink"), isDeleted: true },
      { id: "rect", type: "rectangle", x: 0, y: 0 },
      text("blank", "   "),
      text("empty", ""),
      { id: "no-text", type: "text", x: 1, y: 1 },
      text("keep", "kept"),
    ]);
    expect(texts).toHaveLength(1);
    expect(texts[0].elementId).toBe("keep");
  });

  test("skips elements without a usable id", () => {
    const texts = collectFindableTexts([
      { type: "text", text: "no id" },
      { id: "", type: "text", text: "blank id" },
      { id: "ok", type: "text", text: "kept" },
    ]);
    expect(texts).toHaveLength(1);
    expect(texts[0].elementId).toBe("ok");
  });

  test("coerces missing and non-finite coordinates to 0 (never NaN)", () => {
    const texts = collectFindableTexts([
      { id: "a", type: "text", text: "no coords" },
      { id: "b", type: "text", text: "junk coords", x: Number.NaN, y: Number.POSITIVE_INFINITY },
    ]);
    for (const t of texts) {
      expect(Number.isFinite(t.x)).toBe(true);
      expect(Number.isFinite(t.y)).toBe(true);
    }
    expect(texts[0].x).toBe(0);
    expect(texts[1].x).toBe(0);
    expect(texts[1].y).toBe(0);
  });

  test("survives null / undefined / garbage input (defensive contract)", () => {
    expect(collectFindableTexts(null)).toEqual([]);
    expect(collectFindableTexts(undefined)).toEqual([]);
    expect(collectFindableTexts([null, 42, "junk"] as unknown as FindableElementLike[])).toEqual([]);
  });
});

describe("countOccurrences", () => {
  test("counts case-insensitive non-overlapping occurrences", () => {
    expect(countOccurrences("todo buy milk, TODO walk dog", "todo")).toBe(2);
    expect(countOccurrences("Todo", "todo")).toBe(1);
    expect(countOccurrences("nothing here", "todo")).toBe(0);
  });

  test("steps by the needle length — no overlapping matches", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("aaaaa", "aaa")).toBe(1);
  });

  test("an empty needle matches nothing", () => {
    expect(countOccurrences("anything", "")).toBe(0);
  });

  test("CJK substrings count like any other text", () => {
    expect(countOccurrences("读书笔记与查找笔记", "笔记")).toBe(2);
  });
});

describe("findPageMatches", () => {
  test("returns matches in reading order: top → bottom, left → right", () => {
    const matches = findPageMatches(
      [
        text("low", "todo beta", 50, 200),
        text("top-right", "todo delta", 100, 10),
        text("top-left", "todo alpha", 10, 10),
      ],
      "todo",
    );
    expect(matches.map((m) => m.elementId)).toEqual(["top-left", "top-right", "low"]);
    expect(matches.map((m) => m.occurrence)).toEqual([1, 1, 1]);
  });

  test("keeps scene order for elements at identical positions (stable sort)", () => {
    const matches = findPageMatches(
      [text("first", "todo a", 30, 40), text("second", "todo b", 30, 40)],
      "todo",
    );
    expect(matches.map((m) => m.elementId)).toEqual(["first", "second"]);
  });

  test("occurrences inside one element follow text order with real offsets", () => {
    const matches = findPageMatches([text("one", "todo buy milk, todo walk dog")], "todo");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ elementId: "one", occurrence: 1, offset: 0 });
    // "todo buy milk, " is 15 code units — the second match starts at the t
    expect(matches[1]).toEqual({ elementId: "one", occurrence: 2, offset: 15 });
  });

  test("matching is case-insensitive against the element text", () => {
    const matches = findPageMatches([text("a", "TODO list"), text("b", "tOdO too")], "Todo");
    expect(matches).toHaveLength(2);
  });

  test("CJK and astral queries match as plain substrings", () => {
    expect(findPageMatches([text("a", "读书笔记与查找")], "笔记")).toHaveLength(1);
    expect(findPageMatches([text("a", "notes 📒 here")], "📒")).toHaveLength(1);
  });

  test("an empty query returns no matches", () => {
    expect(findPageMatches([text("a", "anything")], "")).toEqual([]);
  });

  test("a non-empty query matches exactly what the text holds (a space finds spaces)", () => {
    expect(findPageMatches([text("a", "two words")], " ")).toHaveLength(1);
    expect(findPageMatches([text("a", "noword")], " ")).toHaveLength(0);
  });

  test("reading order never breaks an element's occurrence order", () => {
    // element A (y=0) holds the 2nd-3rd matches, element B (y=50) the 1st
    const matches = findPageMatches(
      [text("b", "todo only", 0, 50), text("a", "todo x todo y", 0, 0)],
      "todo",
    );
    expect(matches.map((m) => m.elementId)).toEqual(["a", "a", "b"]);
    expect(matches.map((m) => m.occurrence)).toEqual([1, 2, 1]);
    expect(matches.map((m) => m.offset)).toEqual([0, 7, 0]);
  });

  test("defensive: null elements and garbage rows yield nothing", () => {
    expect(findPageMatches(null, "todo")).toEqual([]);
    expect(findPageMatches(undefined, "todo")).toEqual([]);
    expect(findPageMatches([null] as unknown as FindableElementLike[], "todo")).toEqual([]);
  });
});

describe("stepMatchIndex", () => {
  test("steps forward and wraps at both ends", () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
  });

  test("negative results wrap forward, large deltas wrap modulo", () => {
    expect(stepMatchIndex(-1, 3, 0)).toBe(2);
    expect(stepMatchIndex(0, 3, -5)).toBe(1);
    expect(stepMatchIndex(0, 3, 7)).toBe(1);
  });

  test("no results → -1, whatever the inputs", () => {
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
    expect(stepMatchIndex(0, -3, 1)).toBe(-1);
  });
});
