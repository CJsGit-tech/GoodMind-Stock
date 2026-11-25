// GQC — GoodMind Query Contract (V4 docs/04-query-and-evidence.md).
// One JSON query shape for the filter UI, the API and (optionally) natural language. The compiler only walks
// paths registered in PATHS below — never free-form traversal, never user SQL/Cypher — and returns, per company:
// every matching path with its fact ids and evidence ids, plus optional expansions that never change the match set.
// Guarantees: canonical ids (one result per company); all = ∩, any = ∪, not = exclusion that never treats missing
// data as "no" (open world); verification / as_of / max_hops policy on every fact; stable sort and a cursor tied to
// the data snapshot, so the same query + snapshot + rule version gives the same answer.
import { z } from 'zod';
import type { Graph, GraphEdge, GraphNode } from './types';
import { at, atList, atStr, isA, VERIFICATION } from './types';
import { resolve } from './write';
import { decodeToken, encodeToken, hashHex } from './hash';

export const GQC_VERSION = '4.0';
export const RULE_VERSION = 'gqc-rules-1';

// ---------------------------------------------------------------- contract
const filter = z.object({
  field: z.string().max(40), operator: z.string().max(40).optional(), values: z.array(z.string().max(200)).min(1).max(30),
  lifecycle: z.array(z.string().max(30)).max(6).optional(),
  collaboration_type: z.array(z.string().max(40)).max(8).optional(),
}).strict();
type FilterIn = z.infer<typeof filter>;
type GroupIn = { all?: Node[]; any?: Node[]; not?: Node[] };
type Node = FilterIn | GroupIn;
const group: z.ZodType<GroupIn> = z.lazy(() => z.object({
  all: z.array(z.union([filter, group])).max(20).optional(), any: z.array(z.union([filter, group])).max(20).optional(), not: z.array(z.union([filter, group])).max(20).optional(),
}).strict());
export const EXPANDS = ['products', 'business_lines', 'direct_competitors', 'indirect_competitors', 'partnerships', 'suppliers', 'customers', 'subsidiaries', 'technology_trends'] as const;
export const gqcSchema = z.object({
  version: z.literal(GQC_VERSION),
  result_type: z.literal('company'),
  universe: z.object({ listing_market: z.array(z.string().max(20)).max(10).optional(), country: z.array(z.string().max(4)).max(30).optional(), ids: z.array(z.string().max(200)).max(200).optional() }).strict().optional(),
  filters: group.optional(),
  expand: z.array(z.enum(EXPANDS)).max(EXPANDS.length).optional(),
  policy: z.object({
    verification: z.array(z.enum(VERIFICATION as [string, ...string[]])).min(1).optional(),
    include_inferred: z.boolean().optional(),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max_hops: z.number().int().min(1).max(6).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    cursor: z.string().max(400).optional(),
  }).strict().optional(),
}).strict();
export type GQC = z.infer<typeof gqcSchema>;

/** Query registry: the only fields and operators a query may use, the node types their values resolve to,
 *  and the semantic path rules each one walks. */
