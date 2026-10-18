import { CatalogSelect } from './catalog-select';
import { CatalogSearch } from './catalog-search';
import { useFooterVersion } from './research-footer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MAX_SNAPSHOT_PAGES, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PAGE_BYTES } from '../shared/etf-data-contract';
import { api } from '@appdeploy/client';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, FileSearch, RotateCcw, Upload, X } from 'lucide-react';
import type { EtfReport, FlowRow } from '../shared/etf-contract';
import type { EtfCoverDescriptor } from '../shared/etf-cover';
import { seedReport } from '../shared/etf-seed';
import { EtfReportCatalog } from './etf-report-catalog';
import { isMarkdownReport, type MarkdownReport } from '../shared/etf-markdown';
import { parseEtfResearchSource, researchSource } from '../shared/etf-research';
import { MarkdownEtfReader } from './etf-markdown-reader';
import './active-etf.css';

export type EtfAuthorAction = 'list' | 'get' | 'validate' | 'save' | 'publish' | 'status' | 'visibility';
export type EtfEntry = {
  archived?: boolean;
  id: string; draft: EtfReport; revision: number; updatedAt: string;
  publishedVersion: number; publishedAt: string | null; hasUnpublishedChanges: boolean;
};
export type ReportItem = Pick<EtfReport, 'id' | 'title' | 'excerpt' | 'period' | 'evidenceDate'> & {
  publishedAt: string; version: number; cover?: EtfCoverDescriptor | null;
};
type Validation = { report?: EtfReport; errors: string[]; warnings: string[]; counts: Record<string, number> };
type Status = 'loading' | 'ready' | 'error' | 'unavailable';

