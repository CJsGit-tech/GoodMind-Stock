import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { markdownFixture } from '../../tests/fixtures/etf-markdown-fixture.ts';
import { seedReport } from '../../shared/etf-seed.ts';
import { jsonFixtureParts } from '../../tests/fixtures/etf-json-fixture.ts';

test('Markdown Author HTTP authority, atomic publication, revisions and restart persistence', { timeout: 60000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://localhost:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'pocketstocks-md-http-'));
  const secret = randomBytes(32).toString('base64url');
  let child: ChildProcess | undefined;
  let cookie = '';
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, PORT: String(port), POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret, POCKETSTOCKS_DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stderr!.on('data', value => { diagnostics += value; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error('Local runtime failed: ' + diagnostics);
      try { if ((await fetch(origin + '/api/_healthcheck')).ok) return; } catch { /* wait for runtime */ }
      await delay(100);
    }
    throw Error('Local runtime did not become ready.');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
  }
  async function post(action: string, body: unknown, authenticated = true, requestOrigin = origin) {
    const response = await fetch(origin + '/api/admin/etf-markdown/' + action, {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  }
  async function publicReport(id: string, version?: number) {
    const response = await fetch(origin + '/api/etf/reports/' + id + (version ? '?version=' + version : ''));
    return { status: response.status, value: await response.json() };
  }
  try {
    await start();
    const rawMarkdown = markdownFixture();
    assert.equal((await post('validate', { rawMarkdown }, false)).status, 401);
    const login = await fetch(origin + '/api/admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')!.split(';')[0];
    const legacy = { ...seedReport, id: 'qa-reversible-legacy' };
    async function legacyPost(action: string, body: unknown) {
      const response = await fetch(origin + '/api/admin/etf-reports/' + action, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    }
    assert.equal((await legacyPost('save', { report: legacy, baseRevision: 0, requestId: 'legacy-save' })).status, 200);
    assert.equal((await legacyPost('publish', { id: legacy.id, baseRevision: 1, requestId: 'legacy-publish', reviewed: true })).status, 200);
    const originalLegacy = await publicReport(legacy.id, 1);
    assert.equal(originalLegacy.status, 200);
    const visibility = { id: legacy.id, baseRevision: 1, expectedPublishedVersion: 1, archived: true, requestId: 'legacy-archive' };
    const archived = await legacyPost('visibility', visibility);
    assert.equal(archived.status, 200); assert.equal(archived.value.entry.archived, true);
    assert.equal((await legacyPost('visibility', visibility)).status, 200);
    assert.equal((await publicReport(legacy.id)).status, 404);
    assert.equal((await publicReport(legacy.id, 1)).status, 404);
    const list = await (await fetch(origin + '/api/etf/reports')).json();
    assert.equal(list.items.some((r: { id: string }) => r.id === legacy.id), false);
    assert.equal((await legacyPost('get', { id: legacy.id })).value.entry.draft.id, legacy.id);
    assert.equal((await legacyPost('visibility', { ...visibility, baseRevision: 99, requestId: 'legacy-stale' })).status, 409);
    assert.equal((await legacyPost('visibility', { ...visibility, archived: false, requestId: 'legacy-restore' })).status, 200);
    assert.deepEqual((await publicReport(legacy.id, 1)).value, originalLegacy.value);
    assert.equal((await post('validate', { rawMarkdown }, true, 'https://untrusted.invalid')).status, 403);
    const parsed = await post('validate', { rawMarkdown });
    assert.equal(parsed.status, 200); assert.deepEqual(parsed.value.errors, []);
    const id = parsed.value.report.id;
    assert.equal((await publicReport(id)).status, 404);
    const saved = await post('save', { rawMarkdown, baseRevision: 0, requestId: 'md-http-save-1' });
    assert.equal(saved.status, 200); assert.equal(saved.value.entry.revision, 1);
    assert.equal((await publicReport(id)).status, 404);
    const replay = await post('save', { rawMarkdown, baseRevision: 0, requestId: 'md-http-save-1' });
    assert.equal(replay.value.entry.revision, 1);
    const status = await post('status', { requestId: 'md-http-save-1' });
    assert.equal(status.value.state, 'applied');
    assert.equal((await post('publish', { id, baseRevision: 1, expectedPublishedVersion: 0, reviewed: true, reviewHash: 'invalid', requestId: 'md-http-unreviewed' })).status, 409);
    const reviewed = await post('review', { id, baseRevision: 1, sourceHash: saved.value.entry.draft.sourceHash, requestId: 'md-http-review-1' });
    assert.equal(reviewed.status, 200);
    const publishInput = { id, baseRevision: 1, expectedPublishedVersion: 0, reviewed: true, reviewHash: reviewed.value.entry.reviewHash, requestId: 'md-http-publish-1' };
    assert.equal((await post('publish', publishInput)).status, 200);
    assert.equal((await post('publish', publishInput)).value.entry.publishedVersion, 1);
    const first = await publicReport(id, 1);
    assert.equal(first.status, 200); assert.equal(first.value.report.rawMarkdown, rawMarkdown);
    assert.deepEqual(first.value.report.visualizations, saved.value.entry.draft.visualizations);
    const changed = rawMarkdown.replace(/\n# [^\n]+/, '\n# 本機修訂測試文章');
    assert.notEqual(changed, rawMarkdown);
    const revision = await post('save', { rawMarkdown: changed, baseRevision: 1, requestId: 'md-http-save-2' });
    assert.equal(revision.status, 200); assert.equal(revision.value.entry.revision, 2); assert.equal(revision.value.entry.reviewHash, null);
    assert.equal((await publicReport(id)).value.report.sourceHash, first.value.report.sourceHash);
    assert.equal((await post('save', { rawMarkdown, baseRevision: 1, requestId: 'md-http-stale' })).status, 409);
    const reviewed2 = await post('review', { id, baseRevision: 2, sourceHash: revision.value.entry.draft.sourceHash, requestId: 'md-http-review-2' });
    const published2 = await post('publish', { id, baseRevision: 2, expectedPublishedVersion: 1, reviewed: true, reviewHash: reviewed2.value.entry.reviewHash, requestId: 'md-http-publish-2' });
    assert.equal(published2.status, 200); assert.equal(published2.value.entry.publishedVersion, 2);
    assert.equal((await publicReport(id, 1)).value.report.rawMarkdown, rawMarkdown);
    assert.equal((await publicReport(id)).value.report.rawMarkdown, changed);
    await stop(); await start();
    assert.equal((await post('get', { id })).value.entry.draft.rawMarkdown, changed);
    assert.equal((await publicReport(id, 1)).value.report.rawMarkdown, rawMarkdown);
    assert.equal((await post('status', { requestId: 'md-http-publish-2' })).value.state, 'applied');
    // JSON visibility uses the same Author contract as Production, with an unpublished r2.
    const jsonId = 'qa-json-visibility';
    const rawSource = JSON.stringify(jsonFixtureParts(jsonId));
    const jpeg = readFileSync(new URL('../../tests/etf-cover.test.ts', import.meta.url), 'utf8').match(/const JPEG = '([^']+)'/)![1];
    const jsonSaved = await post('save', { rawSource, cover: { filename: 'cover.jpg', contentBase64: jpeg }, baseRevision: 0, requestId: 'json-save-1' });
    assert.equal(jsonSaved.status, 200);
    const jsonReview = await post('review', { id: jsonId, baseRevision: 1, sourceHash: jsonSaved.value.entry.draft.sourceHash, requestId: 'json-review-1' });
    assert.equal((await post('publish', { id: jsonId, baseRevision: 1, expectedPublishedVersion: 0, reviewHash: jsonReview.value.entry.reviewHash, reviewed: true, requestId: 'json-publish-1' })).status, 200);
    const originalJson = (await publicReport(jsonId, 1)).value;
    const privateSource = rawSource.replace('合成資料 999', 'QA_PRIVATE_REVISION_2');
    const jsonPrivate = (await post('save', { rawSource: privateSource, cover: null, baseRevision: 1, requestId: 'json-save-2' })).value.entry;
    const publicIdentity = (value: any) => ({ report: value.report, version: value.version, publishedAt: value.publishedAt, cover: value.cover && { ...value.cover, url: undefined } });
    function immutableState() {
      const db = new DatabaseSync(join(dir, 'pocketstocks.sqlite'), { readOnly: true });
      try { return db.prepare('SELECT bucket,id,data FROM records WHERE bucket IN (?,?) ORDER BY bucket,id').all('etf_report_snapshots_v1', 'etf_markdown_pages_v3'); }
      finally { db.close(); }
    }
    const immutableBefore = immutableState();
    const archiveJson = { id: jsonId, baseRevision: 2, expectedPublishedVersion: 1, expectedUpdatedAt: jsonPrivate.updatedAt, archived: true, requestId: 'json-archive-1' };
    assert.equal((await post('visibility', archiveJson, false)).status, 401);
    assert.equal((await post('visibility', archiveJson, true, 'https://untrusted.invalid')).status, 403);
    assert.equal((await post('visibility', { ...archiveJson, archived: 'true' })).status, 400);
    const jsonArchived = await post('visibility', archiveJson);
    assert.equal(jsonArchived.status, 200); assert.equal(jsonArchived.value.entry.archived, true);
    assert.equal(jsonArchived.value.entry.revision, 2); assert.equal(jsonArchived.value.entry.publishedVersion, 1);
    assert.equal(jsonArchived.value.entry.draft.rawJson, privateSource);
    assert.equal((await post('visibility', archiveJson)).status, 200, 'Same request replays without changing state');
    assert.equal((await post('visibility', { ...archiveJson, archived: false })).status, 409, 'Request ID cannot change intent');
    assert.equal((await post('visibility', { ...archiveJson, archived: false, requestId: 'json-stale-time' })).status, 409);
    assert.equal((await publicReport(jsonId)).status, 404); assert.equal((await publicReport(jsonId, 1)).status, 404);
    assert.equal((await fetch(origin + '/api/etf/reports/' + jsonId + '/cover?version=1')).status, 404);
    assert.equal((await (await fetch(origin + '/api/etf/reports')).json()).items.some((r: { id: string }) => r.id === jsonId), false);
    assert.equal((await post('list', {})).value.items.find((r: { id: string }) => r.id === jsonId).archived, true);
    await stop(); await start();
    const recovered = await post('status', { requestId: 'json-archive-1' });
    assert.equal(recovered.value.state, 'applied'); assert.equal(recovered.value.entry.archived, true);
    const restored = await post('visibility', { ...archiveJson, expectedUpdatedAt: recovered.value.entry.updatedAt, archived: false, requestId: 'json-restore-1' });
    assert.equal(restored.status, 200); assert.equal(restored.value.entry.revision, 2); assert.equal(restored.value.entry.publishedVersion, 1);
    assert.deepEqual(publicIdentity((await publicReport(jsonId, 1)).value), publicIdentity(originalJson), 'Restore exposes original JSON and cover, not the private r2');
    assert.deepEqual(immutableState(), immutableBefore, 'Archive/restore does not alter any immutable source page or snapshot');
    assert.equal((await fetch(origin + '/api/etf/reports/' + jsonId + '/cover?version=1')).status, 200);
    assert.equal((await post('get', { id: jsonId })).value.entry.draft.rawJson, privateSource);
    const archiveAgain = await post('visibility', { ...archiveJson, expectedUpdatedAt: restored.value.entry.updatedAt, requestId: 'json-archive-2' });
    const thirdSource = privateSource.replace('QA_PRIVATE_REVISION_2', 'QA_PRIVATE_REVISION_3');
    const third = await post('save', { rawSource: thirdSource, baseRevision: 2, requestId: 'json-save-3' });
    assert.equal(third.value.entry.archived, true, 'Saving an archived article preserves visibility');
    assert.equal((await publicReport(jsonId)).status, 404);
    assert.equal((await post('visibility', { ...archiveJson, expectedUpdatedAt: archiveAgain.value.entry.updatedAt, archived: false, requestId: 'json-stale-revision' })).status, 409);
    const thirdReview = await post('review', { id: jsonId, baseRevision: 3, sourceHash: third.value.entry.draft.sourceHash, requestId: 'json-review-3' });
    const newPublished = await post('publish', { id: jsonId, baseRevision: 3, expectedPublishedVersion: 1, reviewHash: thirdReview.value.entry.reviewHash, reviewed: true, requestId: 'json-publish-2' });
    assert.equal(newPublished.status, 200); assert.equal(newPublished.value.entry.archived, false); assert.equal(newPublished.value.entry.publishedVersion, 2);
    assert.equal((await publicReport(jsonId)).value.report.rawJson, thirdSource);
    assert.deepEqual(publicIdentity((await publicReport(jsonId, 1)).value), publicIdentity(originalJson));
    const logout = await fetch(origin + '/api/admin/session', { method: 'DELETE', headers: { Origin: origin, Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await post('list', {})).status, 401);
    // The public snapshot is independent of an Author session.
    assert.equal((await publicReport(id)).status, 200);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
