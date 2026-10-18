import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return resolve(index < 0 ? fallback : process.argv[index + 1]);
};
const mangaRoot = option('--manga-dir', '/Users/chuang/Desktop/manga-layout-templates');
const etfRoot = option('--etf-dir', '/Users/chuang/Downloads/ETFPostclose/backfill-20261015');
const dataRoot = option('--data-dir', '.local');
const apply = process.argv.includes('--apply');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
type Asset = { source: string; title: string; altText: string; hash: string };
type Book = { id: string; title: string; summary: string; sector: string; tags: string[]; publicationDate: string; source: string; sourceHash: string; assets: Asset[] };

function asset(source: string, title: string, description: string, expectedHash?: string): Asset {
  const path = resolve(source);
  const rel = relative(mangaRoot, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Image path is outside the selected manga directory.');
  const bytes = readFileSync(path);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error('Expected a JPG image: ' + path);
  const hash = digest(bytes);
  if (expectedHash && hash !== expectedHash) throw Error('Source image hash mismatch: ' + path);
  return { source: path, title, altText: description || title, hash };
}
function bookPlans(): Book[] {
  const source = resolve(mangaRoot, 'twstock-revised-20261013/PUBLICATION-PACKAGE.json');
  const books: Book[] = readJson(source).map((book: any) => {
    const resultPath = resolve(mangaRoot, 'twstock-revised-20261013', book.chapter, 'PUBLISH-RESULT.md');
    if (!readFileSync(resultPath, 'utf8').includes('UPDATED_PUBLISHED_OK')) throw Error('No verified publication record: ' + resultPath);
    const id = book.url.match(/\/article\/([a-f0-9-]{36})$/)?.[1];
    if (!id) throw Error('Invalid published book ID.');
    return { id, title: book.title, summary: book.summary, sector: '來源未記錄', tags: [], publicationDate: '2026-10-08', source,
      sourceHash: digest(JSON.stringify(book)), assets: book.pages.map((p: any) => asset(p.path, p.title, p.description)) };
  });
  for (const folder of ['ptfe-materials-competition-20261014', 'us-data-market-reactions-20261015']) {
    const source = resolve(mangaRoot, folder, 'PUBLISH-PACKAGE.json');
    const data = readJson(source);
    if (!/published.*verified/.test(data.status || '') || !/^[a-f0-9-]{36}$/.test(data.book_id || '')) throw Error('Book publication is not confirmed: ' + source);
    const pages = [...data.pages];
    if (!pages.some(p => (p.file || p.path) === data.cover)) pages.unshift({ file: data.cover, title: data.title, image_description: data.title, sha256: data.cover_sha256 });
    books.push({ id: data.book_id, title: data.title, summary: data.summary, sector: data.category || '高速PCB材料',
      tags: data.published_tags || data.tags, publicationDate: data.research_date || '2026-10-14', source, sourceHash: digest(readFileSync(source)),
      assets: pages.map((p: any) => asset(p.file || p.path, p.title, p.image_description || p.description || p.summary, p.sha256)) });
  }
  if (new Set(books.map(b => b.id)).size !== books.length) throw Error('Duplicate source book IDs.');
  return books;
}
function publishedPackages() {
  return readdirSync(resolve(etfRoot, 'import-state-v3')).filter(name => name.endsWith('.json')).sort().flatMap(name => {
    const receipt = readJson(resolve(etfRoot, 'import-state-v3', name));
    if (receipt.status !== 'published') return [];
    if (!receipt.publicationId) throw Error('Published receipt has no publication ID: ' + name);
    const source = resolve(etfRoot, 'packages', name);
    const bytes = readFileSync(source);
    const pack = JSON.parse(bytes.toString('utf8'));
    if (pack.manifest.requestedDate !== receipt.date) throw Error('Package date does not match its publication receipt.');
    const counts: Record<string, number> = {};
    for (const chunk of pack.chunks) for (const fact of chunk.facts) counts[fact.kind] = (counts[fact.kind] || 0) + 1;
    if (pack.chunks.length !== pack.manifest.chunkCount || JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(pack.manifest.expectedCounts).sort())) throw Error('Package counts do not match its manifest: ' + name);
    return [{ source, sourceHash: digest(bytes), receipt, pack }];
  });
}
const books = bookPlans();
const packages = publishedPackages();
if (!packages.length) throw Error('No confirmed published ETF packages.');
const inventory = { books: books.length, images: books.reduce((n, b) => n + b.assets.length, 0), etfDates: packages.length,
  holdings: packages.reduce((n, p) => n + (p.pack.manifest.expectedCounts.holding || 0), 0), firstDate: packages[0].receipt.date, lastDate: packages.at(-1)!.receipt.date };
