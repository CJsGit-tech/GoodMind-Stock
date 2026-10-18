import { db, isAppDatabaseError } from '@appdeploy/sdk';
import type { DbOperation } from '@appdeploy/sdk';
import {
  DATA_SCOPE, QA_DATA_SCOPE, FACT_TABLES, MAX_CHUNK_BYTES, MAX_CHUNK_FACTS, MAX_DATA_BYTES,
  MAX_MEMBER_BYTES, bytes, canonical, date, decimal, decimalOp, hash, identity,
  integer, key, object, parseManifest, sourceRef, text, unknownDecimal,
} from '../shared/etf-data-contract.ts';
import type {
  Batch, DataRecord, DecimalEvidence, FactInput, FactKind, FactRef,
  MembershipPage, Publication, ReceiptResult, SealedSet, ValidationSummary,
} from '../shared/etf-data-contract.ts';

export const OWNER = 'staging-master-secret-author';
export const T = {
  batches: 'etf_data_batches_v2', locators: 'etf_data_batch_locators_v2',
  sets: 'etf_observation_sets_v2', members: 'etf_dataset_members_v2',
  allocations: 'etf_daily_sector_allocations_v2', publications: 'etf_publications_v2',
  heads: 'etf_publication_heads_v2', receipts: 'etf_publication_receipts_v2',
  catalog: 'etf_publication_catalog_v2',
  operations: 'etf_data_operation_locks_v2',
};
export class DataFailure extends Error {
  constructor(public status: number, public code: string, message: string,
    public details: Record<string, unknown> = {}) { super(message); }
}
export type Head = { publicationId: string; version: number; hash: string; updatedAt: string };
type Locator = { ownerKey: string; month: string };
type Chunk = { id: string; batchId: string; chunkNo: number; chunkHash: string; refs: FactRef[] };
type Receipt = ReceiptResult & { ownerKey: string; fingerprint: string; createdAt: string };
export type CatalogRoot = { latestDate: string; revision: number };
type CatalogMonth = { dates: string[]; revision: number };
export type ReportCommit = {
  operations: DbOperation<unknown>[]; snapshotId: string;
};
export type PrepareReport = (input: Record<string, unknown>, publication: Publication) => Promise<ReportCommit>;
export function fail(code: string, message: string, status = 400, details = {}): never {
  throw new DataFailure(status, code, message, details);
}
export async function read<TValue>(table: string, id: string): Promise<TValue | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = (await db.get<TValue>(table, [id], { consistent: true }))[0];
      await verifyFact(result); return result;
    }
    catch (caught) {
      if (!isAppDatabaseError(caught) || !['AppDatabaseReadIncomplete', 'AppDatabaseGatewayUnavailable'].includes(caught.code)
        || attempt === 1) throw caught;
    }
  }
  return null;
}
async function verifyFact(value: unknown) {
  if (!value || typeof value !== 'object' || !('payloadHash' in value)) return;
  const { payloadHash, ...body } = value as Record<string, unknown>;
  if (typeof payloadHash !== 'string' || await hash(body) !== payloadHash) fail('fact_integrity', '金融事實雜湊不符。', 503);
}
export async function readMany<TValue>(table: string, ids: string[]): Promise<(TValue | null)[]> {
  const result: (TValue | null)[] = [];
  for (let start = 0; start < ids.length; start += 80) {
    const group = ids.slice(start, start + 80);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = await db.get<TValue>(table, group, { consistent: true });
        await Promise.all(rows.map(verifyFact)); result.push(...rows); break;
      }
      catch (caught) {
        if (!isAppDatabaseError(caught) || !['AppDatabaseReadIncomplete', 'AppDatabaseGatewayUnavailable'].includes(caught.code)
          || attempt === 1) throw caught;
      }
    }
  }
  return result;
}
async function readReferences(refs: Pick<FactRef, 'table' | 'id'>[]): Promise<(DataRecord | null)[]> {
  const groups = new Map<string, { id: string; index: number }[]>();
  refs.forEach((ref, index) => {
    const group = groups.get(ref.table) ?? [];
    group.push({ id: ref.id, index }); groups.set(ref.table, group);
  });
  const rows: (DataRecord | null)[] = new Array(refs.length).fill(null);
  // A batch has a bounded set of fact tables. Each table uses <=80 chosen IDs
  // per read; retain the original cross-table order for the reviewed hash.
  const results = await Promise.allSettled([...groups].map(async ([table, group]) => {
    const values = await readMany<DataRecord>(table, group.map(ref => ref.id));
    values.forEach((value, index) => { rows[group[index].index] = value; });
  }));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  const quota = failures.find(result => isAppDatabaseError(result.reason) && result.reason.code === 'AppDatabaseQuotaExceeded');
  if (quota) throw quota.reason;
  if (failures.length) throw failures[0].reason;
  return rows;
}
export function partition(base: string, scopeId: string, requestedDate: string): string {
  // Scope is a server-owned enum; arbitrary partition names never cross the API.
  if (![DATA_SCOPE, QA_DATA_SCOPE].includes(scopeId)) fail('invalid_scope', '不支援的研究範圍。');
  date(requestedDate);
  return base + (scopeId === QA_DATA_SCOPE ? '_qa_' : '_tw_') + requestedDate.slice(0, 7).replace('-', '');
}
export const batchTable = (month: string) => T.batches + '_author_' + month.replace('-', '');
export async function headId(scopeId: string, value: string) { return key(scopeId, value); }
export async function getHead(scopeId: string, value: string): Promise<Head | null> {
  return read<Head>(T.heads, await headId(scopeId, value));
}
export async function getPublication(id: string): Promise<Publication> {
  identity(id);
  const publication = await read<Publication>(T.publications, id);
  if (!publication || publication.published !== true) fail('not_found', '找不到已發布日資料。', 404);
  const { publicationHash: storedHash, ...payload } = publication;
  if (await hash(payload) !== storedHash) fail('publication_integrity', '已發布資料完整性無法確認。', 503);
  return publication;
}
export async function getSet(id: string): Promise<SealedSet> {
  identity(id);
  const set = await read<SealedSet>(T.sets, id);
  if (!set || !set.sealedAt) fail('set_integrity', '觀測集合尚未完整封存。', 503);
  return set;
}
export async function members(set: SealedSet): Promise<string[]> {
  const pages = await readMany<MembershipPage>(T.members,
    await Promise.all(set.membershipManifest.map(p => key(set.id, p.pageNo))));
  const ids: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]; const ref = set.membershipManifest[i];
    if (!page || page.setId !== set.id || page.pageNo !== i
      || page.pageHash !== ref.pageHash || page.rowCount !== page.sortedSecurityIds.length
      || await hash(page.sortedSecurityIds) !== ref.pageHash) {
      fail('membership_integrity', '持股索引頁缺漏或雜湊不符。', 503);
    }
    ids.push(...page.sortedSecurityIds);
  }
  if (ids.length !== set.rowCount || new Set(ids).size !== ids.length
    || canonical([...ids].sort()) !== canonical(ids)) fail('membership_integrity', '持股索引筆數不一致。', 503);
  return ids;
}
export async function holdings(set: SealedSet, securityIds: string[]): Promise<DataRecord[]> {
  const table = partition(FACT_TABLES.holding, set.scopeId, set.requestedDate);
  const rows = await readMany<DataRecord>(table, await Promise.all(securityIds.map(id => key(set.id, id))));
  if (rows.some(r => !r)) fail('holding_integrity', '索引中的持股資料缺漏，不可視為零。', 503);
  return rows as DataRecord[];
}
export async function batchById(id: string): Promise<Batch> {
  identity(id);
  const location = await read<Locator>(T.locators, id);
  if (!location || location.ownerKey !== OWNER) fail('not_found', '找不到此資料任務。', 404);
  const batch = await read<Batch>(batchTable(location.month), id);
  if (!batch || batch.ownerKey !== OWNER) fail('not_found', '找不到此資料任務。', 404);
  return batch;
}
export function requireRevision(batch: Batch, expected: unknown) {
  if (integer(expected, '任務版本') !== batch.revision) {
    fail('revision_conflict', '任務已變更，請重新載入差異。', 409, { batch });
  }
}
function requestId(input: unknown): string { return identity(input, '請求識別碼'); }
export async function requestStatus(id: string, fingerprint?: string): Promise<ReceiptResult> {
  requestId(id);
  const saved = await read<Receipt>(T.receipts, id);
  if (!saved) return { requestId: id, state: 'unresolved' };
  if (saved.ownerKey !== OWNER || (fingerprint && fingerprint !== saved.fingerprint)) {
    fail('request_id_conflict', '請求識別碼已用於另一筆操作。', 409);
  }
  const { ownerKey: _owner, fingerprint: _fingerprint, createdAt: _time, ...result } = saved;
  return result;
}
export async function transact(action: string, id: string, payload: unknown, result: Omit<ReceiptResult, 'state' | 'requestId'>,
  build: () => Promise<DbOperation<unknown>[]>) {
  if (typeof db.transact !== 'function' || typeof db.tx?.add !== 'function') {
    fail('transaction_capability_unavailable', '目前服務不支援安全資料發布。', 503);
  }
  const fingerprint = await hash({ action, payload });
  const previous = await requestStatus(id, fingerprint);
  if (previous.state === 'committed') return previous;
  const lockId = result.batchId ? await key(OWNER, result.batchId) : null;
  type OperationLock = { ownerKey: string; requestId: string; fingerprint: string; state: string };
  const oldLock = lockId ? await read<OperationLock>(T.operations, lockId) : null;
  if (oldLock?.state === 'pending') {
    fail('outcome_unresolved', '此任務仍有結果未確認的操作，請先查詢原請求狀態。', 503,
      { requestId: oldLock.requestId, state: 'unresolved' });
  }
  if (lockId) {
    const record = { ownerKey: OWNER, requestId: id, fingerprint, state: 'pending' };
    try {
      const [saved] = oldLock ? await db.tx.update(T.operations, [{ id: lockId, record,
        if: { requestId: oldLock.requestId, state: oldLock.state } }])
        : await db.tx.add(T.operations, [{ id: lockId, ...record }]);
      if (!saved) fail('write_conflict', '另一筆操作已開始，請重新載入。', 409);
    } catch (caught) {
      if (caught instanceof DataFailure) throw caught;
      if (isAppDatabaseError(caught) && caught.code === 'AppDatabaseQuotaExceeded') throw caught;
      fail('outcome_unresolved', '操作預備狀態尚未確認，請先查詢原請求。', 503, { requestId: id, state: 'unresolved' });
    }
  }
  const receipt: Receipt = {
    ownerKey: OWNER, fingerprint, createdAt: new Date().toISOString(),
    requestId: id, state: 'committed', action, ...result,
  };
  let submitted = false;
  try {
    const operations = await build();
    submitted = true;
    await db.transact([...operations,
      ...(lockId ? [db.tx.update(T.operations, [{ id: lockId, record: { state: 'committed' },
        if: { requestId: id, fingerprint, state: 'pending' } }], { patch: true })] : []),
      db.tx.add(T.receipts, [{ id, ...receipt }])]);
    return receipt as ReceiptResult;
  } catch (caught) {
    if (!submitted && lockId) {
      try { await db.tx.update(T.operations, [{ id: lockId, record: { state: 'known_failed' }, if: { requestId: id, state: 'pending' } }], { patch: true }); }
      catch { /* Keep unresolved preparation locked when its release cannot be confirmed. */ }
    }
    if (!isAppDatabaseError(caught)) throw caught;
    const knownAborted = ['AppDatabaseQuotaExceeded', 'AppDatabaseConflict', 'AppDatabaseConditionFailed',
      'AppDatabaseTransactionTooLarge', 'AppDatabaseInvalidInput', 'AppDatabaseItemTooLarge'].includes(caught.code);
    if (knownAborted && lockId) {
      try { await db.tx.update(T.operations, [{ id: lockId, record: { state: 'known_failed' }, if: { requestId: id, state: 'pending' } }], { patch: true }); }
      catch { /* A failed advisory release stays pending and blocks cancellation. */ }
    }
    if (caught.code === 'AppDatabaseQuotaExceeded') throw caught;
    const reconciled = await requestStatus(id, fingerprint);
    if (reconciled.state === 'committed') return reconciled;
    if (['AppDatabaseUnknownOutcome', 'AppDatabaseGatewayUnavailable', 'AppDatabaseDuplicateId'].includes(caught.code)) {
      fail('outcome_unresolved', '操作結果尚未確認，請保留請求識別碼並查詢狀態。', 503,
        { requestId: id, state: 'unresolved' });
    }
    if (['AppDatabaseConflict', 'AppDatabaseConditionFailed'].includes(caught.code)) {
      fail('write_conflict', '其他視窗已更新資料，請重新載入後審閱。', 409, { requestId: id, state: 'known_failed' });
    }
    throw caught;
  }
}
export async function createBatch(input: Record<string, unknown>) {
  const id = requestId(input.requestId);
  const manifest = parseManifest(input.manifest);
  if (manifest.chunkCount < 1) fail('empty_manifest', '匯入任務至少需要一個資料批次。');
  const batchId = await key('batch', OWNER, id);
  const month = manifest.requestedDate.slice(0, 7);
  const time = new Date().toISOString();
  const batch: Batch = {
    id: batchId, ownerKey: OWNER, month, manifest, revision: 1, status: 'uploading',
    receivedChunks: [], validation: null, reviewedPayloadHash: null,
    reviewedAt: null, reviewedBy: null, createdAt: time, updatedAt: time, publicationId: null,
  };
  const result = await transact('create', id, manifest, { batchId, revision: 1 }, async () => [
    db.tx.add(T.locators, [{ id: batchId, ownerKey: OWNER, month }]),
    db.tx.add(batchTable(month), [{ ...batch }]),
  ]);
  return { ...result, batch: await batchById(batchId) };
}
function safeRaw(data: Record<string, unknown>) {
  // Session material is rejected rather than silently copied into persisted evidence.
  for (const name of Object.keys(data)) {
    if (/secret|password|sessionToken|authorization|cookie/i.test(name)) fail('secret_field', '資料包不可含登入憑證。');
    const value = data[name];
    if (Array.isArray(value)) value.forEach(item => { if (item && typeof item === 'object') safeRaw(object(item)); });
    else if (value && typeof value === 'object') safeRaw(object(value));
  }
}
async function prepareFact(input: FactInput, batch: Batch): Promise<{ ref: FactRef; record: DataRecord }> {
  if (!input || !(input.kind in FACT_TABLES)) fail('invalid_fact', '資料類別格式錯誤。');
  const d = object(input.data); safeRaw(d);
  if (batch.manifest.scopeId === QA_DATA_SCOPE) {
    for (const [name, value] of Object.entries(d)) {
      if (name.endsWith('Id') && value !== null && !String(value).startsWith('qa-')) {
        fail('qa_identity', '合成測試資料不可引用研究資料識別。');
      }
    }
  }
  const kind = input.kind;
  let tuple: unknown[] = [];
  let table = FACT_TABLES[kind];
  let setId: string | null = null;
  const record: Record<string, unknown> = { ...d, schemaVersion: 2 };
  delete record.id; delete record.payloadHash;
  const required = (...names: string[]) => names.forEach(name => identity(d[name], name));
  if (['metrics', 'holding', 'change'].includes(kind)) {
    required('setId', 'fundId');
    const set = batch.manifest.sets.find(s => s.setId === d.setId && s.fundId === d.fundId);
    if (!set) fail('unknown_set', '資料列不屬於此次觀測集合。');
    setId = set.setId;
    table = partition(table, batch.manifest.scopeId, set.requestedDate);
    record.requestedDate = set.requestedDate; record.holdingDate = set.holdingDate;
  }
  if (kind === 'fund') {
    required('fundId', 'securityId', 'code');
    text(d.name, '基金名稱', 100); text(d.issuer, '發行公司', 200);
    if (typeof d.domesticEquity !== 'boolean') fail('fund_scope', '基金股票範圍缺漏。');
    if (d.identityRevision !== undefined) identity(d.identityRevision, '身份修訂');
    tuple = [d.fundId, d.identityRevision ?? null];
    record.id = d.identityRevision ? await key(d.fundId, d.identityRevision) : d.fundId;
  } else if (kind === 'security') {
    required('securityId'); text(d.name, '證券名稱', 100);
    if (!Array.isArray(d.identifiers) || d.identifiers.length < 1 || d.identifiers.length > 30) fail('security_identifiers', '證券需要歷史市場與代碼識別。');
    for (const item of d.identifiers) {
      const identifier = object(item); identity(identifier.code); identity(identifier.market);
      date(identifier.validFrom); date(identifier.validTo, true);
    }
    if (d.identityRevision !== undefined) identity(d.identityRevision, '身份修訂');
    tuple = [d.securityId, d.identityRevision ?? null];
    record.id = d.identityRevision ? await key(d.securityId, d.identityRevision) : d.securityId;
  } else if (kind === 'industry') {
    required('industryId', 'taxonomyId', 'taxonomyVersion', 'industryCode', 'sourceDocumentId');
    text(d.label, '產業名稱', 100);
    if (!['official', 'research'].includes(String(d.classificationType))) fail('taxonomy_type', '正式產業與研究題材需明確分類。');
    tuple = [d.taxonomyId, d.taxonomyVersion, d.industryCode]; record.id = d.industryId;
  } else if (kind === 'assignment') {
    required('assignmentId', 'securityId', 'industryId', 'taxonomyId', 'taxonomyVersion', 'sourceDocumentId');
    date(d.validFrom); date(d.validTo, true);
    if (d.validTo !== null && String(d.validTo) <= String(d.validFrom)) fail('assignment_dates', '分類有效期間錯誤。');
    tuple = [d.assignmentId]; record.id = d.assignmentId;
  } else if (kind === 'source') {
    const ref = sourceRef(d); Object.assign(record, ref);
    if (d.privateRawStorageRef !== undefined && d.privateRawStorageRef !== null) {
      text(d.privateRawStorageRef, '私有來源路徑', 500);
      if (!String(d.privateRawStorageRef).startsWith('etf-private/')) fail('raw_path', '原始來源只能使用ETF私有路徑。');
    }
    tuple = [ref.sourceDocumentId]; record.id = ref.sourceDocumentId;
  } else if (kind === 'session') {
    required('calendarId', 'calendarVersion', 'sourceDocumentId'); date(d.date);
    date(d.calendarCoveredThrough);
    if (typeof d.isTradingDay !== 'boolean') fail('calendar_session', '交易日狀態缺漏。');
    if (d.isTradingDay) { integer(d.sessionOrdinal, '交易序號'); date(d.previousSessionDate, true); }
    else if (d.sessionOrdinal !== null) fail('calendar_session', '非交易日不可有交易序號。');
    tuple = [d.calendarId, d.calendarVersion, d.date];
  } else if (kind === 'metrics') {
    for (const field of ['aumNtd', 'navNtd', 'fundUnits']) record[field] = decimal(d[field], true);
    for (const field of ['aumAsOf', 'navAsOf', 'unitsAsOf']) date(d[field], true);
    required('sourceDocumentId');
    tuple = [d.setId]; record.id = d.setId;
  } else if (kind === 'holding') {
    required('securityId', 'sourceDocumentId', 'sourceRowKey', 'industryId', 'assignmentId');
    text(d.sourceName, '來源證券名稱', 100);
    text(d.sourceMarket, '來源市場', 50);
    record.shares = decimal(d.shares, true); record.weightPct = decimal(d.weightPct, true);
    if ((record.shares as DecimalEvidence).value?.includes('.')) fail('share_integer', '原股數必須為整數字串。');
    const weight = record.weightPct as DecimalEvidence;
    if (weight.value) {
      const excess = decimalOp(weight.value, '100', 'subtract');
      if (!excess.startsWith('-') && excess !== '0') fail('weight_range', '權重不可超過100%。');
    }
    tuple = [d.setId, d.securityId];
  } else if (kind === 'change') {
    required('securityId', 'sourceDocumentId', 'sourceRevision');
    date(d.startDate); date(d.endDate); date(d.sourceDate);
    if (String(d.startDate) >= String(d.endDate)) fail('change_dates', '來源異動起訖日期錯誤。');
    record.deltaShares = decimal(d.deltaShares); record.weightDeltaPp = decimal(d.weightDeltaPp);
    record.estimateNtd = decimal(d.estimateNtd); date(d.priceAsOf, true);
    if (d.estimateMethod !== null) text(d.estimateMethod, '估算方法', 1000);
    tuple = [d.sourceDocumentId, d.fundId, d.securityId, d.startDate, d.endDate, d.sourceRevision];
  }
  const id = typeof record.id === 'string' ? record.id : await key(...tuple);
  record.id = id; record.identityTuple = tuple;
  const payloadHash = await hash(record);
  const complete = { ...record, payloadHash } as DataRecord;
  if (bytes(complete) > MAX_DATA_BYTES) fail('record_too_large', '單筆資料超過200KiB。', 413);
  return { record: complete, ref: { kind, table, id, hash: payloadHash, setId } };
}
export async function uploadChunk(batchId: string, input: Record<string, unknown>) {
  const id = requestId(input.requestId);
  const batch = await batchById(batchId);
  const number = integer(input.chunkNo, '分批序號', batch.manifest.chunkCount - 1);
  if (!Array.isArray(input.facts) || input.facts.length < 1 || input.facts.length > MAX_CHUNK_FACTS
    || bytes(input) > MAX_CHUNK_BYTES) fail('chunk_limit', '每批最多80筆且不得超過700KiB。', 413);
  const fingerprintPayload = { batchId, expectedRevision: input.expectedRevision, chunkNo: number, facts: input.facts };
  const replay = await requestStatus(id, await hash({ action: 'chunk', payload: fingerprintPayload }));
  if (replay.state === 'committed') return { ...replay, batch: await batchById(batchId) };
  requireRevision(batch, input.expectedRevision);
  if (!['uploading', 'needs_attention', 'ready', 'reviewed'].includes(batch.status)) fail('batch_locked', '此任務目前不可修改。', 409);
  const facts = await Promise.all((input.facts as FactInput[]).map(f => prepareFact(f, batch)));
  const targets = facts.map(f => f.ref.table + ':' + f.ref.id);
  if (new Set(targets).size !== targets.length) fail('duplicate_fact', '同一資料批次存在重複唯一鍵。');
  const chunkId = await key(batchId, number);
  const existing = await read<Chunk>(batchTable(batch.month), chunkId);
  const chunkHash = await hash(facts.map(f => f.ref));
  if (input.chunkHash !== undefined && input.chunkHash !== chunkHash) fail('chunk_hash_mismatch', '資料批次雜湊不符。');
  if (existing && existing.chunkHash !== chunkHash) fail('chunk_conflict', '此批資料已保存且內容不同，請建立新的修訂任務。', 409);
  const additions: { ref: FactRef; record: DataRecord }[] = [];
  const previousFacts = await readReferences(facts.map(f => f.ref));
  for (const [index, f] of facts.entries()) {
    const previous = previousFacts[index];
    if (previous && previous.payloadHash !== f.ref.hash) fail('fact_conflict', '相同唯一鍵已有不同內容，不能覆寫。', 409);
    if (!previous) additions.push(f);
  }
  const receivedChunks = Array.from(new Set([...batch.receivedChunks, number])).sort((a, b) => a - b);
  const chunk: Chunk = { id: chunkId, batchId, chunkNo: number, chunkHash, refs: facts.map(f => f.ref) };
  const nextRevision = batch.revision + 1;
  const result = await transact('chunk', id, fingerprintPayload, { batchId, revision: nextRevision }, async () => [
    ...additions.map(f => db.tx.add(f.ref.table, [{ ...f.record }])),
    ...(existing ? [] : [db.tx.add(batchTable(batch.month), [{ ...chunk }])]),
    db.tx.update(batchTable(batch.month), [{ id: batchId, if: { revision: batch.revision, status: batch.status },
      record: { revision: nextRevision, receivedChunks, status: 'uploading', validation: null,
        reviewedPayloadHash: null, reviewedAt: null, updatedAt: new Date().toISOString() } }], { patch: true }),
  ]);
  return { ...result, batch: await batchById(batchId) };
}
async function batchFacts(batch: Batch): Promise<{ refs: FactRef[]; rows: DataRecord[] }> {
  const chunkIds = await Promise.all(Array.from({ length: batch.manifest.chunkCount }, (_v, n) => key(batch.id, n)));
  const chunks = await readMany<Chunk>(batchTable(batch.month), chunkIds);
  if (chunks.some(c => !c)) fail('incomplete_chunks', '資料批次尚未全部匯入。', 409);
  const refs = chunks.flatMap(c => c?.refs ?? []);
  if (new Set(refs.map(r => r.table + ':' + r.id)).size !== refs.length) fail('duplicate_fact', '跨資料批次有重複唯一鍵。');
  const rows: DataRecord[] = [];
  const storedRows = await readReferences(refs);
  for (const [index, ref] of refs.entries()) {
    const row = storedRows[index];
    if (!row || row.payloadHash !== ref.hash) fail('fact_integrity', '資料筆數或雜湊不符。', 503);
    // readMany already verifies each complete payload hash before returning it.
    rows.push(row);
  }
  return { refs, rows };
}
type ImmutableWrite = { table: string; record: Record<string, unknown> & { id: string } };
async function immutableWriteMany(writes: ImmutableWrite[]) {
  const groups = new Map<string, ImmutableWrite['record'][]>();
  for (const { table, record } of writes) {
    if (bytes(record) > MAX_DATA_BYTES) fail('record_too_large', '封存記錄超過200KiB。', 413);
    const group = groups.get(table) ?? [];
    group.push(record); groups.set(table, group);
  }
  for (const [table, records] of groups) {
    const previous = await readMany<Record<string, unknown>>(table, records.map(record => record.id));
    const additions = records.filter((record, index) => {
      const saved = previous[index];
      if (saved && canonical(saved) !== canonical(record)) fail('sealed_conflict', '封存內容不同，請建立新修訂。', 409);
      return !saved;
    });
    let group: ImmutableWrite['record'][] = [];
    const flush = async () => {
      if (!group.length) return;
      const current = group; group = [];
      try {
        const saved = await db.tx.add(table, current);
        const collisions = current.filter((_record, index) => saved[index] === null);
        if (collisions.length) {
          const found = await readMany<Record<string, unknown>>(table, collisions.map(record => record.id));
          if (found.some((record, index) => !record || canonical(record) !== canonical(collisions[index]))) {
            fail('sealed_conflict', '封存內容衝突或尚未確認。', 409);
          }
        }
      } catch (caught) {
        // A standalone batch may partly commit. Read every chosen ID once;
        // unresolved members stay unresolved and are never blindly rewritten.
        if (!isAppDatabaseError(caught) || caught.code === 'AppDatabaseQuotaExceeded') throw caught;
        const found = await readMany<Record<string, unknown>>(table, current.map(record => record.id));
        if (found.some((record, index) => !record || canonical(record) !== canonical(current[index]))) throw caught;
      }
    };
    for (const record of additions) {
      if (group.length >= MAX_CHUNK_FACTS || bytes({ table, records: [...group, record] }) > MAX_CHUNK_BYTES) await flush();
      group.push(record);
    }
    await flush();
  }
}
export async function validateBatch(batchId: string, input: Record<string, unknown>) {
  const id = requestId(input.requestId); const batch = await batchById(batchId);
  const payload = { batchId, expectedRevision: input.expectedRevision };
  const replay = await requestStatus(id, await hash({ action: 'validate', payload }));
  if (replay.state === 'committed') return { ...replay, batch: await batchById(batchId) };
  requireRevision(batch, input.expectedRevision);
  if (['published', 'cancelled'].includes(batch.status)) fail('batch_locked', '此任務目前不可驗證。', 409);
  const operation = await read<{ requestId: string; state: string }>(T.operations, await key(OWNER, batchId));
  if (operation?.state === 'pending') fail('outcome_unresolved', '原操作仍有待確認的提交，請先查詢原請求狀態。', 503,
    { requestId: operation.requestId, state: 'unresolved' });
  const summary: ValidationSummary = { blockingErrors: [], warnings: [], counts: {}, sealedSetIds: [], reviewHash: null, complete: false };
  let all: { refs: FactRef[]; rows: DataRecord[] };
  try { all = await batchFacts(batch); }
  catch (caught) {
    if (!(caught instanceof DataFailure) || !['incomplete_chunks', 'duplicate_fact'].includes(caught.code)) throw caught;
    summary.blockingErrors.push(caught.message); all = { refs: [], rows: [] };
  }
  all.refs.forEach(ref => { summary.counts[ref.kind] = (summary.counts[ref.kind] ?? 0) + 1; });
  for (const [kind, count] of Object.entries(batch.manifest.expectedCounts)) {
    if ((summary.counts[kind as FactKind] ?? 0) !== count) summary.blockingErrors.push(kind + '預期筆數與實際內容不符。');
  }
  const ofKind = (kind: FactKind) => all.rows.filter((_r, i) => all.refs[i].kind === kind);
  const byId = new Map(all.rows.map((r, i) => [all.refs[i].table + ':' + r.id, r]));
  const external = new Map<string, Promise<DataRecord | null>>();
  async function exists(table: string, idValue: unknown): Promise<DataRecord | null> {
    if (typeof idValue !== 'string') return null;
    const lookup = table + ':' + idValue;
    const local = byId.get(lookup);
    if (local) return local;
    if (!external.has(lookup)) external.set(lookup, read<DataRecord>(table, idValue));
    return external.get(lookup) as Promise<DataRecord | null>;
  }
  // Load shared identity and classification records in bounded groups. Historical
  // daily batches reuse these masters; one request per holding is unnecessary.
  const lookups = new Map<string, Set<string>>();
  const need = (table: string, idValue: unknown) => {
    if (typeof idValue !== 'string' || byId.has(table + ':' + idValue)) return;
    const ids = lookups.get(table) ?? new Set<string>();
    ids.add(idValue); lookups.set(table, ids);
  };
  for (const holding of ofKind('holding')) {
    const securityId = holding.securityIdentityRevision
      ? await key(holding.securityId, identity(holding.securityIdentityRevision, '證券身份修訂'))
      : holding.securityId;
    need(FACT_TABLES.security, securityId);
    need(FACT_TABLES.assignment, holding.assignmentId);
    need(FACT_TABLES.industry, holding.industryId);
    need(FACT_TABLES.source, holding.sourceDocumentId);
  }
  for (const setInput of batch.manifest.sets) {
    for (const sourceId of setInput.sourceDocumentIds) need(FACT_TABLES.source, sourceId);
  }
  const lookupResults = await Promise.allSettled([...lookups].map(async ([table, ids]) => {
    const chosenIds = [...ids];
    const records = await readMany<DataRecord>(table, chosenIds);
    chosenIds.forEach((idValue, index) => {
      external.set(table + ':' + idValue, Promise.resolve(records[index]));
    });
  }));
  const lookupFailure = lookupResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (lookupFailure) throw lookupFailure.reason;
  const assignments = ofKind('assignment');
  for (const assignment of assignments) {
    const overlaps = assignments.filter(a => a.id !== assignment.id && a.securityId === assignment.securityId
      && a.taxonomyId === assignment.taxonomyId && a.taxonomyVersion === assignment.taxonomyVersion
      && a.primary !== false && assignment.primary !== false
      && String(a.validFrom) < String(assignment.validTo ?? '9999-12-31')
      && String(assignment.validFrom) < String(a.validTo ?? '9999-12-31'));
    if (overlaps.length) summary.blockingErrors.push('正式主分類有效期間重疊。');
  }
  const sourceIds = new Set<string>();
  for (const setInput of batch.manifest.sets) {
    const setRows = ofKind('holding').filter(r => r.setId === setInput.setId);
    const metricRows = ofKind('metrics').filter(r => r.setId === setInput.setId);
    if (setRows.length !== setInput.expectedHoldings) summary.blockingErrors.push(setInput.setId + '持股筆數不符。');
    if (metricRows.length > 1) summary.blockingErrors.push(setInput.setId + '基金數據重複。');
    const fundPhysicalId = setInput.fundIdentityRevision ? await key(setInput.fundId, setInput.fundIdentityRevision) : setInput.fundId;
    const fundMaster = await exists(FACT_TABLES.fund, fundPhysicalId);
    if (!fundMaster || fundMaster.fundId !== setInput.fundId) summary.blockingErrors.push('基金身份未解析：' + setInput.fundId);
    if (fundMaster && !await exists(FACT_TABLES.security, fundMaster.securityId)) summary.blockingErrors.push('ETF證券身份未解析：' + String(fundMaster.securityId));
    const selection = batch.manifest.fundSelections.find(f => f.fundId === setInput.fundId);
    if (selection && fundMaster && (selection.code !== fundMaster.code || selection.name !== fundMaster.name || selection.securityId !== fundMaster.securityId)) {
      summary.blockingErrors.push('研究組基金識別與指定身份修訂不一致：' + setInput.fundId);
    }
    for (const sourceId of setInput.sourceDocumentIds) {
      sourceIds.add(sourceId);
      if (!await exists(FACT_TABLES.source, sourceId)) summary.blockingErrors.push('來源未解析：' + sourceId);
    }
    for (const holding of setRows) {
      const securityIdentity = holding.securityIdentityRevision
        ? await key(holding.securityId, identity(holding.securityIdentityRevision, '證券身份修訂')) : holding.securityId;
      const security = await exists(FACT_TABLES.security, securityIdentity);
      const assignment = await exists(FACT_TABLES.assignment, holding.assignmentId);
      const industry = await exists(FACT_TABLES.industry, holding.industryId);
      const source = await exists(FACT_TABLES.source, holding.sourceDocumentId);
      if (!security || !assignment || !industry || !source) summary.blockingErrors.push('持股身份、分類或來源缺漏：' + String(holding.securityId));
      if (assignment && !await exists(FACT_TABLES.source, assignment.sourceDocumentId)) summary.blockingErrors.push('分類修訂來源缺漏。');
      if (industry && !await exists(FACT_TABLES.source, industry.sourceDocumentId)) summary.blockingErrors.push('產業制度來源缺漏。');
      if (assignment && (assignment.securityId !== holding.securityId || assignment.industryId !== holding.industryId
        || assignment.taxonomyVersion !== setInput.classificationVersion || assignment.taxonomyId !== setInput.taxonomyId
        || (setInput.holdingDate && (String(assignment.validFrom) > setInput.holdingDate
          || (assignment.validTo !== null && String(assignment.validTo) <= setInput.holdingDate))))) {
        summary.blockingErrors.push('持股分類有效日期或分類版本不符：' + String(holding.securityId));
      }
      if (!setInput.sourceDocumentIds.includes(String(holding.sourceDocumentId))) summary.blockingErrors.push('持股來源不屬於集合。');
    }
    const exactWeight = setRows.filter(r => (r.weightPct as DecimalEvidence).precision === 'exact')
      .reduce((sum, r) => decimalOp(sum, (r.weightPct as DecimalEvidence).value ?? '0', 'add'), '0');
    if (!decimalOp(exactWeight, '100.5', 'subtract').startsWith('-') && exactWeight !== '100.5') summary.blockingErrors.push('精確持股權重合計超過100.5%。');
    if (setInput.stockListCompleteness !== 'complete') summary.warnings.push(setInput.fundId + '清單不完整，未列出不等於零。');
    if (setInput.dateAlignment !== 'confirmed') summary.warnings.push(setInput.fundId + '實際持股日期待確認，不可用作精確歷史端點。');
    if (setInput.officialVerification !== 'verified') summary.warnings.push(setInput.fundId + '尚未完成官方同日核對。');
    if (setRows.some(r => (r.weightPct as DecimalEvidence).precision !== 'exact')) summary.warnings.push(setInput.fundId + '包含非精確權重。');
  }
  for (const metric of ofKind('metrics')) {
    if (!await exists(FACT_TABLES.source, metric.sourceDocumentId)) summary.blockingErrors.push('基金數據來源缺漏。');
  }
  for (const change of ofKind('change')) {
    if (!await exists(FACT_TABLES.source, change.sourceDocumentId) || !await exists(FACT_TABLES.security, change.securityId)) {
      summary.blockingErrors.push('來源異動身份或來源缺漏。');
    }
  }
  for (const session of ofKind('session')) {
    const evidence = await exists(FACT_TABLES.source, session.sourceDocumentId);
    const synthetic = batch.manifest.scopeId === QA_DATA_SCOPE && evidence?.synthetic === true;
    if (!evidence || (!synthetic && evidence.officialStatus !== 'official')) summary.blockingErrors.push('交易日曆需已核對官方來源。');
  }
  if (!batch.manifest.selectionConfirmed) summary.warnings.push('目標日AUM排行尚未確認，不宣稱已核定前五大。');
  if (batch.manifest.selectionConfirmed) {
    if (batch.manifest.fundSelections.length !== 5 || !batch.manifest.selectionEvidenceIds.length) {
      summary.blockingErrors.push('核定前五大選樣需要五檔基金與完整目標日排行來源。');
    }
    const selectedMetrics = ofKind('metrics').filter(r => batch.manifest.selectedSetIds.includes(String(r.setId)));
    if (selectedMetrics.length !== 5 || selectedMetrics.some(r => r.aumAsOf !== batch.manifest.requestedDate
      || (r.aumNtd as DecimalEvidence).precision !== 'exact' || r.rankingCoverage !== 'complete_scope'
      || r.rankingScope !== 'domestic_equity_active_etfs' || r.selectionAsOf !== batch.manifest.requestedDate)) {
      summary.blockingErrors.push('前五大核定需要目標日精確AUM、完整國內股票主動ETF排行範圍與來源。');
    }
    for (let index = 1; index < batch.manifest.fundSelections.length; index++) {
      const previousId = batch.manifest.selectedSetIds.find(id => batch.manifest.sets.some(s => s.setId === id && s.fundId === batch.manifest.fundSelections[index - 1].fundId));
      const currentId = batch.manifest.selectedSetIds.find(id => batch.manifest.sets.some(s => s.setId === id && s.fundId === batch.manifest.fundSelections[index].fundId));
      const previous = selectedMetrics.find(r => r.setId === previousId)?.aumNtd as DecimalEvidence | undefined;
      const current = selectedMetrics.find(r => r.setId === currentId)?.aumNtd as DecimalEvidence | undefined;
      if (previous?.value && current?.value && decimalOp(previous.value, current.value, 'subtract').startsWith('-')) {
        summary.blockingErrors.push('選樣基金順序與目標日AUM降冪排行不符。');
      }
    }
  }
  if (batch.manifest.scopeId === QA_DATA_SCOPE) summary.warnings.push('合成測試資料：基金、股票、產業、交易日曆與數值均為虛構，不代表真實市場。');
  if (!batch.manifest.calendarId) summary.warnings.push('交易日曆尚未提供，不能解析5／10／20交易日。');
  for (const sourceId of batch.manifest.selectionEvidenceIds) {
    sourceIds.add(sourceId);
    if (!await exists(FACT_TABLES.source, sourceId)) summary.blockingErrors.push('選樣來源缺漏。');
  }
  if (!summary.blockingErrors.length) {
    const memberWrites: ImmutableWrite[] = [];
    const allocationWrites: ImmutableWrite[] = [];
    const setWrites: ImmutableWrite[] = [];
    for (const s of batch.manifest.sets) {
      const rows = ofKind('holding').filter(r => r.setId === s.setId);
      const securityIds = rows.map(r => String(r.securityId)).sort();
      const pageRefs: SealedSet['membershipManifest'] = [];
      for (let offset = 0, pageNo = 0; offset < securityIds.length; offset += 100, pageNo++) {
        const pageIds = securityIds.slice(offset, offset + 100);
        const page: MembershipPage = { id: await key(s.setId, pageNo), setId: s.setId, pageNo,
          sortedSecurityIds: pageIds, rowCount: pageIds.length, pageHash: await hash(pageIds) };
        if (bytes(page) > MAX_MEMBER_BYTES) fail('membership_limit', '持股索引頁過大。', 413);
        memberWrites.push({ table: T.members, record: page });
        pageRefs.push({ pageNo, rowCount: pageIds.length, pageHash: page.pageHash });
      }
      const allocationIds: string[] = [];
      for (const industryId of Array.from(new Set(rows.map(r => String(r.industryId))))) {
        const selected = rows.filter(r => r.industryId === industryId);
        const exact = selected.filter(r => (r.weightPct as DecimalEvidence).precision === 'exact');
        const sum = exact.reduce((value, r) => decimalOp(value, (r.weightPct as DecimalEvidence).value ?? '0', 'add'), '0');
        const idValue = await key(s.setId, s.classificationVersion, industryId);
        const industry = await exists(FACT_TABLES.industry, industryId);
        const complete = exact.length === selected.length && s.stockListCompleteness === 'complete';
        const allocation = {
          id: idValue, schemaVersion: 2, setId: s.setId, industryId, label: industry?.label ?? '未分類',
          taxonomyVersion: s.classificationVersion, knownWeightSumPct: {
            value: exact.length ? sum : null, raw: sum, precision: exact.length ? 'exact' : 'unknown',
            upperBound: null, upperInclusive: false,
          }, weightPct: complete ? { value: sum, raw: sum, precision: 'exact', upperBound: null, upperInclusive: false } : unknownDecimal(),
          stockCount: selected.length, knownWeightCount: exact.length,
          impreciseCount: selected.filter(r => ['rounded', 'less_than'].includes((r.weightPct as DecimalEvidence).precision)).length,
          unknownCount: selected.filter(r => (r.weightPct as DecimalEvidence).precision === 'unknown').length,
          coverage: { observed: exact.length, expected: selected.length, complete },
          inputHash: await hash(selected.map(r => r.payloadHash).sort()), calculationVersion: 'sector-exact-v1',
          memberIndexRef: pageRefs,
        };
        allocationWrites.push({ table: partition(T.allocations, batch.manifest.scopeId, s.requestedDate), record: allocation });
        allocationIds.push(idValue);
      }
      const setPayload = {
        ...s, id: s.setId, schemaVersion: 2 as const, batchId, scopeId: batch.manifest.scopeId,
        rowCount: rows.length, metricsId: ofKind('metrics').find(r => r.setId === s.setId)?.id ?? null,
        membershipManifest: pageRefs, allocationIds,
        changeRefs: all.refs.filter(r => r.kind === 'change' && r.setId === s.setId).map(r => ({ id: r.id, table: r.table })),
        classificationSourceIds: [...new Set((await Promise.all(rows.map(async r => {
          const assignment = await exists(FACT_TABLES.assignment, r.assignmentId);
          const industry = await exists(FACT_TABLES.industry, r.industryId);
          return [String(assignment?.sourceDocumentId), String(industry?.sourceDocumentId)];
        }))).flat())],
      };
      const contentHash = await hash({ ...setPayload, holdings: rows.map(r => r.payloadHash).sort() });
      // Seal time is deterministic across interrupted validation retries.
      const set: SealedSet = { ...setPayload, contentHash, sealedAt: batch.createdAt };
      setWrites.push({ table: T.sets, record: set });
      summary.sealedSetIds.push(s.setId);
    }
    // Publish no set manifest until all of its immutable members and derived
    // allocations are confirmed. Reopening an interrupted seal reuses them.
    await immutableWriteMany(memberWrites);
    await immutableWriteMany(allocationWrites);
    await immutableWriteMany(setWrites);
    summary.complete = true;
    summary.reviewHash = await hash({ manifest: batch.manifest, refs: all.refs, sealedSetIds: summary.sealedSetIds, warnings: summary.warnings });
  }
  summary.blockingErrors = [...new Set(summary.blockingErrors)].slice(0, 80);
  summary.warnings = [...new Set(summary.warnings)].slice(0, 80);
  const revision = batch.revision + 1;
  const result = await transact('validate', id, payload, { batchId, revision }, async () => [
    db.tx.update(batchTable(batch.month), [{ id: batchId, if: { revision: batch.revision, status: batch.status },
      record: { revision, validation: summary, status: summary.complete ? 'ready' : 'needs_attention',
        reviewedPayloadHash: null, reviewedAt: null, updatedAt: new Date().toISOString() } }], { patch: true }),
  ]);
  return { ...result, batch: await batchById(batchId) };
}
export async function reviewBatch(batchId: string, input: Record<string, unknown>) {
  const id = requestId(input.requestId); const batch = await batchById(batchId);
  const payload = { batchId, expectedRevision: input.expectedRevision, reviewHash: input.reviewHash, acknowledged: input.acknowledged };
  const replay = await requestStatus(id, await hash({ action: 'review', payload }));
  if (replay.state === 'committed') return { ...replay, batch: await batchById(batchId) };
  requireRevision(batch, input.expectedRevision);
  if (batch.status !== 'ready' || !batch.validation?.complete || input.acknowledged !== true
    || input.reviewHash !== batch.validation.reviewHash) fail('review_required', '請審閱目前資料、來源選擇與全部缺口。', 409);
  const revision = batch.revision + 1;
  const result = await transact('review', id, payload, { batchId, revision }, async () => [
    db.tx.update(batchTable(batch.month), [{ id: batchId, if: { revision: batch.revision, status: 'ready' },
      record: { revision, status: 'reviewed', reviewedPayloadHash: input.reviewHash,
        reviewedAt: new Date().toISOString(), reviewedBy: OWNER, updatedAt: new Date().toISOString() } }], { patch: true }),
  ]);
  return { ...result, batch: await batchById(batchId) };
}
async function catalogOperations(publication: Publication): Promise<DbOperation<unknown>[]> {
  const rootId = await key(publication.scopeId, 'catalog');
  const monthId = await key(publication.scopeId, publication.tradeDate.slice(0, 7));
  const root = await read<CatalogRoot>(T.catalog, rootId);
  const month = await read<CatalogMonth>(T.catalog, monthId);
  const rootRecord = { latestDate: !root || root.latestDate < publication.tradeDate ? publication.tradeDate : root.latestDate, revision: (root?.revision ?? 0) + 1 };
  const monthRecord = { dates: [...new Set([...(month?.dates ?? []), publication.tradeDate])].sort().reverse(), revision: (month?.revision ?? 0) + 1 };
  return [
    root ? db.tx.update(T.catalog, [{ id: rootId, record: rootRecord, if: { revision: root.revision } }]) : db.tx.add(T.catalog, [{ id: rootId, ...rootRecord }]),
    month ? db.tx.update(T.catalog, [{ id: monthId, record: monthRecord, if: { revision: month.revision } }]) : db.tx.add(T.catalog, [{ id: monthId, ...monthRecord }]),
  ];
}
export async function publishBatch(batchId: string, input: Record<string, unknown>, prepareReport?: PrepareReport) {
  const id = requestId(input.requestId); const batch = await batchById(batchId);
  const payload = { batchId, expectedRevision: input.expectedRevision, expectedHeadVersion: input.expectedHeadVersion,
    reviewHash: input.reviewHash, report: input.report ?? null };
  const replay = await requestStatus(id, await hash({ action: 'publish', payload }));
  if (replay.state === 'committed') return { ...replay, batch: await batchById(batchId) };
  requireRevision(batch, input.expectedRevision);
  if (batch.status !== 'reviewed' || !batch.validation?.complete || !batch.reviewedPayloadHash
    || input.reviewHash !== batch.reviewedPayloadHash || input.confirmed !== true) fail('review_required', '請明確確認已審閱的日期、版本與缺口。', 409);
  const expectedVersion = integer(input.expectedHeadVersion, '公開版本');
  const current = await getHead(batch.manifest.scopeId, batch.manifest.requestedDate);
  if ((current?.version ?? 0) !== expectedVersion) fail('head_conflict', '公開版本已變更，請重新載入差異。', 409);
  const selected = await Promise.all(batch.manifest.selectedSetIds.map(getSet));
  if (selected.some(s => s.batchId !== batchId)) fail('set_integrity', '封存集合不屬於此任務。', 409);
  const sourceIds = [...new Set([...selected.flatMap(s => [...s.sourceDocumentIds, ...s.classificationSourceIds]), ...batch.manifest.selectionEvidenceIds])];
  const sourceRows = await readMany<DataRecord>(FACT_TABLES.source, sourceIds);
  if (sourceRows.some(r => !r)) fail('source_integrity', '來源證據缺漏。', 503);
  const sourceRefs = sourceRows.map(r => sourceRef(r as DataRecord));
  const version = expectedVersion + 1; const publicationId = await key(batch.manifest.scopeId, batch.manifest.requestedDate, version, id);
  const publicationPayload: Omit<Publication, 'publicationHash'> = {
    id: publicationId, scopeId: batch.manifest.scopeId, tradeDate: batch.manifest.requestedDate, version,
    publishedAt: new Date().toISOString(), publishedBy: OWNER, supersedesId: current?.publicationId ?? null,
    chosenSetIds: selected.map(s => s.id), sets: Object.fromEntries(selected.map(s => [s.fundId, s.id])),
    fundSelections: batch.manifest.fundSelections,
    selectionEvidence: sourceRefs.filter(s => batch.manifest.selectionEvidenceIds.includes(s.sourceDocumentId)),
    selectionConfirmed: batch.manifest.selectionConfirmed,
    calendarId: batch.manifest.calendarId, calendarVersion: batch.manifest.calendarVersion,
    warnings: batch.validation.warnings, sourceRefs, reportSnapshotRefs: [],
    membershipHash: await hash(selected.map(s => s.contentHash)), published: true,
  };
  const publication = { ...publicationPayload, publicationHash: '' } as Publication;
  let reportCommit: ReportCommit | null = null;
  if (input.report !== undefined && input.report !== null) {
    if (batch.manifest.scopeId === QA_DATA_SCOPE) fail('qa_report_forbidden', '合成測試資料只能獨立發布，不能配對研究報告。', 409);
    if (!prepareReport) fail('report_publication_unavailable', '目前無法成套發布報告。', 503);
    reportCommit = await prepareReport(object(input.report), publication);
    publicationPayload.reportSnapshotRefs = [reportCommit.snapshotId];
  }
  publication.publicationHash = await hash(publicationPayload);
  Object.assign(publication, publicationPayload);
  const head = { publicationId, version, hash: publication.publicationHash, updatedAt: publication.publishedAt };
  const revision = batch.revision + 1;
  const result = await transact('publish', id, payload, { batchId, revision, publicationId, version }, async () => [
    db.tx.add(T.publications, [{ ...publication }]),
    current ? db.tx.update(T.heads, [{ id: await headId(publication.scopeId, publication.tradeDate),
      record: head, if: { version: expectedVersion, publicationId: current.publicationId } }])
      : db.tx.add(T.heads, [{ id: await headId(publication.scopeId, publication.tradeDate), ...head }]),
    db.tx.update(batchTable(batch.month), [{ id: batchId, if: { revision: batch.revision, status: 'reviewed', reviewedPayloadHash: batch.reviewedPayloadHash },
      record: { revision, status: 'published', publicationId, updatedAt: publication.publishedAt } }], { patch: true }),
    ...await catalogOperations(publication), ...(reportCommit?.operations ?? []),
  ]);
  return { ...result, batch: await batchById(batchId), publication };
}

