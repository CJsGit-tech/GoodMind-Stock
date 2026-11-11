import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReportItem } from '../../src/active-etf';
import type { CatalogQuery } from '../../src/etf-report-catalog';

// Render the actual catalog independently of the application's API and local database.
const output = await mkdtemp(join(tmpdir(), 'pocketstocks-etf-catalog-'));
const entry = join(output, 'catalog.mjs');
await build({ entryPoints: [resolve('src/etf-report-catalog.tsx')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', loader: { '.css': 'empty' } });
await symlink(resolve('node_modules'), join(output, 'node_modules'));
const catalog = await import(pathToFileURL(entry).href);
test.after(async () => { await rm(output, { recursive: true, force: true }); });

function item(id: string, researchDate: string, publishedAt: string, title = id): ReportItem {
  return { id, title, excerpt: 'ETF 研究測試資料', period: { start: researchDate, end: researchDate },
    evidenceDate: researchDate, publishedAt, version: 2 };
}
const fourDays = [
  item('day12', '2026-10-12', '2026-10-17T12:00:00Z'),
  item('day14', '2026-10-14', '2026-10-17T10:00:00Z'),
  item('day15', '2026-10-15', '2026-10-16T10:00:00Z'),
  item('day13', '2026-10-13', '2026-10-17T11:00:00Z'),
];
function markup(items: ReportItem[], hash = '#/active-etf', domain: 'etf' | 'institutional' = 'etf') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hash } } });
  try {
    return renderToStaticMarkup(React.createElement(catalog.EtfReportCatalog,
      { items, domain, ready: true, loading: false, fallback: null, onOpen: () => {} }));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
function cardIds(html: string) {
  return [...html.matchAll(/class="article-card[^"\n]*" href="#\/active-etf\/([^?]+)\?/g)]
    .map(match => decodeURIComponent(match[1]));
}

test('missing and unsupported sort values use research date while legacy URL values remain valid', () => {
  for (const hash of ['#/active-etf', '#/active-etf?sort=', '#/active-etf?sort=unknown']) {
    assert.equal(catalog.readEtfCatalogQuery(hash).sort, 'research-newest');
    assert.deepEqual(cardIds(markup(fourDays, hash)), ['day15', 'day14', 'day13', 'day12']);
  }
  for (const sort of ['newest', 'oldest']) {
    assert.equal(catalog.readEtfCatalogQuery(`#/active-etf?sort=${sort}`).sort, sort);
  }
});

test('late backfill cannot move an older research day ahead of a newer research day', () => {
  const html = markup(fourDays);
  assert.deepEqual(cardIds(html), ['day15', 'day14', 'day13', 'day12']);
  assert.match(html, /role="option"[^>]* aria-selected="true"[^>]*><span>研究日<\/span>/);
  assert.match(html, /共 4 篇/);
  assert.deepEqual(fourDays.map(row => row.id), ['day12', 'day14', 'day15', 'day13']);
});

test('research-date ties resolve by publication descending and then ID ascending', () => {
  const rows = [
    item('z', '2026-10-15', '2026-10-17T12:00:00Z'),
    item('a', '2026-10-15', '2026-10-17T12:00:00Z'),
    item('old-publication', '2026-10-15', '2026-10-16T12:00:00Z'),
    item('older-research', '2026-10-14', '2026-10-18T12:00:00Z'),
  ];
  for (const input of [rows, [...rows].reverse()]) {
    assert.deepEqual(cardIds(markup(input)), ['a', 'z', 'old-publication', 'older-research']);
  }
});

test('explicit newest and oldest URLs continue ordering by publication date', () => {
  assert.deepEqual(cardIds(markup(fourDays, '#/active-etf?sort=newest')), ['day12', 'day13', 'day14', 'day15']);
  assert.deepEqual(cardIds(markup(fourDays, '#/active-etf?sort=oldest')), ['day15', 'day14', 'day13', 'day12']);
  assert.match(markup(fourDays, '#/active-etf?sort=newest'), /role="option"[^>]* aria-selected="true"[^>]*><span>最新發布<\/span>/);
  assert.match(markup(fourDays, '#/active-etf?sort=oldest'), /role="option"[^>]* aria-selected="true"[^>]*><span>最早發布<\/span>/);
});

test('return URL round trips search, month, page and all sorting modes', () => {
  for (const sort of ['research-newest', 'newest', 'oldest'] as const) {
    const query: CatalogQuery = { q: '半導體 & ETF', month: '2026-10', sort, page: 2 };
    const hash = catalog.etfCatalogHash(query);
    assert.deepEqual(catalog.readEtfCatalogQuery(hash), query);
    assert.equal(hash.includes('sort='), sort !== 'research-newest');
  }
  assert.equal(catalog.etfCatalogHash({ q: '', month: '', sort: 'research-newest', page: 0 }), '#/active-etf');
});

test('restored search, research month and second page retain four cards per page', () => {
  const rows = Array.from({ length: 9 }, (_, index) => item(`match-${index + 1}`,
    `2026-10-${String(index + 1).padStart(2, '0')}`, '2026-10-17T12:00:00Z', `半導體 ${index + 1}`));
  rows.push(item('other-month', '2026-09-30', '2026-10-18T00:00:00Z', '半導體 九月'));
  rows.push(item('other-title', '2026-10-15', '2026-10-18T00:00:00Z', '金融'));
  const query: CatalogQuery = { q: '半導體', month: '2026-10', sort: 'research-newest', page: 1 };
  const html = markup(rows, catalog.etfCatalogHash(query));
  assert.deepEqual(cardIds(html), ['match-5', 'match-4', 'match-3', 'match-2']);
  assert.match(html, /第 5–8 篇，共 9 篇/);
  assert.match(html, /找到 9 篇分析/);
  assert.match(html, /role="option"[^>]* aria-selected="true"[^>]*><span>2026 \/ 10<\/span>/);
  assert.match(html, /value="半導體"/);
  assert.match(html, /aria-label="第 2 頁分析" aria-current="page"/);
});

test('restored out-of-range page renders the final available page and report version links stay intact', () => {
  const rows = [...fourDays, item('old', '2026-10-11', '2026-10-18T00:00:00Z')];
  const html = markup(rows, '#/active-etf?page=99');
  assert.deepEqual(cardIds(html), ['old']);
  assert.match(html, /第 5–5 篇，共 5 篇/);
  assert.match(html, /href="#\/active-etf\/old\?v=2"/);
});

test('optional companion covers use the supplied image without changing card identity, date or version', () => {
  const row = { ...fourDays[0], cover: { sha256: 'a'.repeat(64), bytes: 1024, width: 480 as const, height: 360 as const, contentType: 'image/jpeg' as const, url: '/storage/test-cover.jpg?signature=fixture' } };
  const html = markup([row]);
  assert.match(html, /class="article-thumb etf-report-cover etf-report-cover--image"/);
  assert.match(html, /<img[^>]*src="\/storage\/test-cover.jpg\?signature=fixture"[^>]*width="480" height="360"/);
  assert.match(html, /alt="《day12》封面"/);
  assert.match(html, /href="#\/active-etf\/day12\?v=2"/);
  assert.match(html, /aria-label="持股比較日期"[\s\S]*dateTime="2026-10-12"/);
  assert.deepEqual(cardIds(html), ['day12']);
});

test('historical absent covers and invalid image URLs preserve the dated placeholder', () => {
  for (const url of ['', 'javascript:alert(1)', '//example.invalid/tracker.jpg']) {
    const row = { ...fourDays[0], cover: { sha256: 'a'.repeat(64), bytes: 1024, width: 480 as const, height: 360 as const, contentType: 'image/jpeg' as const, url } };
    const html = markup([row]);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /研究分析/);
    assert.match(html, /2026\/10\/12/);
  }
  assert.doesNotMatch(markup(fourDays), /<img/);
});


test('institutional catalog uses its own links, labels and single research date with shared filters', () => {
  const html=markup([item('flow19','2026-10-19','2026-10-20T09:00:00Z','法人產業方向')], '#/institutional-flows', 'institutional');
  assert.match(html,/三大法人研究/);assert.match(html,/href="#\/institutional-flows\/flow19\?v=2"/);
  assert.match(html,/aria-label="研究日期"/);assert.doesNotMatch(html,/持股比較日期|開啟 ETF 分析|主動式 ETF/);
  const query={q:'半導體',month:'2026-10',sort:'oldest',page:1};
  const hash=catalog.etfCatalogHash(query,'#/institutional-flows');assert.ok(hash.startsWith('#/institutional-flows?'));assert.deepEqual(catalog.readEtfCatalogQuery(hash),query);
});
