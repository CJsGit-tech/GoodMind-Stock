import {
  DATA_SCOPE, QA_DATA_SCOPE, FACT_TABLES, MAX_DATA_BYTES, bytes, canonical, date, decimalOp, exactDelta,
  hash, identity, key, object,
} from '../shared/etf-data-contract.ts';
import type {
  Basis, CatalogResponse, CompareResponse, DataFund, DataRecord, DataResponse, DecimalEvidence,
  FundRef, HistoryPoint, HistoryResponse, HistorySeries, Metric, MissingReason, Publication,
  QueryEnvelope, SealedSet,
} from '../shared/etf-data-contract.ts';
import {
  T, batchById, fail, getHead, getPublication, getSet, holdings, members, partition, read, readMany,
} from './etf-data-store.ts';

type Pin = { schemaVersion: 2; scopeId: string; end: string; window: number;
  classification: string; refs: [string, string | null][]; calendarId: string | null; calendarVersion: string | null };
type Session = { calendarId: string; calendarVersion: string; date: string; isTradingDay: boolean;
  sessionOrdinal: number | null; previousSessionDate: string | null; calendarCoveredThrough: string; sourceDocumentId: string };
type Resolved = { envelope: QueryEnvelope; publications: Map<string, Publication>; calendarId: string | null };
type Selection = { level: 'etf' | 'industry' | 'stock'; metric: Metric; basis: Basis;
  funds: FundRef[]; stockId: string | null; industryId: string | null; classification: string };
