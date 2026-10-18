import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '@appdeploy/client';
import { CircleAlert, RefreshCw, X } from 'lucide-react';
import type { IndustryFlowPoint, IndustryFlowResponse, IndustryFlowSeries } from '../shared/etf-data-contract';
import './active-etf.css';
import './etf-history.css';
type Phase = 'loading' | 'ready' | 'error';
function unwrap<T>(response: { data: unknown }): T {
  const value = response.data;
  return (value && typeof value === 'object' && 'data' in value
    ? (value as { data: unknown }).data : value) as T;
}
function textNumber(value: string | null | undefined, signed = false) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return '未知';
  const negative = value.startsWith('-');
  const [integer, decimal] = (negative ? value.slice(1) : value).split('.');
  const nonzero = /[1-9]/.test(integer + (decimal || ''));
  return (negative && nonzero ? '−' : signed && nonzero ? '+' : '')
    + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    + (decimal !== undefined ? '.' + decimal : '');
}
function dateText(value: string | null | undefined) {
  return value ? value.replaceAll('-', '/') : '尚無可用日期';
}
type FlowView = 'heatmap' | 'trend' | 'data';
type FlowSelection = { industryId: string; date: string } | null;
function readFlowQuery() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return { fundId: params.get('fund') || '', industryId: params.get('industry') || '',
    synthetic: params.get('dataset') === 'synthetic',
    view: (['heatmap', 'trend', 'data'].includes(params.get('view') || '') ? params.get('view') : 'heatmap') as FlowView };
}
function billionText(value: string | null, signed = true) {
  if (value === null) return '未知';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const digits = whole.padStart(9, '0') + fraction;
  const split = whole.padStart(9, '0').length - 8;
  const integer = digits.slice(0, split).replace(/^0+(?=\d)/, '');
  const decimal = digits.slice(split).replace(/0+$/, '');
  const nonzero = /[1-9]/.test(digits);
  return (negative && nonzero ? '−' : signed && nonzero ? '+' : '') + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    + (decimal ? '.' + decimal : '');
}
const flowReasons: Record<string, string> = {
  no_published_data: '此日無已發布資料', source_estimate_unavailable: '無可用金額估算',
  unconfirmed_date: '來源實際日期待核對', classification_change: '分類變動，無法比較',
  missing_baseline: '缺少可核對的每日基期', imprecise_value: '金額精度不足或未知',
  closed: '已核對休市日',
};
function flowPoint(result: IndustryFlowResponse, row: IndustryFlowSeries, day: string): IndustryFlowPoint {
  return row.points.find(p => p.date === day) || { date: day, valueNtd: null, precision: 'unknown', status: 'missing',
    reason: result.calendar[day] === 'closed' ? 'closed' : 'no_published_data',
    intervalStart: null, observedStocks: 0, classificationVersion: null, classificationChanged: false };
}
function flowDescription(point: IndustryFlowPoint) {
  return point.valueNtd !== null && point.precision === 'exact' && point.status === 'observed'
    ? billionText(point.valueNtd) + ' 億元' : flowReasons[point.reason || ''] || '無可用資料';
}
function FlowGrid({ result, view, onSelect }: {
  result: IndustryFlowResponse; view: FlowView;
  onSelect: (selection: FlowSelection, trigger: HTMLElement) => void;
}) {
  const [focus, setFocus] = useState(0);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const dates = result.dates;
  const rows = result.series;
  const columns = dates.length;
  const max = Math.max(1, ...rows.flatMap(row => row.points.map(p => p.valueNtd !== null ? Math.abs(Number(p.valueNtd)) : 0)));
  useEffect(() => setFocus(0), [result.fundId, result.industryId, view]);
  return <div className='eif-grid-scroll' role='region' aria-label={view === 'trend' ? '各產業每日估算趨勢，可捲動' : '各產業每日估算熱力圖，可捲動'} tabIndex={0}>
    <table className={'eif-grid ' + (view === 'trend' ? 'eif-trend' : '')}>
      <caption className='sr-only'>橫軸為曆日，金額為有來源異動樣本的持倉增減估算，單位億元。方向鍵移動，Enter查看明細。</caption>
      <colgroup><col className='eif-row-col' />{dates.map(day => <col key={day} />)}</colgroup>
      <thead><tr><th scope='col'><span className='sr-only'>產業／日期</span></th>{dates.map((day, n) =>
        <th key={day} scope='col' title={dateText(day)} className={n === 0 || n === columns - 1 || n % 15 === 0 && n < columns - 5 ? 'eif-tick' : ''}><span className={n === 0 || n === columns - 1 || n % 15 === 0 && n < columns - 5 ? '' : 'sr-only'}>{day.slice(5).replace('-', '/')}</span></th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={row.industryId}>
        <th scope='row' title={row.label}>{row.label}</th>
        {dates.map((day, c) => {
          const p = flowPoint(result, row, day);
          const known = p.status === 'observed' && p.precision === 'exact' && p.valueNtd !== null;
          const numeric = known ? Number(p.valueNtd) : null;
          const index = r * columns + c;
          const direction = numeric === null ? 'missing' : numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'zero';
          const style = { '--eif-strength': numeric === null ? 0 : .15 + Math.abs(numeric) / max * .85,
            '--eif-height': numeric === null ? '0%' : Math.max(2, Math.abs(numeric) / max * 46) + '%' } as CSSProperties;
          return <td key={day}><button type='button' ref={el => { if (el) buttons.current.set(index, el); else buttons.current.delete(index); }}
            className={'eif-cell ' + direction + (result.calendar[day] === 'closed' ? ' closed' : '')} style={style}
            tabIndex={index === Math.min(focus, rows.length * columns - 1) ? 0 : -1}
            aria-label={row.label + '，' + dateText(day) + '，' + flowDescription(p)}
            title={dateText(day) + ' · ' + row.label + ' · ' + flowDescription(p)}
            onFocus={() => setFocus(index)}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? Math.min(index + 1, rows.length * columns - 1)
                : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
                  : event.key === 'ArrowDown' ? Math.min(index + columns, rows.length * columns - 1)
                    : event.key === 'ArrowUp' ? Math.max(index - columns, 0)
                      : event.key === 'Home' ? r * columns : event.key === 'End' ? (r + 1) * columns - 1 : null;
              if (next !== null) { event.preventDefault(); setFocus(next); buttons.current.get(next)?.focus(); }
            }}
            onClick={event => onSelect({ industryId: row.industryId, date: day }, event.currentTarget)}>
            {view === 'trend' && known ? <i aria-hidden='true' /> : <span aria-hidden='true'>{known ? numeric === 0 ? '0' : '' : '−'}</span>}
          </button></td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
function FlowTable({ result, onSelect }: { result: IndustryFlowResponse;
  onSelect: (selection: FlowSelection, trigger: HTMLElement) => void }) {
  return <div className='eif-data-scroll' role='region' aria-label='產業每日金額估算數據，可捲動' tabIndex={0}>
    <table className='etf-table eif-data'><caption>同一查詢的精確數值；所有日期缺口均保留，金額單位為億元。</caption>
      <thead><tr><th scope='col'>日期</th><th scope='col'>產業</th><th scope='col'>持倉增減估算（億元）</th><th scope='col'>覆蓋與缺口</th></tr></thead>
      <tbody>{[...result.dates].reverse().flatMap(day => result.series.map(row => {
        const p = flowPoint(result, row, day);
        return <tr key={day + row.industryId}><th scope='row'><button type='button' aria-label={row.label + '，' + dateText(day) + '，查看明細'}
          onClick={event => onSelect({ industryId: row.industryId, date: day }, event.currentTarget)}>{dateText(day)}</button></th>
          <td>{row.label}</td><td>{flowDescription(p)}</td><td>{p.status === 'observed' ? '已觀測 ' + p.observedStocks + ' 檔股票，非完整產業流量' : flowReasons[p.reason || ''] || '無可用資料'}</td></tr>;
      }))}</tbody>
    </table>
  </div>;
}
function IndustryFlowView() {
  const [query, setQuery] = useState(readFlowQuery);
  const [result, setResult] = useState<IndustryFlowResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<FlowSelection>(null);
  const sequence = useRef(0);
  const cache = useRef(new Map<string, IndustryFlowResponse>());
  const pendingPin = useRef<{ key: string; pin: string } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const detail = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestKey = (query.synthetic ? 'qa|' : 'real|') + query.fundId + '|' + query.industryId;
  const activeQuery = useRef(query);
  activeQuery.current = query;
  useEffect(() => {
    const read = () => setQuery(readFlowQuery());
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    document.title = (query.synthetic ? '合成測試 · ' : '') + 'ETF 產業資金流向 — PocketStocks';
    const id = ++sequence.current;
    setSelection(null); setError('');
    const cached = cache.current.get(requestKey);
    if (cached && retry === 0) { setResult(cached); setPhase('ready'); return; }
    setPhase('loading');
    let alive = true;
    async function load() {
      const params = new URLSearchParams();
      if (query.synthetic) params.set('dataset', 'synthetic');
      const endpoint = query.synthetic ? '/api/etf/qa-industry-history?' : '/api/etf/industry-history?';
      if (query.fundId) params.set('fundId', query.fundId);
      if (query.industryId) params.set('industryId', query.industryId);
      if (pendingPin.current?.key === requestKey) params.set('pin', pendingPin.current.pin);
      const first = unwrap<IndustryFlowResponse>(await api.get(endpoint + params.toString()));
      if (!alive || sequence.current !== id) return;
      if (first.pin) pendingPin.current = { key: requestKey, pin: first.pin };
      let current = first;
      const seen = new Set<string>();
      while (current.nextCursor) {
        if (!current.pin || seen.has(current.nextCursor) || seen.size > 100) throw new Error('資料分頁尚未完整，請重試。');
        seen.add(current.nextCursor);
        params.set('fundId', current.fundId || '');
        if (current.industryId) params.set('industryId', current.industryId); else params.delete('industryId');
        params.set('pin', current.pin); params.set('cursor', current.nextCursor);
        const next = unwrap<IndustryFlowResponse>(await api.get(endpoint + params.toString()));
        if (!alive || sequence.current !== id) return;
        if (next.pin !== first.pin) throw new Error('資料版本不一致，請重試。');
        current = { ...current, series: [...current.series, ...next.series], nextCursor: next.nextCursor };
      }
      const canonicalKey = (query.synthetic ? 'qa|' : 'real|') + (current.fundId || '') + '|' + (current.industryId || '');
      cache.current.set(canonicalKey, current);
      while (cache.current.size > 12) cache.current.delete(cache.current.keys().next().value!);
      setResult(current); setPhase('ready'); pendingPin.current = null;
      if ((current.fundId || '') !== query.fundId || (current.industryId || '') !== query.industryId) {
        const next = new URLSearchParams();
        if (query.synthetic) next.set('dataset', 'synthetic');
        if (current.fundId) next.set('fund', current.fundId);
        if (current.industryId) next.set('industry', current.industryId);
        if (activeQuery.current.view !== 'heatmap') next.set('view', activeQuery.current.view);
        window.history.replaceState(null, '', '#/active-etf/history' + (next.size ? '?' + next.toString() : ''));
        setQuery({ ...activeQuery.current, fundId: current.fundId || '', industryId: current.industryId || '' });
        setRetry(0);
      }
    }
    load().catch(caught => {
      if (!alive || sequence.current !== id) return;
      setError(caught instanceof Error && /^(資料分頁尚未完整|資料版本不一致)/.test(caught.message) ? caught.message : '無法取得目前篩選的已發布資料，請重試或返回上一個查詢。');
      setPhase('error');
    });
    return () => { alive = false; };
  }, [requestKey, retry]);
  useEffect(() => { if (selection) detail.current?.focus(); }, [selection]);
  function update(values: Partial<typeof query>) {
    const next = { ...query, ...values };
    const params = new URLSearchParams();
    if (next.synthetic) params.set('dataset', 'synthetic');
    if (next.fundId) params.set('fund', next.fundId);
    if (next.industryId) params.set('industry', next.industryId);
    if (next.view !== 'heatmap') params.set('view', next.view);
    setSelection(null);
    if ('fundId' in values || 'industryId' in values) { setRetry(0); pendingPin.current = null; }
    window.location.hash = '/active-etf/history' + (params.size ? '?' + params.toString() : '');
    setQuery(next);
  }
  function open(value: FlowSelection, element: HTMLElement) { trigger.current = element; setSelection(value); }
  function close() { setSelection(null); trigger.current?.focus(); }
  const visibleResult = result?.scopeId === (query.synthetic ? 'qa-etf-history' : 'tw-active-equity') ? result : null;
  const currentRow = visibleResult?.series.find(row => row.industryId === selection?.industryId);
  const selectedPoint = visibleResult && currentRow && selection ? flowPoint(visibleResult, currentRow, selection.date) : null;
  const knownDays = new Set(result?.series.flatMap(row => row.points.filter(p => p.status === 'observed').map(p => p.date)));
  const options = [{ id: 'heatmap', label: '熱力圖' }, { id: 'trend', label: '趨勢' }, { id: 'data', label: '數據' }] as const;
  return <section className='eif-root'>
    <h1>ETF 產業資金流向</h1>
    {query.synthetic && <p className='eif-synthetic' role='status'>合成測試資料：基金、產業、日期、日曆與金額均為虛構，僅供系統驗證。 <a href='#/active-etf/history'>返回研究資料</a></p>}
    <div className='eif-filters'>
      <label htmlFor='eif-fund'>ETF</label><select id='eif-fund' value={query.fundId} disabled={!visibleResult?.funds.length && phase === 'loading'}
        onChange={event => update({ fundId: event.target.value, industryId: '' })}>
        {!visibleResult?.funds.length && <option value={query.fundId}>{phase === 'loading' ? '正在載入基金…' : '尚無可用基金'}</option>}
        {visibleResult?.funds.map(fund => <option key={fund.fundId} value={fund.fundId}>{fund.code} {fund.name}</option>)}
      </select>
      <label htmlFor='eif-industry'>產業</label><select id='eif-industry' value={query.industryId}
        disabled={!visibleResult?.industries.length} onChange={event => update({ industryId: event.target.value })}>
        <option value=''>全部產業</option>{visibleResult?.industries.map(item => <option key={item.industryId} value={item.industryId}>{item.label}</option>)}
      </select>
      <div className='eif-period'><strong>最近 3 個月</strong><span>{visibleResult?.start ? dateText(visibleResult.start) + ' – ' + dateText(visibleResult.end) : phase === 'loading' ? '正在確認資料日期' : '尚無已發布日期'}</span>
        <small>資料截至 {visibleResult?.end ? dateText(visibleResult.end) : '尚無資料'}</small></div>
    </div>
    <section className='eif-panel' aria-labelledby='eif-panel-title' aria-busy={phase === 'loading'}>
      <div className='eif-panel-header'><div><h2 id='eif-panel-title'>各產業每日增減持</h2><span>持倉增減估算 · 已觀測樣本</span></div>
        <div role='tablist' aria-label='產業資金流向視圖'>{options.map((item, i) => <button type='button' key={item.id}
          ref={el => { tabs.current[i] = el; }} role='tab' id={'eif-tab-' + item.id}
          aria-controls='eif-view' aria-selected={query.view === item.id} tabIndex={query.view === item.id ? 0 : -1}
          onKeyDown={event => {
            const target = event.key === 'ArrowRight' ? (i + 1) % options.length : event.key === 'ArrowLeft' ? (i + options.length - 1) % options.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
            if (target !== null) { event.preventDefault(); update({ view: options[target].id }); tabs.current[target]?.focus(); }
          }}
          onClick={() => update({ view: item.id })}>{item.label}</button>)}</div>
      </div>
      <div id='eif-view' role='tabpanel' aria-labelledby={'eif-tab-' + query.view} tabIndex={0}>
        <div className='eif-meta'><span>{visibleResult?.funds.find(f => f.fundId === (query.fundId || visibleResult.fundId))?.name || '已發布日資料'}</span><span>單位：億元</span></div>
        {phase === 'loading' && <div className='eif-state' role='status'><RefreshCw size={22} aria-hidden='true' /><h3>正在載入產業資料</h3><p>保留目前篩選，正在確認已發布日期與金額。</p></div>}
        {phase === 'error' && <div className='eif-state' role='alert'><CircleAlert size={24} aria-hidden='true' /><h3>資料暫時無法載入</h3><p>{error}</p><button type='button' onClick={() => setRetry(value => value + 1)}>重試</button></div>}
        {phase === 'ready' && visibleResult && <>
          <p className='eif-coverage' role='status'>{visibleResult.publishedDays ? '此基金於期間內有 ' + visibleResult.publishedDays + ' 個發布日。' : '目前沒有已發布日資料。'}
            {knownDays.size === 0 ? ' 尚無可用每日金額估算；日期缺口保留。' : knownDays.size === 1 ? ' 僅一日有金額估算，尚無連續歷史。' : ' 有金額的日期為部分樣本，缺日不連接。'}
            {' '}橫軸為曆日；未核對日曆不推定交易日。</p>
          {visibleResult.series.length > 0 ? query.view === 'data' ? <FlowTable result={visibleResult} onSelect={open} />
            : <FlowGrid result={visibleResult} view={query.view} onSelect={open} />
            : <div className='eif-state'><h3>尚無可用產業資料</h3><p>已有資料發布後，這裡會顯示實際日期與金額缺口。</p></div>}
        </>}
      </div>
      <div className='eif-legend'><div><div className='eif-scale' /><div className='eif-scale-labels'><span>減持</span><span>0</span><span>增持</span></div></div>
        <span className='eif-missing-key'>−</span><span>無資料／不可比較</span><small>依持倉變化估算，非實際成交金額。</small></div>
    </section>
    {selection && currentRow && selectedPoint && <div className='eif-detail' ref={detail} tabIndex={-1} role='region' aria-labelledby='eif-detail-title'
      onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div><h2 id='eif-detail-title'>{dateText(selection.date)} · {currentRow.label}</h2><button type='button' aria-label='關閉日期明細' onClick={close}><X size={18} /></button></div>
      <p>持倉增減估算：<strong>{flowDescription(selectedPoint)}</strong></p>
      {selectedPoint.intervalStart && <p>來源期間 {dateText(selectedPoint.intervalStart)} – {dateText(selection.date)}</p>}
      <p>{selectedPoint.status === 'observed' ? '已觀測 ' + selectedPoint.observedStocks + ' 檔股票的來源金額，並非完整產業淨流量。' : '沒有足夠證據時保留未知，不填入 0。'}</p>
      {selectedPoint.valueNtd !== null && <p>原始金額（新台幣元）：{textNumber(selectedPoint.valueNtd, true)}</p>}
    </div>}
    {visibleResult && phase === 'ready' && <p className='eif-notes'>{visibleResult.warnings.join(' ')}</p>}
  </section>;
}
export function EtfHistoryView() { return <IndustryFlowView />; }
