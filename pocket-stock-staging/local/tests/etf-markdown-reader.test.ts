import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarkdownReport, MarkdownRecord } from '../../shared/etf-markdown';

// Load the reader helpers and safe prose renderer without the parent application's API client.
const output = await mkdtemp(join(tmpdir(), 'pocketstocks-markdown-reader-'));
const entry = join(output, 'reader.mjs');
await build({ entryPoints: [resolve('src/etf-markdown-reader.tsx')], outfile: entry, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', loader: { '.css': 'empty' },
  plugins: [{ name: 'parent-tabs', setup(builder) {
    builder.onResolve({ filter: /^\.\/active-etf$/ }, () => ({ path: 'tabs', namespace: 'test-parent' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-parent' }, () => ({ contents: 'export const EtfTabs = () => null; export const EtfTabPanel = ({children,active}) => active ? children : null;', loader: 'js' }));
  } }] });
// Resolve external packages from this app rather than the operating system temp directory.
const { symlink } = await import('node:fs/promises');
await symlink(resolve('node_modules'), join(output, 'node_modules'));
const reader = await import(pathToFileURL(entry).href);
test.after(async () => { await rm(output, { recursive: true, force: true }); });

const industry = (etf: string, sector: string, value: number | null): MarkdownRecord => ({ etf_code: etf, industry_code: sector, net_value_estimate_twd: value, increase_value_estimate_twd: value === null ? null : Math.max(value, 0), decrease_value_estimate_twd: value === null ? null : Math.min(value, 0), data_status: value === null ? 'unavailable' : 'complete', source_ids: [] });
function fixture(): MarkdownReport {
  const rows = [industry('A', 'X', 3e8), industry('B', 'X', 2e8), industry('A', 'Y', -1e8), industry('B', 'Y', 0)];
  return { format: 'etf-markdown', storageSchemaVersion: 3, parserVersion: '1', sourceHash: 'hash', sourceBytes: 0, expandedBytes: 0, rawMarkdown: '', id: 'synthetic-reader-check', title: '合成測試', excerpt: '', period: { start: '2026-10-14', end: '2026-10-15' }, evidenceDate: '2026-10-16', articleMarkdown: '完整文章。', warnings: [], frontmatter: { etf_codes: ['A', 'B'] }, shared: { metadata: { data_status: 'partial' }, dictionaries: { etfs: { A: '甲基金', B: '乙基金' }, industries: { X: '甲產業', Y: '乙產業' }, stocks: {} }, source_registry: {}, fund_context: [{ etf_code: 'A', research_date: '2026-10-15', baseline_date: '2026-10-14', units_change_pct: 4.5 }] }, visualizations: [{ id: 'industry_allocation_changes', title: '', purpose: '', suggestedChart: '', metadata: {}, shape: {}, rows: [], sourceIds: [], records: rows }] };
}
test('unknown contributions remain unknown and missing contributors are detected', () => {
  assert.deepEqual(reader.markdownSum([{ value: 2 }, { value: null }], 'value'), { value: null, subtotal: 2, complete: false, missing: 1 });
  assert.equal(reader.markdownSum([{ value: 2 }], 'value', 2).value, null);
  assert.equal(reader.markdownSum([{ value: 0 }], 'value').value, 0);
  assert.equal(reader.markdownSum([], 'value').value, null);
  assert.equal(reader.markdownSum([{ value: 2, data_status: 'unavailable' }], 'value').value, null);
});
test('key metrics require complete fund coverage and preserve estimate units', () => {
  const report = fixture(), metrics = reader.markdownKeyMetrics(report);
  assert.equal(metrics.length, 3);
  assert.equal(metrics[0].value, 5);
  assert.equal(metrics[1].value, -1);
  assert.equal(metrics[2].name, 'A 甲基金');
  assert.match(metrics[2].note, /\+4.5%/);
  report.visualizations[0].records[1].net_value_estimate_twd = null;
  assert.ok(!reader.markdownKeyMetrics(report).some((m: { label: string }) => m.label === '主要增配估值'));
});
test('stock display uses exact share conversion and whole-report per-unit scale', () => {
  const rows = [{ delta_shares: -1149020, delta_value_estimate_twd: -2188883100, holding_state: 'held' }, { delta_shares: 160000, delta_value_estimate_twd: 3e8, holding_state: 'entered' }, { delta_shares: null, delta_value_estimate_twd: null, holding_state: 'unknown' }];
  assert.equal(reader.markdownHeatValue(rows[0], 'lots'), -1149.02);
  assert.equal(reader.markdownHeatScale(rows, 'lots'), 1149.02);
  assert.equal(reader.markdownHeatScale(rows, 'value'), 21.888831);
  assert.equal(reader.markdownHeatValue({ delta_shares: 0, holding_state: 'not_held' }, 'lots'), 0);
  assert.equal(reader.markdownHeatValue(rows[2], 'lots'), null);
});
test('valid industry choices derive from current fund nonzero stock or weekly evidence', () => {
  const rows = [{ etf_code: 'A', industry_code: 'X', delta_shares: 1000 }, { etf_code: 'B', industry_code: 'Y', delta_shares: 5000 }, { etf_code: 'A', industry_code: 'Y', delta_shares: 0 }, { etf_code: 'A', industry_code: 'Z', delta_shares: null }];
  assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'A'), ['X']);
  assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'B'), ['Y']);
});
test('industry and weekly options exclude zero and unknown values but retain nonzero contributors that cancel', () => {
  const rows = [industry('A', 'zero', 0), industry('B', 'zero', -0), industry('A', 'unknown', null),
    industry('A', 'positive', 10), industry('A', 'negative', -10), industry('A', 'tiny', 1e-9),
    industry('A', 'cancel', 10), industry('B', 'cancel', -10),
    { ...industry('A', 'unavailable', 100), data_status: 'unavailable' },
    { ...industry('A', 'nan', 0), net_value_estimate_twd: NaN },
    { ...industry('A', 'infinite', 0), net_value_estimate_twd: Infinity }];
  const before = structuredClone(rows);
  for (const chart of ['industry_allocation_changes', 'weekly_industry_allocation_trend']) {
    assert.deepEqual(reader.markdownValidSectors(rows, chart, ''), ['positive', 'negative', 'tiny', 'cancel']);
    assert.deepEqual(reader.markdownValidSectors(rows, chart, 'B'), ['cancel']);
    assert.deepEqual(reader.markdownValidSectors(rows, chart, 'missing'), []);
    assert.deepEqual(reader.markdownValidSectors(rows.slice(0, 3), chart, ''), []);
  }
  assert.deepEqual(rows, before, 'Filtering options must retain all original evidence records');
});
test('stock options follow the selected unit and fund using the same known-value semantics as the heatmap', () => {
  const stock = (fund: string, sector: string, shares: number | null, amount: number | null) =>
    ({ etf_code: fund, industry_code: sector, delta_shares: shares, delta_value_estimate_twd: amount, holding_state: 'held' });
  const rows = [stock('A', 'shares-only', 1000, 0), stock('A', 'value-only', 0, -100),
    stock('A', 'value-null', -1000, null), stock('A', 'shares-null', null, 100),
    stock('A', 'tiny', 1e-9, 1e-9), stock('A', 'cancel', 1000, 100), stock('B', 'cancel', -1000, -100),
    stock('A', 'zero', 0, -0), stock('A', 'null', null, null),
    { ...stock('A', 'unknown', 1000, 100), holding_state: 'unknown' },
    { ...stock('A', 'unavailable', 1000, 100), data_status: 'unavailable' },
    stock('A', 'nonfinite', Infinity, NaN)];
  const before = structuredClone(rows);
  assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'A', 'lots'), ['shares-only', 'value-null', 'tiny', 'cancel']);
  assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'A', 'value'), ['value-only', 'shares-null', 'tiny', 'cancel']);
  for (const unit of ['lots', 'value']) {
    assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'B', unit), ['cancel']);
    assert.deepEqual(reader.markdownValidSectors(rows.slice(7), 'stock_holding_changes', '', unit), []);
    assert.ok(reader.markdownValidSectors(rows, 'stock_holding_changes', '', unit).includes('cancel'));
  }
  assert.deepEqual(rows, before);
});
test('opposite stock changes in one fund preserve their industry even when its total is zero', () => {
  const rows = [{ etf_code: 'A', stock_code: '1111', industry_code: 'cancel', delta_shares: 10, delta_value_estimate_twd: 100 },
    { etf_code: 'A', stock_code: '2222', industry_code: 'cancel', delta_shares: -10, delta_value_estimate_twd: -100 }];
  for (const unit of ['lots', 'value']) assert.deepEqual(reader.markdownValidSectors(rows, 'stock_holding_changes', 'A', unit), ['cancel']);
});
test('weekly unknown endpoints and WTD cannot qualify as complete comparable weeks', () => {
  const report = fixture();
  report.shared.weekly_periods = [{ period_id: 'W1', complete: true, expected_trading_dates: ['2026-09-18'], observed_trading_dates: ['2026-09-18'] }, { period_id: 'W2', complete: true, expected_trading_dates: ['2026-09-25'], observed_trading_dates: [] }, { period_id: 'W3', complete: false, expected_trading_dates: ['2026-10-15'], observed_trading_dates: ['2026-10-15'] }];
  report.visualizations.push({ id: 'weekly_industry_allocation_trend', title: '', purpose: '', suggestedChart: '', metadata: {}, shape: {}, rows: [], sourceIds: [], records: ['W1', 'W2', 'W3'].flatMap(period_id => [ { ...industry('A', 'X', 1e8), period_id }, { ...industry('B', 'X', period_id === 'W2' ? null : 0), period_id } ]) });
  const points = reader.markdownWeeklyPoints(report, '', 'X');
  assert.deepEqual(points.map((p: { comparable: boolean }) => p.comparable), [true, false, false]);
  assert.equal(points[1].value, null);
  assert.equal(points[2].value, 1e8);
});
test('article text is preserved while raw HTML, unsafe links and remote images cannot execute', () => {
  const report = fixture();
  report.articleMarkdown = '保留完整研究。\n\n<script>window.pwned=true</script>\n\n[不安全](javascript:alert%281%29)\n\n[資料](https://example.com/research)\n\n![說明](https://example.com/track.png)';
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview: true }));
  assert.match(html, /保留完整研究/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /href="https:\/\/example.com\/research"/);
  assert.match(html, /私有預覽/);
});
test('internal report citations are source actions with no hash navigation in public or private preview', () => {
  const report = fixture();
  report.articleMarkdown = '完整週資料見[週端點來源](#weekly-trend-sources)。';
  const original = report.articleMarkdown;
  for (const preview of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview, version: 1 }));
    assert.match(html, /<button type="button" class="md-source-jump">週端點來源<\/button>/);
    assert.ok(!html.includes('href="#weekly-trend-sources"'));
  }
  assert.equal(report.articleMarkdown, original);
});
test('small nonzero amounts retain a signed precision threshold instead of displaying confirmed zero', () => {
  const report = fixture();
  report.visualizations[0].records = [industry('A', 'X', 100), industry('B', 'X', 0)];
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview: true }));
  assert.match(html, /\+&lt;0\.01/);
  assert.ok(!html.includes('<strong>+0</strong>'));
  report.visualizations[0].records = [industry('A', 'X', -100), industry('B', 'X', 0)];
  const negative = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview: true }));
  assert.match(negative, /−&lt;0\.01/);
  assert.ok(!negative.includes('<strong>−0</strong>'));
});
test('provider estimates are labeled without inventing a share-difference research formula', () => {
  const report = fixture();
  report.shared.metadata.amount_basis = 'provider_estimate';
  report.visualizations[0].metadata.amount_basis = 'provider_estimate';
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview: true }));
  assert.match(html, /來源提供估值，方法依來源，非實際交易/);
  assert.ok(!html.includes('股數差按期末'));
  assert.ok(!html.includes('(Q1−Q0)'));
  assert.equal(reader.markdownEstimateInfo(report, 'industry_allocation_changes').formula, '');
});
test('a visual basis override never borrows the shared basis formula', () => {
  const report = fixture();
  report.shared.metadata = { amount_basis: 'research_estimate', amount_formula: '(Q1-Q0)*P1' };
  report.visualizations[0].metadata = { amount_basis: 'provider_estimate', amount_formula: '(Q1-Q0)*P1' };
  report.visualizations[0].shape.metadata = { amount_basis: 'provider_estimate', amount_formula: null };
  assert.equal(reader.markdownEstimateInfo(report, 'industry_allocation_changes').formula, '');
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview: true }));
  assert.ok(!html.includes('(Q1-Q0)*P1'));
  report.visualizations[0].shape.metadata.amount_formula = 'provider_published_estimate';
  assert.equal(reader.markdownEstimateInfo(report, 'industry_allocation_changes').formula, 'provider_published_estimate');
});

