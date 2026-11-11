import React, { useMemo, useState } from 'react';
import { TYPE_LABEL } from '../shared/graph';
import type { GraphLink, LocalGraph as LocalData } from '../shared/graph';
import { Graph, NODE_COLOR, frameFor, useSize } from './Graph';
import { GraphView, VNode, layout, neighbors } from './model';
import { useStore } from './store';
import { Failed, Loading, PageLink, useMedia } from './ui';

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
 * On engagement: filters (behind 篩選) and a peek of the selected node, in the same bottom-left corner, never together.
 * On commitment: 開啟 leaves for the node or book route.
 */
export function Canvas() {
  const s = useStore();
  const sm = useMedia('(max-width: 699px)');
  const [ref, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const f = s.filters, g = s.graph;
  const step = (k: number) => setZoom(z => Math.min(3, Math.max(0.5, +(z * k).toFixed(3))));
  const clear = () => s.setFilters({ q: '', depth: 2, colorBy: 'type' });
  const full: [number, number] = sm ? [640, 900] : [1000, 620];
  const box: [number, number, number, number] = [0, 0, full[0], full[1]];
  const unit = 1 / Math.min(size.w / box[2], size.h / box[3]);
  const active = g ? activeSet(f.q, f.depth, g) : null;
  const noMatch = !!(f.q.trim() && active && active.size === 0);
  const node = sel && g ? g.nodes.find(n => n.id === sel) : null;
  const books = node && g ? g.edges.filter(e => e[2] === 'mention' && e[1] === node.id).map(e => g.nodes.find(n => n.id === e[0])?.label).filter(Boolean) : [];
  return (
    <div className="canvas" ref={ref}>
      <h1 className="sr-only" tabIndex={-1}>知識圖譜</h1>
      {!g ? (s.graphError ? <div className="canvas-state"><Failed error={s.graphError} retry={s.reloadGraph} what="圖譜" /></div> : <div className="canvas-state"><Loading label="載入圖譜" /></div>)
        : g.nodes.length === 0 ? <div className="canvas-state"><p className="muted">圖譜裡還沒有任何節點。</p></div>
        : <Graph nodes={g.nodes} edges={g.edges} box={box} unit={unit} zoom={zoom} onZoom={step} pannable selected={sel} onSelect={id => { setSel(id); setShowFilters(false); }} active={active}
            colorBy={f.colorBy} portrait={sm} hideArticleLabels label="所有已發布研究的知識圖譜" />}
      {noMatch ? <div role="alert" className="nomatch"><b>沒有節點符合「{f.q}」</b><button type="button" className="btn-text" onClick={clear}>清除篩選</button></div> : null}
      <div className="tools">
        <button type="button" className="btn tool" aria-expanded={showFilters} aria-controls="filters" onClick={() => { setShowFilters(v => !v); setSel(undefined); }}>篩選{f.q ? ' ·' : ''}</button>
        <button type="button" className="btn-text sq" aria-label="縮小" onClick={() => step(1 / 1.2)}>−</button>
        <button type="button" className="btn-text sq" aria-label="放大" onClick={() => step(1.2)}>+</button>
      </div>
      {showFilters ? (
        <div className="popover" id="filters" role="group" aria-label="篩選">
          <label htmlFor="hl">標示文字</label>
          <input id="hl" className="field" value={f.q} onChange={e => s.setFilters({ q: e.target.value })} placeholder="例如 半導體" />
          <div className="row-label" id="depth-l">符合節點周圍的深度</div>
          <div className="seg" role="group" aria-labelledby="depth-l">{[1, 2, 3].map(d => <button key={d} type="button" aria-pressed={f.depth === d} aria-label={`深度 ${d}`} onClick={() => s.setFilters({ depth: d })}>{d}</button>)}</div>
          <div className="row-label" id="color-l">顏色依據</div>
          <div className="seg" role="group" aria-labelledby="color-l">{(['type', 'none'] as const).map(c => <button key={c} type="button" aria-pressed={f.colorBy === c} onClick={() => s.setFilters({ colorBy: c })}>{c === 'type' ? '節點類型' : '不分色'}</button>)}</div>
          {f.colorBy === 'type' ? <ul className="legend">{(['company', 'etf', 'inst', 'concept', 'article'] as const).map(t => <li key={t} style={{ color: NODE_COLOR[t] }}>● {typeName(t)}</li>)}</ul> : null}
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
export function LocalGraph({ data, selected, onSelect, label, own }: { data: { center: string; nodes: (LocalData['nodes'][number] & { ghost?: boolean })[]; links: (GraphLink & { ghost?: boolean })[] }; selected?: string; onSelect?: (id: string) => void; label: string; own?: boolean }) {
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
  return <div className="local" ref={ref}><Graph nodes={nodes} edges={view.edges} box={box} unit={unit} selected={selected || data.center} onSelect={onSelect} label={label} /></div>;
}
export { typeName };
