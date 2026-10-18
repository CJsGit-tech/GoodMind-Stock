import { error, isAppDatabaseError, json, storage } from '@appdeploy/sdk';
import type { RouterContext, RouterResponse, RouterRoutes } from '@appdeploy/sdk';
import { bytes, MAX_CHUNK_BYTES, object, identity } from '../shared/etf-data-contract.ts';
import { batchById, cancelBatch, createBatch, DataFailure, getHead, listBatches,
  publishBatch, planPublication, read, requestStatus, restorePublication, reviewBatch, uploadChunk, validateBatch, getPublication,
} from './etf-data-store.ts';
import type { PrepareReport } from './etf-data-store.ts';
import { catalogQuery, compareQuery, dataQuery, historyQuery, privatePreview } from './etf-data-query.ts';
import { industryHistoryQuery, qaIndustryHistoryQuery } from './etf-industry-history.ts';
import type { DataRecord } from '../shared/etf-data-contract.ts';
type Helpers = {
  requireAdmin: (event: unknown, body?: unknown) => Promise<{ id: string } | null>;
  isSameOriginMutation: (event: unknown) => boolean;
  prepareReport: PrepareReport;
};
export function dataError(caught: unknown): RouterResponse {
  if (caught instanceof DataFailure) return json({ error: caught.message, errorCode: caught.code, ...caught.details }, caught.status);
  if (isAppDatabaseError(caught)) {
    return json({ error: caught.code === 'AppDatabaseQuotaExceeded' ? '資料庫額度已達上限，進度已保留。' : '資料讀取或操作尚未確認，請重試讀取或查詢同一請求狀態。',
      errorCode: caught.code, ...(caught.code === 'AppDatabaseUnknownOutcome' ? { state: 'unresolved' } : {}) },
    caught.code === 'AppDatabaseQuotaExceeded' ? 429 : 503);
  }
  if (caught instanceof Error && !('code' in caught)) return json({ error: caught.message, errorCode: 'invalid_data' }, 400);
  return error('ETF資料暫時無法處理。', 500);
}
function bodyLimit(context: RouterContext) {
  let nativeSize = 0;
  const event = context.event as { body?: unknown; isBase64Encoded?: boolean } | undefined;
  if (typeof event?.body === 'string') nativeSize = event.isBase64Encoded ? Math.floor(event.body.length * 3 / 4) : bytes(event.body);
  return Math.max(bytes(context.body), nativeSize) > MAX_CHUNK_BYTES;
}
export function makeEtfDataRoutes(helpers: Helpers): RouterRoutes {
  const privateRoute = (action: (ctx: RouterContext, input: Record<string, unknown>) => Promise<unknown>) => [async (ctx: RouterContext) => {
    try {
      if (bodyLimit(ctx)) return error('資料請求超過700KiB，請分批匯入。', 413);
      if (!helpers.isSameOriginMutation(ctx.event)) return error('此請求來源不受允許。', 403);
      if (!await helpers.requireAdmin(ctx.event, ctx.body)) return error('請重新登入作者工作台。', 401);
      return json(await action(ctx, object(ctx.body)));
    } catch (caught) { return dataError(caught); }
  }];
  const publicRoute = (action: (query: Record<string, string>) => Promise<unknown>) => [async ({ query }: RouterContext) => {
    try { return json(await action(query)); } catch (caught) { return dataError(caught); }
  }];
  return {
    'GET /api/etf/catalog': publicRoute(catalogQuery),
    'GET /api/etf/data': publicRoute(dataQuery),
    'GET /api/etf/compare': publicRoute(compareQuery),
    'GET /api/etf/history': publicRoute(historyQuery),
    'GET /api/etf/industry-history': publicRoute(industryHistoryQuery),
    'GET /api/etf/qa-industry-history': publicRoute(qaIndustryHistoryQuery),
    'POST /api/admin/etf-data/batches': privateRoute((_ctx, input) => createBatch(input)),
    'POST /api/admin/etf-data/batches/list': privateRoute((_ctx, input) => listBatches(input)),
    'POST /api/admin/etf-data/batches/:id/get': privateRoute(async (ctx) => {
      const batch = await batchById(ctx.params.id);
      return { batch, currentHead: await getHead(batch.manifest.scopeId, batch.manifest.requestedDate) };
    }),
    'POST /api/admin/etf-data/batches/:id/chunks': privateRoute((ctx, input) => uploadChunk(ctx.params.id, input)),
    'POST /api/admin/etf-data/batches/:id/validate': privateRoute((ctx, input) => validateBatch(ctx.params.id, input)),
    'POST /api/admin/etf-data/batches/:id/preview': privateRoute((ctx, input) => privatePreview(ctx.params.id, input)),
    'POST /api/admin/etf-data/batches/:id/review': privateRoute((ctx, input) => reviewBatch(ctx.params.id, input)),
    'POST /api/admin/etf-data/batches/:id/publish': privateRoute((ctx, input) => publishBatch(ctx.params.id, input, helpers.prepareReport)),
    'POST /api/admin/etf-data/batches/:id/plan': privateRoute((ctx, input) => planPublication(ctx.params.id, input)),
    'POST /api/admin/etf-data/batches/:id/cancel': privateRoute((ctx, input) => cancelBatch(ctx.params.id, input)),
    'POST /api/admin/etf-data/requests/:id/status': privateRoute(ctx => requestStatus(ctx.params.id)),
    'POST /api/admin/etf-data/publications/:id/restore': privateRoute((ctx, input) => restorePublication(ctx.params.id, input)),
    'POST /api/admin/etf-data/publications/:id/get': privateRoute(async ctx => {
      const publication = await getPublication(ctx.params.id);
      return { publication, currentHead: await getHead(publication.scopeId, publication.tradeDate) };
    }),
    'POST /api/admin/etf-data/batches/:id/source': privateRoute(async (ctx, input) => {
      const batch = await batchById(ctx.params.id); const sourceId = identity(input.sourceDocumentId);
      if (!batch.manifest.sets.some(s => s.sourceDocumentIds.includes(sourceId))
        && !batch.manifest.selectionEvidenceIds.includes(sourceId)) return { error: '此來源不屬於任務。' };
      const record = await read<DataRecord>('source_documents_v2', sourceId);
      const path = record?.privateRawStorageRef;
      if (typeof path !== 'string' || !path.startsWith('etf-private/')) return { sourceDocumentId: sourceId, content: null };
      const [raw] = await storage.read([path]);
      if (raw?.content && bytes(raw.content) > MAX_CHUNK_BYTES) return { sourceDocumentId: sourceId, content: null, error: '來源原檔過大。' };
      return { sourceDocumentId: sourceId, content: raw?.content ?? null, mimeType: record?.mimeType ?? 'text/plain' };
    }),
  };
}
