// Offline fixtures only. This test never sends writes to STAGING.
// node --experimental-transform-types --loader ./backend/tests/etf-data-loader.test.mjs backend/tests/etf-industry-history.test.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { table, tables, control } from './etf-data-mock.test.mjs';
import { T } from '../etf-data-store.ts';
import { DATA_SCOPE, FACT_TABLES, key, hash } from '../../shared/etf-data-contract.ts';
import { threeMonthWindow, estimatePoint, industryHistoryQuery, qaIndustryHistoryQuery } from '../etf-industry-history.ts';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const passed = [];
const check = async (name, action) => { await action(); passed.push(name); };
const evidence = value => ({ value, raw: value || '', precision: value === null ? 'unknown' : 'exact', upperBound: null, upperInclusive: false });
const fund = { fundId: 'offline-fund', securityId: 'offline-etf', code: 'OFFLINE', name: 'Offline fixture only' };
const set = day => ({ id: 'offline-set-' + day, fundId: fund.fundId, scopeId: DATA_SCOPE, requestedDate: day, holdingDate: day,
  dateAlignment: 'confirmed', classificationVersion: 'v1', sourceDocumentIds: ['offline-source'], sealedAt: 'fixture',
  changeRefs: [], allocationIds: [], });
const row = (day, amount, extra = {}) => ({ id: 'offline-row-' + day, setId: 'offline-set-' + day, fundId: fund.fundId,
  industryId: 'offline-industry', securityId: 'offline-stock', startDate: new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10),
  endDate: day, estimateNtd: evidence(amount), estimateMethod: 'offline-source-estimate', priceAsOf: day, sourceDocumentId: 'offline-source', ...extra });
