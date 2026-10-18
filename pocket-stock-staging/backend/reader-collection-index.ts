import { db } from '@appdeploy/sdk';

type CollectionKind = 'favorites' | 'reviews' | 'comments';
type IndexEntry = { userId: string; articleId: string };
type MigrationState = {
  userId: string;
  nextToken?: string;
  complete: boolean;
  pages: number;
};
type LegacyPage = { articleIds: string[]; nextToken?: string };
const PAGE_SIZE = 20;
const migrationRequests = new Map<string, Promise<MigrationState>>();

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(bytes), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function indexTable(kind: CollectionKind, userId: string) {
  return `reader-index-v1:${kind}:${await digest(userId)}`;
}

export async function rememberCollectionArticle(
  kind: CollectionKind,
  userId: string,
  articleId: string
) {
  const table = await indexTable(kind, userId);
  const entryTable = `${table}:entry:${await digest(articleId)}`;
  const { items } = await db.list<IndexEntry & { indexId: string }>(
    entryTable,
    { limit: 1 }
  );
  const entry = items[0];
  if (
    entry?.userId === userId &&
    entry.articleId === articleId &&
    entry.indexId
  )
    return;
  // Persist discovery before the canonical write. A partial failure can leave a
  // harmless extra pointer, but must never leave a saved relation undiscoverable.
  const [indexId] = await db.add(table, [{ userId, articleId }]);
  if (!indexId) throw new Error('Unable to index reader collection.');
  const [markerId] = await db.add(entryTable, [{ userId, articleId, indexId }]);
  if (!markerId) throw new Error('Unable to confirm reader collection index.');
}

async function advanceMigration(
  table: string,
  kind: CollectionKind,
  userId: string,
  readLegacyPage: (nextToken?: string) => Promise<LegacyPage>
): Promise<MigrationState> {
  const stateTable = `${table}:migration`;
  const result = await db.list<MigrationState>(stateTable, {
    limit: PAGE_SIZE,
  });
  if (result.nextToken)
    throw new Error('Reader index migration requires reconciliation.');
  const states = result.items
    .filter(state => state.userId === userId)
    .sort(
      (left, right) =>
        Number(right.complete) - Number(left.complete) ||
        right.pages - left.pages
    );
  const existing = states[0];
  if (existing?.complete) return existing;
  const page = await readLegacyPage(existing?.nextToken);
  for (const articleId of new Set(page.articleIds)) {
    await rememberCollectionArticle(kind, userId, articleId);
  }
  const state: MigrationState = {
    userId,
    ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    complete: !page.nextToken,
    pages: (existing?.pages ?? 0) + 1,
  };
  // Checkpoint only after every pointer is durable. Failed batches are replayable.
  if (existing) {
    const [updated] = await db.update(stateTable, [
      { id: existing.id, record: { ...state } },
    ]);
    if (!updated)
      throw new Error('Unable to checkpoint reader index migration.');
  } else {
    const [id] = await db.add(stateTable, [{ ...state }]);
    if (!id) throw new Error('Unable to checkpoint reader index migration.');
  }
  return state;
}

export async function readCollectionArticlePage(
  kind: CollectionKind,
  userId: string,
  nextToken: string | undefined,
  readLegacyPage: (nextToken?: string) => Promise<LegacyPage>
) {
  const table = await indexTable(kind, userId);
  let migration = migrationRequests.get(table);
  if (!migration) {
    migration = advanceMigration(table, kind, userId, readLegacyPage);
    migrationRequests.set(table, migration);
  }
  let state: MigrationState;
  try {
    state = await migration;
  } finally {
    if (migrationRequests.get(table) === migration)
      migrationRequests.delete(table);
  }
  if (!state.complete) {
    return {
      articleIds: [],
      migrationPending: true,
      migrationProgress: state.pages,
    };
  }
  const page = await db.list<IndexEntry>(table, {
    limit: PAGE_SIZE,
    ...(nextToken ? { nextToken } : {}),
  });
  // Pointers are discovery hints only. Callers re-read current publication and
  // canonical ownership; retained pointers cannot resurrect deleted relations.
  return {
    articleIds: [
      ...new Set(
        page.items
          .filter(entry => entry.userId === userId)
          .map(entry => entry.articleId)
      ),
    ],
    nextToken: page.nextToken,
    migrationPending: false,
    migrationProgress: state.pages,
  };
}
