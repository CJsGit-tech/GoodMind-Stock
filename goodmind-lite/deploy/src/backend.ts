import { router, json, error, db, secrets } from '@appdeploy/sdk';

// GoodMind backend. Stores the administrator-published graph and signs administrators in.
// Sign-in uses the MASTER_USERNAME / MASTER_PASSWORD app secrets; every change requires a signed admin token.
// No AI provider is called from this backend.

const TABLE = 'graph_v4';
const CHUNK_BYTES = 150_000;           // each stored item stays well under the 256 KiB limit
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

type Meta = { nodeChunks: number; edgeChunks: number; revision: number; publishedAt: string; suggestionDecisions: unknown[] };
type Chunk = { items: unknown[] };
type AuthState = { fails: number; lockedUntil: number };

const noStore = (r: ReturnType<typeof json>) => ({ ...r, headers: { ...r.headers, 'Cache-Control': 'no-store' } });
const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
async function hmac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, encoder.encode(text)));
}
/** Compares two strings without leaking where they differ. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function credentials(): Promise<{ username: string; password: string } | null> {
  try {
    const names = await secrets.listSecretNames();
    if (!names.includes('MASTER_USERNAME') || !names.includes('MASTER_PASSWORD')) return null;
    const [username, password] = await Promise.all([secrets.readSecret('MASTER_USERNAME'), secrets.readSecret('MASTER_PASSWORD')]);
    return username && password ? { username, password } : null;
  } catch {
    return null;
  }
}
async function signToken(password: string, expires: number): Promise<string> {
  return `${expires}.${await hmac(`goodmind-admin|${password}`, String(expires))}`;
}
async function validToken(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const expires = Number(token.split('.')[0]);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const creds = await credentials();
  if (!creds) return false;
  return same(token, await signToken(creds.password, expires));
}

function chunk(items: unknown[]): unknown[][] {
  const out: unknown[][] = [];
  let current: unknown[] = [];
  let size = 0;
  for (const item of items) {
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (current.length && size + bytes > CHUNK_BYTES) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}
async function readGraph() {
  const [meta] = await db.get<Meta>(TABLE, ['meta'], { consistent: true });
  if (!meta) return null;
  const ids = [
    ...Array.from({ length: meta.nodeChunks }, (_, i) => `n${i}`),
    ...Array.from({ length: meta.edgeChunks }, (_, i) => `e${i}`),
  ];
  const chunks = await db.get<Chunk>(TABLE, ids, { consistent: true });
  if (chunks.some(c => !c)) throw new Error('graph chunks missing');
  const nodes = chunks.slice(0, meta.nodeChunks).flatMap(c => c!.items);
  const edges = chunks.slice(meta.nodeChunks).flatMap(c => c!.items);
  return { nodes, edges, suggestionDecisions: meta.suggestionDecisions ?? [], revision: meta.revision, publishedAt: meta.publishedAt };
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true })],

  // Public: the published graph, or null when the bundled dataset is still in use.
  'GET /api/graph': [async () => {
    try {
      return noStore(json({ graph: await readGraph() }));
    } catch (e) {
      console.error('graph read failed', e instanceof Error ? e.message : e);
      return noStore(error('Unable to load graph. Please retry.', 503));
    }
  }],

  'GET /api/admin/status': [async () => noStore(json({ configured: !!(await credentials()) }))],

  'POST /api/admin/login': [async ({ body }) => {
    const creds = await credentials();
    if (!creds) return error('尚未設定管理員帳號密碼。', 503);
    const [state] = await db.get<AuthState>('admin_auth', ['state'], { consistent: true });
    if (state && state.lockedUntil > Date.now()) return error('嘗試次數過多，請稍後再試。', 429);
    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    const okUser = await same(typeof username === 'string' ? username : '', creds.username);
    const okPass = await same(typeof password === 'string' ? password : '', creds.password);
    if (!okUser || !okPass) {
      const fails = (state?.fails ?? 0) + 1;
      await db.tx.update('admin_auth', [{ id: 'state', record: { fails: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 } }]);
      return error('帳號或密碼不正確。', 401);
    }
    if (state?.fails) await db.tx.update('admin_auth', [{ id: 'state', record: { fails: 0, lockedUntil: 0 } }]);
    return noStore(json({ token: await signToken(creds.password, Date.now() + TOKEN_TTL_MS) }));
  }],

  'POST /api/admin/session': [async ({ body }) => noStore(json({ admin: await validToken((body as { token?: unknown } | null)?.token) }))],

  // Admin: replace the published graph (already validated by the write gate in the admin's browser).
  'POST /api/admin/publish': [async ({ body }) => {
    const input = (body ?? {}) as { token?: unknown; nodes?: unknown; edges?: unknown; suggestionDecisions?: unknown };
    if (!(await validToken(input.token))) return error('需要管理員登入。', 401);
    if (!Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length > 20000 || input.edges.length > 40000) return error('資料格式不正確。', 400);
    const wellFormed = input.nodes.every(n => n && typeof (n as { id?: unknown }).id === 'string' && typeof (n as { type?: unknown }).type === 'string')
      && input.edges.every(e => e && typeof (e as { from?: unknown }).from === 'string' && typeof (e as { to?: unknown }).to === 'string');
    if (!wellFormed) return error('資料格式不正確。', 400);
    const nodeChunks = chunk(input.nodes);
    const edgeChunks = chunk(input.edges);
    const [previous] = await db.get<Meta>(TABLE, ['meta'], { consistent: true });
    const meta: Meta = {
      nodeChunks: nodeChunks.length, edgeChunks: edgeChunks.length, revision: (previous?.revision ?? 0) + 1,
      publishedAt: new Date().toISOString(), suggestionDecisions: Array.isArray(input.suggestionDecisions) ? input.suggestionDecisions.slice(-2000) : [],
    };
    try {
      for (const [prefix, chunks] of [['n', nodeChunks], ['e', edgeChunks]] as const) {
        for (let i = 0; i < chunks.length; i++) {
          const [saved] = await db.tx.update(TABLE, [{ id: `${prefix}${i}`, record: { items: chunks[i] } }]);
          if (!saved) throw new Error(`chunk ${prefix}${i} not saved`);
        }
      }
      const [savedMeta] = await db.tx.update(TABLE, [{ id: 'meta', record: meta }]);   // written last: readers switch only when all chunks exist
      if (!savedMeta) throw new Error('meta not saved');
    } catch (e) {
      console.error('publish failed', e instanceof Error ? e.message : e);
      return error('儲存失敗，請再試一次。', 500);
    }
    return noStore(json({ ok: true, revision: meta.revision }));
  }],

  // Admin: drop the published graph and go back to the bundled dataset.
  'POST /api/admin/reset': [async ({ body }) => {
    if (!(await validToken((body as { token?: unknown } | null)?.token))) return error('需要管理員登入。', 401);
    await db.delete(TABLE, ['meta']);
    return noStore(json({ ok: true }));
  }],
});
