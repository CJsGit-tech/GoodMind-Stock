import { ResearchArticleHeading } from './research-article-heading';
import { CatalogSearch } from './catalog-search';
import { CatalogSelect } from './catalog-select';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { FLOW_ACCOUNTS, finiteFlow, filterFlowStocks, flowHeatScale, flowStockPage, flowStockValue, type FlowAccount, type FlowStock, type FlowUnit } from './institutional-chart-model';
import { ReferenceCitations } from './etf-markdown-reader';
import type { MarkdownReport } from '../shared/etf-markdown';
import { EtfTabs, EtfTabPanel } from './active-etf';
import './etf-markdown-reader.css';
import './institutional-research.css';
export const flowNumber = (v: unknown, scale = 1) => typeof v === 'number' && Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v / scale).toLocaleString('zh-TW', { maximumFractionDigits: scale === 1000 ? 3 : 2 }) : '未知';
const tone = (v: any) => !finiteFlow(v) ? 'md-unknown' : v > 0 ? 'md-up' : v < 0 ? 'md-down' : 'md-zero';
const institutionName = (i: string) => ({ foreign_ex_dealer: '外資', investment_trust: '投信', dealer_self: '自營自行', dealer_hedge: '自營避險' }[i] || i);
function Runs({ runs, sourceIds, onSourceJump }: { runs: any[]; sourceIds: string[]; onSourceJump: () => void }) {
    const citations = [...new Set<string>(runs.flatMap(r => r.source_ids || []).filter((id: string) => sourceIds.includes(id)))];
    return <>{runs.map((r, i) => {
        if (r.source_ids?.some((id: string) => sourceIds.includes(id))) return null;
        const content = <span className={r.role === 'company_name' ? 'institutional-company' : r.role === 'numeric' ? tone(r.value) : ''}>{r.text}</span>;
        return r.href ? <a key={i} href={r.href} target='_blank' rel='noopener noreferrer'>{content}<span className='sr-only'>（開啟新分頁）</span></a> : r.bold ? <strong key={i}>{content}</strong> : <span key={i}>{content}</span>;
    })}{citations.length > 0 && <span className='institutional-inline-citations'>{citations.map(id => <button key={id} type='button' className='md-source-jump' aria-label={'查看來源 ' + (sourceIds.indexOf(id) + 1)} onClick={onSourceJump}>[{sourceIds.indexOf(id) + 1}]</button>)}</span>}</>;
}
type Detail = { stock: FlowStock; account: FlowAccount; unit: FlowUnit };
const CHARTS = [{ id: 'industry', label: '產業方向' }, { id: 'stocks', label: '個股分歧' }, { id: 'weekly', label: '週度趨勢' }];
const displayCellValue = (value: number | null, unit: FlowUnit) => value === null ? '未知' : flowNumber(value * (unit === 'lots' ? 1000 : 1), unit === 'lots' ? 1000 : 1);

