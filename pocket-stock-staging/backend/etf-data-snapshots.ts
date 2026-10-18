import { db, error, isAppDatabaseError, json } from '@appdeploy/sdk';
import type { RouterContext, RouterResponse, RouterRoutes } from '@appdeploy/sdk';
import {
  isReportId, isRequestId, parseReportJson, validateReport,
} from '../shared/etf-contract.ts';
import type { EtfReport, ReportSummary } from '../shared/etf-contract.ts';
import {
  QA_DATA_SCOPE, MAX_DATA_BYTES, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PAGES, MAX_SNAPSHOT_PAGE_BYTES,
  bytes, date, hash, identity, integer, key, object, text,
} from '../shared/etf-data-contract.ts';
import type { DataLineage, Publication, SnapshotManifest } from '../shared/etf-data-contract.ts';
import { DataFailure, OWNER, fail, read, transact, getPublication, getSet, requestStatus } from './etf-data-store.ts';
import type { ReportCommit } from './etf-data-store.ts';

export const SCHEMA2_PUBLICATION_ENABLED = true;
const DRAFTS = 'etf_reports_v1';
const PUBLIC = 'etf_public_reports_v1';
const SNAPSHOTS = 'etf_report_snapshots_v1';
const BODIES = 'etf_report_bodies_v2';
const PAGES = 'etf_report_body_pages_v2';
function requireLegacyFormat(value: unknown) {
  if (value && typeof value === 'object' && 'storageSchemaVersion' in value && value.storageSchemaVersion === 3) {
    fail('format_conflict', '此 ID 已屬 Markdown 研究，請使用原格式編輯。', 409);
  }
}
type Draft = { ownerKey: string; draft: EtfReport; revision: number; publishedVersion: number;
  publishedDraftRevision: number; publishedAt: string | null; updatedAt: string };
type Public = ReportSummary & { snapshotId: string };
type Body = {
  id: string; ownerKey: string; reportId: string; baseRevision: number; revision: number;
  expectedPublishedVersion: number; manifest: SnapshotManifest; sealed: boolean; reviewed: boolean;
  reportSummary: { title: string; excerpt: string; period: { start: string; end: string }; evidenceDate: string } | null;
  dataLineage: DataLineage | null; reviewHash: string | null;
};
type BodyPage = { id: string; bodyId: string; pageNo: number; pageHash: string; byteLength: number; content: string };
type PagedSnapshot = { schemaVersion: 2; bodyId: string; manifest: SnapshotManifest; version: number;
  publishedAt: string; dataLineage: DataLineage };