export type ReaderEtfReport = Omit<EtfReport, 'schemaVersion'> & {
  schemaVersion: 1 | 2;
  dataLineage?: {
    publicationIds: string[];
    setIds: string[];
    sourceHashes: string[];
    taxonomyVersions: string[];
    calendarVersion: string | null;
    comparison: { start: string | null; end: string | null };
    versionVector: unknown[];
    algorithmVersion: string;
  };
};
export type EtfTabItem = { id: string; label: string };
export function EtfTabs({ idPrefix, label, tabs, value, onChange }: {
  idPrefix: string; label: string; tabs: readonly EtfTabItem[];
  value: string; onChange: (id: string) => void;
}) {
  const [focusId, setFocusId] = useState(value);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => { setFocusId(value); }, [value]);
  return <div className='etf-tabs' role='tablist' aria-label={label} aria-orientation='horizontal'
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusId(value); }}>
    {tabs.map((tab, index) => <button key={tab.id} id={idPrefix + '-tab-' + tab.id}
      ref={node => { refs.current[tab.id] = node; }} type='button' role='tab'
      aria-selected={value === tab.id} aria-controls={idPrefix + '-panel-' + tab.id}
      tabIndex={(tabs.some(item => item.id === focusId) ? focusId : value) === tab.id ? 0 : -1}
      onClick={() => { setFocusId(tab.id); onChange(tab.id); }}
      onKeyDown={event => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); onChange(tab.id); return;
        } else return;
        event.preventDefault();
        setFocusId(tabs[next].id);
        refs.current[tabs[next].id]?.focus();
      }}>{tab.label}</button>)}
  </div>;
}
export function EtfTabPanel({ idPrefix, id, active, children }: {
  idPrefix: string; id: string; active: boolean; children: ReactNode;
}) {
  return <section className='etf-chapter etf-tab-panel' id={idPrefix + '-panel-' + id}
    data-etf-panel={id} role='tabpanel' aria-labelledby={idPrefix + '-tab-' + id}
    hidden={!active} inert={!active} tabIndex={0}>{children}</section>;
}
type ReaderState = {
  tab: string;
  cell: { sector: string; etf: string } | null;
  stock: string;
  holdingFund: string;
  holdingSector: string;
  holdingQuery: string;
  holdingSort: string;
  institutionalStock: string;
  sourceFunds: string[];
  holdingOpen: string[];
  overviewOpen: string[];
};
type ReaderPosition = { y: number; tables: number[] };
type ReaderUpdate = (patch: Partial<ReaderState>, push?: boolean) => void;
function readSession<T>(key: string, fallback: T): T {
  try { return JSON.parse(window.sessionStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeSession(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Reading remains available without browser storage. */ }
}
function reportTabs(report: ReaderEtfReport): EtfTabItem[] {
  return [
    { id: 'summary', label: '分析總結' }, { id: 'heatmap', label: '產業異動' },
    { id: 'matrix', label: '基金共識' }, { id: 'operations', label: '營運對照' },
    { id: 'sources', label: '數據與來源' },
    ...(report.holdings?.length ? [{ id: 'holdings', label: '持股配置' }] : []),
    ...(report.institutional ? [{ id: 'institutional', label: '法人對照' }] : []),
  ];
}
function readerKey(report: ReaderEtfReport, version: number) {
  return 'pocketstocks:etf:reader:' + report.id + ':v' + version;
}
function readReaderState(report: ReaderEtfReport, version: number, preview: boolean): ReaderState {
  const holdings = report.holdings || [];
  const sectors = [...new Set(holdings.flatMap(fund => fund.rows.map(row => row.sector || '未分類')))];
  const defaults: ReaderState = {
    tab: 'summary', cell: null, stock: '', holdingFund: holdings[0]?.etf || '',
    holdingSector: sectors[0] || '', holdingQuery: '', holdingSort: 'code',
    institutionalStock: report.institutional?.stocks[0]?.code || '',
    sourceFunds: [], holdingOpen: [], overviewOpen: [],
  };
  const saved = preview ? defaults : readSession<Partial<ReaderState>>(readerKey(report, version), defaults);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const get = (key: string, stored: unknown, fallback: string) => {
    const value = !preview && params.has(key) ? params.get(key) : stored;
    return typeof value === 'string' && value.length <= 120 ? value : fallback;
  };
  const tab = get('tab', saved.tab, defaults.tab);
  const selectedCell = !preview && params.has('cellFund')
    ? { etf: params.get('cellFund') || '', sector: params.get('cellSector') || '' } : saved.cell;
  const fund = get('fund', saved.holdingFund, defaults.holdingFund);
  const sector = get('sector', saved.holdingSector, defaults.holdingSector);
  const sort = get('sort', saved.holdingSort, defaults.holdingSort);
  const institutionalStock = get('institution', saved.institutionalStock, defaults.institutionalStock);
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 240).slice(0, 300) : [];
  return {
    tab: reportTabs(report).some(item => item.id === tab) ? tab : 'summary',
    cell: selectedCell && typeof selectedCell === 'object' &&
      report.funds.some(item => item.code === selectedCell.etf) &&
      report.rows.some(item => item.sector === selectedCell.sector)
        ? { etf: selectedCell.etf, sector: selectedCell.sector } : null,
    stock: get('stock', saved.stock, ''), holdingFund: holdings.some(item => item.etf === fund) ? fund : defaults.holdingFund,
    holdingSector: sectors.includes(sector) ? sector : defaults.holdingSector,
    holdingQuery: get('q', saved.holdingQuery, ''),
    holdingSort: ['code', 'weight', 'shares-delta', 'weight-delta'].includes(sort) ? sort : 'code',
    institutionalStock: report.institutional?.stocks.some(item => item.code === institutionalStock) ? institutionalStock : defaults.institutionalStock,
    sourceFunds: list(saved.sourceFunds).filter(code => report.funds.some(item => item.code === code)),
    holdingOpen: list(saved.holdingOpen), overviewOpen: list(saved.overviewOpen),
  };
}
function writeReaderUrl(version: number, state: ReaderState, push: boolean) {
  const path = window.location.hash.split('?')[0];
  const params = new URLSearchParams();
  if (new URLSearchParams(window.location.hash.split('?')[1] || '').get('report') === '1') params.set('report', '1');
  params.set('v', String(version)); params.set('tab', state.tab);
  const fields = { stock: state.stock, fund: state.holdingFund, sector: state.holdingSector,
    q: state.holdingQuery, sort: state.holdingSort, institution: state.institutionalStock,
    cellFund: state.cell?.etf || '', cellSector: state.cell?.sector || '' };
  Object.entries(fields).forEach(([key, value]) => { params.set(key, value); });
  const next = path + '?' + params.toString();
  if (window.location.hash === next) return;
  if (push) window.location.hash = next.slice(1);
  else window.history.replaceState(window.history.state, '', next);
}
function toggleValue(values: string[], key: string, open: boolean) {
  return open ? [...new Set([...values, key])] : values.filter(value => value !== key);
}

const palette = ['#56b7a9', '#609dcc', '#d5ae71', '#ad89c1', '#9dadae', '#c47771', '#8baa7e', '#8195bd'];
const listPosition = { y: 0, hash: '#/active-etf' };

function unwrap<T>(response: { data: unknown }): T {
  const data = response.data;
  return (data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data) as T;
}
function number(value: number | null | undefined, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '未知';
}
function signed(value: number | null | undefined, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未知';
  return (value > 0 ? '+' : value < 0 ? '−' : '') + number(Math.abs(value), digits);
}
function tone(value: number | null | undefined) {
  return typeof value !== 'number' ? 'unknown' : value > 0 ? 'up' : value < 0 ? 'down' : 'neutral';
}
function safeUrl(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function Source({ url, children = '來源' }: { url: string; children?: ReactNode }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only">（開啟新分頁）</span></a> : <span className="etf-muted">來源未提供</span>;
}
function day(value: string | null | undefined) {
  if (!value) return '日期未知';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/');
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    : '日期未知';
}
function snapshotTime(value: string | null | undefined) {
  if (!value) return '日期／時間未知';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day(value) + '（時間未提供）';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '日期／時間未知';
}
function available(coverage: unknown) {
  return !['unknown', 'unavailable', 'missing', 'not-collected'].includes(String(coverage).toLowerCase());
}
function jump(id: string) {
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  target?.focus({ preventScroll: true });
}
function comparableRow(report: ReaderEtfReport, row: FlowRow) {
  const fund = report.funds.find(value => value.code === row.etf);
  return row.sourceDate === report.period.end && !!fund && currentFund(report, fund);
}
function currentFund(report: ReaderEtfReport, fund: EtfReport['funds'][number]) {
  return available(fund.coverage) && fund.holdingsDate === report.period.end;
}
function stockStats(report: ReaderEtfReport, code: string) {
  const rows = report.rows.filter(row => row.code === code);
  const current = rows.filter(row => comparableRow(report, row));
  return {
    rows, up: current.filter(row => row.deltaLots !== null && row.deltaLots > 0).length,
    down: current.filter(row => row.deltaLots !== null && row.deltaLots < 0).length,
    unknown: rows.filter(row => row.deltaLots === null || !comparableRow(report, row)).length,
    total: current.some(row => row.deltaLots !== null) ? current.reduce((sum, row) => sum + (row.deltaLots ?? 0), 0) : null,
    denominator: report.funds.filter(fund => currentFund(report, fund)).length,
  };
}
function Breadth({ report, code }: { report: ReaderEtfReport; code: string }) {
  const stats = stockStats(report, code);
  if (!stats.denominator) return <span className="etf-muted">基金方向未知（研究組 {report.funds.length} 檔）</span>;
  return <><span className="up">增 {stats.up}/{stats.denominator}</span> · <span className="down">減 {stats.down}/{stats.denominator}</span>
    {stats.denominator !== report.funds.length && <small className="etf-muted">可用基金；研究組 {report.funds.length} 檔</small>}
    {stats.unknown > 0 && <small className="etf-muted">另 {stats.unknown} 筆方向未知</small>}</>;
}
function State({ status, onRetry, onBack }: { status: Status | 'empty'; onRetry?: () => void; onBack?: () => void }) {
  const text = status === 'loading' ? ['正在載入研究', '正在確認這篇報告的資料版本。']
    : status === 'empty' ? ['目前沒有已發布的 ETF 報告', '作者完成審閱並發布後，報告會出現在這裡。']
    : status === 'unavailable' ? ['找不到這篇公開報告', '連結可能已失效，或這篇研究尚未發布。']
    : ['ETF 報告暫時無法載入', '請再試一次；我們不會用其他日期的研究補上缺口。'];
  return <section className="etf-state" role={status === 'error' ? 'alert' : 'status'} aria-busy={status === 'loading'}>
    {status === 'loading' ? <FileSearch size={28} aria-hidden="true" /> : <CircleAlert size={28} aria-hidden="true" />}
    <h2>{text[0]}</h2><p>{text[1]}</p>
    {status === 'error' && onRetry && <button type="button" onClick={onRetry}><RotateCcw size={16} />重新嘗試</button>}
    {onBack && <button type="button" onClick={onBack}>返回報告列表</button>}
  </section>;
}

type ReportDetail = { report: ReaderEtfReport | MarkdownReport; version: number; publishedAt: string };
type SnapshotEnvelope = {
  schemaVersion: 2; version: number; publishedAt: string; snapshotId: string; report: null;
  manifest: { pages: { pageNo: number; pageId: string; pageHash: string; byteLength: number }[]; bodyHash: string; bodyBytes: number };
};
function reportRoute() {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const rawVersion = params.get('v');
  const version = rawVersion === null ? null : /^[1-9]\d{0,8}$/.test(rawVersion) ? Number(rawVersion) : -1;
  if (path === '/active-etf') return { id: '', version: null };
  if (path === '/active-etf/history' && params.get('report') !== '1') return { id: '__history__', version: null };
  const match = path.match(/^\/active-etf\/(?:report\/)?([^/]+)$/);
  if (!match || version === -1) return { id: '__invalid__', version };
  try {
    const id = decodeURIComponent(match[1]);
    return { id: /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id) ? id : '__invalid__', version };
  } catch { return { id: '__invalid__', version }; }
}
function isReaderReport(value: unknown, id: string): value is ReaderEtfReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as ReaderEtfReport;
  return report.id === id && [1, 2].includes(report.schemaVersion) &&
    typeof report.title === 'string' && typeof report.excerpt === 'string' &&
    typeof report.period?.start === 'string' && typeof report.period?.end === 'string' &&
    typeof report.sampleNote === 'string' && Array.isArray(report.funds) &&
    Array.isArray(report.rows) && Array.isArray(report.summary) &&
    Array.isArray(report.operations) && Array.isArray(report.warnings);
}
async function sha256(text: string) {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function loadReport(id: string, requestedVersion: number | null, current: () => boolean): Promise<ReportDetail> {
  const path = '/api/etf/reports/' + encodeURIComponent(id);
  const value = unwrap<ReportDetail | SnapshotEnvelope>(await deadline(api.get(path + (requestedVersion ? '?version=' + requestedVersion : ''))));
  if (!current()) throw new Error('superseded');
  if (!Number.isSafeInteger(value.version) || value.version < 1 || typeof value.publishedAt !== 'string' ||
    (requestedVersion !== null && value.version !== requestedVersion)) throw new Error('Unexpected published version');
  if (value.report) {
    if (isMarkdownReport(value.report)) {
      const parsed = await parseEtfResearchSource(researchSource(value.report));
      if (!current()) throw new Error('superseded');
      if (!parsed.report || parsed.report.id !== id || parsed.report.sourceHash !== value.report.sourceHash) throw new Error('Malformed Markdown snapshot');
      return { report: parsed.report, version: value.version, publishedAt: value.publishedAt };
    }
    if (!isReaderReport(value.report, id) || value.report.schemaVersion !== 1) throw new Error('Malformed report');
    return { report: value.report, version: value.version, publishedAt: value.publishedAt };
  }
  const envelope = value as SnapshotEnvelope;
  const manifest = envelope.manifest;
  if (envelope.schemaVersion !== 2 || typeof envelope.snapshotId !== 'string' ||
    !manifest || !Array.isArray(manifest.pages) || !manifest.pages.length ||
    manifest.pages.length > MAX_SNAPSHOT_PAGES || !Number.isSafeInteger(manifest.bodyBytes) ||
    manifest.bodyBytes < 1 || manifest.bodyBytes > MAX_SNAPSHOT_BYTES ||
    !/^[a-f0-9]{64}$/.test(manifest.bodyHash)) throw new Error('Malformed snapshot manifest');
  const pageIds = new Set<string>();
  let declaredBytes = 0;
  manifest.pages.forEach((page, index) => {
    if (page.pageNo !== index || typeof page.pageId !== 'string' || !page.pageId || pageIds.has(page.pageId) ||
      !/^[a-f0-9]{64}$/.test(page.pageHash) || !Number.isSafeInteger(page.byteLength) ||
      page.byteLength < 1 || page.byteLength > MAX_SNAPSHOT_PAGE_BYTES) throw new Error('Malformed snapshot page');
    pageIds.add(page.pageId); declaredBytes += page.byteLength;
  });
  if (declaredBytes !== manifest.bodyBytes) throw new Error('Snapshot size mismatch');
  const contents: string[] = [];
  for (const page of manifest.pages) {
    if (!current()) throw new Error('superseded');
    const result = unwrap<{ snapshotId: string; pageNo: number; pageHash: string; content: string }>(
      await deadline(api.get(path + '/pages/' + page.pageNo + '?version=' + value.version)));
    if (!current()) throw new Error('superseded');
    if (result.snapshotId !== envelope.snapshotId || result.pageNo !== page.pageNo ||
      result.pageHash !== page.pageHash || typeof result.content !== 'string' ||
      new TextEncoder().encode(result.content).byteLength !== page.byteLength ||
      await sha256(result.content) !== page.pageHash) throw new Error('Snapshot page verification failed');
    contents.push(result.content);
  }
  const body = contents.join('');
  if (!current() || new TextEncoder().encode(body).byteLength !== manifest.bodyBytes ||
    await sha256(body) !== manifest.bodyHash) throw new Error('Snapshot verification failed');
  const report: unknown = JSON.parse(body);
  if (!current() || !isReaderReport(report, id) || report.schemaVersion !== 2 || !report.dataLineage ||
    ![report.dataLineage.publicationIds, report.dataLineage.setIds, report.dataLineage.sourceHashes, report.dataLineage.taxonomyVersions].every(values => Array.isArray(values) && values.every(item => typeof item === 'string')) ||
    !Array.isArray(report.dataLineage.versionVector) || typeof report.dataLineage.algorithmVersion !== 'string' ||
    !report.dataLineage.comparison || !('start' in report.dataLineage.comparison) || !('end' in report.dataLineage.comparison)) {
    throw new Error('Malformed complete snapshot');
  }
  return { report, version: value.version, publishedAt: value.publishedAt };
}
export function ActiveEtfView() {
  const [route, setRoute] = useState(reportRoute);
  const { id, version: requestedVersion } = route;
  const [items, setItems] = useState<ReportItem[]>([]);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [retry, setRetry] = useState(0);
  const requestVersion = useRef(0);
  const snapshots = useRef(new Map<string, ReportDetail>());
  useEffect(() => {
    const sync = () => setRoute(reportRoute());
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    let active = true; const generation = ++requestVersion.current;
    const current = () => active && requestVersion.current === generation;
    if (id === '__history__') {
      window.history.replaceState(window.history.state, '', '#/active-etf');
      setRoute(reportRoute()); return;
    }
    const cached = requestedVersion ? snapshots.current.get(id + ':v' + requestedVersion) : null;
    if (cached && !retry) { setDetail(cached); setStatus('ready'); return; }
    setStatus('loading'); setDetail(null);
    if (id === '__invalid__') { setStatus('unavailable'); return; }
    const load = async () => {
      try {
        if (id) {
          const result = await loadReport(id, requestedVersion, current);
          if (current()) {
            snapshots.current.set(id + ':v' + result.version, result);
            setDetail(result); setStatus('ready');
            const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
            if (!params.has('v')) {
              params.set('v', String(result.version));
              window.history.replaceState(window.history.state, '', window.location.hash.split('?')[0] + '?' + params.toString());
              setRoute(reportRoute());
            }
          }
        } else {
          const reports = new Map<string, ReportItem>(); const tokens = new Set<string>(); let token = '';
          do {
            const result = unwrap<{ items: ReportItem[]; nextToken?: string }>(await deadline(api.get('/api/etf/reports' + (token ? '?nextToken=' + encodeURIComponent(token) : ''))));
            if (!current()) return;
            if (!Array.isArray(result.items)) throw new Error('Malformed list');
            result.items.forEach(item => reports.set(item.id, item));
            token = result.nextToken || '';
            if (token && tokens.has(token)) throw new Error('Repeated list cursor');
            if (token) tokens.add(token);
          } while (token && current());
          if (current()) {
            setItems([...reports.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)));
            setStatus('ready');
            window.requestAnimationFrame(() => { if (current()) window.scrollTo({ top: listPosition.y }); });
          }
        }
      } catch (caught) {
        const error = caught as { status?: number; statusCode?: number; response?: { status?: number } };
        if (current()) setStatus((error.status || error.statusCode || error.response?.status) === 404 ? 'unavailable' : 'error');
      }
    };
    void load();
    return () => { active = false; };
  }, [id, requestedVersion, retry]);
  useEffect(() => {
    if (id !== '__history__') document.title = (id ? detail?.report.title || (status === 'loading' ? '正在載入 ETF 研究' : 'ETF 報告') : '主動式 ETF 研究') + ' — PocketStocks';
  }, [id, detail, status]);
  function open(item: ReportItem) {
    listPosition.y = window.scrollY; listPosition.hash = window.location.hash;
    window.location.hash = '/active-etf/' + encodeURIComponent(item.id) + '?v=' + item.version + (item.id === 'history' ? '&report=1' : '');
  }
  function back() { window.location.hash = listPosition.hash.slice(1); }
  if (id === '__history__') return null;
  if (!id) return <EtfReportCatalog items={items} ready={status === 'ready'} loading={status === 'loading'} onOpen={open}
    fallback={status !== 'ready' ? <State status={status} onRetry={() => setRetry(value => value + 1)} /> : !items.length ? <State status='empty' /> : null} />;
  return <section className='etf-workspace'>
    <button className='etf-back' type='button' onClick={back}><ArrowLeft size={16} />返回報告列表</button>
    {status === 'ready' && detail ? isMarkdownReport(detail.report)
      ? <MarkdownEtfReader key={detail.report.id + ':' + detail.version} report={detail.report} version={detail.version} publishedAt={detail.publishedAt} />
      : <ReportBody key={detail.report.id + ':' + detail.version} report={detail.report} version={detail.version} publishedAt={detail.publishedAt} />
      : <State status={status} onRetry={() => setRetry(value => value + 1)} onBack={back} />}
  </section>;
}

