import { useEffect, useMemo, useRef, useState } from 'react';
import { TYPE_LABEL } from '../shared/graph';
import type { GraphLink, LocalGraph as LocalData } from '../shared/graph';
import { Graph, NODE_COLOR, frameFor, useSize } from './Graph';
import { GraphView, VNode, layout, neighbors } from './model';
import { useStore } from './store';
import { Failed, Loading, PageLink, SearchField, useMedia } from './ui';

const typeName = (t: VNode['type']) => (t === 'article' ? TYPE_LABEL.book : TYPE_LABEL[t]);
/** Nodes within `depth` of any node whose name or alias contains q; null when no filter is set. */
function activeSet(q: string, depth: number, g: GraphView): Set<string> | null {
  const s = q.trim().toLowerCase(); if (!s) return null;
  const out = new Set<string>();
  g.nodes.filter(n => n.label.toLowerCase().includes(s) || n.aliases.some(a => a.toLowerCase().includes(s))).forEach(n => neighbors(n.id, depth, g.edges).forEach(id => out.add(id)));
  return out;
}

/**
 * Graph route. Shown first: the graph and nothing else.
 * On engagement: search (the first tool; a result is selected in the graph, not opened), filters (behind 篩選) and a peek of the selected node, in the same top-right corner under the tools, never together.
 * Nodes can be dragged to rearrange the graph, and the wheel zooms. A reset icon appears once something has moved or the zoom changed.
 * On commitment: 開啟 leaves for the node or book route.
 * Dismissing: the peek and the filters close with their ×, with Escape, or with a click on empty space. Clicking the selected node again also closes the peek.
 */
