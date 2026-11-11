import React, { useEffect, useState } from 'react';
import type { BookPage as BookData, LibraryItem, LocalGraph as LocalData, NodePage as NodeData } from '../../shared/graph';
import { LocalGraph, typeName } from '../Canvas';
import { Graph, frameFor, useSize } from '../Graph';
import { ApiError, useLoad, useStore } from '../store';
import { Cover, DepthToggle, Disclosure, Failed, Foot, Loading, NavLink, PageLink, Tag } from '../ui';

/*
 * Each route stages its features in three steps:
 *   first        what the page is for: one anchor, one primary action
 *   engagement   controls that open in place when the reader asks (disclosures, peeks, filters)
 *   commitment   the next step, which either changes the anchor in place or leaves for another route
 */

function Missing({ title }: { title: string }) {
  return (
    <div className="wrap">
      <h1 tabIndex={-1} className="page-h">{title}</h1>
      <p className="muted lead">讀者只看得到已核准的內容。</p>
      <p className="actions"><NavLink screen="graph" className="btn primary">回到圖譜</NavLink></p>
    </div>
  );
}
/** Loading, not found and failed, in one place for every reader page. */
function Gate({ load, missing, children }: { load: { data?: unknown; error?: ApiError; loading: boolean; reload(): void }; missing: string; children: React.ReactNode }) {
  if (load.data) return <>{children}</>;
  if (load.error?.status === 404) return <Missing title={missing} />;
  return <div className="wrap">{load.error ? <Failed error={load.error} retry={load.reload} /> : <Loading />}</div>;
}

/** A local graph with its depth control and a one-line peek. The peek's slot keeps its height, so selecting a neighbour never moves the layout. */
function Neighbourhood({ id, label, full }: { id: string; label: string; full?: boolean }) {
  const s = useStore();
  const [depth, setDepth] = useState(1);
  const [sel, setSel] = useState<string | undefined>();
  useEffect(() => { setDepth(1); setSel(undefined); }, [id]);
  useEffect(() => { // the peek closes with 取消, Escape, a click on empty space, or a second click on the same node
    if (!sel) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(undefined); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sel]);
  const local = useLoad<LocalData>(`/api/local/${id}?depth=${depth}`, s.dataTick);
  const picked = sel ? local.data?.nodes.find(n => n.id === sel) : null;
  return (
    <>
      {local.data ? <LocalGraph data={local.data} selected={sel} onSelect={n => setSel(cur => (n === id || n === cur ? undefined : n))} onBackground={() => setSel(undefined)} label={label} />
        : <div className="local local-state">{local.error ? <Failed error={local.error} retry={local.reload} what="鄰近節點" /> : <Loading />}</div>}
      <div className="anchor-bar"><DepthToggle depth={depth} set={d => { setDepth(d); setSel(undefined); }} />{full ? <NavLink screen="graph" className="btn-text muted-c">完整圖譜</NavLink> : null}</div>
      <div className="slot" aria-live="polite">
        {picked ? (
          <>
            <span className="slot-t"><b>{picked.name}</b><small className="muted">{picked.book ? typeName('article') : typeName(picked.type)}</small></span>
            <PageLink id={picked.id} book={!!picked.book} className="btn-text">開啟</PageLink>
            <button type="button" className="btn-text muted-c" onClick={() => setSel(undefined)}>取消</button>
          </>
        ) : <span className="muted small0">{local.data?.capped ? '鄰近節點太多，只顯示一部分。' : local.data && local.data.nodes.length < 2 ? '這個頁面還沒有鄰近節點。' : '點選節點先看看它是什麼，拖曳可以重新排列。'}</span>}
      </div>
    </>
  );
}

