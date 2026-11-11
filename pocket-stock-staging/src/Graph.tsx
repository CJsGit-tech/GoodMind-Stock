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

interface Props {
  nodes: VNode[]; edges: VEdge[]; box: [number, number, number, number]; unit: number;
  selected?: string; onSelect?: (id: string) => void; active?: Set<string> | null;
  colorBy?: 'type' | 'none'; zoom?: number; onZoom?: (factor: number) => void; pannable?: boolean; hideArticleLabels?: boolean; portrait?: boolean; label?: string;
}
/** SVG graph renderer. Kept behind this one component so it can be replaced (for example by Sigma.js) without touching the data. */
export function Graph({ nodes, edges, box, unit, selected, onSelect, active, colorBy = 'type', zoom = 1, onZoom, pannable, hideArticleLabels, portrait, label = 'Knowledge graph' }: Props) {
  const [bx, by, bw, bh] = box;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const placed = nodes.map(n => (portrait ? { ...n, x: n.px, y: n.py } : n));
  const pos: Record<string, VNode> = {};
  placed.forEach(n => (pos[n.id] = n));
  const on = (id: string) => !active || active.has(id);
  const cx = bx + bw / 2, cy = by + bh / 2;
  const down = (e: React.PointerEvent<SVGSVGElement>) => { if (pannable) drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; e.currentTarget.setPointerCapture(e.pointerId);
    setPan({ x: d.px + (dx * unit) / zoom, y: d.py + (dy * unit) / zoom });
  };
  const up = () => { const moved = drag.current?.moved; drag.current = null; return moved; };
  return (
    <svg className={`graph${pannable ? ' pannable' : ''}`} viewBox={`${bx} ${by} ${bw} ${bh}`} role="group" aria-label={label} preserveAspectRatio="xMidYMid meet"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={pannable && onZoom ? e => onZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12) : undefined}
      onClickCapture={e => { if (drag.current?.moved) e.stopPropagation(); }}>
      <g transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx + pan.x} ${-cy + pan.y})`}>
        {edges.map(([a, b, kind, ghostEdge], i) => {
          if (!pos[a] || !pos[b]) return null;
          const ghost = ghostEdge || pos[a].ghost || pos[b].ghost;
          return <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} strokeWidth={(kind === 'attr' ? 2.2 : 1.3) * unit}
            className={`edge${kind === 'attr' ? ' attr' : ''}${ghost ? ' ghost' : ''}`} strokeDasharray={ghost ? `${5 * unit} ${5 * unit}` : undefined} opacity={on(a) && on(b) ? 1 : 0.08} />;
        })}
        {placed.map(n => {
          const r = (n.big ? 12 : 9) * unit;
          const fill = n.type === 'article' ? NODE_COLOR.article : colorBy === 'type' ? NODE_COLOR[n.type] : '#9aa7ac';
          const showLabel = !(n.type === 'article' && hideArticleLabels);
          const text = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
          return (
            <g key={n.id} className="gnode" tabIndex={0} role="button" aria-label={`${n.label}, ${n.type === 'article' ? 'book' : n.type}`} aria-pressed={selected === n.id}
              opacity={on(n.id) ? 1 : 0.12} onClick={() => onSelect && onSelect(n.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(n.id); } }}>
              <circle cx={n.x} cy={n.y} r={Math.max(r * 2.2, 22 * unit)} fill="transparent" />
              {selected === n.id ? <circle cx={n.x} cy={n.y} r={r + 6 * unit} fill="none" stroke="var(--mint)" strokeWidth={2.4 * unit} /> : null}
              {n.type === 'article'
                ? <rect x={n.x - 5.5 * unit} y={n.y - 5.5 * unit} width={11 * unit} height={11 * unit} rx={2.5 * unit} fill={n.ghost ? 'none' : fill} stroke={n.ghost ? 'var(--warn)' : 'none'} strokeWidth={n.ghost ? 2 * unit : 0} />
                : <circle cx={n.x} cy={n.y} r={r} fill={n.ghost ? 'none' : fill} stroke={n.ghost ? fill : 'none'} strokeWidth={n.ghost ? 2.2 * unit : 0} strokeDasharray={n.ghost ? `${4 * unit} ${3 * unit}` : undefined} />}
              {showLabel && on(n.id) ? <text x={n.x} y={n.y + (n.type === 'article' ? 19 : 13) * unit + (n.type === 'article' ? 0 : r)} textAnchor="middle" fontSize={(n.type === 'article' ? 11.5 : 13.5) * unit} fontWeight={600}
                fill={n.type === 'article' ? '#8b989e' : '#e8eef0'}>{text}</text> : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
