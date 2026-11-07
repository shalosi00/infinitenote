/**
 * i18n core (issue #54) — pure, SSR-safe locale logic.
 *
 * The app is a client-side local-first PWA (and a static export for the
 * Tauri shell), so there is no i18n routing: the locale is client state,
 * persisted in localStorage and detected from the browser on first run.
 * React wiring lives in src/i18n/provider.tsx; message catalogs live in
 * messages/*.json.
 */

/** Locales the UI ships translations for. */
export const LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "infinitenote.locale";

/** Narrow an arbitrary stored value (e.g. from localStorage) to a Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Map a BCP-47-ish tag onto a shipped locale: any Chinese variant (zh, zh-CN,
 * zh-TW, zh-Hans-CN…) resolves to zh-CN; everything else falls back to English.
 */
export function normalizeLocale(tag: string): Locale {
  const t = tag.trim().toLowerCase();
  if (t.startsWith("zh")) return "zh-CN";
  if (t === "en" || t.startsWith("en-")) return "en";
  return DEFAULT_LOCALE;
}

/**
 * Pick the initial locale from the browser's language list (preference
 * order). The first language that maps to a shipped locale wins; languages
 * that resolve to neither (e.g. French) are skipped so a later English or
 * Chinese preference still counts. Empty/absent lists fall back to English.
 */
export function detectLocale(languages: readonly (string | undefined)[]): Locale {
  for (const lang of languages) {
    if (typeof lang !== "string" || lang.trim() === "") continue;
    const normalized = normalizeLocale(lang);
    // normalizeLocale falls back to English — only stop when the language
    // genuinely maps to a shipped locale (en* or zh*)
    const t = lang.trim().toLowerCase();
    if (t === "en" || t.startsWith("en-") || t.startsWith("zh")) return normalized;
  }
  return DEFAULT_LOCALE;
}

/** The other locale — the two-locale switcher cycles en ↔ zh-CN. */
export function nextLocale(locale: Locale): Locale {
  return locale === "en" ? "zh-CN" : "en";
}

/** Native, untranslated label shown in the switcher (English / 简体中文). */
export function localeLabel(locale: Locale): string {
  return locale === "en" ? "English" : "简体中文";
}

/** Flatten a nested message catalog into dotted key paths ("a.b.c"). */
export function flattenMessageKeys(
  messages: Record<string, unknown>,
  prefix = ""
): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenMessageKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/**
 * Placeholder names referenced by a message template, e.g. "Saved {count}"
 * → ["count"]. Recognizes both plain placeholders and ICU argument headers
 * ("{count, plural, …}" still yields "count"); "#" is the ICU magic token
 * and is ignored.
 */
export function messagePlaceholders(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)(?=[,}])/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}
