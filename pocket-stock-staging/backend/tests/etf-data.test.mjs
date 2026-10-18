// Offline semantic checks: the loader redirects backend SDK imports to the local simulator.
// Run: node --experimental-transform-types --loader ./backend/tests/etf-data-loader.test.mjs backend/tests/etf-data.test.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { db, table, tables, control } from './etf-data-mock.test.mjs';
import * as contract from '../../shared/etf-data-contract.ts';
import * as store from '../etf-data-store.ts';
import { catalogQuery, compareQuery, dataQuery, historyQuery, privatePreview } from '../etf-data-query.ts';
import { makeEtfDataRoutes } from '../etf-data.ts';
import { makeEtfRoutes } from '../etf-reports.ts';
import { SCHEMA2_PUBLICATION_ENABLED, contentHash, makeEtfSnapshotRoutes, prepareEtfReportCommit, readVersionedReport } from '../etf-data-snapshots.ts';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const passed = [];
const performanceEvidence = [];
const check = async (name, action) => { await action(); passed.push(name); };
async function snapshotFixture(publicationEnabled) {
  assert.equal(typeof publicationEnabled, 'boolean');
  const url = new URL('../etf-data-snapshots.ts', import.meta.url);
  const source = readFileSync(url, 'utf8');
  const declaration = /^export const SCHEMA2_PUBLICATION_ENABLED = (?:true|false);$/gm;
  assert.equal([...source.matchAll(declaration)].length, 1, 'Fixture must replace exactly one explicit gate');
  const configured = source.replace(declaration, 'export const SCHEMA2_PUBLICATION_ENABLED = ' + publicationEnabled + ';');
  const compiled = stripTypeScriptTypes(configured, { mode: 'transform' }).replace(/from '([^']+)'/g, (match, specifier) =>
    specifier.startsWith('.') ? "from '" + new URL(specifier, url).href + "'" : specifier === '@appdeploy/sdk'
      ? "from '" + new URL('./etf-data-mock.test.mjs', import.meta.url).href + "'" : match);
  const fixture = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  assert.equal(fixture.SCHEMA2_PUBLICATION_ENABLED, publicationEnabled);
  return fixture;
}
const scopeId = contract.DATA_SCOPE;
const evidence = value => ({ value: value === null ? null : String(value), raw: value === null ? '' : String(value),
  precision: value === null ? 'unknown' : 'exact', upperBound: null, upperInclusive: false });
const source = { sourceDocumentId: 'fixture-source', provider: 'Synthetic official-calendar fixture, never live data',
  url: 'https://example.com/fixture', declaredDate: null, valuationDate: null,
  retrievedAt: '2026-10-01T00:00:00Z', contentHash: 'a'.repeat(64), officialStatus: 'official',
  privateRawStorageRef: 'etf-private/fixture.txt' };