function FlowTable({ rows }: { rows: FlowRow[] }) {
  return <div className="etf-table-scroll" tabIndex={0} role="region" aria-label="持股異動證據表">
    <table className="etf-table"><thead><tr><th scope="col">股票／研究板塊</th><th scope="col">股數差（張）</th><th scope="col">權重差（百分點）</th><th scope="col">網站估算</th><th scope="col">日期／來源</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.etf + ':' + row.code}>
        <th scope="row"><strong>{row.name} {row.code}</strong><small>{row.sector}</small></th>
        <td className={tone(row.deltaLots)}>{signed(row.deltaLots)} 張</td>
        <td className={tone(row.weightDeltaPp)}>{signed(row.weightDeltaPp, 4)}</td>
        <td>{row.estimateNtd === null ? '未知' : <>{signed(row.estimateNtd / 1e8, 4)} 億元<small>{signed(row.estimateNtd, 0)} 元</small></>}</td>
        <td><time dateTime={row.sourceDate}>{day(row.sourceDate)}</time><small><Source url={row.sourceUrl}>異動來源</Source></small></td>
      </tr>)}</tbody></table>
  </div>;
}
export function ReportBody({ report, version, publishedAt, preview = false, active = true }: {
  report: ReaderEtfReport; version: number; publishedAt?: string | null; preview?: boolean; active?: boolean;
}) {

  useFooterVersion(version, '文章版本', !preview && active);
  const storageKey = readerKey(report, version);
  const [reading, setReading] = useState<ReaderState>(() => readReaderState(report, version, preview));
  const readingRef = useRef(reading);
  const articleRef = useRef<HTMLElement>(null);
  const positions = useRef<Record<string, ReaderPosition>>(preview ? {} : readSession(storageKey + ':positions', {}));
  const firstPanel = useRef(true);
  const tabs = reportTabs(report);
  const idPrefix = (preview ? 'etf-preview-' : 'etf-report-') + report.id + '-v' + version;
  const [tabNotice, setTabNotice] = useState(() => {
    const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab');
    return !preview && requested && !tabs.some(tab => tab.id === requested) ? '這個分頁不適用於此篇報告，已返回分析總結。' : '';
  });
  function rememberPosition() {
    if (firstPanel.current || !articleRef.current) return;
    const panel = articleRef.current.querySelector<HTMLElement>('[data-etf-panel=' + readingRef.current.tab + ']');
    if (!panel || panel.hidden) return;
    positions.current[readingRef.current.tab] = {
      y: window.scrollY,
      tables: [...panel.querySelectorAll<HTMLElement>('.etf-table-scroll')].map(node => node.scrollLeft),
    };
    if (!preview) writeSession(storageKey + ':positions', positions.current);
  }
  const updateReading: ReaderUpdate = (patch, push = false) => {
    if (patch.tab && patch.tab !== readingRef.current.tab) rememberPosition();
    const next = { ...readingRef.current, ...patch };
    readingRef.current = next;
    setReading(next); setTabNotice('');
    if (!preview) {
      writeSession(storageKey, next);
      writeReaderUrl(version, next, push);
    }
  };
  useEffect(() => {
    if (preview) return;
    const sync = () => {
      const route = reportRoute();
      if (route.id !== report.id || (route.version !== null && route.version !== version)) return;
      rememberPosition();
      const next = readReaderState(report, version, false);
      const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab');
      if (requested && !reportTabs(report).some(tab => tab.id === requested)) setTabNotice('這個分頁不適用於此篇報告，已返回分析總結。');
      else if (next.tab !== readingRef.current.tab) setTabNotice('');
      readingRef.current = next; setReading(next);
      writeSession(storageKey, next);
      writeReaderUrl(version, next, false);
    };
    writeReaderUrl(version, readingRef.current, false);
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, [preview, report.id, version]);
  useLayoutEffect(() => {
    if (!active) return;
    const panel = articleRef.current?.querySelector<HTMLElement>('[data-etf-panel=' + reading.tab + ']');
    if (!panel) return;
    const stored = positions.current[reading.tab];
    const initial = firstPanel.current;
    const frame = window.requestAnimationFrame(() => {
      firstPanel.current = false;
      const tabsElement = articleRef.current?.querySelector<HTMLElement>(':scope > [role=tablist]');
      const heading = articleRef.current?.querySelector<HTMLElement>(':scope > .etf-article-heading');
      const stickyOffset = tabsElement ? Number.parseFloat(window.getComputedStyle(tabsElement).top) || 0 : 0;
      const fallback = initial ? 0 : Math.max(0, (heading?.getBoundingClientRect().bottom || 0) + window.scrollY - stickyOffset);
      window.scrollTo({ top: stored && Number.isFinite(stored.y) && stored.y >= 0 ? stored.y : fallback, behavior: 'instant' });
      panel.querySelectorAll<HTMLElement>('.etf-table-scroll').forEach((node, index) => {
        const left = stored?.tables?.[index];
        if (typeof left === 'number' && Number.isFinite(left) && left >= 0) node.scrollLeft = left;
      });
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-etf-panel][hidden]')) {
        document.getElementById(idPrefix + '-tab-' + reading.tab)?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reading.tab, idPrefix, active]);
  useEffect(() => {
    let frame = 0;
    const save = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; rememberPosition(); }); };
    window.addEventListener('scroll', save, { capture: true, passive: true });
    window.addEventListener('pagehide', rememberPosition);
    return () => {
      window.cancelAnimationFrame(frame); rememberPosition();
      window.removeEventListener('scroll', save, true); window.removeEventListener('pagehide', rememberPosition);
    };
  }, [preview, storageKey]);
  const cell = reading.cell;
  const stock = reading.stock;
  const setCell = (value: ReaderState['cell']) => updateReading({ cell: value });
  const setStock = (value: string) => updateReading({ stock: value });
  const cellTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (active && cell && readingRef.current.tab === 'heatmap' && cellTrigger.current) jump('etf-cell-detail'); }, [cell]);
  const sectors = useMemo(() => [...new Set(report.rows.map(row => row.sector))], [report]);
  const stocks = useMemo(() => [...new Map(report.rows.map(row => [row.code, { code: row.code, name: row.name, sector: row.sector }])).values()].sort((a, b) => a.code.localeCompare(b.code)), [report]);
  const visibleStocks = stocks.filter(item => (item.code + item.name + item.sector).toLowerCase().includes(stock.trim().toLowerCase()));
  const maxCount = Math.max(1, ...sectors.flatMap(sector => report.funds.map(fund => report.rows.filter(row => row.sector === sector && row.etf === fund.code && comparableRow(report, row) && row.deltaLots !== null).length)));
  const cellRows = cell ? report.rows.filter(row => row.etf === cell.etf && row.sector === cell.sector) : [];
  return <article className='etf-article' ref={articleRef}>
    <header className="etf-article-heading"><span className="etf-kicker">{preview ? '私有預覽 · 草稿' : '已發布研究 · v' + version}</span><h1>{report.title}</h1><p>{report.excerpt}</p>
      <dl className="etf-dates"><div><dt>持股期間</dt><dd>{day(report.period.start)} → {day(report.period.end)}</dd></div><div><dt>產業證據補查</dt><dd>{day(report.evidenceDate)}</dd></div>
        <div><dt>{preview ? '基準保存版本' : '發布日期'}</dt><dd>{preview ? (version ? 'r' + version : '尚未保存') : day(publishedAt)}</dd></div></dl>
      <p className="etf-sample-note">{report.sampleNote}</p>
      <p className="etf-muted">研究組：{report.funds.map(fund => fund.code + ' ' + fund.name).join('、')}。已取得 {report.rows.length} 筆異動，非完整交易紀錄。</p>
    </header>
    <EtfTabs idPrefix={idPrefix} label='報告內容' tabs={tabs} value={reading.tab} onChange={tab => updateReading({ tab }, true)} />
    {tabNotice && <p className='etf-note' role='status'>{tabNotice}</p>}
    <EtfTabPanel idPrefix={idPrefix} id='summary' active={reading.tab === 'summary'}><h2 id="etf-summary" tabIndex={-1}>操作分析總結</h2>{preview && <p className="etf-note">預覽不會發布；正式發布前需審閱評論與資料缺口。</p>}
      <div className="etf-commentary">{report.summary.map((comment, index) => <div key={index}><h3>{comment.title}</h3>{comment.text.split(/\n\s*\n/).map((text, n) => <p key={n}>{text}</p>)}
        <div className="etf-source-line">{comment.sources.map((source, n) => <span key={n}><Source url={source.url}>{source.label}</Source>{source.eventDate && <small> · {day(source.eventDate)}</small>}</span>)}</div>
      </div>)}</div>
    </EtfTabPanel>
    <EtfTabPanel idPrefix={idPrefix} id='heatmap' active={reading.tab === 'heatmap'}><h2 id="etf-heatmap" tabIndex={-1}>產業增減持熱力圖</h2><p>每格為異動個股數「增 N｜減 M」。色深代表操作廣度，並非資金金額或基金配置；研究板塊為非重疊業務分組。</p>
      <div className="etf-table-scroll" tabIndex={0} role="region" aria-label="板塊與基金操作廣度熱力圖"><table className="etf-table etf-heatmap"><thead><tr><th scope="col">研究板塊</th>{report.funds.map(fund => <th scope="col" key={fund.code}>{fund.code}<small>{fund.name}</small></th>)}</tr></thead><tbody>
        {sectors.map(sector => <tr key={sector}><th scope="row">{sector}</th>{report.funds.map(fund => {
          const rows = report.rows.filter(row => row.etf === fund.code && row.sector === sector);
          const up = rows.filter(row => comparableRow(report, row) && row.deltaLots !== null && row.deltaLots > 0).length;
          const down = rows.filter(row => comparableRow(report, row) && row.deltaLots !== null && row.deltaLots < 0).length;
          const unknown = rows.filter(row => row.deltaLots === null || !comparableRow(report, row)).length;
          const observed = currentFund(report, fund);
          const hasDirection = up + down > 0 || rows.some(row => comparableRow(report, row) && row.deltaLots === 0);
          const selected = cell?.sector === sector && cell.etf === fund.code;
          const style = { '--cell-opacity': String(0.08 + 0.34 * (up + down) / maxCount) } as CSSProperties;
          return <td key={fund.code}><button className={'etf-heat-cell ' + (up && down ? 'mixed' : up ? 'up-cell' : down ? 'down-cell' : 'quiet') + (selected ? ' selected' : '')} style={style} type="button" data-etf-cell={sector + '|' + fund.code} aria-expanded={selected} aria-controls="etf-cell-detail" aria-label={sector + '，' + fund.code + '，' + (observed && hasDirection ? '增持' + up + '檔，減持' + down + '檔' : observed && !rows.length ? '未觀測' : '資料未知') + '，展開證據'} onClick={event => { cellTrigger.current = event.currentTarget; setCell(selected ? null : { sector, etf: fund.code }); }}>
            {observed && hasDirection ? <><span>增 {up}｜減 {down}</span><small>{unknown ? unknown + ' 筆方向未知' : up && down ? '雙向操作' : rows.length + ' 筆已取得'}</small></> : observed && !rows.length ? <><span>未觀測</span><small>來源清單未列此板塊</small></> : <><span>未知</span><small>資料未取得／不可比</small></>}
          </button></td>;
        })}</tr>)}
      </tbody><tfoot><tr><th scope="row">來源筆數</th>{report.funds.map(fund => <td key={fund.code}>{available(fund.coverage) ? report.rows.filter(row => row.etf === fund.code).length + ' 筆' : '未知'}</td>)}</tr></tfoot></table></div>
      <p className="etf-note">未觀測：已取得的來源清單未列出；未知：資料未取得或不可比較。未列出的格子不填零，也不推定無持股或官方零操作。日期不可比的原值保留於明細，不計入本期方向。</p>
      {cell && <div id="etf-cell-detail" className="etf-expanded" tabIndex={-1}><div className="etf-expanded-heading"><h3>{cell.sector} · {cell.etf}</h3><button type="button" onClick={() => { const trigger = cellTrigger.current || [...(articleRef.current?.querySelectorAll<HTMLButtonElement>('[data-etf-cell]') || [])].find(button => button.dataset.etfCell === cell.sector + '|' + cell.etf); setCell(null); trigger?.focus(); }} aria-label="收合板塊證據"><X size={18} /></button></div>
        {cellRows.length ? <FlowTable rows={cellRows} /> : <p>{available(report.funds.find(fund => fund.code === cell.etf)?.coverage) ? '來源清單未列出此板塊異動，不能推定股數不變。' : '此基金資料未知，無法判定板塊方向。'}</p>}
      </div>}
    </EtfTabPanel>
    <EtfTabPanel idPrefix={idPrefix} id='matrix' active={reading.tab === 'matrix'}><h2 id="etf-matrix" tabIndex={-1}>增減持共識與分歧</h2><p>同股保留各基金方向與已取得合計；不同股票的張數不作為資金強度排行。</p>
      <div className="etf-filter"><CatalogSearch label='搜尋股票或板塊' placeholder='股票代碼、名稱或板塊' value={stock} onChange={setStock} maxLength={120} clearLabel='清除股票搜尋' /><button type="button" onClick={() => setStock('')}><RotateCcw size={15} />重設</button><span>{visibleStocks.length} / {stocks.length} 檔</span></div>
      <div className="etf-table-scroll" tabIndex={0} role="region" aria-label="個股與五檔基金異動矩陣"><table className="etf-table etf-matrix"><thead><tr><th scope="col">股票</th>{report.funds.map(fund => <th scope="col" key={fund.code}>{fund.code}<small>{fund.name}</small></th>)}<th scope="col">已取得同股合計</th><th scope="col">基金廣度</th></tr></thead><tbody>
        {visibleStocks.map(item => { const stats = stockStats(report, item.code); return <tr key={item.code}><th scope="row">{item.name} {item.code}<small>{item.sector}</small></th>{report.funds.map(fund => {
          const row = report.rows.find(value => value.etf === fund.code && value.code === item.code);
          return <td key={fund.code} className={row && comparableRow(report, row) ? tone(row.deltaLots) : 'unknown'}>{row && comparableRow(report, row) ? <><span>{signed(row.deltaLots)}{row.deltaLots !== null && ' 張'}</span><small><Source url={row.sourceUrl}>查證 {day(row.sourceDate)}</Source></small></> : row ? <>未知<small>日期不可比 · <Source url={row.sourceUrl}>{day(row.sourceDate)}</Source></small></> : currentFund(report, fund) ? '未觀測' : '未知'}</td>;
        })}<td className={tone(stats.total)}>{signed(stats.total)}{stats.total !== null && ' 張'}{stats.unknown > 0 && <small>僅已知值，另有未知</small>}</td><td><Breadth report={report} code={item.code} /></td></tr>; })}
        {!visibleStocks.length && <tr><td colSpan={report.funds.length + 3}>沒有符合搜尋的股票；重設可恢復全部個股。</td></tr>}
      </tbody></table></div>
    </EtfTabPanel>
    <EtfTabPanel idPrefix={idPrefix} id='operations' active={reading.tab === 'operations'}><h2 id="etf-operations" tabIndex={-1}>營運成長與基金操作對照</h2><p>營收、毛利率、認證與量產規劃各保留原期間與單位。消息同向不證明交易因果，也不等於已實現獲利改善。</p>
      {report.operations.length ? <div className="etf-table-scroll" tabIndex={0} role="region" aria-label="營運證據與基金操作對照表"><table className="etf-table etf-operations"><thead><tr><th scope="col">公司</th><th scope="col">營運證據／期間</th><th scope="col">公告／事件日期</th><th scope="col">基金操作</th><th scope="col">直接來源</th></tr></thead><tbody>
        {report.operations.map((item, index) => <tr key={item.code + ':' + index}><th scope="row">{item.name}<small>{item.code}</small></th><td>{item.metrics.map((metric, n) => <div className="etf-metric-line" key={n}><strong>{metric.label}：{metric.value}</strong><small>{metric.period}</small></div>)}</td><td>{day(item.eventDate)}</td><td><Breadth report={report} code={item.code} /><small>已取得同股合計 {signed(stockStats(report, item.code).total)} 張</small></td><td><Source url={item.sourceUrl}>營運來源</Source></td></tr>)}
      </tbody></table></div> : <p className="etf-note">本篇尚未取得可核對的公司營運證據；操作原因仍未知。</p>}
    </EtfTabPanel>
    <EtfTabPanel idPrefix={idPrefix} id='sources' active={reading.tab === 'sources'}><h2 id="etf-sources" tabIndex={-1}>數據與來源</h2><p>已取得異動清單、完整兩端持股、官方核對與份額對帳是不同狀態。網站估算不等於成交或申購金額；新增、退出及不變須有完整兩端證据。</p>
      {!!report.warnings.length && <ul className="etf-warnings">{report.warnings.map((warning, n) => <li key={n}>{warning}</li>)}</ul>}
      {report.dataLineage && <details className='etf-lineage'><summary>每日資料版本與來源追溯</summary><dl>
        <div><dt>發布資料版本</dt><dd>{report.dataLineage.publicationIds.join('、') || '未提供'}</dd></div>
        <div><dt>資料集版本</dt><dd>{report.dataLineage.setIds.join('、') || '未提供'}</dd></div>
        <div><dt>分類版本</dt><dd>{report.dataLineage.taxonomyVersions.join('、') || '未提供'}</dd></div>
        <div><dt>交易日曆版本</dt><dd>{report.dataLineage.calendarVersion || '未提供'}</dd></div>
        <div><dt>比較期間</dt><dd>{day(report.dataLineage.comparison.start)} → {day(report.dataLineage.comparison.end)}</dd></div>
        <div><dt>計算版本</dt><dd>{report.dataLineage.algorithmVersion}</dd></div>
        <div><dt>來源識別</dt><dd>{report.dataLineage.sourceHashes.join('、') || '未提供'}</dd></div>
        <div><dt>資料版本明細</dt><dd>{JSON.stringify(report.dataLineage.versionVector)}</dd></div>
      </dl></details>}
      {report.funds.map(fund => {
        const rows = report.rows.filter(row => row.etf === fund.code);
        const knownEstimates = rows.filter(row => row.estimateNtd !== null);
        return <details className='etf-fund-evidence' key={fund.code} open={reading.sourceFunds.includes(fund.code)} onToggle={event => updateReading({ sourceFunds: toggleValue(readingRef.current.sourceFunds, fund.code, event.currentTarget.open) })}><summary><span><strong>{fund.code} {fund.name}</strong><small>來源狀態：{fund.coverage} · 持股日期 {day(fund.holdingsDate)}</small></span><span>{rows.length} 筆<ChevronDown size={16} aria-hidden="true" /></span></summary>
          <div><p className="etf-note">選樣規模 {fund.aumBillion === null ? '未知' : number(fund.aumBillion * 10, 2) + ' 億元'}，排行快照 {snapshotTime(fund.rankAsOf)}（台北時間）；不能當作收盤AUM或交易份額核對。<Source url={fund.sourceUrl}>基金來源</Source></p>
            {rows.length ? <><FlowTable rows={rows} /><p className="etf-note">逐列已知網站估算合計 {signed(knownEstimates.reduce((sum, row) => sum + (row.estimateNtd ?? 0), 0) / 1e8, 4)} 億元；{rows.length - knownEstimates.length} 筆估算未知。這是來源清單的估算，非實際成交金額。</p></> : <p>未取得可列示的異動證據，不能補成零操作。</p>}
          </div>
        </details>;
      })}
    </EtfTabPanel>
    {!!report.holdings?.length && <EtfTabPanel idPrefix={idPrefix} id='holdings' active={reading.tab === 'holdings'}><Holdings report={report} reading={reading} updateReading={updateReading} /></EtfTabPanel>}
    {!!report.institutional && <EtfTabPanel idPrefix={idPrefix} id='institutional' active={reading.tab === 'institutional'}><Institutions report={report} reading={reading} updateReading={updateReading} /></EtfTabPanel>}
    <footer className="etf-footer">本報告為歷史研究快照，持股期間 {day(report.period.start)} → {day(report.period.end)}。研究解讀不能證明經理人意圖。</footer>
  </article>;
}