console.log(JSON.stringify({ mode: apply ? 'apply' : 'inventory-only', ...inventory }));
if (!apply) process.exit(0);

// Create a consistent SQLite backup and an independent storage copy before any writes.
const backupRoot = resolve(dataRoot, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(backupRoot, { recursive: true });
const databasePath = resolve(dataRoot, 'pocketstocks.sqlite');
if (existsSync(databasePath)) {
  const backup = spawnSync('python3', ['-c', 'import sqlite3,sys; a=sqlite3.connect(sys.argv[1]); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()', databasePath, resolve(backupRoot, 'pocketstocks.sqlite')], { encoding: 'utf8' });
  if (backup.status !== 0) throw Error('Database backup failed: ' + backup.stderr);
}
if (existsSync(resolve(dataRoot, 'storage'))) cpSync(resolve(dataRoot, 'storage'), resolve(backupRoot, 'storage'), { recursive: true });
console.log('Backup created: ' + backupRoot);

process.env.POCKETSTOCKS_LOCAL_ORIGIN = 'http://localhost:5173';
process.env.POCKETSTOCKS_DATA_DIR = dataRoot;
// Importing content does not use a cloud credential or create a login session.
const localEnv = readFileSync(resolve(root, '.env'), 'utf8');
process.env.ADMIN_MASTER_SECRET = localEnv.split('\n').find(line => line.startsWith('ADMIN_MASTER_SECRET='))?.slice('ADMIN_MASTER_SECRET='.length) || '';
if (!process.env.ADMIN_MASTER_SECRET) throw Error('Start local staging once to create its local configuration.');
const { db } = await import('./sdk.ts');
const store = await import('../backend/etf-data-store.ts');
const receiptPath = resolve(dataRoot, 'imports/content-recovery-v1.json');
mkdirSync(dirname(receiptPath), { recursive: true });
const result = existsSync(receiptPath) ? readJson(receiptPath) : { schemaVersion: 1, books: {}, etf: {}, report: null };
result.originalBackupPath ||= result.backupPath || backupRoot;
result.backupPaths = [...new Set([...(result.backupPaths || []), ...(result.backupPath ? [result.backupPath] : []), backupRoot])];
result.backupPath = backupRoot;
result.sourceRoots = { manga: mangaRoot, etf: etfRoot };
const saveReceipt = () => writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');

try {
  for (const book of books) {
    const [existing] = await db.get('articles', [book.id]);
    if (existing) {
      if (result.books[book.id]?.sourceHash === book.sourceHash) continue;
      throw Error('Existing local book is preserved; source-ID collision requires review: ' + book.id);
    }
    const pages = book.assets.map((item, index) => {
      const storagePath = `articles/${book.id}/local-recovery-v1/page-${index + 1}.jpg`;
      const target = resolve(dataRoot, 'storage', storagePath);
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target) && digest(readFileSync(target)) !== item.hash) throw Error('Existing local image differs: ' + target);
      copyFileSync(item.source, target);
      if (digest(readFileSync(target)) !== item.hash) throw Error('Copied image hash mismatch.');
      writeFileSync(target + '.meta', 'image/jpeg');
      return { id: 'page-' + (index + 1), order: index, title: item.title, altText: item.altText, storagePath };
    });
    const now = new Date().toISOString();
    await db.tx.add('articles', [{ id: book.id, title: book.title, summary: book.summary, sector: book.sector, tags: book.tags,
      publicationDate: book.publicationDate, published: true, coverPageId: pages[0].id, pages, createdAt: now, updatedAt: now }]);
    result.books[book.id] = { source: book.source, sourceHash: book.sourceHash, title: book.title, pages: book.assets,
      metadataLimit: book.sector === '來源未記錄' ? 'Cloud category/tags not archived; sector is explicitly unknown and tags remain empty.' : null };
    saveReceipt();
  }
  console.log('Published source books and byte-identical JPGs copied.');

  // Frozen packages reference identities that predated the backfill. Recover only
  // those missing identities from archived holding rows/catalogue, never values.
  const supplied = new Set<string>();
  const identities = new Map<string, any>();
  for (const { pack } of packages) for (const chunk of pack.chunks) for (const fact of chunk.facts) {
    const d = fact.data;
    if (fact.kind === 'security') supplied.add(d.securityId);
    if (fact.kind === 'holding' && !identities.has(d.securityId)) identities.set(d.securityId, { securityId: d.securityId, name: d.sourceName,
      identifiers: [{ code: d.sourceCode, market: d.sourceMarket, validFrom: '2025-12-31', validTo: null }], historicalMarketUnverified: true,
      localIdentityRecoveryBasis: 'Identifier/name from retained issuer holding row; not a recovered cloud master or listing date.' });
  }
  const catalog = readJson(resolve(etfRoot, 'existing-catalog.json'));
  const bootstrap: any[] = [];
  for (const [id, data] of identities) if (!supplied.has(id)) bootstrap.push({ kind: 'security', data });
  for (const fund of catalog.funds) {
    bootstrap.push({ kind: 'fund', data: { ...fund, issuer: '來源未記錄', domesticEquity: true, localIdentityRecoveryBasis: 'Retained cloud public catalogue; issuer field not archived.' } });
    bootstrap.push({ kind: 'security', data: { securityId: fund.securityId, name: fund.name,
      identifiers: [{ code: fund.code, market: 'TWSE', validFrom: '2025-12-31', validTo: null }], historicalMarketUnverified: true,
      localIdentityRecoveryBasis: 'Retained catalogue identifier; validFrom is an archive bound, not listing date.' } });
  }
  result.recoveredIdentityCount = bootstrap.length;
  for (let dayIndex = 0; dayIndex < packages.length; dayIndex++) {
    const source = packages[dayIndex]; const day = source.receipt.date;
    const recovered = result.etf[day];
    if (recovered) {
      if (recovered.sourceHash !== source.sourceHash) throw Error('Frozen source changed after prior local import: ' + day);
      const head = await store.getHead('tw-active-equity', day);
      if (head?.publicationId !== recovered.localPublicationId) throw Error('Local published data changed; leaving it untouched: ' + day);
      continue;
    }
    const pack = structuredClone(source.pack);
    if (dayIndex === 0) {
      const facts = [...bootstrap, ...pack.chunks.flatMap((chunk: any) => chunk.facts)];
      pack.chunks = [];
      for (let i = 0; i < facts.length; i += 80) pack.chunks.push({ facts: facts.slice(i, i + 80) });
      pack.manifest.chunkCount = pack.chunks.length;
      for (const fact of bootstrap) pack.manifest.expectedCounts[fact.kind] = (pack.manifest.expectedCounts[fact.kind] || 0) + 1;
    }
    const rid = (step: string, revision = 0) => `local-recover-v1-${day}-${step}-${revision}`;
    let batch = (await store.createBatch({ requestId: rid('create'), manifest: pack.manifest })).batch;
    for (let i = 0; i < pack.chunks.length; i++) {
      if (batch.receivedChunks.includes(i)) continue;
      batch = (await store.uploadChunk(batch.id, { requestId: rid('chunk' + i, batch.revision), expectedRevision: batch.revision, chunkNo: i, facts: pack.chunks[i].facts })).batch;
    }
    if (!['ready', 'reviewed', 'published'].includes(batch.status)) batch = (await store.validateBatch(batch.id, { requestId: rid('validate', batch.revision), expectedRevision: batch.revision })).batch;
    if (!batch.validation?.complete || batch.validation.blockingErrors.length) throw Error('Validation failed for ' + day + ': ' + JSON.stringify(batch.validation?.blockingErrors));
    const validation = batch.validation;
    // Some retained packages deduplicate shared source facts differently from
    // their earlier cloud receipt. Verify financial counts and warnings; retain
    // both review hashes rather than claiming a byte-identical database clone.
    for (const kind of ['holding', 'metrics', 'change']) {
      if ((source.receipt.validatedCounts?.[kind] || 0) !== (batch.validation.counts[kind as 'holding'] || 0)) throw Error('Financial record count differs from cloud receipt: ' + day + '/' + kind);
    }
    if (JSON.stringify(source.receipt.warnings) !== JSON.stringify(batch.validation.warnings)) throw Error('Data warnings differ from the published receipt: ' + day);
    if (batch.status === 'ready') batch = (await store.reviewBatch(batch.id, { requestId: rid('review', batch.revision), expectedRevision: batch.revision, reviewHash: batch.validation.reviewHash, acknowledged: true })).batch;
    let localPublicationId = batch.publicationId;
    if (batch.status !== 'published') {
      if (await store.getHead('tw-active-equity', day)) throw Error('Existing local date is preserved: ' + day);
      localPublicationId = (await store.publishBatch(batch.id, { requestId: rid('publish', batch.revision), expectedRevision: batch.revision,
        reviewHash: batch.reviewedPayloadHash, expectedHeadVersion: 0, confirmed: true })).publicationId ?? null;
    }
    if (!localPublicationId) throw Error('Local publication was not confirmed: ' + day);
    result.etf[day] = { source: source.source, sourceHash: source.sourceHash, cloudPublicationId: source.receipt.publicationId, localPublicationId,
      holdingCount: source.pack.manifest.expectedCounts.holding || 0, cloudReviewHash: source.receipt.reviewHash,
      localReviewHash: validation.reviewHash, reviewHashMatchesCloud: source.receipt.reviewHash === validation.reviewHash,
      financialCountsMatchCloudReceipt: true, identityBootstrapAdded: dayIndex === 0 };
    saveReceipt();
    if (dayIndex % 15 === 0 || dayIndex === packages.length - 1) console.log(`ETF dates recovered: ${dayIndex + 1}/${packages.length}`);
  }

  // Source snapshot includes a complete legacy report. Restore it as one local
  // version; cloud v2/v3 snapshots cannot be reconstructed from source alone.
  if (!result.report) {
    const { seedReport } = await import('../shared/etf-seed.ts');
    const { makeEtfRoutes } = await import('../backend/etf-reports.ts');
    if ((await db.get('etf_reports_v1', [seedReport.id]))[0]) throw Error('Existing report is preserved; cannot restore the source report over it.');
    const routes = makeEtfRoutes({ requireAdmin: async () => ({ id: 'local-offline-import' }), isSameOriginMutation: () => true });
    async function offlineRoute(name: string, body: any) {
      const ctx: any = { body, params: {}, query: {}, event: {} };
      for (const handle of routes[name]) { const response = await handle(ctx); if (response) { if (response.statusCode >= 400) throw Error(response.body); return JSON.parse(response.body); } }
      throw Error('No import route response.');
    }
    await offlineRoute('POST /api/admin/etf-reports/save', { report: seedReport, baseRevision: 0, requestId: 'local-restore-source-report-save-v1' });
    await offlineRoute('POST /api/admin/etf-reports/publish', { id: seedReport.id, baseRevision: 1, requestId: 'local-restore-source-report-publish-v1', reviewed: true });
    result.report = { id: seedReport.id, localVersion: 1, source: 'shared/etf-seed.ts', sourceHash: digest(readFileSync('shared/etf-seed.ts')), cloudVersionParity: false };
  }
  result.inventory = inventory;
  result.completedAt = new Date().toISOString();
  saveReceipt();
  console.log(JSON.stringify({ completed: true, ...inventory, backupPath: backupRoot, receiptPath }));
} finally { db.close(); }