const FIRST = 3;
export function NodePage({ id }: { id: string }) {
  const s = useStore();
  const load = useLoad<NodeData>(`/api/nodes/${id}`, s.dataTick);
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [id]);
  const info = load.data;
  if (!info) return <Gate load={load} missing="找不到這個節點">{null}</Gate>;
  const books = all ? info.books : info.books.slice(0, FIRST);
  return (
    <div className="wrap">
      <div className="split">
        <header className="a-head">
          <p className="label">{typeName(info.node.type)} · 節點</p>
          <h1 tabIndex={-1} className="page-h">{info.node.name}</h1>
          {info.node.aliases.length ? <p className="muted">又稱 {info.node.aliases.join('、')}</p> : null}
        </header>
        <section className="a-anchor" aria-label="鄰近節點"><Neighbourhood id={id} label={`${info.node.name} 的鄰近節點`} full /></section>
        <div className="a-rest">
          <section aria-label="研究書">
            <h2 className="label mt">研究書 {info.books.length}</h2>
            {info.books.length ? <ul className="plain">{books.map(b => (
              <li key={b.id}><NavLink screen="article" subject={b.id} className="rel-row"><Cover id={b.id} title={b.title} className="small" /><span><b>{b.title}</b><small>{b.industry} · {b.date}</small></span></NavLink></li>
            ))}</ul> : <p className="muted">還沒有研究書。</p>}
            {info.books.length > FIRST && !all ? <button type="button" className="btn-text" onClick={() => setAll(true)}>顯示全部 {info.books.length} 本</button> : null}
          </section>
          {info.attrs.length ? (
            <Disclosure title="屬性" count={info.attrs.length}>
              <ul className="plain">{info.attrs.map(a => <li key={a.name + a.value} className="attr">{a.name}　{a.valueId ? <PageLink id={a.valueId} book={false} className="strong">{a.value}</PageLink> : <span>{a.value}</span>}</li>)}</ul>
            </Disclosure>) : null}
          <Disclosure title="反向連結" count={info.backlinks.length}>
            {info.backlinks.length ? <ul className="plain">{info.backlinks.map((b, i) => <li key={i}><PageLink id={b.id} book={b.book} className="back-row"><b>{b.title}</b><small>{b.context}</small></PageLink></li>)}</ul> : <p className="muted">還沒有連到這裡的頁面。</p>}
          </Disclosure>
          <Foot />
        </div>
      </div>
    </div>
  );
}

export function BookPage({ id, reading }: { id: string; reading: boolean }) {
  const s = useStore();
  const load = useLoad<BookData>(`/api/books/${id}`, s.dataTick);
  const [note, setNote] = useState(false);
  useEffect(() => setNote(false), [id]);
  const data = load.data;
  if (!data) return <Gate load={load} missing="這本書還沒上架">{null}</Gate>;
  const b = data.book;
  return (
    <div className="wrap">
      <div className={`split media-first${reading ? ' reading' : ''}`}>
        {/* The anchor slot. Reading replaces the cover here, in the same place. */}
        <div className="a-anchor">
          {reading ? (
            <article className="reader" aria-label="內文">
              {data.paragraphs.length ? data.paragraphs.map((p, i) => <p key={i} className="read-p">{p.map((seg, j) => seg.n ? <PageLink key={j} id={seg.n} book={false} className="read-link">{seg.t}</PageLink> : <span key={j}>{seg.t}</span>)}</p>)
                : <><Cover id={b.id} title={b.title} className="wide" /><p className="muted small0" role="status">這本書還沒有內頁。</p></>}
            </article>
          ) : <Cover id={b.id} title={b.title} className="wide" />}
        </div>
        <header className="a-head">
          <p className="meta">{b.industry}　{b.date}　{b.pages} 頁{b.sample ? '　· 示範' : ''}</p>
          <h1 tabIndex={-1} className="page-h">{b.title}</h1>
          {reading ? (
            <p className="actions"><NavLink screen="article" subject={id} className="btn">結束閱讀</NavLink></p>
          ) : (
            <>
              <p className="muted lead">{b.excerpt}</p>
              <div className="actions">
                <NavLink screen="article" subject={`${id}~read`} className="btn primary">開始閱讀</NavLink>
                <button type="button" className="btn-text muted-c pad" onClick={() => setNote(true)}>加入收藏</button>
              </div>
              {note ? <p className="muted small0" role="status">收藏功能還沒有搬到新版。</p> : null}
            </>
          )}
        </header>
        {!reading ? (
          <div className="a-rest">
            <section aria-label="本書節點"><h2 className="label mt">本書節點</h2>{data.tags.length ? <div className="tags">{data.tags.map(t => <Tag key={t.id} id={t.id} name={t.name} />)}</div> : <p className="muted">這本書還沒有節點。</p>}</section>
            <Disclosure title="在圖譜中看這本書"><Neighbourhood id={id} label={`${b.title} 的鄰近節點`} /></Disclosure>
            <Disclosure title="相關研究" count={data.related.length}>
              {data.related.length ? <ul className="plain">{data.related.map(r => (
                <li key={r.id}><NavLink screen="article" subject={r.id} className="rel-row"><Cover id={r.id} title={r.title} className="small" /><span><b>{r.title}</b><small>共同節點：{r.shared.join('、')}</small></span></NavLink></li>
              ))}</ul> : <p className="muted">還沒有共用節點的研究書。</p>}
            </Disclosure>
            <Foot />
          </div>) : null}
      </div>
    </div>
  );
}

