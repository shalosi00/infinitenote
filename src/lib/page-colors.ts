/**
 * Page color policy (issue #385) — OneNote "View > Page Color" parity.
 *
 * Pure module: no Dexie, no React — mirrors section-colors.ts. The palette
 * reuses the app's eight hue families (violet/rose/orange/amber/emerald/
 * teal/cyan/pink) as pale tints so the names stay consistent with
 * NotebookColor; every tint is a Tailwind-100 value whose contrast against
 * dark ink stays far above the readable floor (pinned in page-color.test.ts).
 *
 * Theme contract (the v1.13 dark-mode finding, see excalidraw-canvas.tsx):
 * Excalidraw 0.18 dark mode applies `invert(93%) hue-rotate(180deg)` to the
 * canvas pixels, so the scene stays AUTHORED in light colors — white paper
 * is painted in both themes and the filter produces the dark look. Page
 * tints follow the same contract: `canvasColorFor` returns the palette hex
 * for BOTH themes and dark mode dims the tint through the standard filter,
 * exactly like the paper-white and the ink. Exports (PNG/SVG/PDF) render
 * light-authored colors as-is, so they all pass the same palette hex.
 */
import { PAGE_COLORS, type PageColor } from "./types";

/** Display/paint hex per tint — also the value Excalidraw's viewBackgroundColor carries. */
export const PAGE_COLOR_HEX: Record<PageColor, string> = {
  violet: "#ede9fe",
  rose: "#ffe4e6",
  orange: "#ffedd5",
  amber: "#fef3c7",
  emerald: "#d1fae5",
  teal: "#ccfbf1",
  cyan: "#cffafe",
  pink: "#fce7f3",
};

/**
 * The canonical read for a page-color field: a valid palette id, else
 * null (= none, white paper). Tolerates hand-edited rows/archives — the
 * safeSectionColor contract: a malformed value degrades to the default
 * instead of crashing the reader.
 */
export function safePageColor(v: unknown): PageColor | null {
  return typeof v === "string" && (PAGE_COLORS as string[]).includes(v)
    ? (v as PageColor)
    : null;
}

/**
 * The color the canvas paints for a page in BOTH themes (see the theme
 * contract above). null/unknown = white paper.
 */
export function canvasColorFor(color: PageColor | null | undefined): string {
  // an invalid runtime id (hand-edited row) misses the record → white paper
  return (color && PAGE_COLOR_HEX[color]) || "#ffffff";
}
