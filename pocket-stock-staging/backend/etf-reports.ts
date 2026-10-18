import { readVersionedReport } from './etf-data-snapshots.ts';
import { etfCoverDescriptor, isMarkdownStorage, readPublishedMarkdown } from './etf-markdown.ts';
import type { EtfCoverMetadata } from '../shared/etf-cover.ts';
import {
  db,
  error,
  isAppDatabaseError,
  json,
} from '@appdeploy/sdk';
import type { RouterContext, RouterResponse, RouterRoutes } from '@appdeploy/sdk';
import {
  isReportId,
  isRequestId,
  jsonByteSize,
  MAX_REPORT_BYTES,
  validateReport,
} from '../shared/etf-contract.ts';
import type { Entry, EtfReport, ReportSummary } from '../shared/etf-contract.ts';

const DRAFTS = 'etf_reports_v1';
const PUBLIC = 'etf_public_reports_v1';
const SNAPSHOTS = 'etf_report_snapshots_v1';
const RECEIPTS = 'etf_request_receipts_v1';
const OWNER = 'staging-master-secret-author';
const READ_ATTEMPTS = 2;
const WRITE_ATTEMPTS = 3;

type DraftRecord = {
  archived?: boolean;
  ownerKey: string;
  draft: EtfReport;
  revision: number;
  updatedAt: string;
  publishedVersion: number;
  publishedAt: string | null;
  publishedDraftRevision: number;
  schemaVersion?: 2;
  bodyId?: string;
};

type PublicRecord = ReportSummary & { snapshotId: string; archived?: boolean; cover?: EtfCoverMetadata & {storagePath:string} | null };
type SnapshotRecord = {
  report: EtfReport;
  version: number;
  publishedAt: string;
};

type Receipt = {
  ownerKey: string;
  requestId: string;
  action: 'save' | 'publish' | 'visibility';
  fingerprint: string;
  reportId: string;
  revision: number;
  publishedVersion: number;
};

type AuthHelpers = {
  requireAdmin: (
    event: unknown,
    body?: unknown
  ) => Promise<{ id: string } | null>;
  isSameOriginMutation: (event: unknown) => boolean;
};

class RequestFailure extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function entry(id: string, record: DraftRecord): Entry {
  return {
    id,
    draft: record.draft,
    revision: record.revision,
    updatedAt: record.updatedAt,
    publishedVersion: record.publishedVersion,
    publishedAt: record.publishedAt,
    hasUnpublishedChanges: record.revision !== record.publishedDraftRevision,
    archived: record.archived === true,
    ...(record.schemaVersion === 2 ? { schemaVersion: 2, bodyId: record.bodyId } : {}),
  };
}

function responseFailure(caught: unknown): RouterResponse {
  if (caught instanceof RequestFailure) {
    return json({
      error: caught.message,
      errorCode: caught.code,
      ...caught.details,
    }, caught.status);
  }
  if (isAppDatabaseError(caught)) {
    if (caught.code === 'AppDatabaseQuotaExceeded') {
      return json({
        error: '資料庫額度已達上限，請稍後再試。',
        errorCode: caught.code,
      }, 429);
    }
    return json({
      error: '資料暫時無法確認，請重新查詢狀態。',
      errorCode: caught.code,
    }, 503);
  }
  return error('研究資料暫時無法處理，請稍後重試。', 500);
}

function nextTimestamp(previous?: string): string {
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(
    Date.now(),
    Number.isFinite(previousTime) ? previousTime + 1 : 0
  )).toISOString();
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readOne<T>(table: string, id: string): Promise<T | null> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      const [record] = await db.get<T>(table, [id], { consistent: true });
      return record;
    } catch (caught) {
      const retryable = isAppDatabaseError(caught) && (
        caught.code === 'AppDatabaseReadIncomplete' ||
        caught.code === 'AppDatabaseGatewayUnavailable'
      );
      if (!retryable || attempt + 1 === READ_ATTEMPTS) throw caught;
    }
  }
  throw new RequestFailure('資料讀取尚未完成。', 503, 'read_unresolved');
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function transactionAvailable(): boolean {
  return typeof db.tx?.add === 'function' &&
    typeof db.tx?.update === 'function' &&
    typeof db.transact === 'function';
}

