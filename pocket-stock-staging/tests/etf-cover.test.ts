import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ETF_COVER_BYTES, MAX_ETF_COVER_BASE64_CHARS, validateEtfCover } from '../shared/etf-cover.ts';
import { jsonFixtureParts } from './fixtures/etf-json-fixture.ts';

// Synthetic solid RGB JPEG, generated at 480x360; kept inline for portable source-only tests.
const JPEG = '/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAeCgAwAEAAAAAQAAAWgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAWgB4AMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAB7/2gAMAwEAAhEDEQA/APheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9D4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//R+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//0vheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9P4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//U+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//1fheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9b4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//X+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//0Pheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9H4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//S+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//0/heiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9T4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//V+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//1vheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9f4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Q+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//0fheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9L4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//T+F6KKK/Kz9MCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//1Pheiiivys/TAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9X4Xooor8rP0wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z';
const upload = (contentBase64 = JPEG) => ({ filename: 'cover.jpg', contentBase64 });

test('cover validation checks canonical base64, JPEG segment bounds, exact dimensions and color components', async () => {
  const accepted = await validateEtfCover(upload());
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.cover!.width, 480); assert.equal(accepted.cover!.height, 360);
  assert.equal(accepted.cover!.bytes, Buffer.from(JPEG, 'base64').length);
  assert.equal(accepted.cover!.sha256, createHash('sha256').update(Buffer.from(JPEG, 'base64')).digest('hex'));
  const bytes = Buffer.from(JPEG, 'base64'), sof = bytes.indexOf(Buffer.from([255, 192]));
  assert.ok(sof > 0);
  const malformed = (change: (bytes: Buffer) => void) => { const copy = Buffer.from(bytes); change(copy); return upload(copy.toString('base64')); };
  const invalid = [
    null, [], { ...upload(), filename: '../cover.jpg' }, { ...upload(), filename: 'cover.png' },
    { ...upload(), style: 'unsafe' }, upload('data:image/jpeg;base64,' + JPEG), upload(JPEG + '\n'), upload('abc='),
    upload(Buffer.from('not a JPEG').toString('base64')),
    upload(bytes.subarray(0, bytes.length - 2).toString('base64')),
    upload(Buffer.concat([bytes, Buffer.from([0])]).toString('base64')),
    malformed(b => b[0] = 0), malformed(b => b[sof + 3] = 255),
    malformed(b => b[sof + 4] = 12), malformed(b => b[sof + 8] = 0),
    malformed(b => b[sof + 9] = 4), malformed(b => b[sof + 9] = 1),
    malformed(b => b[sof + 13] = b[sof + 10]),
    malformed(b => b[sof + 11] = 0),
  ];
  for (const value of invalid) {
    const result = await validateEtfCover(value);
    assert.equal(result.cover, null); assert.ok(result.errors.length); assert.match(result.errors[0].path, /^cover/);
  }
  const encodedOversize = await validateEtfCover(upload('A'.repeat(MAX_ETF_COVER_BASE64_CHARS + 4)));
  assert.equal(encodedOversize.errors[0].code, 'cover_too_large');
  const decodedOversize = await validateEtfCover(upload(Buffer.alloc(MAX_ETF_COVER_BYTES + 1).toString('base64')));
  assert.equal(decodedOversize.errors[0].code, 'cover_too_large');
});

const actualRoot = process.env.ACTIVEETF_JSON_ROOT;
test('four actual skill covers pass server validation with exact byte hashes', { skip: !actualRoot }, async t => {
  for (const day of ['12', '13', '14', '15']) {
    const bytes = readFileSync(join(actualRoot!, `2026-10-${day}-台股主動ETF日報`, 'cover.jpg'));
    const result = await validateEtfCover(upload(bytes.toString('base64')));
    assert.deepEqual(result.errors, []);
    assert.equal(result.cover!.bytes, bytes.length);
    assert.equal(result.cover!.sha256, createHash('sha256').update(bytes).digest('hex'));
    t.diagnostic(`10/${day}: ${bytes.length} bytes, SHA-256 ${result.cover!.sha256}`);
  }
});