export const FIELDS: Record<string, { label: string; operators: string[]; valueTypes: string[]; rules: Record<string, string[]>; note: string }> = {
  industry: { label: '產業', operators: ['related_to', 'operates_in'], valueTypes: ['Industry'], rules: { operates_in: ['industry_operates_v1'], related_to: ['industry_operates_v1', 'industry_via_segment_v1'] }, note: 'operates_in 只看「經營產業」；related_to 也接受經由商品／業務線所在區隔。含子產業。不產生競爭關係。' },
  segment: { label: '市場區隔', operators: ['related_to'], valueTypes: ['MarketSegment'], rules: { related_to: ['segment_offering_v1', 'segment_business_line_v1', 'segment_asserted_v1'] }, note: '公司的商品、業務線或明確記錄的「活躍於區隔」。' },
  category: { label: '產品類別', operators: ['related_to'], valueTypes: ['ProductCategory'], rules: { related_to: ['category_offering_v1'] }, note: '公司的商品屬於該類別（含子類別）。' },
  technology: { label: '技術', operators: ['related_to', 'provides'], valueTypes: ['Technology', 'Topic'], rules: { related_to: ['technology_exposure_v1', 'technology_provider_v1'], provides: ['technology_provider_v1'] }, note: '公司賣／品牌／製造／設計的商品使用該技術，或公司提供該技術。值可以是趨勢主題（展開為主題相關技術）。' },
  application: { label: '應用', operators: ['related_to'], valueTypes: ['Application'], rules: { related_to: ['serves_application_v1'] }, note: '商品支援該應用 ≠ 已有客戶。' },
  topic: { label: '趨勢主題', operators: ['active_in', 'attention'], valueTypes: ['Topic'], rules: { active_in: ['topic_activity_v1', 'topic_technology_v1'], attention: ['topic_attention_v1'] }, note: 'active_in＝有事件的實質參與或使用主題相關技術；attention＝只有媒體提及，不代表參與。' },
  partner_of: { label: '合作夥伴', operators: ['related_to'], valueTypes: ['Company'], rules: { related_to: ['partners_v1'] }, note: '有效的合作紀錄；可用 lifecycle 限定階段。' },
  collaboration_focus: { label: '合作焦點', operators: ['related_to'], valueTypes: ['MarketSegment', 'Technology', 'Product', 'Service'], rules: { related_to: ['collaboration_focus_v1'] }, note: '公司參與的合作紀錄鎖定該市場、技術或商品；可用 collaboration_type、lifecycle 限定。' },
  competitor_of: { label: '競爭者', operators: ['direct', 'indirect', 'any'], valueTypes: ['Company'], rules: { direct: ['direct_competitors_v1'], indirect: ['indirect_competitors_v1'], any: ['direct_competitors_v1', 'indirect_competitors_v1'] }, note: '只來自競爭評估紀錄；同產業或同技術不算。' },
  supplier_of: { label: '供應給', operators: ['confirmed', 'potential', 'any'], valueTypes: ['Company'], rules: { confirmed: ['supplies_v1'], potential: ['may_supply_v1'], any: ['supplies_v1', 'may_supply_v1'] }, note: '只用供應紀錄；confirmed＝design_win、mass_production 或未指定階段。' },
  customer_of: { label: '採購自', operators: ['confirmed', 'potential', 'any'], valueTypes: ['Company'], rules: { confirmed: ['supplies_v1'], potential: ['may_supply_v1'], any: ['supplies_v1', 'may_supply_v1'] }, note: '公司是這些公司的直接買方（不一定是終端客戶）。' },
  subsidiary_of: { label: '子公司', operators: ['related_to'], valueTypes: ['Company', 'CorporateGroup'], rules: { related_to: ['subsidiaries_v1'] }, note: '母公司是／控制（可多層，受 max_hops 限制）或屬於集團。' },
  held_by: { label: 'ETF 成分股', operators: ['related_to'], valueTypes: ['ETF'], rules: { related_to: ['etf_holdings_v1'] }, note: 'ETF 持有成分股（依成分股基準日）。' },
  country: { label: '國家', operators: ['in'], valueTypes: [], rules: { in: ['company_attribute_v1'] }, note: '公司 attributes.country（ISO 代碼）。缺值＝未知。' },
};
export const PATHS: Record<string, { label: string; path: string }> = {
  industry_operates_v1: { label: '經營產業', path: '公司 -經營產業→ 產業（-子產業→）' },
  industry_via_segment_v1: { label: '經由區隔屬於產業', path: '公司 -賣/製造/設計/業務線→ 商品 -目標區隔/屬於類別→ 區隔 -區隔屬於產業→ 產業' },
  segment_offering_v1: { label: '商品所在區隔', path: '公司 -賣/品牌/製造/設計/代理/提供服務→ 商品 -目標區隔（或 屬於類別→類別屬於區隔）→ 區隔' },
  segment_business_line_v1: { label: '業務線所在區隔', path: '公司 -經營業務線→ 業務線 -業務線面向市場→ 區隔' },
  segment_asserted_v1: { label: '明確記錄的活躍區隔', path: '公司 -活躍於區隔→ 區隔' },
  category_offering_v1: { label: '商品屬於類別', path: '公司 -賣…→ 商品 -屬於類別→ 類別（-子類別→）' },
  technology_exposure_v1: { label: '商品使用技術', path: '公司 -賣/品牌/製造/設計/提供服務→ 商品 -使用技術→ 技術' },
  technology_provider_v1: { label: '提供技術', path: '公司 -提供技術→ 技術' },
  serves_application_v1: { label: '商品適用應用', path: '公司 -賣…→ 商品 -適用於→ 應用' },
  topic_activity_v1: { label: '參與主題事件', path: '公司 ←事件參與者- 事件 -涉及主題→ 主題' },
  topic_technology_v1: { label: '使用主題相關技術', path: '公司 -賣…→ 商品 -使用技術→ 技術 ←主題相關技術- 主題' },
  topic_attention_v1: { label: '被提及（熱度）', path: '公司 ←提及實體- 主題提及 -涉及主題→ 主題' },
  collaboration_focus_v1: { label: '合作焦點', path: '公司 ←參與方- 合作紀錄 -合作目標市場/合作技術/合作商品→ 區隔/技術/商品' },
  partners_v1: { label: '合作紀錄', path: '公司 ←參與方- 合作紀錄 -參與方→ 公司' },
  direct_competitors_v1: { label: '直接競爭評估', path: '公司 -賣…→ 商品 ←比較商品 A/B- 競爭評估(DIRECT) -比較商品 B/A→ 商品 ←賣…- 公司' },
  indirect_competitors_v1: { label: '間接競爭評估', path: '公司 -賣…→ 商品 ←比較商品 A/B- 競爭評估(INDIRECT) -比較商品 B/A→ 商品 ←賣…- 公司' },
  supplies_v1: { label: '確定供應', path: '公司 ←供應方- 供應紀錄(design_win/mass_production) -買方→ 公司' },
  may_supply_v1: { label: '潛在供應', path: '公司 ←供應方- 供應紀錄(prospect/qualified/sampling) -買方→ 公司' },
  subsidiaries_v1: { label: '母公司／控制／集團', path: '公司 -母公司是/控制→ …→ 公司；公司 -屬於集團→ 集團' },
  etf_holdings_v1: { label: 'ETF 成分股', path: 'ETF -持有成分股→ 公司' },
  company_attribute_v1: { label: '公司屬性', path: '公司.attributes' },
};

// ---------------------------------------------------------------- results
export type MatchPath = { rule_id: string; field: string; node_ids: string[]; fact_ids: string[]; evidence_ids: string[] };
export type GqcResult = {
  company_id: string; name: string; name_en: string | null; universe_status: 'in' | 'unknown';
  matching_paths: MatchPath[]; unknown_fields: string[]; expansions: Record<string, unknown>;
};
export type GqcResponse = {
  query_id: string; schema_version: string; rule_version: string; snapshot: string; as_of: string;
  normalized_query: GQC; resolved: { input: string; field: string; ids: string[] }[];
  total_matches: number; coverage: { status: 'complete' | 'partial'; unknown: Record<string, number>; notes: string[] };
  results: GqcResult[]; next_cursor: string | null;
};
export type GqcError = { errors: string[] };