const PAGE = 12;
export function LibraryPage() {
  const s = useStore();
  const load = useLoad<{ books: LibraryItem[] }>('/api/library', s.dataTick);
  const [q, setQ] = useState('');
  const [ind, setInd] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const all = load.data?.books || [];
  const inds = Array.from(new Set(all.map(b => b.industry)));
  const tags = Array.from(new Map(all.flatMap(b => b.tags).map(t => [t.id, t.name])).entries());
  const term = q.trim().toLowerCase();
  const books = all.filter(b => (!term || (b.title + b.industry + b.excerpt).toLowerCase().includes(term)) && (!ind || b.industry === ind) && (!tag || b.tags.some(t => t.id === tag)));
  const pages = Math.max(1, Math.ceil(books.length / PAGE));
  useEffect(() => { if (page > pages) setPage(pages); }, [pages, page]);
  const reset = (f: () => void) => { f(); setPage(1); };
  const narrowed = !!(term || ind || tag);
  const clear = () => reset(() => { setQ(''); setInd(''); setTag(''); });
  return (
    <div className="wrap">
      <div className="lib-head">
        <h1 tabIndex={-1} className="page-h">研究書庫</h1>
        <div className="lib-bar">
          <label className="sr-only" htmlFor="lib-q">搜尋研究書</label>
          <input id="lib-q" className="field" type="search" value={q} onChange={e => reset(() => setQ(e.target.value))} placeholder="搜尋書名、產業或公司" />
          <button type="button" className="btn" aria-expanded={more} aria-controls="lib-more" onClick={() => setMore(m => !m)}>篩選{ind || tag ? ' ·' : ''}</button>
        </div>
      </div>
      {more ? (
        <div className="lib-more" id="lib-more">
          <label className="sr-only" htmlFor="lib-ind">產業篩選</label>
          <select id="lib-ind" className="field" value={ind} onChange={e => reset(() => setInd(e.target.value))}><option value="">所有產業</option>{inds.map(i => <option key={i} value={i}>{i}</option>)}</select>
          <label className="sr-only" htmlFor="lib-tag">標籤篩選</label>
          <select id="lib-tag" className="field" value={tag} onChange={e => reset(() => setTag(e.target.value))}><option value="">所有標籤</option>{tags.map(([id, l]) => <option key={id} value={id}>#{l}</option>)}</select>
        </div>) : null}
      {!load.data ? (load.error ? <Failed error={load.error} retry={load.reload} what="書庫" /> : <Loading />) : (
        <>
          <p className="count"><span className="muted" aria-live="polite">已上架 {books.length} / {all.length} 冊</span>{narrowed ? <button type="button" className="btn-text" onClick={clear}>清除篩選</button> : null}</p>
          {all.length === 0 ? <p className="muted none">書庫裡還沒有研究書。</p> : books.length === 0 ? <p className="muted none">沒有符合的研究書。</p> : null}
          <ul className="plain books">
            {books.slice((page - 1) * PAGE, page * PAGE).map(b => (
              <li key={b.id} className="book-row">
                <NavLink screen="article" subject={b.id} label={`開啟研究：${b.title}`}><Cover id={b.id} title={b.title} className="mid" /></NavLink>
                <div>
                  <p className="meta"><span>{b.industry}</span><span>{b.date}</span><span>{b.pages} 頁</span></p>
                  <h2 className="book-t"><NavLink screen="article" subject={b.id}>{b.title}</NavLink></h2>
                  <div className="tags quiet">{b.tags.slice(0, 3).map(t => <Tag key={t.id} id={t.id} name={t.name} />)}</div>
                </div>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="pager" aria-label="頁碼">
              <button type="button" className="btn-text" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="上一頁書目">‹</button>
              {Array.from({ length: pages }, (_, i) => i + 1).map(n => <button key={n} type="button" className="btn-text" aria-current={page === n ? 'page' : undefined} aria-label={`第 ${n} 頁書目`} onClick={() => setPage(n)}>{n}</button>)}
              <button type="button" className="btn-text" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="下一頁書目">›</button>
            </nav>) : null}
        </>)}
      <Foot />
    </div>
  );
}

const STEPS = [['代理撰寫', 'Codex 或 Claude 研究、撰寫，並找出文章裡的公司、產業與概念。'], ['先查再提議', '代理先在圖譜裡查詢，能沿用現有節點就不新建。'], ['作者審核', '每一個節點與連結，都要經過作者逐一確認。'], ['核准才發布', '只有作者核准，研究書與它的節點才會公開。']];
const PRINCIPLES = [['先審核，再公開', '草稿不會出現在讀者面前。每一本書、每一個節點，都要作者核准後才發布。'], ['一個名稱，一個節點', '同一家公司或概念只有一個節點，別名會指向它，研究不會分散在重複的條目裡。'], ['是研究，不是建議', '圖譜呈現的是研究之間的關聯，不構成任何投資建議。']];

/** The published graph itself, as the picture on the about page. Selecting a node opens its page. */
function AboutGraph() {
  const s = useStore();
  const [ref, size] = useSize<HTMLDivElement>();
  const g = s.graph;
  if (!g || !g.nodes.length) return <div className="local about-graph local-state" ref={ref}>{s.graphError ? <Failed error={s.graphError} retry={s.reloadGraph} what="圖譜" /> : g ? <p className="muted">圖譜裡還沒有任何節點。</p> : <Loading label="載入圖譜" />}</div>;
  const box = frameFor(g.nodes, size, false);
  return (
    <div className="local about-graph" ref={ref}>
      <Graph nodes={g.nodes} edges={g.edges} box={box} unit={box[2] / size.w} hideArticleLabels label="目前已發布的知識圖譜"
        onSelect={id => s.go({ screen: g.nodes.find(n => n.id === id)?.type === 'article' ? 'article' : 'node', subject: id })} />
    </div>
  );
}

/**
 * About route. Shown first: what the product is, one primary action, and the live graph as its picture.
 * Below, in reading order: what is published so far, how research enters the graph, and what the product commits to.
 */
export function AboutPage() {
  const s = useStore();
  const g = s.graph;
  const books = g ? g.nodes.filter(n => n.type === 'article').length : 0;
  const stats: [number, string][] = g ? [[books, '本研究書'], [g.nodes.length - books, '個節點'], [g.edges.length, '條連結']] : [];
  return (
    <div className="wrap about">
      <div className="about-hero">
        <header>
          <p className="label mint">關於股脈</p>
          <h1 tabIndex={-1} className="page-h big">把台股研究，連成一張看得懂的圖</h1>
          <p className="muted lead">股脈把台股與產業研究整理成一本本研究書，再把書裡提到的公司、產業與概念連成知識圖譜。從任何一個節點出發，都能找到討論它的所有研究。</p>
          <p className="actions"><NavLink screen="graph" className="btn primary">打開財經心智圖</NavLink><NavLink screen="library" className="btn-text muted-c pad">先逛書庫</NavLink></p>
          {stats.length ? <dl className="stats" aria-label="目前已發布">{stats.map(([n, l]) => <div key={l}><dt>{l}</dt><dd>{n}</dd></div>)}</dl> : null}
        </header>
        <AboutGraph />
      </div>
      <section className="about-sec" aria-labelledby="ab-how">
        <h2 id="ab-how">研究怎麼進到圖譜</h2>
        <ol className="cols">{STEPS.map(([t, d], i) => <li key={t}><span className="n">{String(i + 1).padStart(2, '0')}</span><b>{t}</b><p>{d}</p></li>)}</ol>
      </section>
      <section className="about-sec" aria-labelledby="ab-what">
        <h2 id="ab-what">我們堅持的三件事</h2>
        <ul className="cols">{PRINCIPLES.map(([t, d]) => <li key={t}><b>{t}</b><p>{d}</p></li>)}</ul>
      </section>
      <Foot />
    </div>
  );
}
