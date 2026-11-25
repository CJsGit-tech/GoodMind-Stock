import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type AdminSession = { fingerprint: string; expiresAt: number; revoked: boolean };
export const SESSION_DURATION = 8 * 60 * 60 * 1000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (username: string, password: string) => digest(JSON.stringify([username, password]));
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));

export function credentialsMatch(username: unknown, password: unknown, expectedUsername: string, expectedPassword: string) {
  if (!expectedUsername || !expectedPassword || typeof username !== 'string' || typeof password !== 'string') return false;
  const userMatches = equal(username, expectedUsername);
  const passwordMatches = equal(password, expectedPassword);
  return userMatches && passwordMatches;
}
export function tokenKey(token: unknown): string | null {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
}
export function createSession(username: string, password: string, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    key: tokenKey(token)!,
    record: { fingerprint: fingerprint(username, password), expiresAt: now + SESSION_DURATION, revoked: false },
  };
}
export function sessionValid(session: AdminSession | null, username: string, password: string, now = Date.now()) {
  return !!session && !!username && !!password && !session.revoked && session.expiresAt > now
    && equal(session.fingerprint, fingerprint(username, password));
}
