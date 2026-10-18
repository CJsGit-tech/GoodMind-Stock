import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

export async function runEtfTests(contractSource, backendSource) {
  const tables = new Map();
  const log = [];
  let writeFault = null;
  let readFault = null;
  let transactions = 0;
  const clone = value => structuredClone(value);
  const table = (all, name) => {
    if (!all.has(name)) all.set(name, new Map());
    return all.get(name);
  };
  const databaseError = code => Object.assign(new Error('Injected database failure'), {
    code,
    statusCode: code === 'AppDatabaseQuotaExceeded' ? 429 : 503,
    details: {},
  });
  function apply(all, operation) {
    const records = table(all, operation.table);
    return operation.items.map(item => {
      if (operation.kind === 'add') {
        if (records.has(item.id)) throw databaseError('AppDatabaseDuplicateId');
        records.set(item.id, clone(item));
        return item.id;
      }
      const existing = records.get(item.id);
      if (!existing && operation.patch) throw databaseError('AppDatabaseConditionFailed');
      if (item.if && Object.entries(item.if).some(([key, value]) => existing?.[key] !== value)) {
        throw databaseError('AppDatabaseConditionFailed');
      }
      records.set(item.id, operation.patch
        ? { ...existing, ...clone(item.record) }
        : clone(item.record));
      return true;
    });
  }
  const handle = (kind, tableName, items, patch = false) => {
    const operation = { kind, table: tableName, items, patch, consumed: false };
    return {
      operation,
      then(resolveValue, rejectValue) {
        if (operation.consumed) return Promise.reject(new Error('Handle consumed')).then(resolveValue, rejectValue);
        operation.consumed = true;
        return Promise.resolve().then(() => apply(tables, operation)).then(resolveValue, rejectValue);
      },
    };
  };
  const db = {
    tx: {
      add: (name, items) => handle('add', name, items),
      update: (name, items, options) => handle('update', name, items, options?.patch === true),
    },
    async transact(handles) {
      transactions += 1;
      assert(handles.every(value => !value.operation.consumed), 'Transaction handles must be unconsumed');
      const targets = handles.flatMap(value => value.operation.items.map(item => value.operation.table + '/' + item.id));
      assert.equal(new Set(targets).size, targets.length, 'No duplicate physical targets');
      handles.forEach(value => { value.operation.consumed = true; });
      await Promise.resolve();
      const mode = writeFault;
      writeFault = null;
      if (mode === 'unknown-pending') throw databaseError('AppDatabaseUnknownOutcome');
      if (mode === 'quota') throw databaseError('AppDatabaseQuotaExceeded');
      if (mode === 'condition-once') throw databaseError('AppDatabaseConditionFailed');
      if (mode === 'gateway-unresolved') throw databaseError('AppDatabaseGatewayUnavailable');
      const staged = clone(tables);
      const results = handles.map(value => apply(staged, value.operation));
      tables.clear();
      for (const [name, rows] of staged) tables.set(name, rows);
      log.push({ kind: 'transact', targets });
      if (mode === 'unknown-committed') throw databaseError('AppDatabaseUnknownOutcome');
      if (mode === 'gateway-committed') throw databaseError('AppDatabaseGatewayUnavailable');
      return results;
    },
    async get(name, ids, options) {
      assert.equal(options?.consistent, true, 'Reconciliation reads must be consistent');
      log.push({ kind: 'get', name, ids });
      if (readFault) {
        const mode = readFault;
        readFault = null;
        throw databaseError(mode);
      }
      return ids.map(id => clone(table(tables, name).get(id) ?? null));
    },
    async list(name, options) {
      if (readFault) {
        const mode = readFault;
        readFault = null;
        throw databaseError(mode);
      }
      const values = [...table(tables, name)].map(([id, record]) => ({ ...clone(record), id }));
      const offset = Number(options.nextToken ?? 0);
      return {
        items: values.slice(offset, offset + options.limit),
        nextToken: offset + options.limit < values.length ? String(offset + options.limit) : undefined,
      };
    },
  };
  const transform = source => stripTypeScriptTypes(source)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
    .replace(/\bexport /g, '');
  const contract = new Function(
    transform(contractSource) +
    '\nreturn { validateReport, parseReportJson, MAX_REPORT_BYTES, isReportId, isRequestId, jsonByteSize };'
  )();
  const json = (data, statusCode = 200) => ({
    statusCode,
    body: JSON.stringify(data),
    headers: {},
  });
  const error = (message, statusCode = 500) => json({ error: message }, statusCode);
  const isAppDatabaseError = value => typeof value?.code === 'string' && value.code.startsWith('AppDatabase');
  const backend = new Function(
    'db', 'json', 'error', 'isAppDatabaseError', 'crypto', 'isMarkdownStorage', 'readPublishedMarkdown', 'etfCoverDescriptor',
    ...Object.keys(contract),
    transform(backendSource) + '\nreturn { makeEtfRoutes };'
  )(db, json, error, isAppDatabaseError, webcrypto, value => value?.storageSchemaVersion === 3, async () => null, async () => null, ...Object.values(contract));
  const routes = backend.makeEtfRoutes({
    requireAdmin: async (_event, body) => body?.sessionToken === 'fixture-session' ? { id: 'fixture-author-session' } : null,
    isSameOriginMutation: event => event?.trustedOrigin === true,
  });
  const context = (body = {}, params = {}, query = {}, trustedOrigin = true) => ({
    body: { ...body, sessionToken: 'fixture-session' },
    params,
    query,
    event: { trustedOrigin },
  });
  const invoke = async (path, body = {}, params = {}, query = {}) => {
    const response = await routes[path][0](context(body, params, query));
    return { status: response.statusCode, data: JSON.parse(response.body) };
  };
  const fixture = (id = 'fixture-report') => {
    const funds = ['00981A', '00403A', '00991A', '00406A', '00982A'];
    const count = [5, 6, 4, 23, 1];
    const sizes = [291.24, 143.54, 78, 65.73, 51.64];
    return {
      schemaVersion: 1,
      id,
      reportType: 'flows',
      title: 'Synthetic backend fixture',
      excerpt: 'Test fixture only; never seeded or published by a GET.',
      period: { start: '2026-10-12', end: '2026-10-13' },
      evidenceDate: '2026-10-14',
      funds: funds.map((code, index) => ({
        code,
        name: 'Fixture ' + code,
        aumBillion: sizes[index],
        rankAsOf: '2026-10-13 上午',
        holdingsDate: '2026-10-13',
        coverage: 'Synthetic partial list',
        sourceUrl: 'https://example.com/fund/' + code,
      })),
      rows: funds.flatMap((etf, index) => Array.from({ length: count[index] }, (_value, row) => ({
        etf,
        code: String(1000 + index * 100 + row),
        name: 'Fixture stock',
        sector: 'Fixture sector',
        deltaLots: row % 2 === 0 ? 10 : -10,
        weightDeltaPp: null,
        estimateNtd: null,
        sourceUrl: 'https://example.com/flow/' + etf,
        sourceDate: '2026-10-13',
      }))),
      summary: [{ title: 'Fixture analysis', text: 'Partial holdings changes are not executed trades.', sources: [{
        label: 'Fixture source',
        url: 'https://example.com/analysis',
        eventDate: '2026-10-14',
      }] }],
      operations: [{
        code: '1000',
        name: 'Fixture stock',
        metrics: [{ label: 'Fixture metric', value: 'Unknown', period: '2026-10' }],
        eventDate: '2026-10-14',
        sourceUrl: 'https://example.com/operation',
      }],
      sampleNote: 'Synthetic test data, not a live report.',
      warnings: ['Official reconciliation is not claimed.'],
    };
  };
  const report = fixture();
  const checked = contract.validateReport(JSON.stringify(report));
  assert(checked.report);
  assert.deepEqual(Object.values(checked.counts), [5, 6, 4, 23, 1]);
  assert.equal(checked.report.funds[0].aumBillion, 291.24);
  assert.equal(checked.report.rows.length, 39);
  assert(!('holdings' in checked.report));
  assert(!('institutional' in checked.report));
  const fewerRows = fixture();
  fewerRows.rows = fewerRows.rows.slice(0, 2);
  assert(contract.validateReport(fewerRows).report, 'No hardcoded 39-row requirement');
  const unknown = fixture();
  unknown.funds[0].aumBillion = null;
  unknown.rows[0].deltaLots = null;
  const unknownValidation = contract.validateReport(unknown);
  assert(unknownValidation.report);
  assert(unknownValidation.warnings.length > 1);
  assert.equal(unknownValidation.report.rows[0].deltaLots, null);
  assert.throws(() => contract.parseReportJson('{"id":"a","i\\u0064":"b"}'), /重複/);
  assert.throws(() => contract.parseReportJson('{"nested":{"key":1,"key":2}}'), /重複/);
  assert.throws(() => contract.parseReportJson('{"__proto__":{}}'), /不允許/);
  assert.throws(() => contract.parseReportJson('{"a":1} trailing'), /多餘/);
  assert.throws(() => contract.parseReportJson('[[[[['.repeat(10) + '0' + ']]]]]'.repeat(10)), /層數/);
  assert.equal(contract.validateReport('{"bad":').report, undefined);
  const invalidDate = fixture();
  invalidDate.period.end = '2026-02-30';
  assert(contract.validateReport(invalidDate).errors.some(value => value.includes('日期不存在')));
  const wrongUnit = fixture();
  wrongUnit.rows[0].deltaLots = '10 lots';
  assert(contract.validateReport(wrongUnit).errors.length);
  const duplicate = fixture();
  duplicate.rows.push(clone(duplicate.rows[0]));
  assert(contract.validateReport(duplicate).errors.some(value => value.includes('唯一鍵')));
  const multipleSector = fixture();
  multipleSector.rows[5].code = multipleSector.rows[0].code;
  multipleSector.rows[5].sector = 'Different primary sector';
  assert(contract.validateReport(multipleSector).errors.some(value => value.includes('主分組')));
  const unsafeUrl = fixture();
  unsafeUrl.rows[0].sourceUrl = 'javascript:alert(1)';
  assert(contract.validateReport(unsafeUrl).errors.length);
  const rawHtml = fixture();
  rawHtml.summary[0].text = '<script>alert(1)</script>';
  assert(contract.validateReport(rawHtml).errors.length);
  const cache = fixture();
  cache.counts = { '00981A': 99 };
  assert(contract.validateReport(cache).errors.length);
  const extra = fixture();
  extra.arbitraryPrivateField = 'not retained';
  assert(!('arbitraryPrivateField' in contract.validateReport(extra).report));
  const optional = fixture();
  optional.holdings = [{
    etf: '00981A', date: '2026-10-13', sourceUrl: 'https://example.com/holdings', note: '',
    rows: [{ code: '1000', name: 'Fixture', sector: 'Fixture sector', market: 'TWSE', weightPct: 10, weightUpperBoundPct: null, weightRaw: '10%', shares: 1000 }],
  }];
  optional.institutional = {
    date: '2026-10-13', marketScope: 'Fixture market', marketUnit: 'TWD', stockUnit: 'shares',
    market: { foreign: null, trust: null, dealer: null, hedge: null, total: null },
    stocks: [], sources: [],
  };
  assert(contract.validateReport(optional).report);
  optional.holdings[0].currentComplete = true;
  optional.holdings[0].baseline = {
    date: '2026-10-12', sourceUrl: 'https://example.com/baseline', complete: true,
    rows: [{ code: '1000', name: 'Fixture', sector: 'Fixture sector', market: 'TWSE', weightPct: 9, weightUpperBoundPct: null, weightRaw: '9%', shares: 900 }],
  };
  assert(contract.validateReport(optional).report);
  optional.holdings[0].baseline.date = '2026-10-13';
  assert(contract.validateReport(optional).errors.some(value => value.includes('早於')));
  optional.holdings[0].baseline.date = '2026-10-12';
  optional.holdings[0].baseline.rows.push(clone(optional.holdings[0].baseline.rows[0]));
  assert(contract.validateReport(optional).errors.some(value => value.includes('持股代碼重複')));
  optional.holdings[0].baseline.rows.pop();
  optional.holdings[0].baseline.sourceUrl = 'javascript:alert(1)';
  assert(contract.validateReport(optional).errors.length);
  optional.holdings[0].baseline.sourceUrl = 'https://example.com/baseline';
  optional.institutional.marketUnit = 'billion';
  assert(contract.validateReport(optional).errors.length);
  const beforeReadWrites = transactions;
  assert.deepEqual((await invoke('GET /api/etf/reports')).data.items, []);
  assert.equal(transactions, beforeReadWrites, 'GET must not seed or publish');
  const privatePaths = Object.keys(routes).filter(path => path.startsWith('POST /api/admin'));
  for (const path of privatePaths) {
    const denied = await routes[path][0]({ ...context(), body: {} });
    assert.equal(denied.statusCode, 401, path);
    const crossOrigin = await routes[path][0](context({}, {}, {}, false));
    assert.equal(crossOrigin.statusCode, 403, path);
  }
  const validation = await invoke('POST /api/admin/etf-reports/validate', { report: JSON.stringify(report) });
  assert.equal(validation.status, 200);
  const duplicateJson = JSON.stringify(report).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.equal((await invoke('POST /api/admin/etf-reports/validate', { report: duplicateJson })).status, 200);
  const saved = await invoke('POST /api/admin/etf-reports/save', {
    report: JSON.stringify(report), baseRevision: 0, requestId: 'save-fixture-0001',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.entry.revision, 1);
  assert.equal(saved.data.entry.publishedVersion, 0);
  assert.equal(saved.data.entry.hasUnpublishedChanges, true);
  assert.equal((await invoke('GET /api/etf/reports/:id', {}, { id: report.id })).status, 404);
  assert.equal((await invoke('POST /api/admin/etf-reports/get', { id: report.id })).data.entry.draft.rows.length, 39);
  const sameSave = await invoke('POST /api/admin/etf-reports/save', {
    report: JSON.stringify(report), baseRevision: 0, requestId: 'save-fixture-0001',
  });
  assert.deepEqual(sameSave.data, saved.data, 'Save retry returns receipt result');
  const changedRequestPayload = clone(report);
  changedRequestPayload.title = 'Different payload';
  assert.equal((await invoke('POST /api/admin/etf-reports/save', {
    report: changedRequestPayload, baseRevision: 0, requestId: 'save-fixture-0001',
  })).status, 409);
  assert.equal((await invoke('POST /api/admin/etf-reports/publish', {
    id: report.id, baseRevision: 1, requestId: 'publish-fixture-0001', reviewed: false,
  })).status, 400);
  const published = await invoke('POST /api/admin/etf-reports/publish', {
    id: report.id, baseRevision: 1, requestId: 'publish-fixture-0001', reviewed: true,
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.entry.publishedVersion, 1);
  assert.equal(published.data.entry.hasUnpublishedChanges, false);
  assert.deepEqual((await invoke('POST /api/admin/etf-reports/publish', {
    id: report.id, baseRevision: 1, requestId: 'publish-fixture-0001', reviewed: true,
  })).data, published.data);
  const publicVersion1 = (await invoke('GET /api/etf/reports/:id', {}, { id: report.id })).data;
  assert.equal(publicVersion1.version, 1);
  assert(!('draft' in publicVersion1));
  assert(!('entry' in publicVersion1));
  const revision = clone(report);
  revision.title = 'Revised private draft';
  const revised = await invoke('POST /api/admin/etf-reports/save', {
    report: revision, baseRevision: 1, requestId: 'save-fixture-0002',
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.data.entry.revision, 2);
  assert.equal(revised.data.entry.hasUnpublishedChanges, true);
  assert.deepEqual((await invoke('GET /api/etf/reports/:id', {}, { id: report.id })).data, publicVersion1);
  assert.equal((await invoke('POST /api/admin/etf-reports/save', {
    report, baseRevision: 1, requestId: 'save-fixture-stale',
  })).status, 409);
  const published2 = await invoke('POST /api/admin/etf-reports/publish', {
    id: report.id, baseRevision: 2, requestId: 'publish-fixture-0002', reviewed: true,
  });
  assert.equal(published2.status, 200);
  assert.equal(published2.data.entry.publishedVersion, 2);
  assert.equal((await invoke('GET /api/etf/reports/:id', {}, { id: report.id })).data.report.title, revision.title);
  assert.equal(table(tables, 'etf_report_snapshots_v1').get(report.id + '.v1').report.title, report.title);
  const concurrencyA = clone(revision);
  const concurrencyB = clone(revision);
  concurrencyA.title = 'Concurrent A';
  concurrencyB.title = 'Concurrent B';
  const concurrent = await Promise.all([
    invoke('POST /api/admin/etf-reports/save', { report: concurrencyA, baseRevision: 2, requestId: 'concurrent-save-A' }),
    invoke('POST /api/admin/etf-reports/save', { report: concurrencyB, baseRevision: 2, requestId: 'concurrent-save-B' }),
  ]);
  assert.deepEqual(concurrent.map(value => value.status).sort(), [200, 409]);
  assert.equal((await invoke('POST /api/admin/etf-reports/get', { id: report.id })).data.entry.revision, 3);
  assert.equal((await invoke('GET /api/etf/reports/:id', {}, { id: report.id })).data.version, 2);
  for (const mode of ['unknown-committed', 'gateway-committed', 'condition-once']) {
    writeFault = mode;
    const result = await invoke('POST /api/admin/etf-reports/save', {
      report: fixture('fixture-' + mode), baseRevision: 0, requestId: 'save-' + mode,
    });
    assert.equal(result.status, 200, mode);
    assert.equal((await invoke('POST /api/admin/etf-reports/status', {
      requestId: 'save-' + mode,
    })).data.state, 'applied');
  }
  const beforeUnresolved = transactions;
  writeFault = 'unknown-pending';
  const unresolved = await invoke('POST /api/admin/etf-reports/save', {
    report: fixture('fixture-pending'), baseRevision: 0, requestId: 'save-pending-fixture',
  });
  assert.equal(unresolved.status, 503);
  assert.equal(unresolved.data.state, 'unresolved');
  assert.equal(transactions, beforeUnresolved + 1, 'Unknown outcomes must not be blindly retried');
  assert.deepEqual((await invoke('POST /api/admin/etf-reports/status', {
    requestId: 'save-pending-fixture',
  })).data, { requestId: 'save-pending-fixture', state: 'unresolved' });
  const publishPendingId = 'fixture-publish-pending';
  await invoke('POST /api/admin/etf-reports/save', {
    report: fixture(publishPendingId), baseRevision: 0, requestId: 'save-publish-pending',
  });
  const beforePendingPublish = transactions;
  writeFault = 'unknown-pending';
  assert.equal((await invoke('POST /api/admin/etf-reports/publish', {
    id: publishPendingId, baseRevision: 1, requestId: 'publish-pending-request', reviewed: true,
  })).status, 503);
  assert.equal(transactions, beforePendingPublish + 1);
  assert.equal((await invoke('GET /api/etf/reports/:id', {}, { id: publishPendingId })).status, 404);
  const concurrentPublishId = 'fixture-concurrent-publish';
  await invoke('POST /api/admin/etf-reports/save', {
    report: fixture(concurrentPublishId), baseRevision: 0, requestId: 'save-concurrent-publish',
  });
  const concurrentPublish = await Promise.all([
    invoke('POST /api/admin/etf-reports/publish', {
      id: concurrentPublishId, baseRevision: 1, requestId: 'publish-concurrent-A', reviewed: true,
    }),
    invoke('POST /api/admin/etf-reports/publish', {
      id: concurrentPublishId, baseRevision: 1, requestId: 'publish-concurrent-B', reviewed: true,
    }),
  ]);
  assert.deepEqual(concurrentPublish.map(value => value.status).sort(), [200, 409]);
  assert.equal((await invoke('GET /api/etf/reports/:id', {}, { id: concurrentPublishId })).data.version, 1);
  const unknownPublishedId = 'fixture-publish-unknown-committed';
  await invoke('POST /api/admin/etf-reports/save', {
    report: fixture(unknownPublishedId), baseRevision: 0, requestId: 'save-unknown-published',
  });
  writeFault = 'unknown-committed';
  const recoveredPublish = await invoke('POST /api/admin/etf-reports/publish', {
    id: unknownPublishedId, baseRevision: 1, requestId: 'publish-unknown-committed', reviewed: true,
  });
  assert.equal(recoveredPublish.status, 200);
  assert.equal(recoveredPublish.data.entry.publishedVersion, 1);
  assert.equal((await invoke('POST /api/admin/etf-reports/status', {
    requestId: 'publish-unknown-committed',
  })).data.entry.publishedVersion, 1);
  const beforeQuota = transactions;
  writeFault = 'quota';
  assert.equal((await invoke('POST /api/admin/etf-reports/save', {
    report: fixture('fixture-quota'), baseRevision: 0, requestId: 'save-quota-fixture',
  })).status, 429);
  assert.equal(transactions, beforeQuota + 1, 'Quota errors must surface without retry');
  readFault = 'AppDatabaseReadIncomplete';
  assert.equal((await invoke('POST /api/admin/etf-reports/get', { id: report.id })).status, 200);
  const tooLarge = context({ report: 'x'.repeat(contract.MAX_REPORT_BYTES), baseRevision: 0, requestId: 'large-request-id' });
  assert.equal((await routes['POST /api/admin/etf-reports/save'][0](tooLarge)).statusCode, 413);
  const oversizedNativeBody = context({ report });
  oversizedNativeBody.event.body = 'x'.repeat(contract.MAX_REPORT_BYTES + 1);
  assert.equal((await routes['POST /api/admin/etf-reports/validate'][0](oversizedNativeBody)).statusCode, 413);
  const oversizedBase64Body = context({ report });
  oversizedBase64Body.event.body = Buffer.from(' '.repeat(contract.MAX_REPORT_BYTES + 1)).toString('base64');
  oversizedBase64Body.event.isBase64Encoded = true;
  assert.equal((await routes['POST /api/admin/etf-reports/validate'][0](oversizedBase64Body)).statusCode, 413);
  assert.equal((await invoke('POST /api/admin/etf-reports/list', { nextToken: 'x'.repeat(4097) })).status, 400);
  for (let index = 0; index < 21; index += 1) {
    const id = 'fixture-page-' + index;
    await invoke('POST /api/admin/etf-reports/save', { report: fixture(id), baseRevision: 0, requestId: 'save-page-' + index });
    await invoke('POST /api/admin/etf-reports/publish', { id, baseRevision: 1, requestId: 'publish-page-' + index, reviewed: true });
  }
  const publicPage = await invoke('GET /api/etf/reports');
  assert.equal(publicPage.data.items.length, 20);
  assert(publicPage.data.nextToken);
  const secondPage = await invoke('GET /api/etf/reports', {}, {}, { nextToken: publicPage.data.nextToken });
  assert(secondPage.data.items.length > 0);
  assert(publicPage.data.items.every(value => !('draft' in value) && !('snapshotId' in value)));
  const privatePage = await invoke('POST /api/admin/etf-reports/list');
  assert.equal(privatePage.data.items.length, 4);
  assert(privatePage.data.nextToken);
  assert([...table(tables, 'etf_request_receipts_v1').values()].every(value => !('entry' in value) && !('draft' in value)), 'Receipts store identity and revision, not large report copies');
  assert(!JSON.stringify([...tables]).includes('fixture-session'), 'Never persist session tokens');
  assert(!JSON.stringify([...tables]).includes('fixture-author-session'), 'Receipts must survive re-login');
  const tx = db.tx;
  db.tx = undefined;
  assert.equal((await invoke('POST /api/admin/etf-reports/save', {
    report: fixture('missing-capability'), baseRevision: 0, requestId: 'missing-capability-save',
  })).data.errorCode, 'transaction_capability_unavailable');
  db.tx = tx;
  return {
    passed: true,
    routes: Object.keys(routes),
    transactions,
    checks: 'Raw duplicate-key parsing; dates/units/URLs/HTML/primary groups; unknown null preservation; optional extension validation; 39-derived rows and no fixed39 limit; no GET seed; author/origin guards; private durable draft; immutable snapshots; stale/concurrent revision conflict; save/publish receipts; unresolved recovery; bounded known-abort retry; quota guard; consistent read retry; 180KiB request/native limits; cursor/pagination; session redaction; runtime tx capability guard.',
  };
}

// Backend-only harness: read AppDeploy's generated source snapshot when supplied.
// No live API calls or credentials are used.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(process.argv[2] ?? '.');
  const result = await runEtfTests(
    readFileSync(resolve(root, 'shared/etf-contract.ts'), 'utf8'),
    readFileSync(resolve(root, 'backend/etf-reports.ts'), 'utf8')
  );
  console.log('PASS ETF report backend:', result);
}

