// Ontology v4.0 — built from the V4 registry (lib/registry.v4.json, from GoodMind-V4-Package).
// Layers: Things (Company, Offering = Product | Service, BusinessLine), Groups (Industry > MarketSegment >
// ProductCategory, Application, Technology, value chain), Facts (relationship records + Evidence/Claim),
// Trends (Topic, Event, TopicMention).
// Conventions: node `name` is Chinese; all other fields are free JSON `attributes`; type/relation keys
// (Company, SELLS) are stable codes and the Chinese label is what people see.
// V4 semantic corrections applied on top of the registry (docs/05-migration.md):
//   IS_SUBSIDIARY_OF is many-to-many (ownership/control are separate); CATEGORY_IN_SEGMENT is many-to-many;
//   a Technology does not require a provider; verification ≠ lifecycle.
import registry from './registry.v4.json';
import type { Datatype, EdgeType, EntityType, Graph, PropertyDef } from './types';
import { LIFECYCLE, VERIFICATION } from './types';

export const ONTOLOGY_VERSION = '4.0.0';
export const UNSPECIFIED = 'unspecified';

export type Rule =
  | { id: string; kind: 'cardinality'; description: string; class: string; predicate: string; min: number; max?: number }
  | { id: string; kind: 'distinct_targets'; description: string; class: string; predicates: string[] }
  | { id: string; kind: 'evidence_required'; description: string; classes: string[] }
  | { id: string; kind: 'derivation'; description: string; produces: string[]; from: string; when: Record<string, unknown>; implementation: string }
  | { id: string; kind: 'answer_mapping'; description: string; question: string; class: string; field: string; map: Record<string, string> }
  | { id: string; kind: 'coverage'; description: string; class: string; anyOf: { predicate: string; direction: 'out' | 'in' }[]; includeDerived?: boolean }
  | { id: string; kind: 'suggestion'; description: string; produces: string; strength: number; implementation: string };

export type CompetencyQuestion = {
  id: 'competition' | 'supply' | 'collaboration';
  question: { 'zh-TW': string; en: string };
  subQuestions: { 'zh-TW': string; en: string }[];
  answeredBy: { records: string[]; fields: string[]; tool: string };
};

// ---- Keys: registry ids → stable code keys ----
const TYPE_KEY_OVERRIDES: Record<string, string> = { etf: 'ETF' };
export const typeKey = (id: string) => { const s = id.replace(/^type:/, ''); return TYPE_KEY_OVERRIDES[s] ?? s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(''); };
export const relKey = (id: string) => id.replace(/^rel:/, '').toUpperCase();

// ---- Enumerations ----
export const SUPPLY_STAGES = ['prospect', 'qualified', 'sampling', 'design_win', 'mass_production', 'ended', UNSPECIFIED];
export const OPPORTUNITY_STAGES = ['identified', 'contacted', 'proposal', 'evaluation', 'won', 'lost', UNSPECIFIED];
export const COLLAB_STAGES = ['rumoured', 'announced', 'mou_signed', 'in_development', 'launched', 'ended', UNSPECIFIED];
export const COLLAB_TYPES = ['joint_venture', 'mou', 'technical_integration', 'joint_development', 'strategic_partnership', 'investment', 'other', UNSPECIFIED];
export const OVERLAP_SCOPES = ['market', 'product_category', 'application', UNSPECIFIED];
export const ROLES = ['lead', 'partner', 'supplier', 'integrator', 'investor', 'customer', UNSPECIFIED];
export const EVENT_TYPES = ['launch', 'partnership', 'investment', 'mass_production', 'acquisition', 'earnings', 'other'];
export const OFFERING_KINDS = ['system', 'module', 'component', 'material', 'software', 'vehicle', 'foundry', 'testing', 'packaging', 'assembly_and_test', 'design', 'integration', 'other'];

