"use client";

/**
 * i18n React wiring (issue #54).
 *
 * AppI18nProvider owns the locale as client state (there is no i18n
 * routing — the app is a local-first PWA / static export):
 * - initial value: localStorage → browser language → English
 * - changes persist to localStorage and update <html lang>
 * - NextIntlClientProvider feeds the active catalog to useTranslations()
 *
 * The provider renders its children with the default (English) locale on
 * the server and on the first client pass, then flips to the persisted /
 * detected locale after hydration — no SSR mismatch, no layout shift beyond
 * text content.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
import zhCN from "../../messages/zh-CN.json";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  detectLocale,
  isLocale,
  type Locale,
} from "@/lib/i18n";

const CATALOGS: Record<Locale, Record<string, unknown>> = {
  en: en as Record<string, unknown>,
  "zh-CN": zhCN as Record<string, unknown>,
};

export interface AppLocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const AppLocaleContext = createContext<AppLocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
});

/** Read/write the app locale from any client component (e.g. the switcher). */
export function useAppLocale(): AppLocaleContextValue {
  return useContext(AppLocaleContext);
}

export function AppI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — keep it session-only */
    }
    document.documentElement.lang = next;
  }, []);

  // hydrate once: persisted choice wins, otherwise detect from the browser.
  // Deliberately an effect: reading localStorage/navigator during render
  // would mismatch the server-rendered (English) HTML. The single extra
  // render it triggers is the accepted cost of the no-SSR-mismatch flip.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const initial = isLocale(stored)
      ? stored
      : detectLocale(typeof navigator !== "undefined" ? navigator.languages : []);
    document.documentElement.lang = initial;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration external-store sync (see above)
    setLocaleState(initial);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <AppLocaleContext.Provider value={value}>
      {/* timeZone pinned to UTC: no localized dates render through next-intl,
          and an explicit zone silences the ENVIRONMENT_FALLBACK console error
          the E2E error collector treats as a failure */}
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>
  );
}
