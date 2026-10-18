import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

// Reuse the checked-in synthetic fixture and the real publication pipeline.
// The scope and qa- identities are isolated from recovered market observations.
export async function seedDemo({ omitIndex = -1 } = {}) {
  const { qaDays, qaPackage } = await import('../backend/tests/etf-history-fixture.mjs');
  const store = await import('../backend/etf-data-store.ts');
  let published = 0;
  for (let n = 0; n < qaDays.length; n++) {
    if (n === omitIndex || await store.getHead('qa-etf-history', qaDays[n])) continue;
    const pack = qaPackage(n);
    const id = step => `local-demo-v1-${qaDays[n]}-${step}`;
    let batch = (await store.createBatch({ requestId: id('create'), manifest: pack.manifest })).batch;
    for (let i = 0; i < pack.chunks.length; i++) {
      if (batch.receivedChunks.includes(i)) continue;
      batch = (await store.uploadChunk(batch.id, { requestId: id('chunk-' + i), expectedRevision: batch.revision, chunkNo: i, facts: pack.chunks[i].facts })).batch;
    }
    if (!['ready', 'reviewed', 'published'].includes(batch.status)) batch = (await store.validateBatch(batch.id, { requestId: id('validate'), expectedRevision: batch.revision })).batch;
    if (!batch.validation?.complete || batch.validation.blockingErrors.length) throw Error('Synthetic fixture did not validate.');
    if (batch.status === 'ready') batch = (await store.reviewBatch(batch.id, { requestId: id('review'), expectedRevision: batch.revision, reviewHash: batch.validation.reviewHash, acknowledged: true })).batch;
    if (batch.status !== 'published') await store.publishBatch(batch.id, { requestId: id('publish'), expectedRevision: batch.revision, reviewHash: batch.reviewedPayloadHash, expectedHeadVersion: 0, confirmed: true });
    published++;
  }
  return { scope: 'qa-etf-history', published, totalFixtureDates: qaDays.length, omittedDate: qaDays[omitIndex] || null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.chdir(root);
  const env = loadEnv('development', root, '');
  process.env.POCKETSTOCKS_DATA_DIR ||= resolve(root, '.local');
  process.env.POCKETSTOCKS_LOCAL_ORIGIN ||= 'http://localhost:' + (env.PORT || '5173');
  process.env.ADMIN_MASTER_SECRET = process.env.POCKETSTOCKS_LOCAL_ADMIN_SECRET || env.ADMIN_MASTER_SECRET;
  if (!process.env.ADMIN_MASTER_SECRET) throw Error('Start local staging once to create its local configuration.');
  const { db } = await import('./sdk.ts');
  try { console.log(JSON.stringify(await seedDemo())); } finally { db.close(); }
}
