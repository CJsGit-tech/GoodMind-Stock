// Computed ("derived") relations. Never stored: projected from relationship records (CompetitionAssessment,
// Collaboration, SupplyRelationship, CustomerOpportunity) and from offerings / business lines each time the
// graph is read. Every projection keeps its origin record ids (attributes.source_records).
import type { Graph, GraphEdge, GraphNode } from './types';
import { at, atList, atStr } from './types';

export const SELLER_PREDICATES = new Set(['SELLS', 'BRANDS', 'OFFERS_SERVICE']);
/** Who an offering belongs to for grouping: sellers plus makers (a maker is active in the offering's segment). */
export const OWNER_PREDICATES = new Set([...SELLER_PREDICATES, 'MANUFACTURES', 'DESIGNS']);
const POTENTIAL_SUPPLY = new Set(['prospect', 'qualified', 'sampling']);

export function deriveEdges(g: Graph): GraphEdge[] {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const out = (id: string, p: string) => g.edges.filter(e => e.from === id && e.predicate === p).map(e => e.to);
  const sellers = (productId: string) => g.edges.filter(e => e.to === productId && SELLER_PREDICATES.has(e.predicate) && byId.get(e.from)?.type === 'Company').map(e => e.from);
  const derived = new Map<string, GraphEdge>();
  const pairKey = (p: string, a: string, b: string) => `derived:${p}:${[a, b].sort().join('|')}`;
  const add = (p: string, a: string, b: string, src: GraphNode, extra: Record<string, unknown> = {}, symmetric = true) => {
    const id = symmetric ? pairKey(p, a, b) : `derived:${p}:${a}|${b}`;
    const prev = derived.get(id);
    if (prev) { (prev.attributes.source_records as string[]).push(src.id); return; }
    derived.set(id, { id, predicate: p, from: a, to: b, derived: true, symmetric, attributes: { source_records: [src.id],
      verification_status: at(src, 'verification_status') ?? 'reported', evidence_ids: atList(src, 'evidence_ids'), ...extra } });
  };
  for (const n of g.nodes) {
    if (n.type === 'CompetitionAssessment') {
      const [a] = out(n.id, 'OFFERING_A'), [b] = out(n.id, 'OFFERING_B'), [seg] = out(n.id, 'COMPETES_IN_SEGMENT');
      if (!a || !b || a === b) continue;
      const direct = at(n, 'competition_type') === 'DIRECT', scope = atStr(n, 'overlap_scope', 'unspecified');
      add(direct ? 'DIRECTLY_COMPETES_WITH' : 'INDIRECTLY_COMPETES_WITH', a, b, n, { market_segment_id: seg, overlap_scope: scope });
      for (const ca of sellers(a)) for (const cb of sellers(b)) if (ca !== cb)
        add(direct ? 'DIRECT_COMPETITOR_OF' : 'INDIRECT_COMPETITOR_OF', ca, cb, n, { market_segment_id: seg, overlap_scope: scope, via_products: [a, b] });
    }
    if (n.type === 'Collaboration') {
      const ps = [...new Set(out(n.id, 'HAS_PARTICIPANT'))].filter(id => byId.get(id)?.type === 'Company');
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++)
        add('COLLABORATES_WITH', ps[i], ps[j], n, { stage: atStr(n, 'stage', 'unspecified'), lifecycle_status: at(n, 'lifecycle_status'), collaboration_type: atStr(n, 'collaboration_type', 'unspecified') });
    }
    // Rule R-derive-supply: the stage decides confirmed vs potential.
    if (n.type === 'SupplyRelationship') {
      const [s] = out(n.id, 'HAS_SUPPLIER'), [b] = out(n.id, 'HAS_BUYER'), stage = atStr(n, 'stage', 'unspecified');
      if (s && b && s !== b && stage !== 'ended')
        add(POTENTIAL_SUPPLY.has(stage) ? 'MAY_SUPPLY_TO' : 'SUPPLIES_TO', s, b, n, { stage, offerings: [...out(n.id, 'FOR_SUPPLIED_PRODUCT'), ...out(n.id, 'FOR_SUPPLIED_SERVICE')] }, false);
    }
    if (n.type === 'CustomerOpportunity') {
      const [s] = out(n.id, 'PROSPECTIVE_SELLER'), stage = atStr(n, 'stage', 'unspecified');
      for (const b of out(n.id, 'TARGET_CUSTOMER'))
        if (s && b && s !== b && stage !== 'lost' && stage !== 'won') add('MAY_SUPPLY_TO', s, b, n, { stage, offerings: out(n.id, 'PROPOSED_PRODUCT') }, false);
    }
  }
  // Rule R-derive-groups: a company is active in every segment its offerings or business lines face.
  const asserted = new Set(g.edges.filter(e => e.predicate === 'ACTIVE_IN_SEGMENT').map(e => `${e.from}|${e.to}`));
  for (const o of g.nodes) {
    const segs = new Map<string, string>();   // segment → how it was reached
    for (const s of out(o.id, 'TARGETS_SEGMENT')) segs.set(s, 'TARGETS_SEGMENT');
    for (const s of out(o.id, 'BUSINESS_LINE_IN_SEGMENT')) segs.set(s, 'BUSINESS_LINE_IN_SEGMENT');
    for (const c of out(o.id, 'IN_CATEGORY')) for (const s of out(c, 'CATEGORY_IN_SEGMENT')) if (!segs.has(s)) segs.set(s, 'IN_CATEGORY');
    if (!segs.size) continue;
    const owners = [...new Set(g.edges.filter(e => e.to === o.id && (OWNER_PREDICATES.has(e.predicate) || e.predicate === 'OPERATES_BUSINESS_LINE') && byId.get(e.from)?.type === 'Company').map(e => e.from))];
    for (const co of owners) for (const [s, via] of segs) {
      if (asserted.has(`${co}|${s}`) || byId.get(s)?.type !== 'MarketSegment') continue;
      const id = `derived:ACTIVE_IN_SEGMENT:${co}|${s}`, prev = derived.get(id);
      if (prev) { (prev.attributes.via_offerings as string[]).push(o.id); (prev.attributes.source_records as string[]).push(o.id); continue; }
      derived.set(id, { id, predicate: 'ACTIVE_IN_SEGMENT', from: co, to: s, derived: true, symmetric: false, attributes: { source_records: [o.id], via_offerings: [o.id], via,
        verification_status: at(o, 'verification_status') ?? 'reported', evidence_ids: atList(o, 'evidence_ids') } });
    }
  }
  return [...derived.values()];
}

export function withDerived<T extends Graph>(g: T): T {
  return { ...g, edges: [...g.edges, ...deriveEdges(g)] };
}
