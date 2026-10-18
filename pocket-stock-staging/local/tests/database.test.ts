import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../database.ts';
import { isPublicAssetUrl } from '../../backend/public-book.ts';

test('local records survive reconnect and legacy add keeps physical IDs separate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketstocks-db-'));
  let db = createDatabase(join(dir, 'test.sqlite'));
  try {
    const [id] = await db.add('reader:legacy', [{ id: 'payload-id', value: 4 }]);
    assert.notEqual(id, 'payload-id');
    db.close(); db = createDatabase(join(dir, 'test.sqlite'));
    assert.deepEqual(await db.get('reader:legacy', [id]), [{ id: 'payload-id', value: 4 }]);
    const page = await db.list('reader:legacy'); assert.equal(page.items[0].id, id);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
test('conditional transaction rolls back all writes and successful lazy handles execute once', async () => {
  const db = createDatabase(':memory:');
  try {
    await db.tx.add('facts', [{ id: 'head', revision: 1 }]);
    await assert.rejects(db.transact([
      db.tx.add('facts', [{ id: 'receipt', value: 'must roll back' }]),
      db.tx.update('facts', [{ id: 'head', if: { revision: 0 }, record: { revision: 2 } }]),
    ]), { code: 'AppDatabaseConditionFailed' });
    assert.deepEqual(await db.get('facts', ['receipt', 'head']), [null, { id: 'head', revision: 1 }]);
    const lazy = db.tx.add('facts', [{ id: 'once', value: 1 }]);
    assert.deepEqual(await db.get('facts', ['once']), [null]);
    assert.deepEqual(await lazy, ['once']); assert.deepEqual(await lazy, ['once']);
    await assert.rejects(db.transact([lazy]), { code: 'AppDatabaseCapabilityInvalid' });
    await db.transact([db.tx.update('facts', [{ id: 'head', if: { revision: 1 }, record: { revision: 2 } }], { patch: true })]);
    assert.equal((await db.get<any>('facts', ['head']))[0].revision, 2);
  } finally { db.close(); }
});
test('pagination binds cursors to a table and does not skip remaining rows after deletion', async () => {
  const db = createDatabase(':memory:');
  try {
    await db.tx.add('facts', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const first = await db.list('facts', { limit: 1 });
    await db.delete('facts', ['a']);
    const next = await db.list('facts', { limit: 2, nextToken: first.nextToken });
    assert.deepEqual(next.items.map(row => row.id), ['b', 'c']);
    await assert.rejects(db.list('other', { nextToken: first.nextToken }), { code: 'AppDatabaseInvalidInput' });
  } finally { db.close(); }
});
test('HTTP image exception accepts only the configured localhost asset endpoint', () => {
  const previous = process.env.POCKETSTOCKS_LOCAL_ORIGIN;
  process.env.POCKETSTOCKS_LOCAL_ORIGIN = 'http://localhost:5173';
  try {
    assert.equal(isPublicAssetUrl('https://example.com/image.jpg'), true);
    assert.equal(isPublicAssetUrl('http://localhost:5173/__local/storage?path=x'), true);
    for (const value of ['http://localhost:5174/__local/storage', 'http://evil.test/__local/storage', 'http://localhost:5173/.env']) assert.equal(isPublicAssetUrl(value), false);
  } finally { if (previous === undefined) delete process.env.POCKETSTOCKS_LOCAL_ORIGIN; else process.env.POCKETSTOCKS_LOCAL_ORIGIN = previous; }
});
