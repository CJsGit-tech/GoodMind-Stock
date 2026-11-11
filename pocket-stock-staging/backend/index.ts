// PocketStocksV2 backend routes. Three kinds of caller, each with its own guard:
//   readers  — public routes, served only from the published snapshot
//   agent    — a secret key in the x-agent-key header; can look up and upload drafts, never publish
//   owner    — a separate login (MASTER_USER / MASTER_PASSWORD secrets); reviews, approves, discards
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, error, json, router, secrets } from '@appdeploy/sdk';
import type { RouterContext } from '@appdeploy/sdk';
import { Refused, T, approve, bookPage, decide, discard, draftView, getDraft, library, listDrafts, localGraph, lookup, nodePage, publicGraph, searchEntries, snapshot, uploadDraft } from './store.ts';
import { seedIfEmpty } from './seed.ts';

const COOKIE = 'pocketstocks_owner';
const sha = (v: string) => createHash('sha256').update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
const header = (ctx: RouterContext, name: string): string => { const h = ctx.event?.headers || {}; return String(h[name] ?? h[name.toLowerCase()] ?? ''); };
const sessionToken = (ctx: RouterContext) => header(ctx, 'cookie').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
const tokenId = (token: string) => sha(token).toString('hex');

async function ownerSignedIn(ctx: RouterContext) {
  const token = sessionToken(ctx); if (!token) return false;
  const [s] = await db.get<{ expires: number }>(T.sessions, [tokenId(token)]);
  return !!s && s.expires > Date.now();
}
const requireOwner = async (ctx: RouterContext) => { if (!(await ownerSignedIn(ctx))) return error('Owner sign-in required.', 401); };
const requireAgent = async (ctx: RouterContext) => {
  const key = await secrets.readSecret('AGENT_KEY'), given = header(ctx, 'x-agent-key');
  if (!key || !given || !same(key, given)) return error('A valid agent key is required.', 401);
};
/** Turns a refusal into its response and hides everything else. */
const guard = (fn: (ctx: RouterContext) => Promise<unknown>) => async (ctx: RouterContext) => {
  try { await seedIfEmpty(); return json(await fn(ctx)); }
  catch (e) { if (e instanceof Refused) return json({ error: e.message, ...e.data }, e.status); console.error('Backend error:', e instanceof Error ? e.message : 'unknown'); return error('Something went wrong.', 500); }
};
const found = <V>(value: V | null, what: string): V => { if (!value) throw new Refused(404, `${what} not found.`); return value; };
const body = (ctx: RouterContext) => (ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, any>) : {});
const version = (ctx: RouterContext) => { const v = body(ctx).version; if (!Number.isInteger(v)) throw new Refused(400, 'version is required.'); return v as number; };

export const handler = router({
  // ----- readers -----
  'GET /api/graph': [guard(async () => publicGraph(await snapshot()))],
  'GET /api/library': [guard(async () => ({ books: library(await snapshot()) }))],
  'GET /api/books/:id': [guard(async ctx => found(await bookPage(await snapshot(), ctx.params.id), 'Book'))],
  'GET /api/nodes/:id': [guard(async ctx => found(nodePage(await snapshot(), ctx.params.id), 'Node'))],
  'GET /api/local/:id': [guard(async ctx => found(localGraph(await snapshot(), ctx.params.id, Math.min(3, Math.max(1, Number(ctx.query.depth) || 1))), 'Page'))],
  'GET /api/search': [guard(async () => { const s = await snapshot(); return { version: s.version, entries: searchEntries(s) }; })],

  // ----- agent: look up and upload only -----
  'POST /api/agent/lookup': [requireAgent, guard(async ctx => {
    const names = body(ctx).names; if (!Array.isArray(names) || names.length < 1 || names.length > 50) throw new Refused(400, 'names must list 1 to 50 names.');
    return { results: await Promise.all(names.map(n => lookup(String(n).slice(0, 80)))) };
  })],
  'POST /api/agent/drafts': [requireAgent, guard(ctx => uploadDraft(ctx.body))],

  // ----- owner -----
  'GET /api/owner/session': [guard(async ctx => ({ owner: await ownerSignedIn(ctx) }))],
  'POST /api/owner/login': [async ctx => {
    const user = await secrets.readSecret('MASTER_USER'), password = await secrets.readSecret('MASTER_PASSWORD'), b = body(ctx);
    if (!user || !password) return error('Owner sign-in is not configured.', 503);
    if (typeof b.user !== 'string' || typeof b.password !== 'string' || !same(user, b.user) || !same(password, b.password)) return error('That name or password is not right.', 401);
    const token = randomBytes(32).toString('base64url');
    await db.tx.add(T.sessions, [{ id: tokenId(token), expires: Date.now() + 8 * 3600_000 }]);
    return { ...json({ owner: true }), headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` } };
  }],
  'POST /api/owner/logout': [async ctx => {
    const token = sessionToken(ctx); if (token) await db.tx.delete(T.sessions, [tokenId(token)]);
    return { ...json({ owner: false }), headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` } };
  }],
  'GET /api/owner/drafts': [requireOwner, guard(() => listDrafts())],
  'GET /api/owner/drafts/:id': [requireOwner, guard(async ctx => draftView(await getDraft(ctx.params.id)))],
  'POST /api/owner/drafts/:id/decisions': [requireOwner, guard(async ctx => {
    const b = body(ctx); if (typeof b.detectionId !== 'string') throw new Refused(400, 'detectionId is required.');
    return draftView(await decide(ctx.params.id, version(ctx), b.detectionId, { decision: b.decision, rename: b.rename }));
  })],
  'POST /api/owner/drafts/:id/approve': [requireOwner, guard(ctx => approve(ctx.params.id, version(ctx), body(ctx).useExisting || {}))],
  'POST /api/owner/drafts/:id/discard': [requireOwner, guard(async ctx => draftView(await discard(ctx.params.id, version(ctx))))],
});
