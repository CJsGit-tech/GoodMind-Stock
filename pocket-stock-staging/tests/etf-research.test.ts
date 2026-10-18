import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEtfJson, parseEtfResearchSource, researchSource } from '../shared/etf-research.ts';
import { jsonFixtureParts } from './fixtures/etf-json-fixture.ts';
import { fixtureMarkdown, markdownFixtureParts } from './fixtures/etf-markdown-fixture.ts';
import { validateAnalysis } from '../shared/etf-analysis.ts';

test('JSON preserves authored tokens, source bytes, null/zero and all chart records without Markdown conversion', async () => {
  const value = jsonFixtureParts(), raw = JSON.stringify(value), result = await parseEtfResearchSource(raw);
  assert.deepEqual(result.errors, []);
  assert.equal(result.report!.format, 'etf-json');
  assert.equal(researchSource(result.report!), raw);
  assert.equal(result.report!.articleMarkdown, '');
  assert.deepEqual(result.report!.analysis, value.analysis);
  assert.deepEqual(result.report!.visualizations.map(v => v.records.length), [1, 1, 1]);
  assert.equal(result.report!.visualizations[1].records[0].baseline_shares, 0);
  assert.equal(result.report!.visualizations[1].records[0].unit_adjusted_change_pct, null);
});
test('explicit company and signed numeric presentation remains lossless, including linked text and neutral zero', async () => {
  const value = jsonFixtureParts();
  const children: any[] = [
    { type: 'text', tag: '', nesting: 0, content: '2026 年、2368；未標記的數字保留原樣。' },
    { type: 'link_open', tag: 'a', nesting: 1, attrs: { href: 'https://example.invalid/source' } },
    { type: 'text', tag: '', nesting: 0, content: '金像電', presentation: { role: 'company_name', stock_code: '2368' } },
    { type: 'link_close', tag: 'a', nesting: -1 },
    ...[4313, -4313, 0, -0].map(n => ({ type: 'text', tag: '', nesting: 0, content: '4,313張', presentation: { role: 'numeric', value: n } })),
    { type: 'text', tag: '', nesting: 0, content: '台股字碼', presentation: { role: 'company_name', stock_code: '123456A' } },
  ];
  value.analysis.sections[1].tokens[1].children = children;
  const before = structuredClone(value.analysis);
  validateAnalysis(value.analysis, () => true);
  assert.deepEqual(value.analysis, before);
  assert.ok(Object.is(children[7].presentation.value, -0));
  const raw = JSON.stringify(value, null, 2) + '\n';
  const result = await parseEtfJson(raw);
  assert.deepEqual(result.errors, []);
  assert.equal(result.report!.rawJson, raw);
  assert.equal(result.report!.sourceHash, createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(result.report!.analysis, JSON.parse(raw).analysis);
  assert.equal(result.report!.analysis!.sections[1].tokens[1].children![0].presentation, undefined);
  const reparsed = await parseEtfResearchSource(researchSource(result.report!));
  assert.deepEqual(reparsed.report!.analysis, result.report!.analysis);
  assert.equal(reparsed.report!.sourceHash, result.report!.sourceHash);
});
test('rejects malformed presentation, unsafe extras and markers outside text leaves', async () => {
  const cases: any[] = [
    null, [], 'numeric', true, {},
    { role: 'unknown', value: 1 },
    ...[null, true, '1'].map(value => ({ role: 'numeric', value })),
    { role: 'numeric' }, { role: 'numeric', value: 1, stock_code: '2368' },
    { role: 'numeric', value: 1, style: 'color:red' },
    { role: 'numeric', value: 1, html: '<script>alert(1)</script>' },
    ...['', ' 2368', '2368 ', '<script>', 'javascript:1', '123', '1234567', '2368AB', 2368].map(stock_code => ({ role: 'company_name', stock_code })),
    { role: 'company_name', stock_code: '2368', value: 1 },
  ];
  for (const presentation of cases) {
    const value = jsonFixtureParts();
    Object.assign(value.analysis.sections[1].tokens[1].children![0], { presentation });
    assert.throws(() => validateAnalysis(value.analysis, () => true), error => !!(error as any).analysisPath?.endsWith('.presentation'));
    const result = await parseEtfJson(JSON.stringify(value));
    assert.equal(result.report, null, JSON.stringify(presentation));
    assert.ok(['invalid_analysis', 'unsafe_content'].includes(result.errors[0].code));
    assert.match(result.errors[0].path, /\.presentation(?:\.|$)/);
  }
  const invalidTokens = [
    { type: 'inline', tag: '', nesting: 0, content: '1', presentation: { role: 'numeric', value: 1 } },
    { type: 'code_inline', tag: 'code', nesting: 0, content: '1', presentation: { role: 'numeric', value: 1 } },
    { type: 'text', tag: '', nesting: 0, content: '', presentation: { role: 'numeric', value: 1 } },
    { type: 'text', tag: '', nesting: 0, content: '1', presentation: { role: 'numeric', value: 1 }, style: { color: 'red' } },
    { type: 'text', tag: '', nesting: 0, content: '1', presentation: { role: 'numeric', value: 1 }, attrs: { onerror: 'alert(1)' } },
    { type: 'text', tag: '', nesting: 0, content: '1', presentation: { role: 'numeric', value: 1 }, children: [] },
    { type: 'strong_open', tag: 'strong', nesting: 1, presentation: { role: 'numeric', value: 1 } },
  ];
  for (const token of invalidTokens) {
    const value = jsonFixtureParts();
    value.analysis.sections[1].tokens[1].children = [token] as any;
    const result = await parseEtfJson(JSON.stringify(value));
    assert.equal(result.report, null, JSON.stringify(token));
    assert.equal(result.errors[0].code, 'invalid_analysis');
  }
  // These cannot occur in JSON, but the shared validator must reject direct callers too.
  for (const presentation of [
    ...[NaN, Infinity, -Infinity].map(value => ({ role: 'numeric', value })),
    Object.assign(Object.create({ style: 'color:red' }), { role: 'numeric', value: 1 }),
    Object.assign(Object.create(null), { role: 'numeric', value: 1 }),
  ]) {
    const value = jsonFixtureParts();
    Object.assign(value.analysis.sections[1].tokens[1].children![0], { presentation });
    assert.throws(() => validateAnalysis(value.analysis, () => true), error => !!(error as any).analysisPath?.endsWith('.presentation'));
  }
});
const actualSourceRoot = process.env.ACTIVEETF_JSON_ROOT;
test('latest four authored JSON reports preserve exact source, hash and presentation AST', { skip: !actualSourceRoot }, async t => {
  for (const day of ['12', '13', '14', '15']) {
    const raw = readFileSync(join(actualSourceRoot!, `2026-10-${day}-台股主動ETF日報`, 'data.json'), 'utf8');
    const original = JSON.parse(raw), result = await parseEtfResearchSource(raw);
    assert.deepEqual(result.errors, []);
    assert.equal(result.report!.id, `tw-active-etf-2026-10-${day}`);
    assert.equal(result.report!.rawJson, raw);
    assert.equal(researchSource(result.report!), raw);
    assert.equal(result.report!.sourceHash, createHash('sha256').update(raw).digest('hex'));
    assert.deepEqual(result.report!.analysis, original.analysis);
    const roundtrip = await parseEtfResearchSource(researchSource(result.report!));
    assert.deepEqual(roundtrip.report!.analysis, original.analysis);
    assert.equal(roundtrip.report!.sourceHash, result.report!.sourceHash);
    const markers = JSON.stringify(result.report!.analysis).match(/"presentation":/g)?.length || 0;
    assert.ok(markers > 0);
    t.diagnostic(`2026-10-${day}: ${result.report!.sourceBytes} bytes, ${markers} explicit markers, SHA-256 ${result.report!.sourceHash}`);
  }
});
test('rejects malformed, executable, duplicate, incompatible and unbalanced JSON at import', async () => {
  const mutate = (fn: (v: any) => void) => { const v = jsonFixtureParts(); fn(v); return JSON.stringify(v); };
  const cases = [
    '{"schema_version":"5.0.0","schema_version":"5.0.0"}',
    mutate(v => v.schema_version = '6.0.0'),
    mutate(v => v.analysis.sections.reverse()),
    mutate(v => v.analysis.sections[0].tokens.pop()),
    mutate(v => v.analysis.sections[0].tokens[1].children[1].tag = 'script'),
    mutate(v => v.analysis.sections[0].tokens[1].children[1].semantic = 'guess_number'),
    mutate(v => v.analysis.sections[0].tokens[1].children = [{ type: 'html_inline', tag: '', nesting: 0, content: '<img onerror="alert(1)">' }]),
    mutate(v => v.dashboard.shared.source_registry.QA1.url = 'https://example.invalid/?token=secret'),
    mutate(v => v.dashboard.visualizations[0].source_ids = ['missing']),
    mutate(v => v.navigation = [{ date: '2026-10-15', label: 'unsafe', href: 'javascript:alert(1)' }]),
  ];
  for (const raw of cases) { const result = await parseEtfJson(raw); assert.equal(result.report, null); assert.ok(result.errors[0].path); }
});
test('same-ID Markdown to JSON migration retains published v1 until reviewed explicit v2 publish', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'etf-json-migration-'));
  process.env.POCKETSTOCKS_DATA_DIR = dir;
  process.env.ADMIN_MASTER_SECRET = 'disposable-test-only';
  const { db } = await import('../local/sdk.ts');
  const { makeEtfMarkdownRoutes, readPublishedMarkdown } = await import('../backend/etf-markdown.ts');
  const routes = makeEtfMarkdownRoutes({ requireAdmin: async () => ({ id: 'fixture' }), isSameOriginMutation: () => true });
  const call = async (action: string, body: any) => {
    const r = await routes['POST /api/admin/etf-research/' + action][0]({ body, event: {}, params: {}, query: {} });
    assert.equal(r!.statusCode, 200, r!.body); return JSON.parse(r!.body).entry;
  };
  const id = 'qa-json-migration';
  try {
    const md = fixtureMarkdown(markdownFixtureParts(id));
    let e = await call('save', { rawSource: md, baseRevision: 0, requestId: 'json-migrate-save-001' });
    e = await call('review', { id, baseRevision: 1, sourceHash: e.draft.sourceHash, requestId: 'json-migrate-review-001' });
    await call('publish', { id, baseRevision: 1, expectedPublishedVersion: 0, reviewed: true, reviewHash: e.reviewHash, requestId: 'json-migrate-publish-001' });
    const raw = JSON.stringify(jsonFixtureParts(id));
    e = await call('save', { rawSource: raw, baseRevision: 1, requestId: 'json-migrate-save-002' });
    assert.equal(e.revision, 2); assert.equal(e.reviewHash, null); assert.equal(e.draft.rawJson, raw);
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).report.rawMarkdown, md);
    e = await call('review', { id, baseRevision: 2, sourceHash: e.draft.sourceHash, requestId: 'json-migrate-review-002' });
    await call('publish', { id, baseRevision: 2, expectedPublishedVersion: 1, reviewed: true, reviewHash: e.reviewHash, requestId: 'json-migrate-publish-002' });
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).report.rawJson, raw);
    assert.equal(JSON.parse((await readPublishedMarkdown(id, '1'))!.body).report.rawMarkdown, md);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