function requireTransactions() {
  if (!transactionAvailable()) {
    throw new RequestFailure(
      '目前部署的資料庫版本尚未支援安全發布，請更新服務。',
      503,
      'transaction_capability_unavailable'
    );
  }
}

function readCursor(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 4096) {
    throw new RequestFailure('分頁游標格式錯誤。', 400, 'invalid_cursor');
  }
  return value;
}

function ensureBodyLimit(context: RouterContext): RouterResponse | undefined {
  const rawEvent = asObject(context.event);
  const rawBody = rawEvent?.body;
  let size = jsonByteSize(context.body);
  if (typeof rawBody === 'string') {
    const nativeSize = rawEvent?.isBase64Encoded === true
      ? Math.floor(rawBody.length * 3 / 4) - (rawBody.endsWith('==') ? 2 : rawBody.endsWith('=') ? 1 : 0)
      : new TextEncoder().encode(rawBody).byteLength;
    size = Math.max(size, nativeSize);
  }
  return size > MAX_REPORT_BYTES
    ? error('請求內容超過 180 KiB。', 413)
    : undefined;
}

async function receipt(
  requestId: string,
  expectedFingerprint?: string
): Promise<Receipt | null> {
  const saved = await readOne<Receipt>(RECEIPTS, requestId);
  if (!saved) return null;
  if (
    saved.ownerKey !== OWNER ||
    saved.requestId !== requestId ||
    (expectedFingerprint !== undefined && saved.fingerprint !== expectedFingerprint)
  ) {
    throw new RequestFailure(
      '請求識別碼已用於另一筆操作。',
      409,
      'request_id_conflict'
    );
  }
  return saved;
}

async function receiptEntry(saved: Receipt): Promise<Entry> {
  const current = await readOne<DraftRecord>(DRAFTS, saved.reportId);
  if (
    !current || current.ownerKey !== OWNER ||
    current.revision < saved.revision ||
    current.publishedVersion < saved.publishedVersion
  ) {
    throw new RequestFailure(
      '操作已記錄，但研究版本尚無法確認，請重新查詢。',
      503,
      'outcome_unresolved',
      { requestId: saved.requestId, state: 'unresolved' }
    );
  }
  return entry(saved.reportId, current);
}

async function recoverReceipt(
  requestId: string,
  expectedFingerprint: string
): Promise<Receipt | null> {
  return receipt(requestId, expectedFingerprint);
}

function revisionConflict(id: string, current: DraftRecord | null): never {
  throw new RequestFailure(
    '草稿版本已變更，請重新載入後再確認。',
    409,
    'revision_conflict',
    current ? { entry: entry(id, current) } : {}
  );
}

