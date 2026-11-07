/**
 * Localized generated names (issue #63).
 *
 * Every name the app GENERATES for the user — default notebook/section/page
 * titles, duplicate and conflict suffixes, restore fallbacks, the Quick
 * Notes home, quick-note and recording prefixes, and the first-run welcome
 * seed — used to be hardcoded English regardless of the UI locale.
 *
 * This module keeps those call sites pure: they read the active names
 * through a tiny registry that the i18n provider refreshes whenever the
 * locale changes (before first paint on hydration). The default is English,
 * so pure unit tests and SSR see the same strings as before.
 *
 * No React, no DOM — safe in the browser bundle, in bun tests and SSR.
 */
import type { Locale } from "./i18n";

/** Interface every locale's generated names must satisfy. */
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

/** Template shape of the `generated` namespace in the message catalogs. */
interface GeneratedTemplates {
  notebook: string;
  section: string;
  page: string;
  copy: string;
  conflict: string;
  restoredNotebook: string;
  restoredSection: string;
  restoredPage: string;
  untitled: string;
  quickNotesNotebook: string;
  quickNotesSection: string;
  quickNotePrefix: string;
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

import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh-CN.json";

const CATALOGS: Record<Locale, GeneratedTemplates> = {
  en: (enMessages as { generated: GeneratedTemplates }).generated,
  "zh-CN": (zhMessages as { generated: GeneratedTemplates }).generated,
};

/** Replace `{name}` placeholders in a template. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function namesFor(locale: Locale): GeneratedNames {
  const t = CATALOGS[locale];
  return {
    notebook: (n) => fill(t.notebook, { n: String(n) }),
    section: (n) => fill(t.section, { n: String(n) }),
    page: (n) => fill(t.page, { n: String(n) }),
    copy: (title) => fill(t.copy, { title }),
    conflict: (title, date) => fill(t.conflict, { title, date }),
    restoredNotebook: t.restoredNotebook,
    restoredSection: t.restoredSection,
    restoredPage: t.restoredPage,
    untitled: t.untitled,
    quickNotesNotebook: t.quickNotesNotebook,
    quickNotesSection: t.quickNotesSection,
    quickNotePrefix: t.quickNotePrefix,
    recordingPrefix: t.recordingPrefix,
    welcome: { ...t.welcome },
  };
}

const ENGLISH_NAMES = namesFor("en");

let active = ENGLISH_NAMES;

/** Point every generated name at the given locale (called by the i18n provider). */
export function setGeneratedNamesLocale(locale: Locale): void {
  active = namesFor(locale);
}

/** The active generated names — English until the provider hydrates. */
export function generatedNames(): GeneratedNames {
  return active;
}