const days = ['2026-09-25', '2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-05'];
let sequence = 0;
const rid = prefix => prefix + '-' + String(++sequence).padStart(8, '0');
const baseFacts = count => [
  { kind: 'security', data: { securityId: 'fixture-etf', name: 'Fixture ETF security', instrumentType: 'active-etf', identifiers: [{ code: '00981A', market: 'TWSE', validFrom: '2020-01-01', validTo: null }] } },
  { kind: 'security', data: { securityId: 'fixture-new-etf', name: 'Fixture new ETF security', instrumentType: 'active-etf', identifiers: [{ code: '00403A', market: 'TWSE', validFrom: '2020-01-01', validTo: null }] } },
  { kind: 'source', data: source },
  { kind: 'fund', data: { fundId: 'fixture-fund', securityId: 'fixture-etf', code: '00981A', name: 'Fixture ETF', issuer: 'Fixture', domesticEquity: true, fundType: 'active', currency: 'TWD' } },
  { kind: 'industry', data: { industryId: 'fixture-industry', taxonomyId: 'fixture-taxonomy', taxonomyVersion: 'v1', industryCode: '01',
    label: 'Fixture industry', sourceDocumentId: source.sourceDocumentId, classificationType: 'official' } },
  ...Array.from({ length: count }, (_v, n) => ({ kind: 'security', data: { securityId: 'fixture-stock-' + n, name: 'Fixture stock ' + n,
    instrumentType: 'equity', identifiers: [{ code: String(1000 + n), market: 'TWSE', validFrom: '2020-01-01', validTo: null }] } })),
  ...Array.from({ length: count }, (_v, n) => ({ kind: 'assignment', data: { assignmentId: 'fixture-assignment-' + n,
    securityId: 'fixture-stock-' + n, industryId: 'fixture-industry', taxonomyId: 'fixture-taxonomy', taxonomyVersion: 'v1',
    sourceDocumentId: source.sourceDocumentId, validFrom: '2020-01-01', validTo: null, primary: true } })),
  ...days.map((day, i) => ({ kind: 'session', data: { calendarId: 'fixture-calendar', calendarVersion: 'v1', date: day,
    isTradingDay: true, sessionOrdinal: 100 + i, previousSessionDate: i ? days[i - 1] : null,
    sourceDocumentId: source.sourceDocumentId, calendarCoveredThrough: '2026-10-06' } })),
  { kind: 'session', data: { calendarId: 'fixture-calendar', calendarVersion: 'v1', date: '2026-09-30',
    isTradingDay: false, sessionOrdinal: null, previousSessionDate: '2026-09-29',
    sourceDocumentId: source.sourceDocumentId, calendarCoveredThrough: '2026-10-06', closureReason: 'Synthetic closure fixture' } },
];
function packageFor(day, count = 1, revision = 'r1', amount = '100') {
  const setId = 'fixture-set-' + day + '-' + revision;
  const facts = [...baseFacts(count),
    { kind: 'metrics', data: { setId, fundId: 'fixture-fund', sourceDocumentId: source.sourceDocumentId,
      aumNtd: evidence('10000000000'), navNtd: evidence('10.01'), fundUnits: evidence('1000000000'),
      aumAsOf: day, navAsOf: day, unitsAsOf: day } },
    ...Array.from({ length: count }, (_v, n) => ({ kind: 'holding', data: { setId, fundId: 'fixture-fund', securityId: 'fixture-stock-' + n,
      sourceName: 'Fixture stock ' + n, sourceMarket: 'TWSE', shares: evidence(amount), weightPct: evidence(count === 1 ? '10' : '0.1'),
      sourceDocumentId: source.sourceDocumentId, sourceRowKey: 'row-' + n, industryId: 'fixture-industry', assignmentId: 'fixture-assignment-' + n,
      assetKind: 'equity' } })),
  ];
  const chunks = [];
  for (let i = 0; i < facts.length; i += 80) chunks.push(facts.slice(i, i + 80));
  const expectedCounts = {};
  facts.forEach(f => { expectedCounts[f.kind] = (expectedCounts[f.kind] || 0) + 1; });
  return { facts, chunks, manifest: { schemaVersion: 2, scopeId, requestedDate: day, chunkCount: chunks.length, expectedCounts,
    sets: [{ setId, fundId: 'fixture-fund', requestedDate: day, holdingDate: day,
      sourceDocumentIds: [source.sourceDocumentId], sourceRevision: revision, supersedesSetId: null,
      expectedHoldings: count, stockListCompleteness: 'complete', officialVerification: 'verified',
      dateAlignment: 'confirmed', classificationVersion: 'v1', taxonomyId: 'fixture-taxonomy' }],
    selectedSetIds: [setId], sourceSelections: [{ fundId: 'fixture-fund', setId, reason: 'Synthetic fixture source choice' }],
    fundSelections: [{ fundId: 'fixture-fund', securityId: 'fixture-etf', code: '00981A', name: 'Fixture ETF' }],
    selectionEvidenceIds: [source.sourceDocumentId], selectionConfirmed: false,
    calendarId: 'fixture-calendar', calendarVersion: 'v1', originReportSnapshotId: null } };
}
async function imported(pack) {
  let result = await store.createBatch({ requestId: rid('create'), manifest: pack.manifest });
  let batch = result.batch;
  for (let n = 0; n < pack.chunks.length; n++) {
    result = await store.uploadChunk(batch.id, { requestId: rid('chunk'), expectedRevision: batch.revision, chunkNo: n, facts: pack.chunks[n] });
    batch = result.batch;
  }
  return batch;
}
async function ready(batch) {
  let result = await store.validateBatch(batch.id, { requestId: rid('validate'), expectedRevision: batch.revision });
  assert.deepEqual(result.batch.validation.blockingErrors, []);
  result = await store.reviewBatch(batch.id, { requestId: rid('review'), expectedRevision: result.batch.revision,
    reviewHash: result.batch.validation.reviewHash, acknowledged: true });
  return result.batch;
}
async function publish(batch, expectedHeadVersion = 0, overrides = {}) {
  return store.publishBatch(batch.id, { requestId: rid('publish'), expectedRevision: batch.revision,
    expectedHeadVersion, reviewHash: batch.reviewedPayloadHash, confirmed: true, ...overrides }, prepareEtfReportCommit);
}
const query = { scopeId, end: days.at(-1), window: '5', level: 'stock', metric: 'shares', basis: 'position_level', stockId: 'fixture-stock-0' };
await check('cutover deployment source explicitly enables schema2 publication', async () => {
  assert.equal(SCHEMA2_PUBLICATION_ENABLED, true);
});
await check('empty catalogue/history use honest missing states; no GET seeds', async () => {
  const initial = await catalogQuery({ scopeId }); assert.equal(initial.latestPublishedDate, null);
  const missing = await historyQuery(query); assert.equal(missing.status, 'missing');
  assert(missing.missing.some(m => m.reason === 'calendar_unavailable')); assert.equal(control.commits, 0);
});
await check('exact decimal arithmetic, fractional lots and imprecise evidence', async () => {
  assert.equal(contract.decimalOp('0.1', '0.2', 'add'), '0.3');
  assert.equal(contract.decimalOp('9007199254740993000', '9007199254740992999', 'subtract'), '1');
  assert.equal(contract.exactDelta(evidence('0.0001'), evidence('0.0002')).value, '0.0001');
  assert.throws(() => contract.decimal(1.23));
  assert.equal(contract.exactDelta({ ...evidence('0.00'), precision: 'rounded' }, evidence('1')).value, null);
});
let bulk;
await check('268 holdings across chunks, byte/action limits, durable private preview pages', async () => {
  const pack = packageFor('2026-10-05', 268, 'bulk');
  bulk = await imported(pack);
  assert.equal(bulk.receivedChunks.length, pack.chunks.length);
  assert.equal((await dataQuery({ scopeId, date: '2026-10-05' })).status, 'missing');
  await assert.rejects(publish(bulk), e => e.code === 'review_required');
  bulk = await ready(bulk);
  const preview = await privatePreview(bulk.id, {}); assert.equal(preview.funds[0].holdings.length, 100); assert(preview.nextCursor);
  const page2 = await privatePreview(bulk.id, { cursor: preview.nextCursor }); assert.equal(page2.funds[0].holdings.length, 100);
  const page3 = await privatePreview(bulk.id, { cursor: page2.nextCursor }); assert.equal(page3.funds[0].holdings.length, 68);
  assert(control.actions <= 100);
});
await check('incomplete chunks/schema errors/duplicate facts block publication', async () => {
  const pack = packageFor('2026-10-02', 1, 'incomplete');
  pack.manifest.chunkCount++;
  const batch = await imported(pack);
  const validation = await store.validateBatch(batch.id, { requestId: rid('validate'), expectedRevision: batch.revision });
  assert.equal(validation.batch.status, 'needs_attention'); assert(validation.batch.validation.blockingErrors.length);
  const duplicate = packageFor('2026-10-02', 1, 'duplicate');
  const created = await store.createBatch({ requestId: rid('create'), manifest: duplicate.manifest });
  await assert.rejects(store.uploadChunk(created.batch.id, { requestId: rid('chunk'), expectedRevision: created.batch.revision,
    chunkNo: 0, facts: [duplicate.facts[0], duplicate.facts[0]] }), e => e.code === 'duplicate_fact');
});
await check('unknown commit recovers matching receipt, pending remains unresolved, quota not retried', async () => {
  const pack = packageFor('2026-10-01', 1, 'unknown');
  control.writeFault = 'unknown-committed'; const id = rid('unknown-create');
  const result = await store.createBatch({ requestId: id, manifest: pack.manifest });
  assert.equal(result.state, 'committed'); assert.equal((await store.requestStatus(id)).state, 'committed');
  control.writeFault = 'unknown-pending'; const pendingId = rid('pending');
  await assert.rejects(store.createBatch({ requestId: pendingId, manifest: pack.manifest }), e => e.code === 'outcome_unresolved');
  assert.equal((await store.requestStatus(pendingId)).state, 'unresolved');
  control.writeFault = 'quota'; await assert.rejects(store.createBatch({ requestId: rid('quota'), manifest: pack.manifest }), e => e.code === 'AppDatabaseQuotaExceeded');
  await assert.rejects(store.createBatch({ requestId: id, manifest: { ...pack.manifest, selectionConfirmed: true } }), e => e.code === 'request_id_conflict');
});
await check('fixed real-session fixture calendar, cross-month endpoints, missing intermediate separate', async () => {
  for (const day of days.filter(d => d !== '2026-10-01' && d !== '2026-10-05')) await publish(await ready(await imported(packageFor(day))));
  await publish(bulk);
  const response = await compareQuery(query);
  assert.equal(response.resolved.start, days[0]); assert.equal(response.resolved.end, days.at(-1));
  assert.deepEqual(response.resolved.dates, days);
  assert.equal(response.endpointAvailable, true); assert.equal(response.trendAvailable, false);
  assert(response.missing.some(m => m.date === '2026-10-01' && m.reason === 'missing_intermediate'));
  const closure = await historyQuery({ ...query, end: '2026-09-30' });
  assert.equal(closure.resolved.end, '2026-09-29');
  const uncovered = await historyQuery({ ...query, end: '2026-10-06' });
  assert(uncovered.missing.some(m => m.reason === 'calendar_coverage_insufficient'));
  assert(!control.listCalls.some(name => !name.includes('batches')));
});
let oldPinned; let correction;
await check('pin retains versions across correction; same head CAS and old snapshot never mutate', async () => {
  oldPinned = await historyQuery(query);
  correction = await ready(await imported(packageFor('2026-10-05', 1, 'correction', '200')));
  const published = await publish(correction, 1);
  assert.equal(published.version, 2);
  const pinned = await historyQuery({ ...query, pin: oldPinned.pin });
  assert.equal(pinned.series[0].points.at(-1).value, '100');
  const refreshed = await historyQuery(query); assert.equal(refreshed.series[0].points.at(-1).value, '200');
  const old = await store.getPublication(oldPinned.versionVector.at(-1).publicationId);
  assert.equal(old.version, 1);
  await assert.rejects(historyQuery({ ...query, window: '10', pin: oldPinned.pin }), e => e.code === 'pin_query_conflict');
  const stale = await ready(await imported(packageFor('2026-10-05', 1, 'stale', '300')));
  await assert.rejects(publish(stale, 1), e => e.code === 'head_conflict');
});
await check('public details and catalogue stay pinned, member corruption not zero, privacy whitelist', async () => {
  const detail = await dataQuery({ scopeId, date: '2026-10-05', pin: oldPinned.pin });
  assert.equal(detail.version, 1); assert.equal(detail.funds[0].holdings.length, 100); assert(detail.nextCursor);
  const second = await dataQuery({ scopeId, date: '2026-10-05', pin: oldPinned.pin, cursor: detail.nextCursor });
  assert.equal(second.funds[0].holdings.length, 100);
  assert(!JSON.stringify(detail).includes('privateRawStorageRef')); assert(!JSON.stringify(detail).includes('etf-private/'));
  const catalog = await catalogQuery({ scopeId, date: '2026-10-05', pin: oldPinned.pin }); assert.equal(catalog.version, 1); assert(catalog.stocks.length);
  const head = await store.getHead(scopeId, '2026-10-05'); const publication = await store.getPublication(head.publicationId);
  const set = await store.getSet(publication.sets['fixture-fund']);
  const physical = store.partition(contract.FACT_TABLES.holding, scopeId, set.requestedDate);
  const id = await contract.key(set.id, 'fixture-stock-0'); const saved = table(physical).get(id); table(physical).delete(id);
  await assert.rejects(dataQuery({ scopeId, date: '2026-10-05' }), e => e.code === 'holding_integrity');
  table(physical).set(id, saved);
});
await check('heatmap enumerates industry series; no-estimate/net-flow disabled, no cumulative AUM', async () => {
  const heatmap = await historyQuery({ ...query, level: 'industry', metric: 'weightPct', basis: 'daily_delta', view: 'heatmap', stockId: '' });
  assert.equal(heatmap.series[0].industryId, 'fixture-industry'); assert.equal(heatmap.series[0].label, 'Fixture industry');
  assert.equal(heatmap.availableMetrics.find(m => m.metric === 'estimateNtd').available, false);
  assert.equal(heatmap.availableMetrics.find(m => m.metric === 'netFlowNtd').available, false);
  const aum = await historyQuery({ ...query, level: 'etf', metric: 'aumNtd', basis: 'eligible_cumulative', stockId: '' });
  assert.equal(aum.cumulativeEligibility.eligible, false); assert(aum.series[0].points.slice(1).every(p => p.value === null));
});
await check('restore creates a newer publication without rewinding or changing old versions', async () => {
  const originalId = oldPinned.versionVector.at(-1).publicationId;
  const restored = await store.restorePublication(originalId, { requestId: rid('restore'), expectedHeadVersion: 2, reason: 'Fixture restore', confirmed: true });
  assert.equal(restored.version, 3); assert.equal((await store.getPublication(originalId)).version, 1);
});
const helpers = {
  requireAdmin: async (_event, body) => body?.sessionToken === 'fixture-session' ? { id: 'fixture-author' } : null,
  isSameOriginMutation: event => event?.trustedOrigin === true,
  prepareReport: prepareEtfReportCommit,
};
const routes = { ...makeEtfDataRoutes(helpers), ...makeEtfRoutes(helpers), ...makeEtfSnapshotRoutes(helpers) };
async function invoke(route, body = {}, params = {}, queryValue = {}, auth = true, origin = true, routeSet = routes) {
  const ctx = { body: auth ? { ...body, sessionToken: 'fixture-session' } : body, params, query: queryValue, event: { trustedOrigin: origin } };
  const result = await routeSet[route][0](ctx);
  return { status: result.statusCode, data: JSON.parse(result.body) };
}
await check('all private endpoints reject anonymous/cross-origin, public endpoints do not leak batches', async () => {
  for (const route of Object.keys(routes).filter(r => r.startsWith('POST /api/admin'))) {
    assert.equal((await invoke(route, {}, { id: bulk.id }, {}, false)).status, 401, route);
    assert.equal((await invoke(route, {}, { id: bulk.id }, {}, true, false)).status, 403, route);
  }
  assert.equal((await invoke('GET /api/etf/data', {}, {}, { scopeId, date: '2026-10-05', setId: 'private-guessed' })).status, 200);
});
function legacyReport(id) {
  return { schemaVersion: 1, id, reportType: 'flows', title: 'Fixture report', excerpt: 'Synthetic report fixture',
    period: { start: '2026-10-02', end: '2026-10-05' }, evidenceDate: '2026-10-05',
    funds: ['00981A', '00403A', '00991A', '00406A', '00982A'].map(code => ({ code, name: 'Fixture ' + code, aumBillion: 10,
      rankAsOf: '2026-10-05', holdingsDate: '2026-10-05', coverage: 'fixture', sourceUrl: source.url })),
    rows: [{ etf: '00981A', code: '1000', name: 'Fixture', sector: 'Fixture industry', deltaLots: 1, weightDeltaPp: null,
      estimateNtd: null, sourceUrl: source.url, sourceDate: '2026-10-05' }],
    summary: [{ title: 'Fixture review', text: 'No live financial claim.', sources: [{ label: 'Fixture', url: source.url, eventDate: null }] }],
    operations: [], sampleNote: 'Fixture only.', warnings: [] };
}
await check('atomic data+report rollback, successful full switch, strict immutable report version read', async () => {
  const report = legacyReport('fixture-atomic-report');
  const saved = await invoke('POST /api/admin/etf-reports/save', { report, baseRevision: 0, requestId: rid('save-report') });
  assert.equal(saved.status, 200);
  const batch = await ready(await imported(packageFor('2026-10-05', 1, 'atomic', '400')));
  control.writeFault = 'condition';
  await assert.rejects(publish(batch, 3, { report: { id: report.id, baseRevision: 1 } }), e => e.code === 'write_conflict');
  assert.equal((await store.getHead(scopeId, '2026-10-05')).version, 3);
  assert.equal((await readVersionedReport(report.id)).statusCode, 404);
  const result = await publish(batch, 3, { report: { id: report.id, baseRevision: 1 } });
  assert.equal(result.version, 4); assert.equal((await readVersionedReport(report.id, '1')).statusCode, 200);
  assert.equal((await readVersionedReport(report.id, '2')).statusCode, 404);
  const immutable = structuredClone(table('etf_report_snapshots_v1').get(report.id + '.v1'));
  const edited = { ...report, title: 'Private revision' };
  await invoke('POST /api/admin/etf-reports/save', { report: edited, baseRevision: 1, requestId: rid('save-report') });
  assert.deepEqual(table('etf_report_snapshots_v1').get(report.id + '.v1'), immutable);
});
await check('large schema2 private pages verify complete hash; publication remains gated; raw pages not public', async () => {
  const disabled = await snapshotFixture(false);
  const disabledRoutes = { ...routes, ...disabled.makeEtfSnapshotRoutes(helpers) };
  const invokeDisabled = (route, body, params, queryValue) => invoke(route, body, params, queryValue, true, true, disabledRoutes);
  const report = { ...legacyReport('fixture-large-report'), schemaVersion: 2,
    dataLineage: { publicationIds: [], setIds: [], sourceHashes: [], taxonomyVersions: [],
      calendarVersion: null, comparison: { start: null, end: null }, versionVector: [], algorithmVersion: 'fixture-v1' } };
  report.holdings = [{ etf: '00981A', date: '2026-10-05', sourceUrl: source.url, note: 'Fixture large snapshot', currentComplete: true,
    rows: Array.from({ length: 1600 }, (_v, n) => ({ code: String(1000 + n), name: 'Fixture stock ' + n,
      sector: 'Fixture industry', market: 'TWSE', weightPct: 0.01, weightUpperBoundPct: null, weightRaw: '0.01%', shares: 1 })) }];
  const content = JSON.stringify(report); assert(Buffer.byteLength(content) > 180 * 1024);
  const pieces = [];
  for (let offset = 0; offset < content.length; offset += 80000) pieces.push(content.slice(offset, offset + 80000));
  const pages = await Promise.all(pieces.map(async (p, i) => ({ pageNo: i, pageId: 'fixture-body-page-' + i, pageHash: await contentHash(p), byteLength: Buffer.byteLength(p) })));
  const manifest = { pages, bodyBytes: Buffer.byteLength(content), bodyHash: await contentHash(content) };
  const created = await invokeDisabled('POST /api/admin/etf-reports/bodies', { requestId: rid('body-create'), reportId: report.id, baseRevision: 0, expectedPublishedVersion: 0, manifest });
  assert.equal(created.status, 200);
  const id = created.data.body.id;
  assert.equal((await invokeDisabled('POST /api/admin/etf-reports/bodies/:id/validate', { expectedRevision: 1, requestId: rid('body-validate') }, { id })).status, 409);
  for (let i = 0; i < pieces.length; i++) assert.equal((await invokeDisabled('POST /api/admin/etf-reports/bodies/:id/pages', { requestId: rid('body-page'), pageNo: i, content: pieces[i] }, { id })).status, 200);
  const validation = await invokeDisabled('POST /api/admin/etf-reports/bodies/:id/validate', { expectedRevision: 1, requestId: rid('body-validate') }, { id });
  assert.equal(validation.status, 200, JSON.stringify(validation.data));
  const reviewed = await invokeDisabled('POST /api/admin/etf-reports/bodies/:id/review', { expectedRevision: 2, requestId: rid('body-review'),
    reviewHash: validation.data.body.reviewHash, acknowledged: true }, { id });
  assert.equal(reviewed.status, 200); assert.equal(reviewed.data.schema2PublicationEnabled, false);
  const commitsBefore = control.commits;
  const gated = await invokeDisabled('POST /api/admin/etf-reports/bodies/:id/publish', { expectedRevision: 3, reviewHash: reviewed.data.body.reviewHash,
    requestId: rid('body-publish'), confirmed: true }, { id });
  assert.equal(gated.status, 409); assert.equal(gated.data.errorCode, 'schema2_publication_disabled');
  await assert.rejects(disabled.prepareEtfReportCommit({ bodyId: id }, {}), e => e.code === 'schema2_publication_disabled');
  assert.equal(control.commits, commitsBefore, 'Disabled standalone and paired publication cannot write');
  assert.equal((await readVersionedReport(report.id)).statusCode, 404);
  assert.equal((await invokeDisabled('GET /api/etf/reports/:id/pages/:pageNo', {}, { id: report.id, pageNo: '0' }, { version: '1' })).status, 404);
});

