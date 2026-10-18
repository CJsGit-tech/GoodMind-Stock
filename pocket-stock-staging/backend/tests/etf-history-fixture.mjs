// Deterministic STAGING-only synthetic dataset; no real ETFs, stocks or market calendar.
import { createHash } from 'node:crypto';
import { QA_DATA_SCOPE } from '../../shared/etf-data-contract.ts';
export const QA_RUN = 'qa-history-20261015-v1';
export const QA_END = '2026-10-13';
export const qaDays = [];
for (let t = Date.parse('2026-09-14T00:00:00Z'); t <= Date.parse(QA_END + 'T00:00:00Z'); t += 86400000) {
  const day = new Date(t).toISOString().slice(0, 10);
  if (![0, 6].includes(new Date(t).getUTCDay()) && day !== '2026-09-30') qaDays.push(day);
}
export const qaFunds = Array.from({ length: 5 }, (_, f) => ({
  fundId: 'qa-fund-' + (f + 1), securityId: 'qa-etf-' + (f + 1),
  code: 'QA00' + (f + 1) + 'A', name: '測試基金' + ['甲', '乙', '丙', '丁', '戊'][f],
}));
export const qaStocks = ['qa-stock-1', 'qa-stock-2', 'qa-stock-3'];
export const qaIndustries = ['qa-industry-1', 'qa-industry-2', 'qa-industry-3'];
export const qaDecimal = value => ({ value: value === null ? null : String(value),
  raw: value === null ? '' : String(value), precision: value === null ? 'unknown' : 'exact',
  upperBound: null, upperInclusive: false });