// Render only the selected panel using a public route, without a browser, network, or application database.
function renderRoute(report: MarkdownReport, tab: 'analysis' | 'allocation' | 'references', preview = false, chart = 'industry_allocation_changes', selection: { fund?: string; unit?: string } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { hash: '#/active-etf/' + report.id + '?v=1&mdTab=' + tab + '&mdChart=' + chart + '&mdFund=' + encodeURIComponent(selection.fund || '') + '&mdUnit=' + (selection.unit || 'lots') },
    sessionStorage: { getItem: () => null, setItem: () => writes.push('session') },
    history: { pushState: () => writes.push('history'), replaceState: () => writes.push('history') },
  } });
  try {
    const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report, preview, version: 1 }));
    return { html, writes };
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}
test('rendered sector choices honor current stock units while zero evidence remains readable in all industries', () => {
  const report = fixture();
  report.visualizations.push({ id: 'stock_holding_changes', title: '', purpose: '', suggestedChart: '', metadata: {}, shape: {}, rows: [], sourceIds: [], records: [
    { etf_code: 'A', stock_code: '1111', industry_code: 'shares-only', delta_shares: 1000, delta_value_estimate_twd: 0 },
    { etf_code: 'A', stock_code: '2222', industry_code: 'value-only', delta_shares: 0, delta_value_estimate_twd: -100 },
    { etf_code: 'A', stock_code: '3333', industry_code: 'zero', delta_shares: 0, delta_value_estimate_twd: 0 },
  ] });
  const before = structuredClone(report);
  for (const [unit, included, excluded] of [['lots', 'shares-only', 'value-only'], ['value', 'value-only', 'shares-only']]) {
    const { html, writes } = renderRoute(report, 'allocation', false, 'stock_holding_changes', { fund: 'A', unit });
    const options = html.match(/role="listbox" aria-label="產業篩選"[^>]*>([\s\S]*?)<\/div><\/label>/)?.[1] || '';
    assert.match(options, new RegExp('value="' + included + '"'));
    assert.ok(!options.includes('value="' + excluded + '"'));
    assert.ok(!options.includes('value="zero"'));
    assert.match(html, /3333/, 'All-industries chart retains the original confirmed-zero stock');
    assert.deepEqual(writes, []);
  }
  assert.deepEqual(report, before);
});
function referenceFixture(): MarkdownReport {
  const report = fixture();
  report.articleMarkdown = '完整文章。\n\n週資料見[週端點來源](#weekly-trend-sources)。';
  report.shared.metadata = { ...report.shared.metadata, amount_basis: 'research_estimate', amount_formula: '(Q1-Q0)*P1', limitations: ['合成限制須完整保留，不得補零。'] };
  report.shared.source_registry = { QA1: { source_id: 'QA1', title: '合成官方端點來源', url: 'https://example.invalid/retained-evidence', source_type: 'official-issuer', data_period: '2026-10-02/2026-10-15', published_date: '2026-10-15', checked_date: '2026-10-16', checked_at: '2026-10-16T06:30:00+08:00' } };
  report.shared.weekly_periods = [
    { period_id: '2026-W41', week_start: '2026-10-05', week_end: '2026-10-11', baseline_date: '2026-10-02', observation_end: '2026-10-09', complete: true, expected_trading_dates: ['2026-10-09'], observed_trading_dates: ['2026-10-09'], source_ids: ['QA1'] },
    { period_id: '2026-W42-WTD', week_start: '2026-10-12', week_end: '2026-10-18', baseline_date: '2026-10-09', observation_end: '2026-10-15', complete: false, expected_trading_dates: ['2026-10-15'], observed_trading_dates: ['2026-10-15'], source_ids: ['QA1'] },
  ];
  report.shared.weekly_fund_context = report.shared.weekly_periods.flatMap((period: MarkdownRecord) => [{ period_id: period.period_id, etf_code: 'A', baseline_units: 123456, current_units: 125678, units_change_pct: 1.8, source_ids: ['QA1'] }, { period_id: period.period_id, etf_code: 'B', baseline_units: null, current_units: null, units_change_pct: null, source_ids: ['QA1'] }]);
  report.visualizations[0].sourceIds = ['QA1'];
  report.visualizations.push({ id: 'weekly_industry_allocation_trend', title: '', purpose: '', suggestedChart: '', metadata: { amount_basis: 'provider_estimate' }, shape: { metadata: { amount_basis: 'provider_estimate', amount_formula: 'provider_published_estimate' } }, rows: [], sourceIds: ['QA1'], records: report.shared.weekly_periods.flatMap((period: MarkdownRecord) => [{ ...industry('A', 'X', 1e8), period_id: period.period_id }, { ...industry('B', 'X', 0), period_id: period.period_id }]) });
  return report;
}
test('references show citations only while all source, method and weekly metadata remain unchanged in the report', () => {
  const report = referenceFixture(), before = JSON.stringify(report);
  const { html, writes } = renderRoute(report, 'references');
  assert.match(html, /文章與圖表來源（1 筆）/);
  assert.match(html, /合成官方端點來源/);
  assert.match(html, /https:\/\/example\.invalid\/retained-evidence/);
  assert.match(html, /2026-10-02\/2026-10-15/);
  assert.doesNotMatch(html, /完整查證紀錄|估值方法、資料覆蓋與限制|各基金每週份額與涵蓋日期/);
  assert.doesNotMatch(html, /official-issuer|provider_published_estimate|合成限制須完整保留|2026-W41|2026-W42-WTD/);
  assert.doesNotMatch(html, /<details|<dl|class="md-week-plot"|data-md-reference-section="(?:methods|weekly)"/);
  assert.equal(JSON.stringify(report), before, 'Removing auxiliary UI never deletes published evidence');
  assert.deepEqual(writes, []);
});
test('reference citations keep registry order and concise known dates without auxiliary metadata UI', () => {
  const report = referenceFixture();
  report.shared.source_registry = {
    Z99: { title: '第一份資料', url: 'https://example.invalid/first', data_period: '2026-10-14/2026-10-15', published_date: '2026-10-16', checked_at: '2026-10-17T06:00:00+08:00', request_method: 'POST', request_params: { secretless_field: '完整保存' } },
    A01: { title: '第二份資料', url: 'javascript:alert(1)', published_date: '2026-10-13' },
    Q55: { url: 'https://example.invalid/no-date' },
    Missing: null,
  };
  const original = structuredClone(report);
  const { html } = renderRoute(report, 'references');
  const citations = html.match(/<ol class="md-citation-list"[^>]*>([\s\S]*?)<\/ol>/)?.[1] || '';
  assert.deepEqual([...citations.matchAll(/class="md-citation-number">(\[\d+\])/g)].map(match => match[1]), ['[1]', '[2]', '[3]', '[4]']);
  assert.ok(citations.indexOf('第一份資料') < citations.indexOf('第二份資料'));
  assert.match(citations, /資料期間：2026-10-14\/2026-10-15/);
  assert.match(citations, /發布：2026\/10\/13/);
  assert.match(citations, /來源未提供標題/);
  assert.doesNotMatch(citations, /Z99|A01|Q55|POST|secretless_field|checked_at|<details|javascript:/);
  assert.match(citations, /href="https:\/\/example.invalid\/first" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<details|<dl|secretless_field|完整保存|完整查證紀錄/);
  assert.deepEqual(report, original);
});
test('citation dates are omitted only when the unchanged title literally contains the full data period', () => {
  const report = referenceFixture();
  report.shared.source_registry = {
    Same: { title: '官方持股 2026-10-14', data_period: '2026-10-14', published_date: '2026-10-15' },
    Different: { title: '官方持股 2026-10-13', data_period: '2026-10-14' },
  };
  const { html } = renderRoute(report, 'references');
  const citations = html.match(/<ol class="md-citation-list"[^>]*>([\s\S]*?)<\/ol>/)?.[1] || '';
  const entries = [...citations.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1]);
  assert.equal(entries.length, 2);
  assert.match(entries[0], /官方持股 2026-10-14/);
  assert.equal((entries[0].match(/2026-10-14/g) || []).length, 1);
  assert.doesNotMatch(entries[0], /資料期間|發布/);
  assert.match(entries[1], /官方持股 2026-10-13/);
  assert.match(entries[1], /資料期間：2026-10-14/);
});
test('an empty reference registry stays readable without inventing publication details', () => {
  const report = referenceFixture();
  report.shared.source_registry = {};
  const { html } = renderRoute(report, 'references');
  assert.match(html, /文章與圖表來源（0 筆）/);
  assert.match(html, /尚無可列出的參考來源。/);
  assert.doesNotMatch(html, /md-citation-number|<summary>完整來源紀錄/);
});
test('analysis retains prose and safe source actions while registry and long methodology live in references', () => {
  const report = referenceFixture();
  const { html } = renderRoute(report, 'analysis');
  assert.match(html, /完整文章/);
  assert.match(html, /class="md-source-jump">週端點來源/);
  assert.ok(!html.includes('href="#weekly-trend-sources"'));
  assert.ok(!html.includes('合成官方端點來源'));
  assert.ok(!html.includes('合成限制須完整保留'));
  assert.ok(!html.includes('各基金每週份額與涵蓋日期'));
});
test('allocation retains weekly and WTD plots while full provenance is in the references panel', () => {
  const report = referenceFixture();
  const { html } = renderRoute(report, 'allocation', false, 'weekly_industry_allocation_trend');
  assert.match(html, /週度淨變動估值（億元）/);
  assert.match(html, /class="md-week-plot"/);
  assert.match(html, /本週截至目前|WTD/);
  assert.match(html, /查看這張圖的參考來源/);
  assert.ok(!html.includes('合成官方端點來源'));
  assert.ok(!html.includes('123,456'));
});
test('private preview ignores public references URL and preserves complete article without history or storage writes', () => {
  const report = referenceFixture();
  const { html, writes } = renderRoute(report, 'references', true);
  assert.match(html, /私有預覽/);
  assert.match(html, /完整文章/);
  assert.ok(!html.includes('合成官方端點來源'), 'A public URL must not select a private preview panel');
  assert.deepEqual(writes, []);
});

