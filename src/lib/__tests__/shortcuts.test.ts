/// <reference types="bun-types" />
/**
 * Unit tests for the shortcuts cheatsheet data module (issue #28) and its
 * i18n wiring (issue #54): groups/entries carry stable ids whose labels live
 * in the message catalogs.
 */
import { describe, expect, it } from "bun:test";
import { SHORTCUT_GROUPS, displayKeys, isApplePlatform } from "../shortcuts";
import en from "../../../messages/en.json";
import zhCN from "../../../messages/zh-CN.json";

const enShortcuts = en.shortcuts as Record<string, Record<string, string>>;
const zhShortcuts = zhCN.shortcuts as Record<string, Record<string, string>>;

describe("SHORTCUT_GROUPS data", () => {
  it("has a non-empty list of uniquely identified groups", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    const ids = SHORTCUT_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of SHORTCUT_GROUPS) expect(g.entries.length).toBeGreaterThan(0);
  });

  it("every entry has non-empty keys and an id that resolves in both catalogs", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(enShortcuts.groups[g.id], `group "${g.id}" (en)`).toBeTruthy();
      expect(zhShortcuts.groups[g.id], `group "${g.id}" (zh-CN)`).toBeTruthy();
      for (const e of g.entries) {
        expect(e.keys.trim().length).toBeGreaterThan(0);
        expect(enShortcuts.entries[e.id], `entry "${e.id}" (en)`).toBeTruthy();
        expect(zhShortcuts.entries[e.id], `entry "${e.id}" (zh-CN)`).toBeTruthy();
      }
    }
  });

  it("has no duplicate key combinations within a group", () => {
    for (const g of SHORTCUT_GROUPS) {
      const keys = g.entries.map((e) => e.keys);
      expect(new Set(keys).size, `group "${g.id}"`).toBe(keys.length);
    }
  });

  it("lists the app's real global shortcuts", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.entries);
    expect(
      all.some((e) => e.keys === "Ctrl/Cmd+K" && /search/i.test(enShortcuts.entries[e.id]))
    ).toBe(true);
    expect(
      all.some((e) => e.keys === "Ctrl/Cmd+Alt+N" && /quick note/i.test(enShortcuts.entries[e.id]))
    ).toBe(true);
    expect(
      all.some((e) => e.keys === "?" && /shortcut/i.test(enShortcuts.entries[e.id]))
    ).toBe(true);
  });

  it("canvas tool entries match the embedded Excalidraw bindings", () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.id === "canvasTools")?.entries ?? [];
    const byKey = new Map(tools.map((e) => [e.keys, e.id]));
    expect(enShortcuts.entries[byKey.get("V / 1")!]).toBe("Select");
    expect(enShortcuts.entries[byKey.get("P / 7")!]).toBe("Draw (pen / highlighter shapes)");
    expect(enShortcuts.entries[byKey.get("E")!]).toBe("Eraser");
    expect(enShortcuts.entries[byKey.get("K")!]).toBe("Laser pointer");
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
