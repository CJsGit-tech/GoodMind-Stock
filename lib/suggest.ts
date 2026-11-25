// Suggestion engine (ontology v2 rules S-*): turns shared groups into proposed links.
// Suggestions are computed on every read and never stored as facts. A curator accepts one (it becomes a
// real CompetitionAssessment or SupplyRelationship with verification 'inferred', written through lib/write.ts) or rejects it
// (remembered in graph.suggestionDecisions so it is not proposed again).
import type { Graph, GraphEdge, GraphNode } from './types';
import { at, atList, isA } from './types';
import type { WriteOp } from './write';
import { deriveEdges, OWNER_PREDICATES as SELLER_PREDICATES } from './derive';

export type Suggestion = {
  id: string;
  kind: 'competition' | 'supply';
  from: string; to: string;                   // companies; for supply, from = possible supplier
  strength: number;                           // 0..1
  rules: string[];                            // S-* rule ids that fired
  reasons: string[];                          // one simple sentence per reason
  offerings: [string | null, string | null];  // best offering on each side (if known)
  segmentId: string | null; categoryId: string | null; technologyId: string | null;
  via: string[];                              // group nodes that explain the suggestion
};
export type Decision = { id: string; decision: 'accepted' | 'rejected'; at: string; recordId?: string };

/** Space between Chinese and Latin runs: 「CG-200 和 AX-10」. */
const pad = (s: string) => s.replace(/([㐀-鿿])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([㐀-鿿])/g, '$1 $2');
const STRENGTH: Record<string, number> = { 'S-same-category': 0.8, 'S-same-offering': 0.75, 'S-same-segment': 0.6, 'S-technology-provider': 0.6, 'S-shared-technology': 0.4, 'S-value-chain': 0.35 };
const FAMILY = new Set(['IS_SUBSIDIARY_OF', 'CONTROLS', 'MEMBER_OF_GROUP']);

