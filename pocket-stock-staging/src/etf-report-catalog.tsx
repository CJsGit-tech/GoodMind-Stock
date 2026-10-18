import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileSearch, X } from 'lucide-react';
import { CatalogPagination, ResearchHero } from './library-layout';
import type { ReportItem } from './active-etf';
import './etf-report-catalog.css';
import { CatalogSelect } from './catalog-select';
import { CatalogSearch } from './catalog-search';

type CatalogSort = 'research-newest' | 'newest' | 'oldest';
export type CatalogQuery = { q: string; month: string; sort: CatalogSort; page: number };
const pageSize = 4;
const catalogSort = (value: string | null): CatalogSort => value === 'newest' || value === 'oldest' ? value : 'research-newest';
export function readEtfCatalogQuery(hash = window.location.hash): CatalogQuery {
  const params = new URLSearchParams(hash.split('?')[1] || '');
  return {
    q: (params.get('q') || '').slice(0, 200),
    month: /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month')! : '',
    sort: catalogSort(params.get('sort')),
    page: Math.max(0, Math.min(100000, Number(params.get('page')) || 1) - 1),
  };
}
export function etfCatalogHash(query: CatalogQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.month) params.set('month', query.month);
  if (query.sort !== 'research-newest') params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page + 1));
  return '#/active-etf' + (params.size ? '?' + params.toString() : '');
}
function writeQuery(query: CatalogQuery) {
  window.history.replaceState(window.history.state, '', etfCatalogHash(query));
}
export function compareEtfCatalogReports(a: ReportItem, b: ReportItem, sort: CatalogSort) {
  if (sort === 'research-newest') return b.period.end.localeCompare(a.period.end)
    || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
  return (sort === 'oldest' ? 1 : -1) * a.publishedAt.localeCompare(b.publishedAt);
}
const dateLabel = (date: string) => date.slice(0, 10).replaceAll('-', '/');

function safeCoverUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function EtfCatalogCover({ item }: { item: ReportItem }) {
  const cover = item.cover;
  const [source, setSource] = useState(cover && safeCoverUrl(cover.url) ? cover.url : '');
  const [attempt, setAttempt] = useState(0), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const step = useRef(0), alive = useRef(true), timer = useRef<number | null>(null), deadline = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (deadline.current !== null) window.clearTimeout(deadline.current);
      request.current?.abort();
    };
  }, []);
  function handleError() {
    if (!alive.current || !cover) return;
    setReady(false);
    const currentStep = step.current++;
    if (currentStep === 0) {
      timer.current = window.setTimeout(() => { if (alive.current) setAttempt(value => value + 1); }, 400);
      return;
    }
    if (currentStep !== 1) { setFailed(true); return; }
    const controller = new AbortController(); request.current = controller;
    deadline.current = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ version: String(item.version), sha256: cover.sha256 });
    void fetch('/api/etf/reports/' + encodeURIComponent(item.id) + '/cover?' + params, { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Cover refresh unavailable');
        const next = (await response.json()).cover;
        if (!next || next.sha256 !== cover.sha256 || next.bytes !== cover.bytes || next.width !== 480 || next.height !== 360 || next.contentType !== 'image/jpeg' || !safeCoverUrl(next.url)) throw new Error('Unexpected cover');
        if (!alive.current) return;
        setSource(next.url); setAttempt(value => value + 1);
      }).catch(() => { if (alive.current) setFailed(true); })
      .finally(() => { if (deadline.current !== null) window.clearTimeout(deadline.current); });
  }
  if (!source || failed) return <span className='article-thumb etf-report-cover' aria-hidden='true'><FileSearch size={38} strokeWidth={1.2} /><strong>主動式 ETF</strong><span>{failed ? '封面暫時無法顯示' : '研究分析'}</span><time>{dateLabel(item.period.end)}</time></span>;
  return <span className='article-thumb etf-report-cover etf-report-cover--image' aria-busy={!ready}>
    <img key={source + ':' + attempt} src={source} alt={'《' + item.title + '》封面'} width={480} height={360} loading={attempt ? 'eager' : 'lazy'} decoding='async'
      data-loading={!ready} onLoad={() => { if (alive.current) setReady(true); }} onError={handleError} />
    {!ready && <span className='etf-cover-loading' aria-hidden='true'><FileSearch size={28} /><span>正在載入封面…</span></span>}
  </span>;
}