test('editorial analysis creates readable sections and financial highlights without rewriting source or link targets', () => {
  const report = fixture();
  report.articleMarkdown = '**配置方向。** 00981A於10/15增持1,149.02張、估值54.80億元。交易金額未知。[官方持股](https://example.invalid/54.80?date=2026-10-15)\n\n**跟進條件。** 30倍門檻為1,093.20元，須核對18.63%份額變化。';
  const before = JSON.stringify(report);
  const { html } = renderRoute(report, 'analysis');
  assert.match(html, /<h3>配置方向<\/h3>/);
  assert.match(html, /<h3>跟進條件<\/h3>/);
  assert.match(html, /data-analysis-kind="follow-up"/);
  for (const value of ['1,149.02張', '54.80億元', '30倍', '1,093.20元', '18.63%']) assert.ok(html.includes('class="md-data-highlight">' + value + '</mark>'));
  assert.ok(!html.includes('class="md-data-highlight">00981A'));
  assert.ok(!html.includes('class="md-data-highlight">10/15'));
  assert.match(html, /<p class="md-prose-sources">來源：<a href="https:\/\/example.invalid\/54.80\?date=2026-10-15"/);
  assert.match(html, /交易金額未知/);
  assert.equal(JSON.stringify(report), before);
});
test('modern headings, inline citations, authored emphasis and repeated follow-up themes stay readable', () => {
  const report = fixture();
  report.articleMarkdown = '### 操作方向\n\n請見[週端點來源](#weekly-trend-sources)再核對。**不能把缺值當成零。**\n\n### 跟進條件\n\n每單位增加3.74%。\n\n### 反證\n\n盈利仍未知。';
  const { html } = renderRoute(report, 'analysis');
  assert.match(html, /請見<button type="button" class="md-source-jump">週端點來源<\/button>再核對。/);
  assert.match(html, /<strong>不能把缺值當成零。<\/strong>/);
  assert.equal((html.match(/data-analysis-kind="follow-up"/g) || []).length, 1, 'Only one section occupies the follow-up column');
  assert.match(html, /<h3>反證<\/h3>/);
  assert.match(html, /盈利仍未知/);
  assert.ok(!html.includes('<p>。</p>'));
});