function repack(pack) {
  pack.chunks = [];
  for (let i = 0; i < pack.facts.length; i += 80) pack.chunks.push(pack.facts.slice(i, i + 80));
  pack.manifest.chunkCount = pack.chunks.length; pack.manifest.expectedCounts = {};
  for (const f of pack.facts) pack.manifest.expectedCounts[f.kind] = (pack.manifest.expectedCounts[f.kind] || 0) + 1;
  return pack;
}
await check('pinned null calendar remains null after newer calendar discovery', async () => {
  const head = await store.getHead(scopeId, days.at(-1));
  const pin = btoa(JSON.stringify({ schemaVersion: 2, scopeId, end: days.at(-1), window: 5,
    classification: 'published', refs: [[days.at(-1), head.publicationId]], calendarId: null, calendarVersion: null }));
  const result = await historyQuery({ ...query, pin });
  assert.equal(result.calendarVersion, null); assert.equal(result.versionVector.length, 1);
  assert.equal(result.versionVector[0].publicationId, head.publicationId);
  assert(result.missing.some(m => m.reason === 'calendar_unavailable'));
});
await check('fixed-end classification never drops an exited old security into false exact zero', async () => {
  const pack = packageFor('2026-10-05', 1, 'exit');
  pack.facts = pack.facts.filter(f => f.kind !== 'holding');
  pack.manifest.sets[0].expectedHoldings = 0; pack.manifest.sets[0].classificationVersion = 'v2';
  await publish(await ready(await imported(repack(pack))), 4);
  const result = await historyQuery({ ...query, level: 'industry', metric: 'weightPct', stockId: '',
    industryId: 'fixture-industry', classification: 'fixed_end' });
  assert.equal(result.series[0].points[0].value, null);
  assert.equal(result.series[0].points[0].missingReason, 'classification_change');
});
await check('same taxonomy-version stock industry transfer is not a pure allocation delta', async () => {
  const pack = packageFor('2026-10-05', 1, 'classification-shift');
  const industry = pack.facts.find(f => f.kind === 'industry');
  pack.facts.push({ kind: 'industry', data: { ...industry.data, industryId: 'fixture-industry-b', industryCode: '02', label: 'Fixture industry B' } });
  for (const fact of pack.facts) {
    if (fact.kind === 'assignment') { fact.data = { ...fact.data, assignmentId: 'fixture-assignment-shift', industryId: 'fixture-industry-b' }; }
    if (fact.kind === 'holding') fact.data = { ...fact.data, assignmentId: 'fixture-assignment-shift', industryId: 'fixture-industry-b' };
  }
  await publish(await ready(await imported(repack(pack))), 5);
  const result = await compareQuery({ ...query, level: 'industry', metric: 'weightPct', stockId: '', industryId: 'fixture-industry' });
  assert.equal(result.rows[0].classificationChanged, true); assert.equal(result.rows[0].missingReason, 'classification_change');
  assert.equal(result.rows[0].delta, null);
  const newIndustry = await compareQuery({ ...query, level: 'industry', metric: 'weightPct', stockId: '', industryId: 'fixture-industry-b' });
  assert.equal(newIndustry.rows[0].missingReason, 'classification_change');
});
await check('all >100 reported changes reconstruct through pinned detail pages; interval estimates stay unavailable as daily bars', async () => {
  const pack = packageFor('2026-10-05', 110, 'all-changes');
  for (let i = 0; i < 110; i++) pack.facts.push({ kind: 'change', data: {
    setId: pack.manifest.sets[0].setId, fundId: 'fixture-fund', securityId: 'fixture-stock-' + i,
    sourceDocumentId: source.sourceDocumentId, sourceRevision: 'r1', startDate: days[0], endDate: days.at(-1), sourceDate: days.at(-1),
    deltaShares: evidence('100'), weightDeltaPp: evidence(null), estimateNtd: evidence('1000'), estimateMethod: 'Synthetic period estimate',
    priceAsOf: days.at(-1), researchSectorId: 'fixture-industry',
  } });
  await publish(await ready(await imported(repack(pack))), 6);
  const pin = (await historyQuery(query)).pin;
  const changes = []; const holdingIds = []; let cursor;
  do {
    const response = await dataQuery({ scopeId, date: days.at(-1), pin, ...(cursor ? { cursor } : {}) });
    response.funds.forEach(f => { changes.push(...f.reportedChanges); holdingIds.push(...f.holdings.map(h => h.securityId)); });
    cursor = response.nextCursor;
  } while (cursor);
  assert.equal(changes.length, 110); assert.equal(holdingIds.length, 110);
  assert.equal(new Set(changes.map(c => c.securityId)).size, 110);
  const daily = await historyQuery({ ...query, metric: 'estimateNtd', basis: 'daily_delta' });
  assert.notEqual(daily.series[0].points.at(-1).status, 'observed');
  assert.equal(daily.series[0].points.at(-1).missingReason, 'source_estimate_unavailable');
});
await check('end-cohort new fund retains explicit old-date missing details with no unrelated sources', async () => {
  const pack = packageFor('2026-10-05', 1, 'new-cohort');
  const newSet = { ...pack.manifest.sets[0], setId: 'fixture-set-new-fund', fundId: 'fixture-new-fund' };
  pack.manifest.sets.push(newSet); pack.manifest.selectedSetIds.push(newSet.setId);
  pack.manifest.fundSelections.push({ fundId: newSet.fundId, securityId: 'fixture-new-etf', code: '00403A', name: 'Fixture new fund' });
  pack.manifest.sourceSelections.push({ fundId: newSet.fundId, setId: newSet.setId, reason: 'Fixture new member' });
  const oldFund = pack.facts.find(f => f.kind === 'fund');
  pack.facts.push({ kind: 'fund', data: { ...oldFund.data, fundId: newSet.fundId, securityId: 'fixture-new-etf', code: '00403A', name: 'Fixture new fund' } });
  const oldMetrics = pack.facts.find(f => f.kind === 'metrics');
  const oldHolding = pack.facts.find(f => f.kind === 'holding');
  pack.facts.push({ kind: 'metrics', data: { ...oldMetrics.data, setId: newSet.setId, fundId: newSet.fundId } });
  pack.facts.push({ kind: 'holding', data: { ...oldHolding.data, setId: newSet.setId, fundId: newSet.fundId } });
  await publish(await ready(await imported(repack(pack))), 7);
  const response = await historyQuery({ ...query, fundIds: newSet.fundId });
  assert.equal(response.series[0].points[0].missingReason, 'no_published_data');
  assert.deepEqual(response.series[0].points[0].sourceRefs, []);
  const detail = await dataQuery({ scopeId, date: days[0], fundIds: newSet.fundId, pin: response.pin });
  assert.equal(detail.funds.length, 0);
  assert(detail.missing.some(m => m.fundId === newSet.fundId && m.date === days[0]));
});
await check('schema2 wire-byte caps and duplicate-key rejection preserve legacy180KiB', async () => {
  const raw = '"'.repeat(120000);
  const manifest = { pages: [{ pageNo: 0, pageId: 'escaped-fixture-page', pageHash: await contentHash(raw), byteLength: Buffer.byteLength(raw) }],
    bodyBytes: Buffer.byteLength(raw), bodyHash: await contentHash(raw) };
  const created = await invoke('POST /api/admin/etf-reports/bodies', { requestId: rid('escaped-create'), reportId: 'fixture-escaped-report',
    baseRevision: 0, expectedPublishedVersion: 0, manifest });
  assert.equal(created.status, 200);
  const uploaded = await invoke('POST /api/admin/etf-reports/bodies/:id/pages', { requestId: rid('escaped-page'), pageNo: 0, content: raw }, { id: created.data.body.id });
  assert.equal(uploaded.status, 413);
  const { parseReportJson, MAX_REPORT_BYTES } = await import('../../shared/etf-contract.ts');
  assert.throws(() => parseReportJson(' '.repeat(MAX_REPORT_BYTES + 1)), /180/);
  assert.throws(() => parseReportJson('{"a":1,"a":2}' + ' '.repeat(MAX_REPORT_BYTES), contract.MAX_SNAPSHOT_BYTES), /重複/);
  assert.throws(() => parseReportJson('{"a":1,"\u0061":2}', contract.MAX_SNAPSHOT_BYTES), /重複/);
});


