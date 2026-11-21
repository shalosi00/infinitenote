/**
 * Section colors — OneNote "Section Color" parity (wave 17, issue #319).
 *
 * OneNote color-codes section tabs and lets the user recolor any of them:
 * "To change the color of an entire section, right-click the tab at the top
 * of the page and choose Section Color" (support.microsoft.com, OneNote
 * help-and-learning). Joplin still has NO native sidebar colors — its long
 * standing feature request asks exactly for the inheritance semantics we
 * adopt here: "Ideally you could set a color for each notebook name and all
 * it's children would inherit that color" (discourse.joplinapp.org).
 *
 * Model: `Section.color?: NotebookColor | null` is additive and NOT indexed
 * (the `parentId` wave-16 precedent — no Dexie version bump, old rows and
 * old sync folders stay valid). `color ?? null` is the canonical read;
 * null/absent means "inherit the notebook's color". Pure policy lives here;
 * the sidebar, the data layer and the external-input normalizers all call
 * these functions instead of re-deciding.
 */

import {
  isNotebookColor,
  NOTEBOOK_COLOR_HEX,
  type Notebook,
  type NotebookColor,
  type Section,
} from "./types";

/** Any section-like row (Dexie row, sync manifest entry, archive entry). */
export type SectionColorSource = Pick<Section, "color">;

/**
 * Normalize one raw color from an EXTERNAL source (sync manifest, backup
 * archive, hand-edited JSON): a valid palette name passes through, anything
 * else — wrong type, off-palette, null, absent — reads as "inherit" (null).
 * Same contract as `safeTags` on the page side: corrupt input restores as
 * absent rather than crashing the sidebar later.
 */
export function safeSectionColor(raw: unknown): NotebookColor | null {
  return isNotebookColor(raw) ? raw : null;
}

/**
 * The color a section renders with: the section's own override when set,
 * otherwise the notebook's color (Joplin's requested inheritance).
 */
export function effectiveSectionColor(
  section: SectionColorSource,
  notebook: Pick<Notebook, "color">,
): NotebookColor {
  return safeSectionColor(section.color) ?? notebook.color;
}

/** The hex value the sidebar renders for a section row. */
export function sectionColorHex(
  section: SectionColorSource,
  notebook: Pick<Notebook, "color">,
): string {
  return NOTEBOOK_COLOR_HEX[effectiveSectionColor(section, notebook)];
}