test('JSON analysis renders explicit semantic highlights only and preserves authored paragraph tokens', async () => {
  const { jsonFixtureParts } = await import('../../tests/fixtures/etf-json-fixture.ts');
  const { parseEtfJson } = await import('../../shared/etf-research.ts');
  const result = await parseEtfJson(JSON.stringify(jsonFixtureParts()));
  assert.deepEqual(result.errors, []);
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report: result.report, preview: true }));
  assert.match(html, /md-json-analysis/);
  assert.equal((html.match(/<mark/g) || []).length, 4);
  assert.match(html, /合成資料 999；明確重點/);
  assert.doesNotMatch(html, /<mark[^>]*>999/);
  assert.doesNotMatch(html, /<script/);
});

test('JSON metric cards follow explicit label/value tokens and retain context, links and all siblings', async () => {
  const { jsonFixtureParts } = await import('../../tests/fixtures/etf-json-fixture.ts');
  const { parseEtfJson } = await import('../../shared/etf-research.ts');
  const value = jsonFixtureParts();
  const pair = (type: string, semantic?: string) => ({ type: type + '_open', tag: type === 'paragraph' ? 'p' : type === 'bullet_list' ? 'ul' : type === 'list_item' ? 'li' : 'strong', nesting: 1, ...(semantic ? { semantic } : {}) });
  const close = (v: any) => ({ ...v, type: v.type.replace('_open', '_close'), nesting: -1 });
  const text = (content: string) => ({ type: 'text', tag: '', nesting: 0, content });
  const list = pair('bullet_list'), item = pair('list_item'), p = pair('paragraph'), label = pair('strong'), amount = pair('strong', 'data_highlight');
  const tokens: any[] = [list];
  for (const [name, number] of [['主要增配（估值）', '+100元'], ['主要減配（估值）', '−20元'], ['份額變化', '+3%']]) tokens.push(item, p, { type: 'inline', tag: '', nesting: 0, children: [label, text(name), close(label), text('：測試產業 '), amount, text(number), close(amount), text('。')] }, close(p), close(item));
  tokens.push(close(list), p, { type: 'inline', tag: '', nesting: 0, children: [text('估值說明 999，不自動加重點。')] }, close(p));
  value.analysis.sections[0].tokens = tokens;
  const parsed = await parseEtfJson(JSON.stringify(value)); assert.deepEqual(parsed.errors, []);
  const html = renderToStaticMarkup(React.createElement(reader.MarkdownEtfReader, { report: parsed.report, preview: true }));
  assert.equal((html.match(/md-json-figure-value/g) || []).length, 3);
  assert.match(html, /<dt>主要增配（估值）<\/dt>/);
  assert.match(html, /<dt>主要減配（估值）<\/dt>/);
  assert.match(html, /<dt>份額變化<\/dt>/);
  assert.equal((html.match(/md-json-figure-context">測試產業/g) || []).length, 3);
  assert.match(html, /估值說明 999，不自動加重點。/);
  assert.doesNotMatch(html, /<mark[^>]*>999/);
});