export async function planPublication(batchId: string, input: Record<string, unknown>) {
  const batch = await batchById(batchId); const id = requestId(input.requestId);
  if (!batch.validation?.complete || !['ready', 'reviewed'].includes(batch.status)) fail('validation_required', '請先完成資料驗證。', 409);
  const current = await getHead(batch.manifest.scopeId, batch.manifest.requestedDate);
  const expectedHeadVersion = integer(input.expectedHeadVersion, '公開版本');
  if ((current?.version ?? 0) !== expectedHeadVersion) fail('head_conflict', '公開版本已變更，請重新載入差異。', 409);
  const version = expectedHeadVersion + 1;
  const publicationId = await key(batch.manifest.scopeId, batch.manifest.requestedDate, version, id);
  const sealedSets = await Promise.all(batch.manifest.selectedSetIds.map(getSet));
  const sourceIds = [...new Set([...sealedSets.flatMap(s => [...s.sourceDocumentIds, ...s.classificationSourceIds]), ...batch.manifest.selectionEvidenceIds])];
  const sources = await readMany<DataRecord>(FACT_TABLES.source, sourceIds);
  return { requestId: id, batchId, revision: batch.revision, publicationId, version,
    scopeId: batch.manifest.scopeId, tradeDate: batch.manifest.requestedDate,
    setIds: batch.manifest.selectedSetIds, reviewHash: batch.validation.reviewHash,
    dataLineage: { publicationIds: [publicationId], setIds: batch.manifest.selectedSetIds,
      sourceHashes: sources.filter((r): r is DataRecord => !!r).map(r => String(r.contentHash)),
      taxonomyVersions: [...new Set(batch.manifest.sets.map(s => s.classificationVersion))],
      calendarVersion: batch.manifest.calendarVersion, comparison: { start: null, end: batch.manifest.requestedDate },
      versionVector: [], algorithmVersion: 'etf-normalized-v1' } };
}
export async function restorePublication(publicationId: string, input: Record<string, unknown>) {
  const id = requestId(input.requestId); const original = await getPublication(publicationId);
  if ((input.expectedScopeId !== undefined && input.expectedScopeId !== original.scopeId)
    || (input.expectedTradeDate !== undefined && input.expectedTradeDate !== original.tradeDate)) {
    fail('restore_target_mismatch', '回復來源與已確認的研究範圍或日期不同。', 409);
  }
  const expectedVersion = integer(input.expectedHeadVersion, '公開版本');
  const reason = text(input.reason, '回復理由', 1000);
  if (input.confirmed !== true) fail('confirmation_required', '請明確確認回復指定日期與舊版內容。');
  const payload = { publicationId, expectedHeadVersion: expectedVersion, reason };
  const replay = await requestStatus(id, await hash({ action: 'restore', payload }));
  if (replay.state === 'committed') return replay;
  const current = await getHead(original.scopeId, original.tradeDate);
  if (!current || current.version !== expectedVersion) fail('head_conflict', '公開版本已變更。', 409);
  const version = expectedVersion + 1;
  const nextId = await key(original.scopeId, original.tradeDate, version, id);
  const { publicationHash: _hash, ...body } = original;
  const payloadRecord = { ...body, id: nextId, version, publishedAt: new Date().toISOString(),
    publishedBy: OWNER, supersedesId: current.publicationId, reportSnapshotRefs: [],
    warnings: [...original.warnings, '回復來源版本 ' + original.version + '：' + reason] };
  const publication: Publication = { ...payloadRecord, publicationHash: await hash(payloadRecord) };
  const head = { publicationId: nextId, version, hash: publication.publicationHash, updatedAt: publication.publishedAt };
  return transact('restore', id, payload, { publicationId: nextId, version }, async () => [
    db.tx.add(T.publications, [{ ...publication }]),
    db.tx.update(T.heads, [{ id: await headId(original.scopeId, original.tradeDate),
      record: head, if: { version: expectedVersion, publicationId: current.publicationId } }]),
    ...await catalogOperations(publication),
  ]);
}
export async function cancelBatch(batchId: string, input: Record<string, unknown>) {
  const batch = await batchById(batchId); requireRevision(batch, input.expectedRevision);
  if (['published', 'cancelled'].includes(batch.status)) fail('batch_locked', '已發布或已取消任務不能取消。', 409);
  // Pending operations are not erased. A racing transaction is rejected by revision/status CAS.
  const id = requestId(input.requestId); const revision = batch.revision + 1;
  return transact('cancel', id, { batchId, expectedRevision: batch.revision }, { batchId, revision }, async () => [
    db.tx.update(batchTable(batch.month), [{ id: batchId, if: { revision: batch.revision, status: batch.status },
      record: { revision, status: 'cancelled', updatedAt: new Date().toISOString() } }], { patch: true }),
  ]);
}
export async function listBatches(input: Record<string, unknown>) {
  const month = text(input.month, '月份', 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !date(month + '-01')) fail('invalid_month', '月份格式錯誤。');
  const nextToken = input.nextToken === undefined ? undefined : text(input.nextToken, '游標', 4096);
  const page = await db.list<Batch>(batchTable(month), { limit: 10, nextToken });
  const items = page.items.filter(b => b.ownerKey === OWNER && b.manifest && b.revision).map(b => ({
    id: b.id, revision: b.revision, status: b.status, requestedDate: b.manifest.requestedDate,
    scopeId: b.manifest.scopeId, updatedAt: b.updatedAt, receivedChunks: b.receivedChunks.length,
    chunkCount: b.manifest.chunkCount, publicationId: b.publicationId,
  }));
  return { items, nextToken: page.nextToken ?? null };
}
