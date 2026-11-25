// Connection paths between two nodes, used by the detail panel.
import type { Graph, GraphEdge } from './types';
import { at } from './types';

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
