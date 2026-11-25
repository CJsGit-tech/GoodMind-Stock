// i18n (i18next + react-i18next, MIT). The app is written for Traditional Chinese users, so the Chinese text
// itself is the key: t('篩選'). To change wording, add an override in locales/zh-TW.json; to add a language,
// add a file next to locales/en.json and list it in LOCALES. Attribute names and stored values use the
// attr.<key> / enum.<value> keys in each locale file.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';

export const LOCALES = [{ code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }] as const;
const KEY = 'goodmind.locale';
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();

i18n.use(initReactI18next).init({
  resources: { 'zh-TW': { translation: zhTW }, en: { translation: en } },
  lng: LOCALES.some(l => l.code === saved) ? saved! : 'zh-TW',
  fallbackLng: 'zh-TW',
  keySeparator: false, nsSeparator: false,           // keys are whole sentences
  interpolation: { escapeValue: false },             // React escapes
  returnNull: false,
});
export function setLocale(code: string) { i18n.changeLanguage(code); try { localStorage.setItem(KEY, code); } catch { /* private mode */ } document.documentElement.lang = code; }
document.documentElement.lang = i18n.language;

/** Friendly name of an attribute key (falls back to the key itself). */
export const attrLabel = (k: string) => i18n.t(`attr.${k}`, { defaultValue: k });
/** Friendly name of a stored value such as a stage or kind (falls back to the value). */
export const valueLabel = (v: unknown) => { const s = String(v ?? ''); return i18n.t(`enum.${s}`, { defaultValue: s.replace(/_/g, ' ') }); };
export default i18n;