export function EtfReportCatalog({ items, ready, loading, fallback, onOpen }: {
  items: ReportItem[]; ready: boolean; loading: boolean; fallback: ReactNode;
  onOpen: (item: ReportItem) => void;
}) {
  const [query, setQuery] = useState(() => readEtfCatalogQuery());
  const [draft, setDraft] = useState(query.q);
  const input = useRef<HTMLInputElement>(null);
  const months = useMemo(() => [...new Set(items.map(item => item.period.end.slice(0, 7)))].sort().reverse(), [items]);
  const selectedMonth = ready && !months.includes(query.month) ? '' : query.month;
  const normalized = query.q.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
  const results = useMemo(() => items.filter(item =>
    (!selectedMonth || item.period.end.startsWith(selectedMonth)) &&
    (!normalized || [item.title, item.excerpt, item.period.start, item.period.end, dateLabel(item.period.end)]
      .join(' ').normalize('NFKC').toLocaleLowerCase('zh-TW').includes(normalized))
  ).sort((a, b) => compareEtfCatalogReports(a, b, query.sort)), [items, normalized, selectedMonth, query.sort]);
  const count = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(Math.floor(query.page), count - 1);
  const filtered = !!normalized || !!selectedMonth;
  useEffect(() => {
    const sync = () => { const next = readEtfCatalogQuery(); setQuery(next); setDraft(next.q); };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  useEffect(() => {
    if (ready && (query.page !== page || query.month !== selectedMonth)) {
      const next = { ...query, page, month: selectedMonth }; setQuery(next); writeQuery(next);
    }
  }, [ready, page, selectedMonth, query]);
  function change(patch: Partial<CatalogQuery>) {
    const next = { ...query, page: 0, ...patch }; setQuery(next); writeQuery(next);
  }
  function clear() { setDraft(''); change({ q: '', month: '' }); input.current?.focus(); }
  return <section className='etf-catalog' aria-label='主動式 ETF 分析書庫'>
    <ResearchHero title='主動式 ETF 研究' titleId='etf-catalog-title'
      deck={<>產業操作 × 基金共識 × 營運證據<br />從完整分析，理解主動式 ETF 的投資選擇。</>}
      aphorism={<>看見配置<br />理解<br />投資選擇</>} />
    <section className='library-tools library-query-rail' aria-label='搜尋與 ETF 研究篩選'>
      <CatalogSearch label='搜尋 ETF 分析' placeholder='搜尋報告標題、產業或日期' value={draft}
        inputRef={input} clearLabel='清除 ETF 搜尋文字' onChange={setDraft} onSearch={q => change({ q: q.trim() })} />
      <CatalogSelect label='研究月份篩選' value={selectedMonth}
        options={[{ value: '', label: '所有月份' }, ...months.map(month => ({ value: month, label: month.replace('-', ' / ') }))]}
        onChange={month => change({ month })} />
      <CatalogSelect label='ETF 報告排序' value={query.sort}
        options={[{ value: 'research-newest', label: '研究日' }, { value: 'newest', label: '最新發布' }, { value: 'oldest', label: '最早發布' }]}
        onChange={sort => change({ sort: catalogSort(sort) })} />
    </section>
    <section className='market-shelves public-library-normal' aria-label='已發布 ETF 分析'>
      <span className='sr-only' role='status' aria-live='polite'>{ready ? `找到 ${results.length} 篇分析` : loading ? '正在載入…' : ''}</span>
      {filtered && <div className='active-filter-line'><span>{[query.q, selectedMonth].filter(Boolean).join(' · ')}</span><button type='button' className='clear-filters' onClick={clear}><X size={15} />清除篩選</button></div>}
      <div className='library-shelf-composition' aria-busy={loading}>
        {fallback || (!results.length ? <div className='library-search-state empty' role='status'><FileSearch aria-hidden='true' /><div><h3>找不到相關分析</h3><p>請調整關鍵字或研究月份，再試一次。</p><button type='button' onClick={clear}>清除搜尋條件</button></div></div> :
          <div className='book-grid published-book-grid'>
            {results.slice(page * pageSize, (page + 1) * pageSize).map(item => <a key={item.id}
              className='article-card article-card--landscape etf-analysis-card'
              href={'#/active-etf/' + encodeURIComponent(item.id) + '?v=' + item.version + (item.id === 'history' ? '&report=1' : '')}
              aria-label={'開啟 ETF 分析：' + item.title}
              onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(item); }}>
              <EtfCatalogCover key={[item.id, item.version, item.cover?.sha256, item.cover?.url].join(':')} item={item} />
              <span className='article-meta'><span>主動式 ETF</span><time dateTime={item.publishedAt}>發布 {dateLabel(item.publishedAt)}</time></span>
              <h3 title={item.title}>{item.title}</h3><p>{item.excerpt}</p>
              <span className='card-foot etf-report-period'>持股 {dateLabel(item.period.start)} → {dateLabel(item.period.end)}</span>
            </a>)}
          </div>)}
      </div>
      {ready && results.length > 0 && <CatalogPagination page={page} count={count} total={results.length} size={pageSize}
        label='ETF 分析分頁' noun='篇' collection='分析' onChange={page => change({ page })} />}
    </section>
  </section>;
}
