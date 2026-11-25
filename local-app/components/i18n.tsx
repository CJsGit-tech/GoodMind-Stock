import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Locale, inferredNameLanguage, localizedLabel, localizedName, normalizeLocale, translate } from './locale-core';
import { NodeRecord } from './types';

const KEY = 'goodmind.locale';
const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: 'zh-TW', setLocale: () => undefined,
});
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('zh-TW');
  useEffect(() => {
    try { updateLocale(normalizeLocale(localStorage.getItem(KEY))); } catch { /* usable without storage */ }
    const sync = (event: StorageEvent) => {
      if (event.key === KEY) updateLocale(normalizeLocale(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    try { localStorage.setItem(KEY, next); } catch { /* preference is session-only */ }
  }, []);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext);
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, locale, values), [locale]);
  const name = useCallback((node: Partial<NodeRecord> | undefined) => localizedName(node, locale), [locale]);
  return useMemo(() => ({
    locale, setLocale, t, name,
    nameLanguage: (node: Partial<NodeRecord> | undefined) => inferredNameLanguage(node, locale),
    typeLabel: (id: string) => localizedLabel('type', id, locale),
    groupLabel: (id: string) => localizedLabel('group', id, locale),
    statusLabel: (id: string) => localizedLabel('status', id, locale),
    propertyLabel: (id: string) => localizedLabel('property', id, locale),
  }), [locale, setLocale, t, name]);
}
