/**
 * Generated names (issue #63) — every name the app GENERATES for the user:
 * default notebook/section/page titles, duplicate and conflict suffixes,
 * restore fallbacks, the Quick Notes home, quick-note and recording
 * prefixes, and the first-run welcome seed.
 *
 * The UI is English-only since v1.9, so these are plain constants — no
 * registry, no locale. Call sites stay pure through the generatedNames()
 * accessor, which keeps SSR and unit tests trivial.
 *
 * No React, no DOM — safe in the browser bundle, in bun tests and SSR.
 */

/** Every name the app generates for the user. */
export interface GeneratedNames {
  /** default notebook title, e.g. "Notebook 3" */
  notebook: (n: number) => string;
  /** default section title */
  section: (n: number) => string;
  /** default page title */
  page: (n: number) => string;
  /** duplicate-page suffix, e.g. "Notes (copy)" */
  copy: (title: string) => string;
  /** sync conflict-copy suffix with a local date */
  conflict: (title: string, date: string) => string;
  restoredNotebook: string;
  restoredSection: string;
  restoredPage: string;
  /** fallback title for a corrupt sync page file */
  untitled: string;
  quickNotesNotebook: string;
  quickNotesSection: string;
  /** prefix stamped before the dated quick-note title */
  quickNotePrefix: string;
  /** prefix stamped before the dated recording filename */
  recordingPrefix: string;
  welcome: {
    notebook: string;
    section: string;
    ideasSection: string;
    myNotebook: string;
    mySection: string;
    startHere: string;
    brainstorm: string;
    pageOne: string;
    title: string;
    body: string;
  };
}

const ENGLISH_NAMES: GeneratedNames = {
  notebook: (n) => `Notebook ${n}`,
  section: (n) => `Section ${n}`,
  page: (n) => `Page ${n}`,
  copy: (title) => `${title} (copy)`,
  conflict: (title, date) => `${title} (conflict ${date})`,
  restoredNotebook: "Restored notebook",
  restoredSection: "Restored section",
  restoredPage: "Restored page",
  untitled: "Untitled",
  quickNotesNotebook: "Quick Notes",
  quickNotesSection: "Quick Notes",
  quickNotePrefix: "Quick note ",
  recordingPrefix: "Recording ",
  welcome: {
    notebook: "Welcome Notebook",
    section: "Getting Started",
    ideasSection: "Ideas",
    myNotebook: "My Notebook",
    mySection: "New Section",
    startHere: "Start here",
    brainstorm: "Brainstorm",
    pageOne: "Page 1",
    title: "Welcome to InfiniteNote",
    body:
      "An open-source notebook with an infinite canvas.\n\n" +
      "Left: your Notebooks, Sections and Pages — like OneNote.\n" +
      "Here: draw anywhere with pen, highlighter, shapes and text.\n\n" +
      "Import (top right): images, text, Markdown and PDF printouts.\n" +
      "Everything is saved locally in your browser — offline first.",
  },
};

/** The generated names — a stable, stateless English set. */
export function generatedNames(): GeneratedNames {
  return ENGLISH_NAMES;
}
