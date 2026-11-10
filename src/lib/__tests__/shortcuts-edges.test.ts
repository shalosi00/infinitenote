/// <reference types="bun-types" />
/**
 * Edge-case unit tests for the shortcuts cheatsheet module (shortcuts.ts):
 * cross-group key uniqueness (the base suite only checks within a group),
 * full platform rendering of every Ctrl/Cmd entry, token passthrough, the
 * digit-alias tool ladder, the undo/redo Shift pair, the Alt-modifier data
 * invariant, and case-insensitive Apple platform detection.
 */
import { describe, expect, it } from "bun:test";
import { SHORTCUT_GROUPS, displayKeys, isApplePlatform } from "../shortcuts";

const allKeys = (): string[] => SHORTCUT_GROUPS.flatMap((g) => g.entries.map((e) => e.keys));

describe("SHORTCUT_GROUPS integrity", () => {
  it("key combinations are unique across the whole cheatsheet, not just per group", () => {
    const keys = allKeys();
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("digit aliases 1–8 map to their documented tools as an ordered ladder", () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.label === "Canvas tools")?.entries ?? [];
    // every dual-key entry ("letter / digit") in visible order
    const dualKeys = tools.filter((e) => e.keys.includes("/")).map((e) => e.keys);
    expect(dualKeys).toEqual([
      "V / 1",
      "R / 2",
      "D / 3",
      "O / 4",
      "A / 5",
      "L / 6",
      "P / 7",
      "T / 8",
    ]);
    const byKey = new Map(tools.map((e) => [e.keys, e.label]));
    expect(byKey.get("R / 2")).toBe("Rectangle");
    expect(byKey.get("D / 3")).toBe("Diamond");
    expect(byKey.get("O / 4")).toBe("Ellipse");
    expect(byKey.get("A / 5")).toBe("Arrow");
    expect(byKey.get("L / 6")).toBe("Line");
    expect(byKey.get("T / 8")).toBe("Text");
  });

  it("undo and redo are both listed and differ only by the Shift modifier", () => {
    const editing = SHORTCUT_GROUPS.find((g) => g.label === "Canvas editing")?.entries ?? [];
    const undo = editing.find((e) => e.label === "Undo");
    const redo = editing.find((e) => e.label === "Redo");
    expect(undo?.keys).toBe("Ctrl/Cmd+Z");
    expect(redo?.keys).toBe("Ctrl/Cmd+Shift+Z");
  });

  it("Alt only ever appears as a secondary modifier alongside Ctrl/Cmd", () => {
    const keys = allKeys();
    // the invariant is non-vacuous: at least one entry uses Alt
    expect(keys.some((k) => k.includes("Alt"))).toBe(true);
    for (const k of keys) {
      if (k.includes("Alt")) {
        expect(k.startsWith("Ctrl/Cmd+Alt")).toBe(true);
      }
    }
  });
});

describe("displayKeys platform variants", () => {
  it("every Ctrl/Cmd entry renders as ⌘ on Apple and Ctrl elsewhere — no raw token survives", () => {
    const combos = allKeys().filter((k) => k.includes("Ctrl/Cmd"));
    expect(combos.length).toBeGreaterThanOrEqual(4);
    for (const k of combos) {
      const mac = displayKeys(k, true);
      const other = displayKeys(k, false);
      expect(mac).toContain("⌘");
      expect(mac).not.toContain("Ctrl");
      expect(mac).not.toContain("Cmd");
      expect(other).toContain("Ctrl");
      expect(other).not.toContain("⌘");
      expect(other).not.toContain("Cmd");
    }
  });

  it("keys without platform tokens pass through displayKeys unchanged", () => {
    for (const k of [
      "?",
      "Esc",
      "H",
      "E",
      "K",
      "Enter",
      "Double-click",
      "Del / Backspace",
      "Hold Space",
    ]) {
      expect(displayKeys(k, true)).toBe(k);
      expect(displayKeys(k, false)).toBe(k);
    }
  });

  it("renders the Shift-level combos (redo) per platform", () => {
    expect(displayKeys("Ctrl/Cmd+Shift+Z", true)).toBe("⌘+Shift+Z");
    expect(displayKeys("Ctrl/Cmd+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(displayKeys("Ctrl/Cmd+Alt+N", true)).toBe("⌘+⌥+N");
  });
});

describe("isApplePlatform edges", () => {
  it("matches case-insensitively and rejects empty or unrecognized agents", () => {
    expect(isApplePlatform("mozilla/5.0 (macintosh; intel mac os x 10_15_7)")).toBe(true);
    expect(isApplePlatform("iphone cpu iphone os 17_0 like mac os x")).toBe(true);
    expect(isApplePlatform("ipad; cpu os 17_0")).toBe(true);
    expect(isApplePlatform("")).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (X11; CrOS x86_64)")).toBe(false);
  });
});