test('cover companion stays private until reviewed publication; revisions, receipts and old snapshots remain immutable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'etf-cover-'));
  process.env.POCKETSTOCKS_DATA_DIR = dir; process.env.ADMIN_MASTER_SECRET = 'disposable-cover-test';
  process.env.POCKETSTOCKS_LOCAL_ORIGIN = 'http://localhost:5173';
  const { db, storage, readSignedAsset } = await import('../local/sdk.ts');
  const { LocalDatabaseError } = await import('../local/database.ts');
  const { makeEtfMarkdownRoutes, readPublishedMarkdown, readPublishedEtfCover } = await import('../backend/etf-markdown.ts');
  const { makeEtfRoutes } = await import('../backend/etf-reports.ts');
  const helpers = { requireAdmin: async (event: any) => event.author ? { id: 'fixture' } : null, isSameOriginMutation: (event: any) => event.trusted };
  const routes = makeEtfMarkdownRoutes(helpers), catalog = makeEtfRoutes(helpers);
  const id = 'qa-cover-report', raw = JSON.stringify(jsonFixtureParts(id));
  const call = async (action: string, body: any = {}, author = true, trusted = true) => {
    const response = await routes['POST /api/admin/etf-research/' + action][0]({ body, event: { author, trusted }, params: {}, query: {} });
    assert.ok(response); return { status: response!.statusCode, data: JSON.parse(response!.body) };
  };
  const fresh = async () => (await call('get', { id })).data.entry;
  const review = async (requestId: string) => {
    const current = await fresh();
    return call('review', { id, baseRevision: current.revision, sourceHash: current.draft.sourceHash, requestId });
  };
  const publish = async (requestId: string) => {
    const current = await fresh();
    return call('publish', { id, baseRevision: current.revision, expectedPublishedVersion: current.publishedVersion, reviewed: true, reviewHash: current.reviewHash, requestId });
  };
  const list = async () => JSON.parse((await catalog['GET /api/etf/reports'][0]({ body: {}, event: {}, params: {}, query: {} }))!.body);
  const originalTransact = db.transact, originalWrite = storage.write;
  let writes = 0;
  storage.write = async items => { writes += items.length; return originalWrite(items); };
  try {
    assert.equal((await call('validate', { rawSource: raw, cover: upload() }, false)).status, 401);
    assert.equal((await call('save', { rawSource: raw, cover: upload(), baseRevision: 0, requestId: 'cover-denied-001' }, true, false)).status, 403);
    assert.equal(writes, 0);
    const valid = await call('validate', { rawSource: raw, cover: upload() });
    assert.equal(valid.status, 200); assert.deepEqual(valid.data.errors, []);
    assert.equal(valid.data.cover.contentBase64, undefined); assert.equal(valid.data.cover.storagePath, undefined);
    const invalid = await call('validate', { rawSource: raw, cover: upload('AAAA') });
    assert.equal(invalid.data.coverErrors[0].code, 'invalid_cover'); assert.ok(invalid.data.errors.length);
    assert.equal((await call('save', { rawSource: raw, cover: upload('A'.repeat(MAX_ETF_COVER_BASE64_CHARS + 4)), baseRevision: 0, requestId: 'cover-large-001' })).status, 413);
    let result = await call('save', { rawSource: raw, cover: upload(), baseRevision: 0, requestId: 'cover-save-001' });
    assert.equal(result.status, 200); const first = result.data.entry;
    assert.equal(first.revision, 1); assert.equal(first.cover.width, 480); assert.equal(first.draft.rawJson, raw);
    assert.equal(first.cover.storagePath, undefined);
    const firstHash = first.cover.sha256, sourceHash = first.draft.sourceHash;
    assert.equal(writes, 1); assert.ok(readSignedAsset(new URL(first.cover.url)));
    assert.equal(await readPublishedMarkdown(id), null); assert.equal((await readPublishedEtfCover(id)).statusCode, 404);
    assert.deepEqual((await list()).items, []);
    assert.equal((await call('list')).data.items[0].cover.sha256, firstHash);
    const reviewed = (await review('cover-review-001')).data.entry;
    result = await call('save', { rawSource: raw, cover: upload(), baseRevision: 1, requestId: 'cover-noop-001' });
    assert.equal(result.data.entry.revision, 1); assert.equal(result.data.entry.updatedAt, reviewed.updatedAt);
    assert.equal(result.data.entry.reviewHash, reviewed.reviewHash); assert.equal(writes, 1);
    assert.equal((await call('save', { rawSource: raw, cover: upload(), baseRevision: 1, requestId: 'cover-noop-001' })).status, 200);
    assert.equal((await publish('cover-publish-001')).status, 200);
    assert.equal((await list()).items[0].cover.sha256, firstHash);
    const publicV1 = JSON.parse((await readPublishedMarkdown(id, '1'))!.body);
    assert.equal(publicV1.cover.sha256, firstHash); assert.equal(publicV1.report.sourceHash, sourceHash);
    const response = await routes['GET /api/etf/reports/:id/cover'][0]({ body: {}, event: {}, params: { id }, query: { version: '1', sha256: firstHash } });
    assert.equal(response!.statusCode, 200); assert.equal(JSON.parse(response!.body).cover.sha256, firstHash);
    assert.equal((await readPublishedEtfCover(id, '2')).statusCode, 404);
    assert.equal((await readPublishedEtfCover(id, '1', 'a'.repeat(64))).statusCode, 404);
    assert.equal((await readPublishedEtfCover(id, '1', 'bad')).statusCode, 400);
    assert.equal((await readPublishedEtfCover(id, '')).statusCode, 404);

    // A different valid JPEG comment changes only the asset, not source bytes or research hash.
    const secondBytes = Buffer.concat([Buffer.from(JPEG, 'base64').subarray(0, 2), Buffer.from([255, 254, 0, 3, 65]), Buffer.from(JPEG, 'base64').subarray(2)]);
    const secondUpload = upload(secondBytes.toString('base64'));
    result = await call('save', { rawSource: raw, cover: secondUpload, baseRevision: 1, requestId: 'cover-save-002' });
    const second = result.data.entry;
    assert.equal(second.revision, 2); assert.equal(second.reviewHash, null); assert.notEqual(second.cover.sha256, firstHash);
    assert.equal(second.draft.sourceHash, sourceHash); assert.equal(second.draft.rawJson, raw);
    assert.equal((await call('save', { rawSource: raw, cover: secondUpload, baseRevision: 1, requestId: 'cover-save-001' })).status, 409);
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).cover.sha256, firstHash);
    assert.equal((await publish('cover-unreviewed-001')).status, 400);
    await review('cover-review-002'); await publish('cover-publish-002');
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).cover.sha256, second.cover.sha256);
    assert.equal(JSON.parse((await readPublishedMarkdown(id, '1'))!.body).cover.sha256, firstHash);
    assert.equal((await readPublishedEtfCover(id, '1', firstHash)).statusCode, 200);
    assert.equal((await readPublishedEtfCover(id, '2', firstHash)).statusCode, 404);

    // Omission preserves the companion even when the research source changes.
    result = await call('save', { rawSource: raw + '\n', baseRevision: 2, requestId: 'cover-keep-001' });
    assert.equal(result.data.entry.revision, 3); assert.equal(result.data.entry.cover.sha256, second.cover.sha256);
    const concurrent = await Promise.all([
      call('save', { rawSource: raw + '\n', baseRevision: 3, requestId: 'cover-noop-race-001' }),
      review('cover-review-race-001'),
    ]);
    assert.ok(concurrent.every(r => r.status === 200)); assert.ok((await fresh()).reviewHash);
    result = await call('save', { rawSource: raw + '\n', cover: null, baseRevision: 3, requestId: 'cover-remove-001' });
    assert.equal(result.data.entry.revision, 4); assert.equal(result.data.entry.cover, null); assert.equal(result.data.entry.reviewHash, null);
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).cover.sha256, second.cover.sha256);
    await review('cover-review-remove-001'); await publish('cover-publish-remove-001');
    assert.equal(JSON.parse((await readPublishedMarkdown(id))!.body).cover, null);
    assert.equal(JSON.parse((await readPublishedEtfCover(id, '3')).body).cover, null);
    assert.equal(JSON.parse((await readPublishedMarkdown(id, '1'))!.body).cover.sha256, firstHash);
    await db.tx.update('etf_public_reports_v1', [{ id, record: { archived: true } }], { patch: true });
    assert.equal((await readPublishedEtfCover(id, '1', firstHash)).statusCode, 404); assert.deepEqual((await list()).items, []);
    await db.tx.update('etf_public_reports_v1', [{ id, record: { archived: false } }], { patch: true });

    db.transact = (async operations => { await originalTransact(operations); throw new LocalDatabaseError('AppDatabaseUnknownOutcome'); }) as any;
    result = await call('save', { rawSource: raw + '\n', cover: upload(), baseRevision: 4, requestId: 'cover-unknown-applied-001' });
    assert.equal(result.status, 200); assert.equal(result.data.entry.revision, 5);
    assert.equal((await call('status', { requestId: 'cover-unknown-applied-001' })).data.state, 'applied');
    db.transact = (async () => { throw new LocalDatabaseError('AppDatabaseUnknownOutcome'); }) as any;
    result = await call('save', { rawSource: raw + '\n', cover: null, baseRevision: 5, requestId: 'cover-unknown-unresolved-001' });
    assert.equal(result.status, 503); assert.equal((await call('status', { requestId: 'cover-unknown-unresolved-001' })).data.state, 'unresolved');
    assert.equal((await fresh()).cover.sha256, firstHash);
    db.transact = originalTransact;
    const race = await Promise.all([
      call('save', { rawSource: raw + '\n', cover: null, baseRevision: 5, requestId: 'cover-cas-001' }),
      call('save', { rawSource: raw + '\n', cover: secondUpload, baseRevision: 5, requestId: 'cover-cas-002' }),
    ]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    const expired = new URL(first.cover.url); expired.searchParams.set('expires', '0'); assert.equal(readSignedAsset(expired), null);
    await review('cover-review-noop-publication-001');
    const beforePublication = await fresh();
    let injectPublication = true;
    db.transact = (async operations => {
      if(injectPublication) {
        injectPublication = false;
        assert.equal((await publish('cover-publish-noop-race-001')).status, 200);
      }
      return originalTransact(operations);
    }) as any;
    const racedNoop = await call('save', { rawSource: raw + '\n', baseRevision: beforePublication.revision, requestId: 'cover-noop-publication-001' });
    assert.equal(racedNoop.status, 409); // The no-op cannot overwrite a newer publication pointer.
    assert.equal((await fresh()).publishedVersion, beforePublication.publishedVersion + 1);
    db.transact = originalTransact;

    const legacyId = 'qa-cover-legacy', legacyRaw = JSON.stringify(jsonFixtureParts(legacyId));
    const legacy = (await call('save', { rawSource: legacyRaw, baseRevision: 0, requestId: 'cover-legacy-save-001' })).data.entry;
    const legacyReviewed = (await call('review', { id: legacyId, baseRevision: 1, sourceHash: legacy.draft.sourceHash, requestId: 'cover-legacy-review-001' })).data.entry;
    const expectedLegacyHash = createHash('sha256').update(JSON.stringify({ id: legacyId, revision: 1, sourceHash: legacy.draft.sourceHash, parserVersion: legacy.draft.parserVersion })).digest('hex');
    assert.equal(legacyReviewed.reviewHash, expectedLegacyHash); assert.equal(legacyReviewed.cover, null);
  } finally {
    db.transact = originalTransact; storage.write = originalWrite; db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