const OWN = ['SELLS', 'BRANDS', 'MANUFACTURES', 'DESIGNS', 'DISTRIBUTES', 'OFFERS_SERVICE'];
const SELLER = ['SELLS', 'BRANDS', 'OFFERS_SERVICE'];
const CONFIRMED = new Set(['design_win', 'mass_production', 'unspecified']);
const POTENTIAL = new Set(['prospect', 'qualified', 'sampling']);
const hash = (s: string) => hashHex(s).slice(0, 12);
export const snapshotOf = (g: Graph) => hash(JSON.stringify([g.nodes, g.edges]));

/** Read-only index + policy over one graph snapshot. */
class Ctx {
  by = new Map<string, GraphNode>();
  outE = new Map<string, GraphEdge[]>(); inE = new Map<string, GraphEdge[]>();
  allowed: Set<string>; asOf: string; maxHops: number;
  constructor(public g: Graph, policy: NonNullable<GQC['policy']>) {
    for (const n of g.nodes) this.by.set(n.id, n);
    for (const e of g.edges) { (this.outE.get(e.from) ?? this.outE.set(e.from, []).get(e.from)!).push(e); (this.inE.get(e.to) ?? this.inE.set(e.to, []).get(e.to)!).push(e); }
    this.allowed = new Set([...(policy.verification ?? ['verified', 'reported']), ...(policy.include_inferred ? ['inferred'] : [])]);
    this.asOf = policy.as_of ?? new Date().toISOString().slice(0, 10);
    this.maxHops = policy.max_hops ?? 5;
  }
  /** A stored fact (edge or record node) counts when its verification is allowed and it is valid at as_of. */
  ok = (x: GraphEdge | GraphNode | undefined): boolean => {
    if (!x) return false;
    const v = atStr(x, 'verification_status', 'reported');
    if (!this.allowed.has(v)) return false;
    const from = atStr(x, 'valid_from'), to = atStr(x, 'valid_to');
    if (from && from > this.asOf) return false;
    if (to && to < this.asOf) return false;
    return true;
  };
  out = (id: string, ps: string[]) => (this.outE.get(id) ?? []).filter(e => ps.includes(e.predicate) && this.ok(e));
  into = (id: string, ps: string[]) => (this.inE.get(id) ?? []).filter(e => ps.includes(e.predicate) && this.ok(e));
  type = (id: string) => this.by.get(id)?.type;
  ev = (...xs: (GraphEdge | GraphNode | undefined)[]) => [...new Set(xs.flatMap(x => atList(x, 'evidence_ids')))].sort();
  /** Nodes reachable from roots through `ps` edges in reverse (children of a hierarchy), within max_hops. */
  descendants(roots: string[], ps: string[]): Map<string, GraphEdge[]> {
    const m = new Map<string, GraphEdge[]>(roots.map(r => [r, []]));
    let frontier = roots;
    for (let d = 0; d < this.maxHops && frontier.length; d++) {
      const next: string[] = [];
      for (const r of frontier) for (const e of this.into(r, ps)) if (!m.has(e.from)) { m.set(e.from, [...m.get(r)!, e]); next.push(e.from); }
      frontier = next;
    }
    return m;
  }
  /** Offerings a company owns (sells, brands, makes, designs, distributes, offers) — with the owning edge. */
  offerings = (c: string, ps = OWN) => this.out(c, ps).map(e => ({ o: e.to, e }));
}

type Eval = { match: Map<string, MatchPath[]>; unknown: Set<string> };
const push = (m: Map<string, MatchPath[]>, c: string, p: MatchPath) => (m.get(c) ?? m.set(c, []).get(c)!).push(p);
const mk = (cx: Ctx, rule: string, field: string, nodes: string[], facts: (GraphEdge | GraphNode)[]): MatchPath | null =>
  facts.filter(x => 'predicate' in x).length > cx.maxHops ? null :   /* max_hops bounds the number of edges walked */ { rule_id: rule, field, node_ids: nodes, fact_ids: facts.map(f => f.id), evidence_ids: cx.ev(...facts, ...nodes.map(n => cx.by.get(n))) };