await check('private preview includes all source changes and cannot drift across filter/revision cursors', async () => {
  const saved = [...tables.values()].flatMap(m => [...m.values()]).find(r => r.manifest?.sets?.[0]?.sourceRevision === 'all-changes' && r.receivedChunks);
  const rows = []; let cursor;
  do { const response = await privatePreview(saved.id, cursor ? { cursor } : {});
    response.funds.forEach(f => rows.push(...f.reportedChanges)); cursor = response.nextCursor;
  } while (cursor);
  assert.equal(rows.length, 110);
  const first = await privatePreview(saved.id, {});
  await assert.rejects(privatePreview(saved.id, { cursor: first.nextCursor, fundId: 'fixture-fund' }), e => e.code === 'cursor_mismatch');
});
await check('unknown operation lock blocks cancellation until original receipt resolves', async () => {
  const pack = packageFor('2026-10-02', 1, 'pending-cancel');
  const created = await store.createBatch({ requestId: rid('create'), manifest: pack.manifest });
  const id = rid('pending-chunk'); control.writeFault = 'unknown-pending';
  await assert.rejects(store.uploadChunk(created.batch.id, { requestId: id, expectedRevision: 1, chunkNo: 0, facts: pack.chunks[0] }), e => e.code === 'outcome_unresolved');
  assert.equal((await store.requestStatus(id)).state, 'unresolved');
  await assert.rejects(store.cancelBatch(created.batch.id, { requestId: rid('cancel'), expectedRevision: 1 }), e => e.code === 'outcome_unresolved');
  assert.equal((await store.batchById(created.batch.id)).status, 'uploading');
});
await check('stable fund/security IDs survive immutable name and historical-code revisions', async () => {
  const before = await catalogQuery({ scopeId, date: days.at(-1) });
  const oldHead = await store.getHead(scopeId, days.at(-1));
  const oldPin = (await historyQuery(query)).pin;
  const pack = packageFor('2026-10-05', 1, 'renamed');
  pack.manifest.sets[0].fundIdentityRevision = 'identity-r2';
  pack.manifest.fundSelections[0].name = 'Fixture renamed fund';
  pack.manifest.fundSelections[0].code = '00999A';
  for (const fact of pack.facts) {
    if (fact.kind === 'fund') fact.data = { ...fact.data, identityRevision: 'identity-r2', name: 'Fixture renamed fund', code: '00999A' };
    if (fact.kind === 'security' && fact.data.securityId === 'fixture-stock-0') fact.data = {
      ...fact.data, identityRevision: 'identity-r2', name: 'Fixture renamed stock',
      identifiers: [{ code: '1000', market: 'TWSE', validFrom: '2020-01-01', validTo: '2026-10-05' },
        { code: '2000', market: 'TPEX', validFrom: '2026-10-05', validTo: null }],
    };
    if (fact.kind === 'holding') fact.data = { ...fact.data, sourceName: 'Fixture renamed stock', sourceMarket: 'TPEX', sourceCode: '2000', securityIdentityRevision: 'identity-r2' };
  }
  const result = await publish(await ready(await imported(repack(pack))), 8);
  assert.equal(result.version, 9);
  const after = await catalogQuery({ scopeId, date: days.at(-1) });
  assert.equal(after.stocks[0].securityId, before.stocks[0].securityId);
  assert.equal(after.stocks[0].code, '2000'); assert.equal(after.funds[0].fundId, 'fixture-fund');
  assert.equal(after.funds[0].code, '00999A');
  const old = await catalogQuery({ scopeId, date: days.at(-1), pin: oldPin });
  assert.equal(old.stocks[0].code, before.stocks[0].code);
  assert.equal((await store.getPublication(oldHead.publicationId)).version, 8);
  assert(table(contract.FACT_TABLES.security).has(await contract.key('fixture-stock-0', 'identity-r2')));
  assert.equal(table(contract.FACT_TABLES.security).get('fixture-stock-0').identifiers[0].code, '1000');
});
await check('enabled-only schema2 simulation publishes independently, reconstructs public pages and replays receipts', async () => {
  const enabled = await snapshotFixture(true);
  Object.assign(routes, enabled.makeEtfSnapshotRoutes(helpers));
  const body = [...table('etf_report_bodies_v2').values()].find(b => b.reportId === 'fixture-large-report');
  const requestId = rid('large-publish');
  control.writeFault = 'unknown-committed';
  const published = await invoke('POST /api/admin/etf-reports/bodies/:id/publish', {
    requestId, expectedRevision: body.revision, reviewHash: body.reviewHash, confirmed: true,
  }, { id: body.id });
  assert.equal(published.status, 200, JSON.stringify(published.data)); assert.equal(published.data.state, 'committed');
  const replay = await invoke('POST /api/admin/etf-reports/bodies/:id/publish', {
    requestId, expectedRevision: body.revision, reviewHash: body.reviewHash, confirmed: true,
  }, { id: body.id });
  assert.equal(replay.status, 200); assert.equal(replay.data.version, 1);
  const headerResponse = await readVersionedReport('fixture-large-report', '1'); assert.equal(headerResponse.statusCode, 200);
  const header = JSON.parse(headerResponse.body); assert.equal(header.schemaVersion, 2);
  const contents = [];
  for (const page of header.manifest.pages) {
    const response = await invoke('GET /api/etf/reports/:id/pages/:pageNo', {}, { id: 'fixture-large-report', pageNo: String(page.pageNo) }, { version: '1' });
    assert.equal(response.status, 200);
    assert.equal(await contentHash(response.data.content), page.pageHash); contents.push(response.data.content);
  }
  assert.equal(await contentHash(contents.join('')), header.manifest.bodyHash);
  assert.equal(Buffer.byteLength(contents.join('')), header.manifest.bodyBytes);
  const entry = await invoke('POST /api/admin/etf-reports/get', { id: 'fixture-large-report' });
  assert.equal(entry.data.entry.schemaVersion, 2); assert.equal(entry.data.entry.bodyId, body.id); assert.equal(entry.data.entry.draft, null);

  // Both fixture states are explicit, independent of the deployment source gate.
  const pack = packageFor('2026-10-05', 1, 'schema2-paired');
  pack.manifest.sets[0].fundIdentityRevision = 'identity-r2';
  pack.manifest.fundSelections[0].name = 'Fixture renamed fund'; pack.manifest.fundSelections[0].code = '00999A';
  pack.facts = pack.facts.filter(f => f.kind !== 'fund');
  const batch = await ready(await imported(repack(pack)));
  const publishRequestId = rid('schema2-paired-publish');
  const plan = await store.planPublication(batch.id, { requestId: publishRequestId, expectedHeadVersion: 9 });
  const report = { ...legacyReport('fixture-schema2-paired'), schemaVersion: 2, dataLineage: plan.dataLineage };
  report.funds[0].code = '00999A'; report.rows[0].etf = '00999A';
  const content = JSON.stringify(report);
  const manifest = { pages: [{ pageNo: 0, pageId: 'fixture-paired-body-page', pageHash: await contentHash(content), byteLength: Buffer.byteLength(content) }],
    bodyBytes: Buffer.byteLength(content), bodyHash: await contentHash(content) };
  const created = await invoke('POST /api/admin/etf-reports/bodies', { requestId: rid('paired-body'), reportId: report.id,
    baseRevision: 0, expectedPublishedVersion: 0, manifest });
  const bodyId = created.data.body.id;
  await invoke('POST /api/admin/etf-reports/bodies/:id/pages', { requestId: rid('paired-page'), pageNo: 0, content }, { id: bodyId });
  const validation = await invoke('POST /api/admin/etf-reports/bodies/:id/validate', { requestId: rid('paired-validate'), expectedRevision: 1 }, { id: bodyId });
  assert.equal(validation.status, 200);
  await invoke('POST /api/admin/etf-reports/bodies/:id/review', { requestId: rid('paired-review'), expectedRevision: 2,
    reviewHash: validation.data.body.reviewHash, acknowledged: true }, { id: bodyId });
  const publishedTogether = await store.publishBatch(batch.id, { requestId: publishRequestId, expectedRevision: batch.revision,
    expectedHeadVersion: 9, reviewHash: batch.reviewedPayloadHash, confirmed: true, report: { bodyId } }, enabled.prepareEtfReportCommit);
  assert.equal(publishedTogether.publicationId, plan.publicationId); assert.equal(publishedTogether.version, 10);
  assert.equal((await readVersionedReport(report.id, '1')).statusCode, 200);
  assert(publishedTogether.publication.reportSnapshotRefs.includes(report.id + '.v1'));
});