export function qaShares(f, stock, n) {
  if (f === 4 && stock === 2 && n === 12) return null;
  if (stock === 0) return 10000 + f * 3000 + n * 1000;
  if (stock === 1) return 12000 + f * 1000 - n * 200;
  return f === 0 && n === 5 ? 0 : 5000 + f * 500 + (n % 4) * 250;
}
export function qaWeight(f, stock, n) {
  const first = 40 + f * 2 + n;
  const second = f === 0 && n === 5 ? 100 - first : 35 - f - Math.floor(n / 2);
  return [first, second, 100 - first - second][stock];
}
const source = {
  sourceDocumentId: 'qa-source-history-20261015-v1', provider: '合成測試資料，非真實基金／股票／交易日曆',
  url: 'https://pocketstocks-staging-3nv7e2.v2.appdeploy.ai/#/active-etf/history?dataset=synthetic',
  declaredDate: null, valuationDate: null, retrievedAt: '2026-10-15T04:50:00Z',
  contentHash: createHash('sha256').update(JSON.stringify({ version: QA_RUN, days: qaDays, funds: qaFunds, stocks: qaStocks, industries: qaIndustries })).digest('hex'),
  officialStatus: 'unverified', synthetic: true, generatorVersion: QA_RUN,
  hashScope: 'SHA256 of JSON.stringify({version,days,funds,stocks,industries}) for this deterministic fixture; not a fetched website',
};
function commonFacts() {
  return [
    { kind: 'source', data: source },
    ...qaFunds.flatMap(f => [
      { kind: 'security', data: { securityId: f.securityId, name: f.name, instrumentType: 'active-etf',
        identifiers: [{ code: f.code, market: 'QA', validFrom: '2026-01-01', validTo: null }] } },
      { kind: 'fund', data: { ...f, issuer: '虛構測試發行公司', domesticEquity: true, fundType: 'active', currency: 'TWD' } },
    ]),
    ...qaStocks.flatMap((id, s) => [
      { kind: 'security', data: { securityId: id, name: ['測試半導體股', '測試零組件股', '測試週邊股'][s], instrumentType: 'equity',
        identifiers: [{ code: 'QAST' + (s + 1), market: 'QA', validFrom: '2026-01-01', validTo: null }] } },
      { kind: 'industry', data: { industryId: qaIndustries[s], taxonomyId: 'qa-taxonomy', taxonomyVersion: 'qa-v1',
        industryCode: 'QA' + (s + 1), label: ['測試半導體', '測試電子零組件', '測試電腦週邊'][s],
        sourceDocumentId: source.sourceDocumentId, classificationType: 'research' } },
      { kind: 'assignment', data: { assignmentId: 'qa-assignment-' + (s + 1), securityId: id,
        industryId: qaIndustries[s], taxonomyId: 'qa-taxonomy', taxonomyVersion: 'qa-v1',
        sourceDocumentId: source.sourceDocumentId, validFrom: '2026-01-01', validTo: null, primary: true } },
    ]),
    ...qaDays.map((day, n) => ({ kind: 'session', data: { calendarId: 'qa-calendar', calendarVersion: 'qa-v1',
      date: day, isTradingDay: true, sessionOrdinal: 100 + n, previousSessionDate: qaDays[n - 1] || null,
      calendarCoveredThrough: QA_END, sourceDocumentId: source.sourceDocumentId } })),
    ...['2026-09-30', '2026-10-11'].map(day => ({ kind: 'session', data: {
      calendarId: 'qa-calendar', calendarVersion: 'qa-v1', date: day, isTradingDay: false,
      sessionOrdinal: null, previousSessionDate: qaDays.filter(d => d < day).at(-1),
      calendarCoveredThrough: QA_END, closureReason: '合成停市測試，非官方假日資料',
      sourceDocumentId: source.sourceDocumentId,
    } })),
  ];
}
export function qaPackage(n, revision = 'v1', correction = 0) {
  if (!Number.isInteger(n) || !qaDays[n]) throw new Error('Synthetic session index out of range');
  const day = qaDays[n];
  const sets = qaFunds.map(f => ({
    setId: 'qa-set-' + day + '-' + f.code + '-' + revision, fundId: f.fundId,
    requestedDate: day, holdingDate: day, sourceDocumentIds: [source.sourceDocumentId],
    sourceRevision: revision, supersedesSetId: null, expectedHoldings: 3, stockListCompleteness: 'complete',
    officialVerification: 'unverified', dateAlignment: 'confirmed', classificationVersion: 'qa-v1', taxonomyId: 'qa-taxonomy',
  }));
  const facts = commonFacts();
  qaFunds.forEach((fund, f) => {
    const setId = sets[f].setId;
    const aum = 100000000000 - f * 15000000000 + n * 1000000000;
    facts.push({ kind: 'metrics', data: { setId, fundId: fund.fundId, sourceDocumentId: source.sourceDocumentId,
      aumNtd: qaDecimal(aum), navNtd: qaDecimal(10), fundUnits: qaDecimal(aum / 10),
      aumAsOf: day, navAsOf: day, unitsAsOf: day } });
    qaStocks.forEach((stockId, s) => {
      const shares = qaShares(f, s, n);
      const weight = f === 4 && s === 2 && n === 12
        ? { value: null, raw: '<0.01%', precision: 'less_than', upperBound: '0.01', upperInclusive: false }
        : qaDecimal(qaWeight(f, s, n));
      facts.push({ kind: 'holding', data: { setId, fundId: fund.fundId, securityId: stockId,
        sourceCode: 'QAST' + (s + 1), sourceName: ['測試半導體股', '測試零組件股', '測試週邊股'][s], sourceMarket: 'QA',
        shares: qaDecimal(shares === null ? null : shares + (f === 0 && s === 0 ? correction : 0)), weightPct: weight,
        sourceDocumentId: source.sourceDocumentId, sourceRowKey: fund.code + '-' + stockId,
        industryId: qaIndustries[s], assignmentId: 'qa-assignment-' + (s + 1), assetKind: 'equity' } });
      if (n > 0) {
        const previous = qaShares(f, s, n - 1);
        const delta = shares === null || previous === null ? null : shares - previous + (f === 0 && s === 0 ? correction : 0);
        facts.push({ kind: 'change', data: { setId, fundId: fund.fundId, securityId: stockId,
          industryId: qaIndustries[s], sourceDocumentId: source.sourceDocumentId, sourceRevision: revision,
          startDate: qaDays[n - 1], endDate: day, sourceDate: day, deltaShares: qaDecimal(delta),
          weightDeltaPp: qaDecimal(f === 4 && s === 2 && [12, 13].includes(n) ? null : qaWeight(f, s, n) - qaWeight(f, s, n - 1)),
          estimateNtd: qaDecimal(delta === null ? null : delta * 100),
          estimateMethod: '合成估算：原股數差×100元固定測試價格；非成交或申購',
          priceAsOf: day } });
      }
    });
  });
  const chunks = [];
  for (let i = 0; i < facts.length; i += 80) chunks.push({ facts: facts.slice(i, i + 80) });
  const expectedCounts = {};
  for (const fact of facts) expectedCounts[fact.kind] = (expectedCounts[fact.kind] || 0) + 1;
  return { manifest: { schemaVersion: 2, scopeId: QA_DATA_SCOPE, requestedDate: day, chunkCount: chunks.length,
    expectedCounts, sets, selectedSetIds: sets.map(s => s.setId),
    sourceSelections: sets.map(s => ({ fundId: s.fundId, setId: s.setId, reason: '使用者授權的虛構測試資料，不能作為真實研究證據。' })),
    fundSelections: qaFunds.map(fund => ({ ...fund })), selectionEvidenceIds: [source.sourceDocumentId], selectionConfirmed: false,
    calendarId: 'qa-calendar', calendarVersion: 'qa-v1', originReportSnapshotId: null }, chunks };
}
