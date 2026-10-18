import {
  DATA_SCOPE, QA_DATA_SCOPE, FACT_TABLES, MAX_DATA_BYTES, bytes, canonical, date, decimalOp, hash, identity, key,
} from '../shared/etf-data-contract.ts';
import type {
  DataRecord, DecimalEvidence, IndustryFlowPoint, IndustryFlowResponse, Publication, SealedSet,
} from '../shared/etf-data-contract.ts';
import { T, fail, getHead, getPublication, getSet, partition, read, readMany } from './etf-data-store.ts';

const DAY = 86400000;
type FlowPin = { kind: 'industry-flow-v1'; scopeId: string; end: string; fundId: string;
  industryId: string | null; refs: [string, string | null][] };
type Session = { calendarId: string; calendarVersion: string; date: string;
  isTradingDay: boolean; previousSessionDate: string | null; calendarCoveredThrough: string };
export function threeMonthWindow(end: string) {
  date(end);
  const [year, month, day] = end.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 4, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  const start = new Date(target.getTime() + DAY).toISOString().slice(0, 10);
  const dates: string[] = [];
  for (let time = Date.parse(start + 'T00:00:00Z'); time <= Date.parse(end + 'T00:00:00Z'); time += DAY) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return { start, dates };
}
function decode(value: string): Record<string, unknown> {
  if (value.length > 18000) fail('invalid_pin', '查詢版本識別過長。');
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { return fail('invalid_pin', '查詢版本識別無效。'); }
}
function encodePin(pin: FlowPin): string {
  const refs = pin.refs.map(([_day, id], index) => {
    const compact = id && /^[a-f0-9]{64}$/.test(id)
      ? 'h:' + btoa(id.match(/../g)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join(''))
      : id;
    return [index, compact];
  });
  return btoa(JSON.stringify({ ...pin, kind: 'industry-flow-v2', refs }));
}
function readPin(value: string | undefined, scopeId: string): FlowPin | null {
  if (!value) return null;
  const p = decode(value);
  if (p.kind === 'industry-flow-v2') {
    if (typeof p.end !== 'string' || !Array.isArray(p.refs)) fail('invalid_pin', '查詢版本識別無效。');
    const days = threeMonthWindow(p.end as string).dates;
    if ((p.refs as unknown[]).length !== days.length) fail('invalid_pin', '查詢日期範圍不一致。');
    p.refs = (p.refs as unknown[]).map((value, index) => {
      if (!Array.isArray(value) || value.length !== 2 || value[0] !== index) {
        fail('invalid_pin', '日期版本格式無效。');
      }
      let id: unknown = value[1];
      if (typeof id === 'string' && id.startsWith('h:')) {
        try {
          const binary = atob(id.slice(2));
          if (binary.length !== 32) throw new Error();
          id = Array.from(binary, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        } catch { fail('invalid_pin', '發布版本格式無效。'); }
      }
      return [days[index], id];
    });
    p.kind = 'industry-flow-v1';
  }
  if (p.kind !== 'industry-flow-v1' || p.scopeId !== scopeId || !Array.isArray(p.refs) || p.refs.length > 93
    || typeof p.end !== 'string' || typeof p.fundId !== 'string') fail('invalid_pin', '查詢版本識別無效。');
  date(p.end); identity(p.fundId);
  if (scopeId === DATA_SCOPE && p.fundId.startsWith('qa-')) fail('invalid_scope', '測試基金不屬於研究資料。');
  if (p.industryId !== null) identity(p.industryId);
  for (const ref of p.refs) {
    if (!Array.isArray(ref) || ref.length !== 2) fail('invalid_pin', '日期版本格式無效。');
    date(ref[0]); if (ref[1] !== null) identity(ref[1]);
  }
  const result = p as unknown as FlowPin;
  if (canonical(result.refs.map(r => r[0])) !== canonical(threeMonthWindow(result.end).dates)) {
    fail('invalid_pin', '查詢日期範圍不一致。');
  }
  return result;
}
function blank(day: string, reason: string): IndustryFlowPoint {
  return { date: day, valueNtd: null, precision: 'unknown', status: 'missing',
    reason, intervalStart: null, observedStocks: 0, classificationVersion: null, classificationChanged: false };
}
export function estimatePoint(day: string, set: SealedSet, changes: DataRecord[],
  industryId: string, previousSession: string | null, endClassification: string | null): IndustryFlowPoint {
  const p = blank(day, 'source_estimate_unavailable');
  p.classificationVersion = set.classificationVersion;
  p.classificationChanged = !!endClassification && set.classificationVersion !== endClassification;
  if (set.dateAlignment !== 'confirmed' || set.holdingDate !== day) {
    return { ...p, status: 'not_comparable', reason: 'unconfirmed_date' };
  }
  if (p.classificationChanged) return { ...p, status: 'not_comparable', reason: 'classification_change' };
  const rows = changes.filter(r => r.endDate === day && r.industryId === industryId);
  if (!rows.length) return p;
  // A reported list is a sample: absence of a stock or sector never establishes zero.
  p.observedStocks = rows.length;
  const starts = new Set(rows.map(r => r.startDate));
  const methods = new Set(rows.map(r => r.estimateMethod));
  if (starts.size !== 1 || methods.size !== 1 || !rows[0].estimateMethod
    || new Set(rows.map(r => r.securityId)).size !== rows.length) return p;
  p.intervalStart = String(rows[0].startDate);
  const previousCivilDate = new Date(Date.parse(day + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
  if (p.intervalStart !== previousCivilDate && p.intervalStart !== previousSession) {
    return { ...p, status: 'not_comparable', reason: 'missing_baseline' };
  }
  if (rows.some(r => !r.priceAsOf || !set.sourceDocumentIds.includes(String(r.sourceDocumentId))
    || String(r.priceAsOf) < p.intervalStart! || String(r.priceAsOf) > day)) return p;
  const estimates = rows.map(r => r.estimateNtd as DecimalEvidence | undefined);
  if (estimates.some(v => !v || v.precision !== 'exact' || v.value === null)) {
    return { ...p, status: 'unknown', reason: 'imprecise_value' };
  }
  p.valueNtd = estimates.reduce((sum, value) => decimalOp(sum, value!.value!, 'add'), '0');
  p.status = 'observed'; p.precision = 'exact'; p.reason = null;
  return p;
}
async function changesFor(set: SealedSet): Promise<DataRecord[]> {
  if (set.changeRefs.length > 5000) fail('query_too_large', '單日來源筆數超過查詢上限。', 413);
  const groups = new Map<string, string[]>();
  for (const ref of set.changeRefs) {
    if (ref.table !== partition(FACT_TABLES.change, set.scopeId, set.requestedDate)) fail('invalid_scope', '資料來源不屬於研究範圍。', 503);
    groups.set(ref.table, [...(groups.get(ref.table) || []), ref.id]);
  }
  const results = await Promise.all([...groups].map(([table, ids]) => readMany<DataRecord>(table, ids)));
  const rows = results.flat();
  if (rows.some(r => !r)) fail('change_integrity', '已發布來源異動資料缺漏，請重試。', 503);
  const changes = rows as DataRecord[];
  if (changes.some(r => r.fundId !== set.fundId || r.setId !== set.id)) fail('change_integrity', '來源異動與基金不一致。', 503);
  return changes;
}
export async function industryHistoryQuery(query: Record<string, string>): Promise<IndustryFlowResponse> {
  if ((query.scopeId && query.scopeId !== DATA_SCOPE) || query.dataset) {
    fail('invalid_scope', '此查詢只提供已發布研究資料，不接受測試範圍。');
  }
  return flowQuery(query, DATA_SCOPE);
}
export async function qaIndustryHistoryQuery(query: Record<string, string>): Promise<IndustryFlowResponse> {
  if (query.dataset !== 'synthetic' || query.scopeId && query.scopeId !== QA_DATA_SCOPE) {
    fail('invalid_scope', '隔離測試查詢必須明確指定 synthetic。');
  }
  return flowQuery(query, QA_DATA_SCOPE);
}
async function flowQuery(query: Record<string, string>, scopeId: string): Promise<IndustryFlowResponse> {
  const pin = readPin(query.pin, scopeId);
  const response: IndustryFlowResponse = {
    schemaVersion: 1, scopeId, status: 'missing', start: null, end: null,
    dates: [], funds: [], fundId: null, industryId: null, industries: [], series: [],
    publishedDays: 0, calendar: {}, pin: null, nextCursor: null, provenance: [], warnings: [],
  };
  const root = pin ? null : await read<{ latestDate: string }>(T.catalog, await key(scopeId, 'catalog'));
  const end = pin?.end || root?.latestDate;
  if (!end) return response;
  date(end);
  const window = threeMonthWindow(end);
  response.start = window.start; response.end = end; response.dates = window.dates;
  const refs: [string, string | null][] = pin?.refs || [];
  if (!pin) {
    const heads = await readMany<{ publicationId: string }>(T.heads,
      await Promise.all(window.dates.map(day => key(scopeId, day))));
    window.dates.forEach((day, i) => refs.push([day, heads[i]?.publicationId || null]));
    if (!refs.at(-1)?.[1] || !(await getHead(scopeId, end))) return response;
  }
  const publications = new Map<string, Publication>();
  for (let i = 0; i < refs.length; i += 5) {
    const group = refs.slice(i, i + 5).filter((r): r is [string, string] => !!r[1]);
    const values = await Promise.all(group.map(r => getPublication(r[1])));
    values.forEach((pub, n) => {
      if (pub.scopeId !== scopeId || pub.tradeDate !== group[n][0]
        || scopeId === DATA_SCOPE && pub.fundSelections.some(f => f.fundId.startsWith('qa-') || f.code.startsWith('QA'))) {
        fail('invalid_scope', '發布資料不屬於研究範圍。', 409);
      }
      publications.set(pub.tradeDate, pub);
    });
  }
  const ending = publications.get(end);
  if (!ending) fail('pin_end_missing', '查詢截止日尚無已發布資料。', 409);
  response.funds = ending.fundSelections;
  const requestedFund = query.fundId ? identity(query.fundId) : pin?.fundId;
  if (scopeId === DATA_SCOPE && requestedFund?.startsWith('qa-')) fail('invalid_scope', '測試基金不屬於研究資料。');
  const fund = response.funds.find(f => f.fundId === requestedFund) || response.funds[0];
  if (!fund) return response;
  if (requestedFund && requestedFund !== fund.fundId) response.warnings.push('原選基金已不在最新發布研究組，已選擇第一檔可用基金。');
  response.fundId = fund.fundId;
  const requestedIndustry = query.industryId ? identity(query.industryId) : null;
  if (pin && (pin.fundId !== fund.fundId || pin.industryId !== requestedIndustry)) {
    fail('pin_query_conflict', '篩選條件與查詢版本不一致。', 409);
  }
  const sets = new Map<string, { set: SealedSet; changes: DataRecord[] }>();
  const labels = new Map<string, string>();
  for (let i = 0; i < refs.length; i += 4) {
    await Promise.all(refs.slice(i, i + 4).map(async ([day]) => {
      response.calendar[day] = 'unknown';
      const pub = publications.get(day);
      if (!pub) return;
      const setId = pub.sets[fund.fundId];
      if (!setId) return;
      const set = await getSet(setId);
      if (set.scopeId !== scopeId || set.fundId !== fund.fundId || set.requestedDate !== day) {
        fail('set_integrity', '發布集合範圍不一致。', 503);
      }
      const [changes, allocations] = await Promise.all([
        changesFor(set), readMany<DataRecord>(partition(T.allocations, scopeId, day), set.allocationIds),
      ]);
      if (allocations.some(r => !r)) fail('allocation_integrity', '已發布產業分類缺漏。', 503);
      for (const row of allocations as DataRecord[]) labels.set(String(row.industryId), String(row.label));
      for (const row of changes) if (typeof row.industryId === 'string' && !labels.has(row.industryId)) {
        labels.set(row.industryId, typeof row.industryLabel === 'string' ? row.industryLabel : row.industryId);
      }
      sets.set(day, { set, changes });
    }));
  }
  // Calendar slots are civil dates, never guessed market sessions. Only published,
  // verified calendar records can mark a date as a trading day or closure.
  const calendarId = ending.calendarId; const calendarVersion = ending.calendarVersion;
  const sessions = calendarId && calendarVersion ? await readMany<Session>(FACT_TABLES.session,
    await Promise.all(window.dates.map(day => key(calendarId, calendarVersion, day)))) : [];
  const previous = new Map<string, string | null>();
  window.dates.forEach((day, i) => {
    const s = sessions[i];
    if (s && s.calendarId === calendarId && s.calendarVersion === calendarVersion && s.date === day
      && s.calendarCoveredThrough >= day) {
      response.calendar[day] = s.isTradingDay ? 'trading' : 'closed';
      previous.set(day, s.previousSessionDate);
    }
  });
  response.industries = [...labels].map(([industryId, label]) => ({ industryId, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-TW'));
  response.industryId = requestedIndustry && labels.has(requestedIndustry) ? requestedIndustry : null;
  if (requestedIndustry && !response.industryId) response.warnings.push('原選產業在此期間無發布資料，已顯示全部產業。');
  const token: FlowPin = { kind: 'industry-flow-v1', scopeId, end, fundId: fund.fundId,
    industryId: response.industryId, refs };
  response.pin = encodePin(token);
  const catalog = response.industries.filter(item => !response.industryId || item.industryId === response.industryId);
  const cursor = query.cursor ? decode(query.cursor) : null;
  const pinHash = await hash(response.pin);
  const matchesCursor = cursor?.pinHash === pinHash || cursor?.pin === response.pin
    || !!query.pin && cursor?.pin === query.pin;
  if (cursor && (cursor.kind !== 'industry-flow-page' || !matchesCursor
    || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0)) {
    fail('cursor_mismatch', '分頁篩選或發布版本已變更。', 409);
  }
  let offset = Number(cursor?.offset || 0);
  response.publishedDays = sets.size;
  const endClassification = sets.get(end)?.set.classificationVersion || null;
  response.provenance = [...publications.values()].map(pub => {
    const selectedSet = sets.get(pub.tradeDate)?.set;
    const sourceIds = new Set([
      ...(selectedSet?.sourceDocumentIds || []),
      ...(selectedSet?.classificationSourceIds || []),
    ]);
    // A full quarter must fit without duplicating unrelated funds' evidence.
    // Publication hashes retain the complete immutable publication lineage.
    return {
      date: pub.tradeDate, publicationId: pub.id, publicationHash: pub.publicationHash,
      setId: pub.sets[fund.fundId] || null,
      sourceRefs: pub.sourceRefs.filter(ref => sourceIds.has(ref.sourceDocumentId)),
      classificationVersion: selectedSet?.classificationVersion || null,
    };
  });
  if (scopeId === QA_DATA_SCOPE) response.warnings.push('合成測試資料：基金、產業、日期與金額均為虛構，不是市場研究。');
  response.warnings.push('依持倉變化估算，非實際成交金額；僅代表有來源金額的異動樣本，未列項目不等於零。');
  if (!calendarId || Object.values(response.calendar).some(v => v === 'unknown')) {
    response.warnings.push('部分日期尚無核對日曆；橫軸為曆日，不能據此認定交易日或休市。');
  }
  for (; offset < catalog.length; offset++) {
    const item = catalog[offset];
    const points = [...sets].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) =>
      estimatePoint(day, value.set, value.changes, item.industryId, previous.get(day) || null, endClassification));
    response.series.push({ ...item, points });
    if (bytes(response) > MAX_DATA_BYTES - 22000) {
      response.series.pop();
      if (!response.series.length) fail('query_too_large', '單一產業資料超過回應上限。', 413);
      response.nextCursor = btoa(JSON.stringify({ kind: 'industry-flow-page', pinHash, offset }));
      break;
    }
  }
  const observed = response.series.flatMap(s => s.points).filter(p => p.status === 'observed').length;
  response.status = observed ? 'partial' : 'missing';
  if (bytes(response) > MAX_DATA_BYTES) fail('query_too_large', '查詢資料超過回應上限。', 413);
  return response;
}
