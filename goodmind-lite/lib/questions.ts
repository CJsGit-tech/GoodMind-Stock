// Query templates for the three competency questions (see COMPETENCY_QUESTIONS in lib/ontology.ts).
// They read the relationship RECORDS (not the projected links), apply the answer_mapping rules,
// and return structured, citable answers that the LLM only has to phrase.
import type { Graph, GraphNode } from './types';
import { at, atList } from './types';
import type { Rule } from './ontology';
import { computeSuggestions } from './suggest';

/** Suggested (unverified) links for a company, from shared groups — never mixed with recorded facts. */
function possible(g: Graph, id: string, kind: 'competition' | 'supply') {
  const by = new Map(g.nodes.map(n => [n.id, n.name]));
  return computeSuggestions(g).filter(s => s.kind === kind && (s.from === id || s.to === id) && s.strength >= 0.5).slice(0, 6)
    .map(s => ({ suggestion: s.id, other: { id: s.from === id ? s.to : s.from, name: by.get(s.from === id ? s.to : s.from) }, direction: kind === 'supply' ? (s.from === id ? 'may supply them' : 'may supply us') : 'may compete', strength: s.strength, reasons: s.reasons }));
}

type Ref = { id: string; name: string; type: string };
const evidenceOf = (g: Graph, n: GraphNode) => {
  const by = new Map(g.nodes.map(x => [x.id, x]));
  return atList(n, 'evidence_ids').map(i => by.get(i)).filter(Boolean)
    .map(e => ({ id: e!.id, title: e!.name, url: at(e, 'url'), publisher: at(e, 'publisher'), publishedAt: at(e, 'published_at') ?? null, dated: !!(at(e, 'published_at') || at(e, 'last_verified_at')) }));
};
function ctx(g: Graph) {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const ref = (id: string): Ref => { const n = by.get(id); return { id, name: n?.name ?? id, type: n?.type ?? '?' }; };
  const out = (id: string, p: string) => g.edges.filter(e => e.from === id && e.predicate === p);
  const into = (id: string, p: string) => g.edges.filter(e => e.to === id && e.predicate === p);
  const mapping = (question: string, cls: string) => {
    const r = ((g.rules as Rule[]) ?? []).find(x => x.kind === 'answer_mapping' && x.question === question && x.class === cls);
    return (v: unknown) => (r && r.kind === 'answer_mapping' ? r.map[String(v ?? 'unspecified')] ?? String(v) : String(v ?? 'unspecified'));
  };
  /** A company resolves to itself plus the products/services it sells, brands or offers. */
  const offeringsOf = (companyId: string) => ['SELLS', 'BRANDS', 'OFFERS_SERVICE'].flatMap(p => out(companyId, p).map(e => e.to));
  const sellersOf = (offeringId: string) => [...new Set(['SELLS', 'BRANDS', 'OFFERS_SERVICE'].flatMap(p => into(offeringId, p).map(e => e.from)))];
  return { by, ref, out, into, mapping, offeringsOf, sellersOf };
}

/** Q1 誰跟誰競爭？ — direct same-market rivals vs. partial overlap. */
export function competitorsOf(g: Graph, id: string) {
  const c = ctx(g), subject = c.by.get(id);
  if (!subject) return { found: false as const };
  const scopeLabel = c.mapping('competition', 'CompetitionAssessment');
  const mine = new Set(subject.type === 'Company' ? c.offeringsOf(id) : [id]);
  const rows = g.nodes.filter(n => n.type === 'CompetitionAssessment').flatMap(a => {
    const [x] = c.out(a.id, 'OFFERING_A').map(e => e.to), [y] = c.out(a.id, 'OFFERING_B').map(e => e.to);
    if (!x || !y || !(mine.has(x) || mine.has(y))) return [];
    const ours = mine.has(x) ? x : y, theirs = ours === x ? y : x;
    const where = [...c.out(a.id, 'COMPETES_IN_SEGMENT'), ...c.out(a.id, 'COMPETES_IN_CATEGORY'), ...c.out(a.id, 'COMPETES_ON_APPLICATION')].map(e => c.ref(e.to));
    return [{
      assessment: c.ref(a.id), ourOffering: c.ref(ours), theirOffering: c.ref(theirs),
      rivals: c.sellersOf(theirs).filter(s => s !== id).map(c.ref),
      competitionType: at(a, 'competition_type'), overlapScope: at(a, 'overlap_scope') ?? 'unspecified', meaning: scopeLabel(at(a, 'overlap_scope')),
      where, basis: at(a, 'basis'), verification: at(a, 'verification_status'), commerciallyVerified: at(a, 'commercial_competition_verified') === true,
      evidence: evidenceOf(g, a),
    }];
  });
  return {
    found: true as const, subject: c.ref(id),
    directSameMarket: rows.filter(r => r.competitionType === 'DIRECT' && r.overlapScope === 'market'),
    partialOverlap: rows.filter(r => r.overlapScope !== 'unspecified' && !(r.competitionType === 'DIRECT' && r.overlapScope === 'market')),
    scopeNotCurated: rows.filter(r => r.overlapScope === 'unspecified'),   // never guessed into either bucket
    possible: possible(g, id, 'competition'),                              // suggested only: NOT recorded facts
    note: 'Competition assessments are scoped analyses, not proof of head-to-head bids unless commerciallyVerified is true.',
  };
}

