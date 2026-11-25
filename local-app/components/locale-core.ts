import playground from './playground-translations.json';
import card from './card-translations.json';
import admin from './admin-translations.json';
import ui from './i18n/ui.json';
import ux from './ux-translations.json';
import workspaceUx from './workspace-ux-translations.json';
import labels from './i18n/labels.json';
import seedNames from './i18n/names.json';
import workspace from './workspace-translations.json';
import schema from './workspace-schema-translations.json';
import { NodeRecord } from './types';

export type Locale = 'zh-TW' | 'en';
export type Pair = { 'zh-TW': string; en: string };
export const translations: Record<string, Pair> = { ...ui, ...workspace, ...schema, ...ux, ...workspaceUx, ...card, ...admin, ...playground };
export const normalizeLocale = (value: unknown): Locale => value === 'en' ? 'en' : 'zh-TW';
export function translate(source: string, locale: Locale, values: Record<string, string | number> = {}): string {
  const pair = translations[source];
  const text = pair ? pair[locale] : source;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => key in values ? String(values[key]) : whole);
}
export function localizedName(node: Partial<NodeRecord> | undefined, locale: Locale): string {
  if (!node) return '—';
  const map = node.localized_names;
  const explicit = map && typeof map === 'object' ? (map as Record<string, unknown>)[locale] : undefined;
  const alternate = node[locale === 'en' ? 'name_en' : 'name_zh_TW'];
  for (const value of [explicit, alternate]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const seed = (seedNames as Record<string, { original: string } & Pair>)[String(node.id)];
  if (seed && node.name === seed.original) return seed[locale];
  return typeof node.name === 'string' && node.name.trim() ? node.name : String(node.id || '—');
}
export function localizedLabel(category: keyof typeof labels, id: string, locale: Locale): string {
  const pair = (labels[category] as Record<string, Pair>)[id];
  return pair ? pair[locale] : id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}
export function searchableNames(node: NodeRecord): string[] {
  return [...new Set([node.name, localizedName(node, 'zh-TW'), localizedName(node, 'en')])];
}

/** Language hints describe only name text, never the surrounding UI phrase. */
export function inferredNameLanguage(node: Partial<NodeRecord> | undefined, locale: Locale): string | undefined {
  if (!node) return undefined;
  const text = localizedName(node, locale).trim();
  if (!text || !/[A-Za-z㐀-鿿]/.test(text)) return undefined;
  // Model codes and all-caps acronyms are language-neutral identifiers.
  if (/^[A-Z0-9\s._/\-]+$/.test(text)) return undefined;
  const map = node.localized_names;
  const explicit = map && typeof map === 'object' ? (map as Record<string, unknown>)[locale] : undefined;
  const alternate = node[locale === 'en' ? 'name_en' : 'name_zh_TW'];
  if ([explicit, alternate].some(value => typeof value === 'string' && value.trim() === text)) return locale;
  const hasHan = /[㐀-鿿]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  const seed = (seedNames as Record<string, { original: string } & Pair>)[String(node.id)];
  if (seed && node.name === seed.original) {
    if (hasHan) return 'zh-TW';
    if (text === seed.en && hasLatin) return 'en';
  }
  // Neither Latin nor Han script alone establishes a custom name's language.
  return undefined;
}
