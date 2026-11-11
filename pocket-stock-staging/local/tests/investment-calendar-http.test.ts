import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

test('local calendar HTTP permissions, consent, atomic import, replay, conflict and restart', { timeout: 60000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://localhost:${port}`, dir = mkdtempSync(join(tmpdir(), 'pocketstocks-calendar-test-'));
  const secret = randomBytes(32).toString('base64url');
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, PORT: String(port), POCKETSTOCKS_DATA_DIR: dir, POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret }, stdio: ['ignore', 'ignore', 'ignore'] });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/_healthcheck')).ok) return; } catch {} await delay(100); }
    throw Error('Test runtime did not start.');
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; } }
  async function call(path: string, method = 'GET', body?: unknown, cookie?: string, requestOrigin = origin) {
    const response = await fetch(origin + path, { method, headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, response, data: await response.json() };
  }
  const rawSource = readFileSync(new URL('../../samples/investment-calendar.json', import.meta.url), 'utf8');
  const payload = { rawSource, baseRevision: 0, requestId: 'calendar-http-import-0001', usageConfirmed: true };
  try {
    await start();
    assert.equal((await call('/api/calendar/events')).data.events.length, 0);
    assert.equal((await call('/api/admin/calendar/import', 'POST', payload)).status, 401);
    const reader = await call('/__local/session', 'POST', { reader: 'a' });
    assert.equal((await call('/api/admin/calendar/import', 'POST', payload, reader.response.headers.get('set-cookie')!.split(';')[0])).status, 401);
    const login = await call('/api/admin/session', 'POST', { secret });
    const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await call('/api/admin/calendar/import', 'POST', payload, cookie, 'https://untrusted.invalid')).status, 403);
    assert.equal((await call('/api/admin/calendar/import', 'POST', { ...payload, usageConfirmed: false }, cookie)).status, 400);
    const result = await call('/api/admin/calendar/import', 'POST', payload, cookie);
    assert.equal(result.status, 200); assert.equal(result.data.added, 9); assert.equal(result.data.revision, 1);
    const replay = await call('/api/admin/calendar/import', 'POST', payload, cookie); assert.equal(replay.data.replayed, true);
    assert.equal((await call('/api/admin/calendar/import', 'POST', { ...payload, requestId: 'calendar-http-conflict-0002' }, cookie)).status, 409);
    const invalid = await call('/api/admin/calendar/import', 'POST', { ...payload, rawSource: '{', baseRevision: 1, requestId: 'calendar-http-invalid-0003' }, cookie); assert.equal(invalid.status, 400);
    const same = await call('/api/admin/calendar/import', 'POST', { ...payload, baseRevision: 1, requestId: 'calendar-http-unchanged-0004' }, cookie); assert.equal(same.data.unchanged, 9); assert.equal(same.data.revision, 1);
    const before = (await call('/api/calendar/events')).data;
    assert.equal(before.events.length, 9); assert.equal(before.revision, 1);
    assert.ok(!JSON.stringify(before).includes('sessionToken')); assert.ok(!JSON.stringify(before).includes(secret));
    await stop(); await start();
    assert.deepEqual((await call('/api/calendar/events')).data, before);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
