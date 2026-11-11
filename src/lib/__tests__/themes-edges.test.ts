/// <reference types="bun-types" />
/**
 * Edge tests for the themes gallery (issue #55) — aspects beyond the catalog
 * integrity checks in themes.test.ts: contrast pairing between primary and
 * primaryForeground, light→dark accent brightening, sidebar/main accent
 * mirroring, unicode whitespace tolerance and non-default theme switching.
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_THEME,
  THEMES,
  applyThemeToDocument,
  parseStoredTheme,
} from "../themes";

/** Parse an "oklch(L C H)" triple into its numeric parts. */
function oklch(value: string): { l: number; c: number; h: number } {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not an oklch triple: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

/** The accent themes — everything the default delegates to globals.css. */
const accents = THEMES.filter((t) => t.id !== DEFAULT_THEME);

describe("themes — accent pairings and invariants", () => {
  it("pairs every accent with readable foreground text in BOTH modes", () => {
    for (const theme of accents) {
      // light mode: near-white text sits on the accent button
      expect(oklch(theme.light.primaryForeground!).l, `${theme.id} light fg`).toBeGreaterThanOrEqual(0.9);
      // dark mode: near-black text — the accent itself brightens instead
      expect(oklch(theme.dark.primaryForeground!).l, `${theme.id} dark fg`).toBeLessThanOrEqual(0.3);
    }
  });

  it("brightens every accent for dark mode", () => {
    for (const theme of accents) {
      expect(
        oklch(theme.dark.primary!).l,
        `${theme.id}: dark primary must out-shine light primary`
      ).toBeGreaterThan(oklch(theme.light.primary!).l);
    }
  });

  it("mirrors the main accent onto the sidebar in both modes", () => {
    for (const theme of accents) {
      expect(theme.light.sidebarPrimary, `${theme.id} light sidebar`).toBe(theme.light.primary);
      expect(theme.light.sidebarRing, `${theme.id} light sidebar ring`).toBe(theme.light.ring);
      expect(theme.dark.sidebarPrimary, `${theme.id} dark sidebar`).toBe(theme.dark.primary);
      expect(theme.dark.sidebarRing, `${theme.id} dark sidebar ring`).toBe(theme.dark.ring);
    }
  });
});

describe("themes — storage edges", () => {
  it("trims unicode whitespace (NBSP, narrow and ideographic spaces) around ids", () => {
    expect(parseStoredTheme("\u00A0ocean\u3000")).toBe("ocean");
    expect(parseStoredTheme("\u202Fforest")).toBe("forest");
    expect(parseStoredTheme("\u00A0\u3000")).toBe(DEFAULT_THEME); // all-blank garbage
  });
});

describe("applyThemeToDocument — switching edges", () => {
  function fakeDoc() {
    const attrs = new Map<string, string>();
    const documentElement = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    };
    return { documentElement, attrs };
  }

  it("replaces a previously applied theme instead of stacking values", () => {
    const doc = fakeDoc();
    applyThemeToDocument(doc as unknown as Document, "ocean");
    applyThemeToDocument(doc as unknown as Document, "forest");
    expect(doc.attrs.get("data-theme")).toBe("forest"); // overwritten, not appended
    expect(doc.attrs.size).toBe(1);
  });
});
