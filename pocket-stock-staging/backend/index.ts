import {
  auth,
  db,
  error,
  json,
  requireAuth,
  router,
  secrets,
  storage,
} from '@appdeploy/sdk';
import {
  listAuthorReaderForms,
  parseReaderForm,
  readReaderForm,
  saveReaderForm,
} from './reader-forms.ts';
import type { AuthUser, RouterContext } from '@appdeploy/sdk';
import { makeEtfRoutes } from './etf-reports.ts';
import { makeEtfMarkdownRoutes } from './etf-markdown.ts';
import { makeEtfDataRoutes } from './etf-data.ts';
import { makeEtfSnapshotRoutes, prepareEtfReportCommit } from './etf-data-snapshots.ts';
import {
  readCollectionArticlePage,
  rememberCollectionArticle,
} from './reader-collection-index.ts';
import {
  inspectAttemptTimes,
  isBlankSecret,
  isSameOriginMutation as isTrustedAdminMutation,
  isStaleSession,
  parseSessionToken,
  secureEqual,
} from './admin-session-security.ts';
import {
  createPublicPageManifest,
  isPublicAssetUrl,
  orderPublishedBookPages,
  preparePublicBookPages,
  selectPublishedBookCover,
} from './public-book.ts';

const ARTICLES_TABLE = 'articles';
const SESSIONS_TABLE = 'admin-sessions';
const READER_PROFILE_TABLE_PREFIX = 'reader-profiles';
const ARTICLE_DELETION_CLEANUP_TABLE_PREFIX = 'article-deletion-cleanup';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_ARTICLES = 100;
const COLLECTION_PAGE_SIZE = 20;
const MAX_COMMENTS = 100;
const COMMENT_DISPLAY_NAME_MAX_CODE_POINTS = 50;
const COMMENT_BODY_MAX_CODE_POINTS = 1_000;
const MAX_PAGES = 80;
const MAX_IMAGE_BYTES = 7_500_000;
const ADMIN_COOKIE_NAME = 'pocketstocks_staging_admin';
const ADMIN_FRONTEND_ORIGIN = process.env.POCKETSTOCKS_LOCAL_ORIGIN || 'https://pocketstocks-staging-3nv7e2.v2.appdeploy.ai';
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;
const LOGIN_ATTEMPT_READ_LIMIT = 40;
const SESSION_CLEANUP_LIMIT = 50;
const COMMENT_DELETE_PAGE_SIZE = 100;
const COMMENT_DELETE_PAGE_LIMIT = 10;
const READER_PROFILE_READ_LIMIT = 20;
const READER_PROFILE_RECONCILIATION_LIMIT = 5;
const FAVORITE_READ_PAGE_SIZE = 100;
const FAVORITE_READ_PAGE_LIMIT = 10;
const FAVORITE_RECONCILIATION_LIMIT = 5;
const REVIEW_READ_PAGE_SIZE = 100;
const REVIEW_READ_PAGE_LIMIT = 10;
const REVIEW_RECONCILIATION_LIMIT = 5;
const DELETION_CLEANUP_RECORD_LIMIT = 3;
const REVIEW_MAX_CODE_POINTS = 2_000;
const SAMPLE_ART_WIDTH = 1200;
const SAMPLE_ART_HEIGHT = (SAMPLE_ART_WIDTH / 2) * 3;
const SAMPLE_SEED_VERSION = 'v3';
const SEED_MAINTENANCE_READ_PAGE_LIMIT = 5;
const LEGACY_GENERATED_SEED_PAGE_PATH =
  /^seed\/(\d{13}-[A-Za-z0-9_-]{8})\/page-(\d+)\.svg$/;
const GENERATED_V3_SEED_PAGE_PATH =
  /^seed\/v3\/(\d{13}-[A-Za-z0-9_-]{8})\/page-(\d+)\.svg$/;
let seedMaintenanceAttempted = false;

interface PageDescriptor {
  id: string;
  order: number;
  title: string;
  altText: string;
  storagePath: string;
}

interface SeedArticleSample {
  title: string;
  summary: string;
  sector: string;
  tags: string[];
  publicationDate: string;
  accent: string;
  pages: Array<[string, string, string, string]>;
}

const SAMPLE_ARTICLES: SeedArticleSample[] = [
  {
    title: 'AI 伺服器供應鏈：從成長敘事回到獲利品質',
    summary: '拆解台灣 AI 伺服器供應鏈的成長來源、毛利結構與接單能見度。',
    sector: '電子零組件',
    tags: ['AI 伺服器', '供應鏈', '獲利品質'],
    publicationDate: '2026-09-18',
    accent: '#C65A2E',
    pages: [
      [
        'SECTOR NOTE 01',
        '成長不只看營收',
        '+28%',
        '觀察營收增速之外，也要確認產品組合、良率與議價能力能否推升毛利。',
      ],
      [
        'EARNINGS LENS',
        '三個追蹤指標',
        '3',
        '訂單能見度、資本支出紀律、自由現金流，是判斷成長品質的三個核心訊號。',
      ],
    ],
  },
  {
    title: '先進封裝：產能擴張之後的關鍵變數',
    summary:
      '用產能、資本支出與客戶集中度三條線，理解先進封裝產業的機會與風險。',
    sector: '半導體',
    tags: ['先進封裝', '資本支出', '半導體'],
    publicationDate: '2026-09-12',
    accent: '#2C6E85',
    pages: [
      [
        'INDUSTRY NOTE 02',
        '供給擴張的節奏',
        '2.4×',
        '擴產速度若快於終端需求，設備利用率與折舊壓力將成為下一階段的觀察重點。',
      ],
      [
        'RISK MAP',
        '需求與集中度',
        'Top 3',
        '比較主要客戶占比與應用分散度，確認成長是否建立在可持續的需求基礎上。',
      ],
    ],
  },
  {
    title: '金融股觀察：利差、手續費與資產品質',
    summary: '以三個可比較的營運槓桿，建立閱讀台灣金融股財報的簡明框架。',
    sector: '金融業',
    tags: ['金融股', '利差', '資產品質'],
    publicationDate: '2026-09-05',
    accent: '#567568',
    pages: [
      [
        'COMPANY LENS 03',
        '獲利來源要分開看',
        '3',
        '淨利差、財富管理手續費與信用成本，分別反映不同的景氣與經營能力。',
      ],
      [
        'BALANCE SHEET',
        '先守住資產品質',
        '<1%',
        '成長之外，逾放比、覆蓋率與資本適足率決定金融股能否承受下一次景氣波動。',
      ],
    ],
  },
];

interface SampleSeedPathFamily {
  kind: 'current-v3' | 'legacy-generated';
  root: string;
}

interface ArticleRecord {
  title: string;
  summary: string;
  sector: string;
  tags: string[];
  publicationDate: string;
  published: boolean;
  pages: PageDescriptor[];
  coverPageId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommentRecord {
  appUserId?: string;
  articleId: string;
  displayName: string;
  body: string;
  createdAt: string;
}

type StoredCommentRecord = CommentRecord & { id: string };

interface SessionRecord {
  tokenHash: string;
  expiresAt: number;
  revoked: boolean;
  createdAt: string;
}

interface LoginAttemptRecord {
  attemptedAt: number;
}

interface ReaderProfileRecord {
  appUserId: string;
  readerId: string;
  name?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

interface FavoriteRecord {
  appUserId: string;
  readerId: string;
  articleId: string;
  createdAt: string;
}

interface ReviewRecord {
  appUserId: string;
  readerId: string;
  reviewId: string;
  articleId: string;
  text: string;
  version: number;
  baseVersion: number;
  mutationId: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ArticleDeletionCleanupRecord {
  articleId: string;
  storagePaths: string[];
  createdAt: string;
}

interface ArticleInput {
  title?: unknown;
  summary?: unknown;
  sector?: unknown;
  tags?: unknown;
  publicationDate?: unknown;
  pages?: unknown;
  coverPageId?: unknown;
  baseUpdatedAt?: unknown;
}

interface PageUploadInput {
  content?: unknown;
  contentType?: unknown;
  title?: unknown;
  altText?: unknown;
}

type StoredArticle = ArticleRecord & { id: string };
type PublicArticleRecord = ArticleRecord & { id: string; published: true };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function nextUpdatedAt(previous?: string): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(
    Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)
  ).toISOString();
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map(tag => cleanText(tag, 40)).filter(Boolean)),
  ].slice(0, 12);
}

function isPublicationDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function readExactPublicText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
    ? value
    : null;
}

function isPublicArticleId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\u0000-\u001F\u007F?#]/.test(value)
  );
}

function readPublicTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const tags = value.map(tag => readExactPublicText(tag, 40));
  return tags.every((tag): tag is string => tag !== null) ? tags : null;
}