async function seed(day, amount, version = 1) {
  const s = set(day); s.id += '-v' + version;
  const c = row(day, amount, { id: 'offline-change-' + day + '-v' + version, setId: s.id });
  const changeTable = FACT_TABLES.change + '_tw_' + day.slice(0, 7).replace('-', '');
  table(changeTable).set(c.id, c); s.changeRefs = [{ table: changeTable, id: c.id }];
  const a = { id: 'offline-allocation-' + day, industryId: 'offline-industry', label: 'Offline industry', taxonomyVersion: 'v1' };
  const allocationTable = T.allocations + '_tw_' + day.slice(0, 7).replace('-', '');
  table(allocationTable).set(a.id, a); s.allocationIds = [a.id];
  table(T.sets).set(s.id, s);
  const publication = { id: 'offline-publication-' + day + '-v' + version, scopeId: DATA_SCOPE, tradeDate: day, version,
    fundSelections: [fund], sets: { [fund.fundId]: s.id }, sourceRefs: [], published: true, calendarId: null, calendarVersion: null };
  publication.publicationHash = await hash(publication);
  table(T.publications).set(publication.id, publication);
  table(T.heads).set(await key(DATA_SCOPE, day), { publicationId: publication.id });
  table(T.catalog).set(await key(DATA_SCOPE, 'catalog'), { latestDate: day });
  return publication;
}
await check('three calendar months is open-left inclusive-right, not90days or sessions', () => {
  const w = threeMonthWindow('2026-10-13');
  assert.equal(w.start, '2026-07-14'); assert.equal(w.dates.at(-1), '2026-10-13'); assert.equal(w.dates.length, 92);
  assert.equal(threeMonthWindow('2026-05-31').start, '2026-03-01');
  assert.equal(threeMonthWindow('2024-05-31').start, '2024-03-01');
  assert.equal(threeMonthWindow('2026-01-31').start, '2025-11-01');
  assert.equal(threeMonthWindow('2026-03-31').start, '2026-01-01');
  assert.throws(() => threeMonthWindow('2026-02-30'));
});
await check('exact decimal monetary sample preserves negative, zero and precision', () => {
  const day = '2026-10-13';
  const p = estimatePoint(day, set(day), [row(day, '120000000.12345678')], 'offline-industry', null, 'v1');
  assert.equal(p.valueNtd, '120000000.12345678'); assert.equal(p.observedStocks, 1);
  assert.equal(estimatePoint(day, set(day), [row(day, '-200000000')], 'offline-industry', null, 'v1').valueNtd, '-200000000');
  assert.equal(estimatePoint(day, set(day), [row(day, '0')], 'offline-industry', null, 'v1').valueNtd, '0');
  const mixed = [row(day, '100.1'), row(day, '-100.1', { securityId: 'second-stock' })];
  assert.equal(estimatePoint(day, set(day), mixed, 'offline-industry', null, 'v1').valueNtd, '0');
  assert.equal(estimatePoint(day, set(day), [], 'offline-industry', null, 'v1').valueNtd, null);
  assert.equal(estimatePoint(day, set(day), [row(day, null)], 'offline-industry', null, 'v1').reason, 'imprecise_value');
});
await check('date, classification, missing baseline, source and method guardrails', () => {
  const day = '2026-10-13';
  const estimate = (rows, s = set(day), previous = null) => estimatePoint(day, s, rows, 'offline-industry', previous, 'v1');
  assert.equal(estimate([row(day, '1')], { ...set(day), holdingDate: '2026-10-12' }).reason, 'unconfirmed_date');
  assert.equal(estimate([row(day, '1')], { ...set(day), classificationVersion: 'v2' }).reason, 'classification_change');
  assert.equal(estimate([row(day, '1', { startDate: '2026-10-09' })]).reason, 'missing_baseline');
  assert.equal(estimate([row(day, '1', { startDate: '2026-10-09' })], set(day), '2026-10-09').valueNtd, '1');
  assert.equal(estimate([row(day, '1', { estimateMethod: null })]).valueNtd, null);
  assert.equal(estimate([row(day, '1', { priceAsOf: '2026-10-14' })]).valueNtd, null);
  assert.equal(estimate([row(day, '1', { sourceDocumentId: 'other-source' })]).valueNtd, null);
  assert.equal(estimate([row(day, '1'), row(day, '2', { estimateMethod: 'different' })]).valueNtd, null);
  assert.equal(estimate([row(day, '1', { estimateNtd: { ...evidence('1'), precision: 'rounded' } })]).valueNtd, null);
});
await check('only published DB facts, null missing dates and isolated scopes', async () => {
  tables.clear();
  assert.equal((await industryHistoryQuery({})).end, null);
  await seed('2026-07-14', '-1'); await seed('2026-10-12', '0'); await seed('2026-10-13', '100000000');
  const result = await industryHistoryQuery({});
  assert.equal(result.start, '2026-07-14'); assert.equal(result.publishedDays, 3);
  assert.equal(result.series[0].points.length, 3); assert.equal(result.dates.length, 92);
  assert.equal(result.series[0].points.find(p => p.date === '2026-10-12').valueNtd, '0');
  assert.equal(result.calendar['2026-10-11'], 'unknown');
  assert(!result.series[0].points.some(p => p.date === '2026-10-11'));
  assert.equal(control.listCalls.length, 0);
  assert(control.getCalls.every(call => call.count <= 80));
  await assert.rejects(industryHistoryQuery({ scopeId: 'qa-etf-history' }), e => e.code === 'invalid_scope');
  await assert.rejects(industryHistoryQuery({ dataset: 'synthetic' }), e => e.code === 'invalid_scope');
  await assert.rejects(industryHistoryQuery({ fundId: 'qa-fund-1' }), e => e.code === 'invalid_scope');
});
await check('fixed publication versions survive correction, new date advances window, filters validate', async () => {
  const old = await industryHistoryQuery({ fundId: fund.fundId, industryId: 'offline-industry' });
  await seed('2026-10-13', '999', 2); await seed('2026-10-14', '300');
  const pinned = await industryHistoryQuery({ fundId: fund.fundId, industryId: 'offline-industry', pin: old.pin });
  assert.equal(pinned.end, '2026-10-13');
  assert.equal(pinned.series[0].points.at(-1).valueNtd, '100000000');
  const fresh = await industryHistoryQuery({ fundId: fund.fundId });
  assert.equal(fresh.start, '2026-07-15'); assert.equal(fresh.end, '2026-10-14');
  assert(!fresh.series[0].points.some(p => p.date === '2026-07-14'));
  assert.equal((await industryHistoryQuery({ fundId: 'removed-fund', industryId: 'removed-industry' })).industryId, null);
  await assert.rejects(industryHistoryQuery({ fundId: fund.fundId, pin: old.pin }), e => e.code === 'pin_query_conflict');
  const forged = JSON.parse(atob(old.pin)); forged.refs[0][1] = 'private-unpublished';
  await assert.rejects(industryHistoryQuery({ fundId: fund.fundId, industryId: 'offline-industry', pin: btoa(JSON.stringify(forged)) }), e => e.status === 404);
  const before = control.commits;
  await industryHistoryQuery({});
  assert.equal(control.commits, before, 'Public history performs no writes');
});
await check('existing isolated QA fixture renders positive/negative monetary samples and never enters normal scope', async () => {
  const { qaPackage, qaDays, qaFunds } = await import('./etf-history-fixture.mjs');
  const scopeId = 'qa-etf-history';
  for (let n = 0; n < qaDays.length; n++) {
    const pack = qaPackage(n); const facts = pack.chunks.flatMap(c => c.facts);
    const input = pack.manifest.sets[0];
    const changes = facts.filter(f => f.kind === 'change' && f.data.setId === input.setId).map(f => f.data);
    const sealed = { ...input, id: input.setId, scopeId, sealedAt: 'offline', changeRefs: [], allocationIds: [] };
    const changeTable = FACT_TABLES.change + '_qa_' + qaDays[n].slice(0, 7).replace('-', '');
    changes.forEach((c, i) => { const id = 'qa-offline-change-' + n + '-' + i; table(changeTable).set(id, { ...c, id }); sealed.changeRefs.push({ id, table: changeTable }); });
    facts.filter(f => f.kind === 'industry').forEach(f => {
      const id = f.data.industryId; table(T.allocations + '_qa_' + qaDays[n].slice(0, 7).replace('-', '')).set(id, { ...f.data, id }); sealed.allocationIds.push(id);
    });
    for (const f of facts.filter(f => f.kind === 'session')) table(FACT_TABLES.session).set(await key(f.data.calendarId, f.data.calendarVersion, f.data.date), f.data);
    table(T.sets).set(sealed.id, sealed);
    const pub = { id: 'qa-offline-pub-' + n, scopeId, tradeDate: qaDays[n], fundSelections: [qaFunds[0]], sets: { [qaFunds[0].fundId]: sealed.id },
      sourceRefs: [], published: true, calendarId: 'qa-calendar', calendarVersion: 'qa-v1' };
    pub.publicationHash = await hash(pub); table(T.publications).set(pub.id, pub);
    table(T.heads).set(await key(scopeId, qaDays[n]), { publicationId: pub.id });
  }
  table(T.catalog).set(await key(scopeId, 'catalog'), { latestDate: qaDays.at(-1) });
  const qa = await qaIndustryHistoryQuery({ dataset: 'synthetic' });
  assert.equal(qa.scopeId, scopeId); assert.equal(qa.publishedDays, 21);
  assert(qa.series.flatMap(s => s.points).some(p => p.valueNtd && Number(p.valueNtd) > 0));
  assert(qa.series.flatMap(s => s.points).some(p => p.valueNtd && Number(p.valueNtd) < 0));
  assert(qa.warnings.some(w => w.includes('合成測試')));
  await assert.rejects(qaIndustryHistoryQuery({}), e => e.code === 'invalid_scope');
  await assert.rejects(industryHistoryQuery({ pin: qa.pin }), e => e.code === 'invalid_pin');
  const normal = await industryHistoryQuery({});
  assert(normal.funds.every(f => !f.fundId.startsWith('qa-')));
});
await check('a full quarter retains selected fund evidence within the response budget', async () => {
  tables.clear();
  const days = threeMonthWindow('2026-10-14').dates.filter(day => {
    const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
    return weekday !== 0 && weekday !== 6;
  });
  for (const day of days) {
    const publication = await seed(day, '100000000');
    const selected = table(T.sets).get(publication.sets[fund.fundId]);
    selected.classificationSourceIds = ['offline-taxonomy'];
    const sourceIds = ['offline-source', 'offline-taxonomy',
      ...Array.from({ length: 14 }, (_, n) => 'unrelated-fund-source-' + n)];
    publication.sourceRefs = sourceIds.map(sourceDocumentId => ({
      sourceDocumentId, provider: 'Issuer public history source ' + 'evidence '.repeat(10),
      url: 'https://example.com/official-history/' + sourceDocumentId,
      declaredDate: day, valuationDate: day, retrievedAt: day + 'T16:00:00Z',
      contentHash: 'a'.repeat(64), officialStatus: 'official',
    }));
    const { publicationHash: _hash, ...payload } = publication;
    publication.publicationHash = await hash(payload);
    table(T.publications).set(publication.id, publication);
  }
  const result = await industryHistoryQuery({ fundId: fund.fundId });
  assert.equal(result.publishedDays, days.length);
  assert.equal(result.series[0].points.length, days.length);
  assert(result.provenance.every(p => p.sourceRefs.length === 2));
  assert(result.provenance.every(p => p.sourceRefs.some(s => s.sourceDocumentId === 'offline-source')));
  assert(result.provenance.every(p => p.sourceRefs.some(s => s.sourceDocumentId === 'offline-taxonomy')));
  assert(!result.provenance.some(p => p.sourceRefs.some(s => s.sourceDocumentId.startsWith('unrelated-'))));
  assert(Buffer.byteLength(JSON.stringify(result)) < 200 * 1024);
  const pinned = await industryHistoryQuery({ fundId: fund.fundId, pin: result.pin });
  assert.equal(pinned.provenance.at(-1).publicationHash, result.provenance.at(-1).publicationHash);
});
await check('real-width quarterly publication IDs page with short URLs and accept legacy pins', async () => {
  tables.clear();
  const window = threeMonthWindow('2026-10-14');
  const published = new Map();
  for (const day of window.dates.filter(day => ![0, 6].includes(new Date(day).getUTCDay()))) {
    const pub = await seed(day, '1');
    const oldId = pub.id;
    pub.id = await key('real-width-publication', day);
    const s = table(T.sets).get(pub.sets[fund.fundId]);
    const changeTable = FACT_TABLES.change + '_tw_' + day.slice(0, 7).replace('-', '');
    const allocationTable = T.allocations + '_tw_' + day.slice(0, 7).replace('-', '');
    for (let n = 1; n < 20; n++) {
      const id = 'paged-change-' + day + '-' + n;
      const industryId = 'paged-industry-' + n;
      table(changeTable).set(id, row(day, String(n), { id, setId: s.id, industryId, securityId: 'paged-stock-' + n }));
      s.changeRefs.push({ table: changeTable, id });
      const allocationId = 'paged-allocation-' + day + '-' + n;
      table(allocationTable).set(allocationId, { id: allocationId, industryId, label: 'Industry ' + n });
      s.allocationIds.push(allocationId);
    }
    const { publicationHash: _hash, ...payload } = pub;
    pub.publicationHash = await hash(payload);
    table(T.publications).delete(oldId);
    table(T.publications).set(pub.id, pub);
    table(T.heads).set(await key(DATA_SCOPE, day), { publicationId: pub.id });
    published.set(day, pub.id);
  }
  const first = await industryHistoryQuery({ fundId: fund.fundId });
  assert(first.nextCursor, 'The fixture must exercise real paging');
  assert.equal(JSON.parse(atob(first.pin)).kind, 'industry-flow-v2');
  const series = [...first.series];
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor) {
    const query = { fundId: fund.fundId, pin: first.pin, cursor };
    assert(new URLSearchParams(query).toString().length < 7500, 'Opaque version state must fit practical request URL budgets');
    const page = await industryHistoryQuery(query);
    assert.equal(page.pin, first.pin);
    series.push(...page.series);
    cursor = page.nextCursor;
    pages++;
    assert(pages <= 5);
  }
  assert.equal(series.length, 20);
  assert.equal(new Set(series.map(s => s.industryId)).size, 20);
  const legacy = btoa(JSON.stringify({ kind: 'industry-flow-v1', scopeId: DATA_SCOPE,
    end: '2026-10-14', fundId: fund.fundId, industryId: null,
    refs: window.dates.map(day => [day, published.get(day) || null]) }));
  const old = await industryHistoryQuery({ fundId: fund.fundId, pin: legacy });
  assert.equal(old.provenance.at(-1).publicationHash, first.provenance.at(-1).publicationHash);
  const bad = JSON.parse(atob(first.pin));
  bad.refs[0][0] = 9;
  await assert.rejects(industryHistoryQuery({ fundId: fund.fundId, pin: btoa(JSON.stringify(bad)) }), e => e.code === 'invalid_pin');
});
console.log(JSON.stringify({ passed: passed.length, cases: passed, listScans: control.listCalls.length }, null, 2));