function Holdings({ report, reading, updateReading }: { report: ReaderEtfReport; reading: ReaderState; updateReading: ReaderUpdate }) {
  const holdings = report.holdings || [];
  const selected = reading.holdingFund;
  const setSelected = (holdingFund: string) => updateReading({ holdingFund });
  const sectors = useMemo(() => [...new Set(holdings.flatMap(fund => fund.rows.map(row => row.sector || '未分類')))], [holdings]);
  const sector = reading.holdingSector;
  const query = reading.holdingQuery;
  const sort = reading.holdingSort;
  const setSector = (holdingSector: string) => updateReading({ holdingSector });
  const setQuery = (holdingQuery: string) => updateReading({ holdingQuery });
  const setSort = (holdingSort: string) => updateReading({ holdingSort });
  const fund = holdings.find(item => item.etf === selected);
  function sectorStats(etf: string, name: string) {
    const item = holdings.find(value => value.etf === etf);
    if (!item) return null;
    const rows = item.rows.filter(row => (row.sector || '未分類') === name);
    return { weight: rows.reduce((sum, row) => sum + (row.weightPct ?? 0), 0), knownCount: rows.filter(row => row.weightPct !== null).length, imprecise: rows.filter(row => row.weightPct === null).length, count: rows.length };
  }
  function sectorWeightText(stats: ReturnType<typeof sectorStats>) {
    if (!stats) return '未知';
    if (!stats.count) return '來源未列';
    if (!stats.knownCount) return '精確比例未知';
    return (stats.imprecise ? '可讀小計 ' : '') + number(stats.weight, 4) + '%';
  }
  function weightText(row: NonNullable<EtfReport['holdings']>[number]['rows'][number]) {
    if (row.weightPct !== null) return (row.weightRaw || number(row.weightPct, 4) + '%') + (row.weightPct === 0 && (row.shares ?? 0) > 0 ? '（四捨五入，仍有持股）' : '');
    if (row.weightUpperBoundPct !== null) return row.weightRaw || '低於 ' + number(row.weightUpperBoundPct, 4) + '%';
    return row.weightRaw || '未知';
  }
  if (!holdings.length) return <><h2>完整持股與配置</h2><p>這篇 flows 未附完整持股。不能以異動清單推算產業配置或個股占基金比例。</p></>;
  const baseline = fund?.baseline;
  const provenSets = !!fund?.currentComplete && !!baseline?.complete;
  const currentMap = new Map(fund?.rows.map(row => [row.code, row]) || []);
  const initialMap = new Map(baseline?.rows.map(row => [row.code, row]) || []);
  const union = [...(fund?.rows || []), ...(baseline?.rows.filter(row => !currentMap.has(row.code)) || [])];
  const rows = union.filter(row => (row.code + row.name + row.sector).toLowerCase().includes(query.trim().toLowerCase()));
  function pair(code: string) {
    const current = currentMap.get(code); const initial = initialMap.get(code);
    const endShares = current ? current.shares : provenSets ? 0 : null;
    const startShares = initial ? initial.shares : provenSets ? 0 : null;
    const endWeight = current ? current.weightPct : provenSets ? 0 : null;
    const startWeight = initial ? initial.weightPct : provenSets ? 0 : null;
    const deltaLots = baseline && endShares !== null && startShares !== null ? (endShares - startShares) / 1000 : null;
    const deltaPp = baseline && endWeight !== null && startWeight !== null ? endWeight - startWeight : null;
    return { current, initial, endShares, startShares, deltaLots, deltaPp };
  }
  const sorted = [...rows].sort((a, b) => {
    const aa = pair(a.code); const bb = pair(b.code);
    return sort === 'weight' ? (b.weightPct ?? -1) - (a.weightPct ?? -1) || a.code.localeCompare(b.code)
      : sort === 'shares-delta' ? (bb.deltaLots ?? -Infinity) - (aa.deltaLots ?? -Infinity) || a.code.localeCompare(b.code)
      : sort === 'weight-delta' ? (bb.deltaPp ?? -Infinity) - (aa.deltaPp ?? -Infinity) || a.code.localeCompare(b.code)
      : a.code.localeCompare(b.code);
  });
  const selectedSectors = [...new Set(sorted.map(row => row.sector || '未分類'))];
  return <div className="etf-holdings"><h2>完整持股與配置</h2><p>配置以各原基金為分母；非精確權重與未知保留原字串。五檔概覽始終保留，其他未列資產不稱現金。</p>
    <ul className="etf-shared-legend" aria-label="共用產業配色">{sectors.map((name, index) => <li key={name}><i style={{ background: palette[index % palette.length] }} aria-hidden="true" />{name}</li>)}<li><i style={{ background: '#2d3a40' }} aria-hidden="true" />其他未列／未精確拆分資產</li></ul><div className="etf-allocation-overview">{report.funds.map(item => {
      const hf = holdings.find(value => value.etf === item.code);
      const known = hf?.rows.reduce((sum, row) => sum + (row.weightPct ?? 0), 0) ?? null;
      const imprecise = hf?.rows.filter(row => row.weightPct === null).length || 0;
      let offset = 0; const length = 2 * Math.PI * 44;
      return <section key={item.code} className={'etf-allocation-item' + (selected === item.code ? ' selected' : '')}><button type="button" aria-pressed={selected === item.code} onClick={() => { setSelected(item.code); setQuery(''); }}><strong>{item.code}</strong><span>{item.name}</span></button>
        <div className="etf-donut"><svg viewBox="0 0 120 120" role="img" aria-label={item.code + '，已知股票比重' + number(known, 4) + '百分比，' + imprecise + '筆權重非精確；詳細比例請讀表格'}>
          <circle cx="60" cy="60" r="44" fill="none" stroke="#2d3a40" strokeWidth="13" />
          {known !== null && known <= 100 && sectors.map((name, index) => {
            const value = sectorStats(item.code, name)?.weight || 0; const start = offset; offset += value;
            return value > 0 ? <circle key={name} cx="60" cy="60" r="44" fill="none" stroke={palette[index % palette.length]} strokeWidth="13" strokeDasharray={value / 100 * length + ' ' + length} strokeDashoffset={-start / 100 * length} transform="rotate(-90 60 60)" /> : null;
          })}
          <text x="60" y="56" textAnchor="middle" fill="#e8eef0" fontSize="17">{number(known, 2)}{known !== null && '%'}</text><text x="60" y="74" textAnchor="middle" fill="#a6b1b6" fontSize="9">可讀股票比重</text>
        </svg></div>
        <small>選樣規模 {item.aumBillion === null ? '未知' : number(item.aumBillion * 10, 2) + ' 億元'}</small><small>持股日期 {day(hf?.date)}</small>
        {known !== null && <small>{imprecise ? '尚未精確拆分資產' : '其他未列資產'} {number(Math.max(0, 100 - known), 4)}%；{imprecise} 筆權重非精確</small>}
        {!hf && <p className="etf-note">完整持股未取得</p>}
        <details open={reading.overviewOpen.includes(item.code)} onToggle={event => updateReading({ overviewOpen: toggleValue(reading.overviewOpen, item.code, event.currentTarget.open) })}><summary>產業比例明細</summary><ul className="etf-allocation-legend">{sectors.map((name, index) => { const stats = sectorStats(item.code, name); return <li key={name}><i style={{ background: palette[index % palette.length] }} aria-hidden="true" /><span>{name}</span><strong>{sectorWeightText(stats)}</strong>{stats && stats.imprecise > 0 && <small>另 {stats.imprecise} 筆非精確</small>}</li>; })}</ul></details>
      </section>;
    })}</div>
    <div className="etf-sector-comparison"><label>比較產業<CatalogSelect label='比較產業' value={sector} options={sectors.map(name => ({value:name,label:name}))} onChange={setSector} /></label><p className="etf-note">五檔固定 0–100% 尺度；長條為可讀權重小計，非精確資料另列。</p>{report.funds.map(item => { const stats = sectorStats(item.code, sector); return <div className="etf-percent-row" key={item.code}><strong>{item.code}</strong><div className="etf-percent-track"><span style={{ width: Math.min(100, stats?.weight || 0) + '%', background: palette[Math.max(0, sectors.indexOf(sector)) % palette.length] }} /></div><span>{sectorWeightText(stats)}{stats && stats.imprecise > 0 && <small>另 {stats.imprecise} 筆非精確</small>}</span></div>; })}<div className="etf-percent-scale"><span>0%</span><span>50%</span><span>100%</span></div></div>
    <div className="etf-filter"><label>目前基金<CatalogSelect label='目前基金' value={selected} options={report.funds.map(item => ({value:item.code,label:item.code + ' ' + item.name}))} onChange={value => {setSelected(value);setQuery('');}} /></label><CatalogSearch label='搜尋持股' placeholder='股票代碼、名稱或產業' value={query} onChange={setQuery} maxLength={120} clearLabel='清除持股搜尋' /><label>排序<CatalogSelect label='持股排序' value={sort} onChange={setSort} options={[{value:'code',label:'股票代碼'},{value:'weight',label:'可讀權重由高至低'},{value:'shares-delta',label:'股數差由高至低'},{value:'weight-delta',label:'權重差由高至低'}]} /></label><button type="button" onClick={() => { setQuery(''); setSort('code'); }}>重設</button></div>
    {fund ? <><h3>{fund.etf} · {day(fund.date)} · {fund.rows.length} 筆持股</h3><p className="etf-note">{fund.note} <Source url={fund.sourceUrl}>完整持股來源</Source></p><p className="etf-note">{baseline ? <>持股端點 {day(baseline.date)} → {day(fund.date)}。<Source url={baseline.sourceUrl}>期初來源</Source>。{provenSets ? '完整兩端證券集合可判定新增／退出。' : '兩端完整度尚未確認，來源未列證券不能填零或判定新增／退出。'}</> : '未取得期初完整持股，股數及權重差顯示未知，不將所有股票當作新增。'} 此處依完整持股端點計算；flows 的來源異動為不同證據，不混算。</p>
      {selectedSectors.map(name => <details className='etf-fund-evidence' key={name} open={reading.holdingOpen.includes(fund.etf + ':' + name)} onToggle={event => updateReading({ holdingOpen: toggleValue(reading.holdingOpen, fund.etf + ':' + name, event.currentTarget.open) })}><summary><span><strong>{name}</strong><small>個股比例以 {fund.etf} 原基金為分母</small></span><span>{sectorWeightText(sectorStats(fund.etf, name))}{(sectorStats(fund.etf, name)?.imprecise ?? 0) > 0 && <small>另 {sectorStats(fund.etf, name)?.imprecise} 筆非精確</small>}<ChevronDown size={16} /></span></summary>
        <div className="etf-table-scroll" role="region" aria-label={fund.etf + name + '全部持股'} tabIndex={0}><table className="etf-table"><thead><tr><th scope="col">股票</th><th scope="col">市場</th><th scope="col">期初股數（張）</th><th scope="col">期末股數（張）</th><th scope="col">股數差（張）</th><th scope="col">期初占基金比例</th><th scope="col">期末占基金比例</th><th scope="col">權重差（百分點）</th><th scope="col">新增／退出</th></tr></thead><tbody>
          {sorted.filter(row => (row.sector || '未分類') === name).map(row => {
            const values = pair(row.code);
            return <tr key={row.code}><th scope="row">{row.name} {row.code}</th><td>{row.market || '未知'}</td>
              <td>{values.startShares === null ? '未知' : number(values.startShares / 1000)}{values.startShares !== null && <small>{number(values.startShares, 0)} 股</small>}</td>
              <td>{values.endShares === null ? '未知' : number(values.endShares / 1000)}{values.endShares !== null && <small>{number(values.endShares, 0)} 股</small>}</td>
              <td className={tone(values.deltaLots)}>{signed(values.deltaLots)}</td>
              <td>{values.initial ? weightText(values.initial) : provenSets ? '無持股（完整來源）' : '未知'}</td>
              <td>{values.current ? weightText(values.current) : provenSets ? '無持股（完整來源）' : '未知'}</td>
              <td className={tone(values.deltaPp)}>{signed(values.deltaPp, 4)}</td>
              <td>{!provenSets ? '未能判定' : !values.initial ? '新增' : !values.current ? '退出' : values.deltaLots === 0 ? '股數不變' : '既有持股'}</td>
            </tr>;
          })}
        </tbody></table></div></details>)}
      {!rows.length && <p className="etf-note">沒有符合搜尋的持股；重設可恢復完整來源表。</p>}
    </> : <p className="etf-note">這檔基金沒有完整持股資料，不能從 flows 異動推算配置。</p>}
  </div>;
}
function Institutions({ report, reading, updateReading }: { report: ReaderEtfReport; reading: ReaderState; updateReading: ReaderUpdate }) {
  const data = report.institutional;
  const code = reading.institutionalStock;
  const setCode = (institutionalStock: string) => updateReading({ institutionalStock });
  if (!data) return <><h2>三大法人對照</h2><p>這篇 flows 未附法人資料。此資料並非發布必填，缺口不補零。</p></>;
  const fields = [['foreignShares', '外資'], ['trustShares', '投信'], ['dealerShares', '自營商自行'], ['hedgeShares', '自營商避險']] as const;
  const item = data.stocks.find(stock => stock.code === code);
  const max = Math.max(1, ...data.stocks.flatMap(stock => fields.map(([key]) => Math.abs(stock[key] ?? 0))));
  const etf = stockStats(report, code);
  return <div className="etf-institutions"><h2>三大法人對照</h2><p>{day(data.date)} · {data.marketScope}。市場金額與個股股數分開；ETF 持股差不加進投信買賣超。自營避險不直接代表方向性看多／看空。</p>
    <table className="etf-table etf-market"><caption>市場買賣超（億元，原值單位新台幣元）</caption><thead><tr>{['外資', '投信', '自營自行', '自營避險', '來源市場合計'].map(name => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody><tr>{(['foreign', 'trust', 'dealer', 'hedge', 'total'] as const).map(key => <td key={key} className={tone(data.market[key])}>{data.market[key] === null ? '未知' : signed(data.market[key]! / 1e8, 4)}</td>)}</tr></tbody></table>
    <div className="etf-filter"><label>個股<CatalogSelect label='個股' value={code} onChange={setCode} options={data.stocks.map(stock => ({value:stock.code,label:stock.code + ' ' + stock.name + ' · ' + stock.market}))} /></label><button type="button" onClick={() => setCode(data.stocks[0]?.code || '')}>重設</button></div>
    {item ? <><h3>{item.name} {item.code} · {item.market}</h3><p className="etf-note">以下固定使用本來源全部個股的共同尺度；正負張數除以 1,000，精確股數保留於表格。</p>
      <div className="etf-institution-bars">{fields.map(([key, label]) => { const value = item[key]; const width = value === null ? 0 : Math.abs(value) / max * 50; return <div className="etf-institution-bar" key={key}><strong>{label}</strong><div className="etf-diverging-track"><span className={tone(value)} style={{ left: value !== null && value < 0 ? 50 - width + '%' : '50%', width: width + '%' }} /></div><span className={tone(value)}>{value === null ? '未知' : signed(value / 1000, 3) + ' 張'}</span></div>; })}</div>
      <table className="etf-table"><caption>法人原始股數及同股 ETF 證據</caption><thead><tr><th scope="col">資料</th><th scope="col">原值</th><th scope="col">日期／來源</th></tr></thead><tbody>{fields.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td className={tone(item[key])}>{signed(item[key], 0)}{item[key] !== null && ' 股'}</td><td>{day(data.date)} · <Source url={item.sourceUrl}>法人來源</Source></td></tr>)}<tr><th scope="row">ETF 已取得同股持股差（另列）</th><td>{signed(etf.total)}{etf.total !== null && ' 張'}<small><Breadth report={report} code={code} /></small></td><td>{day(report.period.start)} → {day(report.period.end)}{data.date !== report.period.end && <small>日期不同，不納入同日方向判斷</small>}</td></tr></tbody></table>
      <p className="etf-note">{etf.rows.length ? '僅對照已取得持股差，不能推定法人跟單或基金代表全市場。' : '本篇 ETF 來源清單未觀測此股異動；不能解讀為零操作。'}</p>
    </> : <p className="etf-note">所選股票資料未取得。</p>}
    <div className="etf-source-line">{data.sources.map((source, n) => <Source key={n} url={source.url}>{source.label} · {day(source.eventDate)}</Source>)}</div>
  </div>;
}

export type AuthorProps = {
  sessionToken: string;
  request: (action: EtfAuthorAction, payload: Record<string, unknown>) => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
  onSchema2Import?: (raw: string) => void;
  onSchema2Open?: (bodyId: string) => void;
};
type EtfAuthorListEntry = EtfEntry | (Omit<EtfEntry, 'draft'> & { draft: null; schemaVersion: 2; bodyId: string });
type PendingOperation = {
  action: 'save' | 'publish' | 'visibility'; requestId: string; payload?: Record<string, unknown>;
};
const pendingStorageKey = 'pocketstocks_etf_pending_operation';
function pendingFromStorage(): PendingOperation | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(pendingStorageKey) || 'null') as PendingOperation | null;
    return value && ['save', 'publish', 'visibility'].includes(value.action) && typeof value.requestId === 'string' && value.requestId.length < 150 ? { action: value.action, requestId: value.requestId } : null;
  } catch { return null; }
}
function savePendingMarker(value: PendingOperation | null) {
  try {
    if (value) window.sessionStorage.setItem(pendingStorageKey, JSON.stringify({ action: value.action, requestId: value.requestId }));
    else window.sessionStorage.removeItem(pendingStorageKey);
  } catch { /* Current-tab operation state remains authoritative when storage is unavailable. */ }
}
function entryFrom(value: unknown): EtfEntry {
  const item = (value as { entry?: EtfEntry })?.entry;
  if (!item || !item.draft || !Array.isArray(item.draft.rows) || !Number.isInteger(item.revision) || item.id !== item.draft.id) throw new Error('Invalid author entry');
  return item;
}
function errorCode(value: unknown) {
  const item = value as { status?: number; statusCode?: number; response?: { status?: number } };
  return item?.status || item?.statusCode || item?.response?.status;
}
function deadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof window.setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('request_timeout')), 20000); });
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
}
export function ActiveEtfAuthorView({ sessionToken, request, onDirtyChange, onSchema2Import, onSchema2Open }: AuthorProps) {
  const requestRef = useRef(request); requestRef.current = request;
  const dirtyRef = useRef(onDirtyChange); dirtyRef.current = onDirtyChange;
  const [raw, setRaw] = useState('');
  const [savedRaw, setSavedRaw] = useState('');
  const [entry, setEntry] = useState<EtfEntry | null>(null);
  useFooterVersion(entry?.publishedVersion, '公開版本');
  const [items, setItems] = useState<EtfAuthorListEntry[]>([]);
  const [listStatus, setListStatus] = useState<Status>('loading');
  const [listRetry, setListRetry] = useState(0);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validatedRaw, setValidatedRaw] = useState('');
  const authorTabs = [
    { id: 'import', label: '資料匯入' }, { id: 'validation', label: '驗證與缺口' },
    { id: 'preview', label: '預覽' }, { id: 'history', label: '發布紀錄' },
  ];
  const [authorTab, setAuthorTab] = useState(() => {
    const value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('authorTab');
    return authorTabs.some(tab => tab.id === value) ? value! : 'import';
  });
  const mode = authorTab === 'preview' ? 'preview' : 'edit';
  function selectAuthorTab(value: string, push = false) {
    const tab = authorTabs.some(item => item.id === value) ? value : 'import';
    setAuthorTab(tab);
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    params.set('workflow', 'reports'); params.set('authorTab', tab);
    if (entry?.id) params.set('reportId', entry.id);
    const next = '#/admin/active-etf?' + params.toString();
    if (window.location.hash !== next) {
      if (push) window.location.hash = next.slice(1);
      else window.history.replaceState(window.history.state, '', next);
    }
  }
  const setMode = (value: 'edit' | 'preview') => selectAuthorTab(value === 'preview' ? 'preview' : 'import');
  const [replacementAction, setReplacementAction] = useState<(() => void) | null>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  const initialReportId = useRef(new URLSearchParams(window.location.hash.split('?')[1] || '').get('reportId'));

  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'neutral'; message: string } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(pendingFromStorage);
  const operationRef = useRef<PendingOperation | null>(pending);
  const generation = useRef(0);
  const editVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const dirty = raw !== savedRaw;
  const authorLocation = useRef({ id: entry?.id, dirty, busy, pending: !!pending });
  authorLocation.current = { id: entry?.id, dirty, busy, pending: !!pending };
  const valid = validatedRaw === raw && !!validation?.report && validation.errors.length === 0;
  const canPublish = valid && entry && !dirty && reviewed && !pending && !busy && (entry.publishedVersion === 0 || entry.hasUnpublishedChanges);

  useEffect(() => { dirtyRef.current(dirty || !!pending); }, [dirty, pending]);
  useEffect(() => () => dirtyRef.current(false), []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, pending]);
  useEffect(() => {
    const current = ++generation.current; let active = true;
    setListStatus('loading');
    const load = async () => {
      try {
        const entries = new Map<string, EtfAuthorListEntry>(); const seen = new Set<string>(); let nextToken = '';
        do {
          const result = await deadline(requestRef.current('list', nextToken ? { nextToken } : {})) as { items: EtfAuthorListEntry[]; nextToken?: string };
          if (!Array.isArray(result.items)) throw new Error('Malformed author list');
          result.items.forEach(item => entries.set(item.id, item));
          nextToken = result.nextToken || '';
          if (nextToken && seen.has(nextToken)) throw new Error('Repeated author cursor');
          if (nextToken) seen.add(nextToken);
        } while (nextToken && active && generation.current === current);
        if (active && generation.current === current) { setItems([...entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setListStatus('ready'); }
      } catch { if (active && generation.current === current) setListStatus('error'); }
    };
    void load();
    return () => { active = false; };
  }, [sessionToken, listRetry]);
  useEffect(() => {
    if (!confirmOpen && !replacementAction) return;
    const dialog = confirmDialog.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setConfirmOpen(false); setReplacementAction(null); }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); modalReturnFocus.current?.focus(); };
  }, [confirmOpen, replacementAction]);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash.split('?')[0] !== '#/admin/active-etf') return;
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      if (params.get('workflow') && params.get('workflow') !== 'reports') return;
      const value = params.get('authorTab');
      const nextTab = authorTabs.some(tab => tab.id === value) ? value! : 'import';
      const id = params.get('reportId'); const current = authorLocation.current;
      if (id && id !== current.id) {
        if (current.busy || current.pending || current.dirty) {
          if (current.id) params.set('reportId', current.id); else params.delete('reportId');
          window.history.replaceState(window.history.state, '', '#/admin/active-etf?' + params.toString());
          if (current.busy || current.pending) { setNotice({ tone: 'neutral', message: '請先確認目前操作結果，再切換研究。' }); return; }
          modalReturnFocus.current = document.activeElement as HTMLElement | null;
          setReplacementAction(() => () => void loadEntry(id, true, nextTab)); return;
        }
        void loadEntry(id, true, nextTab); return;
      }
      setAuthorTab(nextTab);
    };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    if (listStatus === 'ready' && initialReportId.current && !entry && !raw) {
      const id = initialReportId.current; initialReportId.current = null; void loadEntry(id, false, authorTab);
    }
  }, [listStatus]);

  function setOperation(value: PendingOperation | null) {
    operationRef.current = value; setPending(value); savePendingMarker(value);
  }
  function replaceInput(value: string, asNew = false) {
    editVersion.current += 1; setRaw(value); setValidation(null); setValidatedRaw(''); setReviewed(false); setNotice(null); setMode('edit');
    if (asNew) { setEntry(null); setSavedRaw(''); }
  }
  function mayReplace(action?: () => void) {
    if (pending) { setNotice({ tone: 'neutral', message: '上次操作結果尚未確認，請先查詢狀態。' }); return false; }
    if (!dirty) return true;
    modalReturnFocus.current = document.activeElement as HTMLElement | null;
    setReplacementAction(() => action || (() => undefined));
    return false;
  }
  function requestReplacement(action: () => void) { if (mayReplace(action)) action(); }
  function applyEntry(value: EtfEntry, message: string) {
    const text = JSON.stringify(value.draft, null, 2);
    editVersion.current += 1; setEntry(value); setRaw(text); setSavedRaw(text); setValidatedRaw(text);
    setValidation({ report: value.draft, errors: [], warnings: value.draft.warnings, counts: Object.fromEntries(value.draft.funds.map(fund => [fund.code, value.draft.rows.filter(row => row.etf === fund.code).length])) });
    setItems(current => [value, ...current.filter(item => item.id !== value.id)]);
    setReviewed(false); setOperation(null); setNotice({ tone: 'success', message });
  }
  async function loadEntry(id: string, approved = false, targetTab?: string) {
    if (busy || (!approved && !mayReplace(() => void loadEntry(id, true)))) return;
    const current = generation.current; setBusy('load'); setNotice(null);
    try {
      const response = await deadline(requestRef.current('get', { id })) as { entry?: EtfAuthorListEntry };
      if (generation.current !== current) return;
      if (response.entry?.draft === null && 'bodyId' in response.entry && response.entry.schemaVersion === 2) {
        if (!onSchema2Open) throw new Error('完整快照工作區暫時無法開啟。');
        onSchema2Open(response.entry.bodyId); return;
      }
      const value = entryFrom(response);
      const text = JSON.stringify(value.draft, null, 2);
      const params = new URLSearchParams(window.location.hash.split('?')[1] || ''); params.set('reportId', value.id); params.set('workflow', 'reports'); params.set('authorTab', targetTab || 'import');
      window.history.replaceState(window.history.state, '', '#/admin/active-etf?' + params.toString());
      editVersion.current += 1; setEntry(value); setRaw(text); setSavedRaw(text); setValidation(null); setValidatedRaw(''); setAuthorTab(targetTab || 'import'); setReviewed(false);
      setNotice({ tone: 'neutral', message: '已載入保存的草稿。請驗證並審閱後再發布；讀者現行版本不會改變。' });
    } catch { if (generation.current === current) setNotice({ tone: 'error', message: '草稿暫時無法載入，請再試一次。' }); }
    finally { if (generation.current === current) setBusy(''); }
  }
  async function validateDraft(): Promise<Validation | null> {
    if (!raw.trim() || pending) return null;
    const current = generation.current; const revision = editVersion.current; const input = raw;
    selectAuthorTab('validation'); setBusy('validate'); setNotice(null);
    try {
      const value = await deadline(requestRef.current('validate', { report: input })) as Validation;
      if (!Array.isArray(value.errors) || !Array.isArray(value.warnings) || !value.counts || typeof value.counts !== 'object') throw new Error('Malformed validation');
      if (generation.current !== current || editVersion.current !== revision) return null;
      setValidation(value); setValidatedRaw(input);
      setNotice({ tone: value.errors.length ? 'error' : 'neutral', message: value.errors.length ? '資料仍有錯誤，請依欄位位置修正。' : '結構與筆數已驗證；來源缺口仍需人工審閱。' });
      return value;
    } catch {
      if (generation.current === current && editVersion.current === revision) setNotice({ tone: 'error', message: '目前無法驗證資料，請保留內容後重試。' });
      return null;
    } finally { if (generation.current === current) setBusy(''); }
  }
  async function mutate(action: 'save' | 'publish' | 'visibility') {
    if (busy || pending) return;
    if (action === 'publish' && !canPublish) return;
    if (action === 'visibility' && (!entry || dirty || !entry.publishedVersion)) return;
    let result = validation;
    if (action === 'save' && !valid) result = await validateDraft();
    if (action !== 'visibility' && (!result?.report || result.errors.length)) return;
    const current = generation.current;
    const payload: Record<string, unknown> = action === 'save'
      ? { report: raw, baseRevision: entry?.revision || 0, requestId: crypto.randomUUID() }
      : action === 'visibility'
        ? { id: entry!.id, baseRevision: entry!.revision, expectedPublishedVersion: entry!.publishedVersion, archived: !entry!.archived, requestId: crypto.randomUUID() }
        : { id: entry!.id, baseRevision: entry!.revision, requestId: crypto.randomUUID(), reviewed: true };
    const operation: PendingOperation = { action, requestId: String(payload.requestId), payload };
    setOperation(operation); setBusy(action); setConfirmOpen(false); setNotice(null);
    try {
      const value = entryFrom(await deadline(requestRef.current(action, payload)));
      if (generation.current === current) applyEntry(value, action === 'visibility' ? value.archived ? '已取消公開。草稿與版本保留，可恢復公開。' : '已恢復公開原版本。' : action === 'save' ? '草稿已保存。尚未發布的內容僅作者可見。' : '發布已確認。數據、評論、圖表與來源以同一版本公開。');
    } catch (caught) {
      if (generation.current !== current) return;
      const code = errorCode(caught);
      if (code && code >= 400 && code < 500) {
        setOperation(null);
        setNotice({ tone: 'error', message: code === 409 ? '版本已變更，操作未套用。請重新載入保存版本再比較；目前輸入仍保留。' : code === 401 || code === 403 ? '作者權限已失效，請重新登入後載入保存草稿。' : '操作未套用，請檢查驗證訊息後重試。' });
      } else {
        setNotice({ tone: 'neutral', message: '操作結果尚未確認。請先查詢狀態，不要重複儲存或發布；未確認前保留原請求。' });
      }
    } finally { if (generation.current === current) setBusy(''); }
  }
  async function checkStatus() {
    const operation = operationRef.current;
    if (!operation || busy) return;
    const current = generation.current; setBusy('status');
    try {
      const value = await deadline(requestRef.current('status', { requestId: operation.requestId })) as { state: 'applied' | 'unresolved'; entry?: EtfEntry };
      if (generation.current !== current) return;
      if (value.state === 'applied' && value.entry) applyEntry(value.entry, operation.action === 'visibility' ? '已確認上次公開狀態變更成功，未重複提交。' : operation.action === 'save' ? '已確認上次草稿儲存成功。' : '已確認上次發布成功，未重複提交。');
      else setNotice({ tone: 'neutral', message: '結果仍未確認。請稍後再次查詢；系統不會重新提交這次操作。' });
    } catch { if (generation.current === current) setNotice({ tone: 'error', message: '目前無法查詢結果。請保留這個工作區，稍後再查詢。' }); }
    finally { if (generation.current === current) setBusy(''); }
  }
  async function importFile(file: File | undefined, approved = false) {
    if (!file || busy) return;
    if (!/\.json$/i.test(file.name)) { setNotice({ tone: 'error', message: '請選擇 JSON 報告檔案。書籍圖片請使用「研究書籍」上傳。' }); return; }
    if (!file.size) { setNotice({ tone: 'error', message: '檔案是空的，請選擇含有研究內容的 JSON 檔案。' }); return; }
    if (file.size > MAX_SNAPSHOT_BYTES) { setNotice({ tone: 'error', message: '完整研究資料包超過 16 MiB，請縮小內容。' }); return; }
    try {
      const text = await file.text();
      let schema: unknown;
      try { schema = JSON.parse(text)?.schemaVersion; } catch { setNotice({ tone: 'error', message: 'JSON 格式無法讀取，原有內容已保留。請修正檔案後重試。' }); return; }
      if (!approved && !mayReplace(() => void importFile(file, true))) return;
      if (schema === 2 && onSchema2Import) { onSchema2Import(text); return; }
      if (file.size > 180 * 1024) { setNotice({ tone: 'error', message: '一般研究資料包超過 180 KiB；較大的完整快照請使用 schemaVersion 2。' }); return; }
      replaceInput(text, true);
    } catch { setNotice({ tone: 'error', message: '檔案無法讀取，請重新選擇 JSON 檔案。' }); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  async function previewDraft() {
    if (pending || busy) return;
    const result = valid ? validation : await validateDraft();
    if (result?.report && !result.errors.length) { setMode('preview'); window.scrollTo({ top: 0 }); }
  }
  return <div className="etf-author">
    <div inert={confirmOpen || !!replacementAction}>
    <div className="etf-author-heading"><div><span className="etf-kicker">作者工作區 · 私有研究</span><h1>ETF 報告</h1><p>匯入結構化研究，先保存草稿，再審閱與發布。</p></div><button type="button" disabled={!!busy || !!pending} onClick={() => requestReplacement(() => { replaceInput('', true); setSavedRaw(''); })}>新增研究</button></div>
    {notice && <div className={'etf-notice ' + notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'success' ? <Check size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}<span>{notice.message}</span></div>}
    {pending && <section className="etf-pending" role="status"><strong>{busy === 'save' || busy === 'publish' ? '正在確認操作…' : '上次操作尚未確認'}</strong><p>保留同一請求，先讀取狀態；未確認時不重新提交。</p><button type="button" disabled={!!busy} onClick={() => void checkStatus()}>{busy === 'status' ? '查詢中…' : '查詢操作狀態'}</button></section>}
    <div className={'etf-author-layout' + (mode === 'preview' && valid ? ' is-preview' : '')}>
      <aside className="etf-author-list" aria-label="已保存 ETF 報告"><div className="etf-expanded-heading"><h2>已保存研究</h2><button type="button" aria-label="重新載入已保存研究列表" disabled={!!busy} onClick={() => setListRetry(value => value + 1)}><RotateCcw size={16} /></button></div>
        {listStatus === 'loading' ? <p role="status">正在載入保存研究…</p> : listStatus === 'error' ? <div role="alert"><p>研究列表暫時無法載入。</p><button type="button" onClick={() => setListRetry(value => value + 1)}>重新載入</button></div> : !items.length ? <p>尚未保存研究。匯入或載入範例可開始。</p> : <ul>{items.map(item => <li key={item.id}><button type="button" disabled={!!busy || !!pending} aria-pressed={entry?.id === item.id} onClick={() => void loadEntry(item.id)}><strong>{item.draft?.title || '完整研究快照 · ' + item.id}</strong><small>{day(item.updatedAt)} · r{item.revision}</small><span>{item.publishedVersion ? (item.archived ? '已取消公開' : '公開') + (item.hasUnpublishedChanges ? ' · 有未發布修訂' : '') : '未發布草稿'}</span></button></li>)}</ul>}
      </aside>
      <section className="etf-author-editor" aria-label="ETF 研究編輯與審閱"><div className="etf-author-toolbar"><span>{entry ? '已保存 r' + entry.revision + ' · ' + (dirty ? '有未保存變更' : '與保存版一致') : raw ? '未保存的新研究' : '尚未匯入研究'}</span><button type="button" disabled={!!busy || !!pending} onClick={() => { if (mode === 'preview') setMode('edit'); else void previewDraft(); }}>{mode === 'preview' ? '返回編輯' : '預覽完整報告'}</button></div>
        <EtfTabs idPrefix='etf-author-report' label='研究任務內容' tabs={authorTabs} value={authorTab} onChange={tab => selectAuthorTab(tab, true)} />
        <EtfTabPanel idPrefix='etf-author-report' id='import' active={authorTab === 'import'}>
          <div className="etf-import-controls"><button type="button" disabled={!!busy || !!pending} onClick={() => fileInput.current?.click()}><Upload size={16} />匯入 JSON</button><input ref={fileInput} type="file" aria-label="選擇 ETF 分析報告 JSON 檔案" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])} /><button type="button" disabled={!!busy || !!pending} onClick={() => requestReplacement(() => replaceInput(JSON.stringify(seedReport, null, 2), true))}>載入 10/13 研究範例</button></div>
          <label className="etf-json-label">研究資料包<textarea aria-label="研究資料包" value={raw} disabled={!!busy || !!pending} spellCheck={false} rows={18} onChange={event => replaceInput(event.target.value)} placeholder="貼上 schemaVersion: 1 的 flows JSON；也可匯入 JSON 檔案。" /></label><p className="etf-note">範例為 2026/10/12→10/13 歷史研究，產業證據補查 10/14，含 39 筆異動。載入範例不會儲存或發布。沒有完整持股或法人也可建立 flows。</p>
        </EtfTabPanel>
        <EtfTabPanel idPrefix='etf-author-report' id='preview' active={authorTab === 'preview'}>
          {valid && validation?.report ? <><p className='etf-note'>私有預覽與讀者使用同一閱讀版面；保存或預覽不會自動公開。</p><ReportBody key={'preview:' + validatedRaw} report={validation.report} version={entry?.revision || 0} preview active={authorTab === 'preview'} /></> : <p className='etf-note'>請先驗證目前資料，再開啟完整預覽。切換分頁不會保存或發布。</p>}
        </EtfTabPanel>
        <EtfTabPanel idPrefix='etf-author-report' id='validation' active={authorTab === 'validation'}>
        <div className="etf-author-validation">{validation && <><h3>{validation.errors.length ? '待修正資料' : '結構與筆數驗證'}</h3>{validation.errors.length ? <ul className="etf-errors" role="alert">{validation.errors.map((error, n) => <li key={n}>{error}</li>)}</ul> : <p>逐基金已取得筆數：{Object.entries(validation.counts).map(([code, count]) => code + ' ' + count + ' 筆').join('；')}。圖表直接由原始異動生成。</p>}
          {!!validation.warnings.length && <><h4>需審閱的缺口</h4><ul className="etf-warnings">{validation.warnings.map((warning, n) => <li key={n}>{warning}</li>)}</ul></>}</>}
        </div>
        {!validation && <p className='etf-note'>這個版本尚未驗證。請執行「驗證資料」查看欄位、筆數與來源缺口。</p>}
        </EtfTabPanel>
        <EtfTabPanel idPrefix='etf-author-report' id='history' active={authorTab === 'history'}>
          <h2>發布紀錄</h2>
          {entry ? <><p>保存版本 r{entry.revision} · {entry.publishedVersion ? (entry.archived ? '已取消公開' : '目前公開') : '尚未發布'}{entry.hasUnpublishedChanges && ' · 有未發布修訂'}</p>
            <p className='etf-note'>更新 {day(entry.updatedAt)}；最近發布 {day(entry.publishedAt)}。此處只顯示已確認的保存與公開版本，不推測其他發布時間。</p>
            {entry.publishedVersion > 0 && <><button type='button' disabled={dirty || !!busy || !!pending} onClick={() => void mutate('visibility')}>{busy === 'visibility' ? '更新公開狀態…' : entry.archived ? '恢復公開' : '取消公開'}</button><p className='etf-note'>取消公開只從讀者列表及連結移除，草稿與已發布版本仍保留，可恢復。</p>{!entry.archived && <a href={'#/active-etf/' + encodeURIComponent(entry.id) + '?v=' + entry.publishedVersion + (entry.id === 'history' ? '&report=1' : '')} target='_blank' rel='noopener noreferrer'>查看目前公開報告<span className='sr-only'>（開啟新分頁）</span></a>}</>}
          </> : <p className='etf-note'>先保存私有草稿，這裡才會顯示版本資訊。</p>}
        </EtfTabPanel>
        <div className="etf-author-actions"><button type="button" disabled={!raw.trim() || !!busy || !!pending} onClick={() => void validateDraft()}>{busy === 'validate' ? '驗證中…' : '驗證資料'}</button><button type="button" disabled={!raw.trim() || !!busy || !!pending} onClick={() => void mutate('save')}>{busy === 'save' ? '保存中…' : '保存私有草稿'}</button><button type="button" disabled={!canPublish} onClick={event => { modalReturnFocus.current = event.currentTarget; setConfirmOpen(true); }}>審閱後發布</button></div>
        <label className="etf-review-check"><input type="checkbox" checked={reviewed} disabled={!valid || dirty || !entry || !!busy || !!pending} onChange={event => setReviewed(event.target.checked)} /><span>我已閱讀完整評論、來源與資料缺口，確認本次發布版本。</span></label><p className="etf-note">先保存並驗證後才可確認發布。修訂草稿不覆蓋讀者現行版本；重新整理可載入已保存研究，未保存輸入不自動還原。</p>
      </section>
    </div>
    </div>
    {replacementAction && <div className='etf-confirm-backdrop'><div ref={confirmDialog} className='etf-confirm-dialog' role='dialog' aria-modal='true' aria-labelledby='etf-replace-title'><h2 id='etf-replace-title'>離開未保存的研究？</h2><p>目前輸入尚未保存。繼續會替換這些變更；已保存的版本仍保留。</p><div><button type='button' onClick={() => setReplacementAction(null)}>繼續編輯</button><button type='button' onClick={() => { const action = replacementAction; setReplacementAction(null); action(); }}>放棄變更並繼續</button></div></div></div>}
    {confirmOpen && <div className="etf-confirm-backdrop"><div ref={confirmDialog} className="etf-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="etf-publish-title" aria-describedby="etf-publish-copy"><h2 id="etf-publish-title">發布這份研究？</h2><p id="etf-publish-copy">{entry?.draft.title}將以同一版本公開數據、圖表、評論與來源。這次操作只更新 STAGING；未完成核對的缺口會保留。</p><div><button type="button" onClick={() => setConfirmOpen(false)}>返回審閱</button><button type="button" onClick={() => void mutate('publish')}>確認發布至 STAGING</button></div></div></div>}
  </div>;
}