await check('grouped validation bounds reads and resumes partial private seals with the exact original request', async () => {
  const batch = await imported(packageFor('2026-10-02', 268, 'performance-partial'));
  const requestId = rid('validate-partial-resume');
  const input = { requestId, expectedRevision: batch.revision };
  const firstRead = control.getCalls.length;
  control.standaloneFaultTable = store.T.allocations;
  await assert.rejects(store.validateBatch(batch.id, input), e => e.code === 'AppDatabaseUnknownOutcome');
  assert.equal((await store.batchById(batch.id)).revision, batch.revision);
  assert.equal((await store.requestStatus(requestId)).state, 'unresolved');
  const memberId = await contract.key(batch.manifest.sets[0].setId, 0);
  const partialMember = structuredClone(table(store.T.members).get(memberId));
  assert(partialMember, 'Member page persisted before interrupted allocation seal');
  const firstCalls = control.getCalls.slice(firstRead);
  assert(firstCalls.some(call => call.count === 80), 'Uses bounded multi-ID reads');
  assert(firstCalls.every(call => call.count <= 80));
  assert(firstCalls.length < 60, 'Does not regress to one network read per fact');
  const resumeRead = control.getCalls.length;
  const resumed = await store.validateBatch(batch.id, input);
  assert.equal(resumed.state, 'committed'); assert.equal(resumed.batch.status, 'ready');
  assert.equal(resumed.batch.revision, batch.revision + 1);
  assert.deepEqual(table(store.T.members).get(memberId), partialMember);
  const sealed = await store.getSet(batch.manifest.sets[0].setId);
  assert.equal(sealed.sealedAt, batch.createdAt);
  assert.deepEqual((await store.validateBatch(batch.id, input)).batch.validation, resumed.batch.validation);
  const resumeCalls = control.getCalls.slice(resumeRead);
  assert(resumeCalls.length < 60); assert(resumeCalls.every(call => call.count <= 80));
  performanceEvidence.push({ facts: Object.values(batch.manifest.expectedCounts).reduce((sum, count) => sum + count, 0), interruptedReadCalls: firstCalls.length, resumedReadCallsIncludingReceiptReplay: resumeCalls.length, maxIdsPerRead: Math.max(...firstCalls.concat(resumeCalls).map(call => call.count)) });
  assert.equal((await dataQuery({ scopeId, date: '2026-10-02' })).publicationId,
    (await store.getHead(scopeId, '2026-10-02')).publicationId, 'Private validation did not replace public data');
});
await check('pending validation submission is not resubmitted, and concurrent original-ID preparation stays once-only', async () => {
  const batch = await imported(packageFor('2026-10-02', 1, 'validate-submission-pending'));
  const requestId = rid('validate-submission');
  const input = { requestId, expectedRevision: batch.revision };
  control.writeFault = 'unknown-pending';
  await assert.rejects(store.validateBatch(batch.id, input), e => e.code === 'outcome_unresolved');
  const callsBefore = control.getCalls.length; const commitsBefore = control.commits;
  await assert.rejects(store.validateBatch(batch.id, input), e => e.code === 'outcome_unresolved' && e.details.requestId === requestId);
  assert.equal(control.commits, commitsBefore, 'No new preparation or submission while original lock is pending');
  assert(control.getCalls.length - callsBefore <= 5, 'Pending result returns before rereading all facts');

  const concurrent = await imported(packageFor('2026-10-02', 1, 'validate-concurrent'));
  const sameRequest = { requestId: rid('validate-same-concurrent'), expectedRevision: concurrent.revision };
  const attempts = await Promise.allSettled([
    store.validateBatch(concurrent.id, sameRequest), store.validateBatch(concurrent.id, sameRequest),
  ]);
  assert(attempts.some(result => result.status === 'fulfilled'));
  attempts.filter(result => result.status === 'rejected').forEach(result =>
    assert(['outcome_unresolved', 'write_conflict'].includes(result.reason.code)));
  const reconciled = await store.validateBatch(concurrent.id, sameRequest);
  assert.equal(reconciled.state, 'committed'); assert.equal(reconciled.batch.revision, concurrent.revision + 1);
  assert.equal(table(store.T.receipts).get(sameRequest.requestId).revision, concurrent.revision + 1);
});