function readPublicTimestamp(value: unknown): string | null {
  const timestamp = readExactPublicText(value, 40);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

const UNSAFE_COMMENT_CONTROLS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const UNSAFE_COMMENT_DISPLAY_NAME_CONTROLS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

function normalizeCommentText(
  value: unknown,
  maxCodePoints: number,
  controls: RegExp
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (
    !normalized ||
    Array.from(normalized).length > maxCodePoints ||
    controls.test(normalized)
  )
    return null;
  return normalized;
}

function readPublicComment(
  articleId: string,
  value: unknown
): StoredCommentRecord | null {
  const record = asObject(value);
  if (
    !record ||
    record.articleId !== articleId ||
    typeof record.id !== 'string' ||
    !isPublicArticleId(record.id)
  )
    return null;
  const displayName = normalizeCommentText(
    record.displayName,
    COMMENT_DISPLAY_NAME_MAX_CODE_POINTS,
    UNSAFE_COMMENT_DISPLAY_NAME_CONTROLS
  );
  const body = normalizeCommentText(
    record.body,
    COMMENT_BODY_MAX_CODE_POINTS,
    UNSAFE_COMMENT_CONTROLS
  );
  const createdAt = readPublicTimestamp(record.createdAt);
  if (!displayName || !body || !createdAt) return null;
  return { id: record.id, articleId, displayName, body, createdAt };
}

function hasSafePublicStoragePath(
  articleId: string,
  storagePath: string,
  canonicalSeedPaths: ReadonlySet<string> | null
): boolean {
  if (
    /[?#]/.test(storagePath) ||
    !storagePath
      .split('/')
      .every(segment => segment !== '' && segment !== '.' && segment !== '..')
  ) {
    return false;
  }
  return (
    storagePath.startsWith(`articles/${articleId}/`) ||
    canonicalSeedPaths?.has(storagePath) === true
  );
}

function readPublicArticle(
  articleId: unknown,
  value: unknown
): PublicArticleRecord | null {
  if (!isPublicArticleId(articleId)) return null;
  const article = asObject(value);
  if (!article || article.published !== true) return null;

  const title = readExactPublicText(article.title, 160);
  const summary = readExactPublicText(article.summary, 1000);
  const sector = readExactPublicText(article.sector, 80);
  const tags = readPublicTags(article.tags);
  const publicationDate = readExactPublicText(article.publicationDate, 10);
  const createdAt = readPublicTimestamp(article.createdAt);
  const updatedAt = readPublicTimestamp(article.updatedAt);
  const pages =
    Array.isArray(article.pages) && article.pages.length <= MAX_PAGES
      ? preparePublicBookPages(article.pages)
      : null;
  if (
    !title ||
    !summary ||
    !sector ||
    !tags ||
    !publicationDate ||
    !isPublicationDate(publicationDate) ||
    !createdAt ||
    !updatedAt ||
    !pages
  ) {
    return null;
  }

  const coverPageId =
    typeof article.coverPageId === 'string' &&
    pages.some(page => page.id === article.coverPageId)
      ? article.coverPageId
      : null;
  const publicArticle: PublicArticleRecord = {
    id: articleId,
    title,
    summary,
    sector,
    tags,
    publicationDate,
    published: true,
    pages,
    coverPageId,
    createdAt,
    updatedAt,
  };
  const canonicalSeedPaths = canonicalSeedPagePaths(articleId, publicArticle);
  return pages.every(page =>
    hasSafePublicStoragePath(articleId, page.storagePath, canonicalSeedPaths)
  )
    ? publicArticle
    : null;
}

function readPageDescriptors(
  value: unknown,
  existingPages?: PageDescriptor[]
): PageDescriptor[] | null {
  if (!Array.isArray(value) || value.length > MAX_PAGES) return null;
  if (!existingPages && value.length > 0) return null;
  const existingById = new Map(
    (existingPages ?? []).map(page => [page.id, page])
  );
  const pages: PageDescriptor[] = [];

  for (const candidate of value) {
    const page = asObject(candidate);
    if (!page) return null;
    const id = cleanText(page.id, 100);
    const title = cleanText(page.title, 120);
    const altText = cleanText(page.altText, 500);
    const existingPage = existingById.get(id);
    const storagePath = existingPage?.storagePath ?? '';
    const order =
      typeof page.order === 'number' && Number.isInteger(page.order)
        ? page.order
        : pages.length;
    if (!id || !title || !altText || !storagePath || order < 0) return null;
    pages.push({ id, title, altText, storagePath, order });
  }

  if (new Set(pages.map(page => page.id)).size !== pages.length) return null;
  return pages
    .sort((left, right) => left.order - right.order)
    .map((page, order) => ({ ...page, order }));
}

function normalizeArticleInput(
  body: unknown,
  existing?: ArticleRecord
): ArticleRecord | string {
  const input = asObject(body) as ArticleInput | null;
  if (!input) return 'Request body must be an object.';

  const title =
    input.title === undefined && existing
      ? existing.title
      : cleanText(input.title, 160);
  const summary =
    input.summary === undefined && existing
      ? existing.summary
      : cleanText(input.summary, 1000);
  const sector =
    input.sector === undefined && existing
      ? existing.sector
      : cleanText(input.sector, 80);
  const publicationDate =
    input.publicationDate === undefined && existing
      ? existing.publicationDate
      : cleanText(input.publicationDate, 10);
  const tags =
    input.tags === undefined && existing ? existing.tags : readTags(input.tags);
  const pages =
    input.pages === undefined && existing
      ? existing.pages
      : readPageDescriptors(input.pages ?? [], existing?.pages);

  if (!title) return 'Title is required.';
  if (!summary) return 'Summary is required.';
  if (!sector) return 'Sector is required.';
  if (!isPublicationDate(publicationDate))
    return 'Publication date must use YYYY-MM-DD.';
  if (!pages) return 'Pages must be valid ordered page descriptors.';

  const suppliedCoverPageId =
    input.coverPageId === undefined
      ? undefined
      : cleanText(input.coverPageId, 100);
  if (
    suppliedCoverPageId &&
    !pages.some(page => page.id === suppliedCoverPageId)
  ) {
    return 'Cover page must belong to this article.';
  }
  const previousCoverPageId =
    existing?.coverPageId &&
    pages.some(page => page.id === existing.coverPageId)
      ? existing.coverPageId
      : null;
  const coverPageId =
    pages.length === 0
      ? null
      : suppliedCoverPageId || previousCoverPageId || pages[0].id;

  const now = new Date().toISOString();
  return {
    title,
    summary,
    sector,
    tags,
    publicationDate,
    pages,
    published: existing?.published ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    coverPageId,
  };
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function hasExpectedImageSignature(
  bytes: Uint8Array,
  contentType: string
): boolean {
  if (contentType === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (contentType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return (
      bytes.length >= signature.length &&
      signature.every((byte, index) => bytes[index] === byte)
    );
  }
  if (contentType === 'image/webp') {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const packed = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(packed >> 18) & 63];
    output += alphabet[(packed >> 12) & 63];
    output += second === undefined ? '=' : alphabet[(packed >> 6) & 63];
    output += third === undefined ? '=' : alphabet[packed & 63];
  }
  return output;
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function collectionFailure(caught: unknown, message: string) {
  const failure = asObject(caught);
  if (
    failure?.code === 'AppDatabaseQuotaExceeded' ||
    failure?.name === 'AppDatabaseQuotaExceeded' ||
    failure?.status === 429 ||
    failure?.statusCode === 429
  ) {
    return error(
      'AppDatabaseQuotaExceeded: Database quota exceeded. Please try again later.',
      429
    );
  }
  return error(message, 500);
}

function grantedScopes(user: AuthUser): Set<string> {
  return new Set(user.scope.split(/\s+/).filter(Boolean));
}

async function readerProfileTable(userId: string): Promise<string> {
  return `${READER_PROFILE_TABLE_PREFIX}:${await sha256(userId)}`;
}

async function listReaderProfiles(table: string, userId: string) {
  const { items, nextToken } = await db.list<ReaderProfileRecord>(table, {
    limit: READER_PROFILE_READ_LIMIT,
  });
  if (nextToken)
    throw new Error(
      'Reader profile reconciliation exceeded its bounded read limit.'
    );
  return items
    .filter(profile => profile.appUserId === userId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readerProfileFieldsMatch(
  profile: ReaderProfileRecord,
  readerId: string,
  name: string,
  email: string
): boolean {
  return (
    profile.readerId === readerId &&
    profile.name === (name || undefined) &&
    profile.email === (email || undefined)
  );
}

async function reconcileReaderProfile(
  table: string,
  userId: string,
  readerId: string,
  name: string,
  email: string
) {
  for (
    let attempt = 0;
    attempt < READER_PROFILE_RECONCILIATION_LIMIT;
    attempt += 1
  ) {
    const profiles = await listReaderProfiles(table, userId);
    const canonical = profiles[0];
    const now = new Date().toISOString();

    if (!canonical) {
      const [createdId] = await db.add(table, [
        {
          appUserId: userId,
          readerId,
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          createdAt: now,
          updatedAt: now,
        },
      ]);
      if (!createdId) throw new Error('Unable to create reader profile.');
      continue;
    }

    const fieldsMatch = readerProfileFieldsMatch(
      canonical,
      readerId,
      name,
      email
    );
    if (!fieldsMatch) {
      const record: ReaderProfileRecord = {
        appUserId: userId,
        readerId,
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        createdAt: canonical.createdAt,
        updatedAt: now,
      };
      const [updated] = await db.update(table, [
        { id: canonical.id, record: { ...record } },
      ]);
      if (!updated) continue;
    }

    const duplicateIds = profiles.slice(1).map(profile => profile.id);
    if (duplicateIds.length > 0) {
      await db.delete(table, duplicateIds);
    }

    if (!fieldsMatch || duplicateIds.length > 0) continue;

    return {
      id: readerId,
      userId,
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    };
  }

  throw new Error(
    'Unable to converge reader profile after bounded reconciliation.'
  );
}

async function getOrCreateReaderProfile(user: AuthUser) {
  const table = await readerProfileTable(user.userId);
  const scopes = grantedScopes(user);
  const name = scopes.has('profile') ? cleanText(user.name, 160) : '';
  const email = scopes.has('email') ? cleanText(user.email, 320) : '';
  const readerId = await sha256(`pocketstocks-reader-v1:${user.userId}`);
  return reconcileReaderProfile(table, user.userId, readerId, name, email);
}

async function favoritesTable(articleId: string): Promise<string> {
  return `favorites:${await sha256(`pocketstocks-article-v1:${articleId}`)}`;
}

async function listArticleFavorites(articleId: string) {
  const table = await favoritesTable(articleId);
  const favorites: Array<FavoriteRecord & { id: string }> = [];
  let nextToken: string | undefined;

  for (let page = 0; page < FAVORITE_READ_PAGE_LIMIT; page += 1) {
    const result = await db.list<FavoriteRecord>(table, {
      limit: FAVORITE_READ_PAGE_SIZE,
      ...(nextToken ? { nextToken } : {}),
    });
    favorites.push(...result.items);
    nextToken = result.nextToken;
    if (!nextToken) return { table, favorites };
  }

  throw new Error('Favorite reconciliation exceeded its bounded read limit.');
}

async function setFavorite(user: AuthUser, articleId: string) {
  const readerId = await sha256(`pocketstocks-reader-v1:${user.userId}`);

  for (let attempt = 0; attempt < FAVORITE_RECONCILIATION_LIMIT; attempt += 1) {
    const { table, favorites } = await listArticleFavorites(articleId);
    const owned = favorites
      .filter(favorite => favorite.appUserId === user.userId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const canonical = owned[0];

    if (!canonical) {
      const [createdId] = await db.add(table, [
        {
          appUserId: user.userId,
          readerId,
          articleId,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (!createdId) throw new Error('Unable to create favorite.');
      continue;
    }

    const canonicalMatches =
      canonical.readerId === readerId && canonical.articleId === articleId;
    if (!canonicalMatches) {
      const [updated] = await db.update(table, [
        {
          id: canonical.id,
          record: {
            appUserId: user.userId,
            readerId,
            articleId,
            createdAt: canonical.createdAt,
          },
        },
      ]);
      if (!updated) continue;
    }

    const duplicateIds = owned.slice(1).map(favorite => favorite.id);
    if (duplicateIds.length > 0) await db.delete(table, duplicateIds);
    if (!canonicalMatches || duplicateIds.length > 0) continue;

    return { articleId, createdAt: canonical.createdAt, favorited: true };
  }

  throw new Error('Unable to converge favorite after bounded reconciliation.');
}

async function getPublishedArticle(
  articleId: string
): Promise<ArticleRecord | null> {
  const article = await getArticle(articleId);
  return article?.published === true ? article : null;
}

async function removeFavorite(userId: string, articleId: string) {
  for (let attempt = 0; attempt < FAVORITE_RECONCILIATION_LIMIT; attempt += 1) {
    const { table, favorites } = await listArticleFavorites(articleId);
    const ownedIds = favorites
      .filter(favorite => favorite.appUserId === userId)
      .map(favorite => favorite.id);
    if (ownedIds.length === 0) return { articleId, favorited: false };
    await db.delete(table, ownedIds);
  }

  throw new Error('Unable to remove favorite after bounded reconciliation.');
}

async function deleteAllArticleFavorites(articleId: string): Promise<void> {
  const table = await favoritesTable(articleId);
  for (let page = 0; page < FAVORITE_READ_PAGE_LIMIT; page += 1) {
    const { items } = await db.list<FavoriteRecord>(table, {
      limit: FAVORITE_READ_PAGE_SIZE,
    });
    if (items.length === 0) return;
    await db.delete(
      table,
      items.map(favorite => favorite.id)
    );
  }
  const { items } = await db.list<FavoriteRecord>(table, { limit: 1 });
  if (items.length === 0) return;
  throw new Error('Unable to empty article favorites after bounded cleanup.');
}

async function listReaderFavorites(userId: string, nextToken?: string) {
  await ensureSeedArticles();
  const page = await readCollectionArticlePage(
    'favorites',
    userId,
    nextToken,
    async cursor => {
      const articles = await db.list<ArticleRecord>(ARTICLES_TABLE, {
        limit: COLLECTION_PAGE_SIZE,
        ...(cursor ? { nextToken: cursor } : {}),
      });
      const articleIds: string[] = [];
      for (const article of articles.items) {
        const { favorites } = await listArticleFavorites(article.id);
        if (favorites.some(favorite => favorite.appUserId === userId))
          articleIds.push(article.id);
      }
      return { articleIds, nextToken: articles.nextToken };
    }
  );
  const favorites = [];
  const articles = page.articleIds.length
    ? await db.get<ArticleRecord>(ARTICLES_TABLE, page.articleIds)
    : [];
  for (let index = 0; index < page.articleIds.length; index += 1) {
    if (articles[index]?.published !== true) continue;
    const articleId = page.articleIds[index];
    const { favorites: candidates } = await listArticleFavorites(articleId);
    const owned = candidates
      .filter(favorite => favorite.appUserId === userId)
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (owned) favorites.push({ articleId, createdAt: owned.createdAt });
  }
  return {
    favorites,
    count: favorites.length,
    nextToken: page.nextToken,
    migrationPending: page.migrationPending,
    migrationProgress: page.migrationProgress,
  };
}

async function reviewsTable(articleId: string): Promise<string> {
  return `reviews:${await sha256(`pocketstocks-review-article-v1:${articleId}`)}`;
}

async function listArticleReviewRecords(articleId: string) {
  const table = await reviewsTable(articleId);
  const reviews: Array<ReviewRecord & { id: string }> = [];
  let nextToken: string | undefined;

  for (let page = 0; page < REVIEW_READ_PAGE_LIMIT; page += 1) {
    const result = await db.list<ReviewRecord>(table, {
      limit: REVIEW_READ_PAGE_SIZE,
      ...(nextToken ? { nextToken } : {}),
    });
    reviews.push(...result.items);
    nextToken = result.nextToken;
    if (!nextToken) return { table, reviews };
  }

  throw new Error('Review reconciliation exceeded its bounded read limit.');
}

function reviewRecordIsWellFormed(review: ReviewRecord) {
  return (
    typeof review.reviewId === 'string' &&
    Boolean(review.reviewId) &&
    typeof review.articleId === 'string' &&
    Boolean(review.articleId) &&
    typeof review.mutationId === 'string' &&
    Boolean(review.mutationId) &&
    Number.isSafeInteger(review.version) &&
    review.version > 0 &&
    Number.isSafeInteger(review.baseVersion) &&
    review.baseVersion >= 0 &&
    review.baseVersion === review.version - 1 &&
    typeof review.deleted === 'boolean' &&
    (review.deleted
      ? review.text === ''
      : normalizeReviewText(review.text) === review.text) &&
    typeof review.createdAt === 'string' &&
    typeof review.updatedAt === 'string'
  );
}

function compareReviewCandidates(
  left: ReviewRecord & { id: string },
  right: ReviewRecord & { id: string }
) {
  if (left.version !== right.version) return right.version - left.version;
  const mutationOrder = left.mutationId.localeCompare(right.mutationId);
  return mutationOrder || left.id.localeCompare(right.id);
}

async function reconcileOwnedReview(articleId: string, userId: string) {
  const { table, reviews } = await listArticleReviewRecords(articleId);
  const owned = reviews
    .filter(review => review.appUserId === userId)
    .sort(compareReviewCandidates);
  if (
    owned.some(
      review =>
        !reviewRecordIsWellFormed(review) || review.articleId !== articleId
    )
  ) {
    throw new Error('Owned review data is malformed.');
  }
  const canonical = owned[0] ?? null;
  const duplicateIds = owned.slice(1).map(review => review.id);
  if (duplicateIds.length > 0) {
    const deleted = await db.delete(table, duplicateIds);
    if (
      deleted.length !== duplicateIds.length ||
      deleted.some(result => !result)
    ) {
      throw new Error('Unable to converge duplicate review records.');
    }
  }
  return { table, canonical };
}

function publicReview(review: ReviewRecord & { id: string }) {
  if (review.deleted) return null;
  return {
    id: review.reviewId,
    articleId: review.articleId,
    text: review.text,
    version: review.version,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

function reviewRevision(review: (ReviewRecord & { id: string }) | null) {
  return review
    ? { version: review.version, updatedAt: review.updatedAt }
    : { version: 0, updatedAt: null };
}

function reviewSlot(review: (ReviewRecord & { id: string }) | null) {
  return {
    review: review ? publicReview(review) : null,
    revision: reviewRevision(review),
  };
}

function normalizeReviewText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || Array.from(normalized).length > REVIEW_MAX_CODE_POINTS)
    return null;
  const disallowedControls =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
  return disallowedControls.test(normalized) ? null : normalized;
}

function validMutationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function readReviewPrecondition(body: unknown) {
  const input = asObject(body);
  if (!input) return null;
  const baseVersion = input.baseVersion;
  const baseUpdatedAt = input.baseUpdatedAt;
  const mutationId = input.mutationId;
  if (
    !Number.isSafeInteger(baseVersion) ||
    (baseVersion as number) < 0 ||
    !validMutationId(mutationId)
  )
    return null;
  if (
    baseUpdatedAt !== null &&
    baseUpdatedAt !== undefined &&
    typeof baseUpdatedAt !== 'string'
  )
    return null;
  return {
    baseVersion: baseVersion as number,
    baseUpdatedAt: typeof baseUpdatedAt === 'string' ? baseUpdatedAt : null,
    mutationId,
    text: normalizeReviewText(input.text),
  };
}

function reviewPreconditionMatches(
  canonical: (ReviewRecord & { id: string }) | null,
  baseVersion: number,
  baseUpdatedAt: string | null
) {
  if (!canonical) return baseVersion === 0 && baseUpdatedAt === null;
  return (
    canonical.version === baseVersion && canonical.updatedAt === baseUpdatedAt
  );
}

async function addReviewMutation(
  user: AuthUser,
  articleId: string,
  text: string,
  baseVersion: number,
  baseUpdatedAt: string | null,
  mutationId: string
) {
  const readerId = await sha256(`pocketstocks-reader-v1:${user.userId}`);
  const reviewId = await sha256(
    `pocketstocks-review-v1:${user.userId}:${articleId}`
  );

  for (let attempt = 0; attempt < REVIEW_RECONCILIATION_LIMIT; attempt += 1) {
    const { table, canonical } = await reconcileOwnedReview(
      articleId,
      user.userId
    );
    if (canonical?.mutationId === mutationId) {
      return canonical.text === text && !canonical.deleted
        ? { kind: 'saved' as const, canonical }
        : { kind: 'conflict' as const, canonical };
    }
    if (!reviewPreconditionMatches(canonical, baseVersion, baseUpdatedAt)) {
      return { kind: 'conflict' as const, canonical };
    }

    const now = new Date().toISOString();
    const next: ReviewRecord = {
      appUserId: user.userId,
      readerId,
      reviewId,
      articleId,
      text,
      version: baseVersion + 1,
      baseVersion,
      mutationId,
      deleted: false,
      createdAt: canonical?.createdAt ?? now,
      updatedAt: now,
    };
    const [createdId] = await db.add(table, [{ ...next }]);
    if (!createdId) throw new Error('Unable to create review mutation.');
    await Promise.resolve();
    const resolved = await reconcileOwnedReview(articleId, user.userId);
    if (!resolved.canonical) continue;
    if (resolved.canonical.mutationId === mutationId) {
      return { kind: 'saved' as const, canonical: resolved.canonical };
    }
    return { kind: 'conflict' as const, canonical: resolved.canonical };
  }

  throw new Error('Unable to converge review after bounded reconciliation.');
}

async function addReviewDeletion(
  user: AuthUser,
  articleId: string,
  baseVersion: number,
  baseUpdatedAt: string | null,
  mutationId: string
) {
  const readerId = await sha256(`pocketstocks-reader-v1:${user.userId}`);
  const reviewId = await sha256(
    `pocketstocks-review-v1:${user.userId}:${articleId}`
  );

  for (let attempt = 0; attempt < REVIEW_RECONCILIATION_LIMIT; attempt += 1) {
    const { table, canonical } = await reconcileOwnedReview(
      articleId,
      user.userId
    );
    if (canonical?.deleted) {
      return canonical.mutationId === mutationId ||
        reviewPreconditionMatches(canonical, baseVersion, baseUpdatedAt)
        ? { kind: 'deleted' as const, canonical }
        : { kind: 'conflict' as const, canonical };
    }
    if (!reviewPreconditionMatches(canonical, baseVersion, baseUpdatedAt)) {
      return { kind: 'conflict' as const, canonical };
    }
    if (!canonical) return { kind: 'deleted' as const, canonical: null };

    const now = new Date().toISOString();
    const tombstone: ReviewRecord = {
      appUserId: user.userId,
      readerId,
      reviewId,
      articleId,
      text: '',
      version: baseVersion + 1,
      baseVersion,
      mutationId,
      deleted: true,
      createdAt: canonical.createdAt,
      updatedAt: now,
    };
    const [createdId] = await db.add(table, [{ ...tombstone }]);
    if (!createdId) throw new Error('Unable to create review deletion.');
    await Promise.resolve();
    const resolved = await reconcileOwnedReview(articleId, user.userId);
    if (!resolved.canonical) continue;
    if (
      resolved.canonical.mutationId === mutationId &&
      resolved.canonical.deleted
    ) {
      return { kind: 'deleted' as const, canonical: resolved.canonical };
    }
    return { kind: 'conflict' as const, canonical: resolved.canonical };
  }

  throw new Error(
    'Unable to converge review deletion after bounded reconciliation.'
  );
}

async function listReaderReviews(userId: string, nextToken?: string) {
  await ensureSeedArticles();
  const page = await readCollectionArticlePage(
    'reviews',
    userId,
    nextToken,
    async cursor => {
      const articles = await db.list<ArticleRecord>(ARTICLES_TABLE, {
        limit: COLLECTION_PAGE_SIZE,
        ...(cursor ? { nextToken: cursor } : {}),
      });
      const articleIds: string[] = [];
      for (const article of articles.items) {
        const { reviews } = await listArticleReviewRecords(article.id);
        if (reviews.some(review => review.appUserId === userId))
          articleIds.push(article.id);
      }
      return { articleIds, nextToken: articles.nextToken };
    }
  );
  const reviews = [];
  const articles = page.articleIds.length
    ? await db.get<ArticleRecord>(ARTICLES_TABLE, page.articleIds)
    : [];
  for (let index = 0; index < page.articleIds.length; index += 1) {
    if (articles[index]?.published !== true) continue;
    const { canonical } = await reconcileOwnedReview(
      page.articleIds[index],
      userId
    );
    const review = canonical ? publicReview(canonical) : null;
    if (review) reviews.push(review);
  }
  return {
    reviews,
    count: reviews.length,
    nextToken: page.nextToken,
    migrationPending: page.migrationPending,
    migrationProgress: page.migrationProgress,
  };
}

type ReaderCommentCursor = {
  articleIds: string[];
  articleIndex: number;
  indexToken?: string;
  commentToken?: string;
};

async function listReaderComments(userId: string, token?: string) {
  let cursor: ReaderCommentCursor;
  if (token) {
    cursor = JSON.parse(decodeURIComponent(token)) as ReaderCommentCursor;
    if (
      !Array.isArray(cursor.articleIds) ||
      cursor.articleIds.length > 20 ||
      !cursor.articleIds.every(isPublicArticleId) ||
      !Number.isInteger(cursor.articleIndex) ||
      cursor.articleIndex < 0 ||
      cursor.articleIndex >= cursor.articleIds.length ||
      (cursor.indexToken !== undefined &&
        typeof cursor.indexToken !== 'string') ||
      (cursor.commentToken !== undefined &&
        typeof cursor.commentToken !== 'string')
    ) {
      throw new Error('Invalid comment cursor.');
    }
  } else {
    const page = await readCollectionArticlePage(
      'comments',
      userId,
      undefined,
      async () => ({ articleIds: [] })
    );
    cursor = {
      articleIds: page.articleIds,
      articleIndex: 0,
      indexToken: page.nextToken,
    };
  }
  if (!cursor.articleIds.length) return { comments: [] };
  const articleId = cursor.articleIds[cursor.articleIndex];
  const article = await getArticle(articleId);
  const page =
    article?.published === true
      ? await db.list<CommentRecord>(commentsTable(articleId), {
          limit: MAX_COMMENTS,
          ...(cursor.commentToken ? { nextToken: cursor.commentToken } : {}),
        })
      : { items: [], nextToken: undefined };
  const comments = page.items
    .filter(item => item.appUserId === userId)
    .map(item => readPublicComment(articleId, item))
    .filter((item): item is StoredCommentRecord => Boolean(item));
  let next: ReaderCommentCursor | undefined;
  if (page.nextToken) {
    next = { ...cursor, commentToken: page.nextToken };
  } else if (cursor.articleIndex + 1 < cursor.articleIds.length) {
    next = {
      ...cursor,
      articleIndex: cursor.articleIndex + 1,
      commentToken: undefined,
    };
  } else if (cursor.indexToken) {
    const indexPage = await readCollectionArticlePage(
      'comments',
      userId,
      cursor.indexToken,
      async () => ({ articleIds: [] })
    );
    if (indexPage.articleIds.length) {
      next = {
        articleIds: indexPage.articleIds,
        articleIndex: 0,
        indexToken: indexPage.nextToken,
      };
    }
  }
  return {
    comments,
    ...(next ? { nextToken: encodeURIComponent(JSON.stringify(next)) } : {}),
  };
}

function isSameOriginMutation(event: unknown): boolean {
  return isTrustedAdminMutation(event, ADMIN_FRONTEND_ORIGIN);
}

async function loginAttemptsTable(pepper: string): Promise<string> {
  // AppDeploy's current RouterContext does not document a platform-attested client-IP field.
  // Keep one deployment-wide bucket rather than trusting spoofable forwarding headers.
  const bucketHash = await sha256(
    `pocketstocks-login-v3:${pepper}:deployment-global`
  );
  return `admin-login-attempts:${bucketHash}`;
}

async function inspectLoginAttempts(
  table: string
): Promise<{ retryAfterSeconds: number; attemptIds: string[] }> {
  const now = Date.now();
  const { items } = await db.list<LoginAttemptRecord>(table, {
    limit: LOGIN_ATTEMPT_READ_LIMIT,
  });
  const result = inspectAttemptTimes(
    items,
    now,
    LOGIN_ATTEMPT_WINDOW_MS,
    LOGIN_ATTEMPT_LIMIT
  );
  const { expiredIds } = result;
  if (expiredIds.length > 0) {
    try {
      await db.delete(table, expiredIds);
    } catch {
      console.warn('Expired login-attempt cleanup did not complete.');
    }
  }

  return {
    retryAfterSeconds: result.retryAfterSeconds,
    attemptIds: result.recent.map(attempt => attempt.id),
  };
}

async function recordLoginFailure(table: string): Promise<void> {
  const [id] = await db.add(table, [{ attemptedAt: Date.now() }]);
  if (!id) throw new Error('Unable to record login attempt.');
}

function loginRateLimitError(retryAfterSeconds: number) {
  const response = error('Unable to sign in. Try again later.', 429);
  response.headers['Retry-After'] = String(retryAfterSeconds);
  return response;
}

function loggedOutResponse() {
  const response = json({ loggedOut: true });
  response.headers['Set-Cookie'] =
    `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0`;
  return response;
}

function getCookieHeader(event: unknown): string {
  const eventObject = asObject(event);
  const headers = asObject(eventObject?.headers);
  if (!headers) return '';
  const value = headers.cookie ?? headers.Cookie;
  return typeof value === 'string' ? value : '';
}

function getCookieSessionToken(event: unknown): string {
  const cookie = getCookieHeader(event)
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice(ADMIN_COOKIE_NAME.length + 1));
  } catch {
    return '';
  }
}

function getSessionToken(event: unknown, body?: unknown): string {
  const bodyToken = asObject(body)?.sessionToken;
  if (typeof bodyToken === 'string')
    return bodyToken.length <= 512 ? bodyToken : '';
  return getCookieSessionToken(event);
}

async function getSession(
  event: unknown,
  body?: unknown
): Promise<{ id: string; record: SessionRecord } | null> {
  const parsedToken = parseSessionToken(getSessionToken(event, body));
  if (!parsedToken) return null;
  const { id, secret } = parsedToken;

  const [record] = await db.get<SessionRecord>(SESSIONS_TABLE, [id]);
  if (!record) return null;
  if (isStaleSession(record, Date.now(), SESSION_DURATION_MS)) {
    try {
      await db.delete(SESSIONS_TABLE, [id]);
    } catch {
      console.warn('Stale admin-session cleanup did not complete.');
    }
    return null;
  }
  if (!(await secureEqual(record.tokenHash, await sha256(secret)))) return null;
  return { id, record };
}

async function cleanupStaleSessions(): Promise<void> {
  try {
    const { items } = await db.list<SessionRecord>(SESSIONS_TABLE, {
      limit: SESSION_CLEANUP_LIMIT,
    });
    const now = Date.now();
    const staleIds = items
      .filter(record => isStaleSession(record, now, SESSION_DURATION_MS))
      .map(record => record.id);
    if (staleIds.length > 0) await db.delete(SESSIONS_TABLE, staleIds);
  } catch {
    console.warn('Admin-session cleanup did not complete.');
  }
}

async function requireAdmin(
  event: unknown,
  body?: unknown
): Promise<{ id: string; record: SessionRecord } | null> {
  return getSession(event, body);
}

function commentsTable(articleId: string): string {
  return `comments:${articleId}`;
}

async function deleteBoundedTableRecords(
  table: string,
  pageSize: number,
  pageLimit: number
): Promise<boolean> {
  try {
    for (let page = 0; page < pageLimit; page += 1) {
      // Re-read the first bounded page after each delete so a retry can safely
      // resume an interrupted cleanup without retaining an unbounded id list.
      const { items } = await db.list(table, { limit: pageSize });
      if (items.length === 0) return true;
      const ids = items.slice(0, pageSize).map(item => item.id);
      if (ids.length === 0) return false;
      const deleted = await db.delete(table, ids);
      if (deleted.length !== ids.length || deleted.some(result => !result))
        return false;
    }

    const { items } = await db.list(table, { limit: 1 });
    return items.length === 0;
  } catch {
    return false;
  }
}

async function cleanupArticleComments(articleId: string): Promise<boolean> {
  return deleteBoundedTableRecords(
    commentsTable(articleId),
    COMMENT_DELETE_PAGE_SIZE,
    COMMENT_DELETE_PAGE_LIMIT
  );
}

function isArticleStoragePath(articleId: string, storagePath: string): boolean {
  const prefixes = [
    `articles/${articleId}/`,
    `seed/${SAMPLE_SEED_VERSION}/${articleId}/`,
    `seed/${articleId}/`,
  ];
  return prefixes.some(prefix => storagePath.startsWith(prefix));
}

function articleStoragePaths(
  articleId: string,
  pages: PageDescriptor[]
): string[] {
  return [
    ...new Set(
      pages
        .map(page => page.storagePath)
        .filter(storagePath => isArticleStoragePath(articleId, storagePath))
    ),
  ];
}

function deletionCleanupRecord(
  value: ArticleDeletionCleanupRecord & { id: string },
  articleId: string
): (ArticleDeletionCleanupRecord & { id: string }) | null {
  if (value.articleId !== articleId || !Array.isArray(value.storagePaths))
    return null;
  if (
    !value.storagePaths.every(storagePath =>
      isArticleStoragePath(articleId, storagePath)
    )
  )
    return null;
  if (new Set(value.storagePaths).size !== value.storagePaths.length)
    return null;
  if (
    value.storagePaths.length > MAX_PAGES ||
    typeof value.createdAt !== 'string'
  )
    return null;
  return value;
}

type ArticleDeletionCleanup = {
  table: string;
  recordIds: string[];
  storagePaths: string[];
};

async function deletionCleanupTable(articleId: string): Promise<string> {
  return `${ARTICLE_DELETION_CLEANUP_TABLE_PREFIX}:${await sha256(`pocketstocks-delete-v1:${articleId}`)}`;
}

async function readArticleDeletionCleanup(
  articleId: string
): Promise<ArticleDeletionCleanup | null> {
  const table = await deletionCleanupTable(articleId);
  const { items, nextToken } = await db.list<ArticleDeletionCleanupRecord>(
    table,
    {
      limit: DELETION_CLEANUP_RECORD_LIMIT,
    }
  );
  if (nextToken || items.length > DELETION_CLEANUP_RECORD_LIMIT) {
    throw new Error(
      'Deletion cleanup reconciliation exceeded its bounded read limit.'
    );
  }
  if (items.length === 0) return null;
  const records = items.map(item => deletionCleanupRecord(item, articleId));
  if (records.some(record => !record)) {
    throw new Error('Deletion cleanup record is invalid.');
  }
  const storagePaths = [
    ...new Set(records.flatMap(record => record!.storagePaths)),
  ];
  if (storagePaths.length > MAX_PAGES)
    throw new Error('Deletion cleanup record exceeds the page limit.');
  return { table, recordIds: records.map(record => record!.id), storagePaths };
}

async function createArticleDeletionCleanup(
  articleId: string,
  article: ArticleRecord
): Promise<ArticleDeletionCleanup> {
  const table = await deletionCleanupTable(articleId);
  const [createdId] = await db.add(table, [
    {
      articleId,
      storagePaths: articleStoragePaths(articleId, article.pages),
      createdAt: new Date().toISOString(),
    },
  ]);
  if (!createdId) throw new Error('Unable to record deletion cleanup.');
  const cleanup = await readArticleDeletionCleanup(articleId);
  if (!cleanup) throw new Error('Deletion cleanup record was not found.');
  return cleanup;
}

async function articleRecordIsDeleted(articleId: string): Promise<boolean> {
  const article = await getArticle(articleId);
  if (!article) return true;
  const [deleted] = await db.delete(ARTICLES_TABLE, [articleId]);
  if (deleted) return true;
  return (await getArticle(articleId)) === null;
}

async function cleanupDeletedArticle(
  articleId: string,
  cleanup: ArticleDeletionCleanup
): Promise<boolean> {
  const [storageClean, commentsClean, favoritesClean, reviewsClean] =
    await Promise.all([
      deleteStoragePaths(cleanup.storagePaths),
      cleanupArticleComments(articleId),
      (async () =>
        deleteBoundedTableRecords(
          await favoritesTable(articleId),
          FAVORITE_READ_PAGE_SIZE,
          FAVORITE_READ_PAGE_LIMIT
        ))(),
      (async () =>
        deleteBoundedTableRecords(
          await reviewsTable(articleId),
          REVIEW_READ_PAGE_SIZE,
          REVIEW_READ_PAGE_LIMIT
        ))(),
    ]);
  return storageClean && commentsClean && favoritesClean && reviewsClean;
}

async function removeArticleDeletionCleanup(
  cleanup: ArticleDeletionCleanup
): Promise<boolean> {
  try {
    const { items, nextToken } = await db.list<ArticleDeletionCleanupRecord>(
      cleanup.table,
      {
        limit: DELETION_CLEANUP_RECORD_LIMIT,
      }
    );
    if (nextToken || items.length > DELETION_CLEANUP_RECORD_LIMIT) return false;
    if (items.length === 0) return true;
    const ids = items.map(item => item.id);
    const removed = await db.delete(cleanup.table, ids);
    if (removed.length !== ids.length || removed.some(result => !result))
      return false;
    const verification = await db.list<ArticleDeletionCleanupRecord>(
      cleanup.table,
      { limit: 1 }
    );
    return verification.items.length === 0 && !verification.nextToken;
  } catch {
    return false;
  }
}

async function getArticle(id: string): Promise<ArticleRecord | null> {
  const [article] = await db.get<ArticleRecord>(ARTICLES_TABLE, [id]);
  return article;
}

function orderedPages(pages: PageDescriptor[]): PageDescriptor[] {
  return orderPublishedBookPages(pages);
}

function getCoverPage(article: ArticleRecord): PageDescriptor | undefined {
  const pages = orderedPages(article.pages);
  return pages.find(page => page.id === article.coverPageId) ?? pages[0];
}

type PublicationReadiness = {
  ready: boolean;
  issues: string[];
};

function publicationReadiness(
  articleId: string,
  article: ArticleRecord
): PublicationReadiness {
  const issues: string[] = [];
  if (!article.title) issues.push('請填寫書名。');
  if (!article.summary) issues.push('請填寫簡介。');
  if (!article.sector) issues.push('請填寫產業類別。');
  if (!isPublicationDate(article.publicationDate))
    issues.push('請選擇有效的發布日期。');

  const pages = [...article.pages].sort((left, right) => {
    const leftOrder = Number.isInteger(left.order)
      ? left.order
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isInteger(right.order)
      ? right.order
      : Number.MAX_SAFE_INTEGER;
    return (
      leftOrder - rightOrder || String(left.id).localeCompare(String(right.id))
    );
  });
  if (pages.length === 0) {
    issues.push('請加入至少一頁圖片。');
  } else {
    if (
      pages.length > MAX_PAGES ||
      !pages.every(
        (page, index) => Number.isInteger(page.order) && page.order === index
      )
    ) {
      issues.push('請先儲存連續的頁面順序，再發布研究。');
    }
    if (
      !article.coverPageId ||
      !pages.some(page => page.id === article.coverPageId)
    ) {
      issues.push('請選擇有效的封面。');
    }
    pages.forEach((page, index) => {
      if (!page.title) issues.push(`請填寫第 ${index + 1} 頁的標題。`);
      if (!page.altText) issues.push(`請填寫第 ${index + 1} 頁的圖片說明。`);
      if (
        !page.id ||
        typeof page.storagePath !== 'string' ||
        !(
          page.storagePath.startsWith(`articles/${articleId}/`) ||
          page.storagePath.startsWith('seed/')
        )
      ) {
        issues.push(`第 ${index + 1} 頁圖片尚未成功儲存，請重新上傳。`);
      }
    });
  }
  return { ready: issues.length === 0, issues };
}

async function deleteStoragePaths(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const results = await storage.delete(paths);
    return results.length === paths.length && results.every(Boolean);
  } catch {
    return false;
  }
}

async function pageUrls(
  pages: PageDescriptor[]
): Promise<Array<PageDescriptor & { imageUrl: string }>> {
  if (pages.length === 0) return [];
  const ordered = orderedPages(pages);
  const urls = await storage.url(ordered.map(page => page.storagePath));
  const urlByPath = new Map(urls.map(item => [item.path, item.url]));
  return ordered.map(page => ({
    ...page,
    imageUrl: urlByPath.get(page.storagePath) ?? '',
  }));
}

async function catalogCoverUrls(
  articles: ArticleRecord[]
): Promise<Map<string, string>> {
  const paths = [
    ...new Set(
      articles.flatMap(article => {
        const cover = getCoverPage(article);
        return cover ? [cover.storagePath] : [];
      })
    ),
  ];
  if (paths.length === 0) return new Map();
  const urls = await storage.url(paths);
  return new Map(urls.map(item => [item.path, item.url]));
}

async function articleSummary(
  article: StoredArticle,
  coverUrls: ReadonlyMap<string, string>
) {
  const coverPage = getCoverPage(article);
  const cover = coverPage ? (coverUrls.get(coverPage.storagePath) ?? '') : '';
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    sector: article.sector,
    tags: article.tags,
    publicationDate: article.publicationDate,
    published: article.published,
    status: article.published ? 'published' : 'draft',
    pageCount: article.pages.length,
    coverPageId: coverPage?.id ?? null,
    coverUrl: cover,
  };
}

async function articleDetail(id: string, article: ArticleRecord) {
  const coverPage = getCoverPage(article);
  return {
    ...article,
    id,
    status: article.published ? 'published' : 'draft',
    coverPageId: coverPage?.id ?? null,
    pages: await pageUrls(article.pages),
  };
}

async function publicArticleSummary(
  article: PublicArticleRecord,
  coverUrls: ReadonlyMap<string, string>
) {
  const coverPage = getCoverPage(article);
  const signedCover = coverPage
    ? coverUrls.get(coverPage.storagePath)
    : undefined;
  const cover = typeof signedCover === 'string' ? signedCover.trim() : '';
  if (coverPage && (!cover || !isPublicAssetUrl(cover))) return null;
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    sector: article.sector,
    tags: [...article.tags],
    publicationDate: article.publicationDate,
    published: true,
    status: 'published' as const,
    pageCount: article.pages.length,
    coverPageId: coverPage?.id ?? null,
    coverUrl: cover,
  };
}

async function publicArticleDetail(article: PublicArticleRecord) {
  const ordered = orderedPages(article.pages);
  const signedUrls =
    ordered.length > 0
      ? await storage.url(ordered.map(page => page.storagePath))
      : [];
  const urlsByStoragePath = new Map(
    signedUrls.map(item => [item.path, item.url])
  );
  const pages = createPublicPageManifest(ordered, urlsByStoragePath);
  const coverPage = selectPublishedBookCover(pages, article.coverPageId);

  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    sector: article.sector,
    tags: [...article.tags],
    publicationDate: article.publicationDate,
    published: true,
    status: 'published' as const,
    pageCount: pages.length,
    coverPageId: coverPage?.id ?? null,
    coverUrl: coverPage?.imageUrl ?? '',
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    pages,
  };
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>\"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] ?? character
  );
}

function sampleSeedStoragePath(articleId: string, pageIndex: number): string {
  return `seed/${SAMPLE_SEED_VERSION}/${articleId}/page-${pageIndex + 1}.svg`;
}

function hasExpectedSampleRecord(
  article: ArticleRecord,
  sample: SeedArticleSample,
  pages: PageDescriptor[]
): boolean {
  if (
    article.title !== sample.title ||
    article.summary !== sample.summary ||
    article.sector !== sample.sector ||
    article.publicationDate !== sample.publicationDate ||
    !article.published ||
    (article.coverPageId != null && article.coverPageId !== 'page-1') ||
    article.tags.length !== sample.tags.length ||
    article.tags.some((tag, index) => tag !== sample.tags[index]) ||
    pages.length !== sample.pages.length
  ) {
    return false;
  }

  return pages.every((page, index) => {
    const [, title, , note] = sample.pages[index];
    return (
      page.id === `page-${index + 1}` &&
      page.order === index &&
      page.title === title &&
      page.altText === `${title}：${note}`
    );
  });
}

function classifySampleSeedPathFamily(
  articleId: string,
  pages: PageDescriptor[]
): SampleSeedPathFamily | null {
  const currentRoot = `seed/${SAMPLE_SEED_VERSION}/${articleId}`;
  if (
    pages.every(
      (page, index) =>
        page.storagePath === `${currentRoot}/page-${index + 1}.svg`
    )
  ) {
    return { kind: 'current-v3', root: currentRoot };
  }

  let generatedV3Root = '';
  const hasOneGeneratedV3Root = pages.every((page, index) => {
    const match = page.storagePath.match(GENERATED_V3_SEED_PAGE_PATH);
    if (!match || Number(match[2]) !== index + 1) return false;
    const nextRoot = `seed/v3/${match[1]}`;
    if (!generatedV3Root) generatedV3Root = nextRoot;
    return generatedV3Root === nextRoot;
  });
  if (hasOneGeneratedV3Root && generatedV3Root) {
    return { kind: 'current-v3', root: generatedV3Root };
  }

  let legacyRoot = '';
  const hasOneLegacyRoot = pages.every((page, index) => {
    const match = page.storagePath.match(LEGACY_GENERATED_SEED_PAGE_PATH);
    if (!match || Number(match[2]) !== index + 1) return false;
    const nextFolder = `seed/${match[1]}`;
    if (!legacyRoot) legacyRoot = nextFolder;
    return legacyRoot === nextFolder;
  });
  return hasOneLegacyRoot && legacyRoot
    ? { kind: 'legacy-generated', root: legacyRoot }
    : null;
}

function samplePageSvg(
  kicker: string,
  title: string,
  metric: string,
  note: string,
  accent: string
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_ART_WIDTH}" height="${SAMPLE_ART_HEIGHT}" viewBox="0 0 ${SAMPLE_ART_WIDTH} ${SAMPLE_ART_HEIGHT}">
  <rect width="${SAMPLE_ART_WIDTH}" height="${SAMPLE_ART_HEIGHT}" fill="#F3F0E8"/>
  <rect x="72" y="72" width="1056" height="1656" rx="28" fill="#FCFBF7"/>
  <rect x="72" y="72" width="18" height="1656" fill="${accent}"/>
  <text x="138" y="160" fill="#0E2942" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="4">POCKETSTOCKS</text>
  <text x="138" y="230" fill="#53657A" font-family="Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="3">${escapeXml(kicker)}</text>
  <text x="138" y="390" fill="#0B1726" font-family="Georgia,serif" font-size="72" font-weight="700">${escapeXml(title)}</text>
  <line x1="138" y1="468" x2="1060" y2="468" stroke="#CBD4DD" stroke-width="3"/>
  <text x="138" y="748" fill="${accent}" font-family="Georgia,serif" font-size="154" font-weight="700">${escapeXml(metric)}</text>
  <text x="138" y="846" fill="#53657A" font-family="Arial,sans-serif" font-size="34">核心觀察</text>
  <foreignObject x="138" y="930" width="880" height="460"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:42px;line-height:1.55;color:#23364A">${escapeXml(note)}</div></foreignObject>
  <line x1="138" y1="1532" x2="1060" y2="1532" stroke="#CBD4DD" stroke-width="3"/>
  <text x="138" y="1620" fill="#6B7888" font-family="Arial,sans-serif" font-size="25">PocketStocks · Taiwan Market Briefing</text>
</svg>`;
}

function canonicalSeedPagePaths(
  articleId: string,
  article: ArticleRecord
): ReadonlySet<string> | null {
  const pages = orderedPages(article.pages);
  const sample = SAMPLE_ARTICLES.find(
    candidate => candidate.title === article.title
  );
  if (
    !sample ||
    !hasExpectedSampleRecord(article, sample, pages) ||
    classifySampleSeedPathFamily(articleId, pages)?.kind !== 'current-v3'
  ) {
    return null;
  }

  return new Set(pages.map(page => page.storagePath));
}

async function listSeedMaintenanceArticles(): Promise<StoredArticle[]> {
  const articles: StoredArticle[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < SEED_MAINTENANCE_READ_PAGE_LIMIT; page += 1) {
    const result = await db.list<StoredArticle>(ARTICLES_TABLE, {
      limit: MAX_ARTICLES,
      ...(nextToken ? { nextToken } : {}),
    });
    articles.push(...result.items);
    if (!result.nextToken) return articles;
    nextToken = result.nextToken;
  }
  console.warn('Seed maintenance reached its bounded article read limit.');
  return articles;
}

async function ensureSeedArticles(): Promise<void> {
  if (seedMaintenanceAttempted) return;
  const samples = SAMPLE_ARTICLES;

  const existingArticles = await listSeedMaintenanceArticles();
  if (existingArticles.length > 0) {
    if (seedMaintenanceAttempted) return;
    seedMaintenanceAttempted = true;
    try {
      for (const article of existingArticles) {
        const sample = samples.find(
          candidate => candidate.title === article.title
        );
        if (!sample) continue;
        if (article.pages.length !== sample.pages.length) {
          console.warn(
            'Skipped sample seed migration because its page count no longer matches.',
            { articleId: article.id }
          );
          continue;
        }
        const sourcePages = article.pages
          .slice()
          .sort((left, right) => left.order - right.order);
        const pathFamily = classifySampleSeedPathFamily(
          article.id,
          sourcePages
        );
        if (!hasExpectedSampleRecord(article, sample, sourcePages)) {
          console.warn(
            'Skipped sample seed migration because its metadata or page descriptors differ.',
            {
              articleId: article.id,
            }
          );
          continue;
        }
        if (pathFamily?.kind === 'current-v3') {
          const repairAssets = sourcePages.map((page, index) => {
            const [kicker, title, metric, note] = sample.pages[index];
            return {
              path: page.storagePath,
              content: samplePageSvg(
                kicker,
                title,
                metric,
                note,
                sample.accent
              ),
              contentType: 'image/svg+xml',
            };
          });
          try {
            const written = await storage.write(repairAssets);
            if (
              written.length !== repairAssets.length ||
              !written.every(Boolean)
            ) {
              console.error(
                'Failed to repair every canonical v3 sample article page.',
                { articleId: article.id }
              );
            }
          } catch (caught) {
            console.error(
              'Failed to repair canonical v3 sample article pages.',
              { articleId: article.id, caught }
            );
          }
          continue;
        }
        if (pathFamily?.kind !== 'legacy-generated') {
          console.warn(
            'Skipped sample seed migration because its pages are not one generated legacy seed family.',
            {
              articleId: article.id,
            }
          );
          continue;
        }

        const targetAssets = sourcePages.map((currentPage, index) => {
          const [kicker, title, metric, note] = sample.pages[index];
          return {
            currentPage,
            storagePath: sampleSeedStoragePath(article.id, index),
            content: samplePageSvg(kicker, title, metric, note, sample.accent),
          };
        });
        const pendingAssets = targetAssets.filter(
          ({ currentPage, storagePath }) =>
            currentPage.storagePath !== storagePath
        );
        if (pendingAssets.length === 0) continue;

        const pendingPaths = pendingAssets.map(
          ({ storagePath }) => storagePath
        );
        let recordUpdateAttempted = false;
        try {
          const written = await storage.write(
            pendingAssets.map(({ storagePath, content }) => ({
              path: storagePath,
              content,
              contentType: 'image/svg+xml',
            }))
          );
          if (
            written.length !== pendingAssets.length ||
            !written.every(Boolean)
          ) {
            throw new Error('Failed to write every sample article page.');
          }

          const targetPathByPageId = new Map(
            targetAssets.map(({ currentPage, storagePath }) => [
              currentPage.id,
              storagePath,
            ])
          );
          const migratedPages = article.pages.map(page => ({
            ...page,
            storagePath: targetPathByPageId.get(page.id) ?? page.storagePath,
          }));
          const { id: _articleId, ...articleRecord } = article;
          recordUpdateAttempted = true;
          const [updated] = await db.update(ARTICLES_TABLE, [
            {
              id: article.id,
              record: {
                ...articleRecord,
                pages: migratedPages,
                updatedAt: new Date().toISOString(),
              },
            },
          ]);
          if (!updated) {
            console.warn(
              'Sample seed migration record update was not confirmed; retained new assets.',
              {
                articleId: article.id,
              }
            );
            continue;
          }

          const obsoletePaths = [
            ...new Set(
              pendingAssets.map(({ currentPage }) => currentPage.storagePath)
            ),
          ];
          if (!(await deleteStoragePaths(obsoletePaths))) {
            console.warn(
              'Migrated sample article but could not remove every obsolete seed page asset.',
              {
                articleId: article.id,
              }
            );
          }
        } catch (caught) {
          if (!recordUpdateAttempted) {
            await deleteStoragePaths(pendingPaths);
          } else {
            console.warn(
              'Sample seed migration retained new assets after an ambiguous record update.',
              {
                articleId: article.id,
              }
            );
          }
          console.error(
            'Sample seed v3 migration failed; serving existing article record.',
            {
              articleId: article.id,
              caught,
            }
          );
        }
      }
    } catch (caught) {
      console.error(
        'Sample seed maintenance failed; serving existing article records.',
        caught
      );
    }
    return;
  }

  for (const sample of samples) {
    const articleSeed = `${Date.now()}-${randomToken(6)}`;
    const pages: PageDescriptor[] = [];
    for (let index = 0; index < sample.pages.length; index += 1) {
      const [kicker, title, metric, note] = sample.pages[index];
      const storagePath = sampleSeedStoragePath(articleSeed, index);
      const content = samplePageSvg(kicker, title, metric, note, sample.accent);
      const [written] = await storage.write([
        {
          path: storagePath,
          content,
          contentType: 'image/svg+xml',
        },
      ]);
      if (!written) throw new Error('Failed to write sample article page.');
      pages.push({
        id: `page-${index + 1}`,
        order: index,
        title,
        altText: `${title}：${note}`,
        storagePath,
      });
    }

    const now = new Date().toISOString();
    const [id] = await db.add(ARTICLES_TABLE, [
      {
        title: sample.title,
        summary: sample.summary,
        sector: sample.sector,
        tags: sample.tags,
        publicationDate: sample.publicationDate,
        published: true,
        pages,
        coverPageId: pages[0]?.id ?? null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    if (!id) throw new Error('Failed to create sample article.');
  }
}

async function listArticles(
  includeUnpublished: boolean,
  query: Record<string, string>
) {
  await ensureSeedArticles();
  const { items, nextToken } = await db.list<StoredArticle>(ARTICLES_TABLE, {
    limit: COLLECTION_PAGE_SIZE,
    ...(query.nextToken ? { nextToken: query.nextToken } : {}),
  });
  const search = cleanText(query.q, 100).toLocaleLowerCase();
  const sector = cleanText(query.sector, 80).toLocaleLowerCase();
  const tag = cleanText(query.tag, 40).toLocaleLowerCase();

  const matchesQuery = (article: ArticleRecord) => {
    if (sector && article.sector.toLocaleLowerCase() !== sector) return false;
    if (tag && !article.tags.some(item => item.toLocaleLowerCase() === tag))
      return false;
    if (!search) return true;
    return [
      article.title,
      article.summary,
      article.sector,
      ...article.tags,
    ].some(value => value.toLocaleLowerCase().includes(search));
  };

  if (includeUnpublished) {
    const filtered = items.filter(matchesQuery);
    filtered.sort((left, right) =>
      right.publicationDate.localeCompare(left.publicationDate)
    );
    const coverUrls = await catalogCoverUrls(filtered);
    return {
      articles: await Promise.all(
        filtered.map(article => articleSummary(article, coverUrls))
      ),
      nextToken,
    };
  }

  const filtered = items
    .map(article => readPublicArticle(article.id, article))
    .filter((article): article is PublicArticleRecord => Boolean(article))
    .filter(matchesQuery);
  filtered.sort((left, right) =>
    right.publicationDate.localeCompare(left.publicationDate)
  );
  const coverUrls = await catalogCoverUrls(filtered);
  const summaries = await Promise.all(
    filtered.map(article => publicArticleSummary(article, coverUrls))
  );
  return {
    articles: summaries.flatMap(summary => (summary ? [summary] : [])),
    nextToken,
  };
}

async function deleteAdminArticle(
  event: unknown,
  articleId: string,
  body: unknown
) {
  try {
    if (!isSameOriginMutation(event))
      return error('Cross-site request rejected.', 403);
    if (!(await requireAdmin(event, body)))
      return error('Authentication required.', 401);
    if (asObject(body)?.confirmation !== 'DELETE')
      return error('Deletion confirmation is required.', 400);

    let cleanup = await readArticleDeletionCleanup(articleId);
    if (!cleanup) {
      const article = await getArticle(articleId);
      // A completed retry has the same response as a first deletion.
      if (!article) return json({ deleted: true, id: articleId });
      cleanup = await createArticleDeletionCleanup(articleId, article);
    }

    if (!(await articleRecordIsDeleted(articleId)))
      return error('Unable to delete article.', 500);
    if (!(await cleanupDeletedArticle(articleId, cleanup))) {
      return json({ deleted: true, id: articleId, cleanupPending: true }, 202);
    }
    if (!(await removeArticleDeletionCleanup(cleanup))) {
      return json({ deleted: true, id: articleId, cleanupPending: true }, 202);
    }
    return json({ deleted: true, id: articleId });
  } catch {
    console.error('Unable to delete article.');
    return error('Unable to delete article.', 500);
  }
}

const deleteReaderReviewHandlers = [
  requireAuth(),
  async ({ user, params, body }: RouterContext) => {
    try {
      const input = readReviewPrecondition(body);
      if (!input)
        return error(
          'A valid review version, update timestamp, and mutation id are required.',
          400
        );
      const article = await getArticle(params.articleId);
      if (!article || article.published !== true)
        return error('Article not found.', 404);
      const result = await addReviewDeletion(
        user!,
        params.articleId,
        input.baseVersion,
        input.baseUpdatedAt,
        input.mutationId
      );
      const currentArticle = await getArticle(params.articleId);
      if (!currentArticle || currentArticle.published !== true)
        return error('Article not found.', 404);
      if (result.kind === 'conflict') {
        return json(
          {
            error: 'Review changed before it could be deleted.',
            ...reviewSlot(result.canonical),
          },
          409
        );
      }
      return json({ deleted: true, ...reviewSlot(result.canonical) });
    } catch (caught) {
      console.error('Unable to delete reader review.', caught);
      return error('Unable to delete review.', 500);
    }
  },
];

export const handler = router({
  ...makeEtfRoutes({ requireAdmin, isSameOriginMutation }),
  ...makeEtfMarkdownRoutes({ requireAdmin, isSameOriginMutation }),
  ...makeEtfDataRoutes({ requireAdmin, isSameOriginMutation, prepareReport: prepareEtfReportCommit }),
  ...makeEtfSnapshotRoutes({ requireAdmin, isSameOriginMutation }),
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'POST /api/reader/forms/:kind': [
    requireAuth(),
    async ({ user, params, body }) => {
      const input = parseReaderForm(params.kind, body);
      if (!input) return error('Invalid reader form.', 400);
      try {
        const submission = await saveReaderForm({
          ...input,
          userId: user!.userId,
          createdAt: new Date().toISOString(),
        });
        return json({ submission }, 201);
      } catch (caught) {
        return collectionFailure(caught, 'Unable to save reader form.');
      }
    },
  ],

  'GET /api/reader/forms/:kind/:id': [
    requireAuth(),
    async ({ user, params }) => {
      try {
        const submission = await readReaderForm(
          user!.userId,
          params.kind,
          params.id
        );
        return submission
          ? json({ submission })
          : error('Submission not found.', 404);
      } catch (caught) {
        return collectionFailure(caught, 'Unable to read submission.');
      }
    },
  ],

  'GET /api/admin/reader-forms': [
    async ({ event, body, query }) => {
      if (!(await requireAdmin(event, body)))
        return error('Authentication required.', 401);
      if (query.nextToken && query.nextToken.length > 4096)
        return error('Invalid page token.', 400);
      if (
        query.kind &&
        !['all', 'suggestions', 'research-interest'].includes(query.kind)
      )
        return error('Invalid feedback kind.', 400);
      try {
        return json(
          await listAuthorReaderForms(
            query.nextToken,
            query.kind === 'suggestions' || query.kind === 'research-interest'
              ? query.kind
              : undefined
          )
        );
      } catch (caught) {
        return collectionFailure(caught, 'Unable to read reader forms.');
      }
    },
  ],

  'POST /api/admin/reader-forms/list': [
    async ({ event, body }) => {
      if (!(await requireAdmin(event, body)))
        return error('Authentication required.', 401);
      const input = asObject(body);
      const kind = input?.kind ?? 'all';
      const nextToken = input?.nextToken;
      if (
        !['all', 'suggestions', 'research-interest'].includes(String(kind)) ||
        (nextToken !== undefined &&
          (typeof nextToken !== 'string' || nextToken.length > 4096))
      ) {
        return error('Invalid feedback page request.', 400);
      }
      try {
        return json(
          await listAuthorReaderForms(
            typeof nextToken === 'string' ? nextToken : undefined,
            kind === 'suggestions' || kind === 'research-interest'
              ? kind
              : undefined
          )
        );
      } catch (caught) {
        return collectionFailure(caught, 'Unable to read reader forms.');
      }
    },
  ],

  'GET /api/reader/me': [
    requireAuth(),
    async ({ user }) => {
      try {
        return json({ reader: await getOrCreateReaderProfile(user!) });
      } catch (caught) {
        console.error('Unable to load reader profile.', caught);
        return error('Unable to load reader profile.', 500);
      }
    },
  ],

  'GET /api/reader/favorites': [
    requireAuth(),
    async ({ user, query }) => {
      try {
        return json(await listReaderFavorites(user!.userId, query.nextToken));
      } catch (caught) {
        console.error('Unable to list reader favorites.', caught);
        return collectionFailure(caught, 'Unable to load favorites.');
      }
    },
  ],

  'PUT /api/reader/favorites/:articleId': [
    requireAuth(),
    async ({ user, params }) => {
      try {
        if (!(await getPublishedArticle(params.articleId)))
          return error('Article not found.', 404);
        await getOrCreateReaderProfile(user!);
        await rememberCollectionArticle(
          'favorites',
          user!.userId,
          params.articleId
        );
        const favorite = await setFavorite(user!, params.articleId);
        const currentArticle = await getPublishedArticle(params.articleId);
        if (!currentArticle) {
          await removeFavorite(user!.userId, params.articleId);
          return error('Article not found.', 404);
        }
        return json({ favorite });
      } catch (caught) {
        console.error('Unable to save favorite.', caught);
        return collectionFailure(caught, 'Unable to save favorite.');
      }
    },
  ],

  'DELETE /api/reader/favorites/:articleId': [
    requireAuth(),
    async ({ user, params }) => {
      try {
        if (!(await getPublishedArticle(params.articleId)))
          return error('Article not found.', 404);
        return json({
          favorite: await removeFavorite(user!.userId, params.articleId),
        });
      } catch (caught) {
        console.error('Unable to remove favorite.', caught);
        return error('Unable to remove favorite.', 500);
      }
    },
  ],

  'POST /api/reader/comments/:articleId/:commentId/delete': [
    requireAuth(),
    async ({ user, params, body }) => {
      if (
        !isPublicArticleId(params.articleId) ||
        !isPublicArticleId(params.commentId)
      ) {
        return error('Comment not found.', 404);
      }
      if (asObject(body)?.confirmation !== 'DELETE')
        return error('Deletion confirmation is required.', 400);
      try {
        const table = commentsTable(params.articleId);
        const [comment] = await db.get<CommentRecord>(table, [
          params.commentId,
        ]);
        if (!comment) return json({ deleted: true, id: params.commentId });
        if (
          comment.articleId !== params.articleId ||
          comment.appUserId !== user!.userId
        ) {
          return error('Comment not found.', 404);
        }
        const [deleted] = await db.delete(table, [params.commentId]);
        if (!deleted) {
          const [remaining] = await db.get<CommentRecord>(table, [
            params.commentId,
          ]);
          if (remaining) return error('Unable to delete comment.', 500);
        }
        return json({ deleted: true, id: params.commentId });
      } catch (caught) {
        console.error('Unable to delete owned public comment.', caught);
        return collectionFailure(caught, 'Unable to delete comment.');
      }
    },
  ],

  'GET /api/reader/comments': [
    requireAuth(),
    async ({ user, query }) => {
      try {
        return json(await listReaderComments(user!.userId, query.nextToken));
      } catch (caught) {
        return collectionFailure(caught, 'Unable to load comments.');
      }
    },
  ],

  'GET /api/reader/reviews': [
    requireAuth(),
    async ({ user, query }) => {
      try {
        return json(await listReaderReviews(user!.userId, query.nextToken));
      } catch (caught) {
        console.error('Unable to list reader reviews.', caught);
        return collectionFailure(caught, 'Unable to load reviews.');
      }
    },
  ],

  'GET /api/reader/reviews/:articleId': [
    requireAuth(),
    async ({ user, params }) => {
      try {
        const article = await getArticle(params.articleId);
        if (!article || article.published !== true)
          return error('Article not found.', 404);
        const { canonical } = await reconcileOwnedReview(
          params.articleId,
          user!.userId
        );
        return json(reviewSlot(canonical));
      } catch (caught) {
        console.error('Unable to load reader review.', caught);
        return error('Unable to load review.', 500);
      }
    },
  ],

  'PUT /api/reader/reviews/:articleId': [
    requireAuth(),
    async ({ user, params, body }) => {
      try {
        const input = readReviewPrecondition(body);
        if (!input || input.text === null) {
          return error(
            'Review text must be nonempty, contain at most 2,000 Unicode characters, and exclude unsafe control characters.',
            400
          );
        }
        const article = await getArticle(params.articleId);
        if (!article || article.published !== true)
          return error('Article not found.', 404);
        await getOrCreateReaderProfile(user!);
        await rememberCollectionArticle(
          'reviews',
          user!.userId,
          params.articleId
        );
        const result = await addReviewMutation(
          user!,
          params.articleId,
          input.text,
          input.baseVersion,
          input.baseUpdatedAt,
          input.mutationId
        );
        const currentArticle = await getArticle(params.articleId);
        if (!currentArticle || currentArticle.published !== true) {
          if (
            result.kind === 'saved' &&
            input.baseVersion === 0 &&
            result.canonical.mutationId === input.mutationId
          ) {
            const table = await reviewsTable(params.articleId);
            const [removed] = await db.delete(table, [result.canonical.id]);
            if (!removed)
              throw new Error(
                'Unable to roll back first review after unpublish.'
              );
          }
          return error('Article not found.', 404);
        }
        if (result.kind === 'conflict') {
          return json(
            {
              error: 'Review changed before this update was saved.',
              ...reviewSlot(result.canonical),
            },
            409
          );
        }
        return json(reviewSlot(result.canonical));
      } catch (caught) {
        console.error('Unable to save reader review.', caught);
        return collectionFailure(caught, 'Unable to save review.');
      }
    },
  ],

  'DELETE /api/reader/reviews/:articleId': deleteReaderReviewHandlers,
  'POST /api/reader/reviews/:articleId/delete': deleteReaderReviewHandlers,

  'GET /api/articles': [
    async ({ query }) => {
      try {
        return json(await listArticles(false, query));
      } catch (caught) {
        console.error('Unable to list public articles.', caught);
        return collectionFailure(caught, 'Unable to load articles.');
      }
    },
  ],

  'GET /api/articles/:id': [
    async ({ params }) => {
      const articleId = params.id;
      if (!isPublicArticleId(articleId))
        return error('Article not found.', 404);
      try {
        await ensureSeedArticles();
        const article = await getArticle(articleId);
        const publicArticle = readPublicArticle(articleId, article);
        if (!publicArticle) return error('Article not found.', 404);
        return json({ article: await publicArticleDetail(publicArticle) });
      } catch (caught) {
        console.error('Unable to load public article.', caught);
        return error('Unable to load article.', 500);
      }
    },
  ],

  'GET /api/articles/:id/cover': [
    async ({ params }) => {
      if (!isPublicArticleId(params.id))
        return error('Article not found.', 404);
      try {
        const article = readPublicArticle(
          params.id,
          await getArticle(params.id)
        );
        if (!article) return error('Article not found.', 404);
        const page = getCoverPage(article);
        if (!page) return json({ coverUrl: '' });
        const urls = await storage.url([page.storagePath]);
        const coverUrl = urls.find(item => item.path === page.storagePath)?.url;
        if (!coverUrl || !isPublicAssetUrl(coverUrl))
          return error('Unable to load cover.', 503);
        return json({ coverUrl });
      } catch {
        console.error('Unable to load public cover.');
        return error('Unable to load cover.', 500);
      }
    },
  ],

  'GET /api/articles/:id/comments': [
    async ({ params }) => {
      if (!isPublicArticleId(params.id))
        return error('Article not found.', 404);
      try {
        await ensureSeedArticles();
        const article = await getArticle(params.id);
        if (!article || !article.published)
          return error('Article not found.', 404);
        const { items } = await db.list<StoredCommentRecord>(
          commentsTable(params.id),
          { limit: MAX_COMMENTS }
        );
        const comments = items
          .map(item => readPublicComment(params.id, item))
          .filter((comment): comment is StoredCommentRecord => Boolean(comment))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return json({ comments });
      } catch (caught) {
        console.error('Unable to list comments.', caught);
        return error('Unable to load comments.', 500);
      }
    },
  ],

  'POST /api/articles/:id/comments': [
    async ({ params, body, event }) => {
      if (!isPublicArticleId(params.id))
        return error('Article not found.', 404);
      const input = asObject(body);
      const displayName = normalizeCommentText(
        input?.displayName,
        COMMENT_DISPLAY_NAME_MAX_CODE_POINTS,
        UNSAFE_COMMENT_DISPLAY_NAME_CONTROLS
      );
      const commentBody = normalizeCommentText(
        input?.body,
        COMMENT_BODY_MAX_CODE_POINTS,
        UNSAFE_COMMENT_CONTROLS
      );
      if (!displayName || !commentBody) {
        return error(
          `Display name must be nonempty, at most ${COMMENT_DISPLAY_NAME_MAX_CODE_POINTS} Unicode characters, and exclude unsafe controls; comment must be nonempty, at most ${COMMENT_BODY_MAX_CODE_POINTS} Unicode characters, and exclude unsafe controls.`,
          400
        );
      }

      try {
        await ensureSeedArticles();
        const article = await getArticle(params.id);
        if (!article || !article.published)
          return error('Article not found.', 404);
        const owner = await auth.getUser(event);
        if (input?.trackInMyComments === true && !owner)
          return error('Reader session expired.', 401);
        if (owner)
          await rememberCollectionArticle('comments', owner.userId, params.id);
        const record: CommentRecord = {
          ...(owner ? { appUserId: owner.userId } : {}),
          articleId: params.id,
          displayName,
          body: commentBody,
          createdAt: new Date().toISOString(),
        };
        const [id] = await db.add(commentsTable(params.id), [{ ...record }]);
        if (!id) return error('Unable to publish comment.', 500);
        return json(
          { comment: readPublicComment(params.id, { ...record, id }) },
          201
        );
      } catch (caught) {
        console.error('Unable to create comment.', caught);
        return error('Unable to publish comment.', 500);
      }
    },
  ],

  'POST /api/admin/session': [
    async ({ event, body }) => {
      if (!isSameOriginMutation(event))
        return error('Cross-site request rejected.', 403);
      const input = asObject(body);
      const suppliedSecret =
        typeof input?.secret === 'string' ? input.secret : '';
      if (isBlankSecret(suppliedSecret))
        return error('Master secret is required.', 400);

      try {
        const configuredNames = await secrets.listSecretNames();
        if (!configuredNames.includes('ADMIN_MASTER_SECRET')) {
          return error('Admin login is unavailable.', 503);
        }
        const configuredSecret = await secrets.readSecret(
          'ADMIN_MASTER_SECRET'
        );
        if (!configuredSecret) return error('Admin login is unavailable.', 503);
        const attemptsTable = await loginAttemptsTable(configuredSecret);
        const attemptState = await inspectLoginAttempts(attemptsTable);
        if (attemptState.retryAfterSeconds > 0) {
          return loginRateLimitError(attemptState.retryAfterSeconds);
        }
        if (!(await secureEqual(suppliedSecret, configuredSecret))) {
          await recordLoginFailure(attemptsTable);
          return error('Unable to sign in.', 401);
        }
        if (attemptState.attemptIds.length > 0) {
          try {
            await db.delete(attemptsTable, attemptState.attemptIds);
          } catch {
            console.warn('Login-attempt cleanup did not complete.');
          }
        }
        await cleanupStaleSessions();
        const tokenSecret = randomToken();
        const record: SessionRecord = {
          tokenHash: await sha256(tokenSecret),
          expiresAt: Date.now() + SESSION_DURATION_MS,
          revoked: false,
          createdAt: new Date().toISOString(),
        };
        const [id] = await db.add(SESSIONS_TABLE, [{ ...record }]);
        if (!id) return error('Unable to create session.', 500);
        const sessionToken = `${id}.${tokenSecret}`;
        const response = json({
          authenticated: true,
          expiresAt: record.expiresAt,
          sessionToken,
        });
        response.headers['Set-Cookie'] =
          `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_DURATION_MS / 1000}`;
        return response;
      } catch {
        console.error('Admin login is unavailable.');
        return error('Admin login is unavailable.', 503);
      }
    },
  ],

  'GET /api/admin/session': [
    async ({ event, body }) => {
      try {
        const session = await getSession(event, body);
        return session
          ? json({ authenticated: true, expiresAt: session.record.expiresAt })
          : json({ authenticated: false }, 401);
      } catch {
        console.error('Unable to validate admin session.');
        return error('Unable to validate session.', 500);
      }
    },
  ],

  'POST /api/admin/session/validate': [
    async ({ event, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        const session = await getSession(event, body);
        return session
          ? json({ authenticated: true, expiresAt: session.record.expiresAt })
          : json({ authenticated: false }, 401);
      } catch {
        console.error('Unable to validate admin session.');
        return error('Unable to validate session.', 500);
      }
    },
  ],

  'DELETE /api/admin/session': [
    async ({ event, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        const session = await getSession(event, body);
        if (session) {
          const [deleted] = await db.delete(SESSIONS_TABLE, [session.id]);
          if (!deleted && (await getSession(event, body)))
            return error('Unable to end session.', 500);
        }
        return loggedOutResponse();
      } catch {
        console.error('Unable to end admin session.');
        return error('Unable to end session.', 500);
      }
    },
  ],

  'GET /api/admin/articles': [
    async ({ event, query, body }) => {
      try {
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        return json(await listArticles(true, query));
      } catch (caught) {
        console.error('Unable to list admin articles.', caught);
        return collectionFailure(caught, 'Unable to load articles.');
      }
    },
  ],

  'POST /api/admin/articles/list': [
    async ({ event, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const input = asObject(body);
        const query = {
          q: cleanText(input?.q, 100),
          sector: cleanText(input?.sector, 80),
          tag: cleanText(input?.tag, 40),
          nextToken:
            typeof input?.nextToken === 'string' ? input.nextToken : '',
        };
        return json(await listArticles(true, query));
      } catch (caught) {
        console.error('Unable to list admin articles.', caught);
        return collectionFailure(caught, 'Unable to load articles.');
      }
    },
  ],

  'GET /api/admin/articles/:id': [
    async ({ event, params, body }) => {
      try {
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        await ensureSeedArticles();
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        return json({ article: await articleDetail(params.id, article) });
      } catch (caught) {
        console.error('Unable to load admin article.', caught);
        return error('Unable to load article.', 500);
      }
    },
  ],

  'POST /api/admin/articles/:id/detail': [
    async ({ event, params, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        await ensureSeedArticles();
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        return json({ article: await articleDetail(params.id, article) });
      } catch (caught) {
        console.error('Unable to load admin article.', caught);
        return error('Unable to load article.', 500);
      }
    },
  ],

  'POST /api/admin/articles': [
    async ({ event, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        await ensureSeedArticles();
        const record = normalizeArticleInput(body);
        if (typeof record === 'string') return error(record, 400);
        const [id] = await db.add(ARTICLES_TABLE, [{ ...record }]);
        return id
          ? json({ article: await articleDetail(id, record) }, 201)
          : error('Unable to create article.', 500);
      } catch (caught) {
        console.error('Unable to create article.', caught);
        return error('Unable to create article.', 500);
      }
    },
  ],

  'PUT /api/admin/articles/:id': [
    async ({ event, params, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const existing = await getArticle(params.id);
        if (!existing) return error('Article not found.', 404);
        const input = asObject(body) as ArticleInput | null;
        // Page order, page metadata, and cover selection are one server-owned
        // document. A caller that loaded an older document must reload it rather
        // than silently dropping a collaborator's intervening page mutation.
        if (
          input?.baseUpdatedAt !== undefined &&
          (typeof input.baseUpdatedAt !== 'string' ||
            input.baseUpdatedAt !== existing.updatedAt)
        ) {
          return error(
            'Draft changed on the server. Reload before saving page changes.',
            409
          );
        }
        const record = normalizeArticleInput(body, existing);
        if (typeof record === 'string') return error(record, 400);
        record.updatedAt = nextUpdatedAt(existing.updatedAt);
        const [updated] = await db.update(ARTICLES_TABLE, [
          { id: params.id, record: { ...record } },
        ]);
        if (!updated) return error('Unable to update article.', 500);
        const retainedPaths = new Set(
          record.pages.map(page => page.storagePath)
        );
        const removedPaths = existing.pages
          .map(page => page.storagePath)
          .filter(path => !retainedPaths.has(path));
        if (!(await deleteStoragePaths(removedPaths))) {
          console.warn('Some detached page assets could not be removed.', {
            articleId: params.id,
          });
        }
        return json({ article: await articleDetail(params.id, record) });
      } catch (caught) {
        console.error('Unable to update article.', caught);
        return error('Unable to update article.', 500);
      }
    },
  ],

  'POST /api/admin/articles/:id/pages': [
    async ({ event, params, body }) => {
      let stagedStoragePath = '';
      let attached = false;
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        if (article.pages.length >= MAX_PAGES)
          return error(
            `An article can contain at most ${MAX_PAGES} pages.`,
            400
          );
        const input = asObject(body) as PageUploadInput | null;
        const title = cleanText(input?.title, 120);
        const altText = cleanText(input?.altText, 500);
        const contentType = cleanText(input?.contentType, 80).toLowerCase();
        const rawContent =
          typeof input?.content === 'string' ? input.content : '';
        const dataUriMatch = rawContent.match(/^data:([^;]+);base64,(.+)$/s);
        if (
          rawContent.startsWith('data:') &&
          (!dataUriMatch || dataUriMatch[1].toLowerCase() !== contentType)
        ) {
          return error('Image content type does not match the upload.', 400);
        }
        const content = dataUriMatch ? dataUriMatch[2] : rawContent;
        const allowedTypes: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        };
        if (!title || !altText)
          return error(
            'Page title and accessible description are required.',
            400
          );
        if (
          !content ||
          content.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4
        ) {
          return error('Page image is required and must be under 7.5 MB.', 400);
        }
        if (!allowedTypes[contentType])
          return error('Unsupported image format.', 400);
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(content))
          return error('Image content must be base64 encoded.', 400);
        const bytes = decodeBase64(content);
        if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
          return error('Page image is required and must be under 7.5 MB.', 400);
        }
        if (!hasExpectedImageSignature(bytes, contentType)) {
          return error('Image bytes do not match the declared format.', 400);
        }

        const pageId = randomToken(12);
        const storagePath = `articles/${params.id}/${pageId}.${allowedTypes[contentType]}`;
        stagedStoragePath = storagePath;
        const [written] = await storage.write([
          { path: storagePath, content, contentType },
        ]);
        if (!written) return error('Unable to store page image.', 500);
        const page: PageDescriptor = {
          id: pageId,
          // Upload only appends a page. Ordering belongs to the later, dedicated
          // page-ordering workflow, so a client cannot shift existing pages here.
          order: article.pages.length,
          title,
          altText,
          storagePath,
        };
        const pages = [...orderedPages(article.pages), page];
        const coverPageId =
          article.coverPageId &&
          pages.some(item => item.id === article.coverPageId)
            ? article.coverPageId
            : (pages[0]?.id ?? null);
        const [updated] = await db.update(ARTICLES_TABLE, [
          {
            id: params.id,
            record: {
              ...article,
              pages,
              coverPageId,
              updatedAt: nextUpdatedAt(article.updatedAt),
            },
          },
        ]);
        if (!updated) {
          await storage.delete([storagePath]);
          return error('Unable to attach page to article.', 500);
        }
        attached = true;
        const [storedUrl] = await storage.url([storagePath]);
        return json({ page: { ...page, imageUrl: storedUrl?.url ?? '' } }, 201);
      } catch (caught) {
        if (stagedStoragePath && !attached) {
          try {
            await storage.delete([stagedStoragePath]);
          } catch {
            console.warn('A failed upload could not be rolled back.', {
              articleId: params.id,
            });
          }
        }
        console.error('Unable to upload article page.', caught);
        return error('Unable to upload page.', 500);
      }
    },
  ],

  'DELETE /api/admin/articles/:id/pages/:pageId': [
    async ({ event, params, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        const page = article.pages.find(
          candidate => candidate.id === params.pageId
        );
        if (!page) return error('Page not found.', 404);
        const pages = orderedPages(
          article.pages.filter(candidate => candidate.id !== params.pageId)
        );
        const coverPageId =
          article.coverPageId === params.pageId
            ? (pages[0]?.id ?? null)
            : (getCoverPage({ ...article, pages })?.id ?? null);
        const record = {
          ...article,
          pages,
          coverPageId,
          updatedAt: nextUpdatedAt(article.updatedAt),
        };
        const [updated] = await db.update(ARTICLES_TABLE, [
          { id: params.id, record },
        ]);
        if (!updated) return error('Unable to remove page.', 500);
        if (!(await deleteStoragePaths([page.storagePath]))) {
          console.warn('A detached page asset could not be removed.', {
            articleId: params.id,
            pageId: params.pageId,
          });
        }
        return json({ article: await articleDetail(params.id, record) });
      } catch (caught) {
        console.error('Unable to remove article page.', caught);
        return error('Unable to remove page.', 500);
      }
    },
  ],

  'DELETE /api/admin/articles/:id': [
    async ({ event, params, body }) =>
      deleteAdminArticle(event, params.id, body),
  ],
  'POST /api/admin/articles/:id/delete': [
    async ({ event, params, body }) =>
      deleteAdminArticle(event, params.id, body),
  ],

  'POST /api/admin/articles/:id/publish': [
    async ({ event, params, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        const readiness = publicationReadiness(params.id, article);
        if (!readiness.ready) {
          return json(
            {
              error: '請完成書籍資訊、封面與每頁圖片說明後再發布。',
              readiness,
            },
            400
          );
        }
        const coverPageId = getCoverPage(article)?.id ?? null;
        const record = {
          ...article,
          pages: orderedPages(article.pages),
          coverPageId,
          published: true,
          updatedAt: new Date().toISOString(),
        };
        const [updated] = await db.update(ARTICLES_TABLE, [
          { id: params.id, record },
        ]);
        return updated
          ? json({ article: await articleDetail(params.id, record) })
          : error('Unable to publish article.', 500);
      } catch (caught) {
        console.error('Unable to publish article.', caught);
        return error('Unable to publish article.', 500);
      }
    },
  ],

  'POST /api/admin/articles/:id/unpublish': [
    async ({ event, params, body }) => {
      try {
        if (!isSameOriginMutation(event))
          return error('Cross-site request rejected.', 403);
        if (!(await requireAdmin(event, body)))
          return error('Authentication required.', 401);
        const article = await getArticle(params.id);
        if (!article) return error('Article not found.', 404);
        const record = {
          ...article,
          pages: orderedPages(article.pages),
          coverPageId: getCoverPage(article)?.id ?? null,
          published: false,
          updatedAt: new Date().toISOString(),
        };
        const [updated] = await db.update(ARTICLES_TABLE, [
          { id: params.id, record },
        ]);
        if (!updated) return error('Unable to unpublish article.', 500);
        await deleteAllArticleFavorites(params.id);
        return json({
          article: await articleDetail(params.id, record),
          favoriteCount: 0,
        });
      } catch (caught) {
        console.error('Unable to unpublish article.', caught);
        return error('Unable to unpublish article.', 500);
      }
    },
  ],
});