async function saveDraft(
  report: EtfReport,
  baseRevision: number,
  requestId: string
): Promise<Entry> {
  requireTransactions();
  const requestFingerprint = await fingerprint({ action: 'save', report, baseRevision });
  const previous = await receipt(requestId, requestFingerprint);
  if (previous) return receiptEntry(previous);

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const current = await readOne<DraftRecord>(DRAFTS, report.id);
    if (isMarkdownStorage(current)) throw new RequestFailure('此 ID 已屬 Markdown 研究，請使用原格式編輯。',409,'format_conflict');
    if (current && current.ownerKey !== OWNER) {
      throw new RequestFailure('沒有此草稿的操作權限。', 403, 'owner_mismatch');
    }
    if ((current?.revision ?? 0) !== baseRevision) revisionConflict(report.id, current);
    const next: DraftRecord = {
      archived: current?.archived === true,
      ownerKey: OWNER,
      draft: report,
      revision: baseRevision + 1,
      updatedAt: nextTimestamp(current?.updatedAt),
      publishedVersion: current?.publishedVersion ?? 0,
      publishedAt: current?.publishedAt ?? null,
      publishedDraftRevision: current?.publishedDraftRevision ?? 0,
    };
    const result = entry(report.id, next);
    const savedReceipt: Receipt = {
      ownerKey: OWNER,
      requestId,
      action: 'save',
      fingerprint: requestFingerprint,
      reportId: report.id,
      revision: next.revision,
      publishedVersion: next.publishedVersion,
    };
    const draftWrite = current
      ? db.tx.update(DRAFTS, [{
          id: report.id,
          record: {
            draft: next.draft,
            revision: next.revision,
            updatedAt: next.updatedAt,
            schemaVersion: undefined,
            bodyId: undefined,
          },
          if: {
            revision: baseRevision,
            publishedVersion: current.publishedVersion,
          },
        }], { patch: true })
      : db.tx.add(DRAFTS, [{ id: report.id, ...next }]);
    const receiptWrite = db.tx.add(RECEIPTS, [{ id: requestId, ...savedReceipt }]);
    try {
      await db.transact([draftWrite, receiptWrite]);
      return result;
    } catch (caught) {
      if (!isAppDatabaseError(caught)) throw caught;
      if (caught.code === 'AppDatabaseQuotaExceeded') throw caught;
      const saved = await recoverReceipt(requestId, requestFingerprint);
      if (saved) return receiptEntry(saved);
      if (
        caught.code === 'AppDatabaseUnknownOutcome' ||
        caught.code === 'AppDatabaseGatewayUnavailable'
      ) {
        throw new RequestFailure(
          '儲存結果尚未確認，請先查詢這筆操作的狀態。',
          503,
          'outcome_unresolved',
          { requestId, state: 'unresolved' }
        );
      }
      if (
        caught.code !== 'AppDatabaseConflict' &&
        caught.code !== 'AppDatabaseConditionFailed' &&
        caught.code !== 'AppDatabaseDuplicateId'
      ) throw caught;
      const refreshed = await readOne<DraftRecord>(DRAFTS, report.id);
      if ((refreshed?.revision ?? 0) !== baseRevision) revisionConflict(report.id, refreshed);
      // Only known-aborted conflict/condition failures are retried with fresh
      // handles. Duplicate receipts could still be pending; do not repeat them.
      if (caught.code === 'AppDatabaseDuplicateId') {
        throw new RequestFailure(
          '這筆操作尚未確認，請先查詢狀態。',
          503,
          'outcome_unresolved',
          { requestId, state: 'unresolved' }
        );
      }
      if (attempt + 1 === WRITE_ATTEMPTS) {
        throw new RequestFailure('目前有其他操作，請重新載入。', 409, 'write_conflict');
      }
    }
  }
  throw new RequestFailure('儲存尚未完成。', 503, 'outcome_unresolved', { requestId });
}

