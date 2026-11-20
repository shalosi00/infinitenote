/**
 * Checklist policy pins (issue #302, ids CL-P*).
 * Covers the strict `[ ]`/`[x]` text convention: parse, flip, format,
 * To Do tag application, element classification (standalone-only v1),
 * and the rotation-exact context-menu hit test.
 */
import { describe, expect, test } from "bun:test";
import {
  applyToDoTag,
  classifyTodoText,
  flipChecklistText,
  formatChecklistItem,
  hitTestTodoText,
  isChecklistText,
  parseChecklistItem,
  type TodoElementLike,
} from "../checklist";

describe("checklist: parse (CL-P)", () => {
  test("CL-P01: bare unchecked token parses as an empty item", () => {
    expect(parseChecklistItem("[ ]")).toEqual({ checked: false, item: "" });
  });

  test("CL-P02: bare checked token parses as an empty item", () => {
    expect(parseChecklistItem("[x]")).toEqual({ checked: true, item: "" });
  });

  test("CL-P03: token + separator + item parses with the item text", () => {
    expect(parseChecklistItem("[ ] Buy milk")).toEqual({ checked: false, item: "Buy milk" });
    expect(parseChecklistItem("[x] Buy milk")).toEqual({ checked: true, item: "Buy milk" });
  });

  test("CL-P04: uppercase [X] parses as checked", () => {
    expect(parseChecklistItem("[X] Buy milk")).toEqual({ checked: true, item: "Buy milk" });
  });

  test("CL-P05: token + trailing space parses as an empty item", () => {
    expect(parseChecklistItem("[ ] ")).toEqual({ checked: false, item: "" });
    expect(parseChecklistItem("[x] ")).toEqual({ checked: true, item: "" });
  });

  test("CL-P06: missing separator refuses (GFM strictness)", () => {
    expect(parseChecklistItem("[ ]Buy milk")).toBeNull();
    expect(parseChecklistItem("[x]Buy milk")).toBeNull();
  });

  test("CL-P07: unknown tokens refuse", () => {
    expect(parseChecklistItem("[?] Buy milk")).toBeNull();
    expect(parseChecklistItem("[-] Buy milk")).toBeNull();
    expect(parseChecklistItem("[] Buy milk")).toBeNull();
    expect(parseChecklistItem("[ ]")).toBeTruthy(); // sanity: the real token still parses
    expect(parseChecklistItem("[a] Buy milk")).toBeNull();
  });

  test("CL-P08: multi-line text refuses (one element = one item)", () => {
    expect(parseChecklistItem("[ ] Buy milk\n[ ] Eggs")).toBeNull();
    expect(parseChecklistItem("Buy milk\nBuy eggs")).toBeNull();
  });

  test("CL-P09: plain text and empty text refuse", () => {
    expect(parseChecklistItem("Buy milk")).toBeNull();
    expect(parseChecklistItem("")).toBeNull();
    expect(parseChecklistItem("   ")).toBeNull();
  });

  test("CL-P10: item text preserves inner spacing through the parse", () => {
    expect(parseChecklistItem("[ ]  spaced  item")).toEqual({
      checked: false,
      item: " spaced  item",
    });
  });

  test("CL-P11: isChecklistText mirrors the parse", () => {
    expect(isChecklistText("[ ] Buy milk")).toBe(true);
    expect(isChecklistText("[x]")).toBe(true);
    expect(isChecklistText("Buy milk")).toBe(false);
    expect(isChecklistText("[ ]Buy")).toBe(false);
  });
});

