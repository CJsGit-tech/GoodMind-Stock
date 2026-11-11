import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';

// Run against downloaded AppDeploy backend source with Node 24+.
// Supply the backend directory as the first argument; no live service is called.
const sourceDirectory = resolve(process.argv[2] ?? 'backend');
const sources = file =>
  stripTypeScriptTypes(readFileSync(resolve(sourceDirectory, file), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
    .replace(/\bexport /g, '');
const tables = new Map();
const operations = [];
let sequence = 0;
let fault = null;
const table = name => {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
};
const db = {
  async list(name, options = {}) {
    operations.push(['list', name, options]);
    if (fault?.('list', name)) throw new Error('injected list failure');
    const rows = [...table(name)].map(([id, record]) => ({
      ...structuredClone(record),
      id,
    }));
    const start = Number(options.nextToken ?? 0);
    const size = options.limit ?? 20;
    return {
      items: rows.slice(start, start + size),
      nextToken: start + size < rows.length ? String(start + size) : undefined,
    };
  },
  async add(name, records) {
    operations.push(['add', name]);
    if (fault?.('add', name)) return records.map(() => null);
    return records.map(record => {
      const id = 'record-' + ++sequence;
      table(name).set(id, structuredClone(record));
      return id;
    });
  },
  async get(name, ids) {
    operations.push(['get', name, ids]);
    return ids.map(id => structuredClone(table(name).get(id) ?? null));
  },
  async update(name, records) {
    operations.push(['update', name]);
    if (fault?.('update', name)) return records.map(() => false);
    return records.map(({ id, record }) => {
      if (!table(name).has(id)) return false;
      table(name).set(id, structuredClone(record));
      return true;
    });
  },
  async delete(name, ids) {
    return ids.map(id => table(name).delete(id));
  },
};
function evaluate(file, dependencies, names, transform = value => value) {
  return new Function(
    ...Object.keys(dependencies),
    transform(sources(file)) + '\nreturn {' + names.join(',') + '};'
  )(...Object.values(dependencies));
}
const indexed = evaluate('reader-collection-index.ts', { db }, [
  'readCollectionArticlePage',
  'rememberCollectionArticle',
]);
const security = evaluate('admin-session-security.ts', {}, [
  'inspectAttemptTimes',
  'isBlankSecret',
  'isSameOriginMutation',
  'isStaleSession',
  'parseSessionToken',
  'secureEqual',
]);
security.isTrustedAdminMutation = security.isSameOriginMutation;
const publicBook = evaluate('public-book.ts', {}, [
  'createPublicPageManifest',
  'isPublicAssetUrl',
  'orderPublishedBookPages',
  'preparePublicBookPages',
  'selectPublishedBookCover',
]);
const json = (data, statusCode = 200) => ({
  statusCode,
  body: JSON.stringify(data),
  headers: {},
});
const error = (message, statusCode) => json({ error: message }, statusCode);
const backend = evaluate(
  'index.ts',
  {
    db,
    error,
    json,
    // These suites own collection logic; ETF suites exercise the separate routes.
    makeEtfRoutes: () => ({}),
    makeEtfMarkdownRoutes: () => ({}),
    makeInstitutionalRoutes: () => ({}),
    makeInvestmentCalendarRoutes: () => ({}),
    makeEtfDataRoutes: () => ({}),
    makeEtfSnapshotRoutes: () => ({}),
    prepareEtfReportCommit: () => { throw new Error('ETF commit is outside this fixture.'); },
    router: routes => routes,
    requireAuth:
      () =>
      async ({ user }) =>
        user ? undefined : error('Authentication required.', 401),
    secrets: {},
    storage: {
      url: async paths =>
        paths.map(path => ({ path, url: 'https://test.invalid/' + path })),
    },
    ...security,
    ...publicBook,
    ...indexed,
  },
  [
    'handler',
    'listArticles',
    'listReaderFavorites',
    'listReaderReviews',
    'favoritesTable',
    'reviewsTable',
  ],
  source =>
    source.replace(
      'let seedMaintenanceAttempted = false;',
      'let seedMaintenanceAttempted = true;'
    )
);
const now = '2026-10-06T00:00:00.000Z';
const article = (id, published = true) => ({
  title: 'Fixture research',
  summary: 'Fixture summary',
  sector: 'Fixture',
  tags: ['Fixture'],
  publicationDate: '2026-10-06',
  published,
  coverPageId: 'page-1',
  pages: [
    {
      id: 'page-1',
      order: 0,
      title: 'Fixture page',
      altText: 'Fixture art',
      storagePath: 'articles/' + id + '/page.jpg',
    },
  ],
  createdAt: now,
  updatedAt: now,
});
for (let i = 0; i < 105; i += 1)
  table('articles').set('book-' + i, article('book-' + i, i !== 104));
for (const id of ['book-0', 'book-25', 'book-101', 'book-104']) {
  await db.add(await backend.favoritesTable(id), [
    {
      appUserId: 'reader-a',
      readerId: 'legacy',
      articleId: id,
      createdAt: now,
    },
  ]);
  await db.add(await backend.reviewsTable(id), [
    {
      appUserId: 'reader-a',
      readerId: 'legacy',
      reviewId: 'review-' + id,
      articleId: id,
      text: 'Private fixture',
      version: 1,
      baseVersion: 0,
      mutationId: 'fixture-save-' + id,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}
await db.add(await backend.favoritesTable('book-3'), [
  { appUserId: 'reader-b', articleId: 'book-3', createdAt: now },
]);
async function collect(read, field) {
  const result = new Map();
  let cursor;
  for (let requests = 0; requests < 100; requests += 1) {
    const page = await read(cursor);
    if (page.migrationPending) continue;
    for (const item of page[field]) result.set(item.articleId ?? item.id, item);
    if (!page.nextToken) return [...result.values()];
    cursor = page.nextToken;
  }
  throw new Error('Pagination did not finish');
}
const publicItems = await collect(
  nextToken => backend.listArticles(false, { nextToken }),
  'articles'
);
assert.equal(publicItems.length, 104);
assert(publicItems.some(book => book.id === 'book-101'));
const adminItems = await collect(
  nextToken => backend.listArticles(true, { nextToken }),
  'articles'
);
assert.equal(adminItems.length, 105);

for (let i = 0; i < 35; i += 1) {
  const id = 'book-' + i;
  await db.add(await backend.favoritesTable(id), [
    { appUserId: 'reader-many', articleId: id, createdAt: now },
  ]);
  await db.add(await backend.reviewsTable(id), [
    {
      appUserId: 'reader-many',
      articleId: id,
      reviewId: 'many-' + id,
      text: 'Private many-page fixture',
      version: 1,
      baseVersion: 0,
      mutationId: 'many-save-' + id,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}
assert.equal(
  (
    await collect(
      cursor => backend.listReaderFavorites('reader-many', cursor),
      'favorites'
    )
  ).length,
  35
);
assert.equal(
  (
    await collect(
      cursor => backend.listReaderReviews('reader-many', cursor),
      'reviews'
    )
  ).length,
  35
);
const firstBatch = await backend.listReaderFavorites('reader-a');
assert(firstBatch.migrationPending);
assert.equal(firstBatch.migrationProgress, 1);
let once = true;
fault = (op, name) =>
  op === 'update' &&
  name.endsWith(':migration') &&
  once &&
  ((once = false), true);
await assert.rejects(backend.listReaderFavorites('reader-a'));
fault = null;
const favorites = await collect(
  cursor => backend.listReaderFavorites('reader-a', cursor),
  'favorites'
);
assert.deepEqual(favorites.map(item => item.articleId).sort(), [
  'book-0',
  'book-101',
  'book-25',
]);
const reviews = await collect(
  cursor => backend.listReaderReviews('reader-a', cursor),
  'reviews'
);
assert.equal(reviews.length, 3);
operations.length = 0;
await collect(
  cursor => backend.listReaderFavorites('reader-a', cursor),
  'favorites'
);
assert(!operations.some(([op, name]) => op === 'list' && name === 'articles'));
assert.equal(
  operations.filter(
    ([op, name]) => op === 'list' && name.startsWith('favorites:')
  ).length,
  3
);
table('articles').get('book-104').published = true;
assert.equal(
  (
    await collect(
      cursor => backend.listReaderReviews('reader-a', cursor),
      'reviews'
    )
  ).length,
  4
);
table('articles').get('book-25').published = false;
table(await backend.favoritesTable('book-25')).clear();
table('articles').get('book-25').published = true;
assert(
  !(
    await collect(
      cursor => backend.listReaderFavorites('reader-a', cursor),
      'favorites'
    )
  ).some(item => item.articleId === 'book-25')
);
table('articles').delete('book-101');
assert(
  !(
    await collect(
      cursor => backend.listReaderReviews('reader-a', cursor),
      'reviews'
    )
  ).some(item => item.articleId === 'book-101')
);
const tombstones = table(await backend.reviewsTable('book-0'));
for (const record of tombstones.values()) {
  record.deleted = true;
  record.text = '';
}
assert(
  !(
    await collect(
      cursor => backend.listReaderReviews('reader-a', cursor),
      'reviews'
    )
  ).some(item => item.articleId === 'book-0')
);
const other = await collect(
  cursor => backend.listReaderFavorites('reader-b', cursor),
  'favorites'
);
assert.deepEqual(
  other.map(item => item.articleId),
  ['book-3']
);
await Promise.all([
  indexed.rememberCollectionArticle('favorites', 'reader-c', 'book-3'),
  indexed.rememberCollectionArticle('favorites', 'reader-c', 'book-3'),
]);
const emptyC = await collect(
  cursor => backend.listReaderFavorites('reader-c', cursor),
  'favorites'
);
assert.equal(emptyC.length, 0);
fault = (op, name) => op === 'add' && name.startsWith('reader-index-v1:');
const context = {
  user: { userId: 'reader-d', scope: 'profile', name: 'Fixture' },
  params: { articleId: 'book-3' },
  query: {},
};
const put = backend.handler['PUT /api/reader/favorites/:articleId'].at(-1);
assert.equal((await put(context)).statusCode, 500);
assert(
  ![...table(await backend.favoritesTable('book-3')).values()].some(
    row => row.appUserId === 'reader-d'
  )
);
fault = null;
assert.equal((await put(context)).statusCode, 200);
assert.equal(
  (
    await collect(
      cursor => backend.listReaderFavorites('reader-d', cursor),
      'favorites'
    )
  ).length,
  1
);
const reviewPut = backend.handler['PUT /api/reader/reviews/:articleId'].at(-1);
fault = (op, name) => op === 'add' && name.startsWith('reader-index-v1:');
assert.equal(
  (
    await reviewPut({
      ...context,
      user: { userId: 'reader-e', scope: '' },
      body: {
        text: 'Isolated test',
        baseVersion: 0,
        baseUpdatedAt: null,
        mutationId: 'isolated-mutation-e',
      },
    })
  ).statusCode,
  500
);
assert(
  ![...table(await backend.reviewsTable('book-3')).values()].some(
    row => row.appUserId === 'reader-e'
  )
);
fault = null;
assert.equal(
  (await backend.handler['GET /api/reader/favorites'][0]({})).statusCode,
  401
);

fault = (op, name) => {
  if (op === 'list' && name === 'articles')
    throw Object.assign(new Error('Quota reached'), {
      code: 'AppDatabaseQuotaExceeded',
      statusCode: 429,
    });
  return false;
};
const quota = await backend.handler['GET /api/articles'][0]({ query: {} });
assert.equal(quota.statusCode, 429);
assert(JSON.parse(quota.body).error.includes('AppDatabaseQuotaExceeded'));
fault = null;
console.log(
  'PASS: 105-book public/admin pagination; resumable backfill/checkpoint failure; warm indexed reads; ownership; retained unpublished review; removed favorite non-restoration; tombstone/deleted book omission; concurrent pointers; favorite/review index-before-write failures; favorite retry; anonymous denial.'
);
const reviewContext = {
  user: { userId: 'reader-delete', scope: '' },
  params: { articleId: 'book-3' },
  query: {},
};
const reviewGet = backend.handler['GET /api/reader/reviews/:articleId'].at(-1);
const reviewDelete =
  backend.handler['POST /api/reader/reviews/:articleId/delete'].at(-1);
assert.equal(
  (await backend.handler['POST /api/reader/reviews/:articleId/delete'][0]({}))
    .statusCode,
  401
);
assert.equal(
  (await reviewDelete({ ...reviewContext, body: undefined })).statusCode,
  400
);
const created = await reviewPut({
  ...reviewContext,
  body: {
    text: 'Disposable deletion fixture',
    baseVersion: 0,
    baseUpdatedAt: null,
    mutationId: 'delete-fixture-create',
  },
});
assert.equal(created.statusCode, 200);
const savedSlot = JSON.parse(created.body);
const deletionBody = {
  baseVersion: savedSlot.revision.version,
  baseUpdatedAt: savedSlot.revision.updatedAt,
  mutationId: 'delete-fixture-confirm',
};
const staleDelete = await reviewDelete({
  ...reviewContext,
  body: {
    ...deletionBody,
    baseVersion: 0,
    baseUpdatedAt: null,
    mutationId: 'delete-fixture-stale',
  },
});
assert.equal(staleDelete.statusCode, 409);
assert.equal(
  JSON.parse((await reviewGet(reviewContext)).body).review.text,
  'Disposable deletion fixture'
);
const deleted = await reviewDelete({ ...reviewContext, body: deletionBody });
assert.equal(deleted.statusCode, 200);
const deletedSlot = JSON.parse(deleted.body);
assert.equal(deletedSlot.deleted, true);
assert.equal(deletedSlot.review, null);
assert.equal(deletedSlot.revision.version, savedSlot.revision.version + 1);
const repeated = await reviewDelete({ ...reviewContext, body: deletionBody });
assert.equal(repeated.statusCode, 200);
assert.deepEqual(JSON.parse(repeated.body), deletedSlot);
assert.equal(JSON.parse((await reviewGet(reviewContext)).body).review, null);
assert.equal(
  (
    await collect(
      cursor => backend.listReaderReviews('reader-delete', cursor),
      'reviews'
    )
  ).length,
  0
);
assert(
  (
    await collect(
      cursor => backend.listReaderReviews('reader-many', cursor),
      'reviews'
    )
  ).some(review => review.articleId === 'book-3')
);
const legacyDelete =
  backend.handler['DELETE /api/reader/reviews/:articleId'].at(-1);
assert.equal(
  (await legacyDelete({ ...reviewContext, body: deletionBody })).statusCode,
  200
);
console.log(
  'PASS: POST versioned review deletion, missing input/anonymous denial, stale conflict, durable omission, idempotent retry, other-reader isolation and legacy DELETE compatibility.'
);
