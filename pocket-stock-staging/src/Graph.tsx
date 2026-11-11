import React, { useEffect, useRef, useState } from 'react';
import type { VEdge, VNode, VType } from './model';

export const NODE_COLOR: Record<VType, string> = { company: '#6fb2ff', etf: '#4ee0a4', inst: '#f2c14e', concept: '#c9a0ff', article: '#7f8d93' };

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 500 }));
    ro.observe(el); setSize({ w: el.clientWidth || 800, h: el.clientHeight || 500 });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** A frame that fits every node and its label inside a w×h container. Padding grows with the longest label, so labels are never cut off. */
export function frameFor(nodes: VNode[], size: { w: number; h: number }, portrait: boolean) {
  const pts = nodes.map(n => ({ x: portrait ? n.px : n.x, y: portrait ? n.py : n.y, half: Math.min(n.label.length, 22) * 7 + 12 }));
  if (!pts.length) return [0, 0, 1000, 620] as [number, number, number, number];
  let w = 0, h = 0, x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  // Label width is in screen pixels, so the padding in graph units depends on the scale; two passes settle it.
  for (let pass = 0, unit = 1; pass < 3; pass++) {
    x0 = Math.min(...pts.map(p => p.x - p.half * unit)); x1 = Math.max(...pts.map(p => p.x + p.half * unit));
    y0 = Math.min(...pts.map(p => p.y)) - 34 * unit; y1 = Math.max(...pts.map(p => p.y)) + 46 * unit;
    const aspect = size.w / size.h;
    h = Math.max(y1 - y0, (x1 - x0) / aspect, 200); w = h * aspect; unit = w / size.w;
  }
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h] as [number, number, number, number];
}

type XY = { x: number; y: number };
interface Props {
  nodes: VNode[]; edges: VEdge[]; box: [number, number, number, number]; unit: number;
  selected?: string; onSelect?: (id: string) => void; active?: Set<string> | null;
  colorBy?: 'type' | 'none'; zoom?: number; onZoom?: (factor: number) => void; pannable?: boolean; hideArticleLabels?: boolean; portrait?: boolean; label?: string;
  /** Called when the reader clicks empty space. Used to dismiss whatever the selection opened. */
  onBackground?: () => void;
  /** Called with the new positions when a drag settles. Without it the graph keeps the positions itself. */
  onMove?: (positions: Record<string, XY>) => void;
}
/** A node in motion: where it is, how fast, where it is held (h), and where it started (s). */
interface Body { x: number; y: number; vx: number; vy: number; hx: number; hy: number; sx: number; sy: number }
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * SVG graph renderer. Kept behind this one component so it can be replaced (for example by Sigma.js) without touching the data.
 * Nodes can be dragged. While one is dragged, its links act as springs and pull the neighbours along; every other node is also
 * held near where it was, so the graph keeps its shape. A dropped node stays where it was put.
 */
