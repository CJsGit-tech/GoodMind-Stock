// 2D fallback for the galaxy graph, drawn on a plain canvas (react-force-graph-2d, no WebGL). Same props and behaviour
// as GalaxyGraph: industry clusters with quiet labels, selection / answer highlighting, tooltips and click-to-open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import i18n from '../i18n';
import { CLUSTER_COLORS, colorOf, LINK_TONES, linkTone, relName, statusLabel, typeName } from '../lib/theme';
import { anchors, escapeHtml, idOf, toLinks } from './graphShared';
import type { GLink, GNode, GraphProps } from './graphShared';

const EVENT_TYPES = new Set(['CompetitionAssessment', 'Collaboration', 'SupplyRelationship', 'CustomerOpportunity']);
const radius = (n: GNode) => (n.type === 'Evidence' ? 1.5 : 2.4) + Math.sqrt(n.degree) * 1.25;

export default function Graph2D({ nodes, edges, types, edgeTypes = [], selectedId, selectedEdgeId, highlight, highlightEdges, onSelect, onSelectEdge, showLabels, fitKey, offsetX = 0, clusters = null, clusterNames = null }: GraphProps) {
  const fg = useRef<any>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, GNode>());
  const fitPending = useRef(true);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = wrap.current!; const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height); if (w > 0 && h > 0) setSize(s => (s && s.w === w && s.h === h ? s : { w, h })); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const clusterAnchors = (keys: string[]) => new Map([...anchors(keys)].map(([k, p]) => [k, { x: p.x, y: -p.y }]));   // canvas y points down

  const data = useMemo(() => {
    const deg = new Map<string, number>(); edges.forEach(e => { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); });
    const at = clusters ? clusterAnchors([...new Set(clusters.values())]) : null;
    const ns = nodes.map(n => {
      let g = cache.current.get(n.id);
      if (!g) {
        const p = at?.get(clusters!.get(n.id) ?? '');
        g = { id: n.id, name: n.name, type: n.type, degree: 0, ...(p ? { x: p.x + (Math.random() - 0.5) * 60, y: p.y + (Math.random() - 0.5) * 60 } : {}) };
        cache.current.set(n.id, g);
      }
      g.name = n.name; g.type = n.type; g.degree = deg.get(n.id) ?? 0; return g;
    });
    return { nodes: ns, links: toLinks(edges) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const selEdge = useMemo(() => (selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) ?? null : null), [selectedEdgeId, edges]);
  const neighbors = useMemo(() => {
    if (selEdge) return new Set([selEdge.from, selEdge.to]);
    if (!selectedId) return null;
    const s = new Set([selectedId]); edges.forEach(e => { if (e.from === selectedId) s.add(e.to); if (e.to === selectedId) s.add(e.from); }); return s;
  }, [selectedId, selEdge, edges]);
  const lit = (id: string) => (neighbors ? neighbors.has(id) : highlight ? highlight.has(id) : true);
  const focused = !!(neighbors || highlight || highlightEdges);

  // Fit (all nodes, or the ones given) into the part of the canvas that the side panels do not cover.
  const view = useRef({ size, offsetX }); view.current = { size, offsetX };
  const fit = useCallback((only: Set<string> | null = null, maxZoom = 4) => {
    const g = fg.current, { size: s, offsetX: dx } = view.current; if (!g || !s) return;
    const box = g.getGraphBbox(only ? (n: GNode) => only.has(n.id) : undefined); if (!box) return;
    const w = Math.max(120, s.w - 2 * Math.abs(dx) - 80), h = Math.max(120, s.h - 220);   // top bar and legend
    const z = Math.min(maxZoom, w / Math.max(40, box.x[1] - box.x[0]), h / Math.max(40, box.y[1] - box.y[0]));
    g.zoom(z, 700); g.centerAt((box.x[0] + box.x[1]) / 2 - dx / z, (box.y[0] + box.y[1]) / 2, 700);
  }, []);
  useEffect(() => {
    fitPending.current = true;
    const t = setTimeout(() => fit(), 900);
    return () => clearTimeout(t);
  }, [fitKey, fit]);
  useEffect(() => {
    if (!size) return;
    const t = setTimeout(() => fit(neighbors, neighbors ? 3 : 4), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedEdgeId, size, offsetX, fit]);

  // Forces: same spacing as 3D, plus the cluster pull that gives each sampled industry its own area.
  const defaultLinkStrength = useRef<unknown>(null);
  const clusterKey = clusters ? [...new Set(clusters.values())].join('|') : '';
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      const g = fg.current; if (!g) { raf = requestAnimationFrame(apply); return; }
      g.d3Force('charge')?.strength(-70);
      const link = g.d3Force('link'); link?.distance(42);
      if (link && !defaultLinkStrength.current) defaultLinkStrength.current = link.strength();
      if (!clusters || !clusterKey) { g.d3Force('cluster', null); if (link && defaultLinkStrength.current) link.strength(defaultLinkStrength.current); g.d3ReheatSimulation(); return; }
      const at = clusterAnchors(clusterKey.split('|'));
      let ns: GNode[] = [];
      const force = (alpha: number) => {
        for (const n of ns) {
          const c = clusters.get(n.id), p = c ? at.get(c) : null; if (!p || n.x === undefined) continue;
          const k = (n.id === c ? 0.5 : 0.14) * alpha;
          n.vx = (n.vx ?? 0) + (p.x - n.x!) * k; n.vy = (n.vy ?? 0) + (p.y - n.y!) * k;
        }
      };
      force.initialize = (x: GNode[]) => { ns = x; };
      g.d3Force('cluster', force);
      link?.strength((l: GLink) => { const a = clusters.get(idOf(l.source)), b = clusters.get(idOf(l.target)); return a && b && a !== b ? 0.015 : 0.5; });
      g.d3ReheatSimulation();
    };
    apply(); return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterKey, clusters, data, !size]);

  // Cluster labels: HTML text above each cluster (same look as 3D), kept in place every frame.
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const clusterList = useMemo(() => {
    if (!clusters) return [];
    const byKey = new Map<string, string[]>();
    for (const n of nodes) { const k = clusters.get(n.id); if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(n.id); }
    const order = [...new Set(clusters.values())];
    return [...byKey].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([key, ids]) => ({ key, ids, name: clusterNames?.get(key) ?? nodes.find(n => n.id === key)?.name ?? '', companies: nodes.filter(n => ids.includes(n.id) && n.type === 'Company').length, color: CLUSTER_COLORS[order.indexOf(key) % CLUSTER_COLORS.length] }));
  }, [clusters, clusterNames, nodes]);
  useEffect(() => {
    if (!clusterList.length) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = fg.current; if (!g) return;
      for (const c of clusterList) {
        const el = labelEls.current.get(c.key); if (!el) continue;
        let sx = 0, top = Infinity, n = 0;
        for (const id of c.ids) {
          const node = cache.current.get(id); if (!node || node.x === undefined) continue;
          const p = g.graph2ScreenCoords(node.x, node.y); sx += p.x; top = Math.min(top, p.y); n++;
        }
        if (!n) { el.style.opacity = '0'; continue; }
        el.style.opacity = ''; el.style.transform = `translate(${Math.round(sx / n)}px, ${Math.round(top - 30)}px) translateX(-50%)`;
      }
    };
    tick(); return () => cancelAnimationFrame(raf);
  }, [clusterList]);

  const drawNode = (n: GNode, ctx: CanvasRenderingContext2D) => {
    const color = colorOf(types, n.type), on = lit(n.id), sel = n.id === selectedId, r = radius(n), x = n.x!, y = n.y!;
    ctx.save();
    if (on) { ctx.globalAlpha = sel ? 0.32 : 0.1; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * (sel ? 2.4 : 1.7), 0, 2 * Math.PI); ctx.fill(); }
    ctx.globalAlpha = on ? 1 : 0.16; ctx.fillStyle = color; ctx.beginPath();
    if (EVENT_TYPES.has(n.type)) { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (sel) { ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.34; ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.restore();
  };

  // Node names are drawn after all nodes, most important first; a name that would overlap one already drawn is skipped.
  const drawLabels = (ctx: CanvasRenderingContext2D, scale: number) => {
    if (!showLabels) return;
    const few = nodes.length <= 40;
    const wanted = data.nodes.filter(n => {
      if (n.x === undefined || !lit(n.id)) return false;
      const sel = n.id === selectedId, head = !!clusters && clusters.get(n.id) === n.id;
      return !(head && !sel) && (sel || !!neighbors || few || n.degree >= (nodes.length > 140 ? 6 : 3) || scale >= 2.2);
    }).sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || b.degree - a.degree);
    const taken: [number, number, number, number][] = [];
    for (const n of wanted) {
      const sel = n.id === selectedId, fs = (sel ? 12.5 : 11) / scale, text = n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name;
      ctx.font = `${sel ? 700 : 500} ${fs}px Inter, "Noto Sans TC", sans-serif`;
      const w = ctx.measureText(text).width + 6 / scale, h = fs + 4 / scale;
      const left = n.x! - w / 2, top = n.y! + radius(n) * (sel ? 2.2 : 1) + 2 / scale;
      if (!sel && taken.some(([l, t, r, b]) => left < r && left + w > l && top < b && top + h > t)) continue;
      taken.push([left, top, left + w, top + h]);
      ctx.fillStyle = sel ? 'rgba(10,16,40,0.92)' : 'rgba(6,10,28,0.72)'; ctx.fillRect(left, top, w, h);
      ctx.fillStyle = sel ? '#ffffff' : '#dbe4ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, n.x!, top + h / 2);
    }
  };

  const linkActive = (l: GLink) => {
    const a = idOf(l.source), b = idOf(l.target);
    if (selEdge) return l.id === selEdge.id;
    if (selectedId) return a === selectedId || b === selectedId;
    if (highlightEdges) return highlightEdges.has(l.id);
    return highlight ? highlight.has(a) && highlight.has(b) : false;
  };
  const rgb = (l: GLink) => LINK_TONES[linkTone(l.status, l.derived, l.suggested)].color;

  return (
    <div ref={wrap} className="galaxy galaxy-2d">
      {clusterList.length > 0 && <div className="cluster-labels" aria-hidden>{clusterList.map(c => (
        <div key={c.key} ref={el => { if (el) labelEls.current.set(c.key, el); else labelEls.current.delete(c.key); }} className={`cluster-label ${focused && !lit(c.key) ? 'dim' : ''}`}>
          <i style={{ background: c.color }} />{c.name}<small>{i18n.t('{{n}} 家', { n: c.companies })}</small></div>))}</div>}
      {size && <ForceGraph2D
        ref={fg}
        width={size.w} height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        autoPauseRedraw={false}
        nodeCanvasObject={drawNode as any}
        nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2, 0, 2 * Math.PI); ctx.fill(); }}
        onRenderFramePost={drawLabels}
        nodeLabel={(n: any) => `<div class="tip"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(typeName(types, n.type))} · ${i18n.t('{{n}} 條關係', { n: n.degree })}</span></div>`}
        linkLabel={(l: any) => `<div class="tip"><b>${escapeHtml(relName(edgeTypes, l.predicate))}</b><span>${l.suggested ? `${i18n.t('AI 建議')} · ${Math.round(l.strength * 100)}%` : `${statusLabel(l.status)}${l.derived ? ` · ${i18n.t('系統算出')}` : ''}`}</span></div>`}
        linkColor={(l: any) => `rgba(${rgb(l)},${linkActive(l) ? (l.suggested && l.id !== selectedEdgeId ? 0.55 : 1) : l.suggested ? (focused ? 0.03 : 0.16) : focused ? 0.06 : 0.34})`}
        linkWidth={(l: any) => (linkActive(l) ? (l.id === selectedEdgeId ? 3 : 1.8) : focused ? 0.4 : 0.8)}
        linkLineDash={(l: any) => (l.suggested ? [2, 3] : null)}
        linkDirectionalArrowLength={(l: any) => (linkActive(l) ? 4.2 : 0)}
        linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={(l: any) => `rgb(${rgb(l)})`}
        linkDirectionalParticles={(l: any) => (l.id === selectedEdgeId ? 2 : 0)}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={(l: any) => `rgb(${rgb(l)})`}
        onNodeClick={(n: any) => onSelect(n.id)}
        onLinkClick={(l: any) => onSelectEdge(l.id)}
        onBackgroundClick={() => onSelect(null)}
        onEngineStop={() => { if (fitPending.current) { fitPending.current = false; fit(neighbors, neighbors ? 3 : 4); } }}
        cooldownTicks={120}
        warmupTicks={40}
      />}
    </div>
  );
}
