import { LoadingSkeleton } from './loading';
import { useEffect, useLayoutEffect, useState } from 'react';
import { InstitutionalReader } from './institutional-reader';
import { EtfReportCatalog } from './etf-report-catalog';
import { useFooterVersion } from './research-footer';
import type { MarkdownReport } from '../shared/etf-markdown';
import type { ReportItem } from './active-etf';
import type { EtfCoverDescriptor } from '../shared/etf-cover';
type Publication = { report: MarkdownReport; cover?: EtfCoverDescriptor; version: number; publishedAt: string };
const listKey = 'pocketstocks:institutional:list';
function readRoute(hash: string) {
  const [path, search = ''] = hash.split('?');
  const match = path.match(/^#\/institutional-flows\/([A-Za-z0-9._-]{1,120})$/);
  return { id: match?.[1] || '', version: new URLSearchParams(search).get('v') };
}
function returnToList() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(listKey) || 'null');
    if (typeof saved?.hash === 'string' && /^#\/institutional-flows(?:\?|$)/.test(saved.hash)) return saved;
  } catch { /* A fresh list remains usable without storage. */ }
  return { hash: '#/institutional-flows', y: 0 };
}
export function InstitutionalPublic() {
  const [hash, setHash] = useState(location.hash);
  const [result, setResult] = useState<Publication | null>(null);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const { id, version } = readRoute(hash);
  const visibleResult = result?.report.id === id && (!version || result.version === Number(version)) ? result : null;
  useEffect(() => { document.title = (id ? result?.report.title || '三大法人報告' : '三大法人研究') + ' — PocketStocks · 本機 Staging'; }, [id,result]);
  useFooterVersion(result?.version, '文章版本', !!id);
  useEffect(() => {
    const sync = () => setHash(location.hash);
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setStatus('loading'); setResult(null);
    const timeout = setTimeout(() => controller.abort(), 20000);
    async function read(url: string) {
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw Error('unavailable');
      return response.json();
    }
    void (async () => {
      try {
        if (id) {
          const value = await read('/api/institutional/reports/' + encodeURIComponent(id) + (version ? '?version=' + encodeURIComponent(version) : ''));
          if (!value.report || value.report.format !== 'institutional-json') throw Error('invalid report');
          if (active) { setResult(value); setStatus('ready'); }
        } else {
          const loaded: ReportItem[] = [], seen = new Set<string>(); let cursor: string | null = null;
          do {
            const page = await read('/api/institutional/reports' + (cursor ? '?nextToken=' + encodeURIComponent(cursor) : ''));
            if (!Array.isArray(page.items)) throw Error('invalid list');
            loaded.push(...page.items); cursor = page.nextToken;
            if (cursor && seen.has(cursor)) throw Error('repeated cursor'); if (cursor) seen.add(cursor);
          } while (cursor);
          if (active) { setItems(loaded); setCatalogReady(true); setStatus('ready'); }
        }
      } catch { if (active) { setResult(null); setItems([]); setStatus('error'); } }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [id, version, attempt]);
  useLayoutEffect(() => {
    if (id || status !== 'ready') return;
    const saved = returnToList();
    const frame = requestAnimationFrame(() => window.scrollTo(0, saved.hash === location.hash ? saved.y : 0));
    return () => cancelAnimationFrame(frame);
  }, [id, status]);
  function open(item: ReportItem) {
    try { sessionStorage.setItem(listKey, JSON.stringify({ hash: location.hash, y: window.scrollY })); } catch { /* URL still preserves the query. */ }
    location.hash = '/institutional-flows/' + encodeURIComponent(item.id) + '?v=' + item.version; window.scrollTo(0, 0);
  }
  const retry = <button type='button' onClick={() => setAttempt(a => a + 1)}>重新載入</button>;
  if (!id) return <EtfReportCatalog domain='institutional' items={items} ready={status === 'ready' && catalogReady} loading={status === 'loading'} onOpen={open}
    fallback={status === 'loading' ? <LoadingSkeleton kind='catalog' label='正在載入三大法人報告…' /> : status === 'error' ? <div className='library-search-state' role='alert'><div><h3>三大法人報告暫時無法載入</h3>{retry}</div></div> : !items.length ? <div className='library-search-state empty' role='status'><div><h3>尚無已發布的法人報告</h3><p>報告經 Author 審閱發布後，會出現在這裡。</p></div></div> : null} />;
  return <main className='etf-workspace institutional-public'><a className='etf-back' href={returnToList().hash}>← 返回三大法人報告</a>
    {status === 'error' ? <section className='library-search-state' role='alert'><div><h2>無法讀取這份法人報告</h2><p>報告可能尚未發布、已下架，或目前無法連線。</p>{retry}</div></section> : visibleResult ? <>
      <InstitutionalReader key={id + ':' + visibleResult.version} report={visibleResult.report} coverUrl={visibleResult.cover?.url} publishedAt={visibleResult.publishedAt} />
    </> : <LoadingSkeleton kind='article' metrics={4} label='正在讀取法人研究…' />}
  </main>;
}
