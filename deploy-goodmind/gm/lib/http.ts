// AppDeploy build of src/lib/http.ts. Reads run in the browser against the published graph (query engine,
// data quality); the backend stores the graph and signs admins in. Writes are validated here by the same
// write gate as local development (core/write.ts), then published through the backend, which requires a
// valid admin token for every change.
import { api } from '@appdeploy/client';
import { decodeSeed } from '../data/decode';
import { applySchema } from '../core/ontology';
import { gqcRegistry, runGqc } from '../core/gqc';
import { validateData } from '../core/validate';
import { applyWrites } from '../core/write';
import type { WriteOp } from '../core/write';
import { computeSuggestions, recordFor } from '../core/suggest';
import type { Decision } from '../core/suggest';
import type { Graph, GraphEdge, GraphNode } from '../core/types';

export type HttpResult = { ok: boolean; status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN_KEY = 'goodmind.admin';
const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
const setToken = (t: string) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
const ok = (data: unknown): HttpResult => ({ ok: true, status: 200, data });
const fail = (status: number, data: unknown): HttpResult => ({ ok: false, status, data });

type Stored = { nodes: GraphNode[]; edges: GraphEdge[]; suggestionDecisions?: Decision[]; revision?: number; publishedAt?: string };
const seed = decodeSeed();
let graph: Graph | null = null;
const fromStored = (s: Stored): Graph => applySchema({ ...(seed as unknown as Graph), nodes: s.nodes, edges: s.edges, suggestionDecisions: s.suggestionDecisions ?? [], revision: s.revision ?? 0, publishedAt: s.publishedAt ?? null, entityTypes: [], edgeTypes: [] });

/** The published graph when an admin has saved one, otherwise the bundled dataset. */
async function load(force = false): Promise<Graph> {
  if (graph && !force) return graph;
  let stored: Stored | null = null;
  try { stored = (await api.get('/api/graph')).data.graph ?? null; } catch { stored = null; }
  graph = fromStored(stored ?? seed);
  return graph;
}
async function publish(next: Graph): Promise<HttpResult> {
  try {
    await api.post('/api/admin/publish', { token: token(), nodes: next.nodes, edges: next.edges, suggestionDecisions: next.suggestionDecisions ?? [] });
    graph = next;
    return ok({});
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status ?? 500;
    if (status === 401) setToken('');
    return fail(status, { error: status === 401 ? '需要管理員登入。' : '儲存失敗，請再試一次。', errors: [status === 401 ? '需要管理員登入。' : '儲存失敗，請再試一次。'] });
  }
}
async function isAdmin(): Promise<boolean> {
  if (!token()) return false;
  try { const r = await api.post('/api/admin/session', { token: token() }); if (!r.data.admin) setToken(''); return !!r.data.admin; }
  catch { return false; }
}

export async function http(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult> {
  const [route, queryString = ''] = path.split('?');
  const dryRun = queryString.includes('dryRun=1');
  try {
    if (route === '/api/graph') {
      const { nodes, edges, entityTypes, edgeTypes, ...meta } = await load(method === 'GET');
      return ok({ nodes, edges, entityTypes, edgeTypes, meta, aiConfigured: false });
    }
    if (route === '/api/query/registry') return ok(gqcRegistry());
    if (route === '/api/query') { const r = runGqc(await load(), body); return 'errors' in r ? fail(400, r) : ok(r); }
    if (route === '/api/quality') return ok(validateData(await load()));

    if (route === '/api/admin/me') {
      let configured = false;
      try { configured = !!(await api.get('/api/admin/status')).data.configured; } catch { configured = false; }
      return ok({ admin: await isAdmin(), configured, needsUsername: true });
    }
    if (route === '/api/admin/login') {
      try { const r = await api.post('/api/admin/login', body); setToken(r.data.token); return ok({ ok: true }); }
      catch (e) {
        const res = (e as { response?: { status?: number; data?: { error?: string } } }).response;
        return fail(res?.status ?? 500, { error: res?.data?.error ?? '登入失敗，請再試一次。' });
      }
    }
    if (route === '/api/admin/logout') { setToken(''); return ok({ ok: true }); }

    // ---- writes: admin only; validated by the write gate, then published
    if (route === '/api/write' || route === '/api/suggestions/decide' || route === '/api/ontology') {
      if (!(await isAdmin())) return fail(401, { error: '需要管理員登入。', errors: ['需要管理員登入。'] });
      const g = await load(true);
      if (route === '/api/ontology') {
        if ((body as { action?: string }).action !== 'reset') return fail(400, { errors: ['這個網站只支援還原成初始版本。'] });
        try { await api.post('/api/admin/reset', { token: token() }); } catch { return fail(500, { errors: ['還原失敗，請再試一次。'] }); }
        await load(true);
        return ok({});
      }
      if (route === '/api/write') {
        const w = applyWrites(g, (body as { ops: WriteOp[] }).ops, 'manual');
        if (!w.ok) return fail(422, w);
        if (!dryRun) { const p = await publish(w.graph); if (!p.ok) return p; }
        return ok({ ok: true, dryRun, created: w.created, updated: w.updated });
      }
      const { id, decision } = body as { id: string; decision: 'accept' | 'reject' };
      const s = computeSuggestions(g).find(x => x.id === id);
      if (!s) return fail(404, { error: '這個建議已經處理過，或已被紀錄涵蓋。' });
      const at = new Date().toISOString(), decisions = (g.suggestionDecisions as Decision[] | undefined) ?? [];
      if (decision === 'reject') { const p = await publish({ ...g, suggestionDecisions: [...decisions, { id: s.id, decision: 'rejected', at }] }); return p.ok ? ok({ ok: true }) : p; }
      const r = recordFor(g, s, at);
      if ('error' in r) return fail(422, { error: r.error });
      const w = applyWrites(g, r.ops, 'suggestion_accepted');
      if (!w.ok) return fail(422, { error: w.errors.join('；') });
      const p = await publish({ ...w.graph, suggestionDecisions: [...decisions, { id: s.id, decision: 'accepted', at, recordId: r.recordId }] });
      return p.ok ? ok({ ok: true, recordId: r.recordId }) : p;
    }
    return fail(404, { error: 'not found' });
  } catch {
    return fail(500, { error: '發生錯誤，請重新整理後再試。' });
  }
}
