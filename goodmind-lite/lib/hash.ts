// Small deterministic helpers that work the same in Node and in the browser (no node:crypto, no Buffer),
// so the query engine and the write gate can run on either side.

/** 53-bit string hash (cyrb53) as 14 hex characters. Stable across runs and platforms; not cryptographic. */
export function hashHex(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0').slice(2) + (h1 >>> 0).toString(16).padStart(8, '0');
}
/** Short random id for new nodes that have no English name to build an id from. */
export function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return (c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '').slice(0, 8);
}
/** JSON ⇄ URL-safe base64 (ASCII content only), used for paging cursors. */
export const encodeToken = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeToken = (s: string): unknown => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