// ---- Property schemas ----
const DT: Record<string, Datatype> = { 文字: 'string', '文字（若不建階段節點）': 'string', 文字陣列: 'string[]', 網址: 'url', 數字: 'number', 日期: 'date', 布林: 'boolean', 物件: 'object', 選項: 'enum', string: 'string', 'string[]': 'string[]', number: 'number', date: 'date', enum: 'enum' };
const p = (name: string, datatype: Datatype, description: string, extra: Partial<PropertyDef> = {}): PropertyDef => ({ name, datatype, description, ...extra });
/** Fields every node may carry (V4 identity, time and provenance conventions). */
const COMMON: PropertyDef[] = [
  p('name_en', 'string', '英文名稱（name 一律中文，英文放這裡）'),
  p('aliases', 'string[]', '其他叫法，供去重比對'),
  p('name_zh_missing', 'boolean', '沒有通用中文名，name 暫時保留原文'),
  p('name_is_zh_usage', 'boolean', '原文寫法就是中文的通用寫法（例：3M）'),
  p('legacy_ids', 'string[]', '遷移前的舊 id（舊 id → 標準 id 對照）'),
  p('valid_from', 'date', '事實何時開始有效'), p('valid_to', 'date', '事實何時失效（空白＝仍有效）'),
  p('observed_at', 'date', '來源所見的時間'), p('recorded_at', 'date', '寫入系統的時間'),
  p('notes', 'text', '整理者備註'), p('curation', 'object', '整理方式與信心'), p('needs_review', 'string[]', '待人工確認的欄位'),
];
const VERIFY = p('verification_status', 'enum', '這個主張有多可靠', { values: VERIFICATION });
const VERIFY_REQ = { ...VERIFY, required: true };
const LIFE = p('lifecycle_status', 'enum', '合作／供應目前在哪個階段（不等於可靠度）', { values: LIFECYCLE });
const EVIDENCE = p('evidence_ids', 'ref[]', '支持這個事實的證據節點');
const RECORD = [VERIFY_REQ, LIFE, EVIDENCE, p('as_of', 'date', '描述的時間點'), p('last_verified_at', 'date', '最後一次重新確認來源的日期'), p('verification_legacy', 'string', '遷移前的可靠度標記')];

