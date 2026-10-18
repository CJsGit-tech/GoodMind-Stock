export const DATA_SCHEMA = 2;
export const DATA_SCOPE = 'tw-active-equity';
export const QA_DATA_SCOPE = 'qa-etf-history';
export const MAX_DATA_BYTES = 200 * 1024;
export const MAX_CHUNK_BYTES = 700 * 1024;
export const MAX_CHUNK_FACTS = 80;
export const MAX_MEMBER_BYTES = 64 * 1024;
export const MAX_DATA_ROWS = 5000;
export const MAX_CHUNKS = 100;
export type Precision = 'exact' | 'less_than' | 'rounded' | 'unknown';
export type DecimalEvidence = {
  value: string | null; raw: string; precision: Precision;
  upperBound: string | null; upperInclusive: boolean;
};
export type SourceRef = {
  sourceDocumentId: string; provider: string; url: string;
  declaredDate: string | null; valuationDate: string | null;
  retrievedAt: string; contentHash: string;
  officialStatus: 'official' | 'third_party' | 'unverified';
};
export type FactKind = 'fund' | 'security' | 'industry' | 'assignment' | 'session'
  | 'metrics' | 'holding' | 'change' | 'source';
export const FACT_TABLES: Record<FactKind, string> = {
  fund: 'etf_funds_v2', security: 'securities_v2',
  industry: 'industry_classes_v2', assignment: 'security_industry_assignments_v2',
  session: 'market_sessions_v2', metrics: 'etf_daily_metrics_v2',
  holding: 'etf_daily_holdings_v2', change: 'etf_reported_changes_v2',
  source: 'source_documents_v2',
};
export type DataRecord = Record<string, unknown> & { id: string; schemaVersion: 2; payloadHash: string };
export type FactInput = { kind: FactKind; data: Record<string, unknown> };
export type FactRef = { kind: FactKind; table: string; id: string; hash: string; setId: string | null };
export type FundRef = { fundId: string; securityId: string; code: string; name: string };
export type SetInput = {
  setId: string; fundId: string; requestedDate: string; holdingDate: string | null;
  fundIdentityRevision?: string;
  sourceDocumentIds: string[]; sourceRevision: string; supersedesSetId: string | null;
  expectedHoldings: number; stockListCompleteness: 'complete' | 'partial' | 'unknown';
  officialVerification: 'verified' | 'unverified' | 'conflict';
  dateAlignment: 'confirmed' | 'unconfirmed' | 'conflict';
  classificationVersion: string; taxonomyId: string;
};
export type BatchManifest = {
  schemaVersion: 2; scopeId: string; requestedDate: string; chunkCount: number;
  expectedCounts: Partial<Record<FactKind, number>>; sets: SetInput[];
  selectedSetIds: string[]; sourceSelections: { fundId: string; setId: string; reason: string }[];
  fundSelections: FundRef[]; selectionEvidenceIds: string[];
  selectionConfirmed: boolean; calendarId: string | null; calendarVersion: string | null;
  originReportSnapshotId: string | null;
};
export type BatchStatus = 'uploading' | 'validating' | 'needs_attention' | 'ready'
  | 'reviewed' | 'published' | 'cancelled';
export type ValidationSummary = {
  blockingErrors: string[]; warnings: string[]; counts: Partial<Record<FactKind, number>>;
  sealedSetIds: string[]; reviewHash: string | null; complete: boolean;
};
export type Batch = {
  id: string; ownerKey: string; month: string; manifest: BatchManifest; revision: number;
  status: BatchStatus; receivedChunks: number[]; validation: ValidationSummary | null;
  reviewedPayloadHash: string | null; reviewedAt: string | null; reviewedBy: string | null;
  createdAt: string; updatedAt: string; publicationId: string | null;
};
export type QueryRef = {
  date: string; publicationId: string | null; version: number | null;
  publicationHash: string | null; sets: Record<string, string>;
};
export type MissingReason = 'no_published_data' | 'calendar_unavailable'
  | 'calendar_coverage_insufficient' | 'missing_start' | 'missing_end'
  | 'missing_intermediate' | 'unconfirmed_date' | 'not_observed'
  | 'imprecise_value' | 'incomplete_membership' | 'adjustment_unverified'
  | 'source_estimate_unavailable' | 'net_flow_unavailable' | 'classification_change'
  | 'read_incomplete' | 'unsupported_metric';
