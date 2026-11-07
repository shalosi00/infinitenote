/// <reference types="bun-types" />
/**
 * Unit tests for the shortcuts cheatsheet data module (issue #28): the
 * English labels now live directly on the groups/entries (v1.9 — the
 * message-catalog indirection went away with the i18n layer).
 */
import { describe, expect, it } from "bun:test";
import { SHORTCUT_GROUPS, displayKeys, isApplePlatform } from "../shortcuts";

describe("SHORTCUT_GROUPS data", () => {
  it("has a non-empty list of groups, each with entries", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
      expect(g.entries.length).toBeGreaterThan(0);
    }
  });

  it("every entry has non-empty keys and a non-empty English label", () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const e of g.entries) {
        expect(e.keys.trim().length).toBeGreaterThan(0);
        expect(e.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate key combinations within a group", () => {
    for (const g of SHORTCUT_GROUPS) {
      const keys = g.entries.map((e) => e.keys);
      expect(new Set(keys).size, `group "${g.label}"`).toBe(keys.length);
    }
  });

  it("lists the app's real global shortcuts", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.entries);
    expect(all.some((e) => e.keys === "Ctrl/Cmd+K" && /search/i.test(e.label))).toBe(true);
    expect(all.some((e) => e.keys === "Ctrl/Cmd+Alt+N" && /quick note/i.test(e.label))).toBe(true);
    expect(all.some((e) => e.keys === "?" && /shortcut/i.test(e.label))).toBe(true);
  });

  it("canvas tool entries match the embedded Excalidraw bindings", () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.label === "Canvas tools")?.entries ?? [];
    const byKey = new Map(tools.map((e) => [e.keys, e.label]));
    expect(byKey.get("V / 1")).toBe("Select");
    expect(byKey.get("P / 7")).toBe("Draw (pen / highlighter shapes)");
    expect(byKey.get("E")).toBe("Eraser");
    expect(byKey.get("K")).toBe("Laser pointer");
  });
});

describe("displayKeys", () => {
  it("renders Ctrl/Cmd as ⌘ on Apple platforms", () => {
    expect(displayKeys("Ctrl/Cmd+K", true)).toBe("⌘+K");
  });

  it("renders Ctrl/Cmd as Ctrl elsewhere", () => {
    expect(displayKeys("Ctrl/Cmd+K", false)).toBe("Ctrl+K");
  });

  it("renders Alt as ⌥ on Apple platforms and leaves it elsewhere", () => {
    expect(displayKeys("Ctrl/Cmd+Alt+N", true)).toBe("⌘+⌥+N");
    expect(displayKeys("Ctrl/Cmd+Alt+N", false)).toBe("Ctrl+Alt+N");
  });
});

describe("isApplePlatform", () => {
  it("detects Mac / iPhone / iPad user agents", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe(true);
  });

  it("is false on Linux/Android/Windows user agents", () => {
    expect(isApplePlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
  });
});
