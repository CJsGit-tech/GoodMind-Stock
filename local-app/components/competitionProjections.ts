import type { EdgeRecord, Graph } from './types';

const predicates = new Set([
  'DIRECTLY_COMPETES_WITH', 'INDIRECTLY_COMPETES_WITH',
  'DIRECT_COMPETITOR_OF', 'INDIRECT_COMPETITOR_OF',
]);
const statusOrder = [
  'officially_disclosed', 'corroborated', 'reported',
  'analyst_inferred', 'hypothesis', 'disputed',
];

/** Read-only, assessment-scoped views. Never pass these edges to the write API. */
export function withCompetitionProjections(source: Graph): Graph {
  const nodes = new Map(source.nodes.map(node => [node.id, node]));
  // Recompute rather than trusting stale materialized shortcuts.
  const base = source.edges.filter(edge => !predicates.has(edge.predicate));
  const derived: EdgeRecord[] = [];
  for (const assessment of source.nodes) {
    if (assessment.type !== 'CompetitionAssessment' ||
        assessment.verification_status === 'rejected' ||
        !['DIRECT', 'INDIRECT'].includes(String(assessment.competition_type))) continue;
    const links = base.filter(edge => edge.from === assessment.id);
    const one = (predicate: string, type: string) => {
      const matches = links.filter(edge => edge.predicate === predicate);
      return matches.length === 1 && matches[0].verification_status !== 'rejected' &&
        nodes.get(matches[0].to)?.type === type ? matches[0] : undefined;
    };
    const a = one('OFFERING_A', 'Product');
    const b = one('OFFERING_B', 'Product');
    const market = one('COMPETES_IN_SEGMENT', 'MarketSegment');
    if (!a || !b || !market || a.to === b.to) continue;
    const add = (predicate: string, from: string, to: string, support: EdgeRecord[]) => {
      if (from === to) return;
      const pair = [from, to].sort();
      const statuses = [assessment, ...support].map(record => String(record.verification_status || 'hypothesis'));
      const verification = statusOrder[Math.max(...statuses.map(status => {
        const rank = statusOrder.indexOf(status);
        return rank < 0 ? statusOrder.indexOf('hypothesis') : rank;
      }))];
      const evidenceIds = [...new Set([assessment, ...support].flatMap(record =>
        Array.isArray(record.evidence_ids) ? record.evidence_ids as string[] : []))];
      derived.push({
        ...assessment,
        id: `derived:${JSON.stringify([assessment.id, predicate, ...pair])}`,
        predicate, from: pair[0], to: pair[1], derived: true,
        symmetric: true, assessment_id: assessment.id,
        product_ids: [a.to, b.to], market_segment_id: market.to,
        supporting_edge_ids: support.map(edge => edge.id),
        verification_status: verification,
        assessment_status: assessment.verification_status || 'hypothesis',
        evidence_ids: evidenceIds,
      });
    };
    const direct = assessment.competition_type === 'DIRECT';
    add(direct ? 'DIRECTLY_COMPETES_WITH' : 'INDIRECTLY_COMPETES_WITH', a.to, b.to, [a, b, market]);
    const sellers = (product: string) => base.filter(edge =>
      ['SELLS', 'BRANDS'].includes(edge.predicate) && edge.to === product &&
      edge.verification_status !== 'rejected' && nodes.get(edge.from)?.type === 'Company');
    const pairs = new Map<string, EdgeRecord[]>();
    for (const left of sellers(a.to)) for (const right of sellers(b.to)) {
      if (left.from === right.from) continue;
      const pair = [left.from, right.from].sort();
      const key = JSON.stringify(pair);
      const support = pairs.get(key) || [];
      for (const edge of [left, right]) if (!support.some(item => item.id === edge.id)) support.push(edge);
      pairs.set(key, support);
    }
    for (const [key, support] of pairs) {
      const [from, to] = JSON.parse(key) as string[];
      add(direct ? 'DIRECT_COMPETITOR_OF' : 'INDIRECT_COMPETITOR_OF', from, to, [a, b, market, ...support]);
    }
  }
  return { ...source, edges: [...base, ...derived] };
}
