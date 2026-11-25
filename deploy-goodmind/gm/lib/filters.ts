import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../core/types';
import { at, atList } from '../core/types';

export type FilterState = { q: string; types: Set<string>; preds: Set<string>; statuses: Set<string>; hideIsolated: boolean; focusId: string | null; depth: 1 | 2; groupId: string | null };
export const STATUSES = ['verified', 'reported', 'inferred', 'suggested', 'disputed'];
export const edgeStatus = (e: GraphEdge) => String(at(e, 'verification_status') ?? 'reported');
/** Everything a node can be found by: Chinese name, English name, aliases, ticker, id. */
export const searchText = (n: GraphNode) => `${n.name} ${n.id} ${at(n, 'name_en') ?? ''} ${atList(n, 'aliases').join(' ')} ${at(n, 'ticker') ?? ''}`;

export function initialFilters(types: EntityType[], preds: EdgeType[]): FilterState {
  return { q: '', types: new Set(types.map(t => t.name).filter(t => t !== 'Evidence')), preds: new Set(preds.map(p => p.predicate)), statuses: new Set(STATUSES), hideIsolated: true, focusId: null, depth: 1, groupId: null };
}
export const toggle = (s: Set<string>, v: string) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
const norm = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase();

/** pinned = chat answer subset. When pinned, only those nodes (and edges among them) are shown.
 *  group = members of the chosen industry / segment / category (lib/groups.ts). */
export function applyFilters(nodes: GraphNode[], edges: GraphEdge[], f: FilterState, pinned: Set<string> | null, group: Set<string> | null = null) {
  const q = norm(f.q).trim();
  let reach: Set<string> | null = null;
  if (f.focusId) {
    reach = new Set([f.focusId]);
    for (let d = 0; d < f.depth; d++) { const cur = new Set(reach); edges.forEach(e => { if (cur.has(e.from)) reach!.add(e.to); if (cur.has(e.to)) reach!.add(e.from); }); }
  }
  let vn = nodes.filter(n =>
    pinned ? pinned.has(n.id)            // a chat answer / path is shown whole, regardless of type, focus or text filters
      : f.types.has(n.type) && (!reach || reach.has(n.id)) && (!group || group.has(n.id)) && (!q || norm(searchText(n)).includes(q)));
  const ids = new Set(vn.map(n => n.id));
  const ve = edges.filter(e => ids.has(e.from) && ids.has(e.to) && (pinned || f.preds.has(e.predicate)) && f.statuses.has(edgeStatus(e)));
  if (f.hideIsolated && !pinned && !q) {
    const used = new Set(ve.flatMap(e => [e.from, e.to]));
    vn = vn.filter(n => used.has(n.id) || n.id === f.focusId || n.id === f.groupId);
  }
  return { nodes: vn, edges: ve };
}

export function jumpMatches(nodes: GraphNode[], q: string, limit = 8) {
  const s = norm(q).trim(); if (!s) return [];
  return nodes.filter(n => norm(searchText(n)).includes(s)).slice(0, limit);
}