/** Evaluates one filter over every company in scope. */
function evalFilter(cx: Ctx, f: FilterIn & { ids: string[] }, companies: string[]): Eval {
  const match = new Map<string, MatchPath[]>(), unknown = new Set<string>();
  const def = FIELDS[f.field], op = f.operator ?? def.operators[0], rules = def.rules[op];
  const add = (c: string, p: MatchPath | null) => { if (p) push(match, c, p); };
  const targets = new Set(f.ids);
  const hasOfferings = (c: string) => cx.offerings(c).length > 0 || cx.out(c, ['OPERATES_BUSINESS_LINE']).length > 0;
  for (const c of companies) {
    const offs = cx.offerings(c);
    switch (f.field) {
      case 'industry': {
        const inds = cx.descendants(f.ids, ['SUBINDUSTRY_OF']);
        for (const e of cx.out(c, ['OPERATES_IN'])) if (inds.has(e.to)) add(c, mk(cx, 'industry_operates_v1', f.field, [c, e.to], [e, ...inds.get(e.to)!]));
        if (rules.includes('industry_via_segment_v1')) for (const s of segmentsOf(cx, c)) for (const si of cx.out(s.seg, ['SEGMENT_OF_INDUSTRY'])) if (inds.has(si.to))
          add(c, mk(cx, 'industry_via_segment_v1', f.field, [...s.nodes, si.to], [...s.facts, si, ...inds.get(si.to)!]));
        if (!match.has(c) && !cx.out(c, ['OPERATES_IN']).length && !hasOfferings(c)) unknown.add(c);
        break;
      }
      case 'segment':
        for (const s of segmentsOf(cx, c)) if (targets.has(s.seg)) add(c, mk(cx, s.rule, f.field, s.nodes, s.facts));
        if (!match.has(c) && !hasOfferings(c)) unknown.add(c);
        break;
      case 'category': {
        const cats = cx.descendants(f.ids, ['SUBCATEGORY_OF']);
        for (const { o, e } of offs) for (const ic of cx.out(o, ['IN_CATEGORY'])) if (cats.has(ic.to)) add(c, mk(cx, 'category_offering_v1', f.field, [c, o, ic.to], [e, ic, ...cats.get(ic.to)!]));
        if (!match.has(c) && !offs.length) unknown.add(c);
        break;
      }
      case 'technology': case 'topic': {
        // Topic values expand to their related technologies (topic_technology_v1) and to dated events (topic_activity_v1).
        const techs = new Map<string, GraphEdge[]>();
        for (const id of f.ids) {
          if (cx.type(id) === 'Technology') techs.set(id, []);
          else for (const rt of cx.out(id, ['RELATED_TECHNOLOGY'])) techs.set(rt.to, [rt]);
        }
        const techRule = f.field === 'topic' ? 'topic_technology_v1' : 'technology_exposure_v1';
        if (rules.includes(techRule)) for (const { o, e } of offs) for (const ut of cx.out(o, ['USES_TECHNOLOGY'])) if (techs.has(ut.to))
          add(c, mk(cx, techRule, f.field, [c, o, ut.to, ...techs.get(ut.to)!.map(x => x.from)], [e, ut, ...techs.get(ut.to)!]));
        if (rules.includes('technology_provider_v1')) for (const pt of cx.out(c, ['PROVIDES_TECHNOLOGY'])) if (techs.has(pt.to))
          add(c, mk(cx, 'technology_provider_v1', f.field, [c, pt.to], [pt, ...techs.get(pt.to)!]));
        if (rules.includes('topic_activity_v1')) for (const ep of cx.into(c, ['EVENT_PARTICIPANT'])) {
          const evNode = cx.by.get(ep.from); if (!cx.ok(evNode) || at(evNode, 'occurred_at') && String(at(evNode, 'occurred_at')) > cx.asOf) continue;
          for (const ab of cx.out(ep.from, ['ABOUT_TOPIC'])) if (targets.has(ab.to)) add(c, mk(cx, 'topic_activity_v1', f.field, [c, ep.from, ab.to], [ep, evNode!, ab]));
        }
        if (rules.includes('topic_attention_v1')) for (const me of (cx.inE.get(c) ?? []).filter(e => e.predicate === 'MENTIONS_ENTITY')) {
          const m = cx.by.get(me.from); if (at(m, 'mentioned_at') && String(at(m, 'mentioned_at')) > cx.asOf) continue;
          for (const ab of (cx.outE.get(me.from) ?? []).filter(e => e.predicate === 'ABOUT_TOPIC')) if (targets.has(ab.to)) add(c, mk(cx, 'topic_attention_v1', f.field, [c, me.from, ab.to], [me, ab]));
        }
        if (!match.has(c) && !offs.length && !cx.out(c, ['PROVIDES_TECHNOLOGY']).length) unknown.add(c);
        break;
      }
      case 'application':
        for (const { o, e } of offs) for (const sa of cx.out(o, ['SUPPORTS_APPLICATION'])) if (targets.has(sa.to)) add(c, mk(cx, 'serves_application_v1', f.field, [c, o, sa.to], [e, sa]));
        if (!match.has(c) && !offs.length) unknown.add(c);
        break;
      case 'partner_of':
        for (const p of partnershipsOf(cx, c)) if (p.others.some(o => targets.has(o)) && (!f.lifecycle?.length || f.lifecycle.includes(p.lifecycle ?? 'unspecified')) && (!f.collaboration_type?.length || f.collaboration_type.includes(atStr(p.record, 'collaboration_type', 'unspecified'))))
          add(c, mk(cx, 'partners_v1', f.field, [c, p.record.id, ...p.others.filter(o => targets.has(o))], [p.record, ...p.edges]));
        break;
      case 'collaboration_focus':
        for (const p of partnershipsOf(cx, c)) {
          if (f.lifecycle?.length && !f.lifecycle.includes(p.lifecycle ?? 'unspecified')) continue;
          if (f.collaboration_type?.length && !f.collaboration_type.includes(atStr(p.record, 'collaboration_type', 'unspecified'))) continue;
          for (const fe of cx.out(p.record.id, ['TARGETS_MARKET', 'FOCUSES_ON_TECHNOLOGY', 'FOCUSES_ON_PRODUCT'])) if (targets.has(fe.to))
            add(c, mk(cx, 'collaboration_focus_v1', f.field, [c, p.record.id, fe.to], [p.record, ...p.edges.filter(e => e.to === c), fe]));
        }
        break;
      case 'competitor_of':
        for (const r of competitorsOf(cx, c)) if (targets.has(r.company) && rules.includes(r.direct ? 'direct_competitors_v1' : 'indirect_competitors_v1'))
          add(c, mk(cx, r.direct ? 'direct_competitors_v1' : 'indirect_competitors_v1', f.field, [c, r.ours, r.record.id, r.theirs, r.company], [r.record, ...r.edges]));
        break;
      case 'supplier_of': case 'customer_of':
        for (const s of supplyOf(cx, c)) {
          const other = f.field === 'supplier_of' ? (s.supplier === c ? s.buyer : null) : (s.buyer === c ? s.supplier : null);
          const rule = s.confirmed ? 'supplies_v1' : 'may_supply_v1';
          if (other && targets.has(other) && rules.includes(rule)) add(c, mk(cx, rule, f.field, [c, s.record.id, other], [s.record, ...s.edges]));
        }
        break;
      case 'subsidiary_of': {
        // walk upward: company -IS_SUBSIDIARY_OF/CONTROLS(in reverse)-> parent … within max_hops; plus MEMBER_OF_GROUP.
        const seen = new Map<string, GraphEdge[]>([[c, []]]);
        let frontier = [c];
        for (let d = 0; d < cx.maxHops && frontier.length; d++) {
          const next: string[] = [];
          for (const x of frontier) for (const e of [...cx.out(x, ['IS_SUBSIDIARY_OF']), ...cx.into(x, ['CONTROLS']).map(ce => ({ ...ce, to: ce.from }))])
            if (!seen.has(e.to)) { seen.set(e.to, [...seen.get(x)!, e]); next.push(e.to); }
          frontier = next;
        }
        for (const [p, es] of seen) if (p !== c && targets.has(p)) add(c, mk(cx, 'subsidiaries_v1', f.field, [c, ...es.map(e => e.to)], es));
        for (const e of cx.out(c, ['MEMBER_OF_GROUP'])) if (targets.has(e.to)) add(c, mk(cx, 'subsidiaries_v1', f.field, [c, e.to], [e]));
        break;
      }
      case 'held_by':
        for (const e of cx.into(c, ['HOLDS_CONSTITUENT'])) if (targets.has(e.from)) add(c, mk(cx, 'etf_holdings_v1', f.field, [e.from, c], [e]));
        break;
      case 'country': {
        const v = atStr(cx.by.get(c), 'country');
        if (!v) unknown.add(c); else if (f.values.map(x => x.toUpperCase()).includes(v.toUpperCase())) add(c, { rule_id: 'company_attribute_v1', field: f.field, node_ids: [c], fact_ids: [], evidence_ids: cx.ev(cx.by.get(c)) });
        break;
      }
    }
    if (match.has(c)) unknown.delete(c);
  }
  for (const ps of match.values()) ps.sort((a, b) => (a.rule_id + a.fact_ids.join()).localeCompare(b.rule_id + b.fact_ids.join()));
  return { match, unknown };
}

