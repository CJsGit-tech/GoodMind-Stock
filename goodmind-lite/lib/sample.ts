// Opening view: a small, seeded sample of the graph instead of everything.
// Pick N industries (weighted by how many connected companies they hold), K companies in each (weighted by
// their company-level relations), then walk company-to-company relations up to `depth` hops. Products and
// segments are added only for the seed companies. The whole view never exceeds `maxNodes`.
// The same seed always gives the same view, so a reload or a shared link shows the same set.
import type { Graph, GraphEdge } from './types';
import { groupMembers } from './groups';
import { OWNER_PREDICATES } from './derive';

export type SampleOptions = { industries: number; perIndustry: number; depth: number; maxNodes: number; seed: string };
export const SAMPLE_DEFAULTS: Omit<SampleOptions, 'seed'> = { industries: 3, perIndustry: 5, depth: 2, maxNodes: 100 };
export type Sample = {
  nodeIds: Set<string>;
  industries: string[];     // picked industries
  seeds: string[];          // picked companies
  byDepth: string[][];      // companies reached at depth 1, 2, …
  truncated: boolean;       // true when the cap cut something
  cluster: Map<string, string>;  // node → the picked industry it belongs to (seeds, their context, and companies reached from them)
};

/** Company-to-company relations used for depth (recorded or computed from records; suggestions excluded). */
export const COMPANY_LINKS = new Set(['DIRECT_COMPETITOR_OF', 'INDIRECT_COMPETITOR_OF', 'COLLABORATES_WITH', 'SUPPLIES_TO', 'MAY_SUPPLY_TO', 'IS_SUBSIDIARY_OF', 'CONTROLS', 'OWNS_STAKE_IN']);

/** Small deterministic random generator (mulberry32) seeded from a string. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Weighted sampling without replacement. Items with weight 0 are only used once everything else is taken. */
function pickWeighted<T>(items: T[], weight: (x: T) => number, n: number, rand: () => number): T[] {
  const pool = items.map(x => ({ x, w: Math.max(0, weight(x)) })), out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let i = 0;
    if (total <= 0) i = Math.floor(rand() * pool.length);
    else { let r = rand() * total; while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++; }
    out.push(pool[i].x); pool.splice(i, 1);
  }
  return out;
}

/** g must already include computed edges (withDerived). */
export function sampleGraph(g: Graph, o: SampleOptions): Sample {
  const rand = rng(o.seed);
  const type = new Map(g.nodes.map(n => [n.id, n.type]));
  const adj = new Map<string, Set<string>>();
  for (const e of g.edges) {
    if (!COMPANY_LINKS.has(e.predicate) || e.suggested || type.get(e.from) !== 'Company' || type.get(e.to) !== 'Company') continue;
    (adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)!).add(e.to);
    (adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)!).add(e.from);
  }
  const degree = (c: string) => adj.get(c)?.size ?? 0;
  const industries = g.nodes.filter(n => n.type === 'Industry').map(n => ({ id: n.id, companies: [...groupMembers(g, n.id)].filter(x => type.get(x) === 'Company').sort() }));
  const pickedInd = pickWeighted(industries.filter(i => i.companies.length), i => i.companies.filter(c => degree(c) > 0).length + 0.25 * i.companies.length, o.industries, rand);

  const seeds: string[] = [], cluster = new Map<string, string>();
  for (const ind of pickedInd) {
    cluster.set(ind.id, ind.id);
    const cands = ind.companies.filter(c => !seeds.includes(c));
    const got = pickWeighted(cands, c => (degree(c) > 0 ? degree(c) + 1 : 0.15), o.perIndustry, rand);
    got.forEach(c => cluster.set(c, ind.id)); seeds.push(...got);
  }
  // Company-level breadth-first walk.
  const seen = new Set(seeds), byDepth: string[][] = [];
  let frontier = [...seeds];
  for (let d = 0; d < o.depth && frontier.length; d++) {
    const next: string[] = [];
    for (const c of frontier) for (const x of [...(adj.get(c) ?? [])].sort()) if (!seen.has(x)) { seen.add(x); next.push(x); cluster.set(x, cluster.get(c)!); }   // a reached company joins the cluster that reached it first
    byDepth.push(next); frontier = next;
  }
  // Context for the seeds only: the segment(s) that tie them to the picked industries, and up to 2 offerings each.
  const out = (id: string, ps: Set<string> | string[]) => g.edges.filter(e => e.from === id && (Array.isArray(ps) ? ps.includes(e.predicate) : ps.has(e.predicate)) && !e.suggested).map(e => e.to);
  const segs: string[] = [], offers: string[] = [];
  for (const c of seeds) {
    for (const s of out(c, ['ACTIVE_IN_SEGMENT']).slice(0, 2)) if (!segs.includes(s)) { segs.push(s); cluster.set(s, cluster.get(c)!); }
    for (const p of [...out(c, OWNER_PREDICATES), ...out(c, ['OPERATES_BUSINESS_LINE'])].slice(0, 2)) if (!offers.includes(p)) { offers.push(p); cluster.set(p, cluster.get(c)!); }
  }
  // Fill in priority order until the cap.
  const nodeIds = new Set<string>();
  const ordered = [...pickedInd.map(i => i.id), ...seeds, ...segs, ...byDepth.flat(), ...offers];
  for (const id of ordered) { if (nodeIds.size >= o.maxNodes) break; nodeIds.add(id); }
  return { nodeIds, industries: pickedInd.map(i => i.id), seeds, byDepth, truncated: ordered.filter((x, i, a) => a.indexOf(x) === i).length > nodeIds.size, cluster };
}

/** Keeps at most `max` nodes: `keep` first, then the most connected. Returns the kept ids and how many existed. */
export function capNodes(nodeIds: string[], edges: GraphEdge[], max: number, keep: Set<string> | null = null): { ids: Set<string>; total: number } {
  if (nodeIds.length <= max) return { ids: new Set(nodeIds), total: nodeIds.length };
  const inView = new Set(nodeIds), deg = new Map<string, number>();
  for (const e of edges) if (inView.has(e.from) && inView.has(e.to)) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
  const ranked = [...nodeIds].sort((a, b) => Number(keep?.has(b) ?? 0) - Number(keep?.has(a) ?? 0) || (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b));
  return { ids: new Set(ranked.slice(0, max)), total: nodeIds.length };
}
