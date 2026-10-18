import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisToken, EtfAnalysis } from '../../shared/etf-analysis';

const output = await mkdtemp(join(tmpdir(), 'pocketstocks-presentation-'));
const entry = join(output, 'presentation.mjs');
await build({ entryPoints: [resolve('src/etf-json-analysis.tsx')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' });
await symlink(resolve('node_modules'), join(output, 'node_modules'));
const { JsonAnalysis } = await import(pathToFileURL(entry).href);
test.after(async () => { await rm(output, { recursive: true, force: true }); });

const text = (content: string, presentation?: AnalysisToken['presentation']): AnalysisToken =>
  ({ type: 'text', tag: '', nesting: 0, content, ...(presentation ? { presentation } : {}) });
const pair = (type: string, tag: string, semantic?: 'data_highlight'): AnalysisToken =>
  ({ type: type + '_open', tag, nesting: 1, ...(semantic ? { semantic } : {}) });
const close = (token: AnalysisToken): AnalysisToken => ({ ...token, type: token.type.replace('_open', '_close'), nesting: -1 });
const paragraph = (children: AnalysisToken[]): AnalysisToken[] => {
  const p = pair('paragraph', 'p');
  return [p, { type: 'inline', tag: '', nesting: 0, children }, close(p)];
};
function render(tokens: AnalysisToken[], section = 'allocation_analysis') {
  const analysis: EtfAnalysis = { format_version: '1.0.0', sections: [{ id: section, title: '合成排版驗證', tokens }] };
  const original = structuredClone(analysis);
  const html = renderToStaticMarkup(React.createElement(JsonAnalysis, { analysis, sourceJump: () => {} }));
  assert.deepEqual(analysis, original, 'Rendering must not rewrite source tokens or presentation values');
  return html;
}

test('explicit company and numeric markers retain text, IDs, and declared signed values', () => {
  const html = render(paragraph([
    text('減少'), text('京元電子', { role: 'company_name', stock_code: '2449' }),
    text('4,313張', { role: 'numeric', value: -4313 }), text('，增加'),
    text('精測', { role: 'company_name', stock_code: '6510' }), text('169張', { role: 'numeric', value: 169 }),
  ]));
  assert.match(html, /class="md-company-name" data-stock-code="2449">京元電子<\/span>/);
  assert.match(html, /class="md-analysis-number md-down" data-value="-4313">4,313張<\/span>/);
  assert.match(html, /class="md-analysis-number md-up" data-value="169">169張<\/span>/);
  assert.doesNotMatch(html, /md-up[^>]*>4,313張/);
});

test('zero remains neutral and ordinary names, dates, stock codes and numbers receive no inferred presentation', () => {
  const html = render(paragraph([
    text('金像電 2368，2026-10-12，2026-W42，單價1,235元。'),
    text('0張', { role: 'numeric', value: 0 }), text('未知／未取得。'),
  ]));
  assert.match(html, /金像電 2368，2026-10-12，2026-W42，單價1,235元。/);
  assert.match(html, /class="md-analysis-number md-zero" data-value="0">0張/);
  assert.equal((html.match(/md-analysis-number/g) || []).length, 1);
  assert.doesNotMatch(html, /md-company-name/);
});

test('source links and internal source actions retain the same explicit presentation spans', () => {
  const source = { ...pair('link', 'a'), attrs: { href: 'https://example.invalid/source?stock=2449' } };
  const jump = { ...pair('link', 'a'), attrs: { href: '#weekly-trend-sources' } };
  const html = render(paragraph([source, text('京元電子', { role: 'company_name', stock_code: '2449' }),
    text('月減10.25%', { role: 'numeric', value: -10.25 }), close(source), text('；'),
    jump, text('金像電', { role: 'company_name', stock_code: '2368' }),
    text('+3.74%', { role: 'numeric', value: 3.74 }), close(jump)]));
  assert.match(html, /href="https:\/\/example.invalid\/source\?stock=2449" target="_blank" rel="noopener noreferrer"><span class="md-company-name"/);
  assert.match(html, /<button type="button" class="md-source-jump"><span class="md-company-name"/);
  assert.match(html, /md-analysis-number md-down" data-value="-10.25"/);
  assert.match(html, /md-analysis-number md-up" data-value="3.74"/);
  assert.doesNotMatch(html, /href="#weekly-trend-sources"/);
});

test('semantic highlight retains a child numeric sign instead of converting the whole value into an inferred tone', () => {
  const strong = pair('strong', 'strong', 'data_highlight');
  const html = render(paragraph([strong, text('4,313張', { role: 'numeric', value: -4313 }), close(strong)]));
  assert.match(html, /<mark class="md-data-highlight"><span class="md-analysis-number md-down" data-value="-4313">4,313張<\/span><\/mark>/);
});

test('metric cards use signed numeric markers even when their label suggests the opposite direction', () => {
  const list = pair('bullet_list', 'ul'), item = pair('list_item', 'li'), p = pair('paragraph', 'p');
  const label = pair('strong', 'strong'), value = pair('strong', 'strong', 'data_highlight');
  const tokens = [list, item, p, { type: 'inline', tag: '', nesting: 0, children: [label,
    text('主要增配（估值）'), close(label), text('：測試資料 '), value,
    text('100元', { role: 'numeric', value: -100 }), close(value)] } as AnalysisToken, close(p), close(item), close(list)];
  const html = render(tokens, 'key_metrics');
  assert.match(html, /<dd class="md-json-figure-value"><mark class="md-data-highlight"><span class="md-analysis-number md-down" data-value="-100">100元/);
  assert.doesNotMatch(html, /md-json-figure-value up|md-analysis-number md-up/);
});

test('legacy card tones remain compatible only when the entire card has no numeric presentation', () => {
  const list = pair('bullet_list', 'ul'), item = pair('list_item', 'li'), p = pair('paragraph', 'p');
  const label = pair('strong', 'strong'), value = pair('strong', 'strong', 'data_highlight');
  for (const title of ['主要增配（估值）', '主要減配（估值）']) {
    const make = (numeric: AnalysisToken, context: AnalysisToken = text('。')) => [list, item, p,
      { type: 'inline', tag: '', nesting: 0, children: [label, text(title), close(label), text('：'), value,
        numeric, close(value), context] } as AnalysisToken, close(p), close(item), close(list)];
    const legacy = render(make(text('100元')), 'key_metrics');
    assert.match(legacy, new RegExp('class="md-json-figure-value ' + (title.startsWith('主要增配') ? 'up' : 'down') + '"'));
    for (const signed of [-100, 0, 100]) {
      const marked = render(make(text('100元', { role: 'numeric', value: signed })), 'key_metrics');
      assert.match(marked, /class="md-json-figure-value"/);
      assert.match(marked, new RegExp('md-analysis-number ' + (signed > 0 ? 'md-up' : signed < 0 ? 'md-down' : 'md-zero')));
    }
    const contextOnly = render(make(text('100元'), text('0%', { role: 'numeric', value: 0 })), 'key_metrics');
    assert.match(contextOnly, /class="md-json-figure-value"/, 'A numeric marker anywhere in the card disables label fallback');
  }
});

test('presentation never enables HTML or unsafe links and absent markers keep legacy text readable', () => {
  const unsafe = { ...pair('link', 'a'), attrs: { href: 'javascript:alert(1)' } };
  const html = render(paragraph([text('<script>alert(1)</script>', { role: 'company_name', stock_code: '2449' }),
    unsafe, text('原連結文字'), close(unsafe), text('，普通強調與100元維持原文。')]));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /原連結文字/);
  assert.match(html, /普通強調與100元維持原文。/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
});