/** Segments a company sits in, each with the facts that put it there. */
function segmentsOf(cx: Ctx, c: string) {
  const out: { seg: string; rule: string; nodes: string[]; facts: (GraphEdge | GraphNode)[] }[] = [];
  for (const { o, e } of cx.offerings(c)) {
    for (const ts of cx.out(o, ['TARGETS_SEGMENT'])) out.push({ seg: ts.to, rule: 'segment_offering_v1', nodes: [c, o, ts.to], facts: [e, ts] });
    for (const ic of cx.out(o, ['IN_CATEGORY'])) for (const cs of cx.out(ic.to, ['CATEGORY_IN_SEGMENT'])) out.push({ seg: cs.to, rule: 'segment_offering_v1', nodes: [c, o, ic.to, cs.to], facts: [e, ic, cs] });
  }
  for (const ob of cx.out(c, ['OPERATES_BUSINESS_LINE'])) for (const bs of cx.out(ob.to, ['BUSINESS_LINE_IN_SEGMENT'])) out.push({ seg: bs.to, rule: 'segment_business_line_v1', nodes: [c, ob.to, bs.to], facts: [ob, bs] });
  for (const as of cx.out(c, ['ACTIVE_IN_SEGMENT'])) out.push({ seg: as.to, rule: 'segment_asserted_v1', nodes: [c, as.to], facts: [as] });
  return out;
}
function partnershipsOf(cx: Ctx, c: string) {
  return cx.into(c, ['HAS_PARTICIPANT']).map(hp => cx.by.get(hp.from)!).filter(r => r?.type === 'Collaboration' && cx.ok(r) && atStr(r, 'stage') !== 'ended' && !['completed', 'expired'].includes(atStr(r, 'lifecycle_status')))
    .map(r => { const edges = cx.out(r.id, ['HAS_PARTICIPANT']); return { record: r, edges, others: edges.map(e => e.to).filter(x => x !== c && cx.type(x) === 'Company'), lifecycle: at(r, 'lifecycle_status') as string | undefined }; });
}
function competitorsOf(cx: Ctx, c: string) {
  const rows: { record: GraphNode; edges: GraphEdge[]; ours: string; theirs: string; company: string; direct: boolean }[] = [];
  for (const { o: ours, e: own } of cx.offerings(c, SELLER)) for (const ab of cx.into(ours, ['OFFERING_A', 'OFFERING_B'])) {
    const r = cx.by.get(ab.from); if (!r || r.type !== 'CompetitionAssessment' || !cx.ok(r)) continue;
    const other = cx.out(r.id, [ab.predicate === 'OFFERING_A' ? 'OFFERING_B' : 'OFFERING_A'])[0]; if (!other) continue;
    for (const se of cx.into(other.to, SELLER)) if (se.from !== c && cx.type(se.from) === 'Company')
      rows.push({ record: r, edges: [own, ab, other, se], ours, theirs: other.to, company: se.from, direct: at(r, 'competition_type') === 'DIRECT' });
  }
  return rows;
}
function supplyOf(cx: Ctx, c: string) {
  const recs = [...cx.into(c, ['HAS_SUPPLIER']), ...cx.into(c, ['HAS_BUYER'])].map(e => cx.by.get(e.from)!).filter(r => r?.type === 'SupplyRelationship' && cx.ok(r));
  return [...new Map(recs.map(r => [r.id, r])).values()].flatMap(r => {
    const s = cx.out(r.id, ['HAS_SUPPLIER'])[0], b = cx.out(r.id, ['HAS_BUYER'])[0], stage = atStr(r, 'stage', 'unspecified');
    if (!s || !b || stage === 'ended') return [];
    return [{ record: r, edges: [s, b], supplier: s.to, buyer: b.to, stage, confirmed: CONFIRMED.has(stage) && !POTENTIAL.has(stage), offerings: cx.out(r.id, ['FOR_SUPPLIED_PRODUCT', 'FOR_SUPPLIED_SERVICE']).map(e => e.to) }];
  });
}