/** Typed extras the registry's suggested_keys cannot express (enums, record fields). */
const TYPE_EXTRAS: Record<string, PropertyDef[]> = {
  Company: [p('country', 'string', '註冊國家（ISO 代碼，例 TW）', { required: true }), p('ticker', 'string', '股票代號'), p('exchange', 'string', '交易所（TWSE、TPEx…）'), VERIFY, EVIDENCE, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  Product: [p('kind', 'enum', '產品形態', { values: OFFERING_KINDS, required: true }), VERIFY, EVIDENCE, p('split_from', 'string', '拆分前的節點'), p('verification_legacy', 'string', '遷移前的可靠度標記')],
  Service: [p('kind', 'enum', '服務形態', { values: OFFERING_KINDS, required: true }), VERIFY, EVIDENCE, p('split_from', 'string', '拆分前的節點'), p('verification_legacy', 'string', '遷移前的可靠度標記')],
  BusinessLine: [VERIFY, EVIDENCE, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  MarketSegment: [VERIFY, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  Industry: [VERIFY, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  CompetitionAssessment: [
    p('competition_type', 'enum', 'DIRECT＝同一需求可替代；INDIRECT＝不同做法達成同一結果', { values: ['DIRECT', 'INDIRECT'], required: true }),
    p('overlap_scope', 'enum', '重疊範圍：整個市場、單一產品類別或單一應用', { values: OVERLAP_SCOPES, required: true }),
    p('basis', 'string[]', '判斷理由', { required: true }), ...RECORD],
  SupplyRelationship: [p('stage', 'enum', '供應階段：決定「潛在」或「確定」', { values: SUPPLY_STAGES, required: true }), p('offering_kind', 'enum', '供應的是產品或服務', { values: ['product', 'service', UNSPECIFIED] }), ...RECORD],
  CustomerOpportunity: [p('stage', 'enum', '商機階段（永遠不是確定客戶）', { values: OPPORTUNITY_STAGES, required: true }), ...RECORD],
  Collaboration: [p('collaboration_type', 'enum', '合作形式', { values: COLLAB_TYPES, required: true }), p('stage', 'enum', '合作階段', { values: COLLAB_STAGES, required: true }), ...RECORD],
  Evidence: [p('url', 'url', '來源網址', { required: true }), p('publisher', 'string', '發布者', { required: true }), p('published_at', 'date', '發布日期', { required: true }), p('title_zh', 'string', '中文標題'), p('source_type', 'string', '公告、產品頁、新聞、年報…'), p('date_method', 'enum', 'published_at 怎麼取得', { values: ['page_metadata', 'url_path', 'page_text', 'record_note', 'manual'] }),
    p('period_end', 'date', '報告涵蓋期間（年報／季報）'), p('link_checked_at', 'date', '最後一次抓取網址的日期'), p('link_status', 'string', '最後一次抓取的結果'),
    p('publisher_method', 'string', 'publisher 怎麼取得（url_host＝取自網址網域）'), p('reverified_for_package', 'boolean', '是否為本資料集重新確認'), VERIFY, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  Claim: [VERIFY_REQ],
  ETF: [p('ticker', 'string', '基金代號', { required: true }), p('as_of', 'date', '成分股基準日', { required: true }), p('url', 'url', '成分股頁面'), p('website', 'url', '發行商網站'), VERIFY, p('verification_legacy', 'string', '遷移前的可靠度標記')],
  Event: [p('event_type', 'enum', '事件類型', { values: EVENT_TYPES, required: true }), p('occurred_at', 'date', '事件發生日', { required: true }), LIFE, VERIFY, EVIDENCE],
  TopicMention: [p('mentioned_at', 'date', '提及日期', { required: true }), p('sentiment', 'enum', '語氣', { values: ['positive', 'neutral', 'negative'] }), p('mention_kind', 'enum', '提及方式', { values: ['headline', 'body', 'quote'] }), EVIDENCE],
  Topic: [p('slug', 'string', '穩定的英文代稱（例 edge-ai）', { required: true }), p('status', 'enum', '主題狀態', { values: ['emerging', 'active', 'fading'] })],
  ValueChainStage: [p('order', 'number', '由上游到下游的排序（1＝最上游）', { required: true })],
  Facility: [p('country', 'string', '所在國家（ISO 代碼）', { required: true }), VERIFY, EVIDENCE],
};
const RELATION_REQUIREMENT = /（關係）$/;          // "所屬產業（關係）" is a relation rule (coverage), not an attribute

type RegNode = { id: string; name: string; parent: string | null; status: string; abstract: boolean; why: string; naming_rule: string; extraction_rule: string; required_keys: string[]; suggested_keys: Record<string, string>; attributes: { name_en: string } };
type RegRel = { id: string; name: string; inverse_name: string | null; group: string; from_types: string[]; to_types: string[]; cardinality: string; kind: string; status: string; description: string; attributes: { name_en: string; inverse_en?: string | null; meaning_en?: string } };

function propsFor(n: RegNode): PropertyDef[] {
  const key = typeKey(n.id), out = new Map<string, PropertyDef>();
  for (const d of COMMON) out.set(d.name, d);
  for (const [k, w] of Object.entries(n.suggested_keys)) out.set(k, p(k, DT[w] ?? 'any', `建議欄位（${w}）`));
  for (const d of TYPE_EXTRAS[key] ?? []) out.set(d.name, { ...out.get(d.name), ...d });
  for (const k of n.required_keys.filter(k => !RELATION_REQUIREMENT.test(k))) out.set(k, { ...(out.get(k) ?? p(k, 'any', '必填欄位')), required: true });
  if (key === 'Technology') out.delete('provider');
  return [...out.values()];
}

// ---- Storage policy from the registry's "kind" ----
const STORAGE: Record<string, string> = { 手動: 'asserted', '手動（有證據）': 'asserted', '手動或系統算出': 'asserted_or_derived', 系統算出: 'derived_only', 查詢時算出: 'query_derived_only', 'AI 建議': 'suggested_only' };
/** V4 corrections to the registry's compatibility cardinalities. */
const CARDINALITY_OVERRIDES: Record<string, string> = { IS_SUBSIDIARY_OF: '多對多（持股／控制分開記錄；母公司由規則判斷）', CATEGORY_IN_SEGMENT: '多對多（需驗證脈絡）' };
/** Relation characteristics and edge-level attributes. */
const PREDICATE_TRAITS: Record<string, Partial<EdgeType>> = {
  HAS_PARTICIPANT: { properties: [p('role', 'enum', '參與方角色', { values: ROLES })] },
  EVENT_PARTICIPANT: { properties: [p('role', 'string', '事件中的角色')] },
  HOLDS_CONSTITUENT: { properties: [p('weight_pct', 'number', '成分股權重（%）', { required: true }), p('as_of', 'date', '成分股基準日', { required: true }), p('weight_source', 'url', '權重來源')] },
  OWNS_STAKE_IN: { properties: [p('percent', 'number', '持股比例（%）'), p('as_of', 'date', '基準日')] },
  COMPATIBLE_WITH: { symmetric: true }, CAN_SUBSTITUTE_FOR: { symmetric: false },
  DIRECTLY_COMPETES_WITH: { symmetric: true, derivedBy: 'R-derive-competition' }, INDIRECTLY_COMPETES_WITH: { symmetric: true, derivedBy: 'R-derive-competition' },
  DIRECT_COMPETITOR_OF: { symmetric: true, derivedBy: 'R-derive-competition' }, INDIRECT_COMPETITOR_OF: { symmetric: true, derivedBy: 'R-derive-competition' },
  COLLABORATES_WITH: { symmetric: true, derivedBy: 'R-derive-collaboration' },
  SUPPLIES_TO: { derivedBy: 'R-derive-supply' }, MAY_SUPPLY_TO: { derivedBy: 'R-derive-supply' }, INDIRECT_SUPPLIER_OF: { derivedBy: 'R-derive-supply-chain' },
  ACTIVE_IN_SEGMENT: { derivedBy: 'R-derive-groups' },
  POSSIBLE_COMPETITOR: { symmetric: true, derivedBy: 'S-same-offering, S-same-category, S-same-segment, S-shared-technology' },
  POSSIBLE_SUPPLIER: { derivedBy: 'S-technology-provider, S-value-chain' },
};
const COMMON_EDGE: PropertyDef[] = [VERIFY, LIFE, EVIDENCE, p('valid_from', 'date', '何時開始有效'), p('valid_to', 'date', '何時失效'), p('notes', 'text', '備註'), p('curation', 'object', '整理方式'), p('verification_legacy', 'string', '遷移前的可靠度標記'), p('legacy_ids', 'string[]', '遷移前的舊 id')];

export function buildOntology(): { entityTypes: EntityType[]; edgeTypes: EdgeType[] } {
  const reg = registry as unknown as { node_types: RegNode[]; relation_types: RegRel[] };
  const entityTypes: EntityType[] = reg.node_types.map(n => ({
    name: typeKey(n.id), id: n.id, label: n.name, label_en: n.attributes.name_en, definition: n.why,
    parent: n.parent ? typeKey(n.parent) : undefined, abstract: n.abstract || undefined, status: n.status,
    naming_rule: n.naming_rule, extraction_rule: n.extraction_rule, properties: propsFor(n),
  }));
  const edgeTypes: EdgeType[] = reg.relation_types.map(r => {
    const key = relKey(r.id), traits = PREDICATE_TRAITS[key] ?? {};
    return {
      predicate: key, id: r.id, label: r.name, inverse_label: r.inverse_name, label_en: r.attributes.name_en,
      group: r.group, from: r.from_types.map(t => typeKey(`type:${t}`)), to: r.to_types.map(t => typeKey(`type:${t}`)),
      storage: STORAGE[r.kind] ?? 'asserted', cardinality: CARDINALITY_OVERRIDES[key] ?? r.cardinality, meaning: r.description, meaning_en: r.attributes.meaning_en,
      status: r.status, evidenceRequired: r.kind === '手動（有證據）' || undefined, inverse: r.attributes.inverse_en ?? null,
      ...traits, properties: [...COMMON_EDGE, ...(traits.properties ?? [])],
    };
  });
  return { entityTypes, edgeTypes };
}

export const RULES: Rule[] = [
  { id: 'C-supply-supplier', kind: 'cardinality', description: '每筆供應紀錄恰好 1 個供應方。', class: 'SupplyRelationship', predicate: 'HAS_SUPPLIER', min: 1, max: 1 },
  { id: 'C-supply-buyer', kind: 'cardinality', description: '每筆供應紀錄恰好 1 個直接買方。', class: 'SupplyRelationship', predicate: 'HAS_BUYER', min: 1, max: 1 },
  { id: 'C-opp-seller', kind: 'cardinality', description: '每筆商機恰好 1 個潛在賣方。', class: 'CustomerOpportunity', predicate: 'PROSPECTIVE_SELLER', min: 1, max: 1 },
  { id: 'C-opp-customer', kind: 'cardinality', description: '每筆商機至少 1 個目標客戶。', class: 'CustomerOpportunity', predicate: 'TARGET_CUSTOMER', min: 1 },
  { id: 'C-collab-participants', kind: 'cardinality', description: '每筆合作紀錄至少 2 個參與方。', class: 'Collaboration', predicate: 'HAS_PARTICIPANT', min: 2 },
  { id: 'C-comp-a', kind: 'cardinality', description: '競爭評估恰好比較 1 個商品 A…', class: 'CompetitionAssessment', predicate: 'OFFERING_A', min: 1, max: 1 },
  { id: 'C-comp-b', kind: 'cardinality', description: '…與恰好 1 個商品 B。', class: 'CompetitionAssessment', predicate: 'OFFERING_B', min: 1, max: 1 },
  { id: 'C-comp-segment', kind: 'cardinality', description: '競爭評估限定在恰好 1 個市場區隔。', class: 'CompetitionAssessment', predicate: 'COMPETES_IN_SEGMENT', min: 1, max: 1 },
  { id: 'C-comp-distinct', kind: 'distinct_targets', description: '商品 A 與商品 B 不可相同。', class: 'CompetitionAssessment', predicates: ['OFFERING_A', 'OFFERING_B'] },
  { id: 'C-evidence', kind: 'evidence_required', description: '關係紀錄與事件至少要引用 1 筆證據。', classes: ['CompetitionAssessment', 'SupplyRelationship', 'CustomerOpportunity', 'Collaboration', 'Event'] },
  { id: 'R-derive-competition', kind: 'derivation', description: '完整的競爭評估推出商品層（直接／間接競爭）與公司層（直接／間接競爭者）連結；公司是賣或品牌這兩個商品的公司。投影繼承可靠度、證據與重疊範圍。', produces: ['DIRECTLY_COMPETES_WITH', 'INDIRECTLY_COMPETES_WITH', 'DIRECT_COMPETITOR_OF', 'INDIRECT_COMPETITOR_OF'], from: 'CompetitionAssessment', when: { complete: true }, implementation: 'lib/derive.ts#deriveEdges' },
  { id: 'R-derive-collaboration', kind: 'derivation', description: '合作紀錄的每一對公司參與方得到一條「合作夥伴」連結，帶著合作階段。', produces: ['COLLABORATES_WITH'], from: 'Collaboration', when: { participants_min: 2 }, implementation: 'lib/derive.ts#deriveEdges' },
  { id: 'R-derive-supply', kind: 'derivation', description: '供應紀錄在 design_win、mass_production 或未指定階段推出「供應給」；在 prospect、qualified、sampling 推出「可能供應給」。未結案的客戶商機也推出「可能供應給」。已結束的不投影。', produces: ['SUPPLIES_TO', 'MAY_SUPPLY_TO'], from: 'SupplyRelationship|CustomerOpportunity', when: { stage_not: ['ended', 'lost'] }, implementation: 'lib/derive.ts#deriveEdges' },
  { id: 'R-derive-groups', kind: 'derivation', description: '公司「活躍於」它的商品或業務線所面向的每個市場區隔（目標區隔、屬於類別 → 類別屬於區隔、業務線面向市場）。', produces: ['ACTIVE_IN_SEGMENT'], from: 'Offering|BusinessLine', when: { owned_by: 'Company' }, implementation: 'lib/derive.ts#deriveEdges' },
  { id: 'G-company-offering', kind: 'coverage', description: '每家公司至少有一個商品或業務線。', class: 'Company', anyOf: ['SELLS', 'BRANDS', 'OFFERS_SERVICE', 'MANUFACTURES', 'DESIGNS', 'DISTRIBUTES', 'OPERATES_BUSINESS_LINE'].map(predicate => ({ predicate, direction: 'out' as const })) },
  { id: 'G-company-segment', kind: 'coverage', description: '每家公司至少在一個市場區隔（直接或經由商品）。', class: 'Company', anyOf: [{ predicate: 'ACTIVE_IN_SEGMENT', direction: 'out' }], includeDerived: true },
  { id: 'G-offering-group', kind: 'coverage', description: '每個商品都放進一個區隔或類別。', class: 'Offering', anyOf: [{ predicate: 'TARGETS_SEGMENT', direction: 'out' }, { predicate: 'IN_CATEGORY', direction: 'out' }] },
  { id: 'G-business-line-segment', kind: 'coverage', description: '每條業務線都面向一個市場區隔。', class: 'BusinessLine', anyOf: [{ predicate: 'BUSINESS_LINE_IN_SEGMENT', direction: 'out' }] },
  { id: 'G-category-segment', kind: 'coverage', description: '每個產品類別都屬於一個區隔。', class: 'ProductCategory', anyOf: [{ predicate: 'CATEGORY_IN_SEGMENT', direction: 'out' }, { predicate: 'SUBCATEGORY_OF', direction: 'out' }] },
  { id: 'G-segment-industry', kind: 'coverage', description: '每個市場區隔都屬於一個產業。', class: 'MarketSegment', anyOf: [{ predicate: 'SEGMENT_OF_INDUSTRY', direction: 'out' }] },
  { id: 'S-same-offering', kind: 'suggestion', description: '兩家無關的公司賣同一個商品 → 可能的競爭者。', produces: 'POSSIBLE_COMPETITOR', strength: 0.75, implementation: 'lib/suggest.ts' },
  { id: 'S-same-category', kind: 'suggestion', description: '兩家公司的商品在同一個產品類別 → 可能的競爭者。', produces: 'POSSIBLE_COMPETITOR', strength: 0.8, implementation: 'lib/suggest.ts' },
  { id: 'S-same-segment', kind: 'suggestion', description: '兩家公司的商品或業務線面向同一個市場區隔 → 可能的競爭者。', produces: 'POSSIBLE_COMPETITOR', strength: 0.6, implementation: 'lib/suggest.ts' },
  { id: 'S-shared-technology', kind: 'suggestion', description: '兩家公司的商品使用同一技術 → 在該平台上可能競爭。', produces: 'POSSIBLE_COMPETITOR', strength: 0.4, implementation: 'lib/suggest.ts' },
  { id: 'S-technology-provider', kind: 'suggestion', description: '公司的商品使用另一家公司提供的技術 → 可能的供應商。', produces: 'POSSIBLE_SUPPLIER', strength: 0.6, implementation: 'lib/suggest.ts' },
  { id: 'S-value-chain', kind: 'suggestion', description: '公司所在區隔供料給另一家公司所在區隔 → 可能的供應商。', produces: 'POSSIBLE_SUPPLIER', strength: 0.35, implementation: 'lib/suggest.ts' },
  { id: 'A-supply-certainty', kind: 'answer_mapping', description: '供應階段如何回答「潛在還是確定客戶？」。', question: 'supply', class: 'SupplyRelationship', field: 'stage', map: { prospect: '潛在', qualified: '潛在', sampling: '潛在', design_win: '確定（design win，量產未確認）', mass_production: '確定', ended: '前客戶', unspecified: '有報導的連結，階段未知' } },
  { id: 'A-opportunity-certainty', kind: 'answer_mapping', description: '商機永遠不是確定客戶。', question: 'supply', class: 'CustomerOpportunity', field: 'stage', map: { identified: '潛在', contacted: '潛在', proposal: '潛在', evaluation: '潛在', won: '已成交（請記錄供應紀錄）', lost: '不是客戶', unspecified: '潛在' } },
  { id: 'A-competition-level', kind: 'answer_mapping', description: '競爭評估如何回答「同市場直接對手，還是部分重疊？」。', question: 'competition', class: 'CompetitionAssessment', field: 'overlap_scope', map: { market: '整個市場區隔的直接對手', product_category: '單一產品類別內重疊', application: '只在單一應用重疊', unspecified: '重疊範圍尚未整理' } },
];

export const COMPETENCY_QUESTIONS: CompetencyQuestion[] = [
  { id: 'competition', question: { 'zh-TW': '誰跟誰競爭？', en: 'Who competes with whom?' },
    subQuestions: [{ 'zh-TW': '是同一市場的直接競品，還是只在某個產品或應用上重疊？', en: 'Same-market direct rivals, or overlap only on a product or application?' }],
    answeredBy: { records: ['CompetitionAssessment'], fields: ['competition_type', 'overlap_scope', 'basis', 'verification_status'], tool: 'competitors_of' } },
  { id: 'supply', question: { 'zh-TW': '誰供應給誰？', en: 'Who supplies whom?' },
    subQuestions: [{ 'zh-TW': '供應的是什麼產品或服務？', en: 'Which product or service is supplied?' }, { 'zh-TW': '潛在客戶 or 確定客戶？', en: 'Potential or confirmed customer?' }],
    answeredBy: { records: ['SupplyRelationship', 'CustomerOpportunity'], fields: ['stage', 'offering_kind', 'verification_status'], tool: 'supply_chain_of' } },
  { id: 'collaboration', question: { 'zh-TW': '誰和誰合作？', en: 'Who partners with whom?' },
    subQuestions: [{ 'zh-TW': '公開宣布了什麼？合作範圍是什麼？', en: 'What was announced, and what is the scope?' }, { 'zh-TW': '目前到哪個階段？', en: 'What stage is it at now?' }],
    answeredBy: { records: ['Collaboration'], fields: ['collaboration_type', 'stage', 'lifecycle_status', 'scope', 'announced_at', 'role'], tool: 'collaborations_of' } },
];

/** Re-applies the current schema, rules and questions to a graph (data untouched). */
export function applySchema(g: Graph): Graph {
  const { entityTypes, edgeTypes } = buildOntology();
  return { ...g, entityTypes, edgeTypes, rules: RULES, competencyQuestions: COMPETENCY_QUESTIONS, ontology_version: ONTOLOGY_VERSION, ontology_id: 'goodmind', schema_hash: schemaHash() };
}
/** Fingerprint of the code-side registry: when it changes, stored data picks up the new schema on next read. */
export function schemaHash(): string {
  const s = JSON.stringify([buildOntology(), RULES]);
  let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