type LegacySnapshot = { report: EtfReport; version: number; publishedAt: string; dataLineage?: DataLineage };
type Helpers = {
  requireAdmin: (event: unknown, body?: unknown) => Promise<{ id: string } | null>;
  isSameOriginMutation: (event: unknown) => boolean;
};
export async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}
function allowed(value: unknown, names: string[], label: string) {
  const record = object(value);
  const unexpected = Object.keys(record).filter(name => !names.includes(name));
  if (unexpected.length) fail('unsupported_report_field', label + '含未支援欄位，完整快照不會公開未驗證內容：' + unexpected[0]);
}
function reportFields(report: Record<string, unknown>) {
  allowed(report, ['schemaVersion', 'id', 'reportType', 'title', 'excerpt', 'period', 'evidenceDate',
    'funds', 'rows', 'summary', 'operations', 'sampleNote', 'warnings', 'holdings', 'institutional', 'dataLineage'], '報告');
  allowed(report.period, ['start', 'end'], '研究期間');
  const each = (value: unknown, names: string[], label: string) => {
    if (Array.isArray(value)) value.forEach(row => allowed(row, names, label));
  };
  const sources = (value: unknown) => each(value, ['label', 'url', 'eventDate'], '報告來源');
  each(report.funds, ['code', 'name', 'aumBillion', 'rankAsOf', 'holdingsDate', 'coverage', 'sourceUrl'], '基金');
  each(report.rows, ['etf', 'code', 'name', 'sector', 'deltaLots', 'weightDeltaPp', 'estimateNtd', 'sourceUrl', 'sourceDate'], '來源異動');
  each(report.summary, ['title', 'text', 'sources'], '評論');
  if (Array.isArray(report.summary)) report.summary.forEach(value => sources(object(value).sources));
  each(report.operations, ['code', 'name', 'metrics', 'eventDate', 'sourceUrl'], '營運證據');
  if (Array.isArray(report.operations)) report.operations.forEach(value => each(object(value).metrics, ['label', 'value', 'period'], '營運指標'));
  const holdingFields = ['code', 'name', 'sector', 'market', 'weightPct', 'weightUpperBoundPct', 'weightRaw', 'shares'];
  each(report.holdings, ['etf', 'date', 'sourceUrl', 'note', 'rows', 'currentComplete', 'baseline'], '完整持股');
  if (Array.isArray(report.holdings)) report.holdings.forEach(value => {
    const holding = object(value); each(holding.rows, holdingFields, '持股');
    if (holding.baseline !== undefined) {
      allowed(holding.baseline, ['date', 'sourceUrl', 'complete', 'rows'], '基期持股');
      each(object(holding.baseline).rows, holdingFields, '基期證券');
    }
  });
  if (report.institutional !== undefined) {
    allowed(report.institutional, ['date', 'marketScope', 'marketUnit', 'stockUnit', 'market', 'stocks', 'sources'], '法人資料');
    const i = object(report.institutional);
    allowed(i.market, ['foreign', 'trust', 'dealer', 'hedge', 'total'], '大盤法人');
    each(i.stocks, ['code', 'name', 'market', 'foreignShares', 'trustShares', 'dealerShares', 'hedgeShares', 'sourceUrl'], '個股法人');
    sources(i.sources);
  }
}
function parseLineage(input: unknown): DataLineage {
  const d = object(input);
  allowed(d, ['publicationIds', 'setIds', 'sourceHashes', 'taxonomyVersions', 'calendarVersion', 'comparison', 'versionVector', 'algorithmVersion'], '資料血緣');
  for (const name of ['publicationIds', 'setIds', 'sourceHashes', 'taxonomyVersions', 'versionVector']) {
    if (!Array.isArray(d[name]) || (d[name] as unknown[]).length > 200) fail('invalid_lineage', '報告資料血緣格式錯誤。');
  }
  for (const name of ['publicationIds', 'setIds', 'taxonomyVersions']) (d[name] as unknown[]).forEach(x => identity(x));
  (d.sourceHashes as unknown[]).forEach(x => {
    if (typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x)) fail('invalid_lineage', '來源雜湊格式錯誤。');
  });
  const comparison = object(d.comparison); date(comparison.start, true); date(comparison.end, true);
  allowed(comparison, ['start', 'end'], '比較期間');
  for (const value of d.versionVector as unknown[]) {
    allowed(value, ['date', 'publicationId', 'version', 'publicationHash', 'sets'], '版本向量');
    const ref = object(value); date(ref.date);
    if (ref.publicationId !== null) identity(ref.publicationId);
    if (ref.version !== null) integer(ref.version, '資料發布版本');
    const sets = object(ref.sets);
    for (const [fundId, setId] of Object.entries(sets)) { identity(fundId); identity(setId); }
  }
  if (d.calendarVersion !== null) identity(d.calendarVersion);
  text(d.algorithmVersion, '計算版本', 100);
  return d as unknown as DataLineage;
}
function parseManifest(value: unknown): SnapshotManifest {
  const m = object(value);
  if (!Array.isArray(m.pages) || !m.pages.length || m.pages.length > MAX_SNAPSHOT_PAGES) fail('snapshot_pages', '完整快照需要1至128頁。');
  const bodyBytes = integer(m.bodyBytes, '完整快照大小', MAX_SNAPSHOT_BYTES);
  const bodyHash = text(m.bodyHash, '快照雜湊', 64);
  if (!/^[a-f0-9]{64}$/.test(bodyHash)) fail('snapshot_hash', '完整快照雜湊格式錯誤。');
  const pages = m.pages.map((value, i) => {
    const p = object(value);
    if (p.pageNo !== i) fail('snapshot_order', '快照頁需按0開始的連續順序。');
    const pageId = identity(p.pageId); const pageHash = text(p.pageHash, '頁面雜湊', 64);
    if (!/^[a-f0-9]{64}$/.test(pageHash)) fail('snapshot_hash', '快照頁雜湊格式錯誤。');
    return { pageNo: i, pageId, pageHash, byteLength: integer(p.byteLength, '頁面大小', MAX_SNAPSHOT_PAGE_BYTES) };
  });
  if (new Set(pages.map(p => p.pageId)).size !== pages.length || pages.reduce((n, p) => n + p.byteLength, 0) !== bodyBytes) {
    fail('snapshot_manifest', '完整快照頁大小或識別碼不一致。');
  }
  return { pages, bodyHash, bodyBytes };
}
async function verifyPublicLineage(lineage: DataLineage, planned?: Publication) {
  const publications: Publication[] = [];
  for (const id of lineage.publicationIds) publications.push(planned?.id === id ? planned : await getPublication(id));
  if (publications.some(p => p.scopeId === QA_DATA_SCOPE)) fail('qa_report_forbidden', '研究報告不能引用合成測試資料。', 409);
  const allowedSets = new Set(publications.flatMap(p => p.chosenSetIds));
  const allowedHashes = new Set(publications.flatMap(p => p.sourceRefs.map(s => s.contentHash)));
  if (lineage.setIds.some(id => !allowedSets.has(id)) || lineage.sourceHashes.some(h => !allowedHashes.has(h))) {
    fail('lineage_visibility', '完整快照不能引用未發布或不屬於指定版本的日資料。', 409);
  }
  for (const id of lineage.setIds) {
    const set = await getSet(id);
    if (!lineage.taxonomyVersions.includes(set.classificationVersion)) fail('lineage_taxonomy', '完整快照缺少引用資料的分類版本。', 409);
  }
  for (const ref of lineage.versionVector) if (ref.publicationId) {
    const publication = publications.find(p => p.id === ref.publicationId);
    if (!publication || publication.tradeDate !== ref.date || publication.version !== ref.version
      || (publication.publicationHash && publication.publicationHash !== ref.publicationHash)
      || Object.entries(ref.sets).some(([fundId, setId]) => publication.sets[fundId] !== setId)) {
      fail('lineage_vector', '完整快照比較版本向量與公開證據不一致。', 409);
    }
  }
}
async function bodyForAuthor(id: string): Promise<Body> {
  const body = await read<Body>(BODIES, identity(id));
  if (!body || body.ownerKey !== OWNER) fail('not_found', '找不到私有報告快照。', 404);
  return body;
}
async function reconstruct(body: Body): Promise<Record<string, unknown>> {
  const contents: string[] = [];
  for (const ref of body.manifest.pages) {
    const page = await read<BodyPage>(PAGES, ref.pageId);
    if (!page || page.bodyId !== body.id || page.pageNo !== ref.pageNo || page.pageHash !== ref.pageHash
      || bytes(page.content) !== ref.byteLength || await contentHash(page.content) !== ref.pageHash) {
      fail('snapshot_incomplete', '完整快照頁缺漏或雜湊不符。', 409);
    }
    contents.push(page.content);
  }
  const content = contents.join('');
  if (bytes(content) !== body.manifest.bodyBytes || await contentHash(content) !== body.manifest.bodyHash) fail('snapshot_hash', '完整快照重建雜湊不符。', 409);
  let parsed: Record<string, unknown>;
  try { parsed = object(parseReportJson(content, MAX_SNAPSHOT_BYTES)); } catch { return fail('invalid_report', '完整快照JSON格式錯誤或重複鍵。'); }
  if (parsed.schemaVersion !== 2 || parsed.id !== body.reportId || parsed.reportType !== 'flows') fail('invalid_report', '完整快照版本或報告識別碼錯誤。');
  reportFields(parsed);
  parseLineage(parsed.dataLineage);
  // Validate the same reader-facing report fields without relaxing legacy schema1's180KiB.
  // Each complete logical section is checked in bounded projected schema1 records.
  const fields: Record<string, unknown> = { ...parsed, schemaVersion: 1 }; delete fields.dataLineage;
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const holdings = Array.isArray(parsed.holdings) ? parsed.holdings : undefined;
  if (rows.length > 5000 || (holdings?.length ?? 0) > 5) fail('report_rows', '報告資料筆數超過完整快照上限。');
  const summary = Array.isArray(parsed.summary) ? parsed.summary : [];
  const operations = Array.isArray(parsed.operations) ? parsed.operations : [];
  if (summary.length < 1 || summary.length > 12 || operations.length > 100) fail('report_count', '評論或營運證據筆數超出範圍。');
  const base = { ...fields, rows: rows.slice(0, 1), summary: summary.slice(0, 1), operations: [], holdings: undefined, institutional: undefined };
  const checkedBase = validateReport(base);
  if (!checkedBase.report) fail('invalid_report', '完整報告基本欄位驗證未通過。', 400, { errors: checkedBase.errors });
  for (const comment of summary) {
    const checked = validateReport({ ...base, summary: [comment] });
    if (!checked.report) fail('invalid_report', '完整評論驗證未通過。', 400, { errors: checked.errors });
  }
  for (const operation of operations) {
    const checked = validateReport({ ...base, operations: [operation] });
    if (!checked.report) fail('invalid_report', '營運證據驗證未通過。', 400, { errors: checked.errors });
  }
  for (let offset = 0; offset < rows.length; offset += 80) {
    const checked = validateReport({ ...base, rows: rows.slice(offset, offset + 80) });
    if (!checked.report) fail('invalid_report', '報告異動資料驗證未通過。', 400, { errors: checked.errors });
  }
  const unique = new Set<string>();
  const sectors = new Map<string, string>();
  for (const row of rows) {
    const r = object(row); const uniqueKey = String(r.etf) + ':' + String(r.code);
    if (unique.has(uniqueKey)) fail('duplicate_report_row', '報告ETF與股票唯一鍵重複。');
    unique.add(uniqueKey);
    if (sectors.has(String(r.code)) && sectors.get(String(r.code)) !== r.sector) fail('report_primary_group', '同一股票跨頁有重複主分組。');
    sectors.set(String(r.code), String(r.sector));
  }
  if (holdings) {
    const holdingFunds = new Set<string>();
    for (const item of holdings) {
      const h = object(item); const list = Array.isArray(h.rows) ? h.rows : [];
      if (holdingFunds.has(String(h.etf))) fail('duplicate_report_fund', '完整持股基金重複。');
      holdingFunds.add(String(h.etf));
      if (list.length > 5000) fail('report_rows', '基金持股筆數過大。');
      const seen = new Set<string>();
      for (let offset = 0; offset < list.length || offset === 0; offset += 80) {
        const checked = validateReport({ ...base, holdings: [{ ...h, rows: list.slice(offset, offset + 80), baseline: undefined }] });
        if (!checked.report) fail('invalid_report', '完整持股驗證未通過。', 400, { errors: checked.errors });
      }
      list.forEach(item => { const code = String(object(item).code); if (seen.has(code)) fail('duplicate_report_row', '完整持股代碼重複。'); seen.add(code); });
      if (list.reduce((sum, item) => sum + Number(object(item).weightPct ?? 0), 0) > 100.5) fail('report_weight_sum', '完整持股權重合計超過100.5%。');
      if (h.baseline !== undefined) {
        const b = object(h.baseline); const baselineRows = Array.isArray(b.rows) ? b.rows : [];
        if (baselineRows.length > 5000) fail('report_rows', '基期持股筆數過大。');
        const baselineCodes = baselineRows.map(item => String(object(item).code));
        if (new Set(baselineCodes).size !== baselineCodes.length) fail('duplicate_report_row', '基期持股代碼跨頁重複。');
        if (baselineRows.reduce((sum, item) => sum + Number(object(item).weightPct ?? 0), 0) > 100.5) fail('report_weight_sum', '基期持股權重合計超過100.5%。');
        for (let offset = 0; offset < baselineRows.length || offset === 0; offset += 80) {
          const checked = validateReport({ ...base, holdings: [{ ...h, rows: [], baseline: { ...b, rows: baselineRows.slice(offset, offset + 80) } }] });
          if (!checked.report) fail('invalid_report', '基期持股驗證未通過。', 400, { errors: checked.errors });
        }
      }
    }
  }
  if (parsed.institutional !== undefined) {
    const i = object(parsed.institutional); const stocks = Array.isArray(i.stocks) ? i.stocks : [];
    if (stocks.length > 5000 || new Set(stocks.map(item => String(object(item).code))).size !== stocks.length) fail('duplicate_report_row', '法人個股筆數過大或跨頁重複。');
    for (let offset = 0; offset < stocks.length || offset === 0; offset += 80) {
      const checked = validateReport({ ...base, institutional: { ...i, stocks: stocks.slice(offset, offset + 80) } });
      if (!checked.report) fail('invalid_report', '法人延伸驗證未通過。', 400, { errors: checked.errors });
    }
  }
  return parsed;
}
export async function readVersionedReport(id: string, versionInput?: string): Promise<RouterResponse> {
  if (!isReportId(id)) return error('找不到已發布研究。', 404);
  const published = await read<Public>(PUBLIC, id);
  if (!published) return error('找不到已發布研究。', 404);
  const version = versionInput === undefined || versionInput === '' ? published.version : Number(versionInput);
  if (!Number.isSafeInteger(version) || version < 1 || version > published.version
    || versionInput && !/^[1-9]\d*$/.test(versionInput)) return error('找不到指定已發布版本。', 404);
  const snapshotId = id + '.v' + version;
  const snapshot = await read<PagedSnapshot | LegacySnapshot>(SNAPSHOTS, snapshotId);
  if (!snapshot || snapshot.version !== version) return error('找不到指定已發布版本。', 404);
  if ('schemaVersion' in snapshot && snapshot.schemaVersion === 2) {
    const body = await read<Body>(BODIES, snapshot.bodyId);
    if (!body?.sealed || body.reportId !== id || snapshot.manifest.bodyHash !== body.manifest.bodyHash) return error('完整報告快照暫時無法讀取。', 503);
    return json({ schemaVersion: 2, version, publishedAt: snapshot.publishedAt, snapshotId, manifest: snapshot.manifest, report: null });
  }
  const legacy = snapshot as LegacySnapshot;
  const checked = validateReport(legacy.report);
  if (!checked.report || checked.report.id !== id) return error('已發布研究暫時無法讀取。', 503);
  return json({ report: checked.report, version, publishedAt: legacy.publishedAt, snapshotId });
}
export async function prepareEtfReportCommit(input: Record<string, unknown>, publication: Publication): Promise<ReportCommit> {
  if (publication.scopeId === QA_DATA_SCOPE) fail('qa_report_forbidden', '合成測試資料不能配對研究報告。', 409);
  if (input.bodyId !== undefined) {
    if (!SCHEMA2_PUBLICATION_ENABLED) fail('schema2_publication_disabled', '完整快照格式尚待讀者與作者介面完成相容驗證，目前不能發布。', 409);
    const body = await bodyForAuthor(identity(input.bodyId));
    if (!body.sealed || !body.reviewed || !body.dataLineage?.publicationIds.includes(publication.id)
      || publication.chosenSetIds.some(id => !body.dataLineage?.setIds.includes(id))) fail('report_review_required', '報告尚未審閱，或資料血緣與本次發布不符。', 409);
    await verifyPublicLineage(body.dataLineage, publication);
    const current = await read<Draft>(DRAFTS, body.reportId);
    requireLegacyFormat(current);
    if ((current?.revision ?? 0) !== body.baseRevision || (current?.publishedVersion ?? 0) !== body.expectedPublishedVersion) fail('report_revision_conflict', '報告版本已變更。', 409);
    const version = body.expectedPublishedVersion + 1; const snapshotId = body.reportId + '.v' + version;
    const summary = body.reportSummary as NonNullable<Body['reportSummary']>;
    const publicRecord = { id: body.reportId, ...summary, publishedAt: publication.publishedAt, version, snapshotId };
    return { snapshotId, operations: [
      db.tx.add(SNAPSHOTS, [{ id: snapshotId, schemaVersion: 2, bodyId: body.id, manifest: body.manifest,
        dataLineage: body.dataLineage, version, publishedAt: publication.publishedAt }]),
      current ? db.tx.update(DRAFTS, [{ id: body.reportId, if: { revision: body.baseRevision, publishedVersion: body.expectedPublishedVersion },
        record: { publishedVersion: version, publishedAt: publication.publishedAt, publishedDraftRevision: current.revision,
          schemaVersion: 2, bodyId: body.id, draft: null } }], { patch: true })
        : db.tx.add(DRAFTS, [{ id: body.reportId, ownerKey: OWNER, draft: null, revision: 1,
          publishedVersion: version, publishedDraftRevision: 1, publishedAt: publication.publishedAt, updatedAt: publication.publishedAt, schemaVersion: 2, bodyId: body.id }]),
      body.expectedPublishedVersion ? db.tx.update(PUBLIC, [{ id: body.reportId, record: publicRecord, if: { version: body.expectedPublishedVersion } }])
        : db.tx.add(PUBLIC, [publicRecord]),
      db.tx.update(BODIES, [{ id: body.id,
        if: { revision: body.revision, sealed: true, reviewed: true, reviewHash: body.reviewHash },
        record: { publishedVersion: version } }], { patch: true }),
    ] };
  }
  const id = input.id;
  if (!isReportId(id)) fail('invalid_report_id', '報告ID格式錯誤。');
  const current = await read<Draft>(DRAFTS, id);
  requireLegacyFormat(current);
  const baseRevision = integer(input.baseRevision, '報告草稿版本');
  if (!current || current.ownerKey !== OWNER || current.revision !== baseRevision) fail('report_revision_conflict', '報告草稿版本已變更。', 409);
  if (current.publishedDraftRevision === baseRevision) fail('already_published', '此報告草稿版本已發布。', 409);
  const checked = validateReport(current.draft);
  if (!checked.report || checked.report.period.end !== publication.tradeDate
    || publication.fundSelections.some(f => !checked.report?.funds.some(r => r.code === f.code))) {
    fail('report_data_mismatch', '報告日期或研究基金組與日資料不一致。', 409);
  }
  const version = current.publishedVersion + 1; const snapshotId = id + '.v' + version;
  const report = checked.report;
  const publicRecord = { id, title: report.title, excerpt: report.excerpt, period: report.period,
    evidenceDate: report.evidenceDate, publishedAt: publication.publishedAt, version, snapshotId };
  const lineage: DataLineage = { publicationIds: [publication.id], setIds: publication.chosenSetIds,
    sourceHashes: publication.sourceRefs.map(s => s.contentHash), taxonomyVersions: [],
    calendarVersion: publication.calendarVersion, comparison: { start: report.period.start, end: report.period.end },
    versionVector: [], algorithmVersion: 'atomic-report-data-v1' };
  return { snapshotId, operations: [
    db.tx.update(DRAFTS, [{ id, record: { publishedVersion: version, publishedAt: publication.publishedAt, publishedDraftRevision: baseRevision },
      if: { revision: baseRevision, publishedVersion: current.publishedVersion } }], { patch: true }),
    current.publishedVersion ? db.tx.update(PUBLIC, [{ id, record: publicRecord, if: { version: current.publishedVersion } }])
      : db.tx.add(PUBLIC, [publicRecord]),
    db.tx.add(SNAPSHOTS, [{ id: snapshotId, report, version, publishedAt: publication.publishedAt, dataLineage: lineage }]),
  ] };
}