function pagedPerformancePackage() {
  const day = '2026-10-06';
  const pack = packageFor(day, 1, 'paged-performance');
  pack.facts = baseFacts(0).filter(f => ['source', 'session'].includes(f.kind));
  pack.manifest.sets = []; pack.manifest.selectedSetIds = [];
  pack.manifest.fundSelections = []; pack.manifest.sourceSelections = [];
  for (let n = 0; n < 18; n++) pack.facts.push({ kind: 'industry', data: {
    industryId: 'fixture-perf-industry-' + n, taxonomyId: 'fixture-perf-taxonomy', taxonomyVersion: 'v1',
    industryCode: String(n), label: 'Fixture performance industry ' + n,
    sourceDocumentId: source.sourceDocumentId, classificationType: 'official',
  } });
  for (let n = 0; n < 125; n++) {
    const securityId = 'fixture-perf-stock-' + String(n).padStart(3, '0');
    pack.facts.push({ kind: 'security', data: { securityId, name: 'Fixture performance stock ' + n, instrumentType: 'equity',
      identifiers: [{ code: 'OLD' + n, market: 'TWSE', validFrom: '2020-01-01', validTo: '2026-10-05' },
        { code: 'P' + n, market: 'TWSE', validFrom: '2026-10-05', validTo: null }] } });
    pack.facts.push({ kind: 'assignment', data: { assignmentId: 'fixture-perf-assignment-' + n, securityId,
      industryId: 'fixture-perf-industry-' + n % 18, taxonomyId: 'fixture-perf-taxonomy', taxonomyVersion: 'v1',
      sourceDocumentId: source.sourceDocumentId, validFrom: '2020-01-01', validTo: null, primary: true } });
  }
  let position = 0;
  for (let f = 0; f < 5; f++) {
    const fundId = 'fixture-perf-fund-' + f; const securityId = 'fixture-perf-etf-' + f;
    const setId = 'fixture-perf-set-' + f; const code = 'PERF' + f; const count = f < 3 ? 54 : 53;
    const fund = { fundId, securityId, code, name: 'Fixture performance fund ' + f };
    pack.manifest.fundSelections.push(fund); pack.manifest.selectedSetIds.push(setId);
    pack.manifest.sourceSelections.push({ fundId, setId, reason: 'Synthetic paging fixture' });
    pack.manifest.sets.push({ ...packageFor(day).manifest.sets[0], setId, fundId, expectedHoldings: count,
      sourceRevision: 'paged-performance', taxonomyId: 'fixture-perf-taxonomy' });
    pack.facts.push({ kind: 'security', data: { securityId, name: fund.name, instrumentType: 'active-etf',
      identifiers: [{ code, market: 'TWSE', validFrom: '2020-01-01', validTo: null }] } });
    pack.facts.push({ kind: 'fund', data: { ...fund, issuer: 'Fixture', domesticEquity: true, fundType: 'active', currency: 'TWD' } });
    pack.facts.push({ kind: 'metrics', data: { setId, fundId, sourceDocumentId: source.sourceDocumentId,
      aumNtd: evidence('10000000000'), navNtd: evidence('10'), fundUnits: evidence('1000000000'),
      aumAsOf: day, navAsOf: day, unitsAsOf: day } });
    for (let row = 0; row < count; row++) {
      const n = position++ % 125; const stock = 'fixture-perf-stock-' + String(n).padStart(3, '0');
      const industryId = 'fixture-perf-industry-' + n % 18;
      pack.facts.push({ kind: 'holding', data: { setId, fundId, securityId: stock, industryId,
        assignmentId: 'fixture-perf-assignment-' + n, sourceName: 'Fixture performance stock ' + n,
        sourceCode: 'RAW' + n, sourceMarket: 'TWSE', shares: evidence('100'), weightPct: evidence('0.1'),
        sourceDocumentId: source.sourceDocumentId, sourceRowKey: 'perf-row-' + row, assetKind: 'equity' } });
      if (row < (f === 4 ? 7 : 8)) pack.facts.push({ kind: 'change', data: { setId, fundId, securityId: stock, industryId,
        sourceDocumentId: source.sourceDocumentId, sourceRevision: 'paged-performance', startDate: '2026-10-05', endDate: day,
        sourceDate: day, deltaShares: evidence('100'), weightDeltaPp: evidence(null), estimateNtd: evidence('1000'),
        estimateMethod: 'Synthetic one-session estimate', priceAsOf: day } });
    }
  }
  return repack(pack);
}
await check('bounded public/private paging preserves 268 holdings,39 changes and125-stock/18-industry catalogue', async () => {
  const pack = pagedPerformancePackage();
  const batch = await ready(await imported(pack)); const published = await publish(batch);
  const expected = pack.manifest.sets.flatMap(s => [
    ...pack.facts.filter(f => f.kind === 'holding' && f.data.setId === s.setId)
      .sort((a, b) => a.data.securityId.localeCompare(b.data.securityId)).map(f => 'holding:' + s.fundId + ':' + f.data.securityId),
    ...pack.facts.filter(f => f.kind === 'change' && f.data.setId === s.setId).map(f => 'change:' + s.fundId + ':' + f.data.securityId),
  ]);
  const rowKeys = response => response.funds.flatMap(f => [
    ...f.holdings.map(r => 'holding:' + f.fund.fundId + ':' + r.securityId),
    ...f.reportedChanges.map(r => 'change:' + f.fund.fundId + ':' + r.securityId),
  ]);
  async function collect(load) {
    let cursor; const rows = []; const pages = []; const firstRead = control.getCalls.length;
    do {
      const response = await load(cursor); const keys = rowKeys(response); rows.push(...keys); pages.push(keys.length);
      assert(keys.length <= 100); assert(contract.bytes(response) <= contract.MAX_DATA_BYTES);
      cursor = response.nextCursor;
      if (cursor) assert.equal(JSON.parse(atob(cursor)).offset, rows.length);
    } while (cursor);
    const reads = control.getCalls.slice(firstRead); assert(reads.every(r => r.count <= 80));
    const holdingReads = reads.filter(r => r.table.startsWith(contract.FACT_TABLES.holding));
    assert(holdingReads.length <= 12, 'Holdings are read in bounded groups, not one call per fact');
    assert(holdingReads.reduce((n, r) => n + r.count, 0) <= 271, 'Later pages do not reread skipped holding prefixes');
    assert.deepEqual(pages, [100, 100, 100, 7]); assert.deepEqual(rows, expected);
    return { pages, holdingReadCalls: holdingReads.length, holdingIdsRead: holdingReads.reduce((n, r) => n + r.count, 0) };
  }
  const publicEvidence = await collect(cursor => dataQuery({ date: pack.manifest.requestedDate, ...(cursor ? { cursor } : {}) }));
  const privateEvidence = await collect(cursor => privatePreview(batch.id, cursor ? { cursor } : {}));
  const firstRead = control.getCalls.length; const stocks = new Map(); const industries = new Map(); let cursor; let pages = 0;
  do {
    const result = await catalogQuery({ date: pack.manifest.requestedDate, ...(cursor ? { cursor } : {}) });
    assert.equal(result.publicationId, published.publicationId); assert.equal(result.funds.length, 5);
    result.stocks.forEach(s => { assert.equal(s.code, 'P' + Number(s.securityId.slice(-3))); stocks.set(s.securityId, s); });
    result.industries.forEach(i => industries.set(i.industryId, i)); cursor = result.nextCursor; pages++;
  } while (cursor);
  assert.equal(pages, 4); assert.equal(stocks.size, 125); assert.equal(industries.size, 18);
  const identityReads = control.getCalls.slice(firstRead).filter(r => r.table === contract.FACT_TABLES.security);
  assert(identityReads.length <= 8); assert(identityReads.every(r => r.count <= 80));
  const selectedIndustry = 'fixture-perf-industry-0';
  const filtered = await dataQuery({ date: pack.manifest.requestedDate, industryId: selectedIndustry });
  assert.deepEqual(rowKeys(filtered), expected.filter(key => {
    const id = key.slice(key.lastIndexOf(':') + 1); return Number(id.slice(-3)) % 18 === 0;
  }));
  const stockId = 'fixture-perf-stock-000'; const master = table(contract.FACT_TABLES.security).get(stockId);
  table(contract.FACT_TABLES.security).delete(stockId);
  const fallback = await catalogQuery({ date: pack.manifest.requestedDate, stockId });
  assert.equal(fallback.stocks[0].code, 'RAW0', 'Missing master keeps the existing source-code fallback');
  table(contract.FACT_TABLES.security).set(stockId, master);
  const set = await store.getSet(pack.manifest.sets[0].setId);
  const physical = store.partition(contract.FACT_TABLES.holding, scopeId, set.requestedDate);
  const id = await contract.key(set.id, stockId); const saved = table(physical).get(id); table(physical).delete(id);
  await assert.rejects(dataQuery({ date: pack.manifest.requestedDate }), e => e.code === 'holding_integrity');
  table(physical).set(id, saved);
  performanceEvidence.push({ queryPaging: { public: publicEvidence, private: privateEvidence, catalogueIdentityReadCalls: identityReads.length } });
});
await check('holding batches stop on UTF8 byte budgets and keep the next cursor exact', async () => {
  const pack = packageFor('2026-10-07', 125, 'query-byte-budget');
  for (const fact of pack.facts.filter(f => f.kind === 'holding')) fact.data = { ...fact.data,
    sourceName: '測'.repeat(100), sourceMarket: '測'.repeat(50), sourceCode: 'x'.repeat(120),
    sourceRowKey: 'x'.repeat(100) + fact.data.securityId.slice(-3),
    shares: { ...evidence('100'), raw: '測'.repeat(200) }, weightPct: { ...evidence('0.1'), raw: '測'.repeat(200) } };
  const batch = await ready(await imported(repack(pack))); await publish(batch);
  for (const load of [cursor => dataQuery({ date: pack.manifest.requestedDate, ...(cursor ? { cursor } : {}) }),
    cursor => privatePreview(batch.id, cursor ? { cursor } : {})]) {
    const seen = []; let cursor; let page = 0;
    do {
      const before = control.getCalls.length; const response = await load(cursor);
      const rows = response.funds.flatMap(f => f.holdings); assert(rows.length > 0);
      if (page === 0) assert(rows.length < 100, 'UTF8 bytes, not only fact count, bound a page');
      assert(contract.bytes(response) <= contract.MAX_DATA_BYTES);
      const reads = control.getCalls.slice(before).filter(r => r.table.startsWith(contract.FACT_TABLES.holding));
      assert(reads.every(r => r.count <= 80)); assert(reads.reduce((n, r) => n + r.count, 0) <= 101);
      seen.push(...rows.map(r => r.securityId)); cursor = response.nextCursor;
      if (cursor) assert.equal(JSON.parse(atob(cursor)).offset, seen.length);
      page++;
    } while (cursor);
    assert.equal(seen.length, 125); assert.equal(new Set(seen).size, 125);
    assert.deepEqual(seen, [...seen].sort());
  }
});