// ---------------------------------------------------------------- set logic (open world)
type Combined = { match: Map<string, MatchPath[]>; unknown: Set<string> };
function evalGroup(cx: Ctx, gr: GroupIn, companies: string[], resolvedF: (f: FilterIn) => FilterIn & { ids: string[] }, unknownByField: Map<string, Set<string>>): Combined {
  const evalNode = (n: Node): Combined => {
    if ('field' in n) { const r = evalFilter(cx, resolvedF(n as FilterIn), companies); const u = unknownByField.get(n.field) ?? new Set(); r.unknown.forEach(x => u.add(x)); unknownByField.set(n.field, u); return r; }
    return evalGroup(cx, n as GroupIn, companies, resolvedF, unknownByField);
  };
  let cur: Combined = { match: new Map(companies.map(c => [c, []])), unknown: new Set() };
  if (gr.all?.length) for (const n of gr.all) {                      // intersection: keep companies matched by every part
    const r = evalNode(n), m = new Map<string, MatchPath[]>();
    for (const [c, ps] of cur.match) if (r.match.has(c)) m.set(c, [...ps, ...r.match.get(c)!]);
    cur = { match: m, unknown: new Set([...cur.unknown, ...r.unknown]) };
  }
  if (gr.any?.length) {                                              // union of the any-parts, intersected with the rest
    const u = new Map<string, MatchPath[]>(), unk = new Set<string>();
    for (const n of gr.any) { const r = evalNode(n); for (const [c, ps] of r.match) u.set(c, [...(u.get(c) ?? []), ...ps]); r.unknown.forEach(x => unk.add(x)); }
    const m = new Map<string, MatchPath[]>();
    for (const [c, ps] of cur.match) if (u.has(c)) m.set(c, [...ps, ...u.get(c)!]);
    cur = { match: m, unknown: new Set([...cur.unknown, ...unk]) };
  }
  for (const n of gr.not ?? []) {                                    // exclusion: only a recorded match excludes; unknown stays (flagged)
    const r = evalNode(n);
    for (const c of r.match.keys()) cur.match.delete(c);
    r.unknown.forEach(x => cur.unknown.add(x));
  }
  return cur;
}

