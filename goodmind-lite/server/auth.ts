// Admin sign-in for the workspace. The password comes from ADMIN_PASSWORD (never from code); a successful
// sign-in sets an HttpOnly, SameSite=Strict session cookie. Sessions live in memory and expire after 8 hours.
// Every endpoint that changes data requires a session (requireAdmin).
import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

const COOKIE = 'gm_admin', TTL = 8 * 60 * 60 * 1000;
const sessions = new Map<string, number>();            // token → expiry
const failures = new Map<string, { n: number; until: number }>();
const password = () => process.env.ADMIN_PASSWORD?.trim() ?? '';
export const adminConfigured = () => password().length >= 8;

function tokenOf(req: Request): string | null {
  const m = /(?:^|;\s*)gm_admin=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}
export function isAdmin(req: Request): boolean {
  const t = tokenOf(req); if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req)) return void next();
  res.status(401).json({ ok: false, error: '需要管理員登入。', errors: ['需要管理員登入。'] });
}
const same = (a: string, b: string) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };
const cookie = (value: string, maxAge: number) => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

export function mountAuth(app: Express) {
  app.get('/api/admin/me', (req, res) => { res.json({ admin: isAdmin(req), configured: adminConfigured() }); });
  app.post('/api/admin/login', (req, res) => {
    if (!adminConfigured()) return void res.status(503).json({ ok: false, error: '尚未設定管理員密碼（ADMIN_PASSWORD）。' });
    const ip = req.ip ?? 'local', f = failures.get(ip);
    if (f && f.until > Date.now()) return void res.status(429).json({ ok: false, error: '嘗試次數過多，請稍後再試。' });
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!same(given, password())) {
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });      // 5 wrong tries → wait a minute
      return void res.status(401).json({ ok: false, error: '密碼不正確。' });
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + TTL);
    res.setHeader('Set-Cookie', cookie(token, TTL / 1000));
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => {
    const t = tokenOf(req); if (t) sessions.delete(t);
    res.setHeader('Set-Cookie', cookie('', 0));
    res.json({ ok: true });
  });
}