await check('isolated synthetic21-session dataset verifies5/10/20 history, gaps, heatmap, correction pins and report separation', async () => {
  const { qaPackage, qaDays, qaFunds, qaStocks, qaIndustries } = await import('./etf-history-fixture.mjs');
  assert.equal(qaDays.length, 21);
  assert.notEqual(store.partition(contract.FACT_TABLES.holding, contract.QA_DATA_SCOPE, qaDays[20]),
    store.partition(contract.FACT_TABLES.holding, contract.DATA_SCOPE, qaDays[20]));
  const normal = await catalogQuery({ date: days.at(-1) });
  const pack = index => { const p = qaPackage(index); return { ...p, chunks: p.chunks.map(c => c.facts) }; };
  const bad = structuredClone(pack(0)); bad.manifest.fundSelections[0].fundId = 'fixture-fund';
  assert.throws(() => contract.parseManifest(bad.manifest));
  await assert.rejects(catalogQuery({ scopeId: 'unknown-scope' }), e => e.code === 'invalid_scope');
  const publications = [];
  for (let n = 0; n < 21; n++) {
    if (n === 17) continue;
    publications[n] = await publish(await ready(await imported(pack(n))));
  }
  const query = { scopeId: contract.QA_DATA_SCOPE, end: qaDays[20], level: 'stock',
    stockId: qaStocks[0], fundIds: qaFunds[0].fundId, metric: 'shares', basis: 'position_level' };
  let old;
  for (const window of [5, 10, 20]) {
    const response = await historyQuery({ ...query, window: String(window) });
    assert.equal(response.resolved.start, qaDays[20 - window]);
    assert.equal(response.resolved.dates.length, window + 1);
    assert(response.missing.some(m => m.date === qaDays[17] && m.reason === 'missing_intermediate'));
    const compare = await compareQuery({ ...query, window: String(window) });
    assert.equal(compare.endpointAvailable, true); assert.equal(compare.trendAvailable, false);
    assert.equal(compare.rows[0].delta.value, String(window * 1000));
    if (window === 20) old = response;
  }
  const realCalendar = pack(0); realCalendar.manifest.scopeId = contract.DATA_SCOPE;
  const realBatch = await imported(realCalendar);
  const realValidation = await store.validateBatch(realBatch.id, { requestId: rid('qa-calendar-denial'), expectedRevision: realBatch.revision });
  assert(realValidation.batch.validation.blockingErrors.includes('交易日曆需已核對官方來源。'));
  const beforeFill = old.pin;
  publications[17] = await publish(await ready(await imported(pack(17))));
  const pinned = await historyQuery({ ...query, window: '20', pin: beforeFill });
  assert.equal(pinned.series[0].points[17].value, null, 'Old null publication remains pinned after gap is filled');
  const complete = await historyQuery({ ...query, window: '20' });
  assert.equal(complete.series[0].points.length, 21);
  assert(complete.series[0].points.every(p => p.status === 'observed' && p.precision === 'exact'));
  const compare = await compareQuery({ ...query, window: '20' });
  assert.equal(compare.endpointAvailable, true); assert.equal(compare.trendAvailable, true);
  const readStart = control.getCalls.length;
  const allFive = await historyQuery({ ...query, window: '20', fundIds: qaFunds.map(f => f.fundId).join(',') });
  assert.equal(allFive.availableMetrics.find(m => m.metric === 'estimateNtd').available, true);
  assert(control.getCalls.slice(readStart).filter(r => r.table.startsWith(contract.FACT_TABLES.change)).length <= 2,
    'Metric availability stops once supported source evidence is found');
  const etfStart = control.getCalls.length;
  const etfAll = await historyQuery({ ...query, window: '20', level: 'etf', stockId: '', metric: 'aumNtd', fundIds: qaFunds.map(f => f.fundId).join(',') });
  assert.equal(etfAll.series.length, 5);
  assert.equal(control.getCalls.slice(etfStart).filter(r => r.table.startsWith(contract.FACT_TABLES.change)).length, 0,
    'ETF metrics never read unavailable stock-estimate evidence');
  assert.deepEqual(allFive.series.map(s => s.fundId), qaFunds.map(f => f.fundId));
  allFive.series.forEach((series, f) => {
    assert.deepEqual(series.points.map(p => p.date), qaDays);
    series.points.forEach((point, n) => assert.equal(point.value, String(10000 + f * 3000 + n * 1000)));
  });
  const delta = await historyQuery({ ...query, window: '20', basis: 'daily_delta' });
  assert(delta.series[0].points.slice(1).every(p => p.value === '1000'));
  const cumulative = await historyQuery({ ...query, window: '20', basis: 'eligible_cumulative' });
  assert.equal(cumulative.cumulativeEligibility.eligible, true);
  assert.equal(cumulative.series[0].points.at(-1).value, '20000');
  const heatmap = await historyQuery({ ...query, level: 'industry', stockId: '', metric: 'weightPct',
    basis: 'daily_delta', view: 'heatmap', window: '20' });
  assert.equal(heatmap.series.length, 3);
  assert.deepEqual(new Set(heatmap.series.map(s => s.industryId)), new Set(qaIndustries));
  assert(heatmap.series.some(s => s.points.some(p => p.value?.startsWith('-'))));
  assert(heatmap.series.some(s => s.points.some(p => p.value === '1')));
  const unknown = await historyQuery({ ...query, fundIds: qaFunds[4].fundId, stockId: qaStocks[2], window: '20' });
  assert.equal(unknown.series[0].points[12].value, null); assert.equal(unknown.series[0].points[12].status, 'unknown');
  const zero = await historyQuery({ ...query, stockId: qaStocks[2], window: '20' });
  assert.equal(zero.series[0].points[5].value, '0'); assert.equal(zero.series[0].points[5].precision, 'exact');
  const weekend = await historyQuery({ ...query, end: '2026-10-11', window: '5' });
  assert.equal(weekend.resolved.end, '2026-10-09'); assert(weekend.warnings.some(w => w.includes('非交易日')));
  const correctPack = qaPackage(20, 'v2', 500); correctPack.chunks = correctPack.chunks.map(c => c.facts);
  const corrected = await ready(await imported(correctPack));
  await assert.rejects(publish(corrected, 1, { report: { id: 'must-not-publish' } }), e => e.code === 'qa_report_forbidden');
  await publish(corrected, 1);
  const oldData = await dataQuery({ scopeId: contract.QA_DATA_SCOPE, date: qaDays[20], pin: complete.pin, fundIds: qaFunds[0].fundId });
  assert.equal(oldData.funds[0].holdings.find(h => h.securityId === qaStocks[0]).shares.value, '30000');
  const newData = await dataQuery({ scopeId: contract.QA_DATA_SCOPE, date: qaDays[20], fundIds: qaFunds[0].fundId });
  assert.equal(newData.funds[0].holdings.find(h => h.securityId === qaStocks[0]).shares.value, '30500');
  assert(newData.warnings.some(w => w.includes('合成測試')));
  await assert.rejects(dataQuery({ scopeId: contract.DATA_SCOPE, date: qaDays[20], pin: complete.pin }),
    e => e.code === 'invalid_pin');
  assert.deepEqual(await catalogQuery({ date: days.at(-1) }), normal, 'Default dataset and latest catalog never change');
});

console.log(JSON.stringify({ passed: passed.length, cases: passed, maxTransactionActions: control.actions,
  commits: control.commits, performanceEvidence, publicHistoryListScans: control.listCalls.filter(n => !n.includes('batches')).length, tables: tables.size }, null, 2));