async function publishDraft(
  id: string,
  baseRevision: number,
  requestId: string
): Promise<Entry> {
  requireTransactions();
  const requestFingerprint = await fingerprint({ action: 'publish', id, baseRevision });
  const previous = await receipt(requestId, requestFingerprint);
  if (previous) return receiptEntry(previous);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const current = await readOne<DraftRecord>(DRAFTS, id);
    if (!current) throw new RequestFailure('找不到研究草稿。', 404, 'not_found');
    if (isMarkdownStorage(current)) throw new RequestFailure('請使用 Markdown 原格式發布。',409,'format_conflict');
    if (current.ownerKey !== OWNER) {
      throw new RequestFailure('沒有此草稿的操作權限。', 403, 'owner_mismatch');
    }
    if (current.revision !== baseRevision) revisionConflict(id, current);
    if (current.publishedVersion > 0 && current.publishedDraftRevision === current.revision) {
      throw new RequestFailure('此版本已發布，沒有未發布的變更。', 409, 'already_published', { entry: entry(id, current) });
    }
    const checked = validateReport(current.draft);
    if (!checked.report) {
      throw new RequestFailure('草稿資料驗證未通過。', 400, 'invalid_report', {
        errors: checked.errors,
        warnings: checked.warnings,
      });
    }
    const publishedAt = nextTimestamp(current.publishedAt ?? undefined);
    const version = current.publishedVersion + 1;
    const snapshotId = id + '.v' + String(version);
    const snapshot: SnapshotRecord = { report: checked.report, version, publishedAt };
    const publicRecord: PublicRecord = {
      id,
      title: checked.report.title,
      excerpt: checked.report.excerpt,
      period: { ...checked.report.period },
      evidenceDate: checked.report.evidenceDate,
      publishedAt,
      version,
      snapshotId,
    };
    const next = {
      ...current,
      archived: false,
      publishedVersion: version,
      publishedAt,
      publishedDraftRevision: current.revision,
    };
    const result = entry(id, next);
    const savedReceipt: Receipt = {
      ownerKey: OWNER,
      requestId,
      action: 'publish',
      fingerprint: requestFingerprint,
      reportId: id,
      revision: next.revision,
      publishedVersion: next.publishedVersion,
    };
    const draftWrite = db.tx.update(DRAFTS, [{
      id,
      record: {
        publishedVersion: version,
        archived: false,
        publishedAt,
        publishedDraftRevision: current.revision,
      },
      if: {
        revision: baseRevision,
        publishedVersion: current.publishedVersion,
      },
    }], { patch: true });
    const publicWrite = current.publishedVersion === 0
      ? db.tx.add(PUBLIC, [{ ...publicRecord }])
      : db.tx.update(PUBLIC, [{
          id,
          record: { ...publicRecord },
          if: { version: current.publishedVersion },
        }]);
    const snapshotWrite = db.tx.add(SNAPSHOTS, [{ id: snapshotId, ...snapshot }]);
    const receiptWrite = db.tx.add(RECEIPTS, [{ id: requestId, ...savedReceipt }]);
    try {
      await db.transact([draftWrite, publicWrite, snapshotWrite, receiptWrite]);
      return result;
    } catch (caught) {
      if (!isAppDatabaseError(caught)) throw caught;
      if (caught.code === 'AppDatabaseQuotaExceeded') throw caught;
      const saved = await recoverReceipt(requestId, requestFingerprint);
      if (saved) return receiptEntry(saved);
      if (
        caught.code === 'AppDatabaseUnknownOutcome' ||
        caught.code === 'AppDatabaseGatewayUnavailable'
      ) {
        throw new RequestFailure(
          '發布結果尚未確認，請先查詢這筆操作的狀態。',
          503,
          'outcome_unresolved',
          { requestId, state: 'unresolved' }
        );
      }
      if (
        caught.code !== 'AppDatabaseConflict' &&
        caught.code !== 'AppDatabaseConditionFailed' &&
        caught.code !== 'AppDatabaseDuplicateId'
      ) throw caught;
      const refreshed = await readOne<DraftRecord>(DRAFTS, id);
      if (
        !refreshed || refreshed.revision !== baseRevision ||
        refreshed.publishedVersion !== current.publishedVersion
      ) revisionConflict(id, refreshed);
      if (caught.code === 'AppDatabaseDuplicateId') {
        throw new RequestFailure(
          '這筆發布尚未確認，請先查詢狀態。',
          503,
          'outcome_unresolved',
          { requestId, state: 'unresolved' }
        );
      }
      if (attempt + 1 === WRITE_ATTEMPTS) {
        throw new RequestFailure('目前有其他操作，請重新載入。', 409, 'write_conflict');
      }
    }
  }
  throw new RequestFailure('發布尚未完成。', 503, 'outcome_unresolved', { requestId });
}

function publicSummary(record: PublicRecord): ReportSummary {
  return {
    id: record.id,
    title: record.title,
    excerpt: record.excerpt,
    period: { start: record.period.start, end: record.period.end },
    evidenceDate: record.evidenceDate,
    publishedAt: record.publishedAt,
    version: record.version,
  };
}

