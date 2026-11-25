import type { EntityType } from '../core/types';
import i18n, { valueLabel } from '../i18n';

// Neon "star class" palette: each node type is a constellation colour.
const KNOWN: Record<string, string> = {
  Company: '#6cb6f5', CorporateGroup: '#5fc9d8', OrganizationUnit: '#8cc7ea',
  Product: '#e58bb8', ProductFamily: '#e6a9c8', ProductCategory: '#b79be8', Service: '#d98fc9', Offering: '#e58bb8', BusinessLine: '#c79be0',
  Technology: '#a79af0', Application: '#5ccfb8', Industry: '#f0b45c', MarketSegment: '#f2cf7a',
  Collaboration: '#6fcf97', CompetitionAssessment: '#f08a8a', SupplyRelationship: '#f2a25e', CustomerOpportunity: '#e9cc5b',
  Evidence: '#8b9bb8', Claim: '#c3ccd9', ETF: '#9aa7ba', Topic: '#d6a4ee', Event: '#eadb6a', TopicMention: '#a9b4ee',
  ValueChainStage: '#f0bb8a', Capability: '#7fd6e2', Facility: '#93dba8', EndMarket: '#f2a9a9',
};
const FALLBACK = ['#5eb8ff', '#ff6ec7', '#2ee6c5', '#ffb547', '#a78bfa', '#4ade80', '#ff5c7a', '#38e1ff'];
export function colorOf(types: EntityType[], t: string) {
  return KNOWN[t] ?? FALLBACK[Math.max(0, types.findIndex(x => x.name === t)) % FALLBACK.length];
}
/** V4 verification states (how reliable). Lifecycle (what stage) is shown separately. */
export const statusLabel = (s: unknown) => valueLabel(s ?? 'reported');
export const statusTone = (s: unknown) => {
  const v = String(s ?? 'reported');
  return v === 'verified' ? 'good' : v === 'disputed' ? 'bad' : v === 'suggested' ? 'mute' : 'warn';
};

/** Link colour encodes confidence: teal = verified, amber = reported/inferred,
 *  red = disputed, grey = suggested; violet = computed (derived) projection. */
export const LINK_TONES = {
  good: { color: '94,234,212', label: '已驗證' },
  warn: { color: '251,191,36', label: '有報導／推論' },
  bad: { color: '251,113,133', label: '有爭議' },
  mute: { color: '148,163,184', label: '建議' },
  derived: { color: '192,132,252', label: '系統算出' },
  suggested: { color: '226,232,240', label: 'AI 建議（虛線，不是事實）' },
} as const;
export const linkTone = (status: unknown, derived: boolean, suggested = false) => (suggested ? 'suggested' : derived ? 'derived' : statusTone(status)) as keyof typeof LINK_TONES;

/** Chinese names for relation groups. */
export const GROUP_ZH: Record<string, string> = {
  corporate: '公司結構', products: '商品', grouping: '分類群組', technology: '技術', supply: '供應', opportunities: '商機', collaboration: '合作',
  competition: '競爭', evidence: '證據', holdings: '持股', suggested: 'AI 建議', value_chain: '產業鏈', events: '事件', trends: '趨勢', event_topic: '事件與主題', commercial: '業務線',
};
export const groupLabel = (g: string) => i18n.t(GROUP_ZH[g] ?? g);

/** Display name of a node type / relation in the current language (Chinese label, or the English one). */
export const typeName = (types: EntityType[], key: string) => { const t = types.find(x => x.name === key); return !t ? key : i18n.language === 'en' ? t.label_en || t.name : t.label; };
export const relName = (preds: { predicate: string; label: string }[], key: string) => { const p = preds.find(x => x.predicate === key); return !p ? key : i18n.language === 'en' ? key.toLowerCase().replace(/_/g, ' ') : p.label; };

/** One calm hue per sampled industry cluster: the cluster label dot and the industry pill in the assistant share it. */
export const CLUSTER_COLORS = ['#7cc4e8', '#e8b27c', '#9fd3a0', '#c3a6ee', '#ee9fb0', '#e6d27a'];
