export interface AuthUser { userId: string; name?: string; email?: string; picture?: string; scope: string }
const hintKey = 'pocketstocks-local-reader-hint';
async function request(method: string, path: string, data?: unknown) {
  if (!path.startsWith('/api/') && !path.startsWith('/__local/')) throw Error('Local staging only accepts local API paths.');
  const response = await fetch(path, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined || method === 'GET' ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || 'Request failed.'), { response: { status: response.status, data: value }, status: response.status });
  return { data: value };
}
export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, data?: unknown) => request('POST', path, data),
  put: (path: string, data?: unknown) => request('PUT', path, data),
  delete: (path: string, data?: unknown) => request('DELETE', path, data),
};
export const auth = {
  isSignedIn: () => localStorage.getItem(hintKey) === 'yes',
  async getUser(): Promise<AuthUser | null> {
    const { data } = await request('GET', '/__local/session');
    if (data.user) localStorage.setItem(hintKey, 'yes'); else localStorage.removeItem(hintKey);
    return data.user;
  },
  async signIn(options?: { scope?: string; reader?: 'a' | 'b' }) {
    const { data } = await request('POST', '/__local/session', { reader: options?.reader || 'a' });
    localStorage.setItem(hintKey, 'yes');
    return { user: data.user as AuthUser, accessToken: '', expiresIn: 86400 };
  },
  async signOut() { await request('DELETE', '/__local/session'); localStorage.removeItem(hintKey); },
};
