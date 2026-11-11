import { ResearchArticleHeading } from './research-article-heading';
import { CatalogSelect } from './catalog-select';
import { useFooterVersion } from './research-footer';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { X, RotateCcw, ExternalLink } from 'lucide-react';
import type { MarkdownReport, MarkdownRecord } from '../shared/etf-markdown';
import { EtfTabs, EtfTabPanel } from './active-etf';
import { remarkAnalysisReading } from './etf-markdown-prose';
import { JsonAnalysis } from './etf-json-analysis';
import './etf-markdown-reader.css';

const INDUSTRY = 'industry_allocation_changes';
const STOCK = 'stock_holding_changes';
const WEEKLY = 'weekly_industry_allocation_trend';
const COLORS = ['#55a7df', '#62d1d4', '#f2a060', '#b699e7', '#d5c767', '#e98faf', '#a2bd86'];
const CHARTS = [{ id: INDUSTRY, label: '產業方向' }, { id: STOCK, label: '個股異動' }, { id: WEEKLY, label: '週度趨勢' }];
const TABS = [{ id: 'analysis', label: '重點分析' }, { id: 'allocation', label: '配置圖表' }, { id: 'references', label: '參考來源依據' }];
const PAGE_SIZE = 12;
type ReaderState = { tab: string; chart: string; fund: string; sector: string; unit: string; page: number };
type Evidence = { title: string; rows: MarkdownRecord[]; kind: string };
const defaults: ReaderState = { tab: 'analysis', chart: INDUSTRY, fund: '', sector: '', unit: 'lots', page: 1 };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => typeof v === 'string' ? v : '';
const list = (v: unknown): MarkdownRecord[] => Array.isArray(v) ? v : [];
const unique = (values: string[]) => [...new Set(values)];
const number = (v: unknown, digits = 2) => finite(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '未知';
const signed = (v: unknown, digits = 2) => {
  if (!finite(v)) return '未知';
  const magnitude = Math.abs(v), sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const threshold = 10 ** -digits;
  // Preserve the difference between a verified zero and a nonzero value below the display precision.
  return sign + (magnitude > 0 && magnitude < threshold ? '<' + number(threshold, digits) : number(magnitude, digits));
};
const day = (v: unknown) => text(v) ? text(v).replaceAll('-', '/') : '未知';
const tone = (v: unknown) => !finite(v) ? 'md-unknown' : v > 0 ? 'md-up' : v < 0 ? 'md-down' : 'md-zero';
const records = (report: MarkdownReport, chart: string) => report.visualizations.find(v => v.id === chart)?.records || [];
const fundCodes = (report: MarkdownReport): string[] => unique((Array.isArray(report.frontmatter.etf_codes) ? report.frontmatter.etf_codes : []).filter((v: unknown): v is string => typeof v === 'string'));
const dict = (report: MarkdownReport, name: string, code: string) => text(report.shared.dictionaries?.[name]?.[code]) || code;
export function markdownEstimateInfo(report: MarkdownReport, chart: string) {
  const visual = report.visualizations.find(v => v.id === chart);
  const common = report.shared.metadata || {}, effective = visual?.metadata || {}, declared = visual?.shape?.metadata || {};
  const basis = text(effective.amount_basis) || text(common.amount_basis);
  // A different basis cannot inherit the other basis's formula merely because metadata was merged.
  const formula = basis !== text(common.amount_basis) ? text(declared.amount_formula) : text(effective.amount_formula) || text(common.amount_formula);
  if (basis === 'provider_estimate') return { basis, label: '來源提供估值', formula, description: '來源提供估值，方法依來源，非實際交易；申贖與公司行動調整依來源說明。' };
  if (basis === 'research_estimate') return { basis, label: '持股差研究估值', formula: formula || (chart === WEEKLY ? '(Q_week_end−Q_previous_week_end) × P_week_end' : '(Q1−Q0) × P1'), description: '持股差研究估值：股數差按期末收盤價估值，實際交易金額未知；未調整申贖與公司行動。' };
  return { basis, label: '估值口徑未提供', formula: '', description: '估值口徑未提供，不能視為實際交易金額。' };
}
function safeHref(value: string | undefined) {
  if (!value) return undefined;
  if (/^#[A-Za-z0-9_-]+$/.test(value)) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}

/** Unknown contributions never become zero, even when other contributors are known. */
export function markdownSum(rows: MarkdownRecord[], field: string, expectedCount = rows.length) {
  const known = rows.filter(r => finite(r[field]) && r.data_status !== 'unavailable');
  const subtotal = known.reduce((sum, r) => sum + r[field], 0);
  const complete = rows.length === expectedCount && known.length === rows.length && rows.length > 0;
  return { value: complete ? subtotal : null, subtotal: known.length ? subtotal : null, missing: Math.max(expectedCount - known.length, 0), complete };
}
export function markdownHeatValue(row: MarkdownRecord | undefined, unit: string): number | null {
  if (!row || row.holding_state === 'unknown' || row.data_status === 'unavailable') return null;
  const v = row[unit === 'value' ? 'delta_value_estimate_twd' : 'delta_shares'];
  return finite(v) ? v / (unit === 'value' ? 1e8 : 1000) : null;
}
export function markdownHeatScale(rows: MarkdownRecord[], unit: string) {
  return Math.max(0, ...rows.map(r => Math.abs(markdownHeatValue(r, unit) || 0)));
}
export function markdownValidSectors(rows: MarkdownRecord[], chart: string, fund: string, unit = 'lots') {
  return unique(rows.filter(row => {
    if (fund && row.etf_code !== fund || row.data_status === 'unavailable') return false;
    const value = chart === STOCK ? markdownHeatValue(row, unit) : row.net_value_estimate_twd;
    return finite(value) && value !== 0;
  }).map(row => text(row.industry_code))).filter(Boolean);
}
export function markdownKeyMetrics(report: MarkdownReport) {
  const rows = records(report, INDUSTRY), funds = fundCodes(report);
  const sectors = unique(rows.map(r => text(r.industry_code)));
  const totals = sectors.map(code => ({ code, rows: rows.filter(r => r.industry_code === code) }))
    .map(item => ({ ...item, ...markdownSum(item.rows, 'net_value_estimate_twd', funds.length) }))
    .filter(item => finite(item.value));
  const up = [...totals].filter(v => v.value! > 0).sort((a, b) => b.value! - a.value!)[0];
  const down = [...totals].filter(v => v.value! < 0).sort((a, b) => a.value! - b.value!)[0];
  const fund = funds.map(code => ({ code, rows: rows.filter(r => r.etf_code === code) }))
    .map(item => ({ ...item, ...markdownSum(item.rows, 'increase_value_estimate_twd', sectors.length) }))
    .filter(item => finite(item.value) && item.value! > 0).sort((a, b) => b.value! - a.value!)[0];
  const result: { label: string; name: string; value: number; unit: string; rows: MarkdownRecord[]; note?: string }[] = [];
  if (up) result.push({ label: '主要增配估值', name: dict(report, 'industries', up.code), value: up.value! / 1e8, unit: '億元', rows: up.rows });
  if (down) result.push({ label: '主要減配估值', name: dict(report, 'industries', down.code), value: down.value! / 1e8, unit: '億元', rows: down.rows });
  if (fund) {
    const context = list(report.shared.fund_context).find(r => r.etf_code === fund.code && r.research_date === report.period.end && r.baseline_date === report.period.start);
    result.push({ label: '主要增持基金', name: fund.code + ' ' + dict(report, 'etfs', fund.code), value: fund.value! / 1e8, unit: '億元', rows: fund.rows,
      note: '同期間份額 ' + (finite(context?.units_change_pct) ? signed(context?.units_change_pct) + '%' : '未知') });
  }
  return result.slice(0, 3);
}
function stateKey(report: MarkdownReport, version?: number) { return 'pocketstocks:etf:markdown:' + report.id + ':' + (version ?? report.sourceHash); }
function matchesRoute(report: MarkdownReport, version?: number) {
  const [path, search = ''] = window.location.hash.split('?');
  const match = path.match(/^#\/active-etf\/(?:report\/)?([^/]+)$/);
  if (!match) return false;
  try { if (decodeURIComponent(match[1]) !== report.id) return false; } catch { return false; }
  const pinned = new URLSearchParams(search).get('v');
  return !pinned || version === undefined || Number(pinned) === version;
}
function readState(report: MarkdownReport, version: number | undefined, preview: boolean): ReaderState {
  if (preview || typeof window === 'undefined') return { ...defaults };
  let saved: Partial<ReaderState> = {};
  try { const value = JSON.parse(window.sessionStorage.getItem(stateKey(report, version)) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch { /* URL state remains available without storage. */ }
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const get = (name: keyof ReaderState) => params.get('md' + name[0].toUpperCase() + name.slice(1)) ?? saved[name] ?? defaults[name];
  const tab = get('tab'), chart = get('chart'), unit = get('unit');
  return { tab: TABS.some(t => t.id === tab) ? String(tab) : defaults.tab,
    chart: CHARTS.some(t => t.id === chart) ? String(chart) : defaults.chart,
    unit: ['lots', 'value'].includes(String(unit)) ? String(unit) : defaults.unit,
    fund: String(get('fund')).slice(0, 80), sector: String(get('sector')).slice(0, 80),
    page: Math.max(1, Math.min(10000, Math.trunc(Number(get('page'))) || 1)) };
}
function persistState(report: MarkdownReport, version: number | undefined, state: ReaderState, push: boolean) {
  if (!matchesRoute(report, version)) return;
  try { window.sessionStorage.setItem(stateKey(report, version), JSON.stringify(state)); } catch { /* Reading does not require storage. */ }
  const [path, search = ''] = window.location.hash.split('?'), params = new URLSearchParams(search);
  if (version !== undefined) params.set('v', String(version));
  Object.entries(state).forEach(([key, value]) => params.set('md' + key[0].toUpperCase() + key.slice(1), String(value)));
  const hash = path + '?' + params;
  if (hash !== window.location.hash) window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', hash);
}

function Sources({ report, ids }: { report: MarkdownReport; ids: string[] }) {
  return <ul className='md-source-list'>{unique(ids).map(id => {
    const source = report.shared.source_registry?.[id];
    if (!source) return <li key={id}>{id}：來源未取得</li>;
    const href = safeHref(source.url);
    return <li key={id}><div>{href && !href.startsWith('#') ? <a href={href} target='_blank' rel='noopener noreferrer'>{source.title || id}<ExternalLink size={12} aria-hidden='true' /><span className='sr-only'>（開啟新分頁）</span></a> : text(source.title) || id}</div>
      <small>{id} · {text(source.source_type) || '來源類型未知'} · 資料期間 {text(source.data_period) || '未知'} · 發布日 {day(source.published_date)} · 補查日 {day(source.checked_date)}</small>
      {source.request_method && <small>公開查詢方式 {text(source.request_method)}{source.request_params ? ' · 條件 ' + JSON.stringify(source.request_params) : ''}</small>}<ReferenceMetadata label='完整來源紀錄' values={source} /></li>;
  })}</ul>;
}
export function ReferenceCitations({ report }: { report: MarkdownReport }) {
  const sources = report.shared.source_registry || {}, ids = Object.keys(sources);
  if (!ids.length) return <p className='md-caption'>尚無可列出的參考來源。</p>;
  return <ol className='md-citation-list' role='list'>{ids.map((id, index) => {
    const source = sources[id];
    const href = safeHref(source?.url), title = text(source?.title) || '來源未提供標題';
    const period = text(source?.data_period) || text(source?.data_date), published = text(source?.published_date);
    return <li key={id}><span className='md-citation-number'>[{index + 1}]</span><span>{href && !href.startsWith('#')
      ? <a href={href} target='_blank' rel='noopener noreferrer'>{title}<span className='sr-only'>（開啟新分頁）</span></a> : title}
      {period ? !title.includes(period) && <span className='md-citation-date'>。資料期間：{period}</span> : published ? <span className='md-citation-date'>。發布：{day(published)}</span> : null}
    </span></li>;
  })}</ol>;
}
function Pager({ page, count, onChange, label }: { page: number; count: number; onChange: (n: number) => void; label: string }) {
  if (count <= PAGE_SIZE) return <p className='md-caption'>共 {count} 項</p>;
  return <nav className='md-pager' aria-label={label}><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)}／{count} 項</span>
    <button type='button' disabled={page <= 1} onClick={() => onChange(page - 1)}>上一頁</button><button type='button' disabled={page * PAGE_SIZE >= count} onClick={() => onChange(page + 1)}>下一頁</button></nav>;
}
function KeyMetrics({ report, open, layout = 'sidebar' }: { report: MarkdownReport; open: (v: Evidence, node: HTMLButtonElement) => void; layout?: 'sidebar' | 'summary' }) {
  const metrics = markdownKeyMetrics(report).map(metric => {
    if (layout !== 'summary' || metric.label !== '主要增持基金') return metric;
    const code = metric.rows[0]?.etf_code;
    const context = list(report.shared.fund_context).find(r => r.etf_code === code && r.research_date === report.period.end && r.baseline_date === report.period.start);
    return finite(context?.units_change_pct) ? { ...metric, label: dict(report, 'etfs', code) + '份額變化', value: context.units_change_pct, unit: '%', name: '增持估值最多的基金；須留意申贖效應', note: undefined } : metric;
  });
  const estimate = markdownEstimateInfo(report, INDUSTRY);
  return <aside className={'md-key-metrics' + (layout === 'summary' ? ' md-summary-metrics' : '')} aria-label='關鍵數據'><h2>{layout === 'summary' ? '重點分析' : '關鍵數據'}</h2>
    {metrics.map(metric => <div className='md-key-metric' key={metric.label}><p>{metric.label}</p><h3>{metric.name}</h3>
      <button type='button' className={metric.unit === '%' ? 'md-share-context' : tone(metric.value)} onClick={e => open({ title: metric.label + ' · ' + metric.name, rows: metric.rows, kind: INDUSTRY }, e.currentTarget)} aria-label={(metric.unit === '%' ? metric.label : metric.name) + ' ' + signed(metric.value) + metric.unit + '，查看精確證據'}>
        <strong>{signed(metric.value)}</strong><span>{metric.unit}</span></button>{metric.note && <p className='md-caption'>{metric.note}</p>}</div>)}
    {!metrics.length && <p className='md-caption'>尚無可完整重算的關鍵數據。</p>}
    <p className='md-caption'>{day(report.period.start)} → {day(report.period.end)}<br />關鍵數據只取產業圖的同口徑已知研究樣本。{estimate.description}</p>
  </aside>;
}
function IndustryChart({ report, fund, sector, page, setPage, open }: {
  report: MarkdownReport; fund: string; sector: string; page: number; setPage: (n: number) => void;
  open: (v: Evidence, node: HTMLButtonElement) => void;
}) {
  const all = records(report, INDUSTRY), funds = fund ? [fund] : fundCodes(report);
  const estimate = markdownEstimateInfo(report, INDUSTRY);
  const selected = all.filter(r => !fund || r.etf_code === fund);
  const groups = unique(selected.map(r => text(r.industry_code))).map(code => {
    const rows = selected.filter(r => r.industry_code === code);
    const sums = markdownSum(rows, 'net_value_estimate_twd', funds.length);
    const values = rows.filter(r => finite(r.net_value_estimate_twd) && r.data_status !== 'unavailable').map(r => r.net_value_estimate_twd / 1e8);
    return { code, rows, sums, positive: values.filter(v => v > 0).reduce((a, b) => a + b, 0), negative: values.filter(v => v < 0).reduce((a, b) => a + b, 0) };
  }).sort((a, b) => Math.abs(b.sums.subtotal || 0) - Math.abs(a.sums.subtotal || 0));
  const max = Math.max(1, ...groups.flatMap(g => [g.positive, -g.negative]));
  const filtered = groups.filter(g => !sector || g.code === sector);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  return <div className='md-industry'><h2>各產業 ETF 淨變動估值</h2><p className='md-caption'>億元 · {estimate.label}。每色為一檔 ETF 的淨貢獻，菱形為已知完整總淨額。淨額不代表總買賣。{estimate.description}</p>
    <ul className='md-fund-legend'>{funds.map(code => <li key={code}><i style={{ background: COLORS[fundCodes(report).indexOf(code) % COLORS.length] }} />{code} {dict(report, 'etfs', code)}</li>)}</ul>
    <div className='md-diverging-scale' aria-hidden='true'><span>−{number(max)}</span><span>0</span><span>+{number(max)}</span></div>
    {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(group => {
      let negative = 0, positive = 0;
      return <button type='button' className='md-industry-row' key={group.code} onClick={e => open({ title: dict(report, 'industries', group.code), rows: group.rows, kind: INDUSTRY }, e.currentTarget)}>
        <span>{dict(report, 'industries', group.code)}</span><svg viewBox='0 0 600 30' preserveAspectRatio='none' aria-hidden='true'>
          <line x1='300' x2='300' y1='0' y2='30' stroke='#819097' strokeWidth='1' />
          {funds.map(code => {
            const row = group.rows.find(r => r.etf_code === code), v = row?.net_value_estimate_twd;
            if (!finite(v) || row?.data_status === 'unavailable') return null;
            const value = v / 1e8, width = Math.abs(value) / max * 288;
            const x = value < 0 ? 300 - negative - width : 300 + positive;
            if (value < 0) negative += width; else positive += width;
            return <rect key={code} x={x} y='6' width={width} height='18' fill={COLORS[fundCodes(report).indexOf(code) % COLORS.length]} />;
          })}
          {finite(group.sums.value) && <path d='M 0 -5 L 5 0 L 0 5 L -5 0 Z' transform={'translate(' + (300 + group.sums.value / 1e8 / max * 288) + ' 15)'} fill='#0b0f12' stroke='#e8eef0' strokeWidth='1.6' />}
        </svg><span className={tone(group.sums.value)}>{group.sums.complete ? signed(group.sums.value! / 1e8) : '已知小計 ' + (finite(group.sums.subtotal) ? signed(group.sums.subtotal / 1e8) : '未知')}<small>{group.sums.complete ? '精確證據' : '仍缺 ' + group.sums.missing + ' 筆'}</small></span>
      </button>;
    })}
    {!filtered.length && <p className='md-empty'>目前條件沒有可顯示的產業資料。可重設篩選重新查看。</p>}
    <Pager page={currentPage} count={filtered.length} onChange={setPage} label='產業圖分頁' />
  </div>;
}
function StockChart({ report, fund, sector, unit, page, setPage, open }: {
  report: MarkdownReport; fund: string; sector: string; unit: string; page: number; setPage: (n: number) => void;
  open: (v: Evidence, node: HTMLButtonElement) => void;
}) {
  const all = records(report, STOCK), funds = fund ? [fund] : fundCodes(report);
  const estimate = markdownEstimateInfo(report, STOCK);
  const rows = all.filter(r => (!fund || r.etf_code === fund) && (!sector || r.industry_code === sector));
  const stocks = unique(rows.map(r => text(r.stock_code))).sort((a, b) => a.localeCompare(b));
  const max = markdownHeatScale(all, unit), currentPage = Math.min(page, Math.max(1, Math.ceil(stocks.length / PAGE_SIZE)));
  return <div><h2>個股持股變動（{unit === 'value' ? '億元' : '張數'}）</h2>
    <p className='md-caption'>金額口徑：{estimate.description}</p>
    <p className='md-caption'>紅：增加　綠：減少　0：已確認未變　—：兩端未持有　?：未取得。色階固定於整份報告，篩選不改變色深。</p>
    <div className='md-heat-legend'><span className='md-down'>減少 −{number(max)}</span><span>0</span><span className='md-up'>增加 +{number(max)} {unit === 'value' ? '億元' : '張'}</span></div>
    {stocks.length ? <div className='etf-table-scroll md-stock-scroll' tabIndex={0} role='region' aria-label='個股持股變動表，可水平捲動'><table className='etf-table md-heatmap'>
      <thead><tr><th scope='col'>股票代號／名稱</th>{funds.map(code => <th scope='col' key={code}>{code}<small>{dict(report, 'etfs', code)}</small></th>)}</tr></thead>
      <tbody>{stocks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(code => {
        const stockRows = rows.filter(r => r.stock_code === code);
        return <tr key={code}><th scope='row'>{code}<small className='md-stock-name'>{dict(report, 'stocks', code)}</small></th>{funds.map(etf => {
          const row = stockRows.find(r => r.etf_code === etf), v = markdownHeatValue(row, unit), notHeld = row?.holding_state === 'not_held';
          const label = !row || v === null ? '?' : notHeld ? '—' : signed(v);
          const style = finite(v) && v !== 0 && !notHeld ? { backgroundColor: `rgba(${v > 0 ? '213,66,60' : '42,142,92'},${.16 + Math.abs(v) / (max || 1) * .62})` } : undefined;
          return <td key={etf}><button type='button' style={style} className={'md-heat-cell ' + tone(v)} aria-label={`${code} ${dict(report, 'stocks', code)} × ${etf} ${dict(report, 'etfs', etf)}，${label === '?' ? '未知' : label === '—' ? '兩端未持有' : label + (unit === 'value' ? '億元' : '張')}，查看精確證據`}
            onClick={e => open({ title: code + ' ' + dict(report, 'stocks', code) + ' × ' + etf + ' ' + dict(report, 'etfs', etf), rows: row ? [row] : [], kind: STOCK }, e.currentTarget)}>{label}</button></td>;
        })}</tr>;
      })}</tbody></table></div> : <p className='md-empty'>目前條件沒有可顯示資料。可重設篩選，回到全部產業。</p>}
    <Pager page={currentPage} count={stocks.length} onChange={setPage} label='個股表分頁' />
  </div>;
}
export function markdownWeeklyPoints(report: MarkdownReport, fund: string, sector: string) {
  const all = records(report, WEEKLY), funds = fund ? [fund] : fundCodes(report);
  const industries = sector ? [sector] : unique(all.map(r => text(r.industry_code)));
  return list(report.shared.weekly_periods).map(period => {
    const rows = all.filter(r => r.period_id === period.period_id && funds.includes(r.etf_code) && industries.includes(r.industry_code));
    const sums = markdownSum(rows, 'net_value_estimate_twd', funds.length * industries.length);
    const expected = Array.isArray(period.expected_trading_dates) ? period.expected_trading_dates : [];
    const observed = Array.isArray(period.observed_trading_dates) ? period.observed_trading_dates : [];
    const comparable = period.complete === true && expected.length > 0 && expected.length === observed.length && expected.every((d: string) => observed.includes(d)) && sums.complete && rows.every(r => r.data_status === 'complete');
    return { period, rows, ...sums, comparable };
  });
}
function WeeklyChart({ report, fund, sector, open }: {
  report: MarkdownReport; fund: string; sector: string; open: (v: Evidence, node: HTMLButtonElement) => void;
}) {
  const points = markdownWeeklyPoints(report, fund, sector), complete = points.filter(p => p.period.complete === true), partial = points.filter(p => p.period.complete !== true);
  const comparable = complete.filter(p => p.comparable).length;
  const max = Math.max(1, ...points.map(p => Math.abs(p.value || p.subtotal || 0) / 1e8));
  const metadata = report.visualizations.find(v => v.id === WEEKLY)?.metadata || {};
  const estimate = markdownEstimateInfo(report, WEEKLY);
  const blocks = (items: typeof points, label: string) => <section className='md-week-group' aria-label={label}><h3>{label}</h3><div className='md-week-bars'>{items.map(p => <button type='button' key={p.period.period_id} className={'md-week-point ' + (p.period.complete === true ? '' : 'md-wtd')} onClick={e => open({ title: text(p.period.period_id) + ' · ' + (p.period.complete === true ? '完整週' : '本週截至 ' + day(p.period.observation_end)), rows: p.rows, kind: WEEKLY }, e.currentTarget)}>
    <span className='md-week-plot' aria-hidden='true'><span className='md-week-zero' />{finite(p.value) && <span className={'md-week-bar ' + tone(p.value)} style={{ height: (Math.abs(p.value) / 1e8 / max * 45) + '%', top: p.value >= 0 ? (50 - Math.abs(p.value) / 1e8 / max * 45) + '%' : '50%' }} />}</span>
    <strong className={tone(p.value)}>{finite(p.value) ? signed(p.value / 1e8) : '未知'}</strong><span>{text(p.period.period_id)}</span><small>{day(p.period.week_start)}–{day(p.period.week_end)}</small><small>端點 {day(p.period.baseline_date)} → {day(p.period.observation_end)}</small><small>{p.period.complete === true ? (p.comparable ? '完整可比週' : '完整週，證據不足') : '本週截至 ' + day(p.period.observation_end)}</small>
  </button>)}</div></section>;
  return <div><h2>週度淨變動估值（億元）</h2><p className='md-caption'>固定研究目標日基金樣本。{estimate.description}{estimate.basis === 'research_estimate' ? '採週端點股數差 × 週末收盤價，並非逐日估值加總。' : ''}</p>
    <p className='md-caption'>{text(metadata.selection_limitation) || '目標日樣本回溯，不能代表各歷史週市場排名。'}各週使用相同尺度 ±{number(max)} 億元，未知留白。</p>
    {comparable < 2 && <p className='md-notice' role='status'>可比完整週不足：目前 {comparable} 個完整可比週，暫不判讀趨勢。未取得的資料不視為零。</p>}
    {complete.length > 0 && blocks(complete, '完整 ISO 週')}{partial.length > 0 && blocks(partial, '本週截至研究日，另列參考')}
    {!points.length && <p className='md-empty'>尚無每週端點資料。未取得的資料不視為零。</p>}
  </div>;
}
function ReferenceMetadata({ label, values }: { label: string; values: MarkdownRecord }) {
  return <details className='md-reference-metadata'><summary>{label}</summary><dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null ? '未知／不適用' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></details>;
}
function ReportReferences({ report, prefix }: { report: MarkdownReport; prefix: string }) {
  const ids = Object.keys(report.shared.source_registry || {});
  return <div className='md-references'>
    <section data-md-reference-section='sources' aria-labelledby={prefix + '-reference-sources'}><h2 id={prefix + '-reference-sources'} tabIndex={-1}>文章與圖表來源（{ids.length} 筆）</h2><ReferenceCitations report={report} /></section>
  </div>;
}
function EvidencePanel({ report, evidence, onClose }: { report: MarkdownReport; evidence: Evidence; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); heading.current?.focus(); }, [evidence]);
  const rows = evidence.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const weekly = evidence.kind === WEEKLY;
  const estimate = markdownEstimateInfo(report, evidence.kind);
  const periods = weekly ? list(report.shared.weekly_periods).filter(p => evidence.rows.some(r => r.period_id === p.period_id)) : [];
  const contexts = list(weekly ? report.shared.weekly_fund_context : report.shared.fund_context).filter(c => evidence.rows.some(r => r.etf_code === c.etf_code && (!weekly || r.period_id === c.period_id)));
  const ids = unique([...evidence.rows, ...periods, ...contexts].flatMap(r => Array.isArray(r.source_ids) ? r.source_ids : []));
  return <section className={'md-evidence' + (evidence.kind === STOCK ? ' md-evidence-stock' : '')} aria-label='精確證據' onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}><div className='md-evidence-heading'><h2 ref={heading} tabIndex={-1}>{evidence.title}</h2><button type='button' onClick={onClose}><X size={16} aria-hidden='true' />關閉精確證據</button></div>
    <p className='md-caption'>{weekly ? periods.map(p => text(p.period_id) + ' 端點 ' + day(p.baseline_date) + ' → ' + day(p.observation_end) + (p.complete ? '（完整週）' : '（本週截至研究日）')).join('；') : '研究期 ' + day(report.period.start) + ' → ' + day(report.period.end)} · 股數以股保存，展示張數 = 股數 ÷ 1,000；金額為新台幣元，億元 = 元 ÷ 100,000,000。估值不是實際交易。</p>
    {!evidence.rows.length ? <p>這個組合未取得資料，無法當作零或未持有。</p> : <div className='etf-table-scroll md-evidence-scroll' tabIndex={0} role='region' aria-label='精確證據表，可水平捲動'><table className='etf-table'><thead><tr><th>基金／項目</th>{evidence.kind === STOCK ? <><th>基期／期末股數</th><th>股數變化／展示張數</th><th>收盤價／日期</th><th>金額估值</th><th>每單位持股變化</th></> : <><th>增加估值（元）</th><th>減少估值（元）</th><th>淨變化估值（元）</th><th>基期／期末權重</th><th>權重差</th></>}<th>狀態／缺口</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><th scope='row'>{text(r.etf_code)} {text(r.etf_name)}<small>{text(r.stock_code)} {text(r.stock_name) || text(r.industry_name)} {text(r.period_id)}</small></th>{evidence.kind === STOCK ? <><td>{number(r.baseline_shares, 8)}／{number(r.current_shares, 8)} 股</td><td><span className={'md-detail-change ' + tone(r.delta_shares)}>{signed(r.delta_shares, 8)} 股</span><small>{finite(r.delta_shares) ? signed(r.delta_shares / 1000, 8) : '未知'} 張</small></td><td>{number(r.close_price_twd, 8)} 元<small>{day(r.price_date)}</small></td><td><span className={'md-detail-change ' + tone(r.delta_value_estimate_twd)}>{signed(r.delta_value_estimate_twd, 8)} 元</span><small>{finite(r.delta_value_estimate_twd) ? signed(r.delta_value_estimate_twd / 1e8, 10) : '未知'} 億元</small></td><td>{finite(r.unit_adjusted_change_pct) ? signed(r.unit_adjusted_change_pct, 8) + '%' : '不適用／未知'}</td></> : <><td>{signed(r.increase_value_estimate_twd, 8)}</td><td>{signed(r.decrease_value_estimate_twd, 8)}</td><td>{signed(r.net_value_estimate_twd, 8)}</td><td>{number(r.baseline_weight_pct, 8)}%／{number(r.current_weight_pct, 8)}%</td><td>{signed(r.delta_weight_pp, 8)} 百分點</td></>}<td>{({ held: '持有', entered: '新增', exited: '退出', not_held: '兩端未持有', unknown: '未知' } as Record<string, string>)[r.holding_state] || ''}<small>{({ complete: '完整', partial: '部分覆蓋', unavailable: '未取得' } as Record<string, string>)[r.data_status] || text(r.data_status)} · {text(r.missing_reason) || '未另列缺口'}</small><small>來源 {(r.source_ids || []).join('、')}</small></td></tr>)}</tbody></table></div>}
    <Pager page={page} count={evidence.rows.length} onChange={setPage} label='精確證據分頁' />
    <p className='md-caption'>{estimate.description} 方法：{estimate.formula || '依來源說明，未提供可重算公式'}。價格／分類依同版報告。</p>
    {evidence.kind !== STOCK && <p className='md-caption'>同期間基金份額：{contexts.map(c => (weekly ? text(c.period_id) + ' ' : '') + text(c.etf_code) + ' ' + (finite(c.units_change_pct) ? signed(c.units_change_pct, 8) + '%' : '未知')).join('；') || '未取得'}</p>}
    <Sources report={report} ids={ids} />
  </section>;
}