export function InstitutionalReader({ report, coverUrl, publishedAt }: {
    report: MarkdownReport; coverUrl?: string; publishedAt?: string;
}) {
    const d = report.institutionalData!;
    const sourceIds = Object.keys(report.shared.source_registry || {});
    const sourceHeading = useRef<HTMLHeadingElement>(null), detailHeading = useRef<HTMLHeadingElement>(null);
    const detailTrigger = useRef<HTMLButtonElement | null>(null);
    const [tab, setTab] = useState('analysis'), [group, setGroup] = useState(0);
    const [chart, setChart] = useState('industry'), [unit, setUnit] = useState<FlowUnit>('lots');
    const [search, setSearch] = useState(''), [sector, setSector] = useState('');
    const [sort, setSort] = useState<'buy' | 'sell' | 'code'>('buy'), [metric, setMetric] = useState('estimate');
    const [page, setPage] = useState(1), [detail, setDetail] = useState<Detail | null>(null);
    const groups = d.data.group_summaries, g = groups[group], market = g.market, inst = g.institution as FlowAccount;
    const day = report.period.end;
    const allStocks = d.data.stock_trades as FlowStock[];
    const marketStocks = allStocks.filter(row => row.market === market);
    const allSectors = d.data.sector_summaries.filter((row: any) => row.market === market && row.institution === inst);
    const activeSector = chart === 'weekly' ? '' : sector;
    const sectors = allSectors.filter((row: any) => !activeSector || row.sector_code === activeSector);
    const sectorValue = (row: any) => metric === 'estimate' ? row.estimate_twd : row.breadth;
    sectors.sort((a: any, b: any) => Math.abs(sectorValue(b) || 0) - Math.abs(sectorValue(a) || 0));
    const sectorMax = Math.max(1, ...allSectors.map((row: any) => Math.abs(sectorValue(row) || 0)));
    const stocks = filterFlowStocks(allStocks, { market, sector, query: search, account: inst, unit, sort, researchDate: day });
    const stockPage = flowStockPage(stocks, page);
    const heatScale = flowHeatScale(marketStocks, unit, day);
    const unitLabel = unit === 'lots' ? '張' : '億元';
    const weekly = d.data.weekly_trends.filter((row: any) => row.market === market && row.institution === inst);
    const totals = d.data.market_totals.filter((row: any) => row.market === market && row.trade_date === day && FLOW_ACCOUNTS.includes(row.institution));
    const metricSector = [...sectors].filter((row: any) => finiteFlow(row.estimate_twd)).sort((a: any, b: any) => Math.abs(b.estimate_twd) - Math.abs(a.estimate_twd))[0];
    const scopeStocks = marketStocks.filter(row => !activeSector || row.sector_code === activeSector);
    const buyCount = scopeStocks.filter(row => finiteFlow(row.accounts[inst]?.net) && row.accounts[inst]!.net! > 0).length;
    const sellCount = scopeStocks.filter(row => finiteFlow(row.accounts[inst]?.net) && row.accounts[inst]!.net! < 0).length;

    useEffect(() => {
        if (!detail) return;
        detailHeading.current?.focus({ preventScroll: true });
        detailHeading.current?.scrollIntoView({ block: 'nearest' });
    }, [detail]);
    function sourceJump() {
        setDetail(null); setTab('sources');
        requestAnimationFrame(() => { sourceHeading.current?.focus(); sourceHeading.current?.scrollIntoView({ block: 'start' }); });
    }
    function chooseGroup(index: number) {
        setGroup(index); setSearch(''); setSector(''); setPage(1); setDetail(null);
    }
    function changeFilter(change: () => void) { change(); setPage(1); setDetail(null); }
    function reset() {
        setGroup(0); setSearch(''); setSector(''); setSort('buy'); setMetric('estimate'); setUnit('lots'); setPage(1); setDetail(null);
    }
    function closeDetail() {
        setDetail(null);
        requestAnimationFrame(() => { detailTrigger.current?.focus({ preventScroll: true }); detailTrigger.current?.scrollIntoView({ block: 'nearest' }); });
    }
    function openDetail(stock: FlowStock, account: FlowAccount, trigger: HTMLButtonElement) {
        detailTrigger.current = trigger; setDetail({ stock, account, unit });
    }
    return <article className='institutional-reader md-etf-reader'><ResearchArticleHeading report={report} label='三大法人研究' coverUrl={coverUrl} publishedAt={publishedAt} />
 <EtfTabs idPrefix='institutional-reader' label='法人文章內容' tabs={[{ id: 'analysis', label: '重點分析' }, { id: 'charts', label: '買賣超圖表' }, { id: 'sources', label: '參考來源依據' }]} value={tab} onChange={value => { setDetail(null); setTab(value); }}/>
 <EtfTabPanel idPrefix='institutional-reader' id='analysis' active={tab === 'analysis'}><div className='institutional-groups' aria-label='外資與投信官方買賣超'>{groups.map((r: any, i: number) => <button key={r.market + r.institution} type='button' onClick={() => { chooseGroup(i); setTab('charts'); }}><span>{r.title}</span><strong className={tone(r.official_market_net_twd)}>{flowNumber(r.official_market_net_twd, 1e8)} 億</strong></button>)}</div><div className='md-prose institutional-prose'>{d.analysis.sections.map((s: any) => <section key={s.id}><h3>{s.title}</h3>{s.blocks.map((b: any, i: number) => b.type === 'list' ? <ul key={i}>{b.items.map((item: any, j: number) => <li key={j}><Runs runs={item.runs} sourceIds={sourceIds} onSourceJump={sourceJump}/></li>)}</ul> : b.type === 'heading' ? <h4 key={i}><Runs runs={b.runs} sourceIds={sourceIds} onSourceJump={sourceJump}/></h4> : <p key={i}><Runs runs={b.runs} sourceIds={sourceIds} onSourceJump={sourceJump}/></p>)}</section>)}</div></EtfTabPanel>
 <EtfTabPanel idPrefix='institutional-reader' id='charts' active={tab === 'charts'}>
  <div className='institutional-groups' aria-label='外資與投信官方買賣超'>{groups.map((row: any, index: number) => <button type='button' key={row.market + row.institution} aria-pressed={group === index} onClick={() => chooseGroup(index)}><span>{row.title}</span><strong className={tone(row.official_market_net_twd)}>{flowNumber(row.official_market_net_twd, 1e8)} 億</strong></button>)}</div>
  <div className='md-reading-layout institutional-reading-layout'>
   <div className='md-charts'>
    <div className='institutional-chart-navigation'>
     <div className='md-chart-choices' role='group' aria-label='法人圖表種類'>{CHARTS.map(item => <button type='button' key={item.id} aria-pressed={chart === item.id} onClick={() => { setChart(item.id); setDetail(null); setPage(1); }}>{item.label}</button>)}</div>
     {chart === 'stocks' && <div role='group' aria-label='法人個股單位' className='md-unit-choices'><button type='button' aria-pressed={unit === 'lots'} onClick={() => changeFilter(() => setUnit('lots'))}>張數</button><button type='button' aria-pressed={unit === 'value'} onClick={() => changeFilter(() => setUnit('value'))}>億元</button></div>}
    </div>
    {chart !== 'weekly' && <div className={'institutional-chart-filters' + (chart === 'stocks' ? ' institutional-stock-filters' : '')}>
     {chart === 'stocks' && <div className='institutional-search-control'><span className='institutional-control-label'>搜尋個股</span><CatalogSearch label='搜尋個股' placeholder='公司名稱或代碼' value={search} onChange={value => changeFilter(() => setSearch(value))} clearLabel='清除個股搜尋'/></div>}
     <label>產業<CatalogSelect label='法人產業篩選' value={sector} options={[{ value: '', label: '全部產業' }, ...allSectors.map((row: any) => ({ value: row.sector_code, label: row.sector_name }))]} onChange={value => changeFilter(() => setSector(value))}/></label>
     {chart === 'industry' && <label>指標<CatalogSelect label='產業指標' value={metric} options={[{ value: 'estimate', label: '收盤價估算／億元' }, { value: 'breadth', label: '淨買家數 − 淨賣家數' }]} onChange={value => changeFilter(() => setMetric(value))}/></label>}
     {chart === 'stocks' && <label>排序 · {institutionName(inst)}<CatalogSelect label='個股排列' value={sort} onChange={value => changeFilter(() => setSort(value as typeof sort))} options={[{ value: 'buy', label: '買超由大到小' }, { value: 'sell', label: '賣超由大到小' }, { value: 'code', label: '股票代碼' }]}/></label>}
     <button type='button' className='institutional-reset' aria-label='重設篩選' onClick={reset}><RotateCcw size={14} aria-hidden='true'/>重設</button>
    </div>}
    {chart === 'industry' && <>
     <h2>{g.title} · 產業方向</h2><p className='md-caption'>淨股數 × {day} 收盤價估算，非實際成交淨額；缺價格不補零，可切換廣度查看買賣家數。</p>
     <div className='etf-table-scroll institutional-sector-scroll' role='region' aria-label='產業買賣超與廣度，可捲動' tabIndex={0}><table className='etf-table institutional-sectors'><caption>左為賣超、右為買超 · 依所選指標絕對值排序</caption><thead><tr><th scope='col'>產業</th><th scope='col'>{metric === 'estimate' ? '估算／億元' : '淨家數'}</th><th scope='col'>買超／賣超家數</th></tr></thead><tbody>{sectors.map((row: any) => <tr key={row.sector_code}><th scope='row'>{row.sector_name}<small>價格覆蓋 {row.priced_count ?? '未知'}／{row.stock_count ?? '未知'} 家</small></th><td className={tone(sectorValue(row))}><span aria-hidden='true' className={'institutional-bar ' + ((sectorValue(row) || 0) < 0 ? 'negative' : 'positive')} style={{ width: `${48 * Math.abs(sectorValue(row) || 0) / sectorMax}%` }}/><span className='institutional-value'>{flowNumber(sectorValue(row), metric === 'estimate' ? 1e8 : 1)}</span></td><td>{row.net_buy_count}／{row.net_sell_count}</td></tr>)}</tbody></table>{!sectors.length && <p className='md-empty'>目前條件沒有產業資料。</p>}</div>
     <h2>{market === 'TWSE' ? '上市' : '上櫃'}法人貢獻</h2><p className='md-caption'>官方市場金額／億元，涵蓋範圍與普通股產業估算不同。</p><dl className='institutional-contribution'>{totals.map((row: any) => <div key={row.institution}><dt>{institutionName(row.institution)}</dt><dd className={tone(row.net)}>{flowNumber(row.net, 1e8)} 億</dd></div>)}</dl>
    </>}
    {chart === 'stocks' && <>
     <div className='institutional-chart-heading'><h2>個股分歧</h2><p role='status'>{stockPage.count.toLocaleString('zh-TW')} 檔 · 顯示 {stockPage.start}–{stockPage.end}</p></div>
     <p className='md-caption'>{unit === 'lots' ? '單位：張。官方淨股數 ÷ 1,000；跨股張數不代表資金排名。' : '單位：億元。淨股數 × 同日收盤價估算，非實際成交淨額；缺價或日期不符保持未知。'}</p>
     <p className='md-caption institutional-matrix-guide'>紅：買超　綠：賣超　0：無淨買賣　?：未知。{market === 'TWSE' ? '上市' : '上櫃'}四帳戶共用固定色階；點選數字查看明細與來源。</p>
     <div className='md-heat-legend'><span className='md-down'>賣超 −{flowNumber(heatScale).replace('+', '')}</span><span>0</span><span className='md-up'>買超 +{flowNumber(heatScale).replace('+', '')} {unitLabel}</span></div>
     {stocks.length ? <div className='etf-table-scroll md-stock-scroll institutional-stock-scroll' tabIndex={0} role='region' aria-label='法人個股分歧矩陣，可捲動'><table className='etf-table md-heatmap institutional-stock-matrix'>
      <thead><tr><th scope='col'>個股</th>{FLOW_ACCOUNTS.map(account => <th scope='col' key={account} aria-current={account === inst ? 'true' : undefined}>{institutionName(account)}<small>{unitLabel}{account === inst ? ' · 所選法人' : ''}</small></th>)}</tr></thead>
      <tbody>{stockPage.rows.map(stock => <tr key={stock.stock_code}><th scope='row'>{stock.stock_code}<small className='md-stock-name'>{stock.stock_name}</small></th>{FLOW_ACCOUNTS.map(account => {
       const value = flowStockValue(stock, account, unit, day), label = value === null ? '?' : displayCellValue(value, unit);
       const style = value !== null && value !== 0 && heatScale > 0 ? { backgroundColor: `rgba(${value > 0 ? '213,66,60' : '42,142,92'},${.16 + Math.min(1, Math.abs(value) / heatScale) * .62})` } : undefined;
       return <td key={account}><button type='button' style={style} className={'md-heat-cell ' + tone(value)} aria-label={`${stock.stock_code} ${stock.stock_name} × ${institutionName(account)}，${value === null ? '未知' : label + unitLabel}，查看精確明細`} aria-expanded={detail?.stock.stock_code === stock.stock_code && detail?.account === account} onClick={event => openDetail(stock, account, event.currentTarget)}>{label}</button></td>;
      })}</tr>)}</tbody></table></div> : <p className='md-empty'>沒有符合的個股，請調整搜尋或重設篩選。</p>}
     <nav className='md-pager' aria-label='法人個股分頁'><span>第 {stockPage.page}／{stockPage.pageCount} 頁 · 共 {stockPage.count.toLocaleString('zh-TW')} 檔</span><button type='button' disabled={stockPage.page <= 1} onClick={() => { setPage(stockPage.page - 1); setDetail(null); }}><ChevronLeft size={15} aria-hidden='true'/>上一頁</button><button type='button' disabled={stockPage.page >= stockPage.pageCount} onClick={() => { setPage(stockPage.page + 1); setDetail(null); }}>下一頁<ChevronRight size={15} aria-hidden='true'/></button></nav>
    </>}
    {chart === 'weekly' && <>
     <h2>{g.title} · 週度趨勢</h2><p className='md-caption'>官方逐日市場金額加總／億元；四個完整週與本週截至研究日分列。週趨勢不套用個股搜尋或產業篩選。</p>
     <div className='etf-table-scroll' role='region' aria-label='法人週度趨勢表' tabIndex={0}><table className='etf-table'><thead><tr><th scope='col'>期間</th><th scope='col'>交易日</th><th scope='col'>官方市場金額／億元</th></tr></thead><tbody>{weekly.map((row: any) => <tr key={row.week_start}><th scope='row'>{row.week_label}{row.period_status === 'target_week_to_date' ? '（本週截至日）' : ''}</th><td>{row.observed_dates.length}日</td><td className={tone(row.net)}>{flowNumber(row.net, 1e8)}</td></tr>)}</tbody></table>{!weekly.length && <p className='md-empty'>尚無可用的週度市場金額。</p>}</div>
    </>}
    <button type='button' className='md-chart-reference-link' onClick={sourceJump}>查看這張圖的參考來源</button>
   </div>
   <aside className='md-key-metrics institutional-key-metrics' aria-label='關鍵數據'><h2>關鍵數據</h2>
    <div className='md-key-metric'><p>官方市場買賣超</p><h3>{g.title}</h3><p className={'institutional-key-value ' + tone(g.official_market_net_twd)}><strong>{flowNumber(g.official_market_net_twd, 1e8)}</strong><span> 億元</span></p><p className='md-caption'>全市場官方口徑，未套用個股或產業篩選。</p></div>
    <div className='md-key-metric'><p>{activeSector ? '所選產業收盤價估算' : '主要產業收盤價估算'}</p><h3>{metricSector?.sector_name || (sectors[0]?.sector_name ?? '尚無可用估算')}</h3><p className={'institutional-key-value ' + tone(metricSector?.estimate_twd)}><strong>{flowNumber(metricSector?.estimate_twd, 1e8)}</strong>{metricSector && <span> 億元</span>}</p><p className='md-caption'>{activeSector ? '所選產業' : '依完整估算絕對值選取，不表示淨買超最多'}；個股搜尋不改此產業摘要。</p></div>
    <div className='md-key-metric'><p>{activeSector ? '所選產業觀測廣度' : '同市場普通股觀測廣度'}</p><h3>買超 {buyCount} 家 · 賣超 {sellCount} 家</h3><p className='md-caption'>觀測 {scopeStocks.length} 檔；無觀測不當零。產業及個股估算非實際交易金額，與官方市場總額分開。</p></div>
    <p className='md-caption'>{day} · {market === 'TWSE' ? '上市' : '上櫃'}<br/>外資不含外資自營商；自營自行與避險分列。</p>
   </aside>
  </div>
  {detail && <section className='institutional-detail md-evidence' aria-label='個股精確明細' onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeDetail(); } }}>
   <div className='md-evidence-heading'><h2 ref={detailHeading} tabIndex={-1}>{detail.stock.stock_name} {detail.stock.stock_code} × {institutionName(detail.account)}</h2><button type='button' className='institutional-close-detail' aria-label='關閉個股明細' onClick={closeDetail}><X size={16} aria-hidden='true'/>關閉明細</button></div>
   <p className='md-caption'>{detail.stock.sector_name} · 交易日 {detail.stock.trade_date} · 收盤 {detail.stock.close ?? '未知'} 元 · 價格日 {detail.stock.price_date ?? '未知'}</p>
   <p className={'institutional-selected-value ' + tone(flowStockValue(detail.stock, detail.account, detail.unit, day))}>所選儲存格：{displayCellValue(flowStockValue(detail.stock, detail.account, detail.unit, day), detail.unit)} {detail.unit === 'lots' ? '張' : '億元（收盤價估算）'}</p>
   <p className='md-caption'>官方淨股數 {flowNumber(detail.stock.accounts[detail.account]?.net)} 股；收盤價估算＝淨股數 × 同日收盤價，非實際成交淨額。</p>
   <dl>{FLOW_ACCOUNTS.map(account => <div key={account}><dt>{institutionName(account)}{account === detail.account ? '（所選）' : ''}</dt><dd className={tone(detail.stock.accounts[account]?.net)}>{flowNumber(detail.stock.accounts[account]?.net, 1000)} 張</dd></div>)}</dl>
   <div className='institutional-detail-sources'>{(detail.stock.source_ids || []).map(id => report.shared.source_registry?.[id]).filter(Boolean).map((source: any) => <a key={source.id || source.url} href={source.url} target='_blank' rel='noopener noreferrer'>{source.title || source.url}<span className='sr-only'>（開啟新分頁）</span></a>)}</div>
  </section>}
 </EtfTabPanel>
 <EtfTabPanel idPrefix='institutional-reader' id='sources' active={tab === 'sources'}><div className='institutional-sources md-references'><h3>方法與資料缺口</h3><p>{d.metadata.observed_scope}</p><ul>{d.metadata.methods.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul><details><summary>涵蓋範圍與已知缺口</summary><ul>{(d.data.gaps || []).map((g:any,i:number)=><li key={i}>{g.detail || g.reason || g.type}</li>)}</ul></details><details><summary>來源採用與候選查核</summary>{d.data.source_audit.map((s: any, i: number) => <p key={i}>{s.name || s.title || s.url} · {s.status} · {s.reason}</p>)}</details><h2 ref={sourceHeading} tabIndex={-1}>文章與圖表來源（{sourceIds.length} 筆）</h2><ReferenceCitations report={report} /></div></EtfTabPanel></article>;
}