export function makeEtfRoutes(helpers: AuthHelpers): RouterRoutes {
  const privateRoute = (
    action: (context: RouterContext, input: Record<string, unknown>) => Promise<RouterResponse>
  ) => [async (context: RouterContext) => {
    try {
      const bodyLimit = ensureBodyLimit(context);
      if (bodyLimit) return bodyLimit;
      if (!helpers.isSameOriginMutation(context.event)) {
        return error('此請求來源不受允許。', 403);
      }
      if (!(await helpers.requireAdmin(context.event, context.body))) {
        return error('請重新登入作者工作台。', 401);
      }
      const input = asObject(context.body);
      if (!input) return error('請求格式錯誤。', 400);
      return await action(context, input);
    } catch (caught) {
      return responseFailure(caught);
    }
  }];

  return {
    'GET /api/etf/reports': [async ({ query }) => {
      try {
        const page = await db.list<PublicRecord>(PUBLIC, {
          limit: 20,
          nextToken: readCursor(query.nextToken),
        });
        const records = page.items
          .filter(item => !item.archived && isReportId(item.id) && Number.isSafeInteger(item.version) && item.version > 0)
          .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
        const items = await Promise.all(records.map(async record => ({...publicSummary(record),cover:await etfCoverDescriptor(record.cover)})));
        return json({ items, nextToken: page.nextToken ?? null });
      } catch (caught) {
        return responseFailure(caught);
      }
    }],

    'GET /api/etf/reports/:id': [async ({ params, query }) => {
      try {
        if (!isReportId(params.id)) return error('找不到已發布研究。', 404);
        const visibility = await readOne<PublicRecord>(PUBLIC, params.id);
        if (!visibility || visibility.archived) return error('找不到已發布研究。', 404);
        const markdown = await readPublishedMarkdown(params.id, query.version);
        if (markdown) return markdown;
        if (query.version !== undefined) return await readVersionedReport(params.id, query.version);
        if (!isReportId(params.id)) return error('找不到已發布研究。', 404);
        const published = await readOne<PublicRecord>(PUBLIC, params.id);
        if (!published) return error('找不到已發布研究。', 404);
        const snapshot = await readOne<SnapshotRecord>(SNAPSHOTS, published.snapshotId);
        if (!snapshot || snapshot.version !== published.version) {
          return error('已發布研究暫時無法讀取。', 503);
        }
        if ('schemaVersion' in snapshot && snapshot.schemaVersion === 2) return await readVersionedReport(params.id);
        const checked = validateReport(snapshot.report);
        if (!checked.report || checked.report.id !== params.id) {
          return error('已發布研究暫時無法讀取。', 503);
        }
        return json({
          report: checked.report,
          version: snapshot.version,
          publishedAt: snapshot.publishedAt,
        });
      } catch (caught) {
        return responseFailure(caught);
      }
    }],

    'POST /api/admin/etf-reports/list': privateRoute(async (_context, input) => {
      // Drafts include their data package. Four capped records keep each page
      // below the database's 1 MiB serialized response budget.
      const page = await db.list<DraftRecord>(DRAFTS, {
        limit: 4,
        nextToken: readCursor(input.nextToken),
      });
      const items = page.items
        .filter(record => record.ownerKey === OWNER && !isMarkdownStorage(record))
        .map(record => entry(record.id, record))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return json({ items, nextToken: page.nextToken ?? null });
    }),

    'POST /api/admin/etf-reports/get': privateRoute(async (_context, input) => {
      if (!isReportId(input.id)) return error('報告 ID 格式錯誤。', 400);
      const record = await readOne<DraftRecord>(DRAFTS, input.id);
      return record && record.ownerKey === OWNER && !isMarkdownStorage(record)
        ? json({ entry: entry(input.id, record) })
        : error('找不到研究草稿。', 404);
    }),

    'POST /api/admin/etf-reports/validate': privateRoute(async (_context, input) => {
      const checked = validateReport(input.report);
      return json(checked);
    }),

    'POST /api/admin/etf-reports/save': privateRoute(async (_context, input) => {
      if (!validRevision(input.baseRevision) || !isRequestId(input.requestId)) {
        return error('需要有效的草稿版本與請求識別碼。', 400);
      }
      const checked = validateReport(input.report);
      if (!checked.report) return json(checked, 400);
      const saved = await saveDraft(checked.report, input.baseRevision, input.requestId);
      return json({ entry: saved });
    }),

    'POST /api/admin/etf-reports/publish': privateRoute(async (_context, input) => {
      if (
        !isReportId(input.id) || !validRevision(input.baseRevision) ||
        !isRequestId(input.requestId) || input.reviewed !== true
      ) return error('請確認研究內容、資料缺口與目前草稿版本後再發布。', 400);
      const published = await publishDraft(input.id, input.baseRevision, input.requestId);
      return json({ entry: published });
    }),

    'POST /api/admin/etf-reports/status': privateRoute(async (_context, input) => {
      if (!isRequestId(input.requestId)) return error('請求識別碼格式錯誤。', 400);
      const saved = await receipt(input.requestId);
      // Even a consistent absent receipt cannot rule out a still-pending commit.
      return json({
        requestId: input.requestId,
        state: saved ? 'applied' : 'unresolved',
        ...(saved ? { entry: await receiptEntry(saved) } : {}),
      });
    }),

    'POST /api/admin/etf-reports/visibility': privateRoute(async (_context, input) => {
      if (!isReportId(input.id) || !validRevision(input.baseRevision) ||
        !validRevision(input.expectedPublishedVersion) || !isRequestId(input.requestId) || typeof input.archived !== 'boolean') {
        return error('需要目前報告、草稿與公開版本及有效請求識別碼。', 400);
      }
      requireTransactions();
      const fp = await fingerprint({ action: 'visibility', id: input.id, baseRevision: input.baseRevision, expectedPublishedVersion: input.expectedPublishedVersion, archived: input.archived });
      const prior = await receipt(input.requestId, fp);
      if (prior) return json({ entry: await receiptEntry(prior) });
      const current = await readOne<DraftRecord>(DRAFTS, input.id);
      if (!current || current.ownerKey !== OWNER) return error('找不到研究草稿。', 404);
      if (isMarkdownStorage(current) || current.schemaVersion === 2) return error('此操作僅適用舊 JSON 報告。', 400);
      if (current.revision !== input.baseRevision || current.publishedVersion !== input.expectedPublishedVersion) revisionConflict(input.id, current);
      if (!current.publishedVersion) return error('這篇報告尚無可管理的公開版本。', 409);
      const updatedAt = nextTimestamp(current.updatedAt);
      const saved: Receipt = { ownerKey: OWNER, action: 'visibility', requestId: input.requestId, fingerprint: fp, reportId: input.id, revision: current.revision, publishedVersion: current.publishedVersion };
      try {
        await db.transact([
          db.tx.update(DRAFTS, [{ id: input.id, record: { archived: input.archived, updatedAt }, if: { revision: current.revision, publishedVersion: current.publishedVersion, updatedAt: current.updatedAt } }], { patch: true }),
          db.tx.update(PUBLIC, [{ id: input.id, record: { archived: input.archived }, if: { version: current.publishedVersion } }], { patch: true }),
          db.tx.add(RECEIPTS, [{ id: input.requestId, ...saved }]),
        ]);
      } catch (caught) {
        const found = await receipt(input.requestId, fp);
        if (found) return json({ entry: await receiptEntry(found) });
        if (isAppDatabaseError(caught) && ['AppDatabaseConflict', 'AppDatabaseConditionFailed'].includes(caught.code)) {
          throw new RequestFailure('報告狀態已變更，請重新載入。', 409, 'revision_conflict');
        }
        throw caught;
      }
      return json({ entry: entry(input.id, { ...current, archived: input.archived, updatedAt }) });
    }),
  };
}

