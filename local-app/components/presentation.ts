import { qualityIssues } from '../shared/model';
import { Graph, NodeRecord } from './types';
import labels from './i18n/labels.json';

const hidden = new Set(['id', 'name', 'type', 'predicate', 'from', 'to', 'evidence_ids', 'localized_names', 'name_en', 'name_zh_TW', 'assessment_id', 'product_ids', 'market_segment_id', 'derived', 'symmetric']);
const extraLabels: Record<string, { 'zh-TW': string; en: string }> = {
  valid_from: { 'zh-TW': '生效日期', en: 'Valid from' },
  valid_to: { 'zh-TW': '結束日期', en: 'Valid until' },
  source_published_at: { 'zh-TW': '來源發布日期', en: 'Source publication date' },
  last_verified_at: { 'zh-TW': '最後查核日期', en: 'Last verified' },
  website: { 'zh-TW': '網站', en: 'Website' },
  notes: { 'zh-TW': '備註', en: 'Notes' },
};
export function visibleMetadata(record: Record<string, unknown>) {
  return Object.entries(record).filter(([key, value]) =>
    !hidden.has(key) && (key in labels.property || key in extraLabels) &&
    value !== undefined && value !== null && value !== '' &&
    (typeof value !== 'object' || Array.isArray(value)));
}
export function metadataLabel(key: string, locale: 'zh-TW' | 'en', fallback: (key: string) => string) {
  return extraLabels[key]?.[locale] || fallback(key);
}
const terms: Record<string, [string, string]> = {
  DIRECT: ['直接競爭', 'Direct competition'],
  INDIRECT: ['間接競爭', 'Indirect competition'],
  company_announcement_or_product: ['公司公告或產品資料', 'Company announcement or product information'],
  robot_OEM_and_integrator: ['機器人製造商與系統整合商', 'Robot manufacturers and integrators'],
  joint_venture: ['合資', 'Joint venture'],
  technical_integration: ['技術整合', 'Technical integration'],
  mou: ['合作備忘錄', 'Memorandum of understanding'],
  announced: ['已公告', 'Announced'],
  system: ['系統', 'System'],
};
export function readableText(value: unknown, locale: 'zh-TW' | 'en', translate: (text: string) => string = value => value): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return locale === 'en' ? (value ? 'Yes' : 'No') : (value ? '是' : '否');
  if (Array.isArray(value)) return value.map(item => readableText(item, locale, translate)).filter(item => item !== '—').join(' · ') || '—';
  if (typeof value === 'object') return '—';
  const text = String(value);
  if (terms[text]) return terms[text][locale === 'en' ? 1 : 0];
  if (/^[a-z]+:[\w-]+$/i.test(text) || /^[\[{]/.test(text)) return '—';
  return translate(text.replace(/_/g, ' '));
}

/** Keep the primary name and its editable current-language translation aligned. */
export function syncPrimaryName<T extends Record<string, unknown>>(
  draft: T,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  locale: 'zh-TW' | 'en',
): T {
  const oldNames = previous.localized_names && typeof previous.localized_names === 'object'
    ? previous.localized_names as Record<string, unknown> : {};
  const newNames = next.localized_names && typeof next.localized_names === 'object'
    ? next.localized_names as Record<string, unknown> : {};
  return typeof newNames[locale] === 'string' && newNames[locale] !== oldNames[locale]
    ? { ...draft, name: newNames[locale] } : draft;
}


/** Attach quality guidance to the affected item without exposing diagnostics. */
export function workspaceQualityNotices(graph: Graph): { node: NodeRecord; category: 'incomplete' | 'unverified' }[] {
  return graph.nodes.flatMap(node => qualityIssues({ ...graph, nodes: [node] }).map(issue => ({
    node,
    category: issue.endsWith('no verification status; not a confirmed claim.')
      ? 'unverified' as const : 'incomplete' as const,
  })));
}
