// What the 3D and 2D graph views share: their props, node/link shapes, cluster anchors and the WebGL check.
import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../core/types';

export type GraphProps = {
  clusterNames?: Map<string, string> | null;   // cluster key → label, kept even when the key's own node is filtered out
  clusters?: Map<string, string> | null;   // node → cluster key; each cluster is pulled to its own area and labelled
  offsetX?: number;                        // shift the view right (px) so the graph centres in the area not covered by the left panel
  nodes: GraphNode[]; edges: GraphEdge[]; types: EntityType[]; edgeTypes?: EdgeType[]; selectedId: string | null; selectedEdgeId: string | null;
  highlight: Set<string> | null;           // nodes to light up (answer "in context" / live retrieval)
  highlightEdges: Set<string> | null;      // relations to light up (answer evidence / chosen path)
  onSelect: (id: string | null) => void; onSelectEdge: (id: string) => void; showLabels: boolean; fitKey: string;
};
export type GNode = { id: string; name: string; type: string; degree: number; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number; fy?: number; fz?: number };
export type GLink = { id: string; source: string | GNode; target: string | GNode; predicate: string; status: string; derived: boolean; suggested: boolean; strength: number };
export const idOf = (v: string | GNode) => (typeof v === 'string' ? v : v.id);
export const toLinks = (edges: GraphEdge[]): GLink[] => edges.map(e => ({ id: e.id, source: e.from, target: e.to, predicate: e.predicate, status: String(e.attributes?.verification_status ?? 'reported'), derived: e.derived === true, suggested: e.suggested === true, strength: Number(e.attributes?.strength ?? 0) }));

/** Anchor points for clusters: spread on a circle in the screen plane, far enough apart that bridges between them read clearly.
 *  `y` points up (3D). The 2D canvas draws y downwards, so it negates it. */
export function anchors(keys: string[]) {
  const m = new Map<string, { x: number; y: number; z: number }>(), n = keys.length, R = n <= 1 ? 0 : 110 + 32 * n;
  keys.forEach((k, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; m.set(k, { x: R * Math.cos(a), y: -R * Math.sin(a) * 0.8, z: 0 }); });
  return m;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const MODE_KEY = 'gm.graph';
/** The view to open with: 2D unless this browser chose 3D before. `?graph=3d` or `?graph=2d` in the address wins. */
export function initialGraph3D(): boolean {
  const q = new URLSearchParams(window.location.search).get('graph');
  if (q === '3d' || q === '2d') return q === '3d';
  try { return localStorage.getItem(MODE_KEY) === '3d'; } catch { return false; }
}
export function rememberGraph3D(on: boolean) { try { localStorage.setItem(MODE_KEY, on ? '3d' : '2d'); } catch { /* storage blocked: the choice lasts until reload */ } }

/** True when the browser can create the WebGL 2 context the 3D view needs (three.js has no WebGL 1 renderer). */
export function canUse3D(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();   // free the probe: browsers limit live contexts
    return true;
  } catch { return false; }
}