describe("checklist: flip + format (CL-P)", () => {
  test("CL-P12: flip toggles the token and preserves the item", () => {
    expect(flipChecklistText("[ ] Buy milk")).toBe("[x] Buy milk");
    expect(flipChecklistText("[x] Buy milk")).toBe("[ ] Buy milk");
  });

  test("CL-P13: flip round-trips a bare item", () => {
    expect(flipChecklistText("[ ]")).toBe("[x]");
    expect(flipChecklistText("[x]")).toBe("[ ]");
    expect(flipChecklistText("[ ] ")).toBe("[x]");
  });

  test("CL-P14: flip normalizes [X] to the canonical lowercase token", () => {
    expect(flipChecklistText("[X] Buy milk")).toBe("[ ] Buy milk");
    expect(flipChecklistText("[X]")).toBe("[ ]");
  });

  test("CL-P15: flip preserves inner spacing exactly", () => {
    expect(flipChecklistText("[ ]  spaced  item")).toBe("[x]  spaced  item");
  });

  test("CL-P16: flip refuses non-checklist text", () => {
    expect(flipChecklistText("Buy milk")).toBeNull();
    expect(flipChecklistText("[ ]Buy")).toBeNull();
    expect(flipChecklistText("")).toBeNull();
    expect(flipChecklistText("[ ] a\n[ ] b")).toBeNull();
  });

  test("CL-P17: format is the canonical writer (parse-inverts)", () => {
    expect(formatChecklistItem(false, "Buy milk")).toBe("[ ] Buy milk");
    expect(formatChecklistItem(true, "Buy milk")).toBe("[x] Buy milk");
    expect(formatChecklistItem(false, "")).toBe("[ ]");
    expect(parseChecklistItem(formatChecklistItem(true, "task"))).toEqual({
      checked: true,
      item: "task",
    });
  });
});

describe("checklist: To Do tag (CL-P)", () => {
  test("CL-P18: the tag prepends the unchecked token to plain text", () => {
    expect(applyToDoTag("Buy milk")).toBe("[ ] Buy milk");
  });

  test("CL-P19: the tag refuses empty, whitespace-only and multi-line text", () => {
    expect(applyToDoTag("")).toBeNull();
    expect(applyToDoTag("   ")).toBeNull();
    expect(applyToDoTag("Buy milk\nBuy eggs")).toBeNull();
  });

  test("CL-P20: the tag refuses already-tagged items (idempotent surface)", () => {
    expect(applyToDoTag("[ ] Buy milk")).toBeNull();
    expect(applyToDoTag("[x] Buy milk")).toBeNull();
  });

  test("CL-P21: the tagged result parses back and flips cleanly", () => {
    const tagged = applyToDoTag("Buy milk");
    expect(tagged).toBeTruthy();
    expect(flipChecklistText(tagged!)).toBe("[x] Buy milk");
  });
});

describe("checklist: element classification (CL-P)", () => {
  const base: TodoElementLike = { id: "t1", type: "text", isDeleted: false, containerId: null };

  test("CL-P22: a standalone checklist item classifies as checklist", () => {
    expect(classifyTodoText({ ...base, text: "[ ] Buy milk" })).toEqual({
      kind: "checklist",
      elementId: "t1",
      checked: false,
      item: "Buy milk",
    });
    expect(classifyTodoText({ ...base, text: "[x] Buy milk" })).toEqual({
      kind: "checklist",
      elementId: "t1",
      checked: true,
      item: "Buy milk",
    });
  });

  test("CL-P23: plain non-empty text classifies as taggable", () => {
    expect(classifyTodoText({ ...base, text: "Buy milk" })).toEqual({
      kind: "plain",
      elementId: "t1",
      text: "Buy milk",
    });
  });

  test("CL-P24a: multi-line plain text is never actionable (menu parity)", () => {
    expect(classifyTodoText({ ...base, text: "Buy eggs\nBuy bread" })).toBeNull();
    expect(classifyTodoText({ ...base, text: "Buy eggs\nBuy bread" })).toBeNull();
    expect(classifyTodoText({ ...base, text: "[ ] Buy milk\n[ ] Eggs" })).toBeNull();
    expect(hitTestTodoText([{ ...base, text: "Buy eggs\nBuy bread", width: 100, height: 40 }], 50, 20)).toBeNull();
  });

  test("CL-P24: empty and whitespace-only texts classify as null", () => {
    expect(classifyTodoText({ ...base, text: "" })).toBeNull();
    expect(classifyTodoText({ ...base, text: "   " })).toBeNull();
    expect(classifyTodoText({ ...base, text: undefined })).toBeNull();
  });

  test("CL-P25: deleted, non-text and bound-label elements refuse", () => {
    expect(classifyTodoText({ ...base, isDeleted: true, text: "Buy milk" })).toBeNull();
    expect(classifyTodoText({ ...base, type: "rectangle", text: "Buy milk" })).toBeNull();
    expect(classifyTodoText({ ...base, containerId: "cell-1", text: "Buy milk" })).toBeNull();
    expect(classifyTodoText({ ...base, type: "freedraw" })).toBeNull();
  });

  test("CL-P26: elements without an id refuse (nothing to act on)", () => {
    expect(classifyTodoText({ type: "text", isDeleted: false, containerId: null, text: "Buy milk" })).toBeNull();
    expect(classifyTodoText(null)).toBeNull();
    expect(classifyTodoText(undefined)).toBeNull();
  });
});

