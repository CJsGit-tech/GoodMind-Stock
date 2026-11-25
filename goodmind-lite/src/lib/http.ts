// The one place the app talks to its backend. Local development: the Express server in server/ (cookies).
// The AppDeploy build replaces this file with deploy/http.appdeploy.ts (same signature).
export type HttpResult = { ok: boolean; status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any

export async function http(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult> {
  try {
    const r = await fetch(path, method === 'GET' ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}