// ---------------------------------------------------------------- expansions (never change the match set)
function expand(cx: Ctx, c: string, what: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ref = (id: string) => ({ id, name: cx.by.get(id)?.name ?? id });
  if (what.includes('products')) {
    const m = new Map<string, { id: string; name: string; type: string; kind: string | null; roles: string[]; fact_ids: string[]; evidence_ids: string[] }>();
    for (const { o, e } of cx.offerings(c)) { const n = cx.by.get(o)!; const x = m.get(o) ?? { id: o, name: n.name, type: n.type, kind: (at(n, 'kind') as string) ?? null, roles: [], fact_ids: [], evidence_ids: [] }; x.roles.push(e.predicate); x.fact_ids.push(e.id); x.evidence_ids = cx.ev(e, n); m.set(o, x); }
    out.products = [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  if (what.includes('business_lines')) out.business_lines = cx.out(c, ['OPERATES_BUSINESS_LINE']).map(e => ({ ...ref(e.to), fact_ids: [e.id], segments: cx.out(e.to, ['BUSINESS_LINE_IN_SEGMENT']).map(s => ref(s.to)) })).sort((a, b) => a.id.localeCompare(b.id));
  for (const [key, direct] of [['direct_competitors', true], ['indirect_competitors', false]] as const) if (what.includes(key))
    out[key] = competitorsOf(cx, c).filter(r => r.direct === direct).map(r => ({ company: ref(r.company), ours: ref(r.ours), theirs: ref(r.theirs), assessment: ref(r.record.id), overlap_scope: at(r.record, 'overlap_scope') ?? 'unspecified', verification: at(r.record, 'verification_status'), fact_ids: [r.record.id, ...r.edges.map(e => e.id)], evidence_ids: cx.ev(r.record) })).sort((a, b) => (a.company.id + a.assessment.id).localeCompare(b.company.id + b.assessment.id));
  if (what.includes('partnerships')) out.partnerships = partnershipsOf(cx, c).map(p => ({ record: ref(p.record.id), collaboration_type: at(p.record, 'collaboration_type') ?? 'unspecified', stage: at(p.record, 'stage') ?? 'unspecified', lifecycle_status: p.lifecycle ?? null, announced_at: at(p.record, 'announced_at') ?? null, valid_from: at(p.record, 'valid_from') ?? null, valid_to: at(p.record, 'valid_to') ?? null, participants: p.edges.map(e => ({ ...ref(e.to), role: at(e, 'role') ?? 'unspecified' })), verification: at(p.record, 'verification_status'), fact_ids: [p.record.id, ...p.edges.map(e => e.id)], evidence_ids: cx.ev(p.record) })).sort((a, b) => a.record.id.localeCompare(b.record.id));
  if (what.includes('suppliers') || what.includes('customers')) {
    const rows = supplyOf(cx, c);
    const fmt = (s: ReturnType<typeof supplyOf>[number], other: string) => ({ company: ref(other), record: ref(s.record.id), stage: s.stage, certainty: s.confirmed ? 'confirmed' : 'potential', offerings: s.offerings.map(ref), verification: at(s.record, 'verification_status'), fact_ids: [s.record.id, ...s.edges.map(e => e.id)], evidence_ids: cx.ev(s.record) });
    if (what.includes('suppliers')) out.suppliers = rows.filter(s => s.buyer === c).map(s => fmt(s, s.supplier)).sort((a, b) => a.record.id.localeCompare(b.record.id));
    if (what.includes('customers')) out.customers = rows.filter(s => s.supplier === c).map(s => fmt(s, s.buyer)).sort((a, b) => a.record.id.localeCompare(b.record.id));
  }
  if (what.includes('subsidiaries')) out.subsidiaries = {
    children: [...cx.into(c, ['IS_SUBSIDIARY_OF']).map(e => ({ ...ref(e.from), via: 'IS_SUBSIDIARY_OF', fact_id: e.id })), ...cx.out(c, ['CONTROLS']).map(e => ({ ...ref(e.to), via: 'CONTROLS', fact_id: e.id }))].sort((a, b) => a.id.localeCompare(b.id)),
    parents: [...cx.out(c, ['IS_SUBSIDIARY_OF']).map(e => ({ ...ref(e.to), via: 'IS_SUBSIDIARY_OF', fact_id: e.id })), ...cx.into(c, ['CONTROLS']).map(e => ({ ...ref(e.from), via: 'CONTROLS', fact_id: e.id }))].sort((a, b) => a.id.localeCompare(b.id)),
    groups: cx.out(c, ['MEMBER_OF_GROUP']).map(e => ({ ...ref(e.to), fact_id: e.id })),
  };
  if (what.includes('technology_trends')) {
    const techs = [...new Set(cx.offerings(c).flatMap(({ o }) => cx.out(o, ['USES_TECHNOLOGY']).map(e => e.to)).concat(cx.out(c, ['PROVIDES_TECHNOLOGY']).map(e => e.to)))].sort();
    const topics = [...new Set(techs.flatMap(t => cx.into(t, ['RELATED_TECHNOLOGY']).map(e => e.from)))].sort();
    const events = cx.into(c, ['EVENT_PARTICIPANT']).map(e => cx.by.get(e.from)!).filter(ev => cx.ok(ev) && !(at(ev, 'occurred_at') && String(at(ev, 'occurred_at')) > cx.asOf))
      .map(ev => ({ ...ref(ev.id), event_type: at(ev, 'event_type'), occurred_at: at(ev, 'occurred_at'), topics: cx.out(ev.id, ['ABOUT_TOPIC']).map(t => ref(t.to)), evidence_ids: cx.ev(ev) })).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const attention = (cx.inE.get(c) ?? []).filter(e => e.predicate === 'MENTIONS_ENTITY').length;
    out.technology_trends = { technologies: techs.map(ref), topics: topics.map(ref), events, attention_mentions: attention, note: '提及（attention）只代表媒體討論，不代表公司參與或營收。' };
  }
  return out;
}

// ---------------------------------------------------------------- entry
const normalize = (q: GQC): GQC => JSON.parse(JSON.stringify(q, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)));
const filtersOf = (gr: GroupIn | undefined): FilterIn[] => (gr ? [...(gr.all ?? []), ...(gr.any ?? []), ...(gr.not ?? [])].flatMap(n => ('field' in n ? [n as FilterIn] : filtersOf(n as GroupIn))) : []);
const depthOf = (gr: GroupIn | undefined): number => (gr ? 1 + Math.max(0, ...[...(gr.all ?? []), ...(gr.any ?? []), ...(gr.not ?? [])].map(n => ('field' in n ? 0 : depthOf(n as GroupIn)))) : 0);

export function runGqc(graph: Graph, input: unknown): GqcResponse | GqcError {
  const g: Graph = { ...graph, edges: graph.edges.filter(e => !e.derived && !e.suggested) };   // stored facts only; projections are re-walked from records
  const p = gqcSchema.safeParse(input);
  if (!p.success) return { errors: p.error.issues.slice(0, 8).map(i => `${i.path.join('.') || 'query'}: ${i.message}`) };
  const q = p.data, errors: string[] = [];
  const fs = filtersOf(q.filters);
  if (fs.length > 20) errors.push('最多 20 個篩選條件。');
  if (depthOf(q.filters) > 3) errors.push('篩選巢狀最多 3 層。');
  // Resolve every value to canonical ids of the field's allowed types (names, aliases, tickers and old ids accepted).
  const resolved: GqcResponse['resolved'] = [];
  const cache = new Map<FilterIn, FilterIn & { ids: string[] }>();
  for (const f of fs) {
    const def = FIELDS[f.field];
    if (!def) { errors.push(`不支援的欄位「${f.field}」；可用：${Object.keys(FIELDS).join('、')}`); continue; }
    const op = f.operator ?? def.operators[0];
    if (!def.operators.includes(op)) { errors.push(`欄位「${f.field}」不支援 operator「${op}」；可用：${def.operators.join('、')}`); continue; }
    if ((f.lifecycle || f.collaboration_type) && !['partner_of', 'collaboration_focus'].includes(f.field)) errors.push('lifecycle／collaboration_type 只能用在 partner_of 或 collaboration_focus。');
    const ids: string[] = [];
    if (def.valueTypes.length) for (const v of f.values) {
      const hits = resolve(g, v).filter(n => def.valueTypes.some(t => isA(g.entityTypes, n.type, t)));
      if (!hits.length) errors.push(`「${v}」在 ${f.field} 找不到對應的${def.valueTypes.join('／')}節點`);
      else if (hits.length > 1) errors.push(`「${v}」對應到多個節點：${hits.map(h => `${h.name}（${h.id}）`).join('、')}，請改用 id`);
      else ids.push(hits[0].id);
    }
    resolved.push({ input: f.values.join(', '), field: f.field, ids });
    cache.set(f, { ...f, operator: op, ids });
  }
  if (errors.length) return { errors };

  const cx = new Ctx(g, q.policy ?? {});
  const snapshot = snapshotOf(g);
  // Universe: exclude only companies known to be outside it; missing listing data is "unknown" (kept, flagged).
  const uni = q.universe ?? {};
  const universeStatus = new Map<string, 'in' | 'unknown'>();
  for (const n of g.nodes.filter(n => n.type === 'Company')) {
    if (uni.ids?.length && !uni.ids.includes(n.id)) continue;
    const country = atStr(n, 'country').toUpperCase(), exch = atStr(n, 'exchange').toUpperCase(), ticker = atStr(n, 'ticker');
    let st: 'in' | 'unknown' | 'out' = 'in';
    if (uni.country?.length) st = !country ? 'unknown' : uni.country.map(x => x.toUpperCase()).includes(country) ? st : 'out';
    if (st !== 'out' && uni.listing_market?.length) {
      const markets = uni.listing_market.map(x => x.toUpperCase());
      if (exch) st = markets.includes(exch) ? st : 'out';
      else if (ticker && (!country || country === 'TW') && markets.some(m => m === 'TWSE' || m === 'TPEX')) st = 'unknown';   // listed, market not recorded
      else st = 'out';
    }
    if (st !== 'out') universeStatus.set(n.id, st);
  }
  const companies = [...universeStatus.keys()].sort();
  const unknownByField = new Map<string, Set<string>>();
  const r = q.filters && fs.length ? evalGroup(cx, q.filters, companies, f => cache.get(f)!, unknownByField) : { match: new Map(companies.map(c => [c, [] as MatchPath[]])), unknown: new Set<string>() };

  // Stable order: more independent paths first, then id. Cursor = offset bound to the snapshot.
  const rows = [...r.match.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const limit = q.policy?.limit ?? 100;
  let offset = 0;
  if (q.policy?.cursor) {
    try { const c = decodeToken(q.policy.cursor) as { o?: number; s?: string }; if (c.s !== snapshot) return { errors: ['資料已更新，cursor 失效；請從第一頁重新查詢。'] }; offset = Number(c.o) || 0; }
    catch { return { errors: ['cursor 格式不正確。'] }; }
  }
  const page = rows.slice(offset, offset + limit);
  const unknownFieldsOf = (c: string) => [...unknownByField.entries()].filter(([, s]) => s.has(c)).map(([f]) => f).sort();
  const results: GqcResult[] = page.map(([c, paths]) => {
    const n = cx.by.get(c)!;
    const uniq = [...new Map(paths.map(x => [`${x.rule_id}|${x.fact_ids.join(',')}|${x.node_ids.join(',')}`, x])).values()];
    return { company_id: c, name: n.name, name_en: (at(n, 'name_en') as string) ?? null, universe_status: universeStatus.get(c)!, matching_paths: uniq, unknown_fields: unknownFieldsOf(c), expansions: q.expand?.length ? expand(cx, c, q.expand) : {} };
  });

  const notes: string[] = ['沒有符合 ≠ 市場上不存在：只代表目前資料沒有符合的紀錄。'];
  const unknown: Record<string, number> = {};
  for (const [f, s] of unknownByField) if (s.size) { unknown[f] = s.size; notes.push(`${s.size} 家公司在目前的可靠度政策下沒有 ${FIELDS[f].label} 相關資料，無法判斷是否符合（未計入結果，也未被 not 排除）。`); }
  const uniUnknown = [...universeStatus.values()].filter(s => s === 'unknown').length;
  if (uniUnknown) { unknown.universe = uniUnknown; notes.push(`${uniUnknown} 家公司有股票代號但未記錄上市市場（TWSE／TPEx），暫列入範圍並標記 unknown。`); }
  const allowed = [...cx.allowed].sort();
  notes.push(`只使用可靠度為 ${allowed.join('、')}、且在 ${cx.asOf} 有效的事實。`);
  const normalized = normalize({ ...q, policy: { ...q.policy, as_of: cx.asOf, max_hops: cx.maxHops, limit, verification: q.policy?.verification ?? ['verified', 'reported'] } });
  return {
    query_id: `query:${hash(JSON.stringify({ ...normalized, policy: { ...normalized.policy, cursor: undefined } }))}`,
    schema_version: GQC_VERSION, rule_version: RULE_VERSION, snapshot, as_of: cx.asOf, normalized_query: normalized, resolved,
    total_matches: rows.length, coverage: { status: Object.keys(unknown).length ? 'partial' : 'complete', unknown, notes }, results,
    next_cursor: offset + limit < rows.length ? encodeToken({ o: offset + limit, s: snapshot }) : null,
  };
}

/** What the UI / API / agent may use: fields, operators, value types, path rules, expansions. */
export const gqcRegistry = () => ({ version: GQC_VERSION, rule_version: RULE_VERSION, fields: FIELDS, paths: PATHS, expand: EXPANDS, verification: VERIFICATION });