export function computeSuggestions(g: Graph): Suggestion[] {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const name = (id: string | null | undefined) => (id ? by.get(id)?.name ?? id : '');
  const out = (id: string, p: string) => g.edges.filter(e => e.from === id && e.predicate === p).map(e => e.to);
  const derived = deriveEdges(g);
  const all = [...g.edges, ...derived];

  // Corporate families (subsidiaries, control, same group) never compete with or supply each other here.
  const parent = new Map<string, string>();
  const root = (x: string): string => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!; return x; };
  const union = (a: string, b: string) => { const ra = root(a), rb = root(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of g.edges) if (FAMILY.has(e.predicate)) union(e.from, e.to);
  const family = (a: string, b: string) => root(a) === root(b);

  // Pairs already covered by a record.
  const pair = (a: string, b: string) => [a, b].sort().join('|');
  const competing = new Set(derived.filter(e => /COMPETITOR_OF$/.test(e.predicate)).map(e => pair(e.from, e.to)));
  const assessed = new Set(derived.filter(e => /COMPETES_WITH$/.test(e.predicate)).map(e => pair(e.from, e.to)));
  const supplying = new Set(derived.filter(e => e.predicate === 'SUPPLIES_TO' || e.predicate === 'MAY_SUPPLY_TO').map(e => pair(e.from, e.to)));
  const decided = new Set(((g.suggestionDecisions as Decision[] | undefined) ?? []).map(d => d.id));

  // Business lines count like offerings for group-based suggestions (a company active in a segment without a named product).
  const offerings = g.nodes.filter(n => isA(g.entityTypes, n.type, 'Offering') || n.type === 'BusinessLine');
  const sellers = (o: string) => [...new Set(g.edges.filter(e => e.to === o && (SELLER_PREDICATES.has(e.predicate) || e.predicate === 'OPERATES_BUSINESS_LINE') && by.get(e.from)?.type === 'Company').map(e => e.from))];
  const segsOf = (o: string) => [...new Set([...out(o, 'TARGETS_SEGMENT'), ...out(o, 'BUSINESS_LINE_IN_SEGMENT'), ...out(o, 'IN_CATEGORY').flatMap(c => out(c, 'CATEGORY_IN_SEGMENT'))])];
  const index = (f: (o: GraphNode) => string[]) => { const m = new Map<string, string[]>(); for (const o of offerings) for (const k of f(o)) (m.get(k) ?? m.set(k, []).get(k)!).push(o.id); return m; };
  const byCat = index(o => out(o.id, 'IN_CATEGORY')), bySeg = index(o => segsOf(o.id)), byTech = index(o => out(o.id, 'USES_TECHNOLOGY'));

  const acc = new Map<string, Suggestion>();
  const add = (kind: Suggestion['kind'], from: string, to: string, rule: string, reason: string, o: [string | null, string | null], grp: { seg?: string; cat?: string; tech?: string }) => {
    if (from === to || family(from, to)) return;
    const key = kind === 'competition' ? pair(from, to) : `${from}|${to}`;
    if (kind === 'competition' && competing.has(key)) return;
    if (kind === 'supply' && supplying.has(pair(from, to))) return;
    const id = `sugg:${kind}:${key}`;
    if (decided.has(id)) return;
    let s = acc.get(id);
    if (!s) acc.set(id, s = { id, kind, from: kind === 'competition' ? key.split('|')[0] : from, to: kind === 'competition' ? key.split('|')[1] : to, strength: 0, rules: [], reasons: [], offerings: [null, null], segmentId: null, categoryId: null, technologyId: null, via: [] });
    const flip = kind === 'competition' && s.from !== from;
    if (!s.rules.includes(rule)) s.rules.push(rule);
    reason = pad(reason);
    if (!s.reasons.includes(reason) && s.reasons.length < 6) s.reasons.push(reason);
    if (!s.offerings[0] && !s.offerings[1]) s.offerings = flip ? [o[1], o[0]] : o;
    s.segmentId ??= grp.seg ?? null; s.categoryId ??= grp.cat ?? null; s.technologyId ??= grp.tech ?? null;
    for (const v of [grp.seg, grp.cat, grp.tech]) if (v && !s.via.includes(v)) s.via.push(v);
  };

  // --- Competition ---
  for (const o of offerings) {                                // S-same-offering
    const ss = sellers(o.id);
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++)
      add('competition', ss[i], ss[j], 'S-same-offering', `${name(ss[i])}和${name(ss[j])}都賣${o.name}。`, [o.id, o.id], { seg: segsOf(o.id)[0] });
  }
  const pairsIn = (m: Map<string, string[]>, rule: string, say: (a: string, b: string, grp: string) => string, grpKey: 'cat' | 'seg' | 'tech') => {
    for (const [grp, os] of m) for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) {
      const a = os[i], b = os[j];
      if (assessed.has(pair(a, b))) continue;
      const seg = grpKey === 'seg' ? grp : segsOf(a).find(s => segsOf(b).includes(s)) ?? segsOf(a)[0] ?? segsOf(b)[0];
      for (const ca of sellers(a)) for (const cb of sellers(b)) add('competition', ca, cb, rule, say(a, b, grp), [a, b], { [grpKey]: grp, seg });
    }
  };
  pairsIn(byCat, 'S-same-category', (a, b, c) => `${name(a)}和${name(b)}都屬於「${name(c)}」。`, 'cat');
  pairsIn(bySeg, 'S-same-segment', (a, b, s) => `${name(a)}和${name(b)}都在「${name(s)}」市場。`, 'seg');
  // A technology's provider supplies, rather than competes with, the companies building on it.
  const providers = new Map<string, Set<string>>();
  for (const e of g.edges) if (e.predicate === 'PROVIDES_TECHNOLOGY') (providers.get(e.to) ?? providers.set(e.to, new Set()).get(e.to)!).add(e.from);
  const byTechNoProvider = new Map([...byTech].map(([t, os]) => [t, os.filter(o => !sellers(o).some(c => providers.get(t)?.has(c)))]));
  pairsIn(byTechNoProvider, 'S-shared-technology', (a, b, t) => `${name(a)}和${name(b)}都使用${name(t)}。`, 'tech');

  // --- Supply ---
  for (const e of g.edges.filter(x => x.predicate === 'PROVIDES_TECHNOLOGY')) {   // S-technology-provider
    const provider = e.from, tech = e.to;
    const providerOffering = offerings.find(o => sellers(o.id).includes(provider) && out(o.id, 'USES_TECHNOLOGY').includes(tech))?.id ?? null;
    for (const o of byTech.get(tech) ?? []) for (const s of sellers(o)) if (s !== provider)
      add('supply', provider, s, 'S-technology-provider', `${name(s)}的${name(o)}使用${name(tech)}，由${name(provider)}提供。`, [providerOffering, o], { tech, seg: segsOf(o)[0] });
  }
  const inSeg = new Map<string, Set<string>>();
  for (const e of all) if (e.predicate === 'ACTIVE_IN_SEGMENT') (inSeg.get(e.to) ?? inSeg.set(e.to, new Set()).get(e.to)!).add(e.from);
  const offeringIn = (co: string, seg: string) => offerings.find(o => sellers(o.id).includes(co) && segsOf(o.id).includes(seg))?.id ?? null;
  for (const e of g.edges.filter(x => x.predicate === 'FEEDS_SEGMENT')) {         // S-value-chain
    for (const a of inSeg.get(e.from) ?? []) for (const b of inSeg.get(e.to) ?? [])
      add('supply', a, b, 'S-value-chain', `${name(a)}在「${name(e.from)}」，供料給${name(b)}所在的「${name(e.to)}」。`, [offeringIn(a, e.from), offeringIn(b, e.to)], { seg: e.from });
  }

  for (const s of acc.values()) {
    const ws = s.rules.map(r => STRENGTH[r] ?? 0.3).sort((x, y) => y - x);
    s.strength = Math.min(0.95, Math.round((ws[0] + 0.05 * (ws.length - 1)) * 100) / 100);
  }
  return [...acc.values()].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}