const METRICS: Metric[] = ['aumNtd', 'fundUnits', 'weightPct', 'shares', 'estimateNtd', 'netFlowNtd'];
const REASONS: Record<MissingReason, string> = {
  no_published_data: '此日期尚無作者已發布的日資料。',
  calendar_unavailable: '尚無已核對的交易日曆，不能推定交易日。',
  calendar_coverage_insufficient: '已核對日曆不足以解析完整交易日期間。',
  missing_start: '缺少起始交易日資料。', missing_end: '缺少截至交易日資料。',
  missing_intermediate: '缺少中間交易日資料，趨勢不能連成完整路徑。',
  unconfirmed_date: '實際持股日期未確認或與交易日不符。',
  not_observed: '未在不完整清單中觀測到，不等於零持股。',
  imprecise_value: '原值未知、四捨五入或只有上界，不能算精確差額。',
  incomplete_membership: '完整清單與封存索引尚無法證明此列不存在。',
  adjustment_unverified: '公司行動與基金份額調整未核對，原股數差不代表實際買賣。',
  source_estimate_unavailable: '此區間沒有方法及涵蓋範圍一致的來源金額估算。',
  net_flow_unavailable: '尚無明確披露的基金淨申贖資料，不能以AUM差替代。',
  classification_change: '產業分類跨期改變，需另列分類移轉。',
  read_incomplete: '資料讀取未完成，不可當作缺列或零。',
  unsupported_metric: '此層級或計算方式不支援這項指標。',
};
function encode(value: unknown) { return btoa(JSON.stringify(value)); }
function decode(value: string): Record<string, unknown> {
  if (value.length > 12000) fail('invalid_cursor', '版本或分頁識別過長。');
  try { return object(JSON.parse(atob(value))); }
  catch { return fail('invalid_cursor', '版本或分頁識別格式錯誤。'); }
}
function scope(query: Record<string, string>) {
  const value = query.scopeId || DATA_SCOPE;
  if (![DATA_SCOPE, QA_DATA_SCOPE].includes(value)) fail('invalid_scope', '不支援的研究範圍。');
  return value;
}
function queryPin(query: Record<string, string>): Pin | null {
  if (!query.pin) return null;
  const pin = decode(query.pin) as unknown as Pin;
  if (pin.schemaVersion !== 2 || pin.scopeId !== scope(query) || !Array.isArray(pin.refs)
    || pin.refs.length > 31 || pin.refs.some(r => !Array.isArray(r) || r.length !== 2)) fail('invalid_pin', '固定版本識別格式錯誤。');
  pin.refs.forEach(([day, id]) => { date(day); if (id !== null) identity(id); });
  return pin;
}
async function publicationForDate(scopeId: string, day: string, pin: Pin | null): Promise<Publication | null> {
  let id: string | null = null;
  if (pin) {
    const ref = pin.refs.find(r => r[0] === day);
    if (!ref) fail('pin_date_mismatch', '此日期不在固定版本範圍內。', 409);
    id = ref[1];
  } else id = (await getHead(scopeId, day))?.publicationId ?? null;
  if (!id) return null;
  const publication = await getPublication(id);
  if (publication.scopeId !== scopeId || publication.tradeDate !== day) fail('invalid_pin', '發布版本與日期不符。', 409);
  return publication;
}
async function latest(scopeId: string): Promise<string | null> {
  const root = await read<{ latestDate: string }>(T.catalog, await key(scopeId, 'catalog'));
  if (!root) return null;
  // The index is a discovery accelerator; it never grants visibility without a head.
  return await getHead(scopeId, root.latestDate) ? root.latestDate : null;
}
async function session(calendarId: string, version: string, day: string): Promise<Session | null> {
  const row = await read<Session>(FACT_TABLES.session, await key(calendarId, version, day));
  if (!row || row.calendarId !== calendarId || row.calendarVersion !== version || row.date !== day) return null;
  return row;
}
async function resolveCalendar(calendarId: string, version: string, requestedEnd: string, window: number) {
  const requested = await session(calendarId, version, requestedEnd);
  if (!requested || requested.calendarCoveredThrough < requestedEnd) return { dates: [] as string[], end: null, reason: 'calendar_coverage_insufficient' as MissingReason };
  const end = requested.isTradingDay ? requested.date : requested.previousSessionDate;
  if (!end) return { dates: [] as string[], end: null, reason: 'calendar_coverage_insufficient' as MissingReason };
  const dates: string[] = []; let current = await session(calendarId, version, end);
  for (let i = 0; i <= window; i++) {
    if (!current || !current.isTradingDay || current.sessionOrdinal === null) {
      return { dates: dates.reverse(), end, reason: 'calendar_coverage_insufficient' as MissingReason };
    }
    dates.push(current.date);
    if (i < window) {
      const previous = current.previousSessionDate ? await session(calendarId, version, current.previousSessionDate) : null;
      if (!previous || previous.sessionOrdinal !== current.sessionOrdinal - 1 || previous.date >= current.date) {
        return { dates: dates.reverse(), end, reason: 'calendar_coverage_insufficient' as MissingReason };
      }
      current = previous;
    }
  }
  return { dates: dates.reverse(), end, reason: null };
}
function missing(envelope: QueryEnvelope, day: string | null, fundId: string | null, reason: MissingReason) {
  if (!envelope.missing.some(m => m.date === day && m.fundId === fundId && m.reason === reason)) {
    envelope.missing.push({ date: day, fundId, reason, message: REASONS[reason] });
  }
}
export async function resolveQuery(query: Record<string, string>): Promise<Resolved> {
  const scopeId = scope(query); const requestedEnd = date(query.end) as string;
  const window = query.window === undefined ? 20 : Number(query.window);
  if (![5, 10, 20].includes(window)) fail('invalid_window', '期間僅支援5、10或20交易日。');
  const classification = query.classification || 'published';
  if (!['published', 'fixed_end'].includes(classification)) fail('invalid_classification', '分類方式無效。');
  const pin = queryPin(query);
  if (pin && (pin.end !== requestedEnd || pin.window !== window || pin.classification !== classification)) {
    fail('pin_query_conflict', '日期、期間或分類已變更，請明確重新整理版本。', 409);
  }
  const envelope: QueryEnvelope = {
    schemaVersion: 2, scopeId, status: 'missing',
    requested: { end: requestedEnd, window: window as 5 | 10 | 20 },
    resolved: { start: null, end: null, dates: [] }, calendarVersion: null,
    cohort: { asOf: requestedEnd, funds: [], selectionEvidence: [], confirmed: false },
    versionVector: [], pin: null, missing: [], warnings: [], nextCursor: null,
  };
  const publications = new Map<string, Publication>();
  const selectedDate = await latest(scopeId);
  const discovery = selectedDate ? await publicationForDate(scopeId, selectedDate, null) : null;
  const directEnd = pin ? null : await publicationForDate(scopeId, requestedEnd, null);
  const calendarId = pin ? pin.calendarId : directEnd?.calendarId ?? discovery?.calendarId ?? null;
  const calendarVersion = pin ? pin.calendarVersion : directEnd?.calendarVersion ?? discovery?.calendarVersion ?? null;
  envelope.calendarVersion = calendarVersion;
  let dates: string[] = []; let resolvedEnd: string | null = null;
  if (!calendarId || !calendarVersion) {
    missing(envelope, requestedEnd, null, 'calendar_unavailable');
    // A real published single point remains usable even before a calendar is supplied.
    dates = [requestedEnd]; resolvedEnd = requestedEnd;
  } else {
    const calendar = await resolveCalendar(calendarId, calendarVersion, requestedEnd, window);
    dates = calendar.dates; resolvedEnd = calendar.end;
    if (calendar.reason) missing(envelope, requestedEnd, null, calendar.reason);
    if (!dates.length) dates = [requestedEnd];
  }
  if (pin && canonical(pin.refs.map(r => r[0])) !== canonical(dates)) fail('pin_calendar_mismatch', '固定版本的交易日曆已不一致。', 409);
  envelope.resolved = { start: dates.length === window + 1 ? dates[0] : null, end: resolvedEnd, dates };
  const resolvedPublications = new Map<string, Publication | null>();
  for (let offset = 0; offset < dates.length; offset += 5) {
    const group = dates.slice(offset, offset + 5);
    const values = await Promise.all(group.map(day => publicationForDate(scopeId, day, pin)));
    group.forEach((day, index) => resolvedPublications.set(day, values[index]));
  }
  for (const day of dates) {
    const publication = resolvedPublications.get(day) ?? null;
    if (publication) publications.set(day, publication);
    envelope.versionVector.push({
      date: day, publicationId: publication?.id ?? null, version: publication?.version ?? null,
      publicationHash: publication?.publicationHash ?? null, sets: publication?.sets ?? {},
    });
    if (!publication) missing(envelope, day, null,
      day === resolvedEnd || day === requestedEnd && !resolvedEnd ? 'missing_end'
        : day === envelope.resolved.start ? 'missing_start' : 'missing_intermediate');
  }
  const ending = resolvedEnd ? publications.get(resolvedEnd) : undefined;
  if (ending) {
    envelope.cohort = { asOf: resolvedEnd as string, funds: ending.fundSelections,
      selectionEvidence: ending.selectionEvidence, confirmed: ending.selectionConfirmed };
    envelope.warnings = [...ending.warnings];
  } else missing(envelope, resolvedEnd ?? requestedEnd, null, 'no_published_data');
  if (!envelope.cohort.confirmed && ending) envelope.warnings.push('固定截至日研究組之AUM選樣尚待核對。');
  if (resolvedEnd && resolvedEnd !== requestedEnd) envelope.warnings.push('截至日非交易日，依核對日曆解析為 ' + resolvedEnd + '。');
  envelope.warnings.push('股數為原始部位；公司行動及基金份額調整未核對時不代表實際買賣。');
  const token: Pin = { schemaVersion: 2, scopeId, end: requestedEnd, window, classification,
    refs: envelope.versionVector.map(r => [r.date, r.publicationId]), calendarId, calendarVersion };
  envelope.pin = encode(token);
  envelope.status = publications.size === 0 ? 'missing' : envelope.missing.length ? 'partial' : 'ready';
  return { envelope, publications, calendarId };
}
function select(query: Record<string, string>, envelope: QueryEnvelope): Selection {
  const level = query.level || 'industry'; const metric = query.metric || (level === 'etf' ? 'aumNtd' : level === 'stock' ? 'shares' : 'weightPct');
  const basis = query.basis || 'position_level';
  if (!['etf', 'industry', 'stock'].includes(level) || !METRICS.includes(metric as Metric)
    || !['position_level', 'daily_delta', 'endpoint', 'eligible_cumulative'].includes(basis)) fail('invalid_metric', '層級、指標或計算方式無效。');
  const requestedFunds = query.fundIds ? query.fundIds.split(',').filter(Boolean) : envelope.cohort.funds.slice(0, 1).map(f => f.fundId);
  if (requestedFunds.length > 5 || new Set(requestedFunds).size !== requestedFunds.length) fail('invalid_funds', '最多比較研究組五檔基金。');
  requestedFunds.forEach(id => identity(id));
  if (envelope.cohort.funds.length && requestedFunds.some(id => !envelope.cohort.funds.some(f => f.fundId === id))) {
    fail('cohort_mismatch', '只能選取截至日固定研究組中的基金。');
  }
  return { level: level as Selection['level'], metric: metric as Metric, basis: basis as Basis,
    funds: envelope.cohort.funds.filter(f => requestedFunds.includes(f.fundId)),
    stockId: query.stockId ? identity(query.stockId) : null,
    industryId: query.industryId ? identity(query.industryId) : null, classification: query.classification || 'published' };
}
function point(day: string, publication: Publication | undefined, fundId: string): HistoryPoint {
  return {
    date: day, intervalStart: null, value: null, raw: '', precision: 'unknown', status: 'missing',
    missingReason: publication?.sets[fundId] ? 'not_observed' : 'no_published_data',
    coverage: { observed: 0, expected: 1, complete: false },
    sourceRefs: [], publicationId: publication?.id ?? null,
    setId: publication?.sets[fundId] ?? null, classificationChanged: false,
  };
}
function attach(pointValue: HistoryPoint, value: DecimalEvidence) {
  pointValue.value = value.value; pointValue.raw = value.raw; pointValue.precision = value.precision;
  pointValue.status = value.precision === 'unknown' ? 'unknown' : 'observed';
  pointValue.missingReason = value.precision === 'unknown' ? 'imprecise_value' : null;
  pointValue.coverage = { observed: value.value === null ? 0 : 1, expected: 1, complete: value.precision === 'exact' };
}
function publicRow(row: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'securityId', 'securityIdentityRevision', 'sourceCode', 'sourceName', 'sourceMarket', 'shares', 'weightPct', 'industryId', 'assignmentId',
    'sourceDocumentId', 'sourceRowKey', 'assetKind', 'requestedDate', 'holdingDate',
    'aumNtd', 'navNtd', 'fundUnits', 'aumAsOf', 'navAsOf', 'unitsAsOf',
    'label', 'taxonomyVersion', 'knownWeightSumPct', 'stockCount', 'knownWeightCount',
    'impreciseCount', 'unknownCount', 'coverage', 'inputHash', 'calculationVersion', 'memberIndexRef',
    'startDate', 'endDate', 'sourceDate', 'deltaShares', 'weightDeltaPp', 'estimateNtd', 'estimateMethod', 'priceAsOf',
  ];
  return Object.fromEntries(allowed.filter(k => k in row).map(k => [k, row[k]]));
}
async function setPoint(day: string, publication: Publication | undefined, fund: FundRef, selection: Selection,
  endingSet: SealedSet | null, loadSet: (id: string) => Promise<SealedSet> = getSet): Promise<HistoryPoint> {
  const p = point(day, publication, fund.fundId);
  if (!publication || !p.setId) return p;
  const set = await loadSet(p.setId);
  if (set.fundId !== fund.fundId) fail('set_integrity', '觀測集合與基金身份不符。', 503);
  p.sourceRefs = publication.sourceRefs.filter(s => [...set.sourceDocumentIds, ...set.classificationSourceIds].includes(s.sourceDocumentId));
  if (set.dateAlignment !== 'confirmed' || set.holdingDate !== day) {
    p.status = 'not_comparable'; p.missingReason = 'unconfirmed_date'; return p;
  }
  if (selection.metric === 'netFlowNtd') { p.status = 'not_comparable'; p.missingReason = 'net_flow_unavailable'; return p; }
  const table = partition(FACT_TABLES.holding, set.scopeId, set.requestedDate);
  if (selection.level === 'etf') {
    if (!['aumNtd', 'fundUnits'].includes(selection.metric)) { p.missingReason = 'unsupported_metric'; return p; }
    const metrics = set.metricsId ? await read<DataRecord>(partition(FACT_TABLES.metrics, set.scopeId, set.requestedDate), set.metricsId) : null;
    const asOf = selection.metric === 'aumNtd' ? 'aumAsOf' : 'unitsAsOf';
    if (!metrics || metrics[asOf] !== day) { p.missingReason = 'unconfirmed_date'; return p; }
    attach(p, metrics[selection.metric] as DecimalEvidence); return p;
  }
  if (selection.metric === 'estimateNtd') {
    if (!selection.stockId && selection.level === 'stock') { p.missingReason = 'not_observed'; return p; }
    const changes = await Promise.all(set.changeRefs.map(r => read<DataRecord>(r.table, r.id)));
    if (changes.some(r => !r)) fail('change_integrity', '來源異動資料不完整。', 503);
    const selected = (changes as DataRecord[]).filter(r => r.endDate === day
      && (selection.stockId ? r.securityId === selection.stockId : true)
      && (selection.industryId ? r.researchSectorId === selection.industryId || r.industryId === selection.industryId : true));
    if (!selected.length || selected.some(r => (r.estimateNtd as DecimalEvidence).precision !== 'exact'
      || !r.estimateMethod || !r.priceAsOf) || new Set(selected.map(r => r.estimateMethod)).size !== 1
      || selected.some(r => r.startDate !== selected[0].startDate)) {
      p.missingReason = 'source_estimate_unavailable'; return p;
    }
    const value = selected.reduce((sum, r) => decimalOp(sum, (r.estimateNtd as DecimalEvidence).value as string, 'add'), '0');
    attach(p, { value, raw: value, precision: 'exact', upperBound: null, upperInclusive: false });
    p.intervalStart = String(selected[0].startDate);
    p.coverage = { observed: selected.length, expected: selected.length, complete: false };
    return p;
  }
  if (selection.level === 'stock') {
    if (!selection.stockId || !['shares', 'weightPct'].includes(selection.metric)) { p.missingReason = 'unsupported_metric'; return p; }
    const ids = await members(set);
    if (!ids.includes(selection.stockId)) {
      if (set.stockListCompleteness === 'complete') attach(p, { value: '0', raw: '完整清單未持有', precision: 'exact', upperBound: null, upperInclusive: false });
      else { p.status = 'not_observed'; p.missingReason = 'not_observed'; }
      return p;
    }
    const row = await read<DataRecord>(table, await key(set.id, selection.stockId));
    if (!row) fail('holding_integrity', '索引中持股資料缺漏，不可視為零。', 503);
    attach(p, row[selection.metric] as DecimalEvidence);
    if (endingSet && endingSet.id !== set.id) {
          const endRow = await read<DataRecord>(partition(FACT_TABLES.holding, endingSet.scopeId, endingSet.requestedDate), await key(endingSet.id, selection.stockId));
      p.classificationChanged = !!endRow && endRow.industryId !== row.industryId;
    }
    return p;
  }
  if (!selection.industryId || selection.metric !== 'weightPct') { p.missingReason = 'unsupported_metric'; return p; }
  if (endingSet && endingSet.id !== set.id) {
    p.classificationChanged = endingSet.classificationVersion !== set.classificationVersion;
    const oldRows = await holdings(set, await members(set));
    const endRows = await holdings(endingSet, await members(endingSet));
    const endById = new Map(endRows.map(r => [String(r.securityId), r]));
    p.classificationChanged ||= oldRows.some(r => {
      const endRow = endById.get(String(r.securityId));
      return endRow && endRow.industryId !== r.industryId
        && (r.industryId === selection.industryId || endRow.industryId === selection.industryId);
    });
  }
  const row = await read<DataRecord>(partition(T.allocations, set.scopeId, set.requestedDate),
    await key(set.id, set.classificationVersion, selection.industryId));
  if (selection.classification === 'fixed_end' && endingSet && endingSet.id !== set.id) {
    // Recalculate from fixed end assignment members, never overwrite the published allocations.
    const endRows = await holdings(endingSet, await members(endingSet));
    const oldIds = await members(set);
    const oldRows = await holdings(set, oldIds);
    const endById = new Map(endRows.map(r => [String(r.securityId), r]));
    // An exited security still needs a verified end-date assignment. Absence from
    // the end holdings cannot supply that classification or justify a zero base.
    if (oldRows.some(r => !endById.has(String(r.securityId)))) {
      p.status = 'not_comparable'; p.missingReason = 'classification_change';
      p.classificationChanged = true; return p;
    }
    const selected = oldRows.filter(r => endById.get(String(r.securityId))?.industryId === selection.industryId);
    if (set.stockListCompleteness !== 'complete' || selected.some(r => (r.weightPct as DecimalEvidence).precision !== 'exact')) {
      p.status = 'not_comparable'; p.missingReason = 'imprecise_value'; return p;
    }
    const value = selected.reduce((sum, r) => decimalOp(sum, (r.weightPct as DecimalEvidence).value as string, 'add'), '0');
    attach(p, { value, raw: value, precision: 'exact', upperBound: null, upperInclusive: false });
    p.classificationChanged = true; return p;
  }
  if (!row) {
    if (set.stockListCompleteness === 'complete') attach(p, { value: '0', raw: '完整清單無該產業', precision: 'exact', upperBound: null, upperInclusive: false });
    else p.missingReason = 'not_observed';
    return p;
  }
  attach(p, row.weightPct as DecimalEvidence);
  p.coverage = row.coverage as HistoryPoint['coverage'];
  return p;
}
function available(selection: Selection) {
  return METRICS.map(metric => {
    const supported = metric !== 'netFlowNtd'
      && (selection.level === 'etf' ? ['aumNtd', 'fundUnits'].includes(metric)
        : selection.level === 'industry' ? ['weightPct', 'estimateNtd'].includes(metric)
          : ['shares', 'weightPct', 'estimateNtd'].includes(metric));
    return { metric, available: supported, reason: supported ? null : REASONS[metric === 'netFlowNtd' ? 'net_flow_unavailable' : 'unsupported_metric'] };
  });
}
export async function historyQuery(query: Record<string, string>): Promise<HistoryResponse> {
  const resolved = await resolveQuery(query); const { envelope, publications } = resolved;
  const selection = select(query, envelope); const series: HistorySeries[] = [];
  const setReads = new Map<string, Promise<SealedSet>>();
  function loadSet(id: string): Promise<SealedSet> {
    const existing = setReads.get(id);
    if (existing) return existing;
    const pending = getSet(id); setReads.set(id, pending); return pending;
  }
  const unit = selection.metric === 'weightPct' ? (selection.basis === 'position_level' ? 'percent' : 'percentage_points')
    : selection.metric === 'shares' ? 'shares' : selection.metric === 'fundUnits' ? 'units' : 'TWD';
  const jobs: { fund: FundRef; selection: Selection; industryLabel: string | null }[] = [];
  if (query.view === 'heatmap' && selection.level === 'industry') {
    if (selection.funds.length > 1) fail('heatmap_single_fund', '產業熱力圖只顯示目前選定的一檔基金。');
    const fund = selection.funds[0];
    if (fund) {
      const industries = new Map<string, string>();
      for (const publication of publications.values()) {
        const setId = publication.sets[fund.fundId];
        if (!setId) continue;
        const set = await loadSet(setId);
        const allocations = await readMany<DataRecord>(partition(T.allocations, set.scopeId, set.requestedDate), set.allocationIds);
        for (const allocation of allocations) {
          if (!allocation) fail('allocation_integrity', '產業彙整資料缺漏。', 503);
          industries.set(String(allocation.industryId), String(allocation.label));
        }
      }
      if (industries.size > 100) fail('heatmap_too_large', '產業數超過此查詢上限，請先篩選產業。', 413);
      for (const [industryId, label] of industries) if (!selection.industryId || selection.industryId === industryId) {
        jobs.push({ fund, selection: { ...selection, industryId }, industryLabel: label });
      }
    }
  } else selection.funds.forEach(fund => jobs.push({ fund, selection, industryLabel: null }));
  for (const job of jobs) {
    const { fund, selection, industryLabel } = job;
    const endPublication = envelope.resolved.end ? publications.get(envelope.resolved.end) : null;
    const endingSet = endPublication?.sets[fund.fundId] ? await loadSet(endPublication.sets[fund.fundId]) : null;
    const points: HistoryPoint[] = [];
    for (let offset = 0; offset < envelope.resolved.dates.length; offset += 5) {
      const group = envelope.resolved.dates.slice(offset, offset + 5);
      // Bound concurrent reads while retaining the exact date and fund order.
      const values = await Promise.all(group.map(day => setPoint(day, publications.get(day), fund, selection, endingSet, loadSet)));
      points.push(...values);
    }
    if (selection.metric === 'estimateNtd' && ['daily_delta', 'eligible_cumulative'].includes(selection.basis)) {
      points.forEach((p, index) => {
        if (p.status === 'observed' && (index === 0 || p.intervalStart !== envelope.resolved.dates[index - 1])) {
          p.value = null; p.status = 'not_comparable'; p.precision = 'unknown'; p.missingReason = 'source_estimate_unavailable';
        }
      });
    }
    if (selection.metric === 'estimateNtd' && selection.basis === 'endpoint') {
      points.forEach(p => {
        if (p.status === 'observed' && (p.date !== envelope.resolved.end || p.intervalStart !== envelope.resolved.start)) {
          p.value = null; p.status = 'not_comparable'; p.precision = 'unknown'; p.missingReason = 'source_estimate_unavailable';
        }
      });
    }
    if (selection.basis !== 'position_level' && selection.metric !== 'estimateNtd') {
      const original = points.map(p => ({ ...p }));
      for (let index = 0; index < points.length; index++) {
        const p = points[index];
        const previousIndex = selection.basis === 'endpoint' ? 0 : index - 1;
        const previous = original[previousIndex];
        p.intervalStart = previous?.date ?? null;
        if (index === 0 || !previous || previous.status !== 'observed' || p.status !== 'observed'
          || previous.precision !== 'exact' || p.precision !== 'exact'
          || (selection.basis === 'endpoint' && !envelope.resolved.start)) {
          p.value = null; p.precision = 'unknown'; p.status = 'not_comparable';
          p.missingReason = index === 0 ? 'missing_start'
            : previous?.missingReason ?? p.missingReason ?? 'imprecise_value';
        } else if (selection.level === 'industry' && (p.classificationChanged || previous.classificationChanged) && selection.classification === 'published') {
          p.value = null; p.precision = 'unknown'; p.status = 'not_comparable'; p.missingReason = 'classification_change';
        } else {
          const value = decimalOp(original[index].value as string, previous.value as string, 'subtract');
          attach(p, { value, raw: value, precision: 'exact', upperBound: null, upperInclusive: false });
        }
      }
    }
    const selectedEntity = selection.stockId || selection.industryId || fund.fundId;
    series.push({ seriesId: await key(fund.fundId, selection.level, selectedEntity, selection.metric, selection.basis),
      fundId: fund.fundId, securityId: selection.stockId, industryId: selection.industryId,
      label: industryLabel ?? fund.code + ' ' + fund.name, metric: selection.metric, unit, basis: selection.basis, points });
  }
  const cumulativeEligible = ['shares', 'estimateNtd'].includes(selection.metric)
    && (selection.metric !== 'shares' || selection.level === 'stock' && !!selection.stockId)
    && envelope.resolved.dates.length === envelope.requested.window + 1
    && series.length > 0 && series.every(s => s.points.slice(1).every(p =>
      p.status === 'observed' && p.precision === 'exact' && p.coverage.complete))
    && selection.basis !== 'position_level';
  const cumulativeReason = cumulativeEligible ? null : '只有同股差額或方法一致且完整覆蓋的來源金額可累計；缺日、非精確值及配置百分比不可累計。';
  if (selection.basis === 'eligible_cumulative') {
    for (const s of series) {
      let sum = '0';
      for (let index = 1; index < s.points.length; index++) {
        const p = s.points[index];
        if (cumulativeEligible) { sum = decimalOp(sum, p.value as string, 'add'); p.value = sum; p.raw = sum; p.intervalStart = envelope.resolved.start; }
        else { p.value = null; p.status = 'not_comparable'; p.precision = 'unknown'; p.missingReason = 'missing_intermediate'; }
      }
    }
  }
  for (const s of series) for (const p of s.points) if (p.missingReason) missing(envelope, p.date, s.fundId, p.missingReason);
  const availability = available(selection);
  const estimateOption = availability.find(m => m.metric === 'estimateNtd');
  let hasEstimate = false;
  if (selection.metric === 'estimateNtd') hasEstimate = series.some(s => s.points.some(p => p.status === 'observed'));
  else if (estimateOption?.available) {
    // This is an existence check for the metric selector, not a request to read
    // every source change in the entire period. Sets are immutable and cached
    // only within this request; selected metric evidence still validates fully.
    searchEstimates: for (const publication of publications.values()) {
      for (const fund of selection.funds) {
        const id = publication.sets[fund.fundId];
        if (!id) continue;
        const set = await loadSet(id);
        const groups = new Map<string, string[]>();
        for (const ref of set.changeRefs) {
          const ids = groups.get(ref.table) || []; ids.push(ref.id); groups.set(ref.table, ids);
        }
        for (const [table, ids] of groups) for (let offset = 0; offset < ids.length; offset += 80) {
          const changes = await readMany<DataRecord>(table, ids.slice(offset, offset + 80));
          if (changes.some(change => change && (!selection.stockId || change.securityId === selection.stockId)
            && (!selection.industryId || change.industryId === selection.industryId || change.researchSectorId === selection.industryId)
            && change.estimateMethod && change.priceAsOf && (change.estimateNtd as DecimalEvidence).precision === 'exact')) {
            hasEstimate = true; break searchEstimates;
          }
        }
      }
    }
  }
  if (estimateOption && !hasEstimate) { estimateOption.available = false; estimateOption.reason = REASONS.source_estimate_unavailable; }
  const requestedAvailability = availability.find(m => m.metric === selection.metric);
  if (!requestedAvailability?.available) {
    missing(envelope, null, null, selection.metric === 'netFlowNtd' ? 'net_flow_unavailable' : 'unsupported_metric');
  }
  const allPoints = series.flatMap(s => s.points);
  envelope.status = allPoints.some(p => p.status === 'observed') ? envelope.missing.length ? 'partial' : 'ready' : 'missing';
  const response: HistoryResponse = { ...envelope, series, availableMetrics: availability,
    cumulativeEligibility: { eligible: cumulativeEligible, reason: cumulativeReason } };
  const signature = await hash({ pin: envelope.pin, level: selection.level, metric: selection.metric,
    basis: selection.basis, funds: selection.funds.map(f => f.fundId), stockId: selection.stockId,
    industryId: selection.industryId, view: query.view || 'series' });
  const cursor = query.cursor ? decode(query.cursor) : null;
  if (cursor && (cursor.kind !== 'history' || cursor.signature !== signature
    || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0)) fail('cursor_mismatch', '歷史分頁條件或版本已變更。', 409);
  const start = Number(cursor?.offset ?? 0);
  response.series = [];
  for (let index = start; index < series.length; index++) {
    response.series.push(series[index]);
    if (bytes(response) > MAX_DATA_BYTES - 4000) {
      response.series.pop();
      if (!response.series.length) fail('query_too_large', '單一序列超過回應上限，請縮短期間或減少來源。', 413);
      response.nextCursor = encode({ kind: 'history', signature, offset: index });
      break;
    }
  }
  return response;
}
export async function compareQuery(query: Record<string, string>): Promise<CompareResponse> {
  const response = await historyQuery({ ...query, basis: 'position_level' });
  const rows: CompareResponse['rows'] = [];
  const metric = query.metric || (query.level === 'etf' ? 'aumNtd' : query.level === 'stock' ? 'shares' : 'weightPct');
  for (const s of response.series) {
    const startPoint = response.resolved.start ? s.points.find(p => p.date === response.resolved.start) : null;
    const endPoint = s.points.find(p => p.date === response.resolved.end);
    function value(p: HistoryPoint | null | undefined): DecimalEvidence | null {
      return p ? { value: p.value, raw: p.raw, precision: p.precision, upperBound: null, upperInclusive: false } : null;
    }
    const startValue = value(startPoint); const endValue = value(endPoint);
    const classificationChanged = !!endPoint?.classificationChanged || !!startPoint?.classificationChanged;
    const delta = exactDelta(startValue, endValue);
    let reason: MissingReason | null = !startPoint || startPoint.status !== 'observed' ? 'missing_start'
      : !endPoint || endPoint.status !== 'observed' ? 'missing_end'
        : delta.value === null ? 'imprecise_value' : null;
    if (classificationChanged && query.classification !== 'fixed_end' && query.level === 'industry') reason = 'classification_change';
    rows.push({ fundId: s.fundId, securityId: s.securityId, industryId: s.industryId,
      start: startValue, end: endValue, delta: reason ? null : delta,
      status: reason ? 'not_comparable' : 'comparable', missingReason: reason, classificationChanged,
      sourceRefs: [...(startPoint?.sourceRefs ?? []), ...(endPoint?.sourceRefs ?? [])],
      startSetId: startPoint?.setId ?? null, endSetId: endPoint?.setId ?? null });
  }
  const observed = rows.filter(r => r.status === 'comparable').length;
  let total: DecimalEvidence | null = null; let totalLabel: string | null = null;
  if (query.level === 'stock' && query.stockId && metric === 'shares' && observed) {
    const sum = rows.filter(r => r.delta?.value !== null).reduce((v, r) => decimalOp(v, r.delta?.value ?? '0', 'add'), '0');
    total = { value: sum, raw: sum, precision: 'exact', upperBound: null, upperInclusive: false };
    totalLabel = observed === response.cohort.funds.length ? '完整研究組同股合計' : '可比子樣本同股合計';
  }
  const trendAvailable = response.resolved.dates.length === response.requested.window + 1
    && response.series.length > 0 && response.series.every(s => s.points.every(p => p.status === 'observed' && p.precision === 'exact'));
  return { ...response, rows, coverage: { observed, expected: response.cohort.funds.length, complete: observed === response.cohort.funds.length && observed > 0 },
    endpointAvailable: observed > 0, trendAvailable, total, totalLabel };
}
function cursorInfo(query: Record<string, string>, publicationId: string): { offset: number } {
  if (!query.cursor) return { offset: 0 };
  const c = decode(query.cursor);
  if (c.publicationId !== publicationId || !Number.isSafeInteger(c.offset) || Number(c.offset) < 0
    || c.selectionHash !== canonical({ fundIds: query.fundIds || '', stockId: query.stockId || '', industryId: query.industryId || '' })) {
    fail('cursor_mismatch', '分頁條件或發布版本已變更。', 409);
  }
  return { offset: Number(c.offset) };
}
function nextCursor(publicationId: string, offset: number, query: Record<string, string>) {
  return encode({ publicationId, offset,
    selectionHash: canonical({ fundIds: query.fundIds || '', stockId: query.stockId || '', industryId: query.industryId || '' }) });
}
async function pageHoldings(set: SealedSet, ids: string[], readSize: () => number,
  append: (row: DataRecord) => boolean): Promise<void> {
  for (let start = 0; start < ids.length;) {
    // One lookahead preserves the existing next-cursor boundary without loading
    // a whole set merely to return a single bounded response page.
    const size = Math.min(80, Math.max(1, readSize()));
    const rows = await holdings(set, ids.slice(start, start + size));
    for (const row of rows) if (!append(row)) return;
    start += size;
  }
}
export async function dataQuery(query: Record<string, string>): Promise<DataResponse> {
  const scopeId = scope(query); const requestedDate = date(query.date) as string;
  const pin = queryPin(query); const publication = await publicationForDate(scopeId, requestedDate, pin);
  const response: DataResponse = { schemaVersion: 2, scopeId, status: publication ? 'ready' : 'missing',
    requestedDate, publicationId: publication?.id ?? null, version: publication?.version ?? null,
    pin: query.pin || null, funds: [], sourceRefs: publication?.sourceRefs ?? [], missing: [],
    warnings: publication?.warnings ?? [], nextCursor: null };
  if (!publication) {
    response.missing = [{ date: requestedDate, fundId: null, reason: 'no_published_data', message: REASONS.no_published_data }];
    return response;
  }
  const lastRef = pin ? pin.refs[pin.refs.length - 1] : undefined;
  const cohortPublication = lastRef?.[1] ? await getPublication(lastRef[1]) : publication;
  const cohort = cohortPublication.fundSelections;
  const selectedFunds = query.fundIds ? query.fundIds.split(',') : cohort.map(f => f.fundId);
  if (selectedFunds.length > 5 || new Set(selectedFunds).size !== selectedFunds.length
    || selectedFunds.some(id => !cohort.some(f => f.fundId === id))) fail('cohort_mismatch', '基金不在固定截至日研究組內。');
  const cursor = cursorInfo(query, publication.id); let offset = 0; let included = 0; let hasMore = false;
  for (const fund of cohort.filter(f => selectedFunds.includes(f.fundId))) {
    if (!publication.sets[fund.fundId]) {
      response.missing.push({ date: requestedDate, fundId: fund.fundId, reason: 'no_published_data', message: '固定截至日基金在此日期沒有公開資料。' });
      response.status = 'partial'; continue;
    }
    const set = await getSet(publication.sets[fund.fundId]);
    const ids = await members(set);
    let filteredIds = query.stockId ? ids.filter(id => id === query.stockId) : ids;
    const metrics = set.metricsId ? await read<DataRecord>(partition(FACT_TABLES.metrics, scopeId, set.requestedDate), set.metricsId) : null;
    const allocations = await readMany<DataRecord>(partition(T.allocations, scopeId, set.requestedDate), set.allocationIds);
    if (allocations.some(r => !r)) fail('allocation_integrity', '產業彙整資料缺漏。', 503);
    const detail: DataFund = { fund, setId: set.id, requestedDate: set.requestedDate, holdingDate: set.holdingDate,
      dateAlignment: set.dateAlignment, stockListCompleteness: set.stockListCompleteness,
      officialVerification: set.officialVerification, metrics: metrics ? publicRow(metrics) : null,
      holdings: [], allocations: (allocations as DataRecord[]).filter(r => !query.industryId || r.industryId === query.industryId).map(publicRow),
      reportedChanges: [] };
    const append = (kind: 'holding' | 'change', row: DataRecord): boolean => {
      if (query.stockId && row.securityId !== query.stockId) return true;
      if (query.industryId && row.industryId !== query.industryId && row.researchSectorId !== query.industryId) return true;
      if (offset++ < cursor.offset) return true;
      if (included >= 100 || bytes(response) + bytes(detail) + bytes(row) > MAX_DATA_BYTES - 12000) { hasMore = true; return false; }
      (kind === 'holding' ? detail.holdings : detail.reportedChanges).push(publicRow(row));
      included++; return true;
    };
    if (!query.industryId) {
      // Stock IDs are already filtered by the verified membership index. Only
      // an industry filter needs row reads to count earlier matching results.
      const skipped = Math.min(filteredIds.length, Math.max(0, cursor.offset - offset));
      offset += skipped; filteredIds = filteredIds.slice(skipped);
    }
    await pageHoldings(set, filteredIds, () => query.industryId ? 80 : 101 - included, row => append('holding', row));
    if (!hasMore) {
      let changeRefs = set.changeRefs;
      if (!query.stockId && !query.industryId) {
        const skipped = Math.min(changeRefs.length, Math.max(0, cursor.offset - offset));
        offset += skipped; changeRefs = changeRefs.slice(skipped);
      }
      for (const ref of changeRefs) {
        const change = await read<DataRecord>(ref.table, ref.id);
        if (!change) fail('change_integrity', '來源異動資料缺漏。', 503);
        if (!append('change', change)) break;
      }
    }
    response.funds.push(detail);
    if (hasMore) break;
  }
  if (hasMore) response.nextCursor = nextCursor(publication.id, cursor.offset + included, query);
  if (bytes(response) > MAX_DATA_BYTES) fail('response_too_large', '資料明細超過回應上限，請選單一基金或股票。', 413);
  return response;
}
function priorMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? String(year - 1) + '-12' : String(year) + '-' + String(number - 1).padStart(2, '0');
}
export async function catalogQuery(query: Record<string, string>): Promise<CatalogResponse> {
  const scopeId = scope(query); const latestPublishedDate = await latest(scopeId);
  let selectedDate = query.date ? date(query.date) : latestPublishedDate;
  const pin = queryPin(query);
  const resolvedPinnedDate = pin?.refs[pin.refs.length - 1]?.[0];
  if (pin && selectedDate === pin.end && !pin.refs.some(r => r[0] === selectedDate) && resolvedPinnedDate) selectedDate = resolvedPinnedDate;
  const response: CatalogResponse = { schemaVersion: 2, scopeId, latestPublishedDate, selectedDate,
    dates: [], funds: [], industries: [], stocks: [], publicationId: null, version: null,
    nextCursor: null, warnings: [] };
  if (latestPublishedDate) {
    let month = latestPublishedDate.slice(0, 7);
    for (let i = 0; i < 12; i++) {
      const record = await read<{ dates: string[] }>(T.catalog, await key(scopeId, month));
      for (const day of record?.dates ?? []) if (await getHead(scopeId, day)) response.dates.push(day);
      month = priorMonth(month);
    }
    response.warnings.push('日期選單列出最近12個月索引；可直接輸入更早日期查詢。');
  }
  if (!selectedDate) return response;
  const publication = await publicationForDate(scopeId, selectedDate, pin);
  if (!publication) { response.warnings.push(REASONS.no_published_data); return response; }
  response.funds = publication.fundSelections; response.publicationId = publication.id; response.version = publication.version;
  const data = await dataQuery({ ...query, date: selectedDate, scopeId });
  const stocks = new Map<string, CatalogResponse['stocks'][number]>();
  const industries = new Map<string, CatalogResponse['industries'][number]>();
  const securityIds = await Promise.all(data.funds.flatMap(f => f.holdings).map(row => row.securityIdentityRevision
    ? key(row.securityId, row.securityIdentityRevision) : String(row.securityId)));
  const uniqueIds = [...new Set(securityIds)];
  const securities = await readMany<DataRecord>(FACT_TABLES.security, uniqueIds);
  const identities = new Map(uniqueIds.map((id, index) => [id, securities[index]]));
  let holdingIndex = 0;
  for (const fund of data.funds) {
    for (const row of fund.holdings) {
      const security = identities.get(securityIds[holdingIndex++]);
      const identifiers = Array.isArray(security?.identifiers) ? security.identifiers as Record<string, unknown>[] : [];
      const current = identifiers.find(i => String(i.validFrom) <= selectedDate && (i.validTo === null || String(i.validTo) > selectedDate));
      stocks.set(String(row.securityId), { securityId: String(row.securityId),
        code: current ? String(current.code) : String(row.sourceCode ?? row.securityId), name: String(row.sourceName) });
    }
    for (const row of fund.allocations) industries.set(String(row.industryId), {
      industryId: String(row.industryId), label: String(row.label), taxonomyVersion: String(row.taxonomyVersion),
    });
  }
  response.stocks = Array.from(stocks.values()); response.industries = Array.from(industries.values());
  response.nextCursor = data.nextCursor; response.warnings.push(...data.warnings);
  return response;
}

