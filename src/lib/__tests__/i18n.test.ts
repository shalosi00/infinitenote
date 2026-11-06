/// <reference types="bun-types" />
/**
 * Unit tests for the i18n core (issue #54): locale normalization/detection,
 * the switcher cycle, and — most importantly — message catalog parity
 * between English and Simplified Chinese (same keys, non-empty values,
 * identical placeholder sets).
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALES,
  detectLocale,
  flattenMessageKeys,
  isLocale,
  localeLabel,
  messagePlaceholders,
  nextLocale,
  normalizeLocale,
} from "../i18n";
import en from "../../../messages/en.json";
import zhCN from "../../../messages/zh-CN.json";

describe("locale list", () => {
  it("ships exactly English and Simplified Chinese", () => {
    expect([...LOCALES]).toEqual(["en", "zh-CN"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("isLocale narrows arbitrary values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("normalizeLocale", () => {
  it("maps any Chinese variant to zh-CN", () => {
    for (const tag of ["zh", "ZH", "zh-CN", "zh-TW", "zh-Hans-CN", "zh_SG", "zh-cn"]) {
      expect(normalizeLocale(tag)).toBe("zh-CN");
    }
  });

  it("maps English variants to en", () => {
    for (const tag of ["en", "EN", "en-US", "en-GB", "en-us"]) {
      expect(normalizeLocale(tag)).toBe("en");
    }
  });

  it("falls back to English for everything else, including garbage", () => {
    for (const tag of ["fr", "de-DE", "ja", "", "  ", "###"]) {
      expect(normalizeLocale(tag)).toBe("en");
    }
  });
});

describe("detectLocale", () => {
  it("prefers the first language that resolves to a shipped locale", () => {
    expect(detectLocale(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectLocale(["en-US", "zh-CN"])).toBe("en");
    expect(detectLocale(["fr-FR", "zh-TW", "en"])).toBe("zh-CN");
  });

  it("returns English for empty, absent or unusable lists", () => {
    expect(detectLocale([])).toBe("en");
    expect(detectLocale([undefined, ""])).toBe("en");
    expect(detectLocale(["fr-FR"])).toBe("en");
  });
});

describe("switcher", () => {
  it("cycles between the two locales", () => {
    expect(nextLocale("en")).toBe("zh-CN");
    expect(nextLocale("zh-CN")).toBe("en");
  });

  it("labels locales with their native names", () => {
    expect(localeLabel("en")).toBe("English");
    expect(localeLabel("zh-CN")).toBe("简体中文");
  });
});

describe("catalog parity (en ↔ zh-CN)", () => {
  const enKeys = flattenMessageKeys(en as Record<string, unknown>).sort();
  const zhKeys = flattenMessageKeys(zhCN as Record<string, unknown>).sort();

  it("both catalogs are non-trivial", () => {
    expect(enKeys.length).toBeGreaterThan(100);
    expect(zhKeys.length).toBeGreaterThan(100);
  });

  it("have identical key sets", () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it("every message is a non-empty string in both locales", () => {
    const get = (obj: Record<string, unknown>, path: string): unknown =>
      path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
    for (const key of enKeys) {
      const a = get(en as Record<string, unknown>, key);
      const b = get(zhCN as Record<string, unknown>, key);
      expect(typeof a === "string" && a.trim().length > 0, `en.${key}`).toBe(true);
      expect(typeof b === "string" && b.trim().length > 0, `zh-CN.${key}`).toBe(true);
    }
  });

  it("reference the same placeholder names per message", () => {
    const get = (obj: Record<string, unknown>, path: string): unknown =>
      path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
    for (const key of enKeys) {
      const a = get(en as Record<string, unknown>, key) as string;
      const b = get(zhCN as Record<string, unknown>, key) as string;
      expect(messagePlaceholders(b), `placeholders of zh-CN.${key}`).toEqual(
        messagePlaceholders(a)
      );
    }
  });
});

describe("flattenMessageKeys / messagePlaceholders helpers", () => {
  it("flattens nested objects into dotted paths", () => {
    expect(
      flattenMessageKeys({ a: { b: { c: "x" } }, d: "y" }).sort()
    ).toEqual(["a.b.c", "d"]);
  });

  it("extracts placeholder names, including ICU argument headers", () => {
    expect(messagePlaceholders("Saved {count} of {total}")).toEqual(["count", "total"]);
    expect(messagePlaceholders("{count, plural, =1 {1 page} other {# pages}}")).toEqual(["count"]);
    expect(messagePlaceholders("no placeholders here")).toEqual([]);
  });
});
