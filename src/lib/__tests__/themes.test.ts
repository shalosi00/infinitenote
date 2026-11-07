/**
 * Unit tests for the themes gallery core (issue #55).
 * The module is pure — catalog integrity, storage tolerance, the pre-hydration
 * script source and the i18n catalog parity are all asserted here; the DOM
 * behavior is covered by e2e/themes.spec.ts.
 */
import { describe, expect, test } from "bun:test";
import en from "../../../messages/en.json";
import zhCN from "../../../messages/zh-CN.json";
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  isThemeId,
  parseStoredTheme,
  THEMES,
  THEME_IDS,
  THEME_VAR_KEYS,
  themePreloadScript,
  THEME_STORAGE_KEY,
  themeVarNames,
  type ThemeDefinition,
} from "../themes";

/** Read a dotted key ("themes.themeOcean") out of a nested catalog. */
function dig(catalog: Record<string, unknown>, path: string): unknown {
  let node: unknown = catalog;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("themes catalog integrity", () => {
  test("ids are unique and match THEME_IDS in order", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  test("the default theme exists and comes first (gallery order)", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(5);
    expect(THEMES[0].id).toBe(DEFAULT_THEME);
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  test("the default theme defines no overrides — it is the shipped palette", () => {
    const def = THEMES.find((t) => t.id === DEFAULT_THEME) as ThemeDefinition;
    expect(Object.keys(def.light)).toEqual([]);
    expect(Object.keys(def.dark)).toEqual([]);
  });

  test("every non-default theme defines the full accent set in BOTH modes", () => {
    const required = [...THEME_VAR_KEYS].sort();
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      expect(Object.keys(theme.light).sort(), `light/${theme.id}`).toEqual(required);
      expect(Object.keys(theme.dark).sort(), `dark/${theme.id}`).toEqual(required);
    }
  });

  test("override values are oklch() colors; previews are hex colors", () => {
    const oklch = /^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\)$/;
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const theme of THEMES) {
      for (const value of [...Object.values(theme.light), ...Object.values(theme.dark)]) {
        expect(oklch.test(value as string), `${theme.id}: ${value}`).toBe(true);
      }
      expect(hex.test(theme.preview.light), `${theme.id} light swatch`).toBe(true);
      expect(hex.test(theme.preview.dark), `${theme.id} dark swatch`).toBe(true);
    }
  });

  test("light and dark overrides actually differ for every theme (visible in both modes)", () => {
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      expect(theme.dark.primary).not.toBe(theme.light.primary);
    }
  });

  test("themeVarNames maps camelCase vars to CSS custom properties", () => {
    expect(themeVarNames()).toEqual([
      "--primary",
      "--primary-foreground",
      "--ring",
      "--sidebar-primary",
      "--sidebar-ring",
    ]);
  });
});

describe("theme id narrowing", () => {
  test("isThemeId accepts exactly the catalog ids", () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
    expect(isThemeId("vaporwave")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId("DEFAULT")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });
});

describe("parseStoredTheme", () => {
  test("missing, empty or malformed values fall back to the default", () => {
    expect(parseStoredTheme(null)).toBe(DEFAULT_THEME);
    expect(parseStoredTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseStoredTheme("")).toBe(DEFAULT_THEME);
    expect(parseStoredTheme("   ")).toBe(DEFAULT_THEME);
    expect(parseStoredTheme("Vaporwave")).toBe(DEFAULT_THEME);
    expect(parseStoredTheme("ocean ")).toBe("ocean"); // trimmed before match
    expect(parseStoredTheme("\trose\n")).toBe("rose");
  });

  test("round-trips every catalog id", () => {
    for (const id of THEME_IDS) expect(parseStoredTheme(id)).toBe(id);
  });

  test("accepts an arbitrary storage string without throwing", () => {
    expect(parseStoredTheme("ocean'; drop table pages;--")).toBe(DEFAULT_THEME);
  });
});

describe("applyThemeToDocument", () => {
  function fakeDoc() {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    };
    return { documentElement: el, attrs };
  }

  test("sets data-theme for a non-default theme", () => {
    const doc = fakeDoc();
    applyThemeToDocument(doc as unknown as Document, "ocean");
    expect(doc.attrs.get("data-theme")).toBe("ocean");
  });

  test("clears data-theme for the default theme (and for garbage-safe re-apply)", () => {
    const doc = fakeDoc();
    applyThemeToDocument(doc as unknown as Document, "rose");
    applyThemeToDocument(doc as unknown as Document, DEFAULT_THEME);
    expect(doc.attrs.has("data-theme")).toBe(false);
  });
});

describe("themePreloadScript", () => {
  const script = themePreloadScript();

  test("is a single line (inline <script> in layout)", () => {
    expect(script.includes("\n")).toBe(false);
  });

  test("reads the storage key, skips the default, sets data-theme, and fails soft", () => {
    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(script).toContain(JSON.stringify(DEFAULT_THEME));
    expect(script).toContain('setAttribute("data-theme"');
    expect(script.startsWith("(function(){try{")).toBe(true);
    expect(script.endsWith("}})()")).toBe(true);
  });

  test("guards against tampered storage values via an id-shaped pattern", () => {
    expect(script).toContain("/^[a-z][a-z0-9-]*$/.test(t)");
  });
});

describe("i18n catalog parity for the themes gallery", () => {
  const labelKey = (id: string) => `themes.theme${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  const SHARED_KEYS = ["themes.open", "themes.openTitle", "themes.galleryTitle", "themes.description", "themes.active"];

  test("both catalogs provide every gallery chrome key", () => {
    for (const path of SHARED_KEYS) {
      expect(typeof dig(en, path), `en.${path}`).toBe("string");
      expect(typeof dig(zhCN, path), `zh-CN.${path}`).toBe("string");
    }
  });

  test("both catalogs provide a non-empty label for every theme", () => {
    for (const theme of THEMES) {
      const path = labelKey(theme.id);
      for (const [name, catalog] of [["en", en], ["zh-CN", zhCN]] as const) {
        const value = dig(catalog, path);
        expect(typeof value, `${name}.${path}`).toBe("string");
        expect((value as string).length, `${name}.${path}`).toBeGreaterThan(0);
      }
    }
  });

  test("labels differ between locales (no untranslated copy-paste)", () => {
    for (const theme of THEMES) {
      const path = labelKey(theme.id);
      expect(dig(en, path)).not.toBe(dig(zhCN, path));
    }
  });
});