/** Q2 誰供應給誰？ — what is supplied, and potential vs confirmed. */
export function supplyChainOf(g: Graph, id: string, direction: 'customers' | 'suppliers' | 'both' = 'both') {
  const c = ctx(g);
  if (!c.by.has(id)) return { found: false as const };
  const supplyLabel = c.mapping('supply', 'SupplyRelationship'), oppLabel = c.mapping('supply', 'CustomerOpportunity');
  const rows = [
    ...g.nodes.filter(n => n.type === 'SupplyRelationship').map(r => ({ r, seller: c.out(r.id, 'HAS_SUPPLIER')[0]?.to, buyer: c.out(r.id, 'HAS_BUYER')[0]?.to,
      offerings: [...c.out(r.id, 'FOR_SUPPLIED_PRODUCT'), ...c.out(r.id, 'FOR_SUPPLIED_SERVICE')].map(e => c.ref(e.to)), certainty: supplyLabel(at(r, 'stage')) })),
    ...g.nodes.filter(n => n.type === 'CustomerOpportunity').map(r => ({ r, seller: c.out(r.id, 'PROSPECTIVE_SELLER')[0]?.to, buyer: c.out(r.id, 'TARGET_CUSTOMER')[0]?.to,
      offerings: c.out(r.id, 'PROPOSED_PRODUCT').map(e => c.ref(e.to)), certainty: oppLabel(at(r, 'stage')) })),
  ].filter(x => (direction !== 'suppliers' && x.seller === id) || (direction !== 'customers' && x.buyer === id))
    .map(x => ({
      record: c.ref(x.r.id), recordType: x.r.type, supplier: x.seller ? c.ref(x.seller) : null, buyer: x.buyer ? c.ref(x.buyer) : null,
      offerings: x.offerings, offeringKind: at(x.r, 'offering_kind') ?? 'unspecified', stage: at(x.r, 'stage') ?? 'unspecified', certainty: x.certainty,
      verification: at(x.r, 'verification_status'), notes: at(x.r, 'notes'), evidence: evidenceOf(g, x.r),
    }));
  return {
    found: true as const, subject: c.ref(id),
    customers: rows.filter(r => r.supplier?.id === id), suppliers: rows.filter(r => r.buyer?.id === id),
    possible: possible(g, id, 'supply'),                                   // suggested only: NOT recorded facts
    note: 'HAS_BUYER is the immediate buyer, not necessarily the end customer. Opportunities are never confirmed customers.',
  };
}

/** Q3 誰和誰合作？ — what was announced, scope, and current stage. */
export function collaborationsOf(g: Graph, id: string) {
  const c = ctx(g);
  if (!c.by.has(id)) return { found: false as const };
  const rows = g.nodes.filter(n => n.type === 'Collaboration' && c.out(n.id, 'HAS_PARTICIPANT').some(e => e.to === id)).map(n => ({
    record: c.ref(n.id), type: at(n, 'collaboration_type') ?? 'unspecified', stage: at(n, 'stage') ?? at(n, 'status') ?? 'unspecified',
    announcedAt: at(n, 'announced_at') ?? null, scope: at(n, 'scope') ?? null,
    participants: c.out(n.id, 'HAS_PARTICIPANT').map(e => ({ ...c.ref(e.to), role: at(e, 'role') ?? 'unspecified' })),
    focus: [...c.out(n.id, 'FOCUSES_ON_PRODUCT'), ...c.out(n.id, 'FOCUSES_ON_TECHNOLOGY'), ...c.out(n.id, 'TARGETS_MARKET')].map(e => c.ref(e.to)),
    verification: at(n, 'verification_status'), notes: at(n, 'notes'), evidence: evidenceOf(g, n),
  }));
  return { found: true as const, subject: c.ref(id), collaborations: rows };
}
