// View model for graphs: API records plus positions. Positions come from one deterministic layout per graph version,
// so nodes do not jump between pages.
import type { GraphLink, GraphNode, NodeType } from '../shared/graph';

export type VType = NodeType | 'article';
export interface VNode { id: string; label: string; type: VType; x: number; y: number; px: number; py: number; aliases: string[]; big?: boolean; ghost?: boolean }
export type VEdge = [string, string, 'mention' | 'attr', boolean?];
export interface GraphView { version: number; nodes: VNode[]; edges: VEdge[] }
export interface PublicGraph { version: number; nodes: GraphNode[]; books: { id: string; title: string }[]; links: Pick<GraphLink, 'from' | 'to' | 'kind'>[] }

function place(ids: string[], edges: [string, string][], W: number, H: number) {
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const idx: Record<string, number> = {}; ids.forEach((id, i) => (idx[id] = i));
  const pos = ids.map((_, i) => ({ x: W / 2 + Math.cos(i * 2.4) * (60 + rnd() * 180), y: H / 2 + Math.sin(i * 2.4) * (40 + rnd() * 120) }));
  const k = Math.sqrt((W * H) / Math.max(ids.length, 1)) * 0.7, rounds = ids.length > 150 ? 120 : 500;
  for (let it = 0; it < rounds; it++) {
    const t = 14 * (1 - it / rounds) + 0.3, disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, d = Math.max(Math.hypot(dx, dy), 0.01), f = (k * k) / d;
      disp[i].x += (dx / d) * f; disp[i].y += (dy / d) * f; disp[j].x -= (dx / d) * f; disp[j].y -= (dy / d) * f;
    }
    edges.forEach(([a, b]) => {
      const i = idx[a], j = idx[b]; if (i === undefined || j === undefined) return;
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, d = Math.max(Math.hypot(dx, dy), 0.01), f = (d * d) / k;
      disp[i].x -= (dx / d) * f; disp[i].y -= (dy / d) * f; disp[j].x += (dx / d) * f; disp[j].y += (dy / d) * f;
    });
    pos.forEach((p, i) => {
      disp[i].x += (W / 2 - p.x) * 0.09; disp[i].y += (H / 2 - p.y) * 0.09;
      const m = Math.max(Math.hypot(disp[i].x, disp[i].y), 0.01);
      p.x = Math.min(W - 90, Math.max(90, p.x + (disp[i].x / m) * Math.min(m, t)));
      p.y = Math.min(H - 50, Math.max(50, p.y + (disp[i].y / m) * Math.min(m, t)));
    });
  }
  for (let it = 0; it < 200; it++) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { // keep labels apart
    const dx = pos[i].x - pos[j].x, dy = (pos[i].y - pos[j].y) * 1.5, d = Math.hypot(dx, dy);
    if (d < 92 && d > 0.01) { const push = (92 - d) / 2; pos[i].x += (dx / d) * push; pos[j].x -= (dx / d) * push; pos[i].y += ((dy / d) * push) / 1.5; pos[j].y -= ((dy / d) * push) / 1.5; }
    pos[i].x = Math.min(W - 80, Math.max(80, pos[i].x)); pos[i].y = Math.min(H - 50, Math.max(50, pos[i].y));
  }
  return pos.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}
/** Lays out any set of nodes for a landscape (1000 × 620) and a portrait (640 × 900) frame. */
export function layout(items: { id: string; label: string; type: VType; aliases?: string[]; ghost?: boolean }[], links: { from: string; to: string; kind: 'mention' | 'attr'; ghost?: boolean }[], version = 0): GraphView {
  const ids = items.map(n => n.id), pairs = links.map(l => [l.from, l.to] as [string, string]);
  const wide = place(ids, pairs, 1000, 620), tall = place(ids, pairs, 640, 900);
  const degree: Record<string, number> = {}; pairs.forEach(([a, b]) => { degree[a] = (degree[a] || 0) + 1; degree[b] = (degree[b] || 0) + 1; });
  const top = Math.max(0, ...Object.values(degree));
  return { version, nodes: items.map((n, i) => ({ id: n.id, label: n.label, type: n.type, aliases: n.aliases || [], ghost: n.ghost, big: n.type !== 'article' && top >= 4 && degree[n.id] === top, x: wide[i].x, y: wide[i].y, px: tall[i].x, py: tall[i].y })),
    edges: links.map(l => [l.from, l.to, l.kind, l.ghost] as VEdge) };
}
export const toView = (g: PublicGraph): GraphView => layout([...g.nodes.map(n => ({ id: n.id, label: n.name, type: n.type as VType, aliases: n.aliases })), ...g.books.map(b => ({ id: b.id, label: b.title, type: 'article' as VType }))], g.links, g.version);

export function neighbors(center: string, depth: number, edges: VEdge[]) {
  const seen = new Set([center]); let frontier = [center];
  for (let d = 0; d < depth; d++) { const next: string[] = []; frontier.forEach(id => edges.forEach(([a, b]) => { const o = a === id ? b : b === id ? a : null; if (o && !seen.has(o)) { seen.add(o); next.push(o); } })); frontier = next; }
  return seen;
}
