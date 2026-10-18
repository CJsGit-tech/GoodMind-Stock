export interface LoginAttempt {
  id: string;
  attemptedAt: number;
}

export interface AdminSessionRecord {
  tokenHash: string;
  expiresAt: number;
  revoked: boolean;
  createdAt: string;
}

export function isBlankSecret(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export async function secureEqual(
  left: string,
  right: string
): Promise<boolean> {
  const encode = (value: string) => new TextEncoder().encode(value);
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(left)),
    crypto.subtle.digest('SHA-256', encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function getRequestHeader(event: unknown, name: string): string {
  if (event === null || typeof event !== 'object' || Array.isArray(event))
    return '';
  const headers = (event as { headers?: unknown }).headers;
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers))
    return '';
  const matchingEntry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase()
  );
  return typeof matchingEntry?.[1] === 'string' ? matchingEntry[1] : '';
}

export function isSameOriginMutation(
  event: unknown,
  frontendOrigin: string
): boolean {
  const fetchSite = getRequestHeader(event, 'sec-fetch-site').toLowerCase();
  const source =
    getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer');
  if (!source) return fetchSite === 'same-origin';
  if (source === 'null') return false;

  try {
    const sourceUrl = new URL(source);
    return sourceUrl.origin.toLowerCase() === frontendOrigin.toLowerCase();
  } catch {
    return false;
  }
}

export function inspectAttemptTimes(
  attempts: LoginAttempt[],
  now: number,
  windowMs: number,
  failureLimit: number
): { retryAfterSeconds: number; recent: LoginAttempt[]; expiredIds: string[] } {
  const windowStart = now - windowMs;
  const expiredIds = attempts
    .filter(
      attempt =>
        !Number.isFinite(attempt.attemptedAt) ||
        attempt.attemptedAt < windowStart
    )
    .map(attempt => attempt.id);
  const recent = attempts
    .filter(
      attempt =>
        Number.isFinite(attempt.attemptedAt) &&
        attempt.attemptedAt >= windowStart
    )
    .sort((left, right) => left.attemptedAt - right.attemptedAt);

  if (recent.length >= failureLimit) {
    const retryAt = recent[recent.length - failureLimit].attemptedAt + windowMs;
    return {
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
      recent,
      expiredIds,
    };
  }
  if (recent.length >= 3) {
    const backoffMs = Math.min(2 ** (recent.length - 3) * 1000, 60_000);
    const retryAt = recent[recent.length - 1].attemptedAt + backoffMs;
    if (retryAt > now) {
      return {
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
        recent,
        expiredIds,
      };
    }
  }
  return { retryAfterSeconds: 0, recent, expiredIds };
}

export function parseSessionToken(
  token: string,
  maxLength = 512
): { id: string; secret: string } | null {
  if (!token || token.length > maxLength) return null;
  const separator = token.indexOf('.');
  if (separator < 1 || separator !== token.lastIndexOf('.')) return null;
  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id, secret };
}

export function isStaleSession(
  record: AdminSessionRecord,
  now: number,
  durationMs: number
): boolean {
  const createdAt = Date.parse(record.createdAt);
  return (
    record.revoked ||
    typeof record.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
    !Number.isFinite(createdAt) ||
    createdAt > now ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt > createdAt + durationMs ||
    record.expiresAt > now + durationMs ||
    record.expiresAt <= now
  );
}