describe("checklist: hit test (CL-P)", () => {
  function textEl(overrides: Partial<TodoElementLike> & { id: string }): TodoElementLike {
    return { type: "text", isDeleted: false, containerId: null, x: 0, y: 0, width: 100, height: 20, ...overrides };
  }

  test("CL-P27: the topmost actionable text under the point wins", () => {
    const elements = [
      textEl({ id: "bottom", text: "[ ] Bottom item", x: 0, y: 0, width: 120, height: 20 }),
      textEl({ id: "top", text: "[x] Top item", x: 10, y: 5, width: 120, height: 20 }),
    ];
    const hit = hitTestTodoText(elements, 50, 15);
    expect(hit).toEqual({ kind: "checklist", elementId: "top", checked: true, item: "Top item" });
  });

  test("CL-P28: a point outside every text misses", () => {
    const elements = [textEl({ id: "t1", text: "Buy milk" })];
    expect(hitTestTodoText(elements, 500, 500)).toBeNull();
    // exactly ON the top-left corner is inside (inclusive bounds)
    expect(hitTestTodoText(elements, 0, 0)?.kind).toBe("plain");
  });

  test("CL-P29: shapes, deleted and bound texts never hit", () => {
    const elements = [
      textEl({ id: "rect", type: "rectangle", text: undefined }),
      textEl({ id: "gone", isDeleted: true, text: "[ ] Deleted item" }),
      textEl({ id: "bound", containerId: "cell-1", text: "[ ] Cell item" }),
    ];
    expect(hitTestTodoText(elements, 50, 10)).toBeNull();
  });

  test("CL-P30: a rotated text is hit where it renders", () => {
    // 90° rotation about the center: the element occupies x 40..60, y -40..60
    const el = textEl({ id: "rot", text: "[ ] Rotated item", x: 0, y: 0, width: 100, height: 20, angle: Math.PI / 2 });
    // center (50, 10): inside the rotated footprint, outside the axis-aligned one? — center always inside
    expect(hitTestTodoText([el], 50, 10)?.elementId).toBe("rot");
    // a point 40px RIGHT of center is inside the UNROTATED box but 90° rotation moves it outside
    expect(hitTestTodoText([el], 90, 10)).toBeNull();
    // the rotated footprint at that spot: rotate the offset back by -90°
    // (dx=40, dy=0 → local (0, -40)) — 40 > h/2=10 → outside. Verified null.
  });

  test("CL-P31: corrupt geometry never hits", () => {
    const el = textEl({ id: "zero", text: "Buy milk", width: 0, height: 0 });
    expect(hitTestTodoText([el], 0, 0)).toBeNull();
  });

  test("CL-P32: checklist and plain texts coexist in one hit list", () => {
    const elements = [
      textEl({ id: "plain", text: "Buy milk", x: 0, y: 0, width: 100, height: 20 }),
      textEl({ id: "item", text: "[ ] Second step", x: 0, y: 40, width: 120, height: 20 }),
    ];
    expect(hitTestTodoText(elements, 10, 10)).toEqual({ kind: "plain", elementId: "plain", text: "Buy milk" });
    expect(hitTestTodoText(elements, 10, 50)).toEqual({
      kind: "checklist",
      elementId: "item",
      checked: false,
      item: "Second step",
    });
  });
});
