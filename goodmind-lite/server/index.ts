// Local API server (Express). Vite proxies /api here in dev; in production it also serves dist/.
import express from 'express';
import path from 'node:path';
import { z } from 'zod';
import { readDb, writeDb } from '../lib/db';
import { computeSuggestions, recordFor } from '../lib/suggest';
import type { Decision } from '../lib/suggest';
import { chat, hasKey } from '../lib/agent';
import { applyOntology, ontologyAction } from './ontology';
import { validateData } from '../lib/validate';
import { applyWrites, resolve } from '../lib/write';
import type { WriteOp } from '../lib/write';
import { WORKSPACE_WRITES } from './features';
import { isAdmin, mountAuth, requireAdmin } from './auth';
import { gqcRegistry, runGqc } from '../lib/gqc';

const app = express();
app.use(express.json({ limit: '1mb' }));

mountAuth(app);

app.get('/api/graph', (_req, res) => {
  const { nodes, edges, entityTypes, edgeTypes, ...meta } = readDb();
  res.json({ nodes, edges, entityTypes, edgeTypes, meta, aiConfigured: hasKey() });
});

const chatBody = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(16).default([]),
});
app.post('/api/chat', async (req, res) => {
  const p = chatBody.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'Invalid question.' });
  try { res.json(await chat(readDb(), p.data.question, p.data.history)); }
  catch (e) {
    console.error('chat failed:', e instanceof Error ? e.message : e);
    res.status(502).json({ error: 'The AI request failed. Check OPENAI_API_KEY / OPENAI_MODEL, or clear the key to use simulated mode.' });
  }
});

// Streaming variant: each retrieval step is pushed as it happens (server-sent events), then the final answer.
app.post('/api/chat/stream', async (req, res) => {
  const p = chatBody.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'Invalid question.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try { send('done', await chat(readDb(), p.data.question, p.data.history, { onStep: s => send('step', s) })); }
  catch (e) {
    console.error('chat failed:', e instanceof Error ? e.message : e);
    send('error', { error: 'The AI request failed. Check OPENAI_API_KEY / OPENAI_MODEL, or clear the key to use simulated mode.' });
  }
  res.end();
});

// Data quality against the ontology's declared properties and rules.
app.get('/api/quality', (_req, res) => { res.json(validateData(readDb())); });

// Suggested links (ontology v2 rules S-*): computed, never stored until a curator accepts one.
app.get('/api/suggestions', (_req, res) => { res.json(computeSuggestions(readDb())); });
const decideBody = z.object({ id: z.string().min(1).max(300), decision: z.enum(['accept', 'reject']) });
app.post('/api/suggestions/decide', requireAdmin, (req, res) => {
  const p = decideBody.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'Invalid request.' });
  const g = readDb(), s = computeSuggestions(g).find(x => x.id === p.data.id);
  if (!s) return void res.status(404).json({ error: 'That suggestion no longer applies (already decided or covered by a record).' });
  const at = new Date().toISOString(), decisions = (g.suggestionDecisions as Decision[] | undefined) ?? [];
  if (p.data.decision === 'reject') { g.suggestionDecisions = [...decisions, { id: s.id, decision: 'rejected', at }]; writeDb(g); return void res.json({ ok: true }); }
  const r = recordFor(g, s, at);
  if ('error' in r) return void res.status(422).json({ error: r.error });
  const w = applyWrites(g, r.ops, 'suggestion_accepted');              // same write gate as every other write
  if (!w.ok) return void res.status(422).json({ error: w.errors.join('；') });
  writeDb({ ...w.graph, suggestionDecisions: [...decisions, { id: s.id, decision: 'accepted', at, recordId: r.recordId }] });
  res.json({ ok: true, recordId: r.recordId });
});

// GQC: one deterministic query contract for the filter UI, the API and the chat agent (lib/gqc.ts).
app.get('/api/query/registry', (_req, res) => { res.json(gqcRegistry()); });
app.post('/api/query', (req, res) => {
  const r = runGqc(readDb(), req.body);
  if ('errors' in r) return void res.status(400).json(r);
  res.json(r);
});

// V4 identity resolution: Chinese / English name, alias, ticker or old id → canonical node ids.
app.get('/api/resolve', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200), type = req.query.type ? String(req.query.type) : undefined;
  if (!q) return void res.status(400).json({ error: 'q is required' });
  res.json({ query: q, matches: resolve(readDb(), q, type).map(n => ({ id: n.id, type: n.type, name: n.name, name_en: n.attributes.name_en ?? null })) });
});

// The single write entry: a batch of createNode / createEdge / updateNode operations, validated against
// the registry and applied all-or-nothing. ?dryRun=1 validates without saving.
const attrs = z.record(z.string(), z.unknown()).optional();
const writeOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('createNode'), node: z.object({ id: z.string().max(200).optional(), type: z.string().max(60), name: z.string().max(300), attributes: attrs }) }),
  z.object({ op: z.literal('createEdge'), edge: z.object({ predicate: z.string().max(60), from: z.string().max(200), to: z.string().max(200), attributes: attrs }) }),
  z.object({ op: z.literal('updateNode'), id: z.string().max(200), name: z.string().max(300).optional(), attributes: attrs }),
]);
app.post('/api/write', (req, res) => {
  const p = z.object({ ops: z.array(writeOp).min(1).max(200), source: z.string().max(60).optional() }).safeParse(req.body);
  if (!p.success) return void res.status(400).json({ ok: false, errors: ['請求格式不正確。'] });
  const dry = req.query.dryRun === '1';
  if (!dry && !WORKSPACE_WRITES) return void res.status(403).json({ ok: false, errors: ['這個環境是唯讀的。'] });
  if (!isAdmin(req)) return void res.status(401).json({ ok: false, errors: ['需要管理員登入。'] });
  const r = applyWrites(readDb(), p.data.ops as WriteOp[], p.data.source ?? 'manual');
  if (!r.ok) return void res.status(422).json(r);
  if (!dry) writeDb(r.graph);
  res.json({ ok: true, dryRun: dry, created: r.created, updated: r.updated });
});

app.post('/api/ontology', requireAdmin, (req, res) => {
  const p = ontologyAction.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ errors: ['Invalid request.'] });
  const r = applyOntology(p.data);
  res.status(r.status).json(r.body);
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev the web server (Vite) owns PORT/3100 and proxies /api to API_PORT (3101).
const port = Number(process.env.NODE_ENV === 'production' ? process.env.PORT || 3100 : process.env.API_PORT || 3101);
app.listen(port, () => console.log(`GoodMind API on http://localhost:${port} · AI ${hasKey() ? 'OpenAI Agents' : 'SIMULATED'}`));
