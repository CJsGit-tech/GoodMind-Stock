import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { CalendarSyncClient, runCalendarSync } from '../calendar-sync.ts';

test('local companion enforces cadence, quarantine, receipt recovery, conflict and tamper protection', { timeout: 60000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://localhost:${port}`, directory = mkdtempSync(join(tmpdir(), 'calendar-sync-test-'));
  const secret = randomBytes(32).toString('base64url'), now = new Date('2026-10-25T02:00:00Z');
  const child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, PORT: String(port), POCKETSTOCKS_DATA_DIR: join(directory, 'data'), POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret }, stdio: ['ignore', 'ignore', 'ignore'] });
  const client = new CalendarSyncClient(origin);
  const options = { directory: join(directory, 'sync'), client, secret, now };
  const input = { schemaVersion: 1, sources: [{ id: 'bea', name: 'BEA', url: 'https://www.bea.gov/news/schedule/full', checkedAt: now.toISOString(), usageBasis: 'Official public-domain date facts.', usageUrl: 'https://www.bea.gov/help/faq/147' }], observations: [{ kind: 'bea.pio', period: '2026-10', sourceId: 'bea', sourceDate: '2026-11-25', startsAt: '2026-11-25T13:30:00Z', precision: 'exact', confirmation: 'confirmed', status: 'scheduled', evidence: 'November 25 8:30 AM Personal Income and Outlays, October 2026' }] };
  const inputPath = join(directory, 'research.json');
  const saveInput = () => writeFileSync(inputPath, JSON.stringify(input));
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/_healthcheck')).ok) break; } catch {} await delay(100); }
    await runCalendarSync(['begin'], options);
    await assert.rejects(runCalendarSync(['begin'], options), /24/);
    saveInput(); const prepared = await runCalendarSync(['prepare', inputPath], options);
    assert.equal(prepared.added, 1);
    let loseResponse = true;
    const recovering = new CalendarSyncClient(origin, async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith('/api/admin/calendar/import') && loseResponse) { loseResponse = false; throw Error('Injected lost response after commit.'); }
      return response;
    });
    await assert.rejects(runCalendarSync(['apply'], { ...options, client: recovering }), /lost response/);
    const envelope = JSON.parse(readFileSync(join(options.directory, 'prepared.json'), 'utf8'));
    assert.equal(envelope.attempted, true);
    assert.ok(!JSON.stringify(envelope).includes(secret));
    await assert.rejects(runCalendarSync(['prepare', inputPath], options), /尚未確認/);
    const recovered = await runCalendarSync(['apply'], options);
    assert.equal(recovered.replayed, true); assert.equal(recovered.revision, 1);
    assert.equal((await client.state()).events.length, 1);
    assert.equal((await runCalendarSync(['apply'], options)).alreadyApplied, true);

    await runCalendarSync(['prepare', inputPath], options);
    assert.equal((await runCalendarSync(['apply'], options)).noWriteNeeded, true);
    assert.equal((await client.state()).revision, 1);

    input.observations[0].startsAt = '2026-11-25T14:00:00Z'; saveInput();
    assert.equal((await runCalendarSync(['prepare', inputPath], options)).requiresReview, 1);
    assert.equal((await runCalendarSync(['apply'], options)).noEligibleEvents, true);
    assert.equal((await client.state()).events[0].startsAt, '2026-11-25T13:30:00.000Z');

    input.observations[0].kind = 'bea.gdp.second'; input.observations[0].period = '2026-Q3'; saveInput();
    await runCalendarSync(['prepare', inputPath], options);
    const storedPath = join(options.directory, 'prepared.json'), tampered = JSON.parse(readFileSync(storedPath, 'utf8'));
    tampered.rawSource = tampered.rawSource.replace('GDP', 'Changed'); writeFileSync(storedPath, JSON.stringify(tampered));
    await assert.rejects(runCalendarSync(['apply'], options), /被修改/);
    await runCalendarSync(['prepare', inputPath], options);
    // Another legitimate Author write invalidates this preview.
    await client.login(secret);
    const concurrent = JSON.parse(readFileSync(storedPath, 'utf8'));
    await client.request('/api/admin/calendar/import', 'POST', { rawSource: concurrent.rawSource, baseRevision: concurrent.baseState.revision, requestId: 'calendar-sync-concurrent-0001', usageConfirmed: true });
    await client.logout();
    await assert.rejects(runCalendarSync(['apply'], options), /版本已變更/);
    assert.equal((await client.state()).events.length, 2);
    const noSecret = readFileSync(join(options.directory, 'last-success.json'), 'utf8'); assert.ok(!noSecret.includes(secret));
    assert.throws(() => new CalendarSyncClient('https://production.invalid'), /localhost/);
    assert.throws(() => new CalendarSyncClient('http://localhost:5173@evil.invalid'), /localhost/);
    assert.throws(() => new CalendarSyncClient('http://127.0.0.1:5173'), /localhost/);
  } finally { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; rmSync(directory, { recursive: true, force: true }); }
});
