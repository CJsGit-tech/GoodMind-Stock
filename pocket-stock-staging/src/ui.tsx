import React, { useEffect, useState } from 'react';
import { AI_NOTICE, SearchEntry } from '../shared/graph';
import { ApiError, useLoad, useStore } from './store';

export function useMedia(query: string) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** A link inside the hash router that stays a real anchor (keyboard, middle-click, status bar). */
export function NavLink({ screen, subject = '', className, children, onClick, ariaCurrent, label }: { screen: string; subject?: string; className?: string; children: React.ReactNode; onClick?: () => void; ariaCurrent?: boolean; label?: string }) {
  const s = useStore();
  return (
    <a className={className} href={`#/${screen}${subject ? '/' + subject : ''}`} aria-current={ariaCurrent ? 'page' : undefined} aria-label={label}
      onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onClick && onClick(); s.go({ screen: screen as any, subject }); }}>{children}</a>
  );
}
/** Opens a node page, or a book page when the id belongs to a book. */
export function PageLink({ id, book, children, className }: { id: string; book?: boolean; children: React.ReactNode; className?: string }) {
  const s = useStore();
  const isBook = book ?? s.graph?.nodes.some(n => n.id === id && n.type === 'article');
  return <NavLink screen={isBook ? 'article' : 'node'} subject={id} className={className}>{children}</NavLink>;
}
export const Tag = ({ id, name }: { id: string; name: string }) => <NavLink screen="node" subject={id} className="tag">#{name}</NavLink>;

const COVER = ['#1f4d4a', '#4a3a1f', '#2d3a5e', '#4a2d4a', '#3a4a2d', '#52352a', '#2a4a52', '#40402a'];
/** Placeholder cover drawn from the title. Real covers are images in storage and are not part of local staging yet. */
export function Cover({ id, title, className }: { id: string; title: string; className?: string }) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <div className={`cover ${className || ''}`} style={{ background: COVER[h % COVER.length] }} aria-hidden="true">
      <span className="cover-c1" /><span className="cover-c2" /><span className="cover-title">{title}</span>
    </div>
  );
}
export const Foot = () => <p className="foot">{AI_NOTICE}</p>;

export function DepthToggle({ depth, set, max = 3 }: { depth: number; set: (d: number) => void; max?: number }) {
  return (
    <span className="depth" role="group" aria-label="Depth">
      {Array.from({ length: max }, (_, i) => i + 1).map(d => <button key={d} type="button" className="btn-text" aria-pressed={depth === d} aria-label={`Depth ${d}`} onClick={() => set(d)}>深度 {d}</button>)}
    </span>
  );
}
export function Disclosure({ title, count, children, onOpen }: { title: string; count?: number; children: React.ReactNode; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const id = React.useId();
  return (
    <section className="disc">
      <h2><button type="button" className="disc-btn" aria-expanded={open} aria-controls={id} onClick={() => { if (!open && onOpen) onOpen(); setOpen(o => !o); }}><span>{title}{count !== undefined ? <small> {count}</small> : null}</span><span aria-hidden="true">{open ? '−' : '+'}</span></button></h2>
      {open ? <div id={id} className="disc-body">{children}</div> : null}
    </section>
  );
}

/** One quiet pattern for a request that is running, failed, or found nothing. Content keeps its place. */
export function Loading({ label = '載入中' }: { label?: string }) { return <p className="muted state" role="status">{label}…</p>; }
export function Failed({ error, retry, what = '這個頁面' }: { error: ApiError; retry?: () => void; what?: string }) {
  return (
    <div className="state" role="alert">
      <p>{what}沒有載入成功。<span className="muted">{error.message}</span></p>
      {retry ? <button type="button" className="btn-text" onClick={retry}>再試一次</button> : null}
    </div>
  );
}

const match = (e: SearchEntry, q: string) => {
  const alias = e.aliases.find(a => a.toLowerCase().includes(q));
  if (e.label.toLowerCase().includes(q)) return { e, via: undefined as string | undefined };
  if (alias) return { e, via: alias };
  return e.text.toLowerCase().includes(q) ? { e, via: undefined } : null;
};
/** One search for nodes and books, over published names, aliases and text. */
export function SearchField({ id }: { id: string }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const data = useLoad<{ entries: SearchEntry[] }>(focus || q ? '/api/search' : null, s.dataTick);
  const term = q.trim().toLowerCase();
  const entries = data.data?.entries || [];
  const res = term ? entries.map(e => match(e, term)).filter(Boolean).slice(0, 12) as { e: SearchEntry; via?: string }[] : [];
  const open = (e: SearchEntry) => { setQ(''); setFocus(false); s.go({ screen: e.kind === 'node' ? 'node' : 'article', subject: e.id }); };
  return (
    <div className="search" role="search">
      <label className="sr-only" htmlFor={id}>搜尋節點與研究書</label>
      <input id={id} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋節點與研究書" autoComplete="off"
        aria-controls={`${id}-results`} aria-expanded={!!term || focus} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') { setQ(''); setFocus(false); (e.target as HTMLElement).blur(); } }} />
      {(term || focus) ? (
        <ul className="search-results" id={`${id}-results`} aria-label={term ? '搜尋結果' : '瀏覽節點'}>
          {data.error ? <li className="search-empty" role="alert">搜尋資料沒有載入成功。</li> : null}
          {data.loading && !data.data ? <li className="search-empty">載入中…</li> : null}
          {!term && data.data ? <li className="search-empty">瀏覽節點</li> : null}
          {term && data.data && res.length === 0 ? <li className="search-empty">找不到符合的節點或研究書。</li> : null}
          {(term ? res : entries.filter(e => e.kind === 'node').map(e => ({ e, via: undefined as string | undefined }))).map(({ e, via }) => (
            <li key={e.kind + e.id}>
              <button type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => open(e)}>
                <span>{term ? <b className="kind">{e.kind === 'node' ? '節點' : '研究書'}</b> : null} {e.label}</span>
                {term ? <small>{via ? `符合別名 ${via}` : e.kind === 'book' ? e.sub.slice(0, 40) : ''}</small> : null}
              </button>
            </li>
          ))}
        </ul>) : null}
    </div>
  );
}
