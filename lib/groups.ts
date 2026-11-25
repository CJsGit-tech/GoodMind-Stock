// Group tree helpers (ontology v2): Industry > MarketSegment > ProductCategory, and who sits in each group.
import type { Graph, GraphNode } from './types';
import { isA } from './types';
import { OWNER_PREDICATES as SELLER_PREDICATES } from './derive';

export type GroupTree = { industry: GraphNode; segments: { segment: GraphNode; categories: GraphNode[]; companies: number; offerings: number; feeds: string[] }[] }[];

const ins = (g: Graph, id: string, p: string) => g.edges.filter(e => e.to === id && e.predicate === p).map(e => e.from);
const outs = (g: Graph, id: string, p: string) => g.edges.filter(e => e.from === id && e.predicate === p).map(e => e.to);

/** Every node that belongs to a group (pass a graph that already includes derived edges). */
export function groupMembers(g: Graph, groupId: string): Set<string> {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const root = by.get(groupId); if (!root) return new Set();
  const segs = new Set<string>(), cats = new Set<string>();
  if (root.type === 'Industry') ins(g, groupId, 'SEGMENT_OF_INDUSTRY').forEach(s => segs.add(s));
  if (root.type === 'MarketSegment') segs.add(groupId);
  if (root.type === 'ProductCategory') cats.add(groupId);
  for (const s of segs) ins(g, s, 'CATEGORY_IN_SEGMENT').forEach(c => cats.add(c));
  const offerings = new Set<string>();
  for (const o of g.nodes) if (isA(g.entityTypes, o.type, 'Offering') && (outs(g, o.id, 'TARGETS_SEGMENT').some(s => segs.has(s)) || outs(g, o.id, 'IN_CATEGORY').some(c => cats.has(c)))) offerings.add(o.id);
  if (root.type !== 'ProductCategory') for (const o of g.nodes) if (o.type === 'BusinessLine' && outs(g, o.id, 'BUSINESS_LINE_IN_SEGMENT').some(s => segs.has(s))) offerings.add(o.id);
  const companies = new Set<string>();
  for (const e of g.edges) {
    if ((SELLER_PREDICATES.has(e.predicate) || e.predicate === 'OPERATES_BUSINESS_LINE') && offerings.has(e.to)) companies.add(e.from);
    if (e.predicate === 'ACTIVE_IN_SEGMENT' && segs.has(e.to) && root.type !== 'ProductCategory') companies.add(e.from);
  }
  const members = new Set([groupId, ...segs, ...cats, ...offerings, ...companies]);
  if (root.type === 'Industry') { /* keep the industry itself */ }
  else for (const s of segs) outs(g, s, 'SEGMENT_OF_INDUSTRY').forEach(i => members.add(i));
  // Relationship records that connect two members (competition, supply, collaboration) are part of the picture.
  for (const r of g.nodes.filter(n => ['CompetitionAssessment', 'SupplyRelationship', 'CustomerOpportunity', 'Collaboration'].includes(n.type))) {
    const linked = g.edges.filter(e => e.from === r.id && members.has(e.to)).length;
    if (linked >= 2) members.add(r.id);
  }
  return members;
}

/** Industries with their segments, categories, member counts and value-chain targets. */
export function groupTree(g: Graph): GroupTree {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const sellersOf = (o: string) => g.edges.filter(e => e.to === o && (SELLER_PREDICATES.has(e.predicate) || e.predicate === 'OPERATES_BUSINESS_LINE')).map(e => e.from);
  return g.nodes.filter(n => n.type === 'Industry').map(industry => ({
    industry,
    segments: ins(g, industry.id, 'SEGMENT_OF_INDUSTRY').map(id => by.get(id)!).filter(Boolean).map(segment => {
      const categories = ins(g, segment.id, 'CATEGORY_IN_SEGMENT').map(id => by.get(id)!).filter(Boolean);
      const offs = g.nodes.filter(o => (isA(g.entityTypes, o.type, 'Offering') && (outs(g, o.id, 'TARGETS_SEGMENT').includes(segment.id) || outs(g, o.id, 'IN_CATEGORY').some(c => categories.some(x => x.id === c)))) || (o.type === 'BusinessLine' && outs(g, o.id, 'BUSINESS_LINE_IN_SEGMENT').includes(segment.id)));
      const cos = new Set([...offs.flatMap(o => sellersOf(o.id)), ...ins(g, segment.id, 'ACTIVE_IN_SEGMENT')]);
      return { segment, categories, companies: cos.size, offerings: offs.length, feeds: outs(g, segment.id, 'FEEDS_SEGMENT') };
    }).sort((a, b) => b.companies - a.companies),
  })).filter(x => x.segments.length).sort((a, b) => b.segments.reduce((s, x) => s + x.companies, 0) - a.segments.reduce((s, x) => s + x.companies, 0));
}

/** Breadcrumb of groups a node sits in, e.g. 半導體 › 晶圓測試. */
export function groupsOf(g: Graph, id: string): { segment: GraphNode; industry?: GraphNode }[] {
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const n = by.get(id); if (!n) return [];
  let segs: string[] = [];
  if (n.type === 'Company') segs = outs(g, id, 'ACTIVE_IN_SEGMENT');
  else if (isA(g.entityTypes, n.type, 'Offering')) segs = [...outs(g, id, 'TARGETS_SEGMENT'), ...outs(g, id, 'IN_CATEGORY').flatMap(c => outs(g, c, 'CATEGORY_IN_SEGMENT'))];
  else if (n.type === 'BusinessLine') segs = outs(g, id, 'BUSINESS_LINE_IN_SEGMENT');
  else if (n.type === 'ProductCategory') segs = outs(g, id, 'CATEGORY_IN_SEGMENT');
  return [...new Set(segs)].map(s => ({ segment: by.get(s)!, industry: by.get(outs(g, s, 'SEGMENT_OF_INDUSTRY')[0] ?? '') })).filter(x => x.segment);
}