/** Suggestions as map links (dotted on the galaxy). */
export function suggestionEdges(sugs: Suggestion[]): GraphEdge[] {
  return sugs.map(s => ({ id: `suggested:${s.id}`, predicate: s.kind === 'competition' ? 'POSSIBLE_COMPETITOR' : 'POSSIBLE_SUPPLIER', from: s.from, to: s.to,
    suggested: true, derived: true, symmetric: s.kind === 'competition', attributes: { verification_status: 'suggested', strength: s.strength, suggestion_id: s.id, reasons: s.reasons, rules: s.rules } }));
}
export function withSuggestions<T extends Graph>(g: T, sugs = computeSuggestions(g)): T {
  return { ...g, edges: [...g.edges, ...suggestionEdges(sugs)] };
}

/** The write operations a curator's "accept" performs (validated by lib/write.ts). Returns an error when the data is not ready. */
export function recordFor(g: Graph, s: Suggestion, at_: string): { ops: WriteOp[]; recordId: string } | { error: string } {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const out = (id: string, p: string) => g.edges.filter(e => e.from === id && e.predicate === p).map(e => e.to);
  // Cite what supports each side: evidence on the companies and offerings, and on the links that tie them together.
  const ends = [s.offerings[0], s.offerings[1], s.from, s.to].filter(Boolean) as string[];
  const ev = [...new Set([...ends.flatMap(id => atList(by.get(id), 'evidence_ids')),
    ...g.edges.filter(e => !e.derived && ((SELLER_PREDICATES.has(e.predicate) && s.offerings.includes(e.to)) || (['USES_TECHNOLOGY', 'IN_CATEGORY', 'TARGETS_SEGMENT'].includes(e.predicate) && s.offerings.includes(e.from)))).flatMap(e => atList(e, 'evidence_ids'))])].filter(id => by.get(id)?.type === 'Evidence').slice(0, 8);
  if (!ev.length) return { error: '兩邊的公司或商品都沒有可引用的證據，請先補證據。' };
  const day = at_.slice(0, 10);
  const curation = { method: 'suggestion_accepted', suggestion_id: s.id, rules: s.rules, rationale: s.reasons.join(' '), confidence: s.strength >= 0.7 ? 'medium' : 'low', at: at_ };
  const slug = s.id.replace(/^sugg:(competition|supply):/, '').replace(/company:/g, '').replace(/[^A-Za-z0-9:-]+/g, '-').slice(0, 90);
  const isOffering = (id: string | null) => !!id && isA(g.entityTypes, by.get(id)?.type, 'Offering');
  const edge = (recordId: string, predicate: string, to: string): WriteOp => ({ op: 'createEdge', edge: { predicate, from: recordId, to, attributes: { verification_status: 'inferred', evidence_ids: ev } } });
  const nm = (id: string | null | undefined) => (id ? by.get(id)?.name ?? id : '?');
  if (s.kind === 'competition') {
    const recordId = `competition:${slug}`;
    if (by.has(recordId)) return { error: '這個建議已經接受過了。' };
    const [a, b] = s.offerings;
    if (!a || !b) return { error: '兩家公司都需要有可比較的商品。' };
    if (!isOffering(a) || !isOffering(b)) return { error: '業務線不能做產品比較：請先記錄雙方的具體產品或服務，再接受。' };
    if (a === b) return { error: '兩家公司賣的是同一個商品節點。請先拆成各自的商品，再接受。' };
    const seg = s.segmentId ?? out(a, 'TARGETS_SEGMENT')[0] ?? out(b, 'TARGETS_SEGMENT')[0];
    if (!seg) return { error: '請先把至少一個商品放進市場區隔。' };
    const direct = s.rules.some(r => r !== 'S-shared-technology');
    const scope = s.rules.includes('S-same-category') ? 'product_category' : s.rules.includes('S-same-segment') || s.rules.includes('S-same-offering') ? 'market' : 'unspecified';
    const ops: WriteOp[] = [{ op: 'createNode', node: { id: recordId, type: 'CompetitionAssessment', name: `${nm(a)} 對 ${nm(b)}`, attributes: {
      competition_type: direct ? 'DIRECT' : 'INDIRECT', overlap_scope: scope, basis: s.reasons, commercial_competition_verified: false,
      verification_status: 'inferred', evidence_ids: ev, as_of: day, notes: '由系統建議接受；請以同時提到兩個商品的來源確認。', curation } } },
      edge(recordId, 'OFFERING_A', a), edge(recordId, 'OFFERING_B', b), edge(recordId, 'COMPETES_IN_SEGMENT', seg)];
    if (s.categoryId) ops.push(edge(recordId, 'COMPETES_IN_CATEGORY', s.categoryId));
    return { ops, recordId };
  }
  const recordId = `supply:${slug}`;
  if (by.has(recordId)) return { error: '這個建議已經接受過了。' };
  const supplied = isOffering(s.offerings[0]) ? s.offerings[0] : null;
  const service = supplied ? by.get(supplied)?.type === 'Service' : false;
  const ops: WriteOp[] = [{ op: 'createNode', node: { id: recordId, type: 'SupplyRelationship', name: `${nm(s.from)}供應${nm(s.to)}${supplied ? `・${nm(supplied)}` : ''}（可能）`, attributes: {
    stage: 'prospect', offering_kind: supplied ? (service ? 'service' : 'product') : 'unspecified',
    verification_status: 'inferred', evidence_ids: ev, as_of: day, notes: '由系統建議接受：潛在供應商，不是確定客戶。', curation } } },
    edge(recordId, 'HAS_SUPPLIER', s.from), edge(recordId, 'HAS_BUYER', s.to)];
  if (supplied) ops.push(edge(recordId, service ? 'FOR_SUPPLIED_SERVICE' : 'FOR_SUPPLIED_PRODUCT', supplied));
  return { ops, recordId };
}
