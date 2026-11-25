// Local replacement for backend/index.ts (AppDeploy router) — same routes and payloads.
// SIMULATED: admin credentials come from env placeholders; OpenAI-backed features are
// replaced by deterministic local heuristics (no API key, no network).
import seed from '../shared/seed.json';
import { validateGraph } from '../shared/model';
import type { Graph } from '../shared/model';
import { credentialsMatch, createSession, sessionValid, tokenKey, digest } from './adminAuth';
import type { AdminSession } from './adminAuth';
import { localDb } from './localStore';
import { catalog, createGraphQueries } from './playgroundTools';
import { z } from 'zod';

export type ApiResult = { status: number; body: unknown };
const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
const err = (message: string, status: number): ApiResult => ({ status, body: { error: message } });
const defaultGraph = seed as unknown as Graph;
const OWNER = 'master-administrator';
const KEY = digest(OWNER);
const PUBLIC = 'published';
// Placeholder login (override via .env.local)
const USER = () => process.env.MASTER_USERNAME || 'admin';
const PASS = () => process.env.MASTER_PASSWORD || 'goodmind-local';

function auth(body: any): boolean {
  const key = tokenKey(body?.sessionToken);
  if (!key) return false;
  return sessionValid(localDb.get<AdminSession>('admin_sessions', key), USER(), PASS());
}
const attempts = new Map<string, { n: number; t: number }>();

export async function dispatch(method: string, route: string, body: any): Promise<ApiResult> {
  const r = `${method} ${route}`;
  switch (r) {
    case 'GET /api/_healthcheck': return ok({ ok: true });
    case 'GET /api/graph': {
      const p = localDb.get<any>('public_graphs', PUBLIC);
      return ok({ graph: p?.graph ?? defaultGraph, version: p?.draftVersion ?? 0, private: false, published: !!p });
    }
    case 'PUT /api/graph': return err('Administrator sign-in required.', 401);
    case 'POST /api/admin/login': {
      const a = attempts.get('local') ?? { n: 0, t: Date.now() };
      if (Date.now() - a.t > 15 * 60_000) { a.n = 0; a.t = Date.now(); }
      if (a.n >= 20) return err('Too many attempts. Please try again later.', 429);
      attempts.set('local', { n: a.n + 1, t: a.t });
      if (!credentialsMatch(body?.username, body?.password, USER(), PASS())) return err('Incorrect username or password.', 401);
      const s = createSession(USER(), PASS());
      localDb.set('admin_sessions', s.key, s.record);
      return ok({ sessionToken: s.token, expiresAt: s.record.expiresAt });
    }
  }
  if (r === 'POST /api/question/parse') return questionParse(body);
  if (!r.includes('/api/admin/')) return err('Not found', 404);
  if (!auth(body)) return err('Administrator sign-in required.', 401);
  switch (r) {
    case 'POST /api/admin/logout':
      localDb.patch('admin_sessions', tokenKey(body.sessionToken)!, { revoked: true });
      return ok({ ok: true });
    case 'POST /api/admin/graph': {
      const saved = localDb.get<any>('admin_graphs', KEY);
      const pub = localDb.get<any>('public_graphs', PUBLIC);
      return ok({ graph: saved?.graph ?? defaultGraph, version: saved?.version ?? 0, publishedVersion: pub?.draftVersion ?? 0, private: true });
    }
    case 'PUT /api/admin/graph': {
      const v = body?.version;
      if (!Number.isInteger(v) || v < 0 || typeof body?.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId))
        return err('Invalid save request.', 400);
      const errors = validateGraph(body.graph);
      if (errors.length) return err(errors.join('\n'), 400);
      if (Buffer.byteLength(JSON.stringify(body.graph), 'utf8') > 220000) return err('Graph exceeds 220 KB workspace limit. Export and reduce its size.', 413);
      const cur = localDb.get<any>('admin_graphs', KEY);
      if ((cur?.version ?? 0) !== v) return err('Workspace changed elsewhere. Reload before saving; your draft is retained.', 409);
      localDb.set('admin_graphs', KEY, { owner: OWNER, graph: body.graph, version: v + 1, publishedVersion: cur?.publishedVersion });
      return ok({ graph: body.graph, version: v + 1, private: true });
    }
    case 'POST /api/admin/publish': {
      const draft = localDb.get<any>('admin_graphs', KEY);
      if (!Number.isInteger(body?.version) || body.version < 1 || typeof body?.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId))
        return err('Save your draft before publishing.', 400);
      if (!draft || draft.version !== body.version) return err('Draft changed. Reload and review it before publishing.', 409);
      if (validateGraph(draft.graph).length) return err('Review the draft before publishing.', 400);
      const cur = localDb.get<any>('public_graphs', PUBLIC);
      const publishedAt = new Date().toISOString();
      localDb.set('public_graphs', PUBLIC, { owner: OWNER, graph: draft.graph, draftVersion: draft.version, revision: (cur?.revision ?? 0) + 1, publishedAt });
      return ok({ publishedVersion: draft.version, publishedAt });
    }
    case 'POST /api/admin/playground/catalog':
      return ok({ tools: catalog, models: ['gpt-6-luna'], configured: true, simulated: true });
    case 'POST /api/admin/playground/run': return playgroundRun(body);
  }
  return err('Not found', 404);
}

