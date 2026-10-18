import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createDatabase } from './database.ts';
export { isAppDatabaseError } from './database.ts';
export type { DbOperation } from './database.ts';

export interface AuthUser { userId: string; email?: string; name?: string; scope: string; picture?: string }
export interface RouterContext { body: unknown; query: Record<string, string>; params: Record<string, string>; event: any; user?: AuthUser }
export interface RouterResponse { statusCode: number; headers: Record<string, string>; body: string }
type Middleware = (ctx: RouterContext) => RouterResponse | void | Promise<RouterResponse | void>;
export type RouterRoutes = Record<string, Middleware[]>;
export const localOrigin = process.env.POCKETSTOCKS_LOCAL_ORIGIN!;
export const dataRoot = resolve(process.env.POCKETSTOCKS_DATA_DIR || '.local');
export const db = createDatabase(resolve(dataRoot, 'pocketstocks.sqlite'));
const signingKey = process.env.ADMIN_MASTER_SECRET!;
export const json = (value: unknown, statusCode = 200): RouterResponse => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(value) });
export const error = (message: string, statusCode = 500) => json({ error: message }, statusCode);

export function router(routes: Record<string, Middleware[]>) {
  return async (event: any): Promise<RouterResponse> => {
    const url = new URL(event.rawPath + (event.rawQueryString ? '?' + event.rawQueryString : ''), localOrigin);
    for (const [pattern, chain] of Object.entries(routes)) {
      const [method, route] = pattern.split(' ');
      if (method !== event.requestContext.http.method) continue;
      const parts = route.split('/'), actual = url.pathname.split('/');
      if (parts.length !== actual.length || parts.some((part, i) => !part.startsWith(':') && part !== actual[i])) continue;
      const params = Object.fromEntries(parts.flatMap((part, i) => part.startsWith(':') ? [[part.slice(1), decodeURIComponent(actual[i])]] : []));
      let body: unknown = undefined;
      if (event.body) { try { body = JSON.parse(event.body); } catch { return error('Invalid JSON body.', 400); } }
      const ctx: RouterContext = { body, params, query: Object.fromEntries(url.searchParams), event };
      for (const handler of chain) { const response = await handler(ctx); if (response) return response; }
      return error('Empty route response.', 500);
    }
    return error('Route not found.', 404);
  };
}
const readerCookie = 'pocketstocks_local_reader';
const digest = (value: string) => createHmac('sha256', signingKey).update(value).digest('hex');
export const auth = {
  async getUser(event: { headers?: Record<string, string | undefined> }): Promise<AuthUser | null> {
    const token = event.headers?.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(readerCookie + '='))?.slice(readerCookie.length + 1);
    if (!token) return null;
    const [session] = await db.get<{ user: AuthUser; expires: number }>('local_reader_sessions', [digest(token)]);
    return session && session.expires > Date.now() ? session.user : null;
  },
};
export const requireAuth = (): Middleware => async ctx => {
  const user = await auth.getUser(ctx.event);
  if (!user) return error('Authentication required.', 401);
  ctx.user = user;
};
export async function localReaderSession(event: any, method: string, body: any) {
  if (method === 'GET') return json({ user: await auth.getUser(event) });
  const response = json({ user: null });
  if (method === 'DELETE') {
    const token = event.headers.cookie?.split(';').map((item: string) => item.trim()).find((item: string) => item.startsWith(readerCookie + '='))?.slice(readerCookie.length + 1);
    if (token) await db.delete('local_reader_sessions', [digest(token)]);
    response.headers['Set-Cookie'] = `${readerCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
    return response;
  }
  if (method !== 'POST') return error('Method not allowed.', 405);
  const userId = body?.reader === 'b' ? 'local-reader-b' : 'local-reader-a';
  const user: AuthUser = { userId, name: userId === 'local-reader-a' ? '本機測試讀者 A' : '本機測試讀者 B', email: userId + '@example.invalid', scope: 'openid email profile offline_access' };
  const token = randomBytes(32).toString('base64url');
  await db.tx.add('local_reader_sessions', [{ id: digest(token), user, expires: Date.now() + 86400000 }]);
  return { ...json({ user }), headers: { ...response.headers, 'Set-Cookie': `${readerCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` } };
}
export const secrets = {
  async listSecretNames() { return process.env.ADMIN_MASTER_SECRET ? ['ADMIN_MASTER_SECRET'] : []; },
  async readSecret(name: string) { return name === 'ADMIN_MASTER_SECRET' ? process.env.ADMIN_MASTER_SECRET : undefined; },
};
function objectFile(path: string) {
  const root = resolve(dataRoot, 'storage');
  const filename = resolve(root, path);
  const rel = relative(root, filename);
  if (!rel || path.includes('\\') || path.includes('\0') || rel.startsWith('..') || isAbsolute(rel)) throw Error('Invalid storage path.');
  return filename;
}
const signature = (path: string, expires: string) => digest(JSON.stringify([path, expires]));
export function readSignedAsset(url: URL) {
  const path = url.searchParams.get('path') || '';
  const expires = url.searchParams.get('expires') || '';
  const sig = url.searchParams.get('signature') || '';
  const expected = signature(path, expires);
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now() || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const file = objectFile(path);
  if (!existsSync(file)) return null;
  return { bytes: readFileSync(file), contentType: readFileSync(file + '.meta', 'utf8') };
}
export const storage = {
  async write(items: { path: string; content: string; contentType: string }[]) {
    return items.map(item => {
      const file = objectFile(item.path);
      mkdirSync(dirname(file), { recursive: true });
      // AppDeploy stores textual MIME types as UTF-8; binary uploads are base64.
      const text = /^(text\/|application\/(json|xml))/.test(item.contentType) || item.contentType === 'image/svg+xml';
      writeFileSync(file, text ? item.content : Buffer.from(item.content, 'base64'));
      writeFileSync(file + '.meta', item.contentType);
      return true;
    });
  },
  async read(paths: string[]) { return paths.map(path => { const file = objectFile(path); return { path, content: existsSync(file) ? readFileSync(file, 'utf8') : null }; }); },
  async url(paths: string[]) {
    return paths.map(path => {
      objectFile(path);
      const expires = String(Date.now() + 15 * 60 * 1000);
      const query = new URLSearchParams({ path, expires, signature: signature(path, expires) });
      return { path, url: `${localOrigin}/__local/storage?${query}` };
    });
  },
  async delete(paths: string[]) { return paths.map(path => { const file = objectFile(path); for (const name of [file, file + '.meta']) if (existsSync(name)) unlinkSync(name); return true; }); },
};