export function MarkdownEtfReader({ report, version, publishedAt, coverUrl, preview = false }: {
  report: MarkdownReport; version?: number; publishedAt?: string | null; coverUrl?: string; preview?: boolean;
}) {
  useFooterVersion(version, '文章版本', !preview);
  const prefix = 'markdown-etf-' + useId().replaceAll(':', '');
  const [state, setState] = useState(() => readState(report, version, preview));
  const [notice, setNotice] = useState('');
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const article = useRef<HTMLElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const positions = useRef<Record<string, { y: number; left: number[] }>>({});
  const firstLayout = useRef(true);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const referenceTarget = useRef(false);
  const syncedLocation = useRef<string | null>(null);
  const identity = report.id + ':' + report.sourceHash + ':' + version;
  const focusReference = () => {
    const target = document.getElementById(prefix + '-reference-sources');
    const tabs = article.current?.querySelector<HTMLElement>(':scope > .etf-tabs');
    if (!target || !tabs) return;
    const offset = (Number.parseFloat(window.getComputedStyle(tabs).top) || 0) + tabs.getBoundingClientRect().height + 14;
    target.focus({ preventScroll: true });
    window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: 'instant' });
  };
  const rememberPosition = () => {
    if (firstLayout.current || !article.current) return;
    const current = stateRef.current;
    const panel = article.current.querySelector<HTMLElement>('[data-etf-panel="' + current.tab + '"]');
    if (!panel || panel.hidden) return;
    positions.current[current.tab + ':' + current.chart] = { y: window.scrollY, left: [...panel.querySelectorAll<HTMLElement>('.etf-table-scroll')].map(n => n.scrollLeft) };
    if (!preview) try { window.sessionStorage.setItem(stateKey(report, version) + ':positions', JSON.stringify(positions.current)); } catch { /* Optional reading position. */ }
  };
  const update = (patch: Partial<ReaderState>, push = true) => {
    syncedLocation.current = null;
    if (patch.tab && patch.tab !== stateRef.current.tab || patch.chart && patch.chart !== stateRef.current.chart) rememberPosition();
    setState(current => {
    const next = { ...current, ...patch };
    const options = markdownValidSectors(records(report, next.chart), next.chart, next.fund, next.unit);
    if (next.sector && !options.includes(next.sector)) { next.sector = ''; next.page = 1; setEvidence(null); setNotice('原產業在目前圖表／基金／單位沒有已知非零資料，已回到全部產業與第 1 頁。'); }
    if (!preview) persistState(report, version, next, push);
    return next;
    });
  };
  useEffect(() => {
    if (!preview) try {
      const value = JSON.parse(window.sessionStorage.getItem(stateKey(report, version) + ':positions') || '{}');
      positions.current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { positions.current = {}; }
    const sync = () => {
      if (!preview && !matchesRoute(report, version)) return;
      referenceTarget.current = false;
      // Effect replay or duplicate navigation events may read the URL this sync just normalized.
      if (syncedLocation.current !== identity + ':' + preview + ':' + window.location.hash) setNotice('');
      const next = readState(report, version, preview), funds = fundCodes(report);
      if (next.fund && !funds.includes(next.fund)) { next.fund = ''; setNotice('原基金已不在這個版本，已回到全部基金。'); }
      const options = markdownValidSectors(records(report, next.chart), next.chart, next.fund, next.unit);
      if (next.sector && !options.includes(next.sector)) { next.sector = ''; next.page = 1; setNotice('原產業在目前圖表／基金／單位沒有已知非零資料，已回到全部產業與第 1 頁。'); }
      setState(next); setEvidence(null);
      if (!preview) persistState(report, version, next, false);
      syncedLocation.current = identity + ':' + preview + ':' + window.location.hash;
    };
    sync();
    if (preview) return;
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    window.addEventListener('pagehide', rememberPosition);
    return () => { rememberPosition(); window.removeEventListener('pagehide', rememberPosition); window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, [identity, preview]);
  useLayoutEffect(() => {
    if (!preview && !matchesRoute(report, version)) return;
    const initial = firstLayout.current;
    const frame = window.requestAnimationFrame(() => {
      firstLayout.current = false;
      const stored = positions.current[state.tab + ':' + state.chart];
      if (finite(stored?.y) && stored.y >= 0) window.scrollTo({ top: stored.y, behavior: 'instant' });
      else if (!initial) {
        const tabs = article.current?.querySelector<HTMLElement>(':scope > .etf-tabs');
        const heading = article.current?.querySelector<HTMLElement>(':scope > .md-heading');
        const anchor = heading || article.current;
        if (tabs && anchor) {
          // Use a normal-flow anchor even when the tabs are already stuck.
          const stickyOffset = Number.parseFloat(window.getComputedStyle(tabs).top) || 0;
          const edge = heading ? anchor.getBoundingClientRect().bottom : anchor.getBoundingClientRect().top;
          window.scrollTo({ top: Math.max(0, edge + window.scrollY - stickyOffset), behavior: 'instant' });
        }
      }
      const panel = article.current?.querySelector<HTMLElement>('[data-etf-panel="' + state.tab + '"]');
      panel?.querySelectorAll<HTMLElement>('.etf-table-scroll').forEach((n, i) => { if (finite(stored?.left?.[i])) n.scrollLeft = stored.left[i]; });
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-etf-panel][hidden]')) document.getElementById(prefix + '-tab-' + state.tab)?.focus({ preventScroll: true });
      if (state.tab === 'references' && referenceTarget.current) { focusReference(); referenceTarget.current = false; }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [identity, preview, state.tab, state.chart]);
  const open = (next: Evidence, node: HTMLButtonElement) => { trigger.current = node; setEvidence(next); };
  const close = () => { setEvidence(null); trigger.current?.focus({ preventScroll: true }); trigger.current?.scrollIntoView({ block: 'nearest' }); };
  const selectedRows = records(report, state.chart);
  const sectors = markdownValidSectors(selectedRows, state.chart, state.fund, state.unit);
  const funds = fundCodes(report).filter(code => selectedRows.some(r => r.etf_code === code && r.data_status !== 'unavailable' && finite(r[state.chart === STOCK ? 'delta_shares' : 'net_value_estimate_twd'])));
  const metadata = report.shared.metadata || {};
  const industryBasis = markdownEstimateInfo(report, INDUSTRY);
  const chartBasis = markdownEstimateInfo(report, state.chart);
  const commonProps = { report, fund: state.fund, sector: state.sector, page: state.page, setPage: (page: number) => update({ page }), open };
  const showReferences = () => {
    setEvidence(null);
    if (stateRef.current.tab === 'references') { window.requestAnimationFrame(focusReference); return; }
    referenceTarget.current = true;
    update({ tab: 'references' });
  };
  const sourceJump = (href: string) => {
    if (!href.startsWith('#')) return;
    showReferences();
  };
  return <article ref={article} aria-label={report.title} className={'md-etf-reader' + (preview ? ' md-preview' : '')} data-markdown-report={report.id}>
    <ResearchArticleHeading report={report} label='主動式 ETF 研究' coverUrl={coverUrl} publishedAt={publishedAt} preview={preview} />
    <EtfTabs idPrefix={prefix} label='研究報告內容' tabs={TABS} value={state.tab} onChange={tab => { referenceTarget.current = false; setEvidence(null); update({ tab }); }} />
    <EtfTabPanel idPrefix={prefix} id='analysis' active={state.tab === 'analysis'}>{report.format === 'etf-json' && report.analysis ? <JsonAnalysis analysis={report.analysis} sourceJump={sourceJump} /> : <div className='md-analysis'><KeyMetrics report={report} open={open} layout='summary' /><div className='md-prose md-analysis-prose'><Markdown remarkPlugins={[remarkAnalysisReading]} skipHtml urlTransform={url => safeHref(url) || ''} components={{
      a: ({ href, children }) => {
        const safe = safeHref(href);
        if (!safe) return <span>{children}</span>;
        // An in-report citation is an action: leaving href="#..." would expose the SPA router to navigation.
        if (safe.startsWith('#')) return <button type='button' className='md-source-jump' onClick={event => { event.preventDefault(); sourceJump(safe); }}>{children}</button>;
        return <a href={safe} target='_blank' rel='noopener noreferrer'>{children}<span className='sr-only'>（開啟新分頁）</span></a>;
      },
      img: ({ alt }) => <span>{alt ? '圖片說明：' + alt : ''}</span>,
    }}>{report.articleMarkdown}</Markdown>
    </div></div>}</EtfTabPanel>
    <EtfTabPanel idPrefix={prefix} id='allocation' active={state.tab === 'allocation'}><div className='md-reading-layout'><div className='md-charts'><div className='md-chart-toolbar'><div className='md-chart-choices' role='group' aria-label='配置圖表種類'>{CHARTS.map(chart => <button type='button' key={chart.id} aria-pressed={state.chart === chart.id} onClick={() => { setNotice(''); setEvidence(null); update({ chart: chart.id, page: 1 }); }}>{chart.label}</button>)}</div></div>
      <div className='etf-filter md-chart-filters'><label>基金<CatalogSelect label='基金篩選' value={state.fund}
        options={[{value:'',label:'全部基金'}, ...funds.map(code => ({value:code,label:code + ' ' + dict(report, 'etfs', code)}))]}
        onChange={fund => { setNotice(''); setEvidence(null); update({fund, page:1}); }} /></label>
        <label>產業<CatalogSelect label='產業篩選' value={state.sector}
          options={[{value:'',label:'全部產業'}, ...sectors.map(code => ({value:code,label:dict(report, 'industries', code)}))]}
          onChange={sector => { setNotice(''); setEvidence(null); update({sector, page:1}); }} /></label>
        {state.chart === STOCK && <div role='group' aria-label='個股變動單位' className='md-unit-choices'><button type='button' aria-pressed={state.unit === 'lots'} onClick={() => { setNotice(''); setEvidence(null); update({ unit: 'lots', page: 1 }); }}>張數</button><button type='button' aria-pressed={state.unit === 'value'} onClick={() => { setNotice(''); setEvidence(null); update({ unit: 'value', page: 1 }); }}>億元</button></div>}
        <button type='button' onClick={() => { setNotice('已重設為全部基金與全部產業。'); setEvidence(null); update({ fund: '', sector: '', page: 1 }); }}><RotateCcw size={14} aria-hidden='true' />重設篩選</button>
      </div>{notice && <p role='status' className='md-notice'>{notice}</p>}
      {chartBasis.basis !== industryBasis.basis && <p className='md-notice'>目前圖表使用{chartBasis.label}，右側關鍵數據使用產業圖的{industryBasis.label}；兩者分開呈現，不跨口徑加總。</p>}
      {state.chart === INDUSTRY && <IndustryChart {...commonProps} />}{state.chart === STOCK && <StockChart {...commonProps} unit={state.unit} />}{state.chart === WEEKLY && <WeeklyChart {...commonProps} />}
      <button type='button' className='md-chart-reference-link' aria-controls={prefix + '-panel-references'} onClick={showReferences}>查看這張圖的參考來源</button>
    </div><KeyMetrics report={report} open={open} /></div></EtfTabPanel>
    <EtfTabPanel idPrefix={prefix} id='references' active={state.tab === 'references'}><ReportReferences report={report} prefix={prefix} /></EtfTabPanel>
    {evidence && <EvidencePanel report={report} evidence={evidence} onClose={close} />}
  </article>;
}