async function publishBody(bodyId: string, input: Record<string, unknown>) {
  if (!SCHEMA2_PUBLICATION_ENABLED) fail('schema2_publication_disabled', '讀者與作者尚未完成完整快照相容驗證，目前不能發布。', 409);
  const body = await bodyForAuthor(bodyId);
  if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
  const replay = await requestStatus(input.requestId, await hash({ action: 'report_body_publish',
    payload: { bodyId, expectedRevision: input.expectedRevision, reviewHash: input.reviewHash } }));
  if (replay.state === 'committed') return { ...replay, body, snapshotId: body.reportId + '.v' + replay.version };
  if (input.confirmed !== true || !body.reviewed || input.expectedRevision !== body.revision || input.reviewHash !== body.reviewHash) {
    fail('review_required', '請明確確認目前完整快照與審閱版本。', 409);
  }
  if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
  // Validate every public lineage ref before exposing pages. Legacy reports remain self-contained.
  await verifyPublicLineage(body.dataLineage as DataLineage);
  const current = await read<Draft>(DRAFTS, body.reportId);
    requireLegacyFormat(current);
  if ((current?.revision ?? 0) !== body.baseRevision || (current?.publishedVersion ?? 0) !== body.expectedPublishedVersion) fail('revision_conflict', '報告公開或草稿版本已變更。', 409);
  const version = body.expectedPublishedVersion + 1;
  const snapshotId = body.reportId + '.v' + version;
  const publishedAt = new Date().toISOString();
  const summary = body.reportSummary as NonNullable<Body['reportSummary']>;
  const publicRecord = { id: body.reportId, ...summary, version, publishedAt, snapshotId };
  const result = await transact('report_body_publish', input.requestId,
    { bodyId, expectedRevision: body.revision, reviewHash: body.reviewHash }, { batchId: bodyId, revision: body.revision, version }, async () => [
      db.tx.add(SNAPSHOTS, [{ id: snapshotId, schemaVersion: 2, bodyId, manifest: body.manifest, dataLineage: body.dataLineage, version, publishedAt }]),
      current ? db.tx.update(DRAFTS, [{ id: body.reportId, if: { revision: body.baseRevision, publishedVersion: body.expectedPublishedVersion },
        record: { publishedVersion: version, publishedAt, publishedDraftRevision: current.revision,
          schemaVersion: 2, bodyId: body.id, draft: null } }], { patch: true })
        : db.tx.add(DRAFTS, [{ id: body.reportId, ownerKey: OWNER, draft: null, revision: 1, publishedVersion: version,
          publishedDraftRevision: 1, publishedAt, updatedAt: publishedAt, schemaVersion: 2, bodyId }]),
      body.expectedPublishedVersion ? db.tx.update(PUBLIC, [{ id: body.reportId, record: publicRecord, if: { version: body.expectedPublishedVersion } }])
        : db.tx.add(PUBLIC, [publicRecord]),
      db.tx.update(BODIES, [{ id: body.id, if: { revision: body.revision, reviewed: true, reviewHash: body.reviewHash }, record: { publishedVersion: version } }], { patch: true }),
    ]);
  return { ...result, body: await bodyForAuthor(bodyId), snapshotId };
}
export function makeEtfSnapshotRoutes(helpers: Helpers): RouterRoutes {
  function failure(caught: unknown) {
    if (caught instanceof DataFailure) return json({ error: caught.message, errorCode: caught.code, ...caught.details }, caught.status);
    if (isAppDatabaseError(caught)) return json({ error: '完整快照操作尚未確認，請先查詢同一請求狀態。', errorCode: caught.code, state: 'unresolved' }, caught.code === 'AppDatabaseQuotaExceeded' ? 429 : 503);
    return json({ error: caught instanceof Error ? caught.message : '完整快照暫時無法處理。' }, 503);
  }
  const privateRoute = (action: (ctx: RouterContext, input: Record<string, unknown>) => Promise<unknown>) => [async (ctx: RouterContext) => {
    try {
      if (bytes(ctx.body) > MAX_DATA_BYTES) return error('快照請求超過200KiB。', 413);
      if (!helpers.isSameOriginMutation(ctx.event)) return error('此請求來源不受允許。', 403);
      if (!await helpers.requireAdmin(ctx.event, ctx.body)) return error('請重新登入作者工作台。', 401);
      return json(await action(ctx, object(ctx.body)));
    } catch (caught) { return failure(caught); }
  }];
  return {
    'GET /api/etf/reports/:id/pages/:pageNo': [async ({ params, query }) => {
      try {
        const headerResponse = await readVersionedReport(params.id, query.version);
        if (headerResponse.statusCode !== 200) return headerResponse;
        const header = object(JSON.parse(headerResponse.body));
        if (header.schemaVersion !== 2) return error('此報告沒有分頁快照。', 404);
        const manifest = header.manifest as SnapshotManifest; const pageNo = Number(params.pageNo);
        if (!/^(0|[1-9]\d*)$/.test(params.pageNo) || !Number.isSafeInteger(pageNo) || pageNo >= manifest.pages.length) return error('找不到快照頁。', 404);
        const ref = manifest.pages[pageNo]; const page = await read<BodyPage>(PAGES, ref.pageId);
        if (!page || await contentHash(page.content) !== ref.pageHash || bytes(page.content) !== ref.byteLength) return error('快照頁完整性無法確認。', 503);
        return json({ snapshotId: header.snapshotId, pageNo, pageHash: ref.pageHash, content: page.content });
      } catch (caught) { return failure(caught); }
    }],
    'POST /api/admin/etf-reports/bodies': privateRoute(async (_ctx, input) => {
      if (!isRequestId(input.requestId) || !isReportId(input.reportId)) fail('invalid_report', '請求或報告ID格式錯誤。');
      requireLegacyFormat(await read(DRAFTS, input.reportId));
      const id = await key('report-body', OWNER, input.requestId);
      const manifest = parseManifest(input.manifest);
      const body: Body = { id, ownerKey: OWNER, reportId: input.reportId,
        baseRevision: integer(input.baseRevision, '報告版本'), revision: 1,
        expectedPublishedVersion: integer(input.expectedPublishedVersion, '發布版本'), manifest,
        sealed: false, reviewed: false, reportSummary: null, dataLineage: null, reviewHash: null };
      const existing = await read<Body>(BODIES, id);
      if (existing) {
        if (await hash({ ...existing, revision: 1, sealed: false, reviewed: false, reportSummary: null, dataLineage: null, reviewHash: null }) !== await hash(body)) fail('request_id_conflict', '請求識別碼已用於不同快照。', 409);
        return { body: existing, schema2PublicationEnabled: SCHEMA2_PUBLICATION_ENABLED };
      }
      const receipt = await transact('report_body_create', input.requestId, { ...body }, { batchId: id, revision: 1 }, async () => [db.tx.add(BODIES, [{ ...body }])]);
      return { ...receipt, body: await bodyForAuthor(id), schema2PublicationEnabled: SCHEMA2_PUBLICATION_ENABLED };
    }),
    'POST /api/admin/etf-reports/bodies/:id/get': privateRoute(async ctx => ({ body: await bodyForAuthor(ctx.params.id), schema2PublicationEnabled: SCHEMA2_PUBLICATION_ENABLED })),
    'POST /api/admin/etf-reports/bodies/:id/pages': privateRoute(async (ctx, input) => {
      const body = await bodyForAuthor(ctx.params.id);
      if (body.sealed) fail('body_sealed', '已封存內容不可修改。', 409);
      const pageNo = integer(input.pageNo, '快照頁', body.manifest.pages.length - 1);
      const ref = body.manifest.pages[pageNo];
      if (typeof input.content !== 'string' || bytes(input.content) !== ref.byteLength || await contentHash(input.content) !== ref.pageHash) fail('snapshot_hash', '快照頁大小或雜湊不符。');
      const page: BodyPage = { id: ref.pageId, bodyId: body.id, pageNo, pageHash: ref.pageHash, byteLength: ref.byteLength, content: input.content };
      const existing = await read<BodyPage>(PAGES, ref.pageId);
      if (existing && (existing.bodyId !== body.id || existing.pageHash !== ref.pageHash)) fail('page_conflict', '頁面識別碼已用於其他內容。', 409);
      if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
      const receipt = await transact('report_body_page', input.requestId, { bodyId: body.id, pageNo, pageHash: page.pageHash }, { batchId: body.id, revision: body.revision }, async () =>
        existing ? [] : [db.tx.add(PAGES, [{ ...page }])]);
      return { ...receipt, bodyId: body.id, pageNo, pageHash: page.pageHash };
    }),
    'POST /api/admin/etf-reports/bodies/:id/page': privateRoute(async (ctx, input) => {
      const body = await bodyForAuthor(ctx.params.id); const pageNo = integer(input.pageNo, '快照頁', body.manifest.pages.length - 1);
      const page = await read<BodyPage>(PAGES, body.manifest.pages[pageNo].pageId);
      if (!page || page.bodyId !== body.id) fail('not_found', '找不到私有快照頁。', 404);
      return { bodyId: body.id, pageNo, pageHash: page.pageHash, content: page.content };
    }),
    'POST /api/admin/etf-reports/bodies/:id/validate': privateRoute(async (ctx, input) => {
      const body = await bodyForAuthor(ctx.params.id);
      if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
      const replay = await requestStatus(input.requestId, await hash({ action: 'report_body_validate',
        payload: { bodyId: body.id, expectedRevision: input.expectedRevision } }));
      if (replay.state === 'committed') return { ...replay, body,
        validation: { blockingErrors: [], warnings: [], reviewHash: body.reviewHash } };
      if (body.revision !== integer(input.expectedRevision, '快照版本')) fail('revision_conflict', '快照版本已變更。', 409);
      const report = await reconstruct(body); const dataLineage = parseLineage(report.dataLineage);
      const reviewHash = await hash({ manifest: body.manifest, dataLineage });
      const reportSummary = { title: String(report.title), excerpt: String(report.excerpt),
        period: report.period as { start: string; end: string }, evidenceDate: String(report.evidenceDate) };
      if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
      const receipt = await transact('report_body_validate', input.requestId, { bodyId: body.id, expectedRevision: input.expectedRevision }, { batchId: body.id, revision: body.revision + 1 }, async () => [
        db.tx.update(BODIES, [{ id: body.id, if: { revision: body.revision },
          record: { revision: body.revision + 1, sealed: true, reviewed: false, dataLineage, reportSummary, reviewHash } }], { patch: true }),
      ]);
      return { ...receipt, body: await bodyForAuthor(body.id), validation: { blockingErrors: [], warnings: [], reviewHash } };
    }),
    'POST /api/admin/etf-reports/bodies/:id/review': privateRoute(async (ctx, input) => {
      const body = await bodyForAuthor(ctx.params.id);
      if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
      const replay = await requestStatus(input.requestId, await hash({ action: 'report_body_review',
        payload: { bodyId: body.id, expectedRevision: input.expectedRevision, reviewHash: input.reviewHash } }));
      if (replay.state === 'committed') return { ...replay, body, schema2PublicationEnabled: SCHEMA2_PUBLICATION_ENABLED };
      if (!body.sealed || input.acknowledged !== true || input.reviewHash !== body.reviewHash || input.expectedRevision !== body.revision) fail('review_required', '請確認目前完整快照與缺口。', 409);
      if (!isRequestId(input.requestId)) fail('request_id_required', '請保留有效請求識別碼。');
      const receipt = await transact('report_body_review', input.requestId, { bodyId: body.id, expectedRevision: input.expectedRevision, reviewHash: input.reviewHash }, { batchId: body.id, revision: body.revision + 1 }, async () => [
        db.tx.update(BODIES, [{ id: body.id, if: { revision: body.revision, sealed: true }, record: { reviewed: true, revision: body.revision + 1 } }], { patch: true }),
      ]);
      return { ...receipt, body: await bodyForAuthor(body.id), schema2PublicationEnabled: SCHEMA2_PUBLICATION_ENABLED };
    }),
    'POST /api/admin/etf-reports/bodies/:id/publish': privateRoute((ctx, input) => publishBody(ctx.params.id, input)),
  };
}