export type Metric = 'aumNtd' | 'fundUnits' | 'weightPct' | 'shares' | 'estimateNtd' | 'netFlowNtd';
export type Basis = 'position_level' | 'daily_delta' | 'endpoint' | 'eligible_cumulative';
export type Coverage = { observed: number; expected: number; complete: boolean };
export type QueryEnvelope = {
  schemaVersion: 2; scopeId: string; status: 'ready' | 'partial' | 'missing';
  requested: { end: string; window: 5 | 10 | 20 };
  resolved: { start: string | null; end: string | null; dates: string[] };
  calendarVersion: string | null;
  cohort: { asOf: string; funds: FundRef[]; selectionEvidence: SourceRef[]; confirmed: boolean };
  versionVector: QueryRef[]; pin: string | null;
  missing: { date: string | null; fundId: string | null; reason: MissingReason; message: string }[];
  warnings: string[]; nextCursor: string | null;
};
export type HistoryPoint = {
  date: string; intervalStart: string | null; value: string | null; raw: string;
  precision: Precision; status: 'observed' | 'missing' | 'unknown' | 'not_observed' | 'not_comparable';
  missingReason: MissingReason | null; coverage: Coverage; sourceRefs: SourceRef[];
  publicationId: string | null; setId: string | null; classificationChanged: boolean;
};
export type HistorySeries = {
  seriesId: string; fundId: string; securityId: string | null; industryId: string | null;
  label: string; metric: Metric; unit: 'TWD' | 'units' | 'percent' | 'shares' | 'percentage_points';
  basis: Basis; points: HistoryPoint[];
};
export type HistoryResponse = QueryEnvelope & {
  series: HistorySeries[];
  availableMetrics: { metric: Metric; available: boolean; reason: string | null }[];
  cumulativeEligibility: { eligible: boolean; reason: string | null };
};
export type Publication = {
  id: string; scopeId: string; tradeDate: string; version: number; publicationHash: string;
  publishedAt: string; publishedBy: string; supersedesId: string | null;
  chosenSetIds: string[]; sets: Record<string, string>; fundSelections: FundRef[];
  selectionEvidence: SourceRef[]; selectionConfirmed: boolean;
  calendarId: string | null; calendarVersion: string | null;
  warnings: string[]; sourceRefs: SourceRef[]; reportSnapshotRefs: string[];
  membershipHash: string; published: true;
};
export type SealedSet = SetInput & {
  id: string; schemaVersion: 2; batchId: string; scopeId: string; rowCount: number;
  metricsId: string | null; membershipManifest: { pageNo: number; rowCount: number; pageHash: string }[];
  changeRefs: { id: string; table: string }[];
  allocationIds: string[]; contentHash: string; sealedAt: string;
  classificationSourceIds: string[];
};
export type MembershipPage = {
  id: string; setId: string; pageNo: number;
  sortedSecurityIds: string[]; pageHash: string; rowCount: number;
};
export type ReceiptResult = {
  requestId: string; state: 'committed' | 'unresolved' | 'known_failed';
  action?: string; batchId?: string; revision?: number; publicationId?: string;
  version?: number; errorCode?: string;
};
export function bytes(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要 JSON 物件。');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value) || /<\/?[a-z][^>]*>/iu.test(value)) {
    throw new Error(label + '格式錯誤。');
  }
  return value;
}
export function identity(value: unknown, label = '識別碼'): string {
  const result = text(value, label, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(result)) throw new Error(label + '格式錯誤。');
  return result;
}
export function date(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new Error('需要存在的 YYYY-MM-DD 日期。');
  }
  return value;
}
export function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error(label + '需要有效整數。');
  }
  return value as number;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const row = value as Record<string, unknown>;
  return '{' + Object.keys(row).sort().filter(k => row[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonical(row[k])).join(',') + '}';
}
export async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function key(...tuple: unknown[]): Promise<string> { return hash(tuple); }
export function decimal(value: unknown, nonnegative = false): DecimalEvidence {
  const row = object(value);
  const precision = row.precision;
  if (!['exact', 'less_than', 'rounded', 'unknown'].includes(String(precision))) throw new Error('數值精度缺漏。');
  function amount(v: unknown): string | null {
    if (v === null) return null;
    if (typeof v !== 'string' || !/^-?(0|[1-9]\d{0,37})(\.\d{1,18})?$/.test(v)
      || (nonnegative && v.startsWith('-') && /[1-9]/.test(v))) throw new Error('金融值必須為十進位字串。');
    return v;
  }
  const numeric = amount(row.value);
  const upperBound = amount(row.upperBound);
  if (precision === 'exact' && numeric === null) throw new Error('精確值不可為未知。');
  if (precision === 'unknown' && numeric !== null) throw new Error('未知精度不可填數值。');
  if (precision === 'less_than' && upperBound === null) throw new Error('小於值必須保留上界。');
  if (typeof row.raw !== 'string' || row.raw.length > 200 || typeof row.upperInclusive !== 'boolean') {
    throw new Error('數值原文與上界格式錯誤。');
  }
  return { value: numeric, raw: row.raw, precision: precision as Precision, upperBound, upperInclusive: row.upperInclusive };
}
export const unknownDecimal = (): DecimalEvidence => ({
  value: null, raw: '', precision: 'unknown', upperBound: null, upperInclusive: false,
});
function scaled(value: string): { n: bigint; scale: number } {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return { n: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}
export function decimalOp(left: string, right: string, operation: 'add' | 'subtract'): string {
  const a = scaled(left); const b = scaled(right); const scale = Math.max(a.scale, b.scale);
  const n = a.n * 10n ** BigInt(scale - a.scale)
    + (operation === 'subtract' ? -1n : 1n) * b.n * 10n ** BigInt(scale - b.scale);
  const negative = n < 0n; const raw = (negative ? -n : n).toString().padStart(scale + 1, '0');
  const result = scale ? raw.slice(0, -scale) + '.' + raw.slice(-scale) : raw;
  const trimmed = result.includes('.') ? result.replace(/0+$/, '').replace(/\.$/, '') : result;
  return (negative && n !== 0n ? '-' : '') + trimmed;
}
export function exactDelta(start: DecimalEvidence | null, end: DecimalEvidence | null): DecimalEvidence {
  if (!start || !end || start.precision !== 'exact' || end.precision !== 'exact'
    || start.value === null || end.value === null) return unknownDecimal();
  const value = decimalOp(end.value, start.value, 'subtract');
  return { value, raw: value, precision: 'exact', upperBound: null, upperInclusive: false };
}
export function sourceRef(data: Record<string, unknown>): SourceRef {
  const url = text(data.url, '來源網址', 2048);
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('來源網址不合法。');
  if (!['official', 'third_party', 'unverified'].includes(String(data.officialStatus))) throw new Error('來源分類缺漏。');
  const contentHash = text(data.contentHash, '來源雜湊', 64);
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('來源雜湊格式錯誤。');
  const retrievedAt = text(data.retrievedAt, '取得時間', 40);
  if (!Number.isFinite(Date.parse(retrievedAt)) || !retrievedAt.endsWith('Z')) throw new Error('取得時間需要 UTC ISO-8601。');
  return {
    sourceDocumentId: identity(data.sourceDocumentId), provider: text(data.provider, '來源', 200),
    url, declaredDate: date(data.declaredDate, true), valuationDate: date(data.valuationDate, true),
    retrievedAt, contentHash, officialStatus: data.officialStatus as SourceRef['officialStatus'],
  };
}
export function parseManifest(input: unknown): BatchManifest {
  const m = object(input);
  if (m.schemaVersion !== 2 || ![DATA_SCOPE, QA_DATA_SCOPE].includes(String(m.scopeId))) throw new Error('不支援資料版本或研究範圍。');
  const requestedDate = date(m.requestedDate) as string;
  if (!Array.isArray(m.sets) || m.sets.length < 1 || m.sets.length > 10) throw new Error('觀測集合需要1至10組。');
  const sets = m.sets.map(item => {
    const s = object(item);
    for (const name of ['fundId', 'setId', 'classificationVersion', 'taxonomyId']) identity(s[name], name);
    if (s.fundIdentityRevision !== undefined) identity(s.fundIdentityRevision, '基金身份修訂');
    if (s.requestedDate !== requestedDate) throw new Error('任務只能處理同一日期。');
    date(s.holdingDate, true);
    if (s.dateAlignment === 'confirmed' && s.holdingDate === null) throw new Error('確認日期不可缺漏。');
    if (!['complete', 'partial', 'unknown'].includes(String(s.stockListCompleteness))
      || !['verified', 'unverified', 'conflict'].includes(String(s.officialVerification))
      || !['confirmed', 'unconfirmed', 'conflict'].includes(String(s.dateAlignment))) throw new Error('觀測集合狀態缺漏。');
    if (!Array.isArray(s.sourceDocumentIds) || s.sourceDocumentIds.length < 1 || s.sourceDocumentIds.length > 20) throw new Error('來源識別碼缺漏。');
    s.sourceDocumentIds.forEach(x => identity(x));
    integer(s.expectedHoldings, '持股筆數', MAX_DATA_ROWS);
    text(s.sourceRevision, '來源修訂', 100);
    if (s.supersedesSetId !== null) identity(s.supersedesSetId);
    return s as unknown as SetInput;
  });
  if (new Set(sets.map(s => s.setId)).size !== sets.length) throw new Error('集合識別碼重複。');
  if (!Array.isArray(m.selectedSetIds) || m.selectedSetIds.length < 1 || m.selectedSetIds.length > 5) throw new Error('請選擇1至5個集合。');
  const chosen = m.selectedSetIds.map(x => identity(x));
  const selected = chosen.map(id => sets.find(s => s.setId === id));
  if (selected.some(s => !s) || new Set(selected.map(s => s?.fundId)).size !== chosen.length) throw new Error('同一基金只能選一個來源集合。');
  const fundSelections = (Array.isArray(m.fundSelections) ? m.fundSelections : []).map(item => {
    const f = object(item);
    return { fundId: identity(f.fundId), securityId: identity(f.securityId), code: identity(f.code), name: text(f.name, '基金名稱', 100) };
  });
  if (fundSelections.length !== chosen.length || fundSelections.some(f => !selected.some(s => s?.fundId === f.fundId))) throw new Error('研究組必須與選定集合一致。');
  const expectedCounts = object(m.expectedCounts);
  for (const [kind, count] of Object.entries(expectedCounts)) {
    if (!(kind in FACT_TABLES)) throw new Error('未知資料類別。');
    integer(count, '預期筆數', MAX_DATA_ROWS);
  }
  const sourceSelections = (Array.isArray(m.sourceSelections) ? m.sourceSelections : []).map(item => {
    const s = object(item); return { fundId: identity(s.fundId), setId: identity(s.setId), reason: text(s.reason, '來源選擇理由', 1000) };
  });
  if (sourceSelections.length !== chosen.length || selected.some(s => !sourceSelections.some(x => x.setId === s?.setId && x.fundId === s?.fundId))) throw new Error('需記錄各基金來源選擇與理由。');
  if (!Array.isArray(m.selectionEvidenceIds) || m.selectionEvidenceIds.length > 20) throw new Error('排行來源格式錯誤。');
  if (typeof m.selectionConfirmed !== 'boolean') throw new Error('排行確認狀態缺漏。');
  if (m.calendarId !== null) identity(m.calendarId);
  if (m.calendarVersion !== null) identity(m.calendarVersion);
  if ((m.calendarId === null) !== (m.calendarVersion === null)) throw new Error('日曆識別與版本必須成組。');
  if (m.originReportSnapshotId !== null) identity(m.originReportSnapshotId);
  if (m.scopeId === QA_DATA_SCOPE) {
    const ids = [...sets.flatMap(s => [s.setId, s.fundId, s.taxonomyId, ...s.sourceDocumentIds]),
      ...fundSelections.flatMap(f => [f.fundId, f.securityId]), ...m.selectionEvidenceIds,
      ...(m.calendarId ? [m.calendarId] : [])];
    if (ids.some(value => !String(value).startsWith('qa-')) || fundSelections.some(f => !f.code.startsWith('QA'))) {
      throw new Error('合成測試資料必須使用獨立 qa- 識別與 QA 基金代碼。');
    }
  }
  return { schemaVersion: 2, scopeId: String(m.scopeId), requestedDate,
    chunkCount: integer(m.chunkCount, '分批數', MAX_CHUNKS), expectedCounts,
    sets, selectedSetIds: chosen, sourceSelections, fundSelections,
    selectionEvidenceIds: m.selectionEvidenceIds.map(x => identity(x)),
    selectionConfirmed: m.selectionConfirmed, calendarId: m.calendarId as string | null,
    calendarVersion: m.calendarVersion as string | null,
    originReportSnapshotId: m.originReportSnapshotId as string | null };
}

export const MAX_SNAPSHOT_PAGES = 128;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_SNAPSHOT_PAGE_BYTES = 160 * 1024;
export type DataLineage = {
  publicationIds: string[]; setIds: string[]; sourceHashes: string[]; taxonomyVersions: string[];
  calendarVersion: string | null; comparison: { start: string | null; end: string | null };
  versionVector: QueryRef[]; algorithmVersion: string;
};
export type SnapshotManifest = {
  pages: { pageNo: number; pageId: string; pageHash: string; byteLength: number }[];
  bodyHash: string; bodyBytes: number;
};
export type DataFund = {
  fund: FundRef; setId: string; requestedDate: string; holdingDate: string | null;
  dateAlignment: SetInput['dateAlignment']; stockListCompleteness: SetInput['stockListCompleteness'];
  officialVerification: SetInput['officialVerification']; metrics: Record<string, unknown> | null;
  holdings: Record<string, unknown>[]; allocations: Record<string, unknown>[];
  reportedChanges: Record<string, unknown>[];
};
export type DataResponse = {
  schemaVersion: 2; scopeId: string; status: 'ready' | 'partial' | 'missing'; requestedDate: string;
  publicationId: string | null; version: number | null; pin: string | null; funds: DataFund[];
  sourceRefs: SourceRef[]; missing: QueryEnvelope['missing']; warnings: string[]; nextCursor: string | null;
};
export type CatalogResponse = {
  schemaVersion: 2; scopeId: string; latestPublishedDate: string | null; selectedDate: string | null;
  dates: string[]; funds: FundRef[]; industries: { industryId: string; label: string; taxonomyVersion: string }[];
  stocks: { securityId: string; code: string; name: string }[]; publicationId: string | null;
  version: number | null; nextCursor: string | null; warnings: string[];
};
export type CompareResponse = QueryEnvelope & {
  rows: { fundId: string; securityId: string | null; industryId: string | null;
    start: DecimalEvidence | null; end: DecimalEvidence | null; delta: DecimalEvidence | null;
    status: string; missingReason: MissingReason | null; classificationChanged: boolean;
    sourceRefs: SourceRef[]; startSetId: string | null; endSetId: string | null }[];
  coverage: Coverage; endpointAvailable: boolean; trendAvailable: boolean;
  total: DecimalEvidence | null; totalLabel: string | null;
};

export type IndustryFlowPoint = {
  date: string; valueNtd: string | null; precision: Precision;
  status: 'observed' | 'missing' | 'unknown' | 'not_comparable';
  reason: string | null; intervalStart: string | null; observedStocks: number;
  classificationVersion: string | null; classificationChanged: boolean;
};
export type IndustryFlowSeries = {
  industryId: string; label: string; points: IndustryFlowPoint[];
};
export type IndustryFlowResponse = {
  schemaVersion: 1; scopeId: string; status: 'ready' | 'partial' | 'missing';
  start: string | null; end: string | null; dates: string[];
  funds: FundRef[]; fundId: string | null; industryId: string | null;
  industries: { industryId: string; label: string }[];
  series: IndustryFlowSeries[];
  publishedDays: number; calendar: Record<string, 'trading' | 'closed' | 'unknown'>;
  pin: string | null; nextCursor: string | null; warnings: string[];
  provenance: { date: string; publicationId: string; publicationHash: string;
    setId: string | null; sourceRefs: SourceRef[]; classificationVersion: string | null }[];
};