export function Canvas() {
  const s = useStore();
  const sm = useMedia('(max-width: 699px)');
  const [ref, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState(0); // changes when the reader resets, which also puts the pan back
  const [sel, setSel] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const f = s.filters, g = s.graph;
  const step = (k: number) => setZoom(z => Math.min(3, Math.max(0.5, +(z * k).toFixed(3))));
  const clear = () => s.setFilters({ q: '', depth: 2, colorBy: 'type' });
  const full: [number, number] = sm ? [640, 900] : [1000, 620];
  // The layout is made for one frame shape. It is stretched along one axis to the window's shape, so the graph uses the whole stage.
  const shape = (size.w / size.h) / (full[0] / full[1]);
  const kx = Math.min(1.8, Math.max(1, shape)), ky = Math.min(1.8, Math.max(1, 1 / shape));
  const box: [number, number, number, number] = [0, 0, full[0] * kx, full[1] * ky];
  const unit = 1 / Math.min(size.w / box[2], size.h / box[3]);
  const shown = useMemo(() => (g ? g.nodes.map(n => ({ ...n, x: (sm ? n.px : n.x) * kx, y: (sm ? n.py : n.y) * ky })) : []), [g, sm, kx, ky]);
  const moved = (p: Record<string, { x: number; y: number }>) => s.moveNodes(Object.fromEntries(Object.entries(p).map(([id, v]) => [id, { x: v.x / kx, y: v.y / ky }])), sm);
  const filtered = g ? activeSet(f.q, f.depth, g) : null;
  const noMatch = !!(f.q.trim() && filtered && filtered.size === 0);
  // With no filter set, selecting a node brings its direct neighbours forward, so the peek shows what it connects to.
  const active = filtered || (sel && g ? neighbors(sel, 1, g.edges) : null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const dismiss = () => { setSel(undefined); setShowFilters(false); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.id === 'search') return; // the search field closes itself
      if ((e.target as HTMLElement | null)?.closest?.('#filters')) filterBtn.current?.focus(); // focus goes back to what opened the panel
      dismiss();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const node = sel && g ? g.nodes.find(n => n.id === sel) : null;
  const books = node && g ? g.edges.filter(e => e[2] === 'mention' && e[1] === node.id).map(e => g.nodes.find(n => n.id === e[0])?.label).filter(Boolean) : [];
  return (
    <div className="canvas" ref={ref}>
      <h1 className="sr-only" tabIndex={-1}>知識圖譜</h1>
      {!g ? (s.graphError ? <div className="canvas-state"><Failed error={s.graphError} retry={s.reloadGraph} what="圖譜" /></div> : <div className="canvas-state"><Loading label="載入圖譜" /></div>)
        : g.nodes.length === 0 ? <div className="canvas-state"><p className="muted">圖譜裡還沒有任何節點。</p></div>
        : <Graph key={view} nodes={shown} edges={g.edges} box={box} unit={unit} zoom={zoom} onZoom={step} pannable selected={sel} onSelect={id => { setSel(cur => (cur === id ? undefined : id)); setShowFilters(false); }} onBackground={dismiss} onMove={moved} active={active}
            colorBy={f.colorBy} hideArticleLabels label="所有已發布研究的知識圖譜" />}
      {noMatch ? <div role="alert" className="nomatch"><b>沒有節點符合「{f.q}」</b><button type="button" className="btn-text" onClick={clear}>清除篩選</button></div> : null}
      {g && g.nodes.length && f.colorBy === 'type' ? <ul className="legend-line" aria-label="圖例">{(['company', 'etf', 'inst', 'concept', 'article'] as const).map(t => <li key={t}><i style={{ color: NODE_COLOR[t] }}>{t === 'article' ? '◆' : '●'}</i>{typeName(t)}</li>)}<li>圓點越大，連結越多</li></ul> : null}
      <div className="tools">
        <SearchField id="search" onPick={e => { setSel(e.id); setShowFilters(false); }} />
        {s.layoutMoved || zoom !== 1 ? (
          <button type="button" className="btn-text sq tool-reset" aria-label="重設位置" title="重設位置" onClick={() => { s.resetLayout(); setZoom(1); setView(v => v + 1); }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
          </button>) : null}
        <button type="button" ref={filterBtn} className="btn tool" aria-expanded={showFilters} aria-controls="filters" onClick={() => { setShowFilters(v => !v); setSel(undefined); }}>篩選{f.q ? ' ·' : ''}</button></div>
      {showFilters ? (
        <div className="popover" id="filters" role="group" aria-label="篩選">
          <button type="button" className="x" aria-label="關閉篩選" onClick={() => { setShowFilters(false); filterBtn.current?.focus(); }}>×</button>
          <label htmlFor="hl">標示文字</label>
          <input id="hl" className="field" value={f.q} onChange={e => s.setFilters({ q: e.target.value })} placeholder="例如 半導體" />
          <div className="row-label" id="depth-l">符合節點周圍的深度</div>
          <div className="seg" role="group" aria-labelledby="depth-l">{[1, 2, 3].map(d => <button key={d} type="button" aria-pressed={f.depth === d} aria-label={`深度 ${d}`} onClick={() => s.setFilters({ depth: d })}>{d}</button>)}</div>
          <div className="row-label" id="color-l">顏色依據</div>
          <div className="seg" role="group" aria-labelledby="color-l">{(['type', 'none'] as const).map(c => <button key={c} type="button" aria-pressed={f.colorBy === c} onClick={() => s.setFilters({ colorBy: c })}>{c === 'type' ? '節點類型' : '不分色'}</button>)}</div>
          <button type="button" className="btn-text" onClick={clear}>清除篩選</button>
        </div>) : null}
      {node ? (
        <aside className="peek" aria-label="選取的節點">
          <button type="button" className="x" aria-label="關閉" onClick={() => setSel(undefined)}>×</button>
          <p className="label">{typeName(node.type)}</p>
          <h2 className="peek-t">{node.label}</h2>
          {node.aliases.length ? <p className="muted">又稱 {node.aliases.join('、')}</p> : null}
          {node.type !== 'article' ? <p className="muted peek-books">{books.length ? books.slice(0, 3).join(' · ') : '還沒有研究書'}</p> : null}
          <PageLink id={node.id} book={node.type === 'article'} className="btn primary peek-open">開啟</PageLink>
        </aside>) : null}
    </div>
  );
}

/** The neighbourhood of one page. Reader pages reuse the full graph's positions so nodes do not jump; a draft preview lays out its own nodes. */
export function LocalGraph({ data, selected, onSelect, onBackground, label, own }: { data: { center: string; nodes: (LocalData['nodes'][number] & { ghost?: boolean })[]; links: (GraphLink & { ghost?: boolean })[] }; selected?: string; onSelect?: (id: string) => void; onBackground?: () => void; label: string; own?: boolean }) {
  const s = useStore();
  const [ref, size] = useSize<HTMLDivElement>();
  const view = useMemo(() => {
    const items = data.nodes.map(n => ({ id: n.id, label: n.name, type: (n.book ? 'article' : n.type) as VNode['type'], aliases: n.aliases, ghost: n.ghost }));
    const mine = layout(items, data.links);
    if (own || !s.graph) return mine;
    const known = new Map(s.graph.nodes.map(n => [n.id, n]));
    return mine.nodes.every(n => known.has(n.id)) ? { ...mine, nodes: mine.nodes.map(n => ({ ...n, x: known.get(n.id)!.x, y: known.get(n.id)!.y, px: known.get(n.id)!.px, py: known.get(n.id)!.py })) } : mine;
  }, [data, own, s.graph]);
  const nodes = view.nodes.map(n => ({ ...n, big: n.id === data.center }));
  const box = frameFor(nodes, size, false);
  const unit = box[2] / size.w;
  return <div className="local" ref={ref}><Graph key={data.center} nodes={nodes} edges={view.edges} box={box} unit={unit} selected={selected || data.center} onSelect={onSelect} onBackground={onBackground} label={label} /></div>;
}
export { typeName };