// ---- Simulated question parser (replaces OpenAI Agents call) -------------------
const norm = (s: string) => s.normalize('NFKC').toLowerCase();
function questionParse(body: any): ApiResult {
  const parsedIn = z.object({ question: z.string().trim().min(1).max(240), locale: z.enum(['zh-TW', 'en']) }).strict().safeParse(body);
  if (!parsedIn.success) return { status: 400, body: { error: 'Invalid question.', errorCode: 'INVALID_INPUT' } };
  const q = parsedIn.data.question, nq = norm(q);
  if (/\b(?:19|20)\d{2}\b|今天|昨天|最近|最新|去年|今年|潛在|可能|planned|potential|prospective|recent/i.test(q)) return ok({ parsed: null, parser: 'local-simulated' });
  const intent = /競爭|competitor|compet/i.test(q) ? 'competition' : /供應商|上游|supplier|upstream/i.test(q) ? 'supply' : /客戶|下游|customer|downstream/i.test(q) ? 'customers' : /合作|collaborat|partner|cooperat/i.test(q) ? 'cooperation' : null;
  const names = defaultGraph.nodes.filter(n => n.type === 'Company' || n.type === 'Product').flatMap(n => [String(n.name), ...(n.ticker ? [String(n.ticker)] : [])]);
  const hits = names.filter(n => nq.includes(norm(n)) || norm(n).split(/\s+/).some(w => w.length > 3 && nq.includes(w)));
  if (!intent || !hits.length) return ok({ parsed: null, parser: 'local-simulated' });
  return ok({ parsed: { entity: hits[0], intent, ...(intent === 'supply' ? { direction: 'upstream' } : intent === 'customers' ? { direction: 'downstream' } : {}), proof: 'all', verifiedDelivery: false, askedEndCustomer: false }, parser: 'local-simulated' });
}

// ---- Simulated playground (replaces OpenAI agent; still uses the real graph tools) ----
const runSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/), source: z.enum(['published', 'draft']), locale: z.enum(['zh-TW', 'en']),
  model: z.enum(['gpt-6-luna']), temperature: z.number().min(0).max(1), maxOutputTokens: z.number().int().min(256).max(1600),
  instructions: z.string().max(2000), prompt: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) }).strict()).max(8),
}).strict();
function playgroundRun(body: any): ApiResult {
  const { sessionToken: _t, ...req } = body ?? {};
  const p = runSchema.safeParse(req);
  if (!p.success) return { status: 400, body: { error: 'The AI request could not be completed.', errorCode: 'INVALID_INPUT' } };
  const input = p.data, started = Date.now();
  let graph = defaultGraph, sourceLabel: 'draft' | 'published' | 'sample' = 'sample', graphVersion = 0;
  if (input.source === 'draft') { const d = localDb.get<any>('admin_graphs', KEY); if (d) { graph = d.graph; graphVersion = d.version; sourceLabel = 'draft'; } }
  else { const d = localDb.get<any>('public_graphs', PUBLIC); if (d) { graph = d.graph; graphVersion = d.draftVersion; sourceLabel = 'published'; } }
  const tools = createGraphQueries(graph, input.locale);
  const by = (n: string) => tools.find(t => t.name === n)!;
  const traces: { name: string; label: string; summary: string; count: number }[] = [];
  const run = (n: string, a: unknown) => { const t = by(n), r = t.execute(a); traces.push({ name: n, label: (t.label as any)[input.locale], summary: r.summary, count: r.count }); return r.data as any; };
  const sum = run('graph_summary', {});
  const words = input.prompt.split(/[\s,，。?？]+/).filter(w => w.length > 1);
  let found: any[] = [];
  for (const w of words) { const r = run('search_entities', { query: w, type: null, limit: 5 }); if (r.entities.length) { found = r.entities; break; } }
  const zh = input.locale === 'zh-TW';
  const lines: string[] = [zh ? `【本機模擬回答】此圖譜共有 ${sum.entities} 個實體、${sum.relations} 條關係（含 ${sum.derivedRelations} 條推論）。` : `[Local simulated answer] The graph holds ${sum.entities} entities and ${sum.relations} relations (${sum.derivedRelations} derived).`];
  if (found[0]) {
    const rel = run('get_relations', { entityId: found[0].id, predicate: null, direction: 'both', limit: 8 });
    lines.push(zh ? `與「${found[0].name}」相關的關係：` : `Relations of "${found[0].name}":`);
    for (const e of rel.relations) lines.push(`- ${e.from.name} —${e.relation}→ ${e.to.name} (${e.verification})`);
  } else lines.push(zh ? '找不到與問題相符的實體。' : 'No entity matched your question.');
  lines.push(zh ? '註：證據未必經重新查證；缺乏資料不代表不存在。' : 'Note: evidence may not be reverified; absence of data is not proof of absence.');
  return ok({ answer: lines.join('\n'), toolCalls: traces, model: input.model, usage: { inputTokens: 0, outputTokens: 0 }, durationMs: Date.now() - started, sourceLabel, graphVersion });
}