export async function privatePreview(batchId: string, input: Record<string, unknown>) {
  const batch = await batchById(batchId);
  const funds: DataFund[] = [];
  const signature = canonical({ fundId: input.fundId || '', setId: input.setId || '' });
  const next = input.cursor ? decode(String(input.cursor)) : null;
  if (next && (next.batchId !== batchId || next.revision !== batch.revision || next.signature !== signature)) {
    fail('cursor_mismatch', '任務版本或預覽條件已變更，請重新載入。', 409);
  }
  const start = Number(next?.offset ?? 0);
  if (!Number.isSafeInteger(start) || start < 0) fail('invalid_cursor', '預覽游標格式錯誤。');
  const selected = batch.manifest.sets.filter(s => (!input.fundId || s.fundId === input.fundId)
    && (!input.setId || s.setId === input.setId));
  let offset = 0; let included = 0; let hasMore = false;
  if (batch.validation?.complete) for (const item of selected) {
    const set = await getSet(item.setId);
    if (set.batchId !== batchId) fail('set_integrity', '集合不屬於此任務。', 409);
    const fund = batch.manifest.fundSelections.find(f => f.fundId === set.fundId)
      ?? { fundId: set.fundId, securityId: set.fundId, code: set.fundId, name: set.fundId };
    const metrics = set.metricsId ? await read<DataRecord>(partition(FACT_TABLES.metrics, set.scopeId, set.requestedDate), set.metricsId) : null;
    const allocations = await readMany<DataRecord>(partition(T.allocations, set.scopeId, set.requestedDate), set.allocationIds);
    if (allocations.some(r => !r)) fail('set_integrity', '私有封存資料缺漏。', 503);
    const detail: DataFund = { fund, setId: set.id, requestedDate: set.requestedDate, holdingDate: set.holdingDate,
      dateAlignment: set.dateAlignment, stockListCompleteness: set.stockListCompleteness,
      officialVerification: set.officialVerification, metrics: metrics ? publicRow(metrics) : null,
      holdings: [], allocations: (allocations as DataRecord[]).map(publicRow), reportedChanges: [] };
    const append = (kind: 'holding' | 'change', row: DataRecord) => {
      if (offset++ < start) return true;
      if (included >= 100 || bytes(funds) + bytes(detail) + bytes(row) > MAX_DATA_BYTES - 24000) {
        hasMore = true; return false;
      }
      (kind === 'holding' ? detail.holdings : detail.reportedChanges).push(publicRow(row));
      included++; return true;
    };
    const ids = await members(set);
    const skippedHoldings = Math.min(ids.length, Math.max(0, start - offset));
    offset += skippedHoldings;
    await pageHoldings(set, ids.slice(skippedHoldings), () => 101 - included, row => append('holding', row));
    if (!hasMore) {
      const skippedChanges = Math.min(set.changeRefs.length, Math.max(0, start - offset));
      offset += skippedChanges;
      for (const ref of set.changeRefs.slice(skippedChanges)) {
        const change = await read<DataRecord>(ref.table, ref.id);
        if (!change) fail('set_integrity', '私有來源異動資料缺漏。', 503);
        if (!append('change', change)) break;
      }
    }
    funds.push(detail);
    if (hasMore) break;
  }
  const sealedSets = batch.validation?.complete ? await Promise.all(batch.manifest.sets.map(s => getSet(s.setId))) : [];
  const sourceIds = [...new Set([...batch.manifest.sets.flatMap(s => s.sourceDocumentIds), ...sealedSets.flatMap(s => s.classificationSourceIds)])];
  const sources = await readMany<DataRecord>(FACT_TABLES.source, sourceIds);
  return { batchId, revision: batch.revision, status: batch.status, funds,
    sourceRefs: sources.filter((r): r is DataRecord => !!r).map(r => ({
      sourceDocumentId: r.sourceDocumentId, provider: r.provider, url: r.url, declaredDate: r.declaredDate,
      valuationDate: r.valuationDate, retrievedAt: r.retrievedAt, contentHash: r.contentHash, officialStatus: r.officialStatus,
    })), validation: batch.validation, reason: batch.validation?.complete ? null : 'not_sealed',
    currentHead: await getHead(batch.manifest.scopeId, batch.manifest.requestedDate),
    nextCursor: hasMore ? encode({ batchId, revision: batch.revision, signature, offset: start + included }) : null };
}
