// Read-only query layer over the graph. Used by the chat agent's tools and its offline fallback.
import type { Graph, GraphEdge, GraphNode } from './types';
import { at, atList, relLabel, typeLabel } from './types';

const norm = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase();
export const nodeLabel = (n: GraphNode) => n.name;

/** Tokens: latin words plus 2–4 char n-grams of CJK runs, so "凌華的競爭對手" still hits "凌華 ADLINK". */
export function tokenize(q: string): string[] {
  const s = norm(q), out = new Set<string>();
  for (const w of s.match(/[a-z0-9][a-z0-9\-.]*/g) ?? []) if (w.length >= 2) out.add(w);
  for (const run of s.match(/[㐀-鿿]+/g) ?? [])
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n));
  return [...out];
}

export function searchNodes(g: Graph, query: string, opts: { types?: string[] | null; limit?: number } = {}) {
  const limit = opts.limit ?? 10, tokens = tokenize(query);
  const typeSet = opts.types?.length ? new Set(opts.types) : null;
  const scored = g.nodes
    .filter(n => !typeSet || typeSet.has(n.type))
    .map(n => {
      const hay = norm(`${n.name} ${n.id} ${at(n, 'name_en') ?? ''} ${atList(n, 'aliases').join(' ')} ${at(n, 'ticker') ?? ''}`);
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score += t.length;      // longer match = stronger
      if (norm(query).trim() && hay.includes(norm(query).trim())) score += 20;
      return { n, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return { total: scored.length, nodes: scored.slice(0, limit).map(x => x.n) };
}

export function getNode(g: Graph, id: string) { return g.nodes.find(n => n.id === id) ?? null; }

export function getNeighbors(g: Graph, id: string, o: { predicate?: string | null; direction?: 'in' | 'out' | 'both'; limit?: number } = {}) {
  const dir = o.direction ?? 'both', byId = new Map(g.nodes.map(n => [n.id, n]));
  const edges = g.edges.filter(e =>
    (!o.predicate || e.predicate === o.predicate) &&
    ((dir !== 'in' && e.from === id) || (dir !== 'out' && e.to === id)));
  const used = edges.slice(0, o.limit ?? 25);
  const nodes = [...new Set(used.flatMap(e => [e.from, e.to]))].map(i => byId.get(i)).filter((n): n is GraphNode => !!n);
  return { total: edges.length, edges: used, nodes };
}

export function findPath(g: Graph, from: string, to: string, maxDepth = 3) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return { found: false, nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
  const prev = new Map<string, { id: string; edge: GraphEdge }>(), seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length && !seen.has(to); d++) {
    const next: string[] = [];
    for (const cur of frontier) for (const e of g.edges) {
      if (e.from !== cur && e.to !== cur) continue;
      const o = e.from === cur ? e.to : e.from;
      if (seen.has(o)) continue;
      seen.add(o); prev.set(o, { id: cur, edge: e }); next.push(o);
    }
    frontier = next;
  }
  if (!seen.has(to)) return { found: false, nodes: [], edges: [] };
  const ids = [to], edges: GraphEdge[] = [];
  for (let c = to; c !== from;) { const p = prev.get(c)!; edges.unshift(p.edge); ids.unshift(p.id); c = p.id; }
  return { found: true, nodes: ids.map(i => byId.get(i)!), edges };
}

export function summary(g: Graph) {
  const count = <T,>(xs: T[], k: (x: T) => string) => Object.entries(xs.reduce<Record<string, number>>((m, x) => (m[k(x)] = (m[k(x)] || 0) + 1, m), {}));
  return {
    nodes: g.nodes.length, edges: g.edges.length,
    nodeTypes: count(g.nodes, n => n.type).map(([name, count]) => ({ name, label: typeLabel(g.entityTypes, name), count })),
    relations: count(g.edges, e => e.predicate).map(([name, count]) => ({ name, label: relLabel(g.edgeTypes, name), count })),
    allowedRelations: g.edgeTypes.map(p => `${p.predicate}（${p.label}）: ${p.from.join('/')} → ${p.to.join('/')} — ${p.meaning}`),
  };
}

/** Compact record for the model: curated fields only, evidence resolved to titles/urls. */
export function describeNode(g: Graph, n: GraphNode) {
  const byId = new Map(g.nodes.map(x => [x.id, x]));
  const { evidence_ids: _ev, legacy_ids: _l, curation: _c, ...rest } = n.attributes;
  const ev = atList(n, 'evidence_ids').map(i => byId.get(i)).filter(Boolean)
    .map(e => ({ name: e!.name, url: at(e, 'url'), publisher: at(e, 'publisher'), published_at: at(e, 'published_at') }));
  return { id: n.id, type: n.type, typeLabel: typeLabel(g.entityTypes, n.type), name: n.name, attributes: rest, evidence: ev };
}
export function describeEdge(g: Graph, e: GraphEdge) {
  const byId = new Map(g.nodes.map(x => [x.id, x]));
  return { id: e.id, relation: e.predicate, relationLabel: relLabel(g.edgeTypes, e.predicate), from: byId.get(e.from)?.name, to: byId.get(e.to)?.name,
    fromId: e.from, toId: e.to, verification: at(e, 'verification_status') ?? 'reported' };
}

// ---- Ranked connection paths ----
/** Confidence weight per verification status (used to rank paths; a heuristic, not a probability). */
export const STATUS_WEIGHT: Record<string, number> = { verified: 1, reported: 0.7, inferred: 0.55, suggested: 0.3, disputed: 0.1 };
export type RankedPath = { nodeIds: string[]; edges: GraphEdge[]; score: number };

/** All simple paths up to maxDepth hops (either direction), ranked by product of edge confidence. */
export function findPaths(g: Graph, from: string, to: string, maxDepth = 3, limit = 8): RankedPath[] {
  if (from === to) return [];
  const adj = new Map<string, GraphEdge[]>();
  for (const e of g.edges) { (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e); }
  const found: RankedPath[] = [];
  const walk = (cur: string, nodes: string[], edges: GraphEdge[], score: number) => {
    if (found.length > 400) return;
    if (cur === to) { found.push({ nodeIds: nodes, edges, score }); return; }
    if (edges.length >= maxDepth) return;
    for (const e of adj.get(cur) ?? []) {
      const next = e.from === cur ? e.to : e.from;
      if (nodes.includes(next)) continue;
      const w = STATUS_WEIGHT[String(at(e, 'verification_status') ?? 'reported')] ?? 0.4;
      if (w === 0) continue;
      walk(next, [...nodes, next], [...edges, e], score * w);
    }
  };
  walk(from, [from], [], 1);
  return found.sort((a, b) => b.score - a.score || a.edges.length - b.edges.length).slice(0, limit);
}
