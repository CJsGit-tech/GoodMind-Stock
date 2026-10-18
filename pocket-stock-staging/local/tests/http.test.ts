import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('isolated HTTP runtime: books/assets, auth boundaries, author upload and restart persistence', { timeout: 60000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://localhost:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'pocketstocks-http-'));
  const secret = randomBytes(32).toString('base64url');
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, PORT: String(port), POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret, POCKETSTOCKS_DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stderr!.on('data', chunk => { diagnostics += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error('Local server exited: ' + diagnostics);
      try { if ((await fetch(origin + '/api/_healthcheck')).ok) return; } catch { /* wait for port */ }
      await delay(100);
    }
    throw Error('Local server did not become ready.');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
  async function call(path: string, method = 'GET', body?: unknown, cookie?: string) {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    return { response, value };
  }
  const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  try {
    await start();
    const catalog = await call('/api/articles'); assert.equal(catalog.value.articles.length, 3);
    const book = catalog.value.articles[0];
    const cover = await fetch(book.coverUrl); assert.equal(cover.status, 200); assert.match(await cover.text(), /<svg/);
    const altered = new URL(book.coverUrl); altered.searchParams.set('signature', '0'.repeat(64));
    assert.equal((await fetch(altered)).status, 404);
    assert.equal((await fetch(origin + '/.env')).status, 403);
    assert.equal((await fetch(origin + '/.local/pocketstocks.sqlite')).status, 403);
    assert.equal((await fetch(origin + '/__local/session', { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await call('/api/reader/me')).response.status, 401);
    const a = await call('/__local/session', 'POST', { reader: 'a' }); const aCookie = cookie(a.response);
    assert.equal((await call('/api/reader/me', 'GET', undefined, aCookie)).response.status, 200);
    assert.equal((await call('/api/reader/favorites/' + book.id, 'PUT', {}, aCookie)).response.status, 200);
    const aFavorites = await call('/api/reader/favorites', 'GET', undefined, aCookie);
    assert.match(JSON.stringify(aFavorites.value), new RegExp(book.id));
    const b = await call('/__local/session', 'POST', { reader: 'b' }); const bCookie = cookie(b.response);
    const bFavorites = await call('/api/reader/favorites', 'GET', undefined, bCookie);
    assert.doesNotMatch(JSON.stringify(bFavorites.value), new RegExp(book.id));
    assert.equal((await call('/api/admin/session', 'POST', { secret: 'invalid-secret' })).response.status, 401);
    const admin = await call('/api/admin/session', 'POST', { secret }); assert.equal(admin.response.status, 200);
    const adminCookie = cookie(admin.response);
    const draft = await call('/api/admin/articles', 'POST', { title: 'PS-301 disposable local test', summary: 'Isolated temporary runtime test', sector: '本機測試', tags: ['QA'], publicationDate: '2026-10-15', pages: [] }, adminCookie);
    assert.equal(draft.response.status, 201);
    const id = draft.value.article.id;
    const content = readFileSync(new URL('../../src/assets/library-hero-v6.jpg', import.meta.url)).toString('base64');
    const upload = await call(`/api/admin/articles/${id}/pages`, 'POST', { title: 'Local uploaded JPG', altText: 'Disposable local test image', contentType: 'image/jpeg', content }, adminCookie);
    assert.equal(upload.response.status, 201);
    const imageUrl = upload.value.page.imageUrl;
    assert.equal((await fetch(imageUrl)).headers.get('content-type'), 'image/jpeg');
    assert.equal((await call('/api/articles/' + id)).response.status, 404);
    await stop(); await start();
    assert.equal((await call('/api/articles')).value.articles.length, 3);
    const detail = await call(`/api/admin/articles/${id}/detail`, 'POST', {}, adminCookie);
    assert.equal(detail.response.status, 200); assert.equal(detail.value.article.pages.length, 1);
    assert.equal((await fetch(imageUrl)).status, 200);
    assert.match(JSON.stringify((await call('/api/reader/favorites', 'GET', undefined, aCookie)).value), new RegExp(book.id));
    await call('/__local/session', 'DELETE', undefined, aCookie);
    assert.equal((await call('/api/reader/me', 'GET', undefined, aCookie)).response.status, 401);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