export function Graph({ nodes, edges, box, unit, selected, onSelect, active, colorBy = 'type', zoom = 1, onZoom, pannable, hideArticleLabels, portrait, label = 'Knowledge graph', onBackground, onMove }: Props) {
  const [bx, by, bw, bh] = box;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [own, setOwn] = useState<Record<string, XY>>({});
  const [live, setLive] = useState<Record<string, XY> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const grab = useRef<{ id: string; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const sim = useRef<{ p: Record<string, Body>; rest: number[]; held: string | null; put: Set<string>; raf: number; frames: number } | null>(null);
  const dragged = useRef(false);
  const home = nodes.map(n => { const p = own[n.id]; return p ? { ...n, x: p.x, y: p.y } : portrait ? { ...n, x: n.px, y: n.py } : n; });
  const placed = live ? home.map(n => (live[n.id] ? { ...n, ...live[n.id] } : n)) : home;
  const pos: Record<string, VNode> = {};
  placed.forEach(n => (pos[n.id] = n));
  const now = useRef({ home, edges, onMove, box, unit, pannable });
  now.current = { home, edges, onMove, box, unit, pannable };
  useEffect(() => () => { if (sim.current) cancelAnimationFrame(sim.current.raf); }, []);
  // Size follows the number of links, so the nodes most research passes through read first.
  const degree: Record<string, number> = {};
  edges.forEach(([a, b]) => { degree[a] = (degree[a] || 0) + 1; degree[b] = (degree[b] || 0) + 1; });
  // Pointing at a node brings it and its direct neighbours forward, unless the page has already set a focus.
  const near = !active && hover && !dragging && pos[hover] ? new Set([hover, ...edges.filter(e => e[0] === hover || e[1] === hover).map(e => (e[0] === hover ? e[1] : e[0]))]) : null;
  const focus = active || near;
  const on = (id: string) => !focus || focus.has(id);
  const cx = bx + bw / 2, cy = by + bh / 2;

  const finish = () => {
    const s = sim.current; if (!s) return;
    const changed: Record<string, XY> = {};
    for (const [id, b] of Object.entries(s.p)) if (Math.hypot(b.x - b.sx, b.y - b.sy) > 0.5) changed[id] = { x: Math.round(b.x), y: Math.round(b.y) };
    sim.current = null; setLive(null);
    if (!Object.keys(changed).length) return;
    if (now.current.onMove) now.current.onMove(changed); else setOwn(o => ({ ...o, ...changed }));
  };
  const tick = () => {
    const s = sim.current; if (!s) return;
    const { edges: es } = now.current, ids = Object.keys(s.p);
    let fastest = 0;
    if (!still()) {
      const links: Record<string, number> = {};
      es.forEach(([a, b]) => { links[a] = (links[a] || 0) + 1; links[b] = (links[b] || 0) + 1; });
      es.forEach(([a, b], i) => {
        const A = s.p[a], B = s.p[b]; if (!A || !B) return;
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.max(Math.hypot(dx, dy), 0.01), f = 0.05 * (d - s.rest[i]);
        const ka = f / Math.max(1, links[a] / 8), kb = f / Math.max(1, links[b] / 8);
        A.vx += (dx / d) * ka; A.vy += (dy / d) * ka; B.vx -= (dx / d) * kb; B.vy -= (dy / d) * kb;
      });
      if (ids.length <= 400) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { // keep nodes from stacking
        const A = s.p[ids[i]], B = s.p[ids[j]], dx = B.x - A.x, dy = B.y - A.y, d = Math.max(Math.hypot(dx, dy), 0.01);
        if (d < 56) { const f = (56 - d) * 0.12; A.vx -= (dx / d) * f; A.vy -= (dy / d) * f; B.vx += (dx / d) * f; B.vy += (dy / d) * f; }
      }
      for (const id of ids) {
        const b = s.p[id]; if (s.put.has(id)) { b.vx = b.vy = 0; continue; } // a node the reader placed stays exactly there
        b.vx = (b.vx + (b.hx - b.x) * 0.035) * 0.72; b.vy = (b.vy + (b.hy - b.y) * 0.035) * 0.72;
        b.x += b.vx; b.y += b.vy; fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
      }
    }
    setLive(Object.fromEntries(ids.map(id => [id, { x: s.p[id].x, y: s.p[id].y }])));
    if (!s.held && (fastest < 0.08 || ++s.frames > 150)) return finish();
    s.raf = requestAnimationFrame(tick);
  };
  const hold = (id: string) => {
    if (sim.current) { sim.current.held = id; sim.current.put.add(id); sim.current.frames = 0; return; }
    const { home: h, edges: es } = now.current, p: Record<string, Body> = {};
    h.forEach(n => (p[n.id] = { x: n.x, y: n.y, vx: 0, vy: 0, hx: n.x, hy: n.y, sx: n.x, sy: n.y }));
    sim.current = { p, rest: es.map(([a, b]) => (p[a] && p[b] ? Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y) : 0)), held: id, put: new Set([id]), raf: requestAnimationFrame(tick), frames: 0 };
  };

  const capture = (e: React.PointerEvent<SVGSVGElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured */ } };
  const down = (e: React.PointerEvent<SVGSVGElement>) => { if (pannable && !grab.current) drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = grab.current;
    if (g) {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      if (!g.moved) { g.moved = true; capture(e); hold(g.id); setDragging(true); }
      const b = sim.current?.p[g.id]; if (!b) return;
      let x = g.ox + (dx * unit) / zoom, y = g.oy + (dy * unit) / zoom;
      if (!pannable) { const m = 24 * unit; x = Math.min(bx + bw - m, Math.max(bx + m, x)); y = Math.min(by + bh - m * 1.6, Math.max(by + m, y)); } // a graph that cannot pan keeps its nodes in view
      b.x = b.hx = x; b.y = b.hy = y;
      return;
    }
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; capture(e); setDragging(true); }
    setPan({ x: d.px + (dx * unit) / zoom, y: d.py + (dy * unit) / zoom });
  };
  const up = () => {
    if (grab.current?.moved || drag.current?.moved) { dragged.current = true; window.setTimeout(() => (dragged.current = false), 60); } // the click that ends a drag selects nothing
    if (grab.current?.moved && sim.current) { sim.current.held = null; sim.current.frames = 0; }
    grab.current = null; drag.current = null; setDragging(false);
  };
  return (
    <svg className={`graph${pannable ? ' pannable' : ''}${dragging ? ' dragging' : ''}`} viewBox={`${bx} ${by} ${bw} ${bh}`} role="group" aria-label={label} preserveAspectRatio="xMidYMid meet"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={pannable && onZoom ? e => onZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12) : undefined}
      onClick={e => { if (e.target === e.currentTarget && !dragged.current && onBackground) onBackground(); }}>
      <g transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx + pan.x} ${-cy + pan.y})`}>
        {edges.map(([a, b, kind, ghostEdge], i) => {
          const A = pos[a], B = pos[b]; if (!A || !B) return null;
          const ghost = ghostEdge || A.ghost || B.ghost;
          // A slight, steady bow in each link reads as a hand-drawn map and keeps overlapping links apart.
          const bow = (i % 2 ? 0.09 : -0.09), mx = (A.x + B.x) / 2 - (B.y - A.y) * bow, my = (A.y + B.y) / 2 + (B.x - A.x) * bow;
          const lit = focus && on(a) && on(b);
          return <path key={i} d={`M${A.x} ${A.y}Q${mx} ${my} ${B.x} ${B.y}`} fill="none" strokeWidth={(kind === 'attr' ? 2 : 1.2) * unit * (lit ? 1.5 : 1)} strokeLinecap="round"
            className={`edge${kind === 'attr' ? ' attr' : ''}${ghost ? ' ghost' : ''}${lit ? ' lit' : ''}`} strokeDasharray={ghost ? `${5 * unit} ${5 * unit}` : undefined} opacity={on(a) && on(b) ? 1 : 0.08} />;
        })}
        {placed.map(n => {
          const book = n.type === 'article', deg = degree[n.id] || 0, hub = !book && (deg >= 4 || !!n.big);
          const r = (book ? 5 + Math.min(deg, 6) * 0.45 : Math.min(17, 5.5 + 2.7 * Math.sqrt(deg)) + (n.big ? 2 : 0)) * unit;
          const fill = book ? NODE_COLOR.article : colorBy === 'type' ? NODE_COLOR[n.type] : '#9aa7ac';
          const showLabel = !(book && hideArticleLabels) || n.id === selected || n.id === hover || !!(focus && focus.has(n.id) && focus.size <= 14);
          const text = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
          const size = (book ? 11.5 : hub ? 15 : 12.5) * unit;
          return (
            <g key={n.id} className="gnode" tabIndex={0} role="button" aria-label={`${n.label}, ${book ? 'book' : n.type}`} aria-pressed={selected === n.id}
              opacity={on(n.id) ? 1 : 0.12} onClick={() => { if (!dragged.current && onSelect) onSelect(n.id); }}
              onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(n.id); }} onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
              onPointerDown={e => { if (e.button) return; e.stopPropagation(); grab.current = { id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, moved: false }; }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(n.id); } }}>
              <circle cx={n.x} cy={n.y} r={Math.max(r * 2.2, 22 * unit)} fill="transparent" />
              {!n.ghost && !book ? <circle className="halo" cx={n.x} cy={n.y} r={r * (hub ? 2.1 : 1.7)} fill={fill} opacity={hub ? 0.16 : 0.1} /> : null}
              {selected === n.id ? <circle cx={n.x} cy={n.y} r={r + 6 * unit} fill="none" stroke="var(--mint)" strokeWidth={2.4 * unit} /> : null}
              {book
                ? <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={2.5 * unit} transform={`rotate(45 ${n.x} ${n.y})`} fill={n.ghost ? 'none' : fill} stroke={n.ghost ? 'var(--warn)' : 'none'} strokeWidth={n.ghost ? 2 * unit : 0} />
                : <circle cx={n.x} cy={n.y} r={r} fill={n.ghost ? 'none' : fill} stroke={n.ghost ? fill : 'none'} strokeWidth={n.ghost ? 2.2 * unit : 0} strokeDasharray={n.ghost ? `${4 * unit} ${3 * unit}` : undefined} />}
              {showLabel && on(n.id) ? <text x={n.x} y={n.y + r + size * 1.15} textAnchor="middle" fontSize={size} fontWeight={hub ? 800 : book ? 500 : 600} strokeWidth={3.5 * unit}
                className="glabel" fill={book ? '#9aa7ac' : hub ? '#ffffff' : '#cfd9dc'}>{text}</text> : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
