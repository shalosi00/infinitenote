/**
 * Defensive-edge pins for the in-page-find pure policy (wave 14, issue
 * #301): everything a hand-edited sync page, an older restore or a live
 * Excalidraw scene can throw at the matcher that the core tests do not.
 */
import { describe, expect, test } from "bun:test";
import {
  collectFindableTexts,
  findPageMatches,
  stepMatchIndex,
  type FindableElementLike,
} from "../page-find";

describe("page-find edges (corrupt and hostile inputs)", () => {
  test("a scene full of junk shapes matches nothing but never throws", () => {
    const junk = [
      { type: "rectangle" },
      { type: "freedraw", customData: { hwrText: "todo" } }, // HWR metadata is NOT visible text
      { type: "image", customData: { ocrText: "todo" } }, // OCR metadata is NOT visible text
      { type: "embeddable", customData: { fileName: "todo.zip" } }, // file chips are NOT visible text
      { type: "arrow", text: undefined },
    ] as unknown as FindableElementLike[];
    expect(collectFindableTexts(junk)).toEqual([]);
    expect(findPageMatches(junk, "todo")).toEqual([]);
  });

  test("metadata-only text never leaks into the matches", () => {
    // the crossing-page contract: Ctrl+F sees the page like the user does —
    // only what is rendered as text
    const elements = [
      { id: "img", type: "image", customData: { ocrText: "scanned todo" }, x: 0, y: 0 },
      { id: "ink", type: "freedraw", customData: { hwrText: "handwritten todo" }, x: 0, y: 50 },
      { id: "chip", type: "embeddable", customData: { fileName: "todo.pdf" }, x: 0, y: 100 },
      { id: "real", type: "text", text: "typed todo", x: 0, y: 150 },
    ] as unknown as FindableElementLike[];
    const matches = findPageMatches(elements, "todo");
    expect(matches).toHaveLength(1);
    expect(matches[0].elementId).toBe("real");
  });

  test("a whitespace-only query is a real query — it matches whitespace", () => {
    // honest contract: only the EMPTY string is the no-query state
    expect(findPageMatches([{ id: "a", type: "text", text: "a b" }], " ")).toHaveLength(1);
    expect(findPageMatches([{ id: "a", type: "text", text: "ab" }], "   ")).toHaveLength(0);
  });

  test("case-folding is plain toLowerCase — no Unicode folding beyond it", () => {
    // "Straße".toLowerCase() = "straße": ß matches ß, not ss — the honest
    // JavaScript semantics, pinned so a future "smarter" fold is a choice
    expect(findPageMatches([{ id: "a", type: "text", text: "Straße" }], "ß")).toHaveLength(1);
    expect(findPageMatches([{ id: "a", type: "text", text: "Straße" }], "SS")).toHaveLength(0);
  });

  test("duplicate ids in a corrupt scene surface as separate matches", () => {
    // the matcher is honest about its input; the live API never hands out
    // duplicate ids, and a corrupt one navigating to either copy is
    // indistinguishable from navigating to the other — no dedupe theater
    const matches = findPageMatches(
      [
        { id: "dup", type: "text", text: "todo one", x: 0, y: 0 },
        { id: "dup", type: "text", text: "todo two", x: 0, y: 10 },
      ],
      "todo",
    );
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.elementId === "dup")).toBe(true);
  });

  test("coordinate corruption reorders deterministically instead of throwing", () => {
    // junk coords coerce to 0 — the element joins the top-left reading group
    // in scene order (stable sort), never NaN-poisons the comparator
    const matches = findPageMatches(
      [
        { id: "good", type: "text", text: "todo good", x: 100, y: 100 },
        { id: "junk", type: "text", text: "todo junk", x: Number.NaN, y: undefined },
      ] as unknown as FindableElementLike[],
      "todo",
    );
    expect(matches.map((m) => m.elementId)).toEqual(["junk", "good"]);
  });

  test("stepMatchIndex ignores hostile numerics", () => {
    expect(stepMatchIndex(Number.NaN, 3, 1)).toBe(-1);
    expect(stepMatchIndex(0, Number.NaN, 1)).toBe(-1);
    expect(stepMatchIndex(Number.POSITIVE_INFINITY, 3, 1)).toBe(-1);
    expect(stepMatchIndex(1, 3, Number.NaN)).toBe(-1);
  });

  test("an element that is deleted AND carries text never matches", () => {
    const matches = findPageMatches(
      [{ id: "tomb", type: "text", text: "todo", isDeleted: true }],
      "todo",
    );
    expect(matches).toEqual([]);
  });

  test("boolean-ish junk in the text field never matches", () => {
    const matches = findPageMatches(
      [
        { id: "num", type: "text", text: 42 },
        { id: "obj", type: "text", text: { evil: true } },
        { id: "ok", type: "text", text: "real text" },
      ] as unknown as FindableElementLike[],
      "real",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].elementId).toBe("ok");
  });
});
