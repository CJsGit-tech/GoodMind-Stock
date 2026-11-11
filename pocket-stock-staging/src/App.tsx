/// <reference types="vite/client" />

import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ApplicationNavigation } from './application-navigation';
import { LoadingBlock, LoadingSkeleton, PendingIndicator } from './loading';
import { CatalogSelect } from './catalog-select';
import { CatalogSearch } from './catalog-search';
import { api, auth, type AuthUser } from '@appdeploy/client';
import { signInWithReaderSession, withReaderDeadline } from './reader-sign-in';
import { confirmDiscard } from './confirm-discard';
import { isReaderAccountDestination } from './reader-return-routes';
import { ReaderFormView } from './reader-forms';
import { ActiveEtfView } from './active-etf';
import { InstitutionalAuthor } from './institutional-author';
import { InstitutionalPublic } from './institutional-public';
import { InvestmentCalendar } from './investment-calendar';
import { InvestmentCalendarAuthor } from './investment-calendar-author';
import { EtfAuthorWorkspace } from './etf-data-author';
import { ResearchHero as LibraryHero, CatalogPagination } from './library-layout';
import {
  AuthorFeedbackView,
  type FeedbackKind,
  type FeedbackPage,
} from './author-feedback';
import {
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  FileImage,
  FileSearch,
  Filter,
  Grid2X2,
  Heart,
  Info,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  MoveDown,
  MoveUp,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { restoreLibraryFilterFocus } from './library-filter-focus.js';
import { normalizeAdminArticlePages } from './admin-article-data.ts';
import {
  parsePrivatePreviewRoute,
  type PrivatePreviewRoute,
} from './private-preview-routes';
import {
  normalizePublicRoute,
  parsePublicArticleRoute,
  type PublicArticleRoute,
} from './public-routes';

const isLocalFixtureBuild = import.meta.env.MODE === 'local-fixture';

function localFixtureScenario() {
  if (!isLocalFixtureBuild) return '';
  return new URLSearchParams(window.location.search).get('localScenario') ?? '';
}

const MAX_LIBRARY_QUERY_LENGTH = 120;
const MAX_LIBRARY_FILTER_LENGTH = 80;

function normalizeLibraryQuery(value: string) {
  return value.trim().slice(0, MAX_LIBRARY_QUERY_LENGTH);
}

function normalizeLibraryFilter(value: string | null | undefined) {
  return (value ?? '').trim().slice(0, MAX_LIBRARY_FILTER_LENGTH);
}

function publicHashState(hash = window.location.hash) {
  const rawHash = hash.replace(/^#/, '') || '/';
  const queryIndex = rawHash.indexOf('?');
  const route = queryIndex >= 0 ? rawHash.slice(0, queryIndex) || '/' : rawHash;
  const params =
    queryIndex >= 0 ? new URLSearchParams(rawHash.slice(queryIndex + 1)) : null;
  const query =
    route === '/' && queryIndex >= 0
      ? normalizeLibraryQuery(params?.get('q') ?? '')
      : '';
  const sector =
    route === '/' && queryIndex >= 0
      ? normalizeLibraryFilter(params?.get('sector'))
      : '';
  const tag =
    route === '/' && queryIndex >= 0
      ? normalizeLibraryFilter(params?.get('tag'))
      : '';
  return { route, query, sector, tag };
}

function readerLibraryIsReviewsRoute() {
  return publicHashState().route === '/my-library/reviews';
}

function libraryHash(query: string, sector = '', tag = '') {
  const params = new URLSearchParams();
  const normalized = normalizeLibraryQuery(query);
  const normalizedSector = normalizeLibraryFilter(sector);
  const normalizedTag = normalizeLibraryFilter(tag);
  if (!normalizedSector && !normalizedTag) {
    return normalized ? `#/?q=${encodeURIComponent(normalized)}` : '#/';
  }
  if (normalized) params.set('q', normalized);
  if (normalizedSector && normalizedSector !== 'All sectors')
    params.set('sector', normalizedSector);
  if (normalizedTag && normalizedTag !== 'All tags')
    params.set('tag', normalizedTag);
  const suffix = params.toString();
  return suffix ? `#/?${suffix}` : '#/';
}

function syncLibraryQueryHistory(query: string, sector = '', tag = '') {
  const nextHash = libraryHash(query, sector, tag);
  if (window.location.hash === nextHash) return;
  window.history.pushState(null, '', nextHash);
}

function adminEditorArticleId(hash = window.location.hash) {
  const match = hash.match(/^#\/admin\/article\/([^/?#]+)$/u);
  if (!match) return null;
  try {
    const articleId = decodeURIComponent(match[1]);
    return articleId &&
      articleId.length <= 200 &&
      articleId.trim() === articleId &&
      articleId !== '.' &&
      articleId !== '..' &&
      !/[\\/\u0000-\u001F\u007F?#]/u.test(articleId)
      ? articleId
      : null;
  } catch {
    return null;
  }
}

type ArticlePage = {
  id?: string;
  clientKey?: string;
  title: string;
  imageUrl: string;
  altText: string;
  storagePath?: string;
  fixtureLoading?: boolean;
  order: number;
  position?: number;
};

type Comment = {
  id: string;
  displayName: string;
  body: string;
  createdAt: string;
};

type OwnedPublicComment = Comment & { articleId: string };

type CommentValidationErrors = {
  displayName?: string;
  body?: string;
};

const COMMENT_DISPLAY_NAME_LIMIT = 50;
const COMMENT_BODY_LIMIT = 1_000;
const UNSAFE_COMMENT_CONTROLS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const UNSAFE_COMMENT_DISPLAY_NAME_CONTROLS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

function normalizeCommentValue(value: string) {
  return value.replace(/\r\n?/g, '\n').trim();
}

function commentValidationErrors(
  displayName: string,
  body: string
): CommentValidationErrors {
  const errors: CommentValidationErrors = {};
  const normalizedName = normalizeCommentValue(displayName);
  const normalizedBody = normalizeCommentValue(body);
  const displayNameLength = Array.from(normalizedName).length;
  const bodyLength = Array.from(normalizedBody).length;
  if (!normalizedName) errors.displayName = '請填寫顯示名稱。';
  else if (UNSAFE_COMMENT_DISPLAY_NAME_CONTROLS.test(normalizedName))
    errors.displayName = '顯示名稱不可包含換行或不支援的特殊字元。';
  else if (displayNameLength > COMMENT_DISPLAY_NAME_LIMIT)
    errors.displayName = `顯示名稱最多 ${COMMENT_DISPLAY_NAME_LIMIT} 個字。`;
  if (!normalizedBody) errors.body = '請填寫留言內容。';
  else if (UNSAFE_COMMENT_CONTROLS.test(normalizedBody))
    errors.body = '留言包含不支援的特殊字元，請移除後再試。';
  else if (bodyLength > COMMENT_BODY_LIMIT)
    errors.body = `留言內容最多 ${COMMENT_BODY_LIMIT.toLocaleString()} 個字。`;
  return errors;
}

function commentCodePointCount(value: string) {
  return Array.from(value).length;
}

type ReaderProfile = {
  id: string;
  userId: string;
  name?: string;
  email?: string;
};

type FavoriteSummary = {
  articleId: string;
  createdAt: string;
};

type FavoriteFeedback = {
  articleId: string;
  tone: 'success' | 'error';
  message: string;
  retryFavorited?: boolean;
} | null;

type PrivateReview = {
  id: string;
  articleId: string;
  text: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ReaderLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';
type ReaderLibraryTab = 'favorites' | 'reviews';
type ReaderLogoutStatus = 'idle' | 'pending' | 'error';
type DetailRouteStatus = 'idle' | 'loading' | 'unavailable' | 'error';
type ReaderRouteState = Pick<
  PublicArticleRoute,
  'reader' | 'pageIndex' | 'invalidPage'
>;
type CommentDraft = { displayName: string; body: string };
type AdminListStatus = 'idle' | 'loading' | 'ready' | 'error';
type AdminActionFeedback = {
  articleId: string;
  action: 'publish' | 'unpublish';
  state: 'pending' | 'failed' | 'stale';
} | null;
type AdminLifecycleAction = 'publish' | 'unpublish' | 'delete';
type AdminConfirmation = {
  action: AdminLifecycleAction;
  articleId: string;
  articleTitle: string;
  source: 'editor' | 'list';
} | null;
type PageRemovalConfirmation = {
  index: number;
  pageTitle: string;
} | null;
type AdminLifecycleMutation = {
  action: AdminLifecycleAction;
  articleId: string;
  state: 'pending' | 'failed' | 'partial' | 'stale' | 'validation';
  message?: string;
  issues?: string[];
} | null;

type ReviewRevision = {
  version: number;
  updatedAt: string | null;
};

type ReviewSlotPayload = {
  review: PrivateReview | null;
  revision: ReviewRevision;
  deleted?: boolean;
};

type ReviewNotice = { tone: 'success' | 'error'; message: string } | null;
type ReviewMutation = 'save' | 'delete' | null;

type Article = {
  id: string;
  slug?: string;
  title: string;
  summary: string;
  sector: string;
  publicationDate: string;
  tags: string[];
  pages: ArticlePage[];
  comments?: Comment[];
  coverImageUrl?: string;
  coverUrl?: string;
  pageCount?: number;
  coverPageId?: string | null;
  status?: 'draft' | 'published';
  published?: boolean;
  updatedAt?: string;
};

type AdminDraft = Omit<Article, 'id'> & { id?: string };
type SavedPageDescriptor = {
  id: string;
  title: string;
  altText: string;
  storagePath: string;
  order: number;
};
type ArticleMetadata = Pick<
  Article,
  'title' | 'summary' | 'sector' | 'publicationDate' | 'tags'
>;
type Notice = { tone: 'success' | 'error'; message: string } | null;
type AdminUnlockFixtureScenario =
  | 'checking'
  | 'invalid'
  | 'throttled'
  | 'unavailable'
  | 'expired'
  | 'cleared';
type AdminLogoutStatus = 'idle' | 'pending' | 'error';
type UploadFileState = {
  id: string;
  name: string;
  state: 'preparing' | 'uploaded' | 'failed';
  detail: string;
};
type UploadRecoveryState = {
  state: 'pending' | 'error' | 'partial';
  files: UploadFileState[];
} | null;
type View =
  | 'library'
  | 'article'
  | 'discussion'
  | 'my-library'
  | 'suggestions'
  | 'research-interest'
  | 'institutional-flows'
  | 'calendar'
  | 'active-etf'
  | 'admin';
type ReaderReadingSnapshot = { railOpen: boolean; draft: CommentDraft };
type ReaderReturnIntent =
  | {
      kind: 'reader-form';
      route: '/reader/suggestions' | '/reader/research-interest';
      scrollY: number;
      draft: null;
    }
  | {
      kind: 'article-detail';
      articleId: string;
      route: string;
      scrollY: number;
      draft: CommentDraft | null;
    }
  | {
      kind: 'protected-reader-action';
      action: 'account-menu';
      route: string;
      scrollY: number;
      draft: CommentDraft | null;
    }
  | {
      kind: 'protected-reader-action';
      action: 'favorite-add' | 'review-edit';
      articleId: string;
      route: string;
      scrollY: number;
      draft: CommentDraft | null;
    };

function publicReturnRoute() {
  const route = window.location.hash.replace(/^#/, '');
  return route || '/';
}

function adminUnlockFixtureScenario(
  value: string
): AdminUnlockFixtureScenario | '' {
  if (value === 'admin-unlock-default') return '';
  if (value === 'admin-unlock-checking') return 'checking';
  if (
    value === 'admin-unlock-invalid' ||
    value === 'admin-unlock-invalid-secret'
  )
    return 'invalid';
  if (value === 'admin-unlock-throttled') return 'throttled';
  if (value === 'admin-unlock-unavailable') return 'unavailable';
  if (value === 'admin-session-cleared-state') return 'cleared';
  if (
    value === 'admin-unlock-expired' ||
    value === 'admin-session-expired' ||
    value === 'admin-session-expired-redirect'
  )
    return 'expired';
  return '';
}

function initialAdminUnlockNotice(
  scenario: AdminUnlockFixtureScenario | ''
): Notice {
  if (scenario === 'invalid')
    return { tone: 'error', message: '登入失敗，請確認作者密鑰後重試。' };
  if (scenario === 'throttled')
    return { tone: 'error', message: '嘗試次數過多，請稍後再試。' };
  if (scenario === 'unavailable')
    return { tone: 'error', message: '作者登入暫時無法使用，請稍後再試。' };
  if (scenario === 'expired')
    return { tone: 'error', message: '作者登入已失效，請重新輸入作者密鑰。' };
  if (scenario === 'cleared')
    return { tone: 'error', message: '作者登入已結束，請重新輸入作者密鑰。' };
  return null;
}

const ADMIN_SESSION_STORAGE_KEY = 'pocketstocks_admin_session';
const ADMIN_SESSION_WARNING_MS = 15 * 60 * 1000;
const READER_LOGOUT_PENDING_STORAGE_KEY = 'pocketstocks_reader_logout_pending';
let readerLogoutPendingMemory = false;

function readerLogoutIsPending() {
  try {
    return (
      readerLogoutPendingMemory ||
      window.sessionStorage.getItem(READER_LOGOUT_PENDING_STORAGE_KEY) === '1'
    );
  } catch {
    return readerLogoutPendingMemory;
  }
}

function setReaderLogoutPending(pending: boolean) {
  readerLogoutPendingMemory = pending;
  try {
    if (pending)
      window.sessionStorage.setItem(READER_LOGOUT_PENDING_STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(READER_LOGOUT_PENDING_STORAGE_KEY);
  } catch {
    // A storage failure must never restore a reader session within this runtime.
  }
}

function readStoredAdminSession() {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as {
      sessionToken?: unknown;
      expiresAt?: unknown;
    };
    if (typeof value.sessionToken !== 'string' || !value.sessionToken)
      throw new Error('Invalid token');
    if (typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now())
      throw new Error('Expired token');
    return { sessionToken: value.sessionToken, expiresAt: value.expiresAt };
  } catch {
    window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    return null;
  }
}

function storeAdminSession(sessionToken: string, expiresAt: string | number) {
  const expiry =
    typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  if (!sessionToken || !Number.isFinite(expiry)) return;
  window.sessionStorage.setItem(
    ADMIN_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionToken, expiresAt: expiry })
  );
}

function removeStoredAdminSession() {
  window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
}

function createEmptyDraft(): AdminDraft {
  return {
    title: '',
    summary: '',
    sector: '',
    publicationDate: new Date().toISOString().slice(0, 10),
    tags: [],
    pages: [],
    coverPageId: null,
    status: 'draft',
    published: false,
  };
}

function isValidDraftPublicationDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function draftFingerprint(draft: AdminDraft) {
  return JSON.stringify({
    id: draft.id ?? null,
    title: draft.title,
    summary: draft.summary,
    sector: draft.sector,
    publicationDate: draft.publicationDate.slice(0, 10),
    tags: draft.tags,
    coverPageId: draft.coverPageId ?? null,
    pages: draft.pages.map((page, order) => ({
      id: page.id ?? null,
      clientKey: page.clientKey ?? null,
      title: page.title,
      altText: page.altText,
      storagePath: page.storagePath ?? null,
      imageUrl: page.id ? null : page.imageUrl,
      order,
    })),
    published: articleIsPublished(draft as Article),
  });
}

function formatDate(value: string) {
  if (!value) return '日期待定';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function getPayload<T>(response: { data: unknown }): T {
  const payload = response.data as { data?: T } | T;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function loadPagedEntities<T>(
  field: string,
  requestPage: (nextToken?: string) => Promise<{ data: unknown }>,
  key: (item: T) => string,
  isCurrent = () => true
): Promise<T[]> {
  const entities = new Map<string, T>();
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  let migrationProgress = -1;
  while (true) {
    if (!isCurrent()) throw { code: 'stale_collection_request' };
    const response = await requestPage(nextToken);
    if (!isCurrent()) throw { code: 'stale_collection_request' };
    const payload = getPayload<T[] | Record<string, unknown>>(response);
    if (Array.isArray(payload)) return payload;
    if (payload.migrationPending === true) {
      const progress = payload.migrationProgress;
      if (typeof progress !== 'number' || progress <= migrationProgress) {
        throw new Error('Collection migration did not advance.');
      }
      migrationProgress = progress;
      continue;
    }
    const items = payload[field];
    if (!Array.isArray(items)) throw new Error('Collection page is malformed.');
    for (const item of items as T[]) entities.set(key(item), item);
    if (!payload.nextToken) return [...entities.values()];
    if (
      typeof payload.nextToken !== 'string' ||
      seenTokens.has(payload.nextToken)
    ) {
      throw new Error('Collection cursor did not advance.');
    }
    nextToken = payload.nextToken;
    seenTokens.add(nextToken);
  }
}

function getEntity<T>(response: { data: unknown }, key: string): T {
  const payload = getPayload<Record<string, T> | T>(response);
  return payload && typeof payload === 'object' && key in payload
    ? (payload as Record<string, T>)[key]
    : (payload as T);
}

function articleIsPublished(article: Article) {
  return article.published ?? article.status === 'published';
}

function adminImagePageLabel(article: Article) {
  const pageCount =
    typeof article.pageCount === 'number' &&
    Number.isInteger(article.pageCount) &&
    article.pageCount >= 0
      ? article.pageCount
      : (article.pages?.length ?? 0);
  return `${pageCount} 張圖片`;
}

function pageIdentity(page: ArticlePage, index: number) {
  return page.id ?? page.clientKey ?? `page-${index}`;
}

function matchesIntendedSave(
  article: Article,
  metadata: ArticleMetadata,
  pages: SavedPageDescriptor[],
  coverPageId: string | null
) {
  if (
    article.title !== metadata.title ||
    article.summary !== metadata.summary ||
    article.sector !== metadata.sector ||
    article.publicationDate.slice(0, 10) !==
      metadata.publicationDate.slice(0, 10) ||
    JSON.stringify(article.tags) !== JSON.stringify(metadata.tags)
  )
    return false;
  return matchesIntendedPages(article, pages, coverPageId);
}

function matchesIntendedPages(
  article: Article,
  pages: SavedPageDescriptor[],
  coverPageId: string | null
) {
  if (article.coverPageId !== coverPageId) return false;
  const actualPages = [...(article.pages ?? [])].sort(
    (left, right) => left.order - right.order
  );
  if (actualPages.length !== pages.length) return false;
  return pages.every((expected, index) => {
    const actual = actualPages[index];
    return (
      actual?.id === expected.id &&
      actual.title === expected.title &&
      actual.altText === expected.altText &&
      actual.storagePath === expected.storagePath &&
      actual.order === expected.order
    );
  });
}

function getErrorStatus(errorValue: unknown): number | undefined {
  if (!errorValue || typeof errorValue !== 'object') return undefined;
  const errorObject = errorValue as {
    status?: number;
    response?: { status?: number; data?: { statusCode?: number } };
    data?: { statusCode?: number };
  };
  return (
    errorObject.status ??
    errorObject.response?.status ??
    errorObject.data?.statusCode ??
    errorObject.response?.data?.statusCode
  );
}

function isUnauthorized(errorValue: unknown) {
  return getErrorStatus(errorValue) === 401;
}

function getErrorPayload<T>(errorValue: unknown): T | null {
  if (!errorValue || typeof errorValue !== 'object') return null;
  const candidate = errorValue as {
    data?: unknown;
    response?: { data?: unknown };
  };
  const raw = candidate.response?.data ?? candidate.data;
  if (!raw || typeof raw !== 'object') return null;
  if (
    'data' in raw &&
    (raw as { data?: unknown }).data &&
    typeof (raw as { data?: unknown }).data === 'object'
  ) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

function newReviewMutationId() {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `review-${suffix}`;
}

function reviewCodePointCount(value: string) {
  return Array.from(value.replace(/\r\n?/g, '\n').trim()).length;
}

function reviewValidationMessage(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '請輸入評論內容。';
  if (Array.from(normalized).length > 2_000) return '評論最多 2,000 個字元。';
  const disallowedControls =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
  return disallowedControls.test(normalized)
    ? '評論包含不支援的特殊字元，請移除後再試。'
    : '';
}

function getAuthErrorCode(errorValue: unknown) {
  if (!errorValue || typeof errorValue !== 'object') return 'auth_error';
  const candidate = errorValue as {
    code?: unknown;
    error?: unknown;
    name?: unknown;
    data?: { code?: unknown; error?: unknown };
  };
  const value =
    candidate.code ??
    candidate.error ??
    candidate.data?.code ??
    candidate.data?.error ??
    candidate.name;
  return typeof value === 'string' ? value.toLocaleLowerCase() : 'auth_error';
}

function getAuthErrorMessage(errorValue: unknown) {
  const code = getAuthErrorCode(errorValue);
  if (code.includes('session_expired') || code.includes('auth_expired')) {
    return '登入已失效，請重新登入。';
  }
  if (code.includes('reader_profile_sync')) {
    return '暫時無法確認讀者帳號資料，請再試一次。';
  }
  if (code.includes('reader_sign_in_timeout')) {
    return '登入逾時。請關閉原本的登入視窗後重試；若仍卡住，請在 Chrome 或 Safari 開啟目前頁面再登入。';
  }
  if (code.includes('popup_blocked')) {
    return '瀏覽器阻擋了登入視窗。請允許 PocketStocks 開啟彈出式視窗，再試一次。';
  }
  if (code.includes('popup_closed') || code.includes('cancel')) {
    return '登入視窗已關閉。請重試，或取消並繼續閱讀。';
  }
  if (code.includes('provider_error')) {
    return '登入服務暫時無法完成驗證，請再試一次。';
  }
  return '目前無法完成登入，請稍後重試或繼續公開閱讀。';
}

function identityGraphemes(value: string) {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'grapheme' }
      ) => {
        segment(input: string): Iterable<{ segment: string }>;
      };
    }
  ).Segmenter;
  if (!Segmenter) return Array.from(value);
  return Array.from(
    new Segmenter('zh-TW', { granularity: 'grapheme' }).segment(value),
    part => part.segment
  );
}

function approvedIdentityText(
  value: string | undefined,
  maximumGraphemes: number
) {
  if (!value) return '';
  const withoutControls = value
    .replace(
      /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu,
      ' '
    )
    .replace(/\s+/gu, ' ')
    .trim();
  return identityGraphemes(withoutControls).slice(0, maximumGraphemes).join('');
}

function readerDisplayName(user: AuthUser) {
  return approvedIdentityText(user.name, 60) || 'PocketStocks 讀者';
}

function readerDisplayEmail(user: AuthUser) {
  return approvedIdentityText(user.email, 254);
}

function readerInitials(user: AuthUser) {
  const name = readerDisplayName(user);
  const words = name.split(/\s+/u).filter(Boolean);
  const initials =
    words.length > 1
      ? `${identityGraphemes(words[0])[0] ?? ''}${identityGraphemes(words[words.length - 1])[0] ?? ''}`
      : identityGraphemes(name).slice(0, 2).join('');
  return initials.toLocaleUpperCase('zh-TW') || '讀';
}

async function synchronizeReaderProfile(user: AuthUser) {
  const response = await withReaderDeadline(
    api.get('/api/reader/me'),
    20000,
    'reader_profile_sync'
  );
  const profile = getEntity<ReaderProfile>(response, 'reader');
  if (
    !profile ||
    typeof profile.id !== 'string' ||
    !profile.id ||
    typeof profile.userId !== 'string' ||
    profile.userId !== user.userId
  ) {
    throw { code: 'reader_profile_sync' };
  }
  return profile;
}

function App() {
  const localLibraryScenario = localFixtureScenario();
  const initialLibraryState = publicHashState();
  const initialLibraryQuery = initialLibraryState.query;
  const initialFixtureQuery =
    localLibraryScenario === 'no-results' ? '不存在的研究' : '';
  const initialQuery = initialLibraryQuery || initialFixtureQuery;
  const [view, setView] = useState<View>('library');
  const [adminDirty, setAdminDirty] = useState(false);
  const adminDirtyRef = useRef(false);
  const lastAppRouteRef = useRef(publicHashState().route);
  const lastAppHashRef = useRef(window.location.hash || '#/');
  const updateAdminDirty = useMemo(() => (dirty: boolean) => {
    adminDirtyRef.current = dirty;
    if (publicHashState().route.startsWith('/admin')) lastAppHashRef.current = window.location.hash;
    setAdminDirty(dirty);
  }, []);
  const adminNavigationApprovedRef = useRef(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [detailRouteStatus, setDetailRouteStatus] =
    useState<DetailRouteStatus>('idle');
  const [detailRouteId, setDetailRouteId] = useState('');
  const [discussionId, setDiscussionId] = useState('');
  const readerReadingSnapshotsRef = useRef(
    new Map<string, ReaderReadingSnapshot>()
  );
  const [readerRoute, setReaderRoute] = useState<ReaderRouteState>({
    reader: false,
    pageIndex: null,
    invalidPage: false,
  });
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [sector, setSector] = useState(
    initialLibraryState.sector ||
      (localLibraryScenario === 'active-filter'
        ? 'Semiconductors'
        : 'All sectors')
  );
  const [tag, setTag] = useState(initialLibraryState.tag || 'All tags');
  const [loading, setLoading] = useState(true);
  const [libraryLoadError, setLibraryLoadError] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [readerUser, setReaderUser] = useState<AuthUser | null>(null);
  const [readerProfile, setReaderProfile] = useState<ReaderProfile | null>(
    null
  );
  const [favoriteArticleIds, setFavoriteArticleIds] = useState<Set<string>>(
    () => new Set()
  );
  const [favoriteSummaries, setFavoriteSummaries] = useState<FavoriteSummary[]>(
    []
  );
  const [readerReviews, setReaderReviews] = useState<PrivateReview[]>([]);
  const [readerComments, setReaderComments] = useState<OwnedPublicComment[]>(
    []
  );
  const [readerLibraryArticles, setReaderLibraryArticles] = useState<Article[]>(
    []
  );
  const [readerLibraryStatus, setReaderLibraryStatus] =
    useState<ReaderLibraryStatus>('idle');
  const [readerLibraryTab, setReaderLibraryTab] =
    useState<ReaderLibraryTab>('favorites');
  const [favoritesHydrating, setFavoritesHydrating] = useState(false);
  const [libraryHeadingFocusRequest, setLibraryHeadingFocusRequest] =
    useState(0);
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(
    () => new Set()
  );
  const [favoriteFeedback, setFavoriteFeedback] =
    useState<FavoriteFeedback>(null);
  const [readerSessionEpoch, setReaderSessionEpoch] = useState(0);
  const [readerAuthHydrating, setReaderAuthHydrating] = useState(true);
  const [readerFormResetKey, setReaderFormResetKey] = useState(0);
  const [, setReaderAuthHint] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInChoiceOpen, setSignInChoiceOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const signInPendingRef = useRef(false);
  const [signInError, setSignInError] = useState('');
  const [signInPendingNotice, setSignInPendingNotice] = useState('');
  const [commentDraftRestore, setCommentDraftRestore] =
    useState<CommentDraft | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountImageFailed, setAccountImageFailed] = useState(false);
  const [readerLogoutStatus, setReaderLogoutStatus] =
    useState<ReaderLogoutStatus>('idle');
  const [reviewFocusRequest, setReviewFocusRequest] = useState<string | null>(
    null
  );
  const authDialogRef = useRef<HTMLDivElement>(null);
  const signInActionRef = useRef<HTMLButtonElement>(null);
  const readerAccountTriggerRef = useRef<HTMLButtonElement>(null);
  const readerAccountControlRef = useRef<HTMLDivElement>(null);
  const readerAccountFirstActionRef = useRef<HTMLButtonElement>(null);
  const signInChooserTriggerRef = useRef<HTMLButtonElement>(null);
  const signInChooserControlRef = useRef<HTMLDivElement>(null);
  const authTriggerRef = useRef<HTMLElement | null>(null);
  const returnIntentRef = useRef<ReaderReturnIntent | null>(null);
  const selectedArticleRef = useRef<Article | null>(null);
  const detailRequestVersionRef = useRef(0);
  const publicBookCacheRef = useRef(
    new Map<string, { article: Article; loadedAt: number }>()
  );
  const publicBookRequestsRef = useRef(new Map<string, Promise<Article>>());
  const publicBookCacheGenerationRef = useRef(0);
  const restoredLibraryRouteRef = useRef(false);
  const catalogLoadedRef = useRef(false);
  const publicCatalogRequestRef = useRef<Promise<Article[]> | null>(null);
  const catalogRequestPendingRef = useRef(false);
  const catalogRefreshQueuedRef = useRef(false);
  const readerLibraryReturnRef = useRef<ReaderLibraryTab | null>(null);

  const readerProfileRef = useRef<ReaderProfile | null>(null);
  const readerSessionGenerationRef = useRef(0);
  const favoriteArticleIdsRef = useRef<Set<string>>(new Set());
  const favoriteSummariesRef = useRef<FavoriteSummary[]>([]);
  const pendingFavoriteIdsRef = useRef<Set<string>>(new Set());
  const favoriteRequestVersionRef = useRef<Map<string, number>>(new Map());
  const readerLibraryRequestRef = useRef(0);
  const readerLogoutAttemptRef = useRef(0);

  useEffect(() => {
    selectedArticleRef.current = selectedArticle;
  }, [selectedArticle]);

  useEffect(() => {
    if (view === 'active-etf' || view === 'institutional-flows') return;
    const labels: Partial<Record<View, string>> = {
      library: '研究書庫', discussion: '討論吧', 'my-library': '我的書庫',
      suggestions: '意見箱', 'research-interest': '研究需求', calendar: '投資行事曆', admin: '作者工作區',
    };
    const title = view === 'article' ? selectedArticle?.title || '研究內容' : labels[view];
    document.title = `${title} — PocketStocks · 本機 Staging`;
  }, [view, selectedArticle?.title]);

  function replaceFavoriteIds(articleIds: Iterable<string>) {
    const next = new Set(articleIds);
    favoriteArticleIdsRef.current = next;
    setFavoriteArticleIds(next);
  }

  function replaceFavoriteSummaries(favorites: FavoriteSummary[]) {
    favoriteSummariesRef.current = favorites;
    setFavoriteSummaries(favorites);
    replaceFavoriteIds(favorites.map(favorite => favorite.articleId));
  }

  function setFavoritePending(articleId: string, pending: boolean) {
    const next = new Set(pendingFavoriteIdsRef.current);
    if (pending) next.add(articleId);
    else next.delete(articleId);
    pendingFavoriteIdsRef.current = next;
    setPendingFavoriteIds(next);
  }

  function resetReaderPrivateState() {
    readerSessionGenerationRef.current += 1;
    readerLibraryRequestRef.current += 1;
    setReaderSessionEpoch(readerSessionGenerationRef.current);
    readerProfileRef.current = null;
    favoriteRequestVersionRef.current.clear();
    pendingFavoriteIdsRef.current = new Set();
    setPendingFavoriteIds(new Set());
    replaceFavoriteSummaries([]);
    setReaderReviews([]);
    setReaderComments([]);
    setReaderLibraryArticles([]);
    setReaderLibraryStatus('idle');
    setFavoritesHydrating(false);
    setFavoriteFeedback(null);
    setReviewFocusRequest(null);
    setCommentDraftRestore(null);
    setSignInPendingNotice('');
    setAccountOpen(false);
    setAccountImageFailed(false);
  }

  function activateReaderIdentity(user: AuthUser, profile: ReaderProfile) {
    resetReaderPrivateState();
    readerLogoutAttemptRef.current += 1;
    setReaderLogoutPending(false);
    setReaderLogoutStatus('idle');
    readerSessionGenerationRef.current += 1;
    setReaderSessionEpoch(readerSessionGenerationRef.current);
    readerProfileRef.current = profile;
    setReaderUser({
      ...user,
      name: profile.name ?? user.name,
      email: profile.email ?? user.email,
    });
    setReaderProfile(profile);
    return readerSessionGenerationRef.current;
  }

  function clearReaderIdentity(preserveReturnIntent = false) {
    readerLogoutAttemptRef.current += 1;
    setReaderUser(null);
    setReaderProfile(null);
    readerLibraryReturnRef.current = null;
    resetReaderPrivateState();
    if (!preserveReturnIntent) {
      returnIntentRef.current = null;
      authTriggerRef.current = null;
    }
  }

  async function loadPublicCatalog(): Promise<Article[]> {
    if (publicCatalogRequestRef.current) return publicCatalogRequestRef.current;
    // Share concurrent reads only; every later read still checks publication state.
    const request = withReaderDeadline(
      loadPagedEntities<Article>(
        'articles',
        nextToken =>
          api.get(
            '/api/articles' +
              (nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '')
          ),
        article => article.id
      ),
      20000,
      'public_catalog_timeout'
    ).then(articles =>
      articles
        .filter(articleIsPublished)
        .sort(
          (left, right) =>
            right.publicationDate.localeCompare(left.publicationDate) ||
            left.id.localeCompare(right.id)
        )
    );
    publicCatalogRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (publicCatalogRequestRef.current === request)
        publicCatalogRequestRef.current = null;
    }
  }

  async function loadReaderLibrary(
    expectedProfileId: string,
    expectedGeneration: number
  ) {
    if (
      readerSessionGenerationRef.current !== expectedGeneration ||
      readerProfileRef.current?.id !== expectedProfileId
    )
      return false;
    const requestId = readerLibraryRequestRef.current + 1;
    readerLibraryRequestRef.current = requestId;
    const favoriteVersions = new Map(favoriteRequestVersionRef.current);
    const favoritesPendingAtStart = new Set(pendingFavoriteIdsRef.current);
    const isCurrentRequest = () =>
      readerSessionGenerationRef.current === expectedGeneration &&
      readerProfileRef.current?.id === expectedProfileId &&
      readerLibraryRequestRef.current === requestId;
    setFavoritesHydrating(true);
    setReaderLibraryStatus('loading');
    try {
      const [favorites, reviews, publicComments, publishedArticles] =
        await withReaderDeadline(
          Promise.all([
            loadPagedEntities<FavoriteSummary>(
              'favorites',
              nextToken =>
                api.get(
                  '/api/reader/favorites' +
                    (nextToken
                      ? `?nextToken=${encodeURIComponent(nextToken)}`
                      : '')
                ),
              favorite => favorite.articleId,
              isCurrentRequest
            ),
            loadPagedEntities<PrivateReview>(
              'reviews',
              nextToken =>
                api.get(
                  '/api/reader/reviews' +
                    (nextToken
                      ? `?nextToken=${encodeURIComponent(nextToken)}`
                      : '')
                ),
              review => review.articleId,
              isCurrentRequest
            ),
            loadPagedEntities<OwnedPublicComment>(
              'comments',
              nextToken =>
                api.get(
                  '/api/reader/comments' +
                    (nextToken
                      ? `?nextToken=${encodeURIComponent(nextToken)}`
                      : '')
                ),
              comment => comment.id,
              isCurrentRequest
            ),
            loadPublicCatalog(),
          ]),
          20000,
          'reader_library_timeout'
        );
      const publishedIds = new Set(
        publishedArticles.map(article => article.id)
      );
      if (!isCurrentRequest()) return false;
      const activeFavorites = favorites.filter(
        favorite =>
          typeof favorite.articleId === 'string' &&
          publishedIds.has(favorite.articleId) &&
          typeof favorite.createdAt === 'string'
      );
      const changedFavoriteIds = new Set(
        [...favoriteRequestVersionRef.current.keys()].filter(
          articleId =>
            favoriteRequestVersionRef.current.get(articleId) !==
              favoriteVersions.get(articleId) ||
            favoritesPendingAtStart.has(articleId)
        )
      );
      replaceFavoriteSummaries([
        ...activeFavorites.filter(
          favorite => !changedFavoriteIds.has(favorite.articleId)
        ),
        ...favoriteSummariesRef.current.filter(favorite =>
          changedFavoriteIds.has(favorite.articleId)
        ),
      ]);
      setReaderReviews(
        reviews.filter(
          review =>
            typeof review.articleId === 'string' &&
            publishedIds.has(review.articleId) &&
            typeof review.updatedAt === 'string'
        )
      );
      setReaderComments(
        publicComments.filter(comment => publishedIds.has(comment.articleId))
      );
      setReaderLibraryArticles(publishedArticles);
      setReaderLibraryStatus('ready');
      return true;
    } catch (errorValue) {
      if (isCurrentRequest()) {
        if (isUnauthorized(errorValue)) {
          clearReaderIdentity(true);
          setReaderAuthHint(false);
        } else {
          setReaderLibraryStatus('error');
        }
      }
      throw errorValue;
    } finally {
      if (isCurrentRequest()) setFavoritesHydrating(false);
    }
  }

  useEffect(() => {
    if (readerLogoutIsPending()) {
      clearReaderIdentity();
      setReaderAuthHint(false);
      setReaderLogoutStatus('error');
      setReaderAuthHydrating(false);
      return;
    }
    let active = true;
    try {
      setReaderAuthHint(auth.isSignedIn());
    } catch {
      setReaderAuthHint(false);
    }
    async function hydrateReader() {
      try {
        const user = await auth.getUser();
        if (!active) return;
        if (!user) {
          clearReaderIdentity();
          return;
        }
        const profile = await synchronizeReaderProfile(user);
        if (active) {
          const sessionGeneration = activateReaderIdentity(user, profile);
          try {
            await loadReaderLibrary(profile.id, sessionGeneration);
          } catch {
            if (
              active &&
              readerSessionGenerationRef.current === sessionGeneration &&
              readerProfileRef.current?.id === profile.id
            ) {
              setNotice(
                readerLibraryIsReviewsRoute()
                  ? {
                      tone: 'error',
                      message:
                        '評論暫時無法載入。你仍可瀏覽研究，稍後可從「我的評論」重試。',
                    }
                  : {
                      tone: 'error',
                      message:
                        '收藏暫時無法載入。你仍可瀏覽研究，稍後可從收藏按鈕重試。',
                    }
              );
            }
          }
        }
      } catch {
        if (active) {
          clearReaderIdentity();
        }
      } finally {
        if (active) setReaderAuthHydrating(false);
      }
    }
    void hydrateReader();
    return () => {
      active = false;
    };
  }, []);

  function restoreAuthTriggerFocus() {
    window.setTimeout(() => {
      const trigger = authTriggerRef.current;
      if (trigger?.isConnected) {
        trigger.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(
          'main [tabindex="-1"], main button:not([disabled])'
        )
        ?.focus();
    }, 0);
  }

  function scheduleReaderFocus(
    target: () => HTMLElement | null | undefined,
    expectedGeneration: number
  ) {
    window.setTimeout(() => {
      if (
        readerSessionGenerationRef.current === expectedGeneration &&
        readerProfileRef.current
      )
        target()?.focus();
    }, 0);
  }

  function readerFavoriteFocusTarget(articleId: string) {
    return (
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-reader-favorite-action]')
      ).find(element => element.dataset.readerFavoriteAction === articleId) ??
      document.getElementById(`book-detail-title-${articleId}`) ??
      document.querySelector<HTMLElement>(
        'main [tabindex="-1"], main button:not([disabled])'
      )
    );
  }

  function dismissReaderSignInBoundary(clearReturnIntent = false) {
    const intent = returnIntentRef.current;
    if (clearReturnIntent) returnIntentRef.current = null;
    setSignInOpen(false);
    setSignInError('');

    if (intent)
      window.setTimeout(() => window.scrollTo({ top: intent.scrollY }), 0);
    restoreAuthTriggerFocus();
  }

  function cancelReaderSignIn() {
    dismissReaderSignInBoundary(!signInPendingRef.current);
  }

  useEffect(() => {
    if (!signInOpen) return;
    const dialog = authDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    if (signingIn) {
      const dismiss = dialog?.querySelector<HTMLButtonElement>(
        '.reader-auth-cancel'
      );
      if (dismiss) dismiss.focus();
      else dialog?.focus();
    } else {
      signInActionRef.current?.focus();
    }
    function containDialogFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelReaderSignIn();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      if (!controls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? controls[controls.length - 1] : controls[0]).focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function keepDialogFocus(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        dialog &&
        !dialog.contains(event.target)
      ) {
        (focusable()[0] ?? dialog).focus();
      }
    }
    document.addEventListener('keydown', containDialogFocus);
    document.addEventListener('focusin', keepDialogFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', containDialogFocus);
      document.removeEventListener('focusin', keepDialogFocus);
    };
  }, [signInOpen, signingIn]);

  useEffect(() => {
    if (!accountOpen || !readerProfileRef.current) return;
    const expectedGeneration = readerSessionGenerationRef.current;
    setAccountImageFailed(false);
    scheduleReaderFocus(
      () => readerAccountFirstActionRef.current,
      expectedGeneration
    );

    function closeOnEscape(event: KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        readerSessionGenerationRef.current !== expectedGeneration ||
        !readerProfileRef.current
      )
        return;
      event.preventDefault();
      setAccountOpen(false);
      scheduleReaderFocus(
        () => readerAccountTriggerRef.current,
        expectedGeneration
      );
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (readerSessionGenerationRef.current !== expectedGeneration) return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        readerAccountControlRef.current?.contains(target)
      )
        return;
      setAccountOpen(false);
      scheduleReaderFocus(
        () => readerAccountTriggerRef.current,
        expectedGeneration
      );
    }

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!signInChoiceOpen || (readerUser && readerProfile)) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSignInChoiceOpen(false);
      window.setTimeout(() => signInChooserTriggerRef.current?.focus(), 0);
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        signInChooserControlRef.current?.contains(target)
      )
        return;
      setSignInChoiceOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [signInChoiceOpen, readerProfile, readerUser]);

  function clearPublicBookCache() {
    publicBookCacheGenerationRef.current += 1;
    publicBookCacheRef.current.clear();
    publicBookRequestsRef.current.clear();
  }

  async function loadPublicBook(articleId: string): Promise<Article> {
    const cached = publicBookCacheRef.current.get(articleId);
    if (cached && Date.now() - cached.loadedAt < 30_000) return cached.article;
    publicBookCacheRef.current.delete(articleId);
    const pending = publicBookRequestsRef.current.get(articleId);
    if (pending) return pending;
    const generation = publicBookCacheGenerationRef.current;
    const request = (async () => {
      const response = await api.get(
        `/api/articles/${encodeURIComponent(articleId)}`
      );
      const article = getEntity<Article>(response, 'article');
      if (!articleIsPublished(article))
        throw new Error('Article is not published');
      if (generation === publicBookCacheGenerationRef.current) {
        if (publicBookCacheRef.current.size >= 8) {
          const oldestKey = publicBookCacheRef.current.keys().next().value;
          if (oldestKey !== undefined)
            publicBookCacheRef.current.delete(oldestKey);
        }
        publicBookCacheRef.current.set(articleId, {
          article,
          loadedAt: Date.now(),
        });
      }
      return article;
    })();
    publicBookRequestsRef.current.set(articleId, request);
    try {
      return await request;
    } finally {
      if (publicBookRequestsRef.current.get(articleId) === request) {
        publicBookRequestsRef.current.delete(articleId);
      }
    }
  }

  async function loadArticles(refresh = true) {
    if (catalogRequestPendingRef.current) {
      if (refresh) catalogRefreshQueuedRef.current = true;
      return;
    }
    catalogRequestPendingRef.current = true;
    clearPublicBookCache();
    setLoading(true);
    setLibraryLoadError(false);
    setNotice(null);
    setArticles([]);
    try {
      setArticles(await loadPublicCatalog());
      catalogLoadedRef.current = true;
    } catch {
      setLibraryLoadError(true);
    } finally {
      catalogRequestPendingRef.current = false;
      setLoading(false);
      if (catalogRefreshQueuedRef.current) {
        catalogRefreshQueuedRef.current = false;
        void loadArticles();
      }
    }
  }

  function submitLibraryQuery(value = query) {
    const nextQuery = normalizeLibraryQuery(value);
    setQuery(nextQuery);
    setSubmittedQuery(nextQuery);
    syncLibraryQueryHistory(nextQuery, sector, tag);
  }

  function clearLibraryQuery() {
    setQuery('');
    setSubmittedQuery('');
    syncLibraryQueryHistory('', sector, tag);
  }

  function updateLibrarySector(value: string) {
    setSector(value);
    syncLibraryQueryHistory(submittedQuery, value, tag);
  }

  function updateLibraryTag(value: string) {
    setTag(value);
    syncLibraryQueryHistory(submittedQuery, sector, value);
  }

  function clearLibraryFilters() {
    setQuery('');
    setSubmittedQuery('');
    setSector('All sectors');
    setTag('All tags');
    syncLibraryQueryHistory('', 'All sectors', 'All tags');
  }

  function readerRouteForArticle(
    route: PublicArticleRoute,
    article: Article
  ): ReaderRouteState {
    if (!route.reader)
      return { reader: false, pageIndex: null, invalidPage: false };
    const pageCount = article.pages?.length ?? 0;
    const invalidPage =
      route.invalidPage ||
      (route.pageIndex !== null && route.pageIndex >= pageCount);
    return {
      reader: true,
      pageIndex: invalidPage ? null : route.pageIndex,
      invalidPage: invalidPage && pageCount > 0,
    };
  }

  useEffect(() => {
    let active = true;
    let routeDecisionPending = false;
    async function restoreRoute(event?: Event) {
      const requestVersion = ++detailRequestVersionRef.current;
      const {
        route: requestedRoute,
        query: routeQuery,
        sector: routeSector,
        tag: routeTag,
      } = publicHashState();
      const previousRoute = lastAppRouteRef.current;
      const previousHash = event instanceof HashChangeEvent && event.oldURL
        ? new URL(event.oldURL).hash : lastAppHashRef.current;
      if (
        previousRoute.startsWith('/admin') &&
        requestedRoute !== previousRoute &&
        adminDirtyRef.current &&
        !adminNavigationApprovedRef.current
      ) {
        // Hold child route listeners until the author decides; otherwise a
        // cancelled hash change can still replace the dirty editor with a list.
        event?.stopImmediatePropagation();
        if (routeDecisionPending) return;
        routeDecisionPending = true;
        const targetHash = window.location.hash;
        const approved = await confirmDiscard('離開作者工作區後，尚未儲存的變更將會遺失。');
        routeDecisionPending = false;
        if (!active) return;
        if (!approved) {
          window.history.replaceState(null, '', previousHash || `#${previousRoute}`);
          return;
        }
        window.history.replaceState(null, '', targetHash);
        adminNavigationApprovedRef.current = true;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }
      adminNavigationApprovedRef.current = false;
      lastAppRouteRef.current = requestedRoute;
      lastAppHashRef.current = window.location.hash || '#/';
      const route = normalizePublicRoute(requestedRoute);
      setMenuOpen(false);
      setAccountOpen(false);
      if (route !== requestedRoute) {
        window.history.replaceState(null, '', `#${route}`);
        setLibraryHeadingFocusRequest(request => request + 1);
      }
      if (route === '/') {
        setSelectedArticle(null);
        if (
          restoredLibraryRouteRef.current ||
          localLibraryScenario !== 'no-results' ||
          routeQuery
        ) {
          setQuery(routeQuery);
          setSubmittedQuery(routeQuery);
        }
        const preserveInitialFixtureFilter =
          !restoredLibraryRouteRef.current &&
          localLibraryScenario === 'active-filter' &&
          !routeSector &&
          !routeTag;
        if (!preserveInitialFixtureFilter) {
          setSector(routeSector || 'All sectors');
          setTag(routeTag || 'All tags');
        }
        restoredLibraryRouteRef.current = true;
        const canonicalHash = libraryHash(routeQuery, routeSector, routeTag);
        if (window.location.hash !== canonicalHash)
          window.history.replaceState(null, '', canonicalHash);
      }
      if (
        route === '/admin' ||
        route === '/admin/reader-feedback' ||
        route === '/admin/active-etf' ||
        route === '/admin/institutional-flows' ||
        route === '/admin/calendar' ||
        adminEditorArticleId(`#${route}`) ||
        route === '/preview' ||
        route.startsWith('/preview/')
      ) {
        setSelectedArticle(null);
        setView('admin');
        return;
      }
      if (
        route === '/reader/suggestions' ||
        route === '/reader/research-interest'
      ) {
        setSelectedArticle(null);
        setView(
          route === '/reader/suggestions' ? 'suggestions' : 'research-interest'
        );
        return;
      }
      if (
        route === '/my-library' ||
        route === '/my-library/favorites' ||
        route === '/my-library/reviews'
      ) {
        setSelectedArticle(null);
        const nextTab: ReaderLibraryTab =
          route === '/my-library/reviews' ? 'reviews' : 'favorites';
        setReaderLibraryTab(nextTab);
        setView('my-library');
        const profile = readerProfileRef.current;
        if (profile)
          void loadReaderLibrary(
            profile.id,
            readerSessionGenerationRef.current
          ).catch(() => undefined);
        return;
      }
      if (route === '/discussion' || route.startsWith('/discussion/')) {
        setView('discussion');
        setSelectedArticle(null);
        setReaderRoute({ reader: false, pageIndex: null, invalidPage: false });
        if (!catalogLoadedRef.current) void loadArticles(false);
        const rawId =
          route === '/discussion' ? '' : route.slice('/discussion/'.length);
        let articleId = '';
        try {
          articleId = decodeURIComponent(rawId);
        } catch {
          articleId = '';
        }
        setDiscussionId(rawId ? articleId || rawId : '');
        setDetailRouteId(articleId);
        if (!rawId) {
          setDetailRouteStatus('idle');
          return;
        }
        if (
          !articleId ||
          articleId.length > 200 ||
          /[\\/\u0000-\u001F\u007F?#]/u.test(articleId)
        ) {
          setDetailRouteStatus('unavailable');
          return;
        }
        setDetailRouteStatus('loading');
        try {
          const book = await loadPublicBook(articleId);
          if (active && requestVersion === detailRequestVersionRef.current) {
            setSelectedArticle(book);
            setDetailRouteStatus('idle');
          }
        } catch (caught) {
          if (active && requestVersion === detailRequestVersionRef.current)
            setDetailRouteStatus(
              getErrorStatus(caught) === 404 ? 'unavailable' : 'error'
            );
        }
        return;
      }
      const articleRoute = parsePublicArticleRoute(route);
      if (articleRoute) {
        const articleId = articleRoute.articleId;
        const cachedBook = publicBookCacheRef.current.get(articleId);
        const currentArticle =
          cachedBook && Date.now() - cachedBook.loadedAt < 30_000
            ? cachedBook.article
            : null;
        if (currentArticle) {
          setView('article');
          setSelectedArticle(currentArticle);
          setDetailRouteId(articleId);
          setDetailRouteStatus('idle');
          setReaderRoute(readerRouteForArticle(articleRoute, currentArticle));
          return;
        }
        setView('article');
        setSelectedArticle(null);
        setReaderRoute({
          reader: articleRoute.reader,
          pageIndex: null,
          invalidPage: false,
        });
        setDetailRouteId(articleId);
        setDetailRouteStatus('loading');
        try {
          const article = await loadPublicBook(articleId);
          if (active && requestVersion === detailRequestVersionRef.current) {
            setSelectedArticle(article);
            setDetailRouteStatus('idle');
            setReaderRoute(readerRouteForArticle(articleRoute, article));
          }
        } catch (errorValue) {
          if (active && requestVersion === detailRequestVersionRef.current) {
            setSelectedArticle(null);
            setReaderRoute({
              reader: false,
              pageIndex: null,
              invalidPage: false,
            });
            setDetailRouteStatus(
              getErrorStatus(errorValue) === 404 ? 'unavailable' : 'error'
            );
          }
        }
        return;
      }
      if (route === '/calendar') { setSelectedArticle(null); setView('calendar'); return; }
      if (route === '/institutional-flows' || route.startsWith('/institutional-flows/')) { setSelectedArticle(null); setView('institutional-flows'); return; }
      if (route === '/active-etf' || route.startsWith('/active-etf/')) {
        setSelectedArticle(null);
        setView('active-etf');
        return;
      }
      if (route !== '/') window.history.replaceState(null, '', '#/');
      setSelectedArticle(null);
      if (!catalogLoadedRef.current) void loadArticles(false);
      setView('library');
    }
    if (!window.location.hash) window.history.replaceState(null, '', '#/');
    void restoreRoute();
    window.addEventListener('hashchange', restoreRoute, true);
    window.addEventListener('popstate', restoreRoute, true);
    return () => {
      active = false;
      window.removeEventListener('hashchange', restoreRoute, true);
      window.removeEventListener('popstate', restoreRoute, true);
    };
  }, []);

  useEffect(() => {
    if (!libraryHeadingFocusRequest || view !== 'library' || loading) return;
    const focusHeading = () =>
      document.getElementById('featured-book-title')?.focus();
    const frame = window.requestAnimationFrame(focusHeading);
    return () => window.cancelAnimationFrame(frame);
  }, [libraryHeadingFocusRequest, view, loading, articles.length]);

  async function navigate(nextView: View) {
    if (view === 'admin' && nextView !== 'admin' && adminDirty) {
      if (!await confirmDiscard('離開作者工作區後，尚未儲存的變更將會遺失。')) return;
      adminNavigationApprovedRef.current = true;
    }
    setView(nextView);
    if (nextView !== 'article') {
      ++detailRequestVersionRef.current;
      setSelectedArticle(null);
      setDetailRouteStatus('idle');
    }
    setMenuOpen(false);
    setAccountOpen(false);
    setSignInChoiceOpen(false);
    const route =
      nextView === 'library'
        ? '/'
        : nextView === 'suggestions' || nextView === 'research-interest'
          ? `/reader/${nextView}`
          : `/${nextView}`;
    if (window.location.hash !== `#${route}`) window.location.hash = route;
    window.setTimeout(() => {
      adminNavigationApprovedRef.current = false;
    }, 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReaderLibrary(tab: ReaderLibraryTab) {
    const profile = readerProfileRef.current;
    if (!profile) return;
    setAccountOpen(false);
    setReaderLibraryTab(tab);
    setView('my-library');
    const route = `#/my-library/${tab}`;
    if (window.location.hash !== route) window.location.hash = route;
    else
      void loadReaderLibrary(
        profile.id,
        readerSessionGenerationRef.current
      ).catch(() => undefined);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectReaderLibraryTab(tab: ReaderLibraryTab) {
    setReaderLibraryTab(tab);
    const route = `#/my-library/${tab}`;
    if (window.location.hash !== route) window.location.hash = route;
  }

  function returnToReaderLibrary(tab: ReaderLibraryTab) {
    readerLibraryReturnRef.current = null;
    setReaderLibraryTab(tab);
    setView('my-library');
    const route = `#/my-library/${tab}`;
    if (window.location.hash !== route) window.location.hash = route;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(
      () => document.getElementById(`reader-library-${tab}-tab`)?.focus(),
      0
    );
  }

  function openArticle(article: Article) {
    const previousReading = readerReadingSnapshotsRef.current.get(article.id);
    if (previousReading)
      readerReadingSnapshotsRef.current.set(article.id, {
        ...previousReading,
        railOpen: false,
      });
    readerLibraryReturnRef.current = null;
    if (!articleIsPublished(article)) {
      setSelectedArticle(null);
      setNotice({ tone: 'error', message: '這份公開研究目前無法閱讀。' });
      navigate('library');
      return;
    }
    setNotice(null);
    const articleIdentifier = article.slug ?? article.id;
    const route = `#/article/${encodeURIComponent(articleIdentifier)}/read/page-1`;
    if (window.location.hash === route)
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = route;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openLibraryArticle(article: Article) {
    readerLibraryReturnRef.current = null;
    if (!articleIsPublished(article)) {
      setSelectedArticle(null);
      setNotice({ tone: 'error', message: '這份公開研究目前無法閱讀。' });
      navigate('library');
      return;
    }
    setNotice(null);
    const articleIdentifier = article.slug ?? article.id;
    const route = `#/article/${encodeURIComponent(articleIdentifier)}`;
    if (window.location.hash === route)
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = route;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function retryDetailRoute() {
    if (!detailRouteId) return;
    clearPublicBookCache();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function openDiscussion(article: Article | null = null) {
    const route = article
      ? `#/discussion/${encodeURIComponent(article.slug ?? article.id)}`
      : '#/discussion';
    if (window.location.hash !== route) window.location.hash = route;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openReaderRoute(article: Article, pageIndex: number) {
    if (pageIndex < 0 || pageIndex >= (article.pages?.length ?? 0)) return;
    const articleIdentifier = article.slug ?? article.id;
    const route = `#/article/${encodeURIComponent(articleIdentifier)}/read/page-${pageIndex + 1}`;
    if (window.location.hash !== route) window.location.hash = route;
  }

  function closeReaderRoute(article: Article) {
    const articleIdentifier = article.slug ?? article.id;
    const route = `#/article/${encodeURIComponent(articleIdentifier)}`;
    if (window.location.hash !== route) window.location.hash = route;
  }

  function isValidReaderReturnIntent(
    value: unknown
  ): value is ReaderReturnIntent {
    if (!value || typeof value !== 'object') return false;
    const intent = value as Partial<ReaderReturnIntent>;
    const isPublishedArticleId = (articleId: string) => {
      if (
        selectedArticle &&
        articleIsPublished(selectedArticle) &&
        (selectedArticle.id === articleId || selectedArticle.slug === articleId)
      )
        return true;
      return articles.some(
        article =>
          articleIsPublished(article) &&
          (article.id === articleId || article.slug === articleId)
      );
    };
    const samePublishedArticle = (left: string, right: string) => {
      const candidates = [selectedArticle, ...articles].filter(
        (article): article is Article =>
          Boolean(article && articleIsPublished(article))
      );
      return candidates.some(
        article =>
          (article.id === left || article.slug === left) &&
          (article.id === right || article.slug === right)
      );
    };
    const isValidDraft = (draft: unknown): draft is CommentDraft | null =>
      draft === null ||
      (Boolean(draft) &&
        typeof draft === 'object' &&
        typeof (draft as CommentDraft).displayName === 'string' &&
        (draft as CommentDraft).displayName.length <= 50 &&
        typeof (draft as CommentDraft).body === 'string' &&
        (draft as CommentDraft).body.length <= 1_000);
    if (
      typeof intent.route !== 'string' ||
      intent.route.length === 0 ||
      intent.route.length > 512 ||
      !intent.route.startsWith('/') ||
      !isValidDraft(intent.draft)
    )
      return false;
    const route = publicHashState(`#${intent.route}`).route;
    const articleRoute = parsePublicArticleRoute(route);
    const routeMatchesArticle = (articleId: string) =>
      Boolean(
        articleRoute &&
        !articleRoute.reader &&
        samePublishedArticle(articleRoute.articleId, articleId)
      );
    if (
      typeof intent.scrollY !== 'number' ||
      !Number.isFinite(intent.scrollY) ||
      intent.scrollY < 0
    )
      return false;
    if (intent.kind === 'reader-form')
      return (
        route === '/reader/suggestions' || route === '/reader/research-interest'
      );
    if (intent.kind === 'article-detail') {
      return (
        typeof intent.articleId === 'string' &&
        isPublishedArticleId(intent.articleId) &&
        routeMatchesArticle(intent.articleId)
      );
    }
    if (intent.kind === 'protected-reader-action') {
      if (intent.action === 'account-menu') {
        if (
          route === '/' || isReaderAccountDestination(route) ||
          Boolean(
            articleRoute &&
            isPublishedArticleId(articleRoute.articleId) &&
            !articleRoute.invalidPage
          )
        )
          return true;
        if (route === '/discussion') return true;
        if (!route.startsWith('/discussion/')) return false;
        try {
          const articleId = decodeURIComponent(
            route.slice('/discussion/'.length)
          );
          return Boolean(
            articleId &&
            articleId.length <= 200 &&
            !/[\\/\u0000-\u001F\u007F?#]/u.test(articleId) &&
            isPublishedArticleId(articleId)
          );
        } catch {
          return false;
        }
      }
      return (
        (intent.action === 'favorite-add' || intent.action === 'review-edit') &&
        typeof intent.articleId === 'string' &&
        isPublishedArticleId(intent.articleId) &&
        routeMatchesArticle(intent.articleId)
      );
    }
    return false;
  }

  function requestReaderSignIn(
    intent: ReaderReturnIntent,
    trigger: HTMLElement
  ) {
    if (view === 'admin' || !isValidReaderReturnIntent(intent)) {
      setNotice({
        tone: 'error',
        message: '這個登入返回目標不受支援。請從公開研究書店重新開始。',
      });
      return;
    }
    if (signInPendingRef.current) {
      authTriggerRef.current = trigger;
      setSignInPendingNotice('登入仍在進行中，請完成原本的登入視窗。');
      setSignInOpen(true);
      return;
    }
    authTriggerRef.current = trigger;
    returnIntentRef.current = intent;
    setAccountOpen(false);
    setSignInChoiceOpen(false);
    setSignInError('');
    setSignInPendingNotice('');

    setSignInOpen(true);
  }

  function openReaderSignInFromChooser() {
    const trigger = signInChooserTriggerRef.current;
    if (!trigger) return;
    requestReaderSignIn(
      {
        kind: 'protected-reader-action',
        action: 'account-menu',
        route: publicReturnRoute(),
        scrollY: window.scrollY,
        draft: null,
      },
      trigger
    );
  }

  async function consumeReaderReturnIntent() {
    const intent = returnIntentRef.current;
    const expectedGeneration = readerSessionGenerationRef.current;
    const currentSelectedArticle = selectedArticleRef.current;
    returnIntentRef.current = null;
    if (!intent || !isValidReaderReturnIntent(intent)) {
      setCommentDraftRestore(null);
      setNotice({
        tone: 'error',
        message: '登入已完成，但原本的返回目標已失效。你仍可繼續瀏覽公開書店。',
      });
      return;
    }
    setCommentDraftRestore(intent.draft);
    if (window.location.hash !== `#${intent.route}`)
      window.history.replaceState(null, '', `#${intent.route}`);
    if (intent.kind === 'reader-form') {
      setView(
        intent.route === '/reader/suggestions'
          ? 'suggestions'
          : 'research-interest'
      );
      window.setTimeout(
        () =>
          document
            .getElementById('reader-form-title')
            ?.scrollIntoView({ block: 'start' }),
        0
      );
      return;
    }
    if (intent.kind === 'article-detail') {
      const article =
        articles.find(
          item =>
            articleIsPublished(item) &&
            (item.id === intent.articleId || item.slug === intent.articleId)
        ) ??
        (currentSelectedArticle &&
        articleIsPublished(currentSelectedArticle) &&
        (currentSelectedArticle.id === intent.articleId ||
          currentSelectedArticle.slug === intent.articleId)
          ? currentSelectedArticle
          : null);
      if (!article) {
        setCommentDraftRestore(null);
        return;
      }
      if (
        !currentSelectedArticle ||
        (currentSelectedArticle.id !== article.id &&
          currentSelectedArticle.slug !== article.slug)
      ) {
        await openArticle(article);
      }
      window.setTimeout(() => window.scrollTo({ top: intent.scrollY }), 0);
      scheduleReaderFocus(
        () => readerAccountTriggerRef.current,
        expectedGeneration
      );
      return;
    }
    if (intent.action === 'favorite-add') {
      const article =
        articles.find(
          item =>
            articleIsPublished(item) &&
            (item.id === intent.articleId || item.slug === intent.articleId)
        ) ??
        (currentSelectedArticle &&
        articleIsPublished(currentSelectedArticle) &&
        (currentSelectedArticle.id === intent.articleId ||
          currentSelectedArticle.slug === intent.articleId)
          ? currentSelectedArticle
          : null);
      if (!article) {
        setCommentDraftRestore(null);
        return;
      }
      if (!currentSelectedArticle || currentSelectedArticle.id !== article.id)
        await openArticle(article);
      window.setTimeout(() => window.scrollTo({ top: intent.scrollY }), 0);
      await changeFavorite(article.id, true);
      scheduleReaderFocus(
        () => readerFavoriteFocusTarget(article.id),
        expectedGeneration
      );
      return;
    }
    if (intent.action === 'review-edit') {
      const article =
        articles.find(
          item =>
            articleIsPublished(item) &&
            (item.id === intent.articleId || item.slug === intent.articleId)
        ) ??
        (currentSelectedArticle &&
        articleIsPublished(currentSelectedArticle) &&
        (currentSelectedArticle.id === intent.articleId ||
          currentSelectedArticle.slug === intent.articleId)
          ? currentSelectedArticle
          : null);
      if (!article) {
        setCommentDraftRestore(null);
        return;
      }
      if (!currentSelectedArticle || currentSelectedArticle.id !== article.id)
        await openArticle(article);
      setReviewFocusRequest(article.id);
      window.setTimeout(() => {
        window.scrollTo({ top: intent.scrollY });
      }, 0);
      return;
    }
    setAccountOpen(true);
    window.setTimeout(() => window.scrollTo({ top: intent.scrollY }), 0);
  }

  async function signInReader(reader: 'a' | 'b' = 'a') {
    if (signInPendingRef.current) return;
    signInPendingRef.current = true;
    setSigningIn(true);
    setSignInError('');
    setSignInPendingNotice('正在登入本機測試讀者 ' + reader.toUpperCase() + '…');
    try {
      const user = await signInWithReaderSession(reader);
      setSignInPendingNotice('正在連接你的讀者帳號…');
      const profile = await synchronizeReaderProfile(user);
      const sessionGeneration = activateReaderIdentity(user, profile);
      void loadReaderLibrary(profile.id, sessionGeneration).catch(
        errorValue => {
          if (isUnauthorized(errorValue)) return;
          if (
            readerSessionGenerationRef.current === sessionGeneration &&
            readerProfileRef.current?.id === profile.id
          ) {
            if (readerLibraryIsReviewsRoute()) {
              setNotice({
                tone: 'error',
                message:
                  '評論暫時無法載入。你仍可瀏覽研究，稍後可從「我的評論」重試。',
              });
            } else {
              setFavoriteFeedback({
                articleId: selectedArticle?.id ?? '',
                tone: 'error',
                message: '收藏清單暫時無法載入，請稍後重試。',
              });
            }
          }
        }
      );
      setReaderAuthHint(true);
    } catch (errorValue) {
      clearReaderIdentity(true);
      setSignInError(getAuthErrorMessage(errorValue));

      signInPendingRef.current = false;
      window.setTimeout(() => signInActionRef.current?.focus(), 0);
      setSigningIn(false);
      setSignInOpen(true);
      return;
    }
    setSignInOpen(false);
    signInPendingRef.current = false;
    setSigningIn(false);

    try {
      await consumeReaderReturnIntent();
    } catch {
      returnIntentRef.current = null;
      setNotice({
        tone: 'error',
        message: '登入已完成，但無法恢復原本的閱讀位置。請從公開研究書店繼續。',
      });
      window.setTimeout(() => readerAccountTriggerRef.current?.focus(), 0);
    }
  }

  async function deleteOwnedPublicComment(
    comment: OwnedPublicComment
  ): Promise<boolean> {
    const profileId = readerProfileRef.current?.id;
    const generation = readerSessionGenerationRef.current;
    if (!profileId) return false;
    const isCurrent = () =>
      readerSessionGenerationRef.current === generation &&
      readerProfileRef.current?.id === profileId;
    try {
      const response = await api.post(
        `/api/reader/comments/${encodeURIComponent(comment.articleId)}/${encodeURIComponent(comment.id)}/delete`,
        { confirmation: 'DELETE' }
      );
      if (!isCurrent()) return false;
      const result = getPayload<{ deleted?: boolean; id?: string }>(response);
      if (result.deleted !== true || result.id !== comment.id) return false;
      setReaderComments(current =>
        current.filter(item => item.id !== comment.id)
      );
      publicBookCacheRef.current.delete(comment.articleId);
      publicBookRequestsRef.current.delete(comment.articleId);
      setSelectedArticle(current =>
        current?.id === comment.articleId
          ? {
              ...current,
              comments: current.comments?.filter(item => item.id !== comment.id) ?? [],
            }
          : current
      );
      return true;
    } catch (caught) {
      if (isCurrent() && isUnauthorized(caught)) {
        clearReaderIdentity();
        setNotice({
          tone: 'error',
          message: '讀者登入已失效，請重新登入後再刪除留言。',
        });
      }
      return false;
    }
  }

  async function changeFavorite(articleId: string, favorited: boolean) {
    const profileId = readerProfileRef.current?.id;
    const sessionGeneration = readerSessionGenerationRef.current;
    const isCurrentReaderSession = () =>
      readerSessionGenerationRef.current === sessionGeneration &&
      readerProfileRef.current?.id === profileId;
    if (
      !profileId ||
      !isCurrentReaderSession() ||
      pendingFavoriteIdsRef.current.has(articleId)
    )
      return false;
    const requestVersion =
      (favoriteRequestVersionRef.current.get(articleId) ?? 0) + 1;
    favoriteRequestVersionRef.current.set(articleId, requestVersion);
    const previousFavorited = favoriteArticleIdsRef.current.has(articleId);
    const previousSummary = favoriteSummariesRef.current.find(
      favorite => favorite.articleId === articleId
    );
    if (!isCurrentReaderSession()) return false;
    setFavoritePending(articleId, true);
    setFavoriteFeedback({
      articleId,
      tone: 'success',
      message: favorited ? '正在加入收藏…' : '正在移除收藏…',
    });
    // A removal keeps its card in place until the server confirms it. This avoids
    // presenting a transient empty collection and gives the pending control a
    // stable, accessible location. Adds remain optimistic as before.
    if (favorited) {
      replaceFavoriteSummaries([
        previousSummary ?? { articleId, createdAt: new Date().toISOString() },
        ...favoriteSummariesRef.current.filter(
          favorite => favorite.articleId !== articleId
        ),
      ]);
    }

    try {
      const response = favorited
        ? await api.put(
            `/api/reader/favorites/${encodeURIComponent(articleId)}`
          )
        : await api.delete(
            `/api/reader/favorites/${encodeURIComponent(articleId)}`
          );
      const favorite = getEntity<{
        articleId: string;
        favorited: boolean;
        createdAt?: string;
      }>(response, 'favorite');
      const current =
        favoriteRequestVersionRef.current.get(articleId) === requestVersion &&
        isCurrentReaderSession();
      if (!current) return false;
      if (
        !favorite ||
        favorite.articleId !== articleId ||
        favorite.favorited !== favorited
      ) {
        throw new Error('Unexpected favorite response.');
      }
      replaceFavoriteSummaries(
        favorite.favorited
          ? [
              {
                articleId,
                createdAt:
                  typeof favorite.createdAt === 'string'
                    ? favorite.createdAt
                    : (previousSummary?.createdAt ?? new Date().toISOString()),
              },
              ...favoriteSummariesRef.current.filter(
                item => item.articleId !== articleId
              ),
            ]
          : favoriteSummariesRef.current.filter(
              item => item.articleId !== articleId
            )
      );
      setFavoriteFeedback({
        articleId,
        tone: 'success',
        message: favorite.favorited ? '已加入收藏。' : '已移除收藏。',
      });
      return true;
    } catch (errorValue) {
      const current =
        favoriteRequestVersionRef.current.get(articleId) === requestVersion &&
        isCurrentReaderSession();
      if (!current) return false;
      if (isUnauthorized(errorValue)) {
        clearReaderIdentity();
        setReaderAuthHint(false);
        setNotice({
          tone: 'error',
          message: '讀者登入已失效，請重新登入後再收藏。',
        });
        return false;
      }
      replaceFavoriteSummaries(
        previousFavorited
          ? [
              previousSummary ?? {
                articleId,
                createdAt: new Date().toISOString(),
              },
              ...favoriteSummariesRef.current.filter(
                favorite => favorite.articleId !== articleId
              ),
            ]
          : favoriteSummariesRef.current.filter(
              favorite => favorite.articleId !== articleId
            )
      );
      setFavoriteFeedback({
        articleId,
        tone: 'error',
        message:
          getErrorStatus(errorValue) === 404
            ? '這本研究目前無法收藏，可能已停止公開。'
            : favorited
              ? '未能加入收藏，已還原原本狀態。'
              : '未能移除收藏，已還原原本狀態。',
        retryFavorited: favorited,
      });
      return false;
    } finally {
      if (
        favoriteRequestVersionRef.current.get(articleId) === requestVersion &&
        isCurrentReaderSession()
      ) {
        setFavoritePending(articleId, false);
      }
    }
  }

  async function completeRemoteReaderSignOut(attempt: number) {
    try {
      await auth.signOut();
      if (
        readerLogoutAttemptRef.current !== attempt ||
        readerProfileRef.current
      )
        return;
      setReaderLogoutPending(false);
      setReaderLogoutStatus('idle');
      setNotice({ tone: 'success', message: '已登出讀者帳號。' });
    } catch {
      if (
        readerLogoutAttemptRef.current !== attempt ||
        readerProfileRef.current
      )
        return;
      setReaderLogoutStatus('error');
      setNotice(null);
    }
  }

  function signOutReader() {
    setReaderFormResetKey(key => key + 1);
    setReaderLogoutPending(true);
    clearReaderIdentity();
    const attempt = readerLogoutAttemptRef.current;
    setReaderAuthHint(false);
    setSignInOpen(false);
    setSigningIn(false);
    setSignInError('');
    setReaderLogoutStatus('pending');
    setNotice(null);
    window.setTimeout(() => void completeRemoteReaderSignOut(attempt), 0);
  }

  function retryReaderSignOut() {
    if (readerProfileRef.current || readerLogoutStatus === 'pending') return;
    const attempt = readerLogoutAttemptRef.current + 1;
    readerLogoutAttemptRef.current = attempt;
    setReaderLogoutStatus('pending');
    window.setTimeout(() => void completeRemoteReaderSignOut(attempt), 0);
  }

  function retryReaderLibrary() {
    setNotice(null);
    const profile = readerProfileRef.current;
    if (profile)
      void loadReaderLibrary(
        profile.id,
        readerSessionGenerationRef.current
      ).catch(() => undefined);
  }

  const sectors = useMemo(
    () => [
      'All sectors',
      ...new Set(articles.map(article => article.sector).filter(Boolean)),
    ],
    [articles]
  );
  const tags = useMemo(
    () => [
      'All tags',
      ...new Set(articles.flatMap(article => article.tags ?? [])),
    ],
    [articles]
  );
  const filteredArticles = useMemo(() => {
    const normalized = submittedQuery.toLocaleLowerCase();
    return articles.filter(article => {
      const matchesText =
        !normalized ||
        [
          article.title,
          article.summary,
          article.sector,
          ...(article.tags ?? []),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalized);
      const matchesSector =
        sector === 'All sectors' || article.sector === sector;
      const matchesTag = tag === 'All tags' || article.tags?.includes(tag);
      return matchesText && matchesSector && matchesTag;
    });
  }, [articles, submittedQuery, sector, tag]);

  const readerAccountControl =
    view !== 'admin' ? (
      <div
        ref={readerAccountControlRef}
        className="reader-account-control"
        data-reader-account-state={
          readerUser && readerProfile
            ? accountOpen
              ? 'open'
              : 'closed'
            : readerLogoutStatus === 'pending'
              ? 'pending'
              : readerLogoutStatus === 'error'
                ? 'error'
                : 'signed-out'
        }
      >
        {readerUser && readerProfile && !readerAuthHydrating ? (
          <>
            <button
              ref={readerAccountTriggerRef}
              className="reader-account-trigger"
              type="button"
              aria-expanded={accountOpen}
              aria-controls="reader-account-panel"
              aria-label={accountOpen ? '關閉讀者帳號選單' : '開啟讀者帳號選單'}
              onClick={() => setAccountOpen(open => !open)}
            >
              <span aria-hidden="true">{readerInitials(readerUser)}</span>
              <strong>讀者帳號</strong>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {accountOpen && (
              <section
                id="reader-account-panel"
                className="reader-account-panel"
                aria-labelledby="reader-account-heading"
              >
                <div className="reader-account-identity">
                  {readerUser.picture && !accountImageFailed ? (
                    <img
                      src={readerUser.picture}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={() => setAccountImageFailed(true)}
                    />
                  ) : (
                    <span aria-hidden="true">{readerInitials(readerUser)}</span>
                  )}
                  <div>
                    <small>已登入讀者帳號</small>
                    <h2 id="reader-account-heading">
                      {readerDisplayName(readerUser)}
                    </h2>
                    {readerDisplayEmail(readerUser) && (
                      <p>{readerDisplayEmail(readerUser)}</p>
                    )}
                  </div>
                </div>
                <div
                  className="reader-account-destinations"
                  aria-label="我的書庫捷徑"
                >
                  <button
                    ref={readerAccountFirstActionRef}
                    type="button"
                    onClick={() => openReaderLibrary('favorites')}
                  >
                    <Heart size={15} /> 我的收藏
                  </button>
                  <button
                    type="button"
                    onClick={() => openReaderLibrary('reviews')}
                  >
                    <MessageSquare size={15} /> 我的評論
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('research-interest')}
                  >
                    <BookOpen size={15} /> 研究需求
                  </button>
                  <button type="button" onClick={() => navigate('suggestions')}>
                    <Send size={15} /> 意見箱
                  </button>
                </div>
                <button
                  className="reader-account-sign-out"
                  type="button"
                  onClick={signOutReader}
                >
                  <LogOut size={15} /> 登出讀者帳號
                </button>
              </section>
            )}
          </>
        ) : (
          <div ref={signInChooserControlRef} className="login-chooser-control">
            <button
              ref={signInChooserTriggerRef}
              className="login-chooser-trigger"
              type="button"
              aria-expanded={signInChoiceOpen}
              aria-controls="login-chooser-panel"
              aria-label={signInChoiceOpen ? '關閉登入選單' : '開啟登入選單'}
              onClick={() => setSignInChoiceOpen(open => !open)}
            >
              <LogIn size={15} /> 登入{' '}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {signInChoiceOpen && (
              <section
                id="login-chooser-panel"
                className="login-chooser-panel"
                aria-labelledby="login-chooser-heading"
              >
                <h2 id="login-chooser-heading">選擇登入方式</h2>
                <button
                  type="button"
                  disabled={
                    readerAuthHydrating || readerLogoutStatus === 'pending'
                  }
                  aria-busy={readerAuthHydrating || readerLogoutStatus === 'pending'}
                  onClick={openReaderSignInFromChooser}
                >
                  <BookOpen size={15} aria-hidden="true" />
                  <span className="login-choice-copy">
                    <strong>
                      {readerLogoutStatus === 'pending'
                        ? '讀者登出處理中…'
                        : readerAuthHydrating
                          ? '確認讀者帳號…'
                          : '讀者登入'}
                    </strong>
                    <small>使用本機測試身份，收藏與撰寫評論</small>
                  </span>
                </button>
                <button type="button" onClick={() => navigate('admin')}>
                  <Settings2 size={15} aria-hidden="true" />
                  <span className="login-choice-copy">
                    <strong>管理員登入</strong>
                    <small>進入作者工作區</small>
                  </span>
                </button>
              </section>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      className={`app-shell ${view === 'active-etf' || view === 'institutional-flows' ? 'active-etf-composition' : ''} ${view === 'library' || view === 'active-etf' || view === 'institutional-flows' || view === 'calendar' ? 'public-library' : ''} ${view === 'discussion' ? 'discussion-composition' : ''} ${view === 'my-library' || view === 'suggestions' || view === 'research-interest' ? 'favorites-composition' : ''}`}
    >
      <header
        className={`masthead application-banner ${view === 'library' ? 'public-library-masthead' : ''}`}
        inert={signInOpen}
      >
        <ApplicationBrand onClick={() => navigate('library')} />
        <button
          className="menu-button"
          onClick={() => setMenuOpen(open => !open)}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X /> : <Menu />}
          <span className="sr-only">切換導覽選單</span>
        </button>
        <ApplicationNavigation
          open={menuOpen}
          active={view === 'library' || view === 'article' ? 'library' : view === 'discussion' || view === 'active-etf' || view === 'institutional-flows' || view === 'calendar' ? view : null}
          showDiscussion={['library', 'article', 'discussion', 'active-etf', 'institutional-flows', 'calendar'].includes(view)}
          onLibrary={() => navigate('library')}
          onDiscussion={() => { if (view !== 'discussion') openDiscussion(view === 'article' ? selectedArticle : null); }}
          onEtf={() => navigate('active-etf')}
          onInstitutional={() => navigate('institutional-flows')}
          onCalendar={() => navigate('calendar')}
        >
          {!(view === 'article' && readerRoute.reader) && readerAccountControl}
        </ApplicationNavigation>
      </header>

      {notice && (
        <div
          className={`global-notice ${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.tone === 'error' ? (
            <CircleAlert size={17} />
          ) : (
            <Check size={17} />
          )}
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="關閉訊息">
            <X size={16} />
          </button>
        </div>
      )}

      {readerLogoutStatus !== 'idle' && (
        <div
          className={`reader-logout-notice ${readerLogoutStatus}`}
          role={readerLogoutStatus === 'error' ? 'alert' : 'status'}
          aria-live={readerLogoutStatus === 'error' ? 'assertive' : 'polite'}
          aria-busy={readerLogoutStatus === 'pending'}
        >
          {readerLogoutStatus === 'pending' ? (
            <Info size={16} aria-hidden="true" />
          ) : (
            <CircleAlert size={16} aria-hidden="true" />
          )}
          <div className="reader-logout-copy">
            <strong>
              {readerLogoutStatus === 'pending' ? '登出處理中' : '登出尚未完成'}
            </strong>
            <span>
              {readerLogoutStatus === 'pending'
                ? <PendingIndicator>正在登出讀者帳號…</PendingIndicator>
                : '登出尚未完成，請再試一次。'}
            </span>
          </div>
          {readerLogoutStatus === 'error' && (
            <button type="button" onClick={retryReaderSignOut}>
              重試登出
            </button>
          )}
        </div>
      )}

      <main inert={signInOpen}>
        {view === 'active-etf' && <ActiveEtfView />}
        {view === 'institutional-flows' && <InstitutionalPublic />}
        {view === 'calendar' && <InvestmentCalendar />}
        {view === 'discussion' && (
          <DiscussionView
            article={selectedArticle}
            articles={articles}
            requestedId={discussionId}
            status={detailRouteStatus}
            catalogLoading={loading}
            catalogError={libraryLoadError}
            onRetryCatalog={loadArticles}
            onRetryBook={retryDetailRoute}
            onSelect={book => {
              window.location.hash = `/discussion/${encodeURIComponent(book.slug ?? book.id)}`;
            }}
            readerSignedIn={Boolean(
              readerUser &&
              readerProfile &&
              readerUser.userId === readerProfile.userId &&
              !readerAuthHydrating &&
              readerLogoutStatus === 'idle'
            )}
            readerSessionKey={`${readerSessionEpoch}:${readerProfile?.id ?? 'guest'}:${readerAuthHydrating}:${readerLogoutStatus}`}
            onExpired={() => {
              clearReaderIdentity(true);
              setReaderAuthHint(false);
            }}
          />
        )}
        {(view === 'suggestions' || view === 'research-interest') && (
          <ReaderFormView
            key={view}
            kind={view}
            user={readerUser && readerProfile ? readerUser : null}
            hydrating={readerAuthHydrating}
            resetKey={readerFormResetKey}
            onBack={() => navigate('library')}
            onExpired={() => {
              clearReaderIdentity(true);
              setReaderAuthHint(false);
            }}
            onSignIn={trigger =>
              requestReaderSignIn(
                {
                  kind: 'reader-form',
                  route:
                    view === 'suggestions'
                      ? '/reader/suggestions'
                      : '/reader/research-interest',
                  scrollY: 0,
                  draft: null,
                },
                trigger
              )
            }
          />
        )}
        {view === 'library' && (
          <LibraryView
            articles={filteredArticles}
            totalCount={articles.length}
            loading={loading}
            submittedQuery={submittedQuery}
            query={query}
            onQueryChange={setQuery}
            onSubmitQuery={submitLibraryQuery}
            onClearQuery={clearLibraryQuery}
            onClearFilters={clearLibraryFilters}
            sector={sector}
            setSector={setSector}
            tag={tag}
            setTag={setTag}
            onSectorChange={updateLibrarySector}
            onTagChange={updateLibraryTag}
            sectors={sectors}
            tags={tags}
            onOpen={openLibraryArticle}
            onRetry={loadArticles}
            hasError={libraryLoadError}
          />
        )}
        {view === 'article' && selectedArticle && (
          <ArticleView
            key={selectedArticle.id}
            article={selectedArticle}
            readingSnapshot={readerReadingSnapshotsRef.current.get(
              selectedArticle.id
            )}
            onReadingSnapshot={snapshot =>
              readerReadingSnapshotsRef.current.set(
                selectedArticle.id,
                snapshot
              )
            }
            onDiscussion={() => openDiscussion(selectedArticle)}
            readerRoute={readerRoute.reader ? 'reader' : 'detail'}
            readerPageIndex={readerRoute.pageIndex}
            readerPageInvalid={readerRoute.invalidPage}
            onReaderPageChange={pageIndex =>
              openReaderRoute(selectedArticle, pageIndex)
            }
            onReaderClose={() => closeReaderRoute(selectedArticle)}
            readerSignedIn={Boolean(readerUser && readerProfile)}
            accountControl={readerAccountControl}
            readerSessionKey={
              readerProfile ? `${readerSessionEpoch}:${readerProfile.id}` : ''
            }
            focusPrivateReview={
              reviewFocusRequest === selectedArticle.id ||
              reviewFocusRequest === `view:${selectedArticle.id}` ||
              reviewFocusRequest === `delete:${selectedArticle.id}`
            }
            privateReviewAction={
              reviewFocusRequest === `delete:${selectedArticle.id}`
                ? 'delete'
                : reviewFocusRequest === `view:${selectedArticle.id}`
                  ? 'view'
                  : 'edit'
            }
            favorited={favoriteArticleIds.has(selectedArticle.id)}
            favoritePending={
              pendingFavoriteIds.has(selectedArticle.id) ||
              (Boolean(readerProfile) && favoritesHydrating)
            }
            favoriteFeedback={
              favoriteFeedback?.articleId === selectedArticle.id
                ? favoriteFeedback
                : null
            }
            commentDraftRestore={commentDraftRestore}
            onCommentDraftRestored={() => setCommentDraftRestore(null)}
            onToggleFavorite={(trigger, draft) => {
              if (readerProfileRef.current) {
                void changeFavorite(
                  selectedArticle.id,
                  !favoriteArticleIdsRef.current.has(selectedArticle.id)
                );
                return;
              }
              requestReaderSignIn(
                {
                  kind: 'protected-reader-action',
                  action: 'favorite-add',
                  articleId: selectedArticle.id,
                  route: publicReturnRoute(),
                  scrollY: window.scrollY,
                  draft,
                },
                trigger
              );
            }}
            onRetryFavorite={favorited =>
              void changeFavorite(selectedArticle.id, favorited)
            }
            onReaderSessionExpired={() => {
              clearReaderIdentity();
              setReaderAuthHint(false);
              setNotice({
                tone: 'error',
                message: '讀者登入已失效，請重新登入後再管理評論。',
              });
            }}
            onRequestReviewSignIn={(trigger, draft) =>
              requestReaderSignIn(
                {
                  kind: 'protected-reader-action',
                  action: 'review-edit',
                  articleId: selectedArticle.id,
                  route: publicReturnRoute(),
                  scrollY: window.scrollY,
                  draft,
                },
                trigger
              )
            }
            onPrivateReviewFocused={() => setReviewFocusRequest(null)}
            onPrivateReviewChange={review => {
              setReaderReviews(current => {
                const remaining = current.filter(
                  item => item.articleId !== selectedArticle.id
                );
                return review ? [...remaining, review] : remaining;
              });
            }}
          />
        )}
        {view === 'article' && !selectedArticle && (
          <DetailRouteState
            status={detailRouteStatus}
            onBack={() => navigate('library')}
            onRetry={retryDetailRoute}
          />
        )}
        {view === 'my-library' && (
          <ReaderLibraryView
            signedIn={Boolean(readerProfile)}
            authHydrating={readerAuthHydrating}
            status={readerLibraryStatus}
            activeTab={readerLibraryTab}
            readerSessionKey={
              readerProfile ? `${readerSessionEpoch}:${readerProfile.id}` : ''
            }
            articles={readerLibraryArticles}
            favorites={favoriteSummaries}
            reviews={readerReviews}
            publicComments={readerComments}
            onDeletePublicComment={deleteOwnedPublicComment}
            pendingFavoriteIds={pendingFavoriteIds}
            favoriteFeedback={favoriteFeedback}
            onOpenArticle={openLibraryArticle}
            onOpenReview={async (article, action = 'edit') => {
              const generation = readerSessionGenerationRef.current;
              openLibraryArticle(article);
              if (
                generation !== readerSessionGenerationRef.current ||
                !readerProfileRef.current
              )
                return;
              readerLibraryReturnRef.current = 'reviews';
              setReviewFocusRequest(
                action === 'edit' ? article.id : `${action}:${article.id}`
              );
            }}
            onRemoveFavorite={articleId => changeFavorite(articleId, false)}
            onRetry={retryReaderLibrary}
            onSelectTab={selectReaderLibraryTab}
            onBack={() => navigate('library')}
          />
        )}
        {view === 'admin' && (
          <AdminView
            onDataChanged={loadArticles}
            onDirtyChange={updateAdminDirty}
          />
        )}
      </main>

      {signInOpen && (
        <div className="reader-auth-backdrop">
          <div
            ref={authDialogRef}
            className="reader-auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={signingIn}
            aria-labelledby="reader-auth-title"
            aria-describedby="reader-auth-description"
            tabIndex={-1}
          >
            <div className="reader-auth-topbar">
              <div className="reader-auth-brand">
                <span className="application-banner-mark" aria-hidden="true">
                  <BookOpen size={19} />
                </span>
                <strong>PocketStocks</strong>
              </div>
              <button
                className="reader-auth-close"
                type="button"
                onClick={cancelReaderSignIn}
                aria-label={
                  signingIn
                    ? '關閉對話框並返回閱讀，登入仍在進行中'
                    : '關閉登入視窗'
                }
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="reader-auth-title">本機測試讀者登入</h2>
            <p id="reader-auth-description">
              這是模擬身份，資料只保存在本機，不會登入 Google 或 Email。
              {returnIntentRef.current?.kind === 'protected-reader-action' &&
              returnIntentRef.current.action === 'favorite-add'
                ? '登入後返回這本研究書，繼續完成收藏。'
                : returnIntentRef.current?.kind === 'protected-reader-action' &&
                    returnIntentRef.current.action === 'review-edit'
                  ? '登入後返回這本研究書，繼續撰寫私人評論。'
                  : returnIntentRef.current?.kind === 'reader-form'
                    ? '登入後返回原本的表單，你可以檢查內容後再送出。'
                    : '登入即可收藏研究、撰寫私人評論、提交建議與研究需求。'}
            </p>
            {signingIn && (
              <p
                className="reader-auth-pending"
                role="status"
                aria-live="polite"
              >
                <PendingIndicator>{signInPendingNotice || '請完成原本的登入視窗。返回閱讀不會取消登入視窗。'}</PendingIndicator>
              </p>
            )}
            {signInError && (
              <div className="reader-auth-error" role="alert">
                <CircleAlert size={17} aria-hidden="true" />
                <span>{signInError}</span>
              </div>
            )}
            <button
              ref={signInActionRef}
              className="reader-auth-signup"
              type="button"
              disabled={signingIn} aria-busy={signingIn}
              onClick={() => void signInReader('a')}
            >
              {signingIn ? '正在完成登入…' : '使用測試讀者 A'}
            </button>
            <button
              className="reader-auth-signup"
              type="button"
              disabled={signingIn} aria-busy={signingIn}
              onClick={() => void signInReader('b')}
            >
              使用測試讀者 B
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ReaderLibraryProps = {
  signedIn: boolean;
  authHydrating: boolean;
  status: ReaderLibraryStatus;
  activeTab: ReaderLibraryTab;
  readerSessionKey: string;
  articles: Article[];
  favorites: FavoriteSummary[];
  reviews: PrivateReview[];
  publicComments: OwnedPublicComment[];
  pendingFavoriteIds: Set<string>;
  favoriteFeedback: FavoriteFeedback;
  onOpenArticle: (article: Article) => void;
  onOpenReview: (article: Article, action?: 'view' | 'edit' | 'delete') => void;
  onDeletePublicComment: (comment: OwnedPublicComment) => Promise<boolean>;
  onRemoveFavorite: (articleId: string) => Promise<boolean>;
  onRetry: () => void;
  onSelectTab: (tab: ReaderLibraryTab) => void;
  onBack: () => void;
};

function ReaderLibraryView(props: ReaderLibraryProps) {
  const [deletingComment, setDeletingComment] =
    useState<OwnedPublicComment | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [commentNotice, setCommentNotice] = useState('');
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteBusyRef = useRef(false);

  useEffect(() => {
    setDeletingComment(null);
    setDeletePending(false);
    setDeleteFailed(false);
    setCommentNotice('');
    deleteBusyRef.current = false;
    deleteTriggerRef.current = null;
  }, [props.readerSessionKey]);

  useEffect(() => {
    if (!deletingComment) return;
    deleteCancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!deleteBusyRef.current) closeCommentDelete();
      }
      if (event.key !== 'Tab') return;
      const controls =
        deleteDialogRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)'
        );
      if (!controls?.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deletingComment]);

  function closeCommentDelete() {
    if (deleteBusyRef.current) return;
    setDeletingComment(null);
    setDeleteFailed(false);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  }

  async function confirmCommentDelete() {
    if (!deletingComment || deleteBusyRef.current) return;
    const session = props.readerSessionKey;
    deleteBusyRef.current = true;
    setDeletePending(true);
    setDeleteFailed(false);
    const deleted = await props.onDeletePublicComment(deletingComment);
    if (readerSessionKeyRef.current !== session) return;
    deleteBusyRef.current = false;
    setDeletePending(false);
    if (!deleted) {
      setDeleteFailed(true);
      return;
    }
    setDeletingComment(null);
    setCommentNotice('公開留言已刪除。收藏和私人評論不受影響。');
    window.setTimeout(() => tabRefs.current.reviews?.focus(), 0);
  }

  const tabRefs = useRef<Record<ReaderLibraryTab, HTMLButtonElement | null>>({
    favorites: null,
    reviews: null,
  });
  const readerSessionKeyRef = useRef(props.readerSessionKey);
  readerSessionKeyRef.current = props.readerSessionKey;
  const articleById = useMemo(
    () => new Map(props.articles.map(article => [article.id, article])),
    [props.articles]
  );
  const favorites = useMemo(
    () =>
      props.favorites
        .map(favorite => ({
          favorite,
          article: articleById.get(favorite.articleId),
        }))
        .filter(
          (item): item is { favorite: FavoriteSummary; article: Article } =>
            Boolean(item.article)
        )
        .sort(
          (left, right) =>
            right.favorite.createdAt.localeCompare(left.favorite.createdAt) ||
            right.article.publicationDate.localeCompare(
              left.article.publicationDate
            ) ||
            left.article.id.localeCompare(right.article.id)
        ),
    [props.favorites, articleById]
  );
  const reviews = useMemo(
    () =>
      props.reviews
        .map(review => ({ review, article: articleById.get(review.articleId) }))
        .filter((item): item is { review: PrivateReview; article: Article } =>
          Boolean(item.article)
        )
        .sort(
          (left, right) =>
            right.review.updatedAt.localeCompare(left.review.updatedAt) ||
            right.article.publicationDate.localeCompare(
              left.article.publicationDate
            ) ||
            left.article.id.localeCompare(right.article.id)
        ),
    [props.reviews, articleById]
  );

  function selectTab(tab: ReaderLibraryTab, focus = false) {
    const expectedSessionKey = props.readerSessionKey;
    props.onSelectTab(tab);
    if (focus)
      window.setTimeout(() => {
        if (
          expectedSessionKey &&
          readerSessionKeyRef.current === expectedSessionKey
        )
          tabRefs.current[tab]?.focus();
      }, 0);
  }

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const tabs: ReaderLibraryTab[] = ['favorites', 'reviews'];
    const currentIndex = tabs.indexOf(props.activeTab);
    let next: ReaderLibraryTab | null = null;
    if (event.key === 'ArrowRight')
      next = tabs[(currentIndex + 1) % tabs.length];
    if (event.key === 'ArrowLeft')
      next = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  }

  async function removeFavorite(articleId: string, index: number) {
    const removal = props.onRemoveFavorite(articleId);
    const focusNextRemoval = () =>
      window.setTimeout(() => {
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          '[data-library-remove-favorite]'
        );
        const nextButton =
          buttons[Math.min(index, Math.max(0, buttons.length - 1))];
        if (nextButton) {
          nextButton.focus();
        } else {
          document.getElementById('reader-library-favorites-tab')?.focus();
        }
      }, 0);
    const removed = await removal;
    if (removed) {
      focusNextRemoval();
      return;
    }
    window.setTimeout(() => {
      const failedButton = document.querySelector<HTMLButtonElement>(
        `[data-library-remove-favorite="${CSS.escape(articleId)}"]`
      );
      if (failedButton) {
        failedButton.focus();
      } else {
        document.getElementById('reader-library-favorites-tab')?.focus();
      }
    }, 0);
  }

  const publicComments = props.publicComments
    .map(comment => ({ comment, article: articleById.get(comment.articleId) }))
    .filter((item): item is { comment: OwnedPublicComment; article: Article } =>
      Boolean(item.article)
    )
    .sort(
      (left, right) =>
        right.comment.createdAt.localeCompare(left.comment.createdAt) ||
        left.comment.id.localeCompare(right.comment.id)
    );
  const favoritesView = props.activeTab === 'favorites';
  const privateState = props.authHydrating
    ? 'auth-loading'
    : !props.signedIn
      ? 'session-boundary'
      : props.status;

  return (
    <section
      className={`reader-library ${favoritesView ? 'reader-library-favorites' : 'reader-library-reviews'}`}
      aria-labelledby="reader-library-title"
    >
      <header className="reader-library-header">
        <h1 id="reader-library-title">我的書庫</h1>
      </header>
      <div
        className="reader-library-tabs"
        role="tablist"
        aria-label="我的書庫內容"
        aria-orientation="horizontal"
      >
        <button
          ref={node => {
            tabRefs.current.favorites = node;
          }}
          id="reader-library-favorites-tab"
          type="button"
          role="tab"
          aria-selected={props.activeTab === 'favorites'}
          aria-controls="reader-library-favorites-panel"
          tabIndex={props.activeTab === 'favorites' ? 0 : -1}
          onClick={() => selectTab('favorites')}
          onKeyDown={handleTabKey}
        >
          <Heart size={18} aria-hidden="true" /> 收藏{' '}
          <span aria-live="polite">
            {privateState === 'ready' ? favorites.length : '—'}
          </span>
        </button>
        <button
          ref={node => {
            tabRefs.current.reviews = node;
          }}
          id="reader-library-reviews-tab"
          type="button"
          role="tab"
          aria-selected={props.activeTab === 'reviews'}
          aria-controls="reader-library-reviews-panel"
          tabIndex={props.activeTab === 'reviews' ? 0 : -1}
          onClick={() => selectTab('reviews')}
          onKeyDown={handleTabKey}
        >
          <MessageSquare size={18} aria-hidden="true" /> 我的評論{' '}
          <span aria-live="polite">
            {privateState === 'ready'
              ? reviews.length + publicComments.length
              : '—'}
          </span>
        </button>
      </div>
      {commentNotice && (
        <p className="reader-library-announcement success" role="status">
          {commentNotice}
        </p>
      )}
      {deletingComment && props.signedIn && (
        <div className="review-delete-backdrop">
          <div
            ref={deleteDialogRef}
            className="review-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={deletePending}
            aria-labelledby="public-comment-delete-title"
            aria-describedby="public-comment-delete-copy"
            tabIndex={-1}
          >
            <span className="kicker">刪除確認</span>
            <h2 id="public-comment-delete-title">刪除這則公開留言？</h2>
            <p id="public-comment-delete-copy">
              刪除後無法復原。留言會從公開留言串與「我的評論」移除，收藏和私人評論不受影響。
            </p>
            <p className="reader-library-review-copy">{deletingComment.body}</p>
            {deleteFailed && (
              <div className="review-delete-error" role="alert">
                暫時無法刪除留言，請重試。留言仍保留在清單中。
              </div>
            )}
            <div>
              <button
                ref={deleteCancelRef}
                type="button"
                disabled={deletePending}
                onClick={closeCommentDelete}
              >
                保留留言
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={deletePending}
                onClick={() => void confirmCommentDelete()}
              >
                {deletePending
                  ? '刪除中…'
                  : deleteFailed
                    ? '重試刪除'
                    : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
      {props.favoriteFeedback && (
        <p
          className={`reader-library-announcement ${props.favoriteFeedback.tone}`}
          role={props.favoriteFeedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {props.favoriteFeedback.message}
        </p>
      )}

      {privateState === 'auth-loading' ||
      privateState === 'loading' ||
      privateState === 'idle' ? (
        <ReaderLibrarySkeleton favoritesView={favoritesView} />
      ) : privateState === 'session-boundary' ? (
        <div
          className="reader-library-state reader-library-private-state is-session"
          role="status"
        >
          <LogIn />
          <h2>請重新登入</h2>
          <p>登入狀態已變更。請重新登入以查看你的收藏和評論。</p>
          <button type="button" onClick={props.onBack}>
            返回研究書庫
          </button>
        </div>
      ) : props.status === 'error' ? (
        <div
          className="reader-library-state reader-library-private-state is-error"
          role="alert"
        >
          <CircleAlert />
          <h2>{favoritesView ? '收藏暫時無法使用' : '評論暫時無法使用'}</h2>
          <p>
            {favoritesView
              ? '暫時無法載入收藏，請稍後再試。'
              : '暫時無法載入評論，請稍後再試。'}
          </p>
          <button type="button" onClick={props.onRetry}>
            重試
          </button>
        </div>
      ) : props.activeTab === 'favorites' ? (
        <div
          id="reader-library-favorites-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby="reader-library-favorites-tab"
        >
          {favorites.length === 0 ? (
            <div className="reader-library-state reader-library-private-state is-empty">
              <Heart />
              <h2>還沒有收藏</h2>
              <button type="button" onClick={props.onBack}>
                瀏覽研究書庫
              </button>
            </div>
          ) : (
            <>
              <div
                className="reader-library-favorites-toolbar"
                aria-label="收藏清單摘要"
              >
                <span>{favorites.length} 本已收藏研究</span>
                <span>依收藏時間排序</span>
              </div>
              <div className="reader-library-list reader-library-favorites-grid">
                {favorites.map(({ favorite, article }, index) => (
                  <article key={article.id} className="reader-library-item">
                    <button
                      type="button"
                      className="reader-library-cover"
                      onClick={() => props.onOpenArticle(article)}
                      aria-label={`開啟研究：${article.title}`}
                    >
                      <CoverArtwork article={article} />
                    </button>
                    <div className="reader-library-item-copy">
                      <ArticleMeta article={article} />
                      <h2>{article.title}</h2>
                      <p>{article.summary}</p>
                      <small>
                        收藏於{' '}
                        {new Date(favorite.createdAt).toLocaleDateString(
                          'zh-TW'
                        )}
                      </small>
                    </div>
                    <div className="reader-library-item-actions">
                      <button
                        className="reader-library-open"
                        type="button"
                        onClick={() => props.onOpenArticle(article)}
                      >
                        <BookOpen size={15} /> 開啟研究
                      </button>
                      <button
                        type="button"
                        data-library-remove-favorite={article.id}
                        aria-label={`${props.pendingFavoriteIds.has(article.id) ? '正在移除收藏' : '移除收藏'}：${article.title}`}
                        aria-busy={props.pendingFavoriteIds.has(article.id)}
                        disabled={props.pendingFavoriteIds.has(article.id)}
                        onClick={() => void removeFavorite(article.id, index)}
                      >
                        <Heart size={15} />{' '}
                        {props.pendingFavoriteIds.has(article.id)
                          ? '移除中…'
                          : props.favoriteFeedback?.articleId === article.id &&
                              props.favoriteFeedback.tone === 'error'
                            ? '重試移除收藏'
                            : '移除收藏'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          id="reader-library-reviews-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby="reader-library-reviews-tab"
        >
          {reviews.length + publicComments.length === 0 ? (
            <div className="reader-library-state reader-library-private-state is-empty">
              <MessageSquare />
              <h2>還沒有評論</h2>
              <p>公開留言與私人評論分開保存。</p>
              <button type="button" onClick={props.onBack}>
                探索研究
              </button>
            </div>
          ) : (
            <div className="reader-library-list reader-library-review-list">
              {publicComments.map(({ comment, article }) => (
                <article
                  key={`public-${comment.id}`}
                  className="reader-library-item reader-library-review-item"
                >
                  <button
                    type="button"
                    className="reader-library-cover"
                    onClick={() => props.onOpenArticle(article)}
                    aria-label={`開啟留言研究：${article.title}`}
                  >
                    <CoverArtwork article={article} />
                  </button>
                  <div className="reader-library-item-copy">
                    <small>公開留言 · 所有讀者可見</small>
                    <div className="reader-library-review-heading">
                      <h2>{article.title}</h2>
                      <time dateTime={comment.createdAt}>
                        發表於{' '}
                        {new Date(comment.createdAt).toLocaleDateString(
                          'zh-TW'
                        )}
                      </time>
                    </div>
                    <p className="reader-library-review-copy">{comment.body}</p>
                    <small>顯示名稱：{comment.displayName}</small>
                  </div>
                  <div className="reader-library-item-actions">
                    <button
                      type="button"
                      onClick={() => props.onOpenArticle(article)}
                    >
                      <BookOpen size={15} /> 開啟研究
                    </button>
                    <button
                      type="button"
                      aria-label={`刪除公開留言：${article.title}，${comment.body}`}
                      onClick={event => {
                        deleteTriggerRef.current = event.currentTarget;
                        setDeletingComment(comment);
                        setDeleteFailed(false);
                        setCommentNotice('');
                      }}
                    >
                      <Trash2 size={15} /> 刪除
                    </button>
                  </div>
                </article>
              ))}
              {reviews.map(({ review, article }) => (
                <article
                  key={review.id}
                  className="reader-library-item reader-library-review-item"
                >
                  <button
                    type="button"
                    className="reader-library-cover"
                    onClick={() => props.onOpenReview(article)}
                    aria-label={`開啟評論編輯器：${article.title}`}
                  >
                    <CoverArtwork article={article} />
                  </button>
                  <div className="reader-library-item-copy">
                    <small>私人評論 · 只有你看得到</small>
                    <ArticleMeta article={article} />
                    <div className="reader-library-review-heading">
                      <h2>{article.title}</h2>
                      <time dateTime={review.updatedAt}>
                        更新於{' '}
                        {new Date(review.updatedAt).toLocaleDateString('zh-TW')}
                      </time>
                    </div>
                    <p className="reader-library-review-copy">{review.text}</p>
                  </div>
                  <div className="reader-library-item-actions">
                    <button
                      type="button"
                      aria-label={`查看評論：${article.title}`}
                      onClick={() => props.onOpenReview(article, 'view')}
                    >
                      <Eye size={15} /> 查看
                    </button>
                    <button
                      type="button"
                      aria-label={`編輯評論：${article.title}`}
                      onClick={() => props.onOpenReview(article, 'edit')}
                    >
                      <MessageSquare size={15} /> 編輯
                    </button>
                    <button
                      type="button"
                      aria-label={`刪除評論：${article.title}`}
                      onClick={() => props.onOpenReview(article, 'delete')}
                    >
                      <Trash2 size={15} /> 刪除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type LibraryProps = {
  articles: Article[];
  totalCount: number;
  loading: boolean;
  submittedQuery: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmitQuery: (value?: string) => void;
  onClearQuery: () => void;
  onClearFilters: () => void;
  sector: string;
  setSector: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  onSectorChange: (value: string) => void;
  onTagChange: (value: string) => void;
  sectors: string[];
  tags: string[];
  onOpen: (article: Article) => void;
  onRetry: () => void;
  hasError: boolean;
};

function LibraryView(props: LibraryProps) {
  const [catalogPage, setCatalogPage] = useState(0);
  const catalogSize = 4;
  const catalogCount = Math.max(
    1,
    Math.ceil(props.articles.length / catalogSize)
  );
  const activeCatalogPage = Math.min(catalogPage, catalogCount - 1);
  useEffect(() => {
    setCatalogPage(0);
  }, [props.submittedQuery, props.sector, props.tag]);
  useEffect(() => {
    setCatalogPage(page => Math.min(page, catalogCount - 1));
  }, [catalogCount]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectorFilterRef = useRef<HTMLButtonElement>(null);
  const restoreFilterFocusRef = useRef(false);
  const searchCriterion = props.submittedQuery;
  const hasActiveFilters = Boolean(
    searchCriterion ||
    props.sector !== 'All sectors' ||
    props.tag !== 'All tags'
  );
  const activeFilters = [
    props.sector !== 'All sectors' ? `產業：${props.sector}` : '',
    props.tag !== 'All tags' ? `標籤：#${props.tag}` : '',
  ].filter(Boolean);
  const activeCriteria = [
    searchCriterion ? `關鍵字「${searchCriterion}」` : '',
    ...activeFilters,
  ].filter(Boolean);
  const resultSummary = props.loading
    ? '正在載入已上架研究…'
    : props.hasError
      ? '研究書庫暫時無法使用'
      : searchCriterion
        ? `搜尋結果 ${props.articles.length} / ${props.totalCount} 冊`
        : hasActiveFilters
          ? `篩選結果 ${props.articles.length} / ${props.totalCount} 冊`
          : `已上架 ${props.articles.length} / ${props.totalCount} 冊`;
  const clearFilters = () => {
    restoreFilterFocusRef.current = true;
    if (props.onClearFilters) {
      props.onClearFilters();
      return;
    }
    props.onClearQuery();
    props.setSector('All sectors');
    props.setTag('All tags');
  };
  useEffect(() => {
    if (!restoreFilterFocusRef.current || hasActiveFilters) return;
    restoreFilterFocusRef.current = false;
    restoreLibraryFilterFocus(sectorFilterRef.current);
  }, [hasActiveFilters]);
  return (
    <>
      <LibraryHero />
      <section
        className="library-tools library-query-rail"
        aria-label="搜尋與研究篩選"
      >
        <CatalogSearch label="搜尋已上架研究" placeholder="搜尋書名、產業、公司或標籤"
          value={props.query} inputRef={searchInputRef} maxLength={MAX_LIBRARY_QUERY_LENGTH}
          describedBy="library-search-status" onChange={props.onQueryChange} onSearch={props.onSubmitQuery} />
        <CatalogSelect label="產業篩選" value={props.sector} triggerRef={sectorFilterRef}
          options={props.sectors.map(value => ({value, label: value === 'All sectors' ? '所有產業' : value}))}
          onChange={props.onSectorChange} />
        <CatalogSelect label="標籤篩選" value={props.tag}
          options={props.tags.map(value => ({value, label: value === 'All tags' ? '所有標籤' : value}))}
          onChange={props.onTagChange} />
      </section>
      <section
        className={`market-shelves ${hasActiveFilters ? 'filtered-library-results' : 'public-library-normal'}`}
        aria-label="已上架研究書庫"
      >
        <span id="library-search-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{resultSummary}</span>
        {hasActiveFilters && (
          <div className="active-filter-line" aria-label="目前篩選條件">
            {activeCriteria.map(item => (
              <span className="active-filter-chip" key={item}>
                <Check size={13} aria-hidden="true" />
                {item}
              </span>
            ))}
            {(props.loading || props.hasError || props.articles.length > 0) && (
              <button
                className="clear-filters"
                type="button"
                onClick={clearFilters}
                aria-label="清除所有篩選條件"
              >
                <X size={15} /> 清除篩選
              </button>
            )}
          </div>
        )}
        <div className="library-shelf-composition" aria-busy={props.loading}>
          {props.loading ? (
            <LibrarySkeleton />
          ) : props.hasError ? (
            <LibrarySearchRecovery
              kind="error"
              message="目前無法取得研究內容。搜尋與篩選條件已保留，請稍後再試。"
              onPrimary={props.onRetry}
              onSecondary={clearFilters}
            />
          ) : props.totalCount === 0 ? (
            <StatePanel
              icon={<BookOpen />}
              eyebrow=""
              title="目前還沒有已上架研究"
              copy="研究發布後會顯示在這裡。"
              action="重新整理"
              onAction={props.onRetry}
            />
          ) : props.articles.length === 0 ? (
            <LibrarySearchRecovery
              kind="empty"
              message={
                activeFilters.length
                  ? `沒有符合${activeCriteria.join('、')}的研究。請調整條件，或清除搜尋條件重新瀏覽。`
                  : searchCriterion
                    ? `很抱歉，沒有找到與「${searchCriterion}」相關的研究。建議嘗試其他關鍵字，或清除搜尋條件重新搜尋。`
                    : '目前的產業或標籤條件沒有符合的研究。請調整條件，或清除搜尋條件重新瀏覽。'
              }
            />
          ) : (
            <BookShelf
              title={hasActiveFilters ? '符合條件的研究書' : '全部已上架研究'}
              articles={props.articles.slice(
                activeCatalogPage * catalogSize,
                (activeCatalogPage + 1) * catalogSize
              )}
              onOpen={props.onOpen}
              grid
            />
          )}
        </div>
        <>
          {!props.loading && !props.hasError && props.articles.length > 0 && (
            <CatalogPagination
              page={activeCatalogPage}
              count={catalogCount}
              total={props.articles.length}
              size={catalogSize}
              label="公開書庫分頁"
              centered
              onChange={setCatalogPage}
            />
          )}
        </>
      </section>
    </>
  );
}

function LibrarySearchRecovery(
  props:
    | { kind: 'empty'; message: string }
    | {
        kind: 'error';
        message: string;
        onPrimary: () => void;
        onSecondary: () => void;
      }
) {
  const isError = props.kind === 'error';
  return (
    <section
      className={`library-search-state ${props.kind}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span className="library-search-state-icon" aria-hidden="true">
        {isError ? (
          <CircleAlert size={92} strokeWidth={1.2} />
        ) : (
          <FileSearch size={92} strokeWidth={1.2} />
        )}
      </span>
      <h3>{isError ? '無法載入研究內容' : '找不到相關研究'}</h3>
      <p>{props.message}</p>
      {props.kind === 'error' && (
        <div className="library-search-state-actions">
          <button
            className="library-search-state-primary"
            type="button"
            onClick={props.onPrimary}
          >
            <RotateCcw size={18} aria-hidden="true" />
            重試
          </button>
          <button
            className="library-search-state-secondary"
            type="button"
            onClick={props.onSecondary}
          >
            清除搜尋條件
          </button>
        </div>
      )}
    </section>
  );
}

function BookShelf({
  title,
  articles,
  onOpen,
  grid = false,
}: {
  title: string;
  articles: Article[];
  onOpen: (article: Article) => void;
  lead?: Article;
  grid?: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railState, setRailState] = useState({ previous: false, next: false });
  function syncRailState() {
    const rail = railRef.current;
    if (!rail || grid) return;
    const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
    setRailState({
      previous: rail.scrollLeft > 2,
      next: rail.scrollLeft < maxScroll - 2,
    });
  }
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || grid) return;
    syncRailState();
    const resizeObserver = new ResizeObserver(syncRailState);
    resizeObserver.observe(rail);
    return () => resizeObserver.disconnect();
  }, [articles.length, grid]);
  function moveRail(direction: number) {
    railRef.current?.scrollBy({ left: direction * 488, behavior: 'smooth' });
  }
  return (
    <section className="book-shelf" aria-label={title}>
      {!grid && (
        <div className="shelf-heading">
          <div>
            <h2>{title}</h2>
          </div>
          {articles.length > 1 && (
            <div className="shelf-heading-actions">
              <button
                type="button"
                className="view-all"
                onClick={() =>
                  railRef.current?.scrollTo({
                    left: railRef.current.scrollWidth,
                    behavior: 'smooth',
                  })
                }
                aria-label={`查看全部：${title}`}
              >
                查看全部
              </button>
              <div className="shelf-controls">
                <button
                  type="button"
                  disabled={!railState.previous}
                  onClick={() => moveRail(-1)}
                  aria-label={`上一批：${title}${railState.previous ? '' : '，已在開頭'}`}
                >
                  <ArrowLeft size={17} />
                </button>
                <button
                  type="button"
                  disabled={!railState.next}
                  onClick={() => moveRail(1)}
                  aria-label={`下一批：${title}${railState.next ? '' : '，已在結尾'}`}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div
        className={grid ? 'book-grid published-book-grid' : 'book-rail'}
        ref={railRef}
        tabIndex={grid ? undefined : 0}
        onScroll={syncRailState}
      >
        {articles.map((article, index) => (
          <ArticleCard
            key={article.id}
            article={article}
            index={index + 1}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function ArticleCard({
  article,
  index,
  onOpen,
}: {
  article: Article;
  index: number;
  onOpen: (article: Article) => void;
}) {
  const [coverOrientation, setCoverOrientation] = useState<
    'portrait' | 'landscape'
  >('portrait');
  const articleIdentifier = article.slug ?? article.id;
  const detailHref = `#/article/${encodeURIComponent(articleIdentifier)}`;
  return (
    <a
      className={`article-card article-card--${coverOrientation}`}
      href={detailHref}
      onClick={event => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onOpen(article);
      }}
      aria-label={`開啟研究：${article.title}`}
    >
      <span className="article-thumb">
        <span className="research-spine" aria-hidden="true" />
        <CoverArtwork
          article={article}
          onOrientationChange={setCoverOrientation}
        />
        <span className="card-number">{String(index).padStart(2, '0')}</span>
      </span>
      <ArticleMeta article={article} />
      <h3>{article.title}</h3>
      <p>{article.summary}</p>
      <span className="card-foot">
        <TagList tags={article.tags?.slice(0, 2)} />
      </span>
    </a>
  );
}

function coverImageAltText(article: Article) {
  return `《${article.title.trim() || '未命名研究書'}》封面`;
}

function readerPageImageAltText(
  article: Article,
  page: ArticlePage,
  index: number
) {
  const description =
    page.altText?.trim() || page.title?.trim() || '未提供圖像描述';
  return `《${article.title.trim() || '未命名研究書'}》第 ${index + 1} 頁圖像：${description}`;
}

function readerPageDisplayTitle(title?: string) {
  return (title?.trim() || '未命名頁面').replace(/^\d+-(?:cover-)?/i, '');
}

const publicCoverRequests = new Map<string, Promise<string | undefined>>();

function coverSource(article: Article) {
  const page =
    article.pages?.find(candidate => candidate.id === article.coverPageId) ??
    article.pages?.[0];
  return article.coverUrl || article.coverImageUrl || page?.imageUrl;
}

async function refreshPublicCover(
  articleId: string
): Promise<string | undefined> {
  const pending = publicCoverRequests.get(articleId);
  if (pending) return pending;
  const request = withReaderDeadline(
    api.get(`/api/articles/${encodeURIComponent(articleId)}/cover`),
    15000,
    'cover_refresh'
  ).then(response => {
    const payload = getPayload<{ coverUrl?: string }>(response);
    return payload.coverUrl;
  });
  publicCoverRequests.set(articleId, request);
  try {
    return await request;
  } finally {
    if (publicCoverRequests.get(articleId) === request)
      publicCoverRequests.delete(articleId);
  }
}

function CoverArtwork({
  article,
  onOrientationChange,
  refreshCover,
}: {
  article: Article;
  onOrientationChange?: (orientation: 'portrait' | 'landscape') => void;
  refreshCover?: (articleId: string) => Promise<string | undefined>;
}) {
  const initialSource = coverSource(article);
  const coverPage =
    article.pages?.find(page => page.id === article.coverPageId) ??
    article.pages?.[0];
  const [source, setSource] = useState(initialSource);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [recovering, setRecovering] = useState(Boolean(initialSource));
  const recoveryStepRef = useRef(0);
  const recoveryGenerationRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null
  );
  const alt = coverImageAltText(article);
  const detectOrientation = (image: HTMLImageElement) => {
    onOrientationChange?.(
      image.naturalWidth >= image.naturalHeight ? 'landscape' : 'portrait'
    );
  };

  useLayoutEffect(() => {
    recoveryGenerationRef.current += 1;
    recoveryStepRef.current = 0;
    setSource(initialSource);
    setAttempt(0);
    setFailed(false);
    setRecovering(Boolean(initialSource));
    return () => {
      recoveryGenerationRef.current += 1;
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current);
    };
  }, [article.id, initialSource]);

  function handleError() {
    const generation = recoveryGenerationRef.current;
    const step = recoveryStepRef.current++;
    if (step === 0) {
      setRecovering(true);
      retryTimerRef.current = window.setTimeout(() => {
        if (generation === recoveryGenerationRef.current)
          setAttempt(value => value + 1);
      }, 400);
      return;
    }
    if (step === 1 && article.id) {
      setRecovering(true);
      void withReaderDeadline(
        (refreshCover ?? refreshPublicCover)(article.id),
        15000,
        'cover_refresh'
      )
        .then(freshSource => {
          if (generation !== recoveryGenerationRef.current) return;
          if (!freshSource) {
            setRecovering(false);
            setFailed(true);
            return;
          }
          setSource(freshSource);
          setAttempt(value => value + 1);
        })
        .catch(() => {
          if (generation !== recoveryGenerationRef.current) return;
          setRecovering(false);
          setFailed(true);
        });
      return;
    }
    setRecovering(false);
    setFailed(true);
  }

  if (source && !failed)
    return (
      <>
        <img
          key={`${article.id}-${attempt}-${source}`}
          src={source}
          alt={alt}
          loading={recovering ? 'eager' : 'lazy'}
          decoding="async"
          style={recovering ? { display: 'none' } : undefined}
          onLoad={event => {
            setRecovering(false);
            detectOrientation(event.currentTarget);
          }}
          onError={handleError}
        />
        {recovering && (
<LoadingBlock className='cover-artwork-loading' />
        )}
      </>
    );
  if (source?.includes('/seed/')) {
    return (
      <img
        src={recoveryArtworkUrl(article, coverPage, 0)}
        alt={alt}
        decoding="async"
        onLoad={event => detectOrientation(event.currentTarget)}
        data-recovered-seed-image="true"
      />
    );
  }
  return (
    <PlaceholderArtwork
      label={article.sector}
      message={failed ? '封面暫時無法顯示' : undefined}
    />
  );
}

function PageArtworkImage({
  article,
  page,
  index,
  decorative = false,
  onReturn,
}: {
  article: Article;
  page: ArticlePage;
  index: number;
  decorative?: boolean;
  onReturn?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [readySource, setReadySource] = useState<string>();
  useEffect(() => setFailed(false), [page.imageUrl]);
  const recoverable = page.imageUrl?.includes('/seed/');
  const source =
    failed && recoverable
      ? recoveryArtworkUrl(article, page, index)
      : page.imageUrl;
  if (failed && !recoverable) {
    if (decorative) return <FileImage aria-hidden="true" />;
    return (
      <span className="page-unavailable" role="status">
        <CircleAlert size={32} />
        <strong>第 {index + 1} 頁圖像無法顯示</strong>
        <span>{page.title || '未命名頁面'}</span>
        {onReturn && (
          <button type="button" onClick={onReturn}>
            返回研究書
          </button>
        )}
      </span>
    );
  }
  if (!source) return <FileImage aria-hidden="true" />;
  return (
    <img
      src={source}
      className={readySource !== source ? 'image-shimmer' : undefined}
      onLoad={() => setReadySource(source)}
      alt={decorative ? '' : readerPageImageAltText(article, page, index)}
      loading={decorative ? 'lazy' : 'eager'}
      decoding="async"
      onError={() => { if (failed) setReadySource(source); else setFailed(true); }}
      data-recovered-seed-image={failed && recoverable ? 'true' : undefined}
    />
  );
}

function readerImageIsReady(
  image: { complete: boolean; naturalWidth: number } | null,
  loadingFixture: boolean
) {
  return !loadingFixture && Boolean(image?.complete && image.naturalWidth > 0);
}

function readerInitialPageIndex(scenario: string, pageCount: number) {
  if (!pageCount) return 0;
  if (scenario === 'reader-last') return pageCount - 1;
  return scenario === 'reader-middle' || scenario === 'reader-missing-image'
    ? Math.min(1, pageCount - 1)
    : 0;
}

function ReaderPageArtworkImage({
  article,
  page,
  index,
  onReturn,
  onImageLoad,
}: {
  article: Article;
  page: ArticlePage;
  index: number;
  onReturn: () => void;
  onImageLoad: (ratio: number) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const loadingFixture = isLocalFixtureBuild && page.fixtureLoading === true;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() =>
    loadingFixture || page.imageUrl ? 'loading' : 'failed'
  );
  const [source, setSource] = useState(page.imageUrl);
  const [refreshAttempted, setRefreshAttempted] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const refreshRequestRef = useRef(0);
  const imageRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    refreshRequestRef.current += 1;
    setRefreshAttempted(false);
    setSource(page.imageUrl);
    setState(loadingFixture || page.imageUrl ? 'loading' : 'failed');
    return () => {
      refreshRequestRef.current += 1;
    };
  }, [article.id, page.id, loadingFixture, page.imageUrl, attempt]);

  useEffect(() => {
    const image = imageRef.current;
    if (readerImageIsReady(image, loadingFixture)) {
      if (image && image.naturalHeight > 0)
        onImageLoad(image.naturalWidth / image.naturalHeight);
      setState('ready');
    }
  }, [attempt, loadingFixture, source]);

  if (state === 'failed')
    return (
      <div className="reader-page-unavailable" role="status">
        <CircleAlert size={32} aria-hidden="true" />
        <strong>第 {index + 1} 頁圖像無法顯示</strong>
        <span>{page.title || '未命名頁面'}</span>
        <p>{page.altText || '這張研究頁面的圖像暫時無法顯示。'}</p>
        <div className="reader-page-actions">
          <button type="button" onClick={() => setAttempt(value => value + 1)}>
            重新載入圖像
          </button>
          <button type="button" onClick={onReturn}>
            返回研究書
          </button>
        </div>
      </div>
    );

  return (
    <span
      className={`reader-page-media ${state === 'loading' ? 'is-loading' : ''}`}
      aria-busy={state === 'loading'}
    >
      {state === 'loading' && (
        <span className="reader-page-loading" role="status">
          正在準備第 {index + 1} 頁圖像…
        </span>
      )}
      {!loadingFixture && (
        <img
          ref={imageRef}
          key={`${page.id ?? index}-${attempt}-${imageRetry}-${source}`}
          src={source}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          alt={readerPageImageAltText(article, page, index)}
          onLoad={event => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0)
              onImageLoad(image.naturalWidth / image.naturalHeight);
            setState('ready');
          }}
          onError={() => {
            if (refreshAttempted) {
              setState('failed');
              return;
            }
            setRefreshAttempted(true);
            setState('loading');
            const requestVersion = ++refreshRequestRef.current;
            void withReaderDeadline(
              api.get(`/api/articles/${encodeURIComponent(article.id)}`),
              15000,
              'reader_image_refresh'
            )
              .then(response => {
                if (refreshRequestRef.current !== requestVersion) return;
                const freshArticle = getEntity<Article>(response, 'article');
                const freshPage =
                  freshArticle.pages?.find(
                    candidate => candidate.id === page.id
                  ) ?? freshArticle.pages?.[index];
                if (freshPage?.imageUrl) {
                  setSource(freshPage.imageUrl);
                  setImageRetry(value => value + 1);
                } else setState('failed');
              })
              .catch(() => {
                if (refreshRequestRef.current === requestVersion)
                  setState('failed');
              });
          }}
          data-recovered-seed-image={
            source !== page.imageUrl ? 'true' : undefined
          }
        />
      )}
    </span>
  );
}

function recoveryArtworkUrl(article: Article, page?: ArticlePage, index = 0) {
  const palette = article.sector.includes('金融')
    ? ['#315E56', '#9EC0B6']
    : article.sector.includes('半導體')
      ? ['#145A72', '#64B3C5']
      : ['#9A4B2B', '#DDAA83'];
  const titleLines = splitArtworkText(page?.title || article.title, 13, 3);
  const noteLines = splitArtworkText(page?.altText || article.summary, 22, 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500" role="img" aria-label="${escapeArtworkText(page?.altText || article.title)}"><rect width="1200" height="1500" fill="#F4F5F1"/><rect x="60" y="60" width="1080" height="1380" fill="#FCFBF7" stroke="#CED8D9" stroke-width="3"/><rect x="60" y="60" width="22" height="1380" fill="${palette[0]}"/><text x="130" y="155" fill="#16344B" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="4">POCKETSTOCKS · ${escapeArtworkText(article.sector.toUpperCase())}</text><line x1="130" y1="205" x2="1070" y2="205" stroke="#CBD5D7" stroke-width="2"/>${titleLines.map((line, lineIndex) => `<text x="130" y="${340 + lineIndex * 92}" fill="#102A40" font-family="Arial,sans-serif" font-size="72" font-weight="700">${escapeArtworkText(line)}</text>`).join('')}<rect x="130" y="690" width="940" height="330" rx="18" fill="${palette[0]}"/><circle cx="855" cy="855" r="116" fill="none" stroke="${palette[1]}" stroke-width="28"/><path d="M230 910 L390 790 L520 880 L670 735" fill="none" stroke="#FFFFFF" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><circle cx="230" cy="910" r="17" fill="#FFFFFF"/><circle cx="390" cy="790" r="17" fill="#FFFFFF"/><circle cx="520" cy="880" r="17" fill="#FFFFFF"/><circle cx="670" cy="735" r="17" fill="#FFFFFF"/><text x="130" y="1115" fill="${palette[0]}" font-family="Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="3">產業研究 · ${String(index + 1).padStart(2, '0')}</text>${noteLines.map((line, lineIndex) => `<text x="130" y="${1195 + lineIndex * 50}" fill="#5B6977" font-family="Arial,sans-serif" font-size="31">${escapeArtworkText(line)}</text>`).join('')}<text x="970" y="1380" fill="#6A7783" font-family="Arial,sans-serif" font-size="24">${String(index + 1).padStart(2, '0')} / ${String(article.pageCount ?? article.pages?.length ?? 1).padStart(2, '0')}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function splitArtworkText(
  value: string,
  maxCharacters: number,
  maxLines: number
) {
  const characters = Array.from(value.trim());
  const lines: string[] = [];
  for (
    let offset = 0;
    offset < characters.length && lines.length < maxLines;
    offset += maxCharacters
  ) {
    const slice = characters.slice(offset, offset + maxCharacters).join('');
    lines.push(
      offset + maxCharacters < characters.length &&
        lines.length === maxLines - 1
        ? `${slice.slice(0, -1)}…`
        : slice
    );
  }
  return lines.length > 0 ? lines : ['產業研究'];
}

function escapeArtworkText(value: string) {
  return value.replace(
    /[&<>"']/g,
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

function ArticleMeta({ article }: { article: Article }) {
  return (
    <div className="article-meta">
      <span>{article.sector}</span>
      <time dateTime={article.publicationDate}>
        {formatDate(article.publicationDate)}
      </time>
      <span>{article.pageCount ?? article.pages?.length ?? 0} 頁</span>
    </div>
  );
}

function TagList({ tags = [] }: { tags?: string[] }) {
  return (
    <div className="tag-list">
      {tags.map(item => (
        <span key={item}>#{item}</span>
      ))}
    </div>
  );
}

function PlaceholderArtwork({
  label,
  message = '封面準備中',
}: {
  label: string;
  message?: string;
}) {
  return (
    <span className="placeholder-art">
      <span>{label || '產業研究'}</span>
      <strong>{message}</strong>
      <i />
      <i />
      <i />
    </span>
  );
}

function ReaderLibrarySkeleton({ favoritesView }: { favoritesView: boolean }) {
  return (
    <div
      id={
        favoritesView
          ? 'reader-library-favorites-panel'
          : 'reader-library-reviews-panel'
      }
      role="tabpanel"
      aria-labelledby={
        favoritesView
          ? 'reader-library-favorites-tab'
          : 'reader-library-reviews-tab'
      }
      tabIndex={0}
      aria-busy="true"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {favoritesView ? '正在載入收藏' : '正在載入評論'}
      </span>
      <div aria-hidden="true">
        {favoritesView && (
          <div className="reader-library-favorites-toolbar">
            <LoadingBlock className="loading-count" />
            <LoadingBlock className="loading-count" />
          </div>
        )}
        <div
          className={`reader-library-list ${favoritesView ? 'reader-library-favorites-grid' : 'reader-library-review-list'}`}
        >
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              className={`reader-library-item content-skeleton ${favoritesView ? '' : 'reader-library-review-item'}`}
            >
              <LoadingBlock className="reader-library-cover" />
              <div className="reader-library-item-copy">
                <div className="article-meta">
                  <LoadingBlock className="loading-meta" />
                  <LoadingBlock className="loading-date" />
                  <LoadingBlock className="loading-pages" />
                </div>
                {favoritesView ? (
                  <h2>
                    <LoadingBlock className="loading-title" />
                  </h2>
                ) : (
                  <div className="reader-library-review-heading">
                    <h2>
                      <LoadingBlock className="loading-title" />
                    </h2>
                    <LoadingBlock className="loading-date" />
                  </div>
                )}
                <p
                  className={favoritesView ? '' : 'reader-library-review-copy'}
                >
                  <LoadingBlock />
                  <LoadingBlock />
                  <LoadingBlock className="loading-short" />
                </p>
                {favoritesView && (
                  <small>
                    <LoadingBlock className="loading-date" />
                  </small>
                )}
              </div>
              <div className="reader-library-item-actions">
                {Array.from({ length: favoritesView ? 2 : 3 }, (_, action) => (
                  <LoadingBlock
                    key={action}
                    className={`loading-action ${favoritesView ? 'loading-favorite-action' : 'loading-review-action'}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <section className="book-shelf catalog-loading" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        正在載入研究書庫
      </span>
      <div className="book-grid published-book-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="article-card content-skeleton" key={index}>
            <LoadingBlock className="article-thumb" />
            <div className="article-meta">
              <LoadingBlock className="loading-meta" />
              <LoadingBlock className="loading-date" />
            </div>
            <h3>
              <LoadingBlock className="loading-title" />
            </h3>
            <p>
              <LoadingBlock />
              <LoadingBlock />
              <LoadingBlock className="loading-short" />
            </p>
            <div className="card-foot">
              <div className="tag-list">
                <LoadingBlock className="loading-meta" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatePanel({
  icon,
  eyebrow,
  title,
  copy,
  action,
  tone = 'neutral',
  onAction,
}: {
  icon: React.ReactNode;
  eyebrow?: string;
  title: string;
  copy: string;
  action: string;
  tone?: 'neutral' | 'error';
  onAction: () => void;
}) {
  return (
    <section
      className={`state-panel ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {icon}
      {eyebrow && <span>{eyebrow}</span>}
      <h2>{title}</h2>
      <p>{copy}</p>
      <button type="button" onClick={onAction}>
        {action}
      </button>
    </section>
  );
}

function DetailRouteState({
  status,
  onBack,
  onRetry,
}: {
  status: DetailRouteStatus;
  onBack: () => void;
  onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (status !== 'loading') headingRef.current?.focus();
  }, [status]);
  return (
    <article className="research-detail detail-route-state">
      {status === 'loading' || status === 'idle' ? (
        <section
          className="detail-hero content-skeleton"
          aria-busy="true"
          aria-label="正在載入研究"
        >
          <span className="sr-only" role="status" aria-live="polite">
            正在載入研究內容…
          </span>
          <LoadingBlock className="detail-cover loading-detail-cover" />
          <div className="detail-copy" aria-hidden="true">
            <div className="article-meta">
              <LoadingBlock className="loading-meta" />
              <LoadingBlock className="loading-date" />
              <LoadingBlock className="loading-pages" />
            </div>
            <h1>
              <LoadingBlock />
              <LoadingBlock className="loading-short" />
            </h1>
            <span className="detail-title-rule" />
            <p>
              <LoadingBlock />
              <LoadingBlock />
              <LoadingBlock className="loading-short" />
            </p>
            <div className="tag-list">
              <LoadingBlock className="loading-meta" />
              <LoadingBlock className="loading-meta" />
            </div>
            <div className="detail-actions">
              <LoadingBlock className="loading-read-action" />
              <LoadingBlock className="loading-favorite-action" />
            </div>
            <p className="detail-auth-note">
              <LoadingBlock className="loading-short" />
            </p>
          </div>
        </section>
      ) : (
        <section
          className={`detail-recovery-state ${status === 'error' ? 'error' : ''}`}
          aria-labelledby="detail-recovery-heading"
        >
          <CircleAlert size={28} aria-hidden="true" />

          <h1 id="detail-recovery-heading" ref={headingRef} tabIndex={-1}>
            {status === 'error' ? '研究內容暫時無法載入' : '找不到這本公開研究'}
          </h1>
          <p>
            {status === 'error'
              ? '目前無法載入研究，請再試一次。'
              : '找不到這本研究，連結可能已失效或內容尚未公開。'}
          </p>
          <div>
            {status === 'error' && (
              <button className="detail-retry" type="button" onClick={onRetry}>
                重新嘗試
              </button>
            )}
            <button type="button" onClick={onBack}>
              返回研究書庫
            </button>
          </div>
        </section>
      )}
    </article>
  );
}

function ApplicationBrand({
  onClick,
  label = '開啟產業研究書庫',
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="application-banner-brand"
      onClick={onClick}
      aria-label={label}
    >
      <span className="application-banner-mark" aria-hidden="true">
        <BookOpen size={19} />
      </span>
      <strong>PocketStocks</strong>
    </button>
  );
}

function DiscussionView({
  article,
  articles,
  requestedId,
  status,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onRetryBook,
  onSelect,
  readerSignedIn,
  readerSessionKey,
  onExpired,
}: {
  article: Article | null;
  articles: Article[];
  requestedId: string;
  status: DetailRouteStatus;
  catalogLoading: boolean;
  catalogError: boolean;
  onRetryCatalog: () => void;
  onRetryBook: () => void;
  onSelect: (article: Article) => void;
  readerSignedIn: boolean;
  readerSessionKey: string;
  onExpired: () => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorQuery, setSelectorQuery] = useState('');
  const [selectorPage, setSelectorPage] = useState(0);
  const selectorSize = 3;
  const publishedBooks = articles.filter(articleIsPublished);
  const normalizedQuery = selectorQuery.trim().toLocaleLowerCase();
  const matchingBooks = publishedBooks.filter(book =>
    [book.title, ...(book.tags ?? [])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  );
  const selectorPageCount = Math.max(
    1,
    Math.ceil(matchingBooks.length / selectorSize)
  );
  const activeSelectorPage = Math.min(selectorPage, selectorPageCount - 1);
  const visibleBooks = matchingBooks.slice(
    activeSelectorPage * selectorSize,
    (activeSelectorPage + 1) * selectorSize
  );
  useEffect(() => {
    setSelectorPage(page => Math.min(page, selectorPageCount - 1));
  }, [selectorPageCount]);
  function updateSelectorQuery(query: string) {
    setSelectorQuery(query);
    setSelectorPage(0);
  }
  const selectorTriggerRef = useRef<HTMLButtonElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelectorOpen(false);
  }, [requestedId]);
  useEffect(() => {
    if (!selectorOpen) return;
    selectorRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    function close(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSelectorOpen(false);
      selectorTriggerRef.current?.focus();
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectorOpen]);
  function selectBook(book: Article) {
    setSelectorOpen(false);
    onSelect(book);
    selectorTriggerRef.current?.focus();
  }
  return (
    <section className="discussion-room" aria-label="討論吧">
      <div className="discussion-content">
        <div className="discussion-tools">
          <button
            ref={selectorTriggerRef}
            type="button"
            aria-expanded={selectorOpen}
            aria-controls="discussion-books"
            onClick={() => setSelectorOpen(!selectorOpen)}
          >
            <Menu size={24} /> 選擇研究書
          </button>
        </div>
        {selectorOpen && (
          <div
            ref={selectorRef}
            id="discussion-books"
            className="discussion-book-picker"
            aria-label="已公開研究書"
          >
            <header>
              <h2>已公開研究書</h2>
              <button
                type="button"
                aria-label="收合研究書選擇"
                onClick={() => {
                  setSelectorOpen(false);
                  selectorTriggerRef.current?.focus();
                }}
              >
                <X size={20} />
              </button>
            </header>
            <CatalogSearch label="搜尋公開研究書" placeholder="搜尋書名或標籤…" value={selectorQuery}
              clearLabel="清除研究書搜尋" onChange={updateSelectorQuery} />
            {catalogLoading ? (
              <LoadingSkeleton media={false} label='正在載入研究書…' rows={3} />
            ) : catalogError ? (
              <div role="alert">
                <p>研究書暫時無法載入。</p>
                <button type="button" onClick={onRetryCatalog}>
                  重試
                </button>
              </div>
            ) : publishedBooks.length === 0 ? (
              <p role="status">目前尚無公開研究書。</p>
            ) : matchingBooks.length === 0 ? (
              <p role="status">
                找不到符合條件的研究書，請更換關鍵字或清除搜尋。
              </p>
            ) : (
              <>
                {visibleBooks.map(book => (
                  <button
                    type="button"
                    className="discussion-picker-book"
                    key={book.id}
                    aria-current={article?.id === book.id ? 'true' : undefined}
                    onClick={() => selectBook(book)}
                  >
                    <span className="discussion-picker-text">
                      <strong>{book.title}</strong>
                      {Boolean(book.tags?.length) && (
                        <TagList tags={book.tags} />
                      )}
                    </span>
                    {article?.id === book.id && <Check size={18} />}
                  </button>
                ))}
                <CatalogPagination
                  page={activeSelectorPage}
                  count={selectorPageCount}
                  total={matchingBooks.length}
                  size={selectorSize}
                  label="研究書選擇分頁"
                  onChange={setSelectorPage}
                />
              </>
            )}
          </div>
        )}
        {article ? (
          <DiscussionThread
            key={`${article.id}:${readerSessionKey}:${readerSignedIn}`}
            article={article}
            readerSignedIn={readerSignedIn}
            onExpired={onExpired}
          />
        ) : (
          <div
            className="discussion-route-state"
            role={
              status === 'error' || status === 'unavailable'
                ? 'alert'
                : 'status'
            }
          >
            {requestedId && status === 'loading' ? (
              <>
                <LoadingSkeleton kind='comments' label='正在載入研究…' rows={2} />
              </>
            ) : status === 'error' ? (
              <>
                <h1>研究暫時無法載入</h1>
                <p>請重試，或選擇其他已公開研究書。</p>
                <button type="button" onClick={onRetryBook}>
                  重試
                </button>
              </>
            ) : status === 'unavailable' ? (
              <>
                <h1>這本研究目前無法討論</h1>
                <p>請選擇其他已公開研究書。</p>
              </>
            ) : (
              <>
                <BookOpen size={42} />
                <h1>選一本研究，開始討論</h1>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DiscussionThread({
  article,
  readerSignedIn,
  onExpired,
}: {
  article: Article;
  readerSignedIn: boolean;
  onExpired: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [validationRequested, setValidationRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Notice>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflow, setSummaryOverflow] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const summary = summaryRef.current;
    if (!summary) return;
    const measure = () => setSummaryOverflow(summary.scrollHeight > 72);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(summary);
    return () => observer.disconnect();
  }, [article.summary]);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const errors = commentValidationErrors(name, body);
  const sortedComments = useMemo(
    () =>
      comments
        .map((comment, index) => ({ comment, index }))
        .sort((left, right) => {
          const leftTime = Date.parse(left.comment.createdAt) || 0;
          const rightTime = Date.parse(right.comment.createdAt) || 0;
          return (
            rightTime - leftTime ||
            left.comment.id.localeCompare(right.comment.id) ||
            left.index - right.index
          );
        })
        .map(({ comment }) => comment),
    [comments]
  );
  async function loadComments() {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await withReaderDeadline(
        api.get(`/api/articles/${encodeURIComponent(article.id)}/comments`),
        20000,
        'discussion_comments_timeout'
      );
      const payload = getPayload<Comment[] | { comments: Comment[] }>(response);
      if (!mountedRef.current || request !== requestRef.current) return;
      setComments(Array.isArray(payload) ? payload : (payload.comments ?? []));
    } catch {
      if (mountedRef.current && request === requestRef.current)
        setLoadError(true);
    } finally {
      if (mountedRef.current && request === requestRef.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    mountedRef.current = true;
    void loadComments();
    return () => {
      mountedRef.current = false;
      ++requestRef.current;
    };
  }, [article.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readerSignedIn || submittingRef.current || loading || loadError)
      return;
    setValidationRequested(true);
    if (Object.keys(errors).length) {
      if (errors.displayName) nameRef.current?.focus();
      else bodyRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFeedback(null);
    // Invalidate an older read so it cannot remove the newly created comment.
    ++requestRef.current;
    setLoading(false);
    try {
      const response = await api.post(
        `/api/articles/${encodeURIComponent(article.id)}/comments`,
        {
          displayName: normalizeCommentValue(name),
          body: normalizeCommentValue(body),
          trackInMyComments: readerSignedIn,
        }
      );
      if (!mountedRef.current) return;
      const created = getEntity<Comment>(response, 'comment');
      setComments(items => [
        created,
        ...items.filter(item => item.id !== created.id),
      ]);
      setBody('');
      setValidationRequested(false);
      setFeedback({ tone: 'success', message: '留言已發佈。' });
    } catch (caught) {
      if (!mountedRef.current) return;
      if (isUnauthorized(caught)) onExpired();
      setFeedback({
        tone: 'error',
        message: isUnauthorized(caught)
          ? '登入已過期，留言尚未送出。請重新登入後再發表。'
          : '留言暫時未能發佈。已保留你的內容，可以重試。',
      });
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }
  function commentTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '日期待定'
      : new Intl.DateTimeFormat('zh-TW', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date);
  }
  return (
    <div
      className={`discussion-columns ${readerSignedIn ? 'is-signed-in' : 'is-read-only'}`}
    >
      <div className="discussion-main">
        <section
          className="discussion-hero"
          aria-labelledby="discussion-book-title"
        >
          <div className="discussion-cover">
            <CoverArtwork article={article} />
          </div>
          <div className="discussion-copy">
            <span>{article.sector}</span>
            <h1 id="discussion-book-title">{article.title}</h1>
          </div>
          <div
            className={`discussion-summary ${summaryExpanded ? 'is-expanded' : ''}`}
          >
            <p ref={summaryRef} id="discussion-summary">
              {article.summary}
            </p>
            {summaryOverflow && (
              <button
                type="button"
                aria-expanded={summaryExpanded}
                aria-controls="discussion-summary"
                onClick={() => setSummaryExpanded(expanded => !expanded)}
              >
                {summaryExpanded ? '收合摘要' : '展開摘要'}
              </button>
            )}
          </div>
        </section>
        <section
          className="discussion-comments"
          aria-labelledby="discussion-comments-title"
        >
          <header>
            <h2 id="discussion-comments-title">
              全部留言{!loading && !loadError ? `（${comments.length}）` : ''}
            </h2>
          </header>
          {loading ? (
            <LoadingSkeleton kind='comments' label='正在載入留言…' />
          ) : loadError ? (
            <div role="alert">
              <p>留言暫時無法載入。</p>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void loadComments()}
              >
                重試載入留言
              </button>
            </div>
          ) : sortedComments.length === 0 ? (
            <p className="discussion-empty">
              {readerSignedIn
                ? '還沒有留言，分享你的第一個觀察。'
                : '這本研究還沒有公開留言。'}
            </p>
          ) : (
            sortedComments.map(comment => (
              <article key={comment.id}>
                <div className="discussion-avatar" aria-hidden="true">
                  <span />
                </div>
                <div>
                  <div className="discussion-comment-meta">
                    <strong>{comment.displayName}</strong>
                    <span aria-hidden="true">·</span>
                    <time dateTime={comment.createdAt}>
                      {commentTime(comment.createdAt)}
                    </time>
                  </div>
                  <p>{comment.body}</p>
                  <small>未驗證顯示名稱</small>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
      {readerSignedIn && (
        <aside
          className="discussion-composer"
          aria-labelledby="discussion-compose-title"
        >
          <h2 id="discussion-compose-title">加入討論</h2>
          <p>針對這本研究，分享你的看法與問題。</p>
          <form onSubmit={submit} noValidate aria-busy={submitting}>
            <label htmlFor="discussion-name">顯示名稱</label>
            <input
              ref={nameRef}
              id="discussion-name"
              value={name}
              placeholder="你希望顯示的名稱"
              disabled={submitting}
              required
              aria-invalid={validationRequested && Boolean(errors.displayName)}
              aria-describedby={
                validationRequested && errors.displayName
                  ? 'discussion-name-error'
                  : undefined
              }
              onChange={event => {
                setName(event.target.value);
                setFeedback(null);
              }}
            />
            {validationRequested && errors.displayName && (
              <p
                id="discussion-name-error"
                className="discussion-error"
                role="alert"
              >
                {errors.displayName}
              </p>
            )}
            <label htmlFor="discussion-body">留言</label>
            <textarea
              ref={bodyRef}
              id="discussion-body"
              value={body}
              placeholder="分享你的觀點、提問或心得……"
              disabled={submitting}
              required
              aria-invalid={validationRequested && Boolean(errors.body)}
              aria-describedby={
                validationRequested && errors.body
                  ? 'discussion-body-error'
                  : 'discussion-counter'
              }
              onChange={event => {
                setBody(event.target.value);
                setFeedback(null);
              }}
            />
            <p id="discussion-counter" className="discussion-counter">
              {commentCodePointCount(body).toLocaleString()} / 1,000
            </p>
            {validationRequested && errors.body && (
              <p
                id="discussion-body-error"
                className="discussion-error"
                role="alert"
              >
                {errors.body}
              </p>
            )}
            <p className="discussion-disclosure">
              留言會公開顯示 · 顯示名稱未經驗證
            </p>
            {feedback && (
              <p
                className={
                  feedback.tone === 'error'
                    ? 'discussion-error'
                    : 'discussion-success'
                }
                role={feedback.tone === 'error' ? 'alert' : 'status'}
              >
                {feedback.message}
              </p>
            )}
            {(loading || loadError) && (
              <p role="status" className="discussion-account-note">
                {loading
                  ? '留言載入完成後即可發表。'
                  : '請先重試載入留言，再發表。你的內容已保留。'}
              </p>
            )}
            <button type="submit" disabled={submitting || loading || loadError}>
              {submitting
                ? '發表中…'
                : feedback?.tone === 'error'
                  ? '重試發表留言'
                  : '發表留言'}
            </button>
            <p className="discussion-account-note">
              已登入的留言會列入「我的評論」
            </p>
          </form>
        </aside>
      )}
    </div>
  );
}

function ArticleView({
  article,
  readingSnapshot,
  onReadingSnapshot,
  onDiscussion,
  readerRoute,
  readerPageIndex,
  readerPageInvalid,
  onReaderPageChange,
  onReaderClose,
  readerSignedIn,
  accountControl,
  readerSessionKey,
  commentDraftRestore,
  onCommentDraftRestored,
  focusPrivateReview,
  privateReviewAction = 'edit',
  favorited,
  favoritePending,
  favoriteFeedback,
  onToggleFavorite,
  onRetryFavorite,
  onReaderSessionExpired,
  onRequestReviewSignIn,
  onPrivateReviewFocused,
  onPrivateReviewChange,
}: {
  article: Article;
  readingSnapshot?: ReaderReadingSnapshot;
  onReadingSnapshot: (snapshot: ReaderReadingSnapshot) => void;
  onDiscussion: () => void;
  readerRoute: 'detail' | 'reader';
  readerPageIndex: number | null;
  readerPageInvalid: boolean;
  onReaderPageChange: (pageIndex: number) => void;
  onReaderClose: () => void;
  readerSignedIn: boolean;
  accountControl: ReactNode;
  readerSessionKey: string;
  commentDraftRestore: CommentDraft | null;
  onCommentDraftRestored: () => void;
  focusPrivateReview: boolean;
  privateReviewAction?: 'view' | 'edit' | 'delete';
  favorited: boolean;
  favoritePending: boolean;
  favoriteFeedback: FavoriteFeedback;
  onToggleFavorite: (trigger: HTMLButtonElement, draft: CommentDraft) => void;
  onRetryFavorite: (favorited: boolean) => void;
  onReaderSessionExpired: () => void;
  onRequestReviewSignIn: (
    trigger: HTMLButtonElement,
    draft: CommentDraft
  ) => void;
  onPrivateReviewFocused: () => void;
  onPrivateReviewChange: (review: PrivateReview | null) => void;
}) {
  const readerScenario = localFixtureScenario();
  const [pageIndex, setPageIndex] = useState(
    () =>
      readerPageIndex ??
      readerInitialPageIndex(readerScenario, article.pages?.length ?? 0)
  );
  const [pageImageRatio, setPageImageRatio] = useState(2 / 3);
  const [reading, setReading] = useState(
    () =>
      readerRoute === 'reader' ||
      [
        'reader-first',
        'reader-middle',
        'reader-last',
        'reader-loading',
        'reader-missing-image',
      ].includes(readerScenario)
  );
  const [readerRailOpen, setReaderRailOpen] = useState(
    () => readerRoute === 'reader' && Boolean(readingSnapshot?.railOpen)
  );
  const [readerCommentOpen, setReaderCommentOpen] = useState(false);
  const readerCommentTriggerRef = useRef<HTMLButtonElement>(null);
  const readerCommentWasOpenRef = useRef(false);
  const readerCommentDialogRef = useRef<HTMLDivElement>(null);
  const commentSubmittingRef = useRef(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentName, setCommentName] = useState(() =>
    readerRoute === 'reader' ? (readingSnapshot?.draft.displayName ?? '') : ''
  );
  const [commentBody, setCommentBody] = useState(() =>
    readerRoute === 'reader' ? (readingSnapshot?.draft.body ?? '') : ''
  );
  const [commentNotice, setCommentNotice] = useState<Notice>(null);
  const [commentLoadError, setCommentLoadError] = useState(false);
  const [commentValidationRequested, setCommentValidationRequested] = useState(
    () => readerScenario === 'comments-validation'
  );
  const [submitting, setSubmitting] = useState(false);
  const [commentFocusId, setCommentFocusId] = useState<string | null>(null);
  const [privateReview, setPrivateReview] = useState<PrivateReview | null>(
    null
  );
  const [privateReviewWorkspace, setPrivateReviewWorkspace] =
    useState(focusPrivateReview);
  const [reviewRevision, setReviewRevision] = useState<ReviewRevision>({
    version: 0,
    updatedAt: null,
  });
  const [reviewDraft, setReviewDraft] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewDataSessionKey, setReviewDataSessionKey] = useState('');
  const [reviewMutation, setReviewMutation] = useState<ReviewMutation>(null);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<ReviewNotice>(null);
  const [reviewConflict, setReviewConflict] =
    useState<ReviewSlotPayload | null>(null);
  const [reviewDeleteOpen, setReviewDeleteOpen] = useState(false);
  const [reviewLoadError, setReviewLoadError] = useState(false);
  const [reviewRetryToken, setReviewRetryToken] = useState(0);
  const [reviewValidationRequested, setReviewValidationRequested] =
    useState(false);
  const reviewTextRef = useRef<HTMLTextAreaElement>(null);
  const reviewDeleteDialogRef = useRef<HTMLDivElement>(null);
  const reviewDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const reviewDeleteTriggerRef = useRef<HTMLButtonElement>(null);
  const reviewDeleteConfirmRef = useRef<HTMLButtonElement>(null);
  const reviewEditTriggerRef = useRef<HTMLButtonElement>(null);
  const readerRailRef = useRef<HTMLElement>(null);
  const readerStageRef = useRef<HTMLElement>(null);
  const readerStartRef = useRef<HTMLButtonElement>(null);
  const commentNameRef = useRef<HTMLInputElement>(null);
  const commentBodyRef = useRef<HTMLTextAreaElement>(null);
  const commentRequestVersionRef = useRef(0);
  const readerRouteWasReaderRef = useRef(readerRoute === 'reader');
  const reviewSessionKeyRef = useRef(readerSessionKey);
  const reviewRequestVersionRef = useRef(0);
  const pages = [...(article.pages ?? [])].sort(
    (a, b) => (a.position ?? a.order) - (b.position ?? b.order)
  );
  const currentPage = pages[pageIndex];

  const reviewLength = reviewCodePointCount(reviewDraft);
  const reviewValidationError = reviewValidationMessage(reviewDraft);
  const reviewDirty = reviewDraft !== (privateReview?.text ?? '');
  const reviewSessionReady =
    Boolean(readerSessionKey) && reviewDataSessionKey === readerSessionKey;
  const reviewSavePending = reviewMutation === 'save';
  const reviewDeletePending = reviewMutation === 'delete';
  const currentCommentErrors = commentValidationErrors(
    commentName,
    commentBody
  );
  const commentBodyLength = commentCodePointCount(commentBody);

  reviewSessionKeyRef.current = readerSessionKey;

  useEffect(() => {
    if (reading)
      onReadingSnapshot({
        railOpen: readerRailOpen,
        draft: { displayName: commentName, body: commentBody },
      });
  }, [reading, readerRailOpen, commentName, commentBody, onReadingSnapshot]);

  useEffect(() => {
    setPageIndex(index => Math.max(0, Math.min(index, pages.length - 1)));
  }, [article.id, pages.length]);

  useEffect(() => {
    if (!commentDraftRestore) return;
    setCommentName(commentDraftRestore.displayName);
    setCommentBody(commentDraftRestore.body);
    onCommentDraftRestored();
  }, [commentDraftRestore, onCommentDraftRestored]);

  useEffect(() => {
    if (!commentFocusId) return;
    document.getElementById(`comment-${commentFocusId}`)?.focus();
    setCommentFocusId(null);
  }, [commentFocusId]);

  useEffect(() => {
    if (readerRoute === 'reader') {
      setReading(true);
      setPageIndex(readerPageIndex ?? 0);
      return;
    }
    if (
      ![
        'reader-first',
        'reader-middle',
        'reader-last',
        'reader-loading',
        'reader-missing-image',
      ].includes(readerScenario)
    ) {
      setReading(false);
    }
  }, [readerPageIndex, readerRoute, readerScenario]);

  useEffect(() => {
    const wasReaderRoute = readerRouteWasReaderRef.current;
    readerRouteWasReaderRef.current = readerRoute === 'reader';
    if (
      readerRoute === 'reader' ||
      !reading ||
      pages.length === 0 ||
      readerScenario.startsWith('reader-') ||
      wasReaderRoute
    )
      return;
    onReaderPageChange(pageIndex);
  }, [
    onReaderPageChange,
    pageIndex,
    pages.length,
    readerRoute,
    readerScenario,
    reading,
  ]);

  useEffect(() => {
    if (!reading) return;
    window.setTimeout(() => readerStageRef.current?.focus(), 0);
  }, [reading]);

  useEffect(() => {
    if (!reading || !readerRailOpen) return;
    const rail = readerRailRef.current;
    if (!rail) return;

    function keepSelectedThumbnailVisible() {
      const selected = rail!.querySelector<HTMLButtonElement>(
        'button[aria-current="page"]'
      );
      if (!selected) return;

      const railBounds = rail!.getBoundingClientRect();
      const selectedBounds = selected.getBoundingClientRect();
      const header = rail!.querySelector<HTMLElement>('.reader-rail-header');
      const headerBounds = header?.getBoundingClientRect();
      const margin = 8;

      if (window.matchMedia('(max-width: 767px)').matches) {
        const visibleLeft = railBounds.left + (headerBounds?.width ?? 0);
        if (selectedBounds.left < visibleLeft) {
          rail!.scrollLeft -= visibleLeft - selectedBounds.left + margin;
        } else if (selectedBounds.right > railBounds.right) {
          rail!.scrollLeft += selectedBounds.right - railBounds.right + margin;
        }
      } else {
        const visibleTop = railBounds.top + (headerBounds?.height ?? 0);
        if (selectedBounds.top < visibleTop) {
          rail!.scrollTop -= visibleTop - selectedBounds.top + margin;
        } else if (selectedBounds.bottom > railBounds.bottom) {
          rail!.scrollTop += selectedBounds.bottom - railBounds.bottom + margin;
        }
      }
    }

    keepSelectedThumbnailVisible();
    const resizeObserver = new ResizeObserver(keepSelectedThumbnailVisible);
    resizeObserver.observe(rail);
    return () => resizeObserver.disconnect();
  }, [reading, readerRailOpen, pageIndex, pages.length]);

  useEffect(() => {
    if (!reading || readerCommentOpen) return;
    const selectRelativePage = (direction: -1 | 1) => {
      const nextIndex = Math.max(
        0,
        Math.min(pageIndex + direction, pages.length - 1)
      );
      setPageIndex(nextIndex);
      onReaderPageChange(nextIndex);
      readerStageRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    };
    function onReaderKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]'))
        return;
      if (event.key === 'ArrowLeft' && pageIndex > 0) {
        event.preventDefault();
        selectRelativePage(-1);
      }
      if (event.key === 'ArrowRight' && pageIndex < pages.length - 1) {
        event.preventDefault();
        selectRelativePage(1);
      }
    }
    document.addEventListener('keydown', onReaderKeyDown);
    return () => document.removeEventListener('keydown', onReaderKeyDown);
  }, [onReaderPageChange, pageIndex, pages.length, reading, readerCommentOpen]);

  function openReaderPage(index: number) {
    if (index < 0 || index >= pages.length) return;
    setPageIndex(index);
    onReaderPageChange(index);
    readerStageRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }

  function closeReader() {
    setReaderCommentOpen(false);
    setReading(false);
    onReaderClose();
    window.setTimeout(() => readerStartRef.current?.focus(), 0);
  }

  useEffect(() => {
    document.getElementById(`book-detail-title-${article.id}`)?.focus();
  }, [article.id]);

  useEffect(() => {
    const requestVersion = ++reviewRequestVersionRef.current;
    const expectedSessionKey = readerSessionKey;
    setPrivateReview(null);
    setReviewRevision({ version: 0, updatedAt: null });
    setReviewDraft('');
    setReviewConflict(null);
    setReviewNotice(null);
    setReviewDeleteOpen(false);
    setReviewMutation(null);
    setReviewEditing(false);
    setReviewLoadError(false);
    setReviewValidationRequested(false);
    setReviewDataSessionKey('');
    if (!readerSignedIn || !expectedSessionKey) {
      setReviewLoading(false);
      return;
    }
    setReviewLoading(true);
    async function hydratePrivateReview() {
      try {
        const response = await api.get(
          `/api/reader/reviews/${encodeURIComponent(article.id)}`
        );
        const slot = getPayload<ReviewSlotPayload>(response);
        if (
          reviewRequestVersionRef.current !== requestVersion ||
          reviewSessionKeyRef.current !== expectedSessionKey
        )
          return;
        if (!slot?.revision || !Number.isInteger(slot.revision.version))
          throw new Error('Unexpected review response.');
        setPrivateReview(slot.review ?? null);
        setReviewRevision(slot.revision);
        setReviewDraft(slot.review?.text ?? '');
        setReviewEditing(!slot.review);
        setReviewLoadError(false);
        setReviewDataSessionKey(expectedSessionKey);
      } catch (errorValue) {
        if (
          reviewRequestVersionRef.current !== requestVersion ||
          reviewSessionKeyRef.current !== expectedSessionKey
        )
          return;
        if (isUnauthorized(errorValue)) {
          onReaderSessionExpired();
          return;
        }
        setReviewDataSessionKey(expectedSessionKey);
        setReviewLoadError(true);
        setReviewNotice({
          tone: 'error',
          message:
            getErrorStatus(errorValue) === 404
              ? '這本研究目前未公開，評論暫時隱藏。'
              : '評論暫時無法載入，請稍後再試。',
        });
      } finally {
        if (
          reviewRequestVersionRef.current === requestVersion &&
          reviewSessionKeyRef.current === expectedSessionKey
        )
          setReviewLoading(false);
      }
    }
    void hydratePrivateReview();
  }, [article.id, reviewRetryToken, readerSignedIn, readerSessionKey]);

  useEffect(() => {
    if (
      !focusPrivateReview ||
      !readerSignedIn ||
      reviewLoading ||
      !reviewSessionReady
    )
      return;
    if (!privateReviewWorkspace) {
      setPrivateReviewWorkspace(true);
      return;
    }
    if (reviewLoadError) {
      onPrivateReviewFocused();
      return;
    }
    // Private workspace is opened only by explicit My Comments actions.
    if (privateReviewAction === 'delete' && privateReview) {
      openReviewDeleteDialog();
    } else if (privateReviewAction === 'view' && privateReview) {
      if (reviewEditing) {
        setReviewEditing(false);
        return;
      }
      reviewEditTriggerRef.current?.focus();
    } else {
      if (!reviewEditing) {
        setReviewEditing(true);
        return;
      }
      reviewTextRef.current?.focus();
    }
    onPrivateReviewFocused();
  }, [
    focusPrivateReview,
    privateReviewAction,
    readerSignedIn,
    reviewLoading,
    reviewSessionReady,
    reviewLoadError,
    reviewEditing,
    privateReviewWorkspace,
  ]);

  useEffect(() => {
    if (!reviewDeleteOpen) return;
    const dialog = reviewDeleteDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    if (reviewDeletePending || reviewSavePending) dialog?.focus();
    else reviewDeleteCancelRef.current?.focus();
    function containDeleteFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setReviewDeleteOpen(false);
        window.setTimeout(() => reviewDeleteTriggerRef.current?.focus(), 0);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', containDeleteFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', containDeleteFocus);
    };
  }, [reviewDeleteOpen, reviewDeletePending, reviewSavePending]);

  function applyReviewConflict(
    slot: ReviewSlotPayload | null,
    message: string
  ) {
    if (slot?.revision && Number.isInteger(slot.revision.version)) {
      setPrivateReview(slot.review ?? null);
      setReviewRevision(slot.revision);
      setReviewConflict(slot);
      setReviewEditing(true);
      onPrivateReviewChange(slot.review ?? null);
    }
    setReviewNotice({ tone: 'error', message });
    window.setTimeout(() => reviewTextRef.current?.focus(), 0);
  }

  async function savePrivateReview(event: FormEvent) {
    event.preventDefault();
    const validationMessage = reviewValidationMessage(reviewDraft);
    if (validationMessage) {
      setReviewValidationRequested(true);
      setReviewNotice(null);
      reviewTextRef.current?.focus();
      return;
    }
    if (!readerSignedIn || !readerSessionKey || reviewMutation) return;
    const expectedSessionKey = readerSessionKey;
    const requestVersion = ++reviewRequestVersionRef.current;
    setReviewMutation('save');
    setReviewNotice({
      tone: 'success',
      message: privateReview ? '正在更新評論…' : '正在儲存評論…',
    });
    try {
      const response = await api.put(
        `/api/reader/reviews/${encodeURIComponent(article.id)}`,
        {
          text: reviewDraft,
          baseVersion: reviewRevision.version,
          baseUpdatedAt: reviewRevision.updatedAt,
          mutationId: newReviewMutationId(),
        }
      );
      const slot = getPayload<ReviewSlotPayload>(response);
      if (
        reviewRequestVersionRef.current !== requestVersion ||
        reviewSessionKeyRef.current !== expectedSessionKey
      )
        return;
      if (
        !slot?.review ||
        !slot.revision ||
        slot.review.articleId !== article.id
      )
        throw new Error('Unexpected review response.');
      setPrivateReview(slot.review);
      setReviewRevision(slot.revision);
      setReviewDraft(slot.review.text);
      setReviewConflict(null);
      setReviewValidationRequested(false);
      setReviewEditing(false);
      setReviewNotice({
        tone: 'success',
        message: privateReview ? '評論已更新。' : '評論已儲存，只有你看得到。',
      });
      onPrivateReviewChange(slot.review);
    } catch (errorValue) {
      if (
        reviewRequestVersionRef.current !== requestVersion ||
        reviewSessionKeyRef.current !== expectedSessionKey
      )
        return;
      if (isUnauthorized(errorValue)) {
        onReaderSessionExpired();
        return;
      }
      if (getErrorStatus(errorValue) === 409) {
        applyReviewConflict(
          getErrorPayload<ReviewSlotPayload>(errorValue),
          '評論已在其他地方更新。你的草稿已保留，請比較後再儲存。'
        );
        return;
      }
      setReviewNotice({
        tone: 'error',
        message:
          getErrorStatus(errorValue) === 400
            ? '請檢查評論的長度及是否包含不支援的特殊字元。'
            : getErrorStatus(errorValue) === 404
              ? '這本研究目前未公開；既有評論仍會保留，重新上架後可繼續編輯。'
              : '評論未能儲存，你的草稿仍保留。',
      });
      window.setTimeout(() => reviewTextRef.current?.focus(), 0);
    } finally {
      if (
        reviewRequestVersionRef.current === requestVersion &&
        reviewSessionKeyRef.current === expectedSessionKey
      )
        setReviewMutation(null);
    }
  }

  function openReviewDeleteDialog() {
    setReviewNotice(
      reviewSavePending
        ? { tone: 'success', message: '目前正在儲存；儲存完成後才能確認刪除。' }
        : null
    );
    setReviewDeleteOpen(true);
  }

  function closeReviewDeleteDialog() {
    setReviewDeleteOpen(false);
    window.setTimeout(() => reviewDeleteTriggerRef.current?.focus(), 0);
  }

  function cancelPrivateReview() {
    setReviewDraft(privateReview?.text ?? '');
    setReviewConflict(null);
    setReviewValidationRequested(false);
    if (privateReview) {
      setReviewEditing(false);
      setReviewNotice({ tone: 'success', message: '已取消未儲存的評論變更。' });
      window.setTimeout(() => reviewEditTriggerRef.current?.focus(), 0);
      return;
    }
    setReviewNotice({ tone: 'success', message: '已取消未儲存的評論變更。' });
    window.setTimeout(() => reviewTextRef.current?.focus(), 0);
  }

  async function deletePrivateReview() {
    if (!readerSignedIn || !readerSessionKey || reviewMutation) return;
    const expectedSessionKey = readerSessionKey;
    const requestVersion = ++reviewRequestVersionRef.current;
    setReviewMutation('delete');
    setReviewNotice({ tone: 'success', message: '正在刪除評論…' });
    try {
      const response = await api.post(
        `/api/reader/reviews/${encodeURIComponent(article.id)}/delete`,
        {
          baseVersion: reviewRevision.version,
          baseUpdatedAt: reviewRevision.updatedAt,
          mutationId: newReviewMutationId(),
        }
      );
      const slot = getPayload<ReviewSlotPayload>(response);
      if (
        reviewRequestVersionRef.current !== requestVersion ||
        reviewSessionKeyRef.current !== expectedSessionKey
      )
        return;
      if (!slot?.revision || !Number.isInteger(slot.revision.version))
        throw new Error('Unexpected review delete response.');
      setPrivateReview(null);
      setReviewRevision(slot.revision);
      setReviewDraft('');
      setReviewConflict(null);
      setReviewDeleteOpen(false);
      setReviewEditing(true);
      setReviewNotice({ tone: 'success', message: '評論已刪除。' });
      onPrivateReviewChange(null);
      window.setTimeout(() => reviewTextRef.current?.focus(), 0);
    } catch (errorValue) {
      if (
        reviewRequestVersionRef.current !== requestVersion ||
        reviewSessionKeyRef.current !== expectedSessionKey
      )
        return;
      if (isUnauthorized(errorValue)) {
        setReviewDeleteOpen(false);
        onReaderSessionExpired();
        return;
      }
      if (getErrorStatus(errorValue) === 409) {
        setReviewDeleteOpen(false);
        applyReviewConflict(
          getErrorPayload<ReviewSlotPayload>(errorValue),
          '評論已在其他地方更新，本次未刪除。你的草稿已保留。'
        );
        return;
      }
      setReviewNotice({ tone: 'error', message: '評論未能刪除，請稍後再試。' });
      window.setTimeout(() => reviewDeleteConfirmRef.current?.focus(), 0);
    } finally {
      if (
        reviewRequestVersionRef.current === requestVersion &&
        reviewSessionKeyRef.current === expectedSessionKey
      )
        setReviewMutation(null);
    }
  }

  async function loadComments() {
    const requestVersion = ++commentRequestVersionRef.current;
    setCommentsLoading(true);
    setCommentLoadError(false);
    try {
      const response = await api.get(
        `/api/articles/${encodeURIComponent(article.id)}/comments`
      );
      const payload = getPayload<Comment[] | { comments: Comment[] }>(response);
      if (requestVersion !== commentRequestVersionRef.current) return;
      setComments(Array.isArray(payload) ? payload : (payload.comments ?? []));
    } catch {
      if (requestVersion !== commentRequestVersionRef.current) return;
      setComments([]);
      setCommentLoadError(true);
    } finally {
      if (requestVersion === commentRequestVersionRef.current)
        setCommentsLoading(false);
    }
  }

  useEffect(() => {
    void loadComments();
  }, [article.id]);

  function focusFirstInvalidCommentField(errors: CommentValidationErrors) {
    window.setTimeout(() => {
      if (errors.displayName) commentNameRef.current?.focus();
      else if (errors.body) commentBodyRef.current?.focus();
    }, 0);
  }

  async function postComment() {
    if (commentSubmittingRef.current) return;
    const errors = commentValidationErrors(commentName, commentBody);
    setCommentValidationRequested(true);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalidCommentField(errors);
      return;
    }
    commentSubmittingRef.current = true;
    setSubmitting(true);
    setCommentNotice(null);
    try {
      const response = await api.post(
        `/api/articles/${encodeURIComponent(article.id)}/comments`,
        {
          displayName: normalizeCommentValue(commentName),
          body: normalizeCommentValue(commentBody),
          trackInMyComments: readerSignedIn,
        }
      );
      const created = getEntity<Comment>(response, 'comment');
      setComments(items => [created, ...items]);
      setCommentBody('');
      setCommentValidationRequested(false);
      setCommentNotice({
        tone: 'success',
        message: '留言已發佈。新留言已加入公開留言串。',
      });
      if (reading) {
        setReaderCommentOpen(false);
      } else {
        setCommentFocusId(created.id);
      }
    } catch (caught) {
      if (isUnauthorized(caught)) onReaderSessionExpired();
      setCommentNotice({
        tone: 'error',
        message: isUnauthorized(caught)
          ? '登入已過期，留言尚未送出。請重新登入；你的內容已保留。'
          : '留言暫時未能發佈。已保留你的內容，可以重試。',
      });
    } finally {
      commentSubmittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void postComment();
  }

  function closeReaderComment() {
    if (commentSubmittingRef.current) return;
    setReaderCommentOpen(false);
  }

  useEffect(() => {
    if (!reading) setReaderRailOpen(false);
  }, [reading]);

  useEffect(() => {
    if (!readerCommentOpen && readerCommentWasOpenRef.current)
      readerCommentTriggerRef.current?.focus();
    readerCommentWasOpenRef.current = readerCommentOpen;
  }, [readerCommentOpen]);

  useEffect(() => {
    if (!readerCommentOpen) return;
    const dialog = readerCommentDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    commentNameRef.current?.focus();
    function containCommentFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeReaderComment();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]'
        ) ?? []
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialog?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', containCommentFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', containCommentFocus);
    };
  }, [readerCommentOpen]);

  if (reading)
    return (
      <article
        className={`immersive-reader${readerRailOpen ? '' : ' reader-rail-collapsed'}`}
      >
        <header
          className="reader-toolbar application-banner"
          inert={readerCommentOpen}
        >
          <div className="reader-toolbar-start">
            <ApplicationBrand
              onClick={() => {
                window.location.hash = '/';
              }}
            />
            <button className="reader-back" type="button" onClick={closeReader}>
              <ChevronLeft size={20} aria-hidden="true" />
              返回研究書
            </button>
          </div>
          <strong className="reader-toolbar-title">{article.title}</strong>
          <div className="reader-toolbar-end">
            <button
              className="reader-discussion-entry"
              type="button"
              onClick={onDiscussion}
            >
              討論吧
            </button>
            <span className="reader-progress" aria-live="polite">
              {pageIndex + 1} / {pages.length} 頁
            </span>
            <span className="reader-toolbar-divider" aria-hidden="true" />
            <div className="nav-links reader-toolbar-account">
              {accountControl}
            </div>
          </div>
        </header>
        <div className="reader-layout" inert={readerCommentOpen}>
          <aside
            id="reader-page-rail"
            ref={readerRailRef}
            className="page-rail"
            aria-label="研究頁面縮圖"
          >
            <div className="reader-rail-header">
              <button
                className="reader-rail-toggle"
                type="button"
                aria-controls="reader-page-rail"
                aria-expanded={readerRailOpen}
                aria-label={readerRailOpen ? '收合頁面縮圖' : '展開頁面縮圖'}
                onClick={() => setReaderRailOpen(open => !open)}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            </div>
            {pages.map((page, index) => (
              <button
                key={page.id ?? index}
                type="button"
                className={index === pageIndex ? 'active' : ''}
                aria-current={index === pageIndex ? 'page' : undefined}
                aria-label={`開啟第 ${index + 1} 頁：${page.title || '未命名頁面'}${index === pageIndex ? '，目前頁面' : ''}`}
                onClick={() => openReaderPage(index)}
              >
                <span className="page-thumb-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <PageArtworkImage
                  article={article}
                  page={page}
                  index={index}
                  decorative
                />
                {index === pageIndex && (
                  <small className="page-thumb-current">目前頁面</small>
                )}
              </button>
            ))}
          </aside>
          <section
            ref={readerStageRef}
            className="page-stage immersive-stage"
            tabIndex={-1}
            aria-label="研究頁面閱讀區"
          >
            {readerPageInvalid ? (
              <StatePanel
                icon={<CircleAlert />}
                eyebrow=""
                title="找不到這個閱讀頁面"
                copy="這個閱讀連結沒有對應的公開頁面；你可以從第一頁重新開始。"
                action="開啟第一頁"
                onAction={() => openReaderPage(0)}
              />
            ) : currentPage ? (
              <figure
                className="reader-page-figure"
                style={
                  { '--reader-page-ratio': pageImageRatio } as CSSProperties
                }
              >
                <figcaption>
                  <strong>{readerPageDisplayTitle(currentPage.title)}</strong>
                </figcaption>
                <div className="reader-page-canvas">
                  <button
                    className="reader-page-chevron reader-page-chevron-prev"
                    type="button"
                    aria-label="上一頁"
                    disabled={pageIndex === 0}
                    onClick={() => openReaderPage(pageIndex - 1)}
                  >
                    <ChevronLeft size={26} aria-hidden="true" />
                  </button>
                  <ReaderPageArtworkImage
                    article={article}
                    page={currentPage}
                    index={pageIndex}
                    onReturn={closeReader}
                    onImageLoad={setPageImageRatio}
                  />
                  <button
                    className="reader-page-chevron reader-page-chevron-next"
                    type="button"
                    aria-label="下一頁"
                    disabled={pageIndex >= pages.length - 1}
                    onClick={() => openReaderPage(pageIndex + 1)}
                  >
                    <ChevronRight size={26} aria-hidden="true" />
                  </button>
                </div>
              </figure>
            ) : (
              <StatePanel
                icon={<FileImage />}
                title="目前沒有可閱讀的頁面"
                copy="這本研究書尚未準備圖像頁面，請返回研究書查看內容。"
                action="返回研究書"
                onAction={closeReader}
              />
            )}
          </section>
        </div>
        {!readerCommentOpen && commentNotice?.tone === 'success' && (
          <p className="reader-comment-success" role="status">
            {commentNotice.message}
          </p>
        )}
        <button
          ref={readerCommentTriggerRef}
          className="reader-comment-trigger"
          type="button"
          aria-label="新增留言"
          title="新增留言"
          aria-haspopup="dialog"
          inert={readerCommentOpen}
          onClick={() => {
            setCommentNotice(null);
            setCommentValidationRequested(false);
            setReaderCommentOpen(true);
          }}
        >
          <MessageSquare size={23} fill="currentColor" aria-hidden="true" />
        </button>
        {readerCommentOpen && (
          <div className="reader-comment-backdrop">
            <div
              ref={readerCommentDialogRef}
              className="reader-comment-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-comment-title"
              aria-describedby="reader-comment-disclosure"
              tabIndex={-1}
            >
              <button
                className="reader-comment-close"
                type="button"
                aria-label="關閉留言視窗"
                disabled={submitting}
                onClick={closeReaderComment}
              >
                <X size={20} aria-hidden="true" />
              </button>
              <h2 id="reader-comment-title">新增留言</h2>
              <p id="reader-comment-disclosure">
                {readerSignedIn
                  ? '留言將公開顯示於這本研究書，並列入你的「我的評論」。'
                  : '留言將公開顯示於這本研究書。未登入的留言不會列入「我的評論」。'}
              </p>
              <form onSubmit={submitComment} noValidate aria-busy={submitting}>
                <label htmlFor="reader-comment-name">顯示名稱</label>
                <input
                  ref={commentNameRef}
                  id="reader-comment-name"
                  required
                  disabled={submitting}
                  value={commentName}
                  placeholder="輸入顯示名稱"
                  aria-invalid={
                    commentValidationRequested &&
                    Boolean(currentCommentErrors.displayName)
                  }
                  aria-describedby={
                    commentValidationRequested &&
                    currentCommentErrors.displayName
                      ? 'reader-comment-name-error'
                      : undefined
                  }
                  onChange={event => {
                    setCommentName(event.target.value);
                    setCommentNotice(null);
                  }}
                />
                {commentValidationRequested &&
                  currentCommentErrors.displayName && (
                    <p
                      id="reader-comment-name-error"
                      className="reader-comment-error"
                      role="alert"
                    >
                      {currentCommentErrors.displayName}
                    </p>
                  )}
                <label htmlFor="reader-comment-body">留言內容</label>
                <textarea
                  ref={commentBodyRef}
                  id="reader-comment-body"
                  required
                  disabled={submitting}
                  value={commentBody}
                  rows={4}
                  placeholder="分享你的想法…"
                  aria-invalid={
                    commentValidationRequested &&
                    Boolean(currentCommentErrors.body)
                  }
                  aria-describedby={
                    commentValidationRequested && currentCommentErrors.body
                      ? 'reader-comment-body-error'
                      : undefined
                  }
                  onChange={event => {
                    setCommentBody(event.target.value);
                    setCommentNotice(null);
                  }}
                />
                {commentValidationRequested && currentCommentErrors.body && (
                  <p
                    id="reader-comment-body-error"
                    className="reader-comment-error"
                    role="alert"
                  >
                    {currentCommentErrors.body}
                  </p>
                )}
                {commentNotice && (
                  <p
                    className={`reader-comment-feedback ${commentNotice.tone}`}
                    role={commentNotice.tone === 'error' ? 'alert' : 'status'}
                  >
                    {commentNotice.message}
                  </p>
                )}
                <div className="reader-comment-actions">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={closeReaderComment}
                  >
                    取消
                  </button>
                  <button
                    className="reader-comment-submit"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting
                      ? '送出中…'
                      : commentNotice?.tone === 'error'
                        ? '重試送出留言'
                        : '送出留言'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </article>
    );

  return (
    <article className="research-detail">
      <section
        className="detail-hero"
        aria-labelledby={`book-detail-title-${article.id}`}
      >
        <div className="detail-cover">
          <CoverArtwork article={article} />
        </div>
        <div className="detail-copy">
          <ArticleMeta article={article} />
          <h1 id={`book-detail-title-${article.id}`} tabIndex={-1}>
            {article.title}
          </h1>
          <span className="detail-title-rule" aria-hidden="true" />
          <p>{article.summary}</p>
          <TagList tags={article.tags} />
          <div className="detail-actions">
            {pages.length > 0 ? (
              <button
                ref={readerStartRef}
                className="read-cta"
                type="button"
                onClick={() => setReading(true)}
              >
                <BookOpen size={18} /> 開始閱讀
              </button>
            ) : (
              <div className="inline-notice reader-entry-notice" role="status">
                圖像研究頁面正在準備中，目前尚無法開始閱讀。
              </div>
            )}
            <button
              data-reader-favorite-action={article.id}
              className={
                favorited ? 'favorite-button is-active' : 'favorite-button'
              }
              type="button"
              aria-pressed={favorited}
              aria-label={
                !readerSignedIn
                  ? `登入並收藏研究：${article.title}`
                  : favorited
                    ? `從收藏移除：${article.title}`
                    : `加入收藏：${article.title}`
              }
              aria-busy={favoritePending}
              disabled={favoritePending}
              onClick={event =>
                onToggleFavorite(event.currentTarget, {
                  displayName: commentName,
                  body: commentBody,
                })
              }
            >
              <Heart size={18} fill={favorited ? 'currentColor' : 'none'} />{' '}
              {favoritePending
                ? '更新收藏…'
                : favorited
                  ? '已收藏'
                  : '加入收藏'}
            </button>
          </div>
          {favoriteFeedback && (
            <div
              className={`favorite-feedback ${favoriteFeedback.tone}`}
              role={favoriteFeedback.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span>{favoriteFeedback.message}</span>
              {favoriteFeedback.tone === 'error' &&
                favoriteFeedback.retryFavorited !== undefined && (
                  <button
                    type="button"
                    disabled={favoritePending}
                    onClick={() =>
                      onRetryFavorite(favoriteFeedback.retryFavorited!)
                    }
                  >
                    重試
                  </button>
                )}
            </div>
          )}
          <p className="detail-auth-note">
            收藏功能使用讀者帳號，登入後會返回這本研究書。
          </p>
        </div>
      </section>
      {privateReviewWorkspace && readerSignedIn && (
        <div className="detail-extras">
          <section
            className="private-review-section"
            aria-labelledby={`private-review-heading-${article.id}`}
          >
            <header>
              <div>
                <h2 id={`private-review-heading-${article.id}`}>我的評論</h2>
              </div>
              <strong>只有你看得到</strong>
            </header>
            {!readerSignedIn ? (
              <div className="private-review-signed-out">
                <p>每本研究可撰寫一則評論，只有你看得到。</p>
                <button
                  type="button"
                  onClick={event =>
                    onRequestReviewSignIn(event.currentTarget, {
                      displayName: commentName,
                      body: commentBody,
                    })
                  }
                >
                  <LogIn size={17} /> 登入並撰寫評論
                </button>
              </div>
            ) : reviewLoading || !reviewSessionReady ? (
              <LoadingSkeleton kind='form' label='正在載入評論…' rows={1} />
            ) : reviewLoadError ? (
              <div
                className="private-review-recovery"
                role="alert"
                aria-live="assertive"
              >
                <p>{reviewNotice?.message ?? '評論暫時無法載入。'}</p>
                <button
                  type="button"
                  onClick={() => {
                    setReviewLoadError(false);
                    setReviewNotice(null);
                    setReviewRetryToken(value => value + 1);
                  }}
                >
                  重試載入
                </button>
              </div>
            ) : privateReview && !reviewEditing ? (
              <div className="private-review-saved" aria-label="目前儲存的評論">
                <div className="private-review-summary">
                  <span>
                    已儲存版本 {privateReview.version} ·{' '}
                    {formatDate(privateReview.updatedAt)}
                  </span>
                  <p>{privateReview.text}</p>
                </div>
                {reviewNotice && (
                  <div
                    className={`private-review-status ${reviewNotice.tone}`}
                    role={reviewNotice.tone === 'error' ? 'alert' : 'status'}
                    aria-live={
                      reviewNotice.tone === 'error' ? 'assertive' : 'polite'
                    }
                  >
                    {reviewNotice.message}
                  </div>
                )}
                <div className="private-review-actions">
                  <button
                    ref={reviewEditTriggerRef}
                    className="primary-action"
                    type="button"
                    onClick={() => {
                      setReviewNotice(null);
                      setReviewEditing(true);
                      window.setTimeout(
                        () => reviewTextRef.current?.focus(),
                        0
                      );
                    }}
                  >
                    編輯評論
                  </button>
                  <button
                    ref={reviewDeleteTriggerRef}
                    className="private-review-delete"
                    type="button"
                    disabled={reviewDeletePending}
                    onClick={openReviewDeleteDialog}
                  >
                    <Trash2 size={16} /> 刪除評論
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="private-review-form"
                onSubmit={savePrivateReview}
                aria-busy={reviewSavePending}
                noValidate
              >
                {privateReview && (
                  <div
                    className="private-review-summary"
                    aria-label="目前儲存的評論摘要"
                  >
                    <span>
                      已儲存版本 {privateReview.version} ·{' '}
                      {formatDate(privateReview.updatedAt)}
                    </span>
                    <p>{privateReview.text}</p>
                  </div>
                )}
                <label htmlFor={`private-review-${article.id}`}>評論內容</label>
                <textarea
                  ref={reviewTextRef}
                  id={`private-review-${article.id}`}
                  value={reviewDraft}
                  rows={7}
                  required
                  aria-invalid={
                    reviewValidationRequested && Boolean(reviewValidationError)
                  }
                  aria-describedby={`private-review-help-${article.id} private-review-count-${article.id}${reviewValidationRequested && reviewValidationError ? ` private-review-validation-${article.id}` : ''}`}
                  aria-errormessage={
                    reviewValidationRequested && reviewValidationError
                      ? `private-review-validation-${article.id}`
                      : undefined
                  }
                  onChange={event => {
                    setReviewDraft(event.target.value);
                    setReviewValidationRequested(false);
                    if (reviewNotice?.tone === 'error') setReviewNotice(null);
                  }}
                  placeholder="記下只屬於你的研究觀察、疑問或後續追蹤線索"
                />
                {reviewValidationRequested && reviewValidationError && (
                  <div
                    id={`private-review-validation-${article.id}`}
                    className="private-review-validation"
                    role="alert"
                  >
                    <strong>請檢查評論內容：</strong>{' '}
                    <span>{reviewValidationError}</span>
                  </div>
                )}
                <div className="private-review-guidance">
                  <span id={`private-review-help-${article.id}`}>
                    只有你看得到，最多 2,000 個字元。
                  </span>
                  <strong
                    id={`private-review-count-${article.id}`}
                    className={reviewLength > 2_000 ? 'over-limit' : ''}
                  >
                    {reviewLength} / 2,000
                  </strong>
                </div>
                {reviewConflict && (
                  <div className="review-conflict" role="alert">
                    <strong>最新儲存的評論</strong>
                    <p>
                      {reviewConflict.review?.text ?? '評論已在其他地方刪除。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewDraft(reviewConflict.review?.text ?? '');
                        setReviewConflict(null);
                        setReviewNotice({
                          tone: 'success',
                          message: '已載入最新評論。',
                        });
                        window.setTimeout(
                          () => reviewTextRef.current?.focus(),
                          0
                        );
                      }}
                    >
                      使用最新評論
                    </button>
                  </div>
                )}
                {reviewNotice && (
                  <div
                    className={`private-review-status ${reviewNotice.tone}`}
                    role={reviewNotice.tone === 'error' ? 'alert' : 'status'}
                    aria-live={
                      reviewNotice.tone === 'error' ? 'assertive' : 'polite'
                    }
                  >
                    {reviewNotice.message}
                  </div>
                )}
                <div className="private-review-actions">
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={reviewSavePending}
                  >
                    {reviewSavePending
                      ? '儲存中…'
                      : reviewNotice?.tone === 'error'
                        ? '重試儲存評論'
                        : privateReview
                          ? '更新評論'
                          : '儲存評論'}
                  </button>
                  <button
                    className="private-review-cancel"
                    type="button"
                    disabled={reviewDeletePending || !reviewDirty}
                    onClick={cancelPrivateReview}
                  >
                    取消
                  </button>
                  {privateReview && (
                    <button
                      ref={reviewDeleteTriggerRef}
                      className="private-review-delete"
                      type="button"
                      disabled={reviewDeletePending}
                      onClick={openReviewDeleteDialog}
                    >
                      <Trash2 size={16} /> 刪除評論
                    </button>
                  )}
                </div>
              </form>
            )}
          </section>
          {reviewDeleteOpen && (
            <div className="review-delete-backdrop">
              <div
                ref={reviewDeleteDialogRef}
                className="review-delete-dialog"
                role="dialog"
                aria-modal="true"
                aria-busy={reviewDeletePending || reviewSavePending}
                aria-labelledby={`review-delete-title-${article.id}`}
                aria-describedby={`review-delete-copy-${article.id}`}
                tabIndex={-1}
              >
                <span className="kicker">刪除確認</span>
                <h2 id={`review-delete-title-${article.id}`}>
                  刪除「{article.title}」的評論？
                </h2>
                <p id={`review-delete-copy-${article.id}`}>
                  刪除後無法復原。你的收藏和公開留言不受影響。
                </p>
                {reviewNotice && (
                  <div
                    className={
                      reviewNotice.tone === 'error'
                        ? 'review-delete-error'
                        : 'review-delete-status'
                    }
                    role={reviewNotice.tone === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {reviewNotice.message}
                  </div>
                )}
                <div>
                  <button
                    ref={reviewDeleteCancelRef}
                    type="button"
                    onClick={closeReviewDeleteDialog}
                  >
                    保留評論
                  </button>
                  <button
                    ref={reviewDeleteConfirmRef}
                    className="danger-action"
                    type="button"
                    disabled={reviewDeletePending || reviewSavePending}
                    onClick={() => void deletePrivateReview()}
                  >
                    {reviewDeletePending
                      ? '刪除中…'
                      : reviewNotice?.tone === 'error'
                        ? '重試刪除'
                        : '確認刪除'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function DraftPreview({
  article,
  onBack,
  persistenceNote,
  previewState = 'ready',
  onPublish,
  canPublish = false,
}: {
  article: AdminDraft;
  onBack: () => void;
  persistenceNote: string;
  previewState?: 'ready' | 'unavailable';
  onPublish: () => void;
  canPublish?: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const pages = [...article.pages].sort(
    (left, right) => left.order - right.order
  );
  const activeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const currentPage = pages[activeIndex];
  const thumbnailSize = 4;
  const thumbnailGroup = Math.floor(activeIndex / thumbnailSize);
  const thumbnailCount = Math.ceil(pages.length / thumbnailSize);
  const cover = pages.find(
    (page, index) => pageIdentity(page, index) === article.coverPageId
  );
  const lost = !article.id && !article.title.trim() && pages.length === 0;
  const unavailable = previewState === 'unavailable';
  const checks = [
    {
      label: '研究書標題',
      complete: Boolean(article.title.trim()),
      detail: article.title.trim() ? '已填寫' : '請填寫書名',
    },
    {
      label: '研究書摘要與資訊',
      complete: Boolean(
        article.summary.trim() &&
        article.sector.trim() &&
        isValidDraftPublicationDate(article.publicationDate)
      ),
      detail:
        article.summary.trim() &&
        article.sector.trim() &&
        isValidDraftPublicationDate(article.publicationDate)
          ? '簡介、產業與日期已填寫'
          : '請完成簡介、產業與有效日期',
    },
    {
      label: '封面圖片',
      complete: Boolean(cover?.imageUrl),
      detail: cover?.imageUrl ? '已選擇封面' : '請選擇封面',
    },
    {
      label: '內容頁數',
      complete: pages.length > 0,
      detail: `共 ${pages.length} 頁（至少 1 頁）`,
    },
    {
      label: '每頁皆有說明',
      complete:
        pages.length > 0 &&
        pages.every(page => page.title.trim() && page.altText.trim()),
      detail: `${pages.filter(page => page.title.trim() && page.altText.trim()).length} / ${pages.length} 頁已填寫標題與簡介`,
    },
  ];
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  return (
    <article className="draft-preview private-preview-workspace">
      <header className="preview-banner application-banner">
        <div className="preview-banner-start">
          <ApplicationBrand
            onClick={() => {
              window.location.hash = '/';
            }}
          />
          <button type="button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回編輯
          </button>
        </div>
        <span>
          <LockKeyhole size={16} /> 私人預覽 · 僅作者可見
        </span>
      </header>
      <header className="private-preview-heading">
        <h1>私人預覽</h1>
        <p>確認研究內容、頁面順序與說明，再與讀者分享。</p>
        <small>{persistenceNote}</small>
      </header>
      {lost || unavailable ? (
        <section className="preview-recovery">
          <h2>
            {unavailable ? '目前無法取得這本研究書' : '請返回編輯器重新預覽'}
          </h2>
          <p>
            {unavailable
              ? '研究書可能已刪除，或預覽連結已失效。未載入任何私人內容。'
              : '未儲存的預覽只保留在目前分頁，重新載入後無法復原。'}
          </p>
          <button type="button" onClick={onBack}>
            返回編輯
          </button>
        </section>
      ) : (
        <div className="private-preview-grid">
          <section className="private-preview-book">
            <div
              className="private-preview-summary"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="private-preview-cover">
                {currentPage?.imageUrl ? (
                  <img
                    src={currentPage.imageUrl}
                    alt={
                      currentPage.altText || currentPage.title || '研究書頁面'
                    }
                  />
                ) : (
                  <span>
                    <FileImage size={30} /> 尚無內容頁面
                  </span>
                )}
              </div>
              <div>
                <span className="private-preview-sector">
                  {article.sector || '尚未填寫產業'} ·{' '}
                  {article.title || '尚未填寫書名'}
                </span>
                <h2>
                  {currentPage
                    ? currentPage.title || '未命名頁面'
                    : article.title || '尚未填寫書名'}
                </h2>
                <p className="private-preview-meta">
                  {article.publicationDate || '尚未填寫日期'} ·{' '}
                  {currentPage
                    ? `第 ${activeIndex + 1} / ${pages.length} 頁`
                    : '0 頁'}
                </p>
                <p>
                  {currentPage
                    ? currentPage.altText || '尚未填寫頁面簡介。'
                    : article.summary || '請在編輯器加入書籍簡介。'}
                </p>
                <TagList tags={article.tags} />
              </div>
            </div>
            <h3>
              內容預覽 <span>共 {pages.length} 頁</span>
            </h3>
            <div className="private-preview-thumbnails" aria-label="研究書頁面">
              {pages
                .slice(
                  thumbnailGroup * thumbnailSize,
                  (thumbnailGroup + 1) * thumbnailSize
                )
                .map((page, offset) => {
                  const index = thumbnailGroup * thumbnailSize + offset;
                  return (
                    <button
                      type="button"
                      key={page.id || index}
                      aria-label={`預覽第 ${index + 1} 頁：${page.title || '未命名頁面'}`}
                      aria-current={index === activeIndex ? 'page' : undefined}
                      onClick={() => setPageIndex(index)}
                    >
                      <img src={page.imageUrl} alt="" />
                      <span>
                        {String(index + 1).padStart(2, '0')} ·{' '}
                        {page.title || '未命名頁面'}
                      </span>
                    </button>
                  );
                })}
            </div>
            {thumbnailCount > 1 && (
              <nav
                className="catalog-pagination preview-thumbnail-pagination"
                aria-label="預覽縮圖分頁"
              >
                <span role="status" aria-live="polite">
                  第 {thumbnailGroup * thumbnailSize + 1}–
                  {Math.min((thumbnailGroup + 1) * thumbnailSize, pages.length)}{' '}
                  頁，共 {pages.length} 頁
                </span>
                <div>
                  <button
                    type="button"
                    aria-label="上一組預覽縮圖"
                    disabled={thumbnailGroup === 0}
                    onClick={() =>
                      setPageIndex((thumbnailGroup - 1) * thumbnailSize)
                    }
                  >
                    <ChevronLeft size={15} />
                  </button>
                  {Array.from({ length: thumbnailCount }, (_, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-label={`第 ${index + 1} 組預覽縮圖`}
                      aria-current={
                        index === thumbnailGroup ? 'page' : undefined
                      }
                      onClick={() => setPageIndex(index * thumbnailSize)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="下一組預覽縮圖"
                    disabled={thumbnailGroup === thumbnailCount - 1}
                    onClick={() =>
                      setPageIndex((thumbnailGroup + 1) * thumbnailSize)
                    }
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </nav>
            )}
            {pages.length === 0 && (
              <p className="private-preview-empty">
                尚無內容頁面，請返回編輯器加入圖片。
              </p>
            )}
          </section>
          <aside
            className="private-preview-readiness"
            aria-labelledby="preview-readiness-title"
          >
            <h2 id="preview-readiness-title">發布條件檢查</h2>
            <p>
              {article.published
                ? '這本研究書已發布，此處仍為作者私人預覽。'
                : '完成所有項目並儲存後，即可發布研究書。'}
            </p>
            <ul>
              {checks.map(check => (
                <li key={check.label}>
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                  {check.complete ? (
                    <Check size={20} aria-label="已完成" />
                  ) : (
                    <CircleAlert size={20} aria-label="尚未完成" />
                  )}
                </li>
              ))}
            </ul>
            {!article.published && (
              <button
                type="button"
                className="preview-publish"
                disabled={!canPublish || !checks.every(check => check.complete)}
                onClick={onPublish}
              >
                <Send size={18} /> 發布研究書
              </button>
            )}
            {!article.published && !canPublish && (
              <small>請先返回編輯器完成並儲存變更。</small>
            )}
          </aside>
        </div>
      )}
    </article>
  );
}

function AdminView({
  onDataChanged,
  onDirtyChange,
}: {
  onDataChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const adminLocalScenario = localFixtureScenario();
  const adminUnlockScenario = adminUnlockFixtureScenario(adminLocalScenario);
  const isAdminEditorFixture = adminLocalScenario.startsWith('admin-editor');
  const editorFixtureArticleId =
    adminLocalScenario === 'admin-editor-new'
      ? ''
      : isAdminEditorFixture
        ? 'private-draft'
        : '';
  const [secret, setSecret] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionRestoreStatus, setSessionRestoreStatus] = useState<
    'idle' | 'checking' | 'error'
  >(() => (readStoredAdminSession() ? 'checking' : 'idle'));
  const [sessionRestoreAttempt, setSessionRestoreAttempt] = useState(0);
  const [sessionToken, setSessionToken] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | number>('');
  const [adminSessionWarning, setAdminSessionWarning] = useState(false);
  const [logoutStatus, setLogoutStatus] = useState<AdminLogoutStatus>('idle');
  const [adminArticles, setAdminArticles] = useState<Article[]>([]);
  const [adminListStatus, setAdminListStatus] =
    useState<AdminListStatus>('idle');
  const [showBookList, setShowBookList] = useState(!isAdminEditorFixture);
  const [feedbackRoute, setFeedbackRoute] = useState(
    () => window.location.hash === '#/admin/reader-feedback'
  );
  const [etfRoute, setEtfRoute] = useState(
    () => window.location.hash.split('?')[0] === '#/admin/active-etf'
  );
  const [calendarRoute, setCalendarRoute] = useState(() => location.hash.split('?')[0] === '#/admin/calendar');
  const [institutionalRoute,setInstitutionalRoute] = useState(() => location.hash.split('?')[0] === '#/admin/institutional-flows');
  const [etfDirty, setEtfDirty] = useState(false);
  const [editorRouteArticleId, setEditorRouteArticleId] = useState(() =>
    adminEditorArticleId()
  );
  const [adminSearch, setAdminSearch] = useState(
    adminLocalScenario === 'admin-book-list-no-results'
      ? 'No matching title'
      : ''
  );
  const [adminStatusFilter, setAdminStatusFilter] = useState<
    'all' | 'published' | 'draft'
  >(
    adminLocalScenario === 'admin-book-list-draft'
      ? 'draft'
      : adminLocalScenario === 'admin-book-list-published'
        ? 'published'
        : 'all'
  );
  const [adminCatalogPage, setAdminCatalogPage] = useState(0);
  useEffect(() => {
    setAdminCatalogPage(0);
  }, [adminSearch, adminStatusFilter]);
  useEffect(() => {
    setAdminCatalogPage(page =>
      Math.min(page, Math.max(0, Math.ceil(adminArticles.length / 3) - 1))
    );
  }, [adminArticles.length]);
  const [adminActionFeedback, setAdminActionFeedback] =
    useState<AdminActionFeedback>(() => {
      const articleId = 'semiconductor-cycle';
      if (adminLocalScenario === 'admin-book-list-action-pending')
        return { articleId, action: 'unpublish', state: 'pending' };
      if (adminLocalScenario === 'admin-book-list-action-failed')
        return { articleId, action: 'unpublish', state: 'failed' };
      if (adminLocalScenario === 'admin-book-list-action-stale')
        return { articleId, action: 'unpublish', state: 'stale' };
      return null;
    });
  const [adminDestination, setAdminDestination] = useState<
    'all' | 'published' | 'drafts' | 'comments'
  >('all');
  const [mobileChooserOpen, setMobileChooserOpen] = useState(false);
  const [draft, setDraft] = useState<AdminDraft>(createEmptyDraft);
  const [savedFingerprint, setSavedFingerprint] = useState(() => {
    const fingerprint = draftFingerprint(draft);
    return fingerprint === draftFingerprint(createEmptyDraft())
      ? fingerprint
      : '';
  });
  const [tagInput, setTagInput] = useState('');
  const [notice, setNotice] = useState<Notice>(() =>
    initialAdminUnlockNotice(adminUnlockScenario)
  );
  const [validationRequested, setValidationRequested] = useState(false);
  const [uploadRecoveryState, setUploadRecoveryState] =
    useState<UploadRecoveryState>(null);
  const [busy, setBusy] = useState(adminUnlockScenario === 'checking');
  const [editorLoadPending, setEditorLoadPending] = useState(false);
  const [editorSavePending, setEditorSavePending] = useState(false);
  const [fileActivity, setFileActivity] = useState('');
  const [confirmation, setConfirmation] = useState<AdminConfirmation>(null);
  const [pageRemovalConfirmation, setPageRemovalConfirmation] =
    useState<PageRemovalConfirmation>(null);
  const [pagePositionMessage, setPagePositionMessage] = useState('');
  const [editorPage, setEditorPage] = useState(0);
  const [lifecycleMutation, setLifecycleMutation] =
    useState<AdminLifecycleMutation>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [republishArticleIds, setRepublishArticleIds] = useState<Set<string>>(
    () =>
      new Set(
        adminLocalScenario === 'admin-publication-republish-pending'
          ? ['private-draft']
          : []
      )
  );
  const [previewRoute, setPreviewRoute] = useState<PrivatePreviewRoute | null>(
    () => parsePrivatePreviewRoute()
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewState, setPreviewState] = useState<'ready' | 'unavailable'>(
    'ready'
  );
  const isPreview = previewRoute !== null;
  const previewArticleId =
    previewRoute?.kind === 'saved' ? previewRoute.articleId : '';
  const secretInputRef = useRef<HTMLInputElement>(null);
  const unlockNoticeRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const mobileChooserTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileChooserRef = useRef<HTMLElement>(null);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const pageRemovalDialogRef = useRef<HTMLDivElement>(null);
  const adminSessionNoticeRef = useRef<HTMLDivElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);
  const pageRemovalTriggerRef = useRef<HTMLElement | null>(null);
  const adminListHeadingRef = useRef<HTMLDivElement>(null);
  const metadataTitleInputRef = useRef<HTMLInputElement>(null);
  const metadataSectorInputRef = useRef<HTMLInputElement>(null);
  const metadataDateInputRef = useRef<HTMLInputElement>(null);
  const metadataSummaryInputRef = useRef<HTMLTextAreaElement>(null);
  const lifecycleMutationRef = useRef<AdminLifecycleMutation>(null);
  const editorFixtureLoadedRef = useRef(false);
  const draftRef = useRef<AdminDraft>(draft);
  const editorRevisionRef = useRef(0);
  const editorSavePendingRef = useRef(false);
  const uploadBatchActiveRef = useRef(false);
  const adminSessionGenerationRef = useRef(0);
  const adminLogoutRetryTokenRef = useRef('');

  useEffect(() => {
    if (!mobileChooserOpen) return;
    const chooser = mobileChooserRef.current;
    const focusable = () =>
      Array.from(
        chooser?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    focusable()[0]?.focus();
    function containFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileChooserOpen(false);
        window.setTimeout(() => mobileChooserTriggerRef.current?.focus(), 0);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', containFocus);
    return () => document.removeEventListener('keydown', containFocus);
  }, [mobileChooserOpen]);

  const lastEditorHashRef = useRef(window.location.hash);
  useEffect(() => {
    const syncEditorRoute = () => {
      if (lastEditorHashRef.current === window.location.hash) return;
      lastEditorHashRef.current = window.location.hash;
      setEditorRouteArticleId(adminEditorArticleId());
      setFeedbackRoute(window.location.hash === '#/admin/reader-feedback');
      setEtfRoute(window.location.hash.split('?')[0] === '#/admin/active-etf');
      setInstitutionalRoute(window.location.hash.split('?')[0] === '#/admin/institutional-flows');
      setCalendarRoute(window.location.hash.split('?')[0] === '#/admin/calendar');
      if (
        window.location.hash === '#/admin' ||
        window.location.hash === '#/admin/reader-feedback' ||
        window.location.hash.split('?')[0] === '#/admin/active-etf' ||
        window.location.hash.split('?')[0] === '#/admin/institutional-flows' ||
        window.location.hash.split('?')[0] === '#/admin/calendar'
      ) {
        editorRevisionRef.current += 1;
        setEditorLoadPending(false);
        setShowBookList(true);
        setMobileChooserOpen(false);
      }
    };
    window.addEventListener('hashchange', syncEditorRoute);
    window.addEventListener('popstate', syncEditorRoute);
    return () => {
      window.removeEventListener('hashchange', syncEditorRoute);
      window.removeEventListener('popstate', syncEditorRoute);
    };
  }, []);

  useEffect(() => {
    if (
      !authenticated ||
      !editorRouteArticleId ||
      (draft.id === editorRouteArticleId && !showBookList)
    )
      return;
    const articleId = editorRouteArticleId;
    const generation = adminSessionGenerationRef.current;
    const revision = ++editorRevisionRef.current;
    let active = true;
    setEditorLoadPending(true);
    setNotice(null);
    adminRequest(
      () =>
        api.post(
          `/api/admin/articles/${encodeURIComponent(articleId)}/detail`,
          { sessionToken }
        ),
      generation
    )
      .then(response => {
        if (
          !active ||
          !isCurrentAdminSessionGeneration(generation) ||
          revision !== editorRevisionRef.current
        )
          return;
        const detail = getEntity<Article>(response, 'article');
        const nextDraft = {
          ...detail,
          pages: [...(detail.pages ?? [])].sort(
            (left, right) => left.order - right.order
          ),
        };
        setDraft(nextDraft);
        setSavedFingerprint(draftFingerprint(nextDraft));
        setValidationRequested(false);
        setShowBookList(false);
      })
      .catch(errorValue => {
        if (
          active &&
          isCurrentAdminSessionGeneration(generation) &&
          revision === editorRevisionRef.current &&
          !isUnauthorized(errorValue)
        ) {
          setNotice({
            tone: 'error',
            message: '研究暫時無法載入，請回到研究書目重試。',
          });
          setShowBookList(true);
        }
      })
      .finally(() => {
        if (
          active &&
          isCurrentAdminSessionGeneration(generation) &&
          revision === editorRevisionRef.current
        )
          setEditorLoadPending(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, editorRouteArticleId, sessionToken]);

  const EDITOR_PAGE_SIZE = 3;
  const editorPageCount = Math.max(
    1,
    Math.ceil(draft.pages.length / EDITOR_PAGE_SIZE)
  );
  const activeEditorPage = Math.min(editorPage, editorPageCount - 1);
  const editorPageStart = activeEditorPage * EDITOR_PAGE_SIZE;
  const visibleEditorPages = draft.pages
    .slice(editorPageStart, editorPageStart + EDITOR_PAGE_SIZE)
    .map((page, localIndex) => ({ page, index: editorPageStart + localIndex }));

  useEffect(() => {
    setEditorPage(0);
  }, [draft.id, showBookList]);
  useEffect(() => {
    setEditorPage(current => Math.min(current, editorPageCount - 1));
  }, [editorPageCount]);

  const currentFingerprint = useMemo(() => draftFingerprint(draft), [draft]);
  const isDirty = currentFingerprint !== savedFingerprint;
  const editorLocked = articleIsPublished(draft as Article);
  const newPageCount = draft.pages.filter(page => !page.id).length;
  const metadataReady = Boolean(
    draft.title.trim() &&
    draft.summary.trim() &&
    draft.sector.trim() &&
    isValidDraftPublicationDate(draft.publicationDate)
  );
  const hasSelectedCover = draft.pages.some(
    (page, index) => pageIdentity(page, index) === draft.coverPageId
  );
  const visibleAdminArticles =
    adminDestination === 'published'
      ? adminArticles.filter(articleIsPublished)
      : adminDestination === 'drafts'
        ? adminArticles.filter(article => !articleIsPublished(article))
        : adminDestination === 'comments'
          ? []
          : adminArticles;
  const pagesReady =
    draft.pages.length > 0 &&
    hasSelectedCover &&
    draft.pages.every(page => page.title.trim() && page.altText.trim());
  const uploadPending = uploadRecoveryState?.state === 'pending';
  const editorLifecyclePending = lifecycleMutation?.state === 'pending';
  const editorBusy = editorLoadPending || editorSavePending;
  const publishReady = Boolean(
    draft.id &&
    metadataReady &&
    pagesReady &&
    !isDirty &&
    !editorBusy &&
    !uploadRecoveryState
  );
  const editorInteractionLocked =
    editorLocked ||
    editorLoadPending ||
    uploadPending ||
    editorLifecyclePending;
  const metadataIssues = [
    !draft.title.trim() && '請填寫書名。',
    !draft.summary.trim() && '請填寫簡介。',
    !draft.sector.trim() && '請填寫產業類別。',
    !draft.publicationDate && '請選擇發布日期。',
    draft.publicationDate &&
      !isValidDraftPublicationDate(draft.publicationDate) &&
      '請選擇有效的發布日期。',
  ].filter(Boolean) as string[];
  const pageIssues = [
    draft.pages.length === 0 && '請加入至少一頁圖片。',
    draft.pages.length > 0 && !hasSelectedCover && '請選擇封面。',
    draft.pages.some(page => !page.title.trim() || !page.altText.trim()) &&
      '請填寫每頁的標題與圖片說明。',
  ].filter(Boolean) as string[];

  useEffect(() => {
    lifecycleMutationRef.current = lifecycleMutation;
  }, [lifecycleMutation]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function beginAdminSessionGeneration() {
    adminSessionGenerationRef.current += 1;
    return adminSessionGenerationRef.current;
  }

  function isCurrentAdminSessionGeneration(generation: number) {
    return adminSessionGenerationRef.current === generation;
  }

  function clearAdminPrivateState() {
    const emptyDraft = createEmptyDraft();
    beginAdminSessionGeneration();
    removeStoredAdminSession();
    setSessionRestoreStatus('idle');
    setAuthenticated(false);
    setSessionToken('');
    setExpiresAt('');
    setAdminSessionWarning(false);
    setLogoutStatus('idle');
    setAdminArticles([]);
    setAdminListStatus('idle');
    setAdminSearch('');
    setAdminStatusFilter('all');
    setAdminDestination('all');
    setMobileChooserOpen(false);
    setSecret('');
    setBusy(false);
    setEditorLoadPending(false);
    setEditorSavePending(false);
    editorSavePendingRef.current = false;
    editorRevisionRef.current += 1;
    setAdminActionFeedback(null);
    setConfirmation(null);
    setPageRemovalConfirmation(null);
    setPagePositionMessage('');
    setLifecycleMutation(null);
    setDeleteConfirmationText('');
    setUploadRecoveryState(null);
    setFileActivity('');
    setValidationRequested(false);
    setTagInput('');
    setDraft(emptyDraft);
    setSavedFingerprint(draftFingerprint(emptyDraft));
    setRepublishArticleIds(new Set());
    setPreviewRoute(null);
    setPreviewLoading(false);
    setPreviewState('ready');
    setShowBookList(!isAdminEditorFixture);
    editorFixtureLoadedRef.current = false;
    confirmationTriggerRef.current = null;
  }

  function clearExpiredSession(
    message = '作者登入已失效，請重新輸入作者密鑰。'
  ) {
    const wasPreview = window.location.hash.startsWith('#/preview');
    adminLogoutRetryTokenRef.current = '';
    clearAdminPrivateState();
    setNotice({ tone: 'error', message });
    if (wasPreview) window.location.hash = '/admin';
  }

  async function adminRequest<T>(
    request: () => Promise<T>,
    generation = adminSessionGenerationRef.current
  ): Promise<T> {
    try {
      return await request();
    } catch (errorValue) {
      if (
        isUnauthorized(errorValue) &&
        isCurrentAdminSessionGeneration(generation)
      )
        clearExpiredSession();
      throw errorValue;
    }
  }

  async function refreshAdminCover(articleId: string) {
    const generation = adminSessionGenerationRef.current;
    const response = await adminRequest(
      () =>
        api.post(
          `/api/admin/articles/${encodeURIComponent(articleId)}/detail`,
          { sessionToken }
        ),
      generation
    );
    if (!isCurrentAdminSessionGeneration(generation)) return undefined;
    return coverSource(getEntity<Article>(response, 'article'));
  }

  async function loadAdminArticles(
    activeToken = sessionToken,
    generation = adminSessionGenerationRef.current
  ) {
    if (!isCurrentAdminSessionGeneration(generation)) return false;
    setAdminListStatus('loading');
    try {
      const articles = await loadPagedEntities<Article>(
        'articles',
        nextToken =>
          adminRequest(
            () =>
              api.post('/api/admin/articles/list', {
                sessionToken: activeToken,
                nextToken,
              }),
            generation
          ),
        article => article.id,
        () => isCurrentAdminSessionGeneration(generation)
      );
      if (!isCurrentAdminSessionGeneration(generation)) return false;
      setAdminArticles(
        articles
          .sort(
            (left, right) =>
              right.publicationDate.localeCompare(left.publicationDate) ||
              left.id.localeCompare(right.id)
          )
          .map(normalizeAdminArticlePages)
      );
      setAdminListStatus('ready');
      return true;
    } catch (errorValue) {
      if (!isCurrentAdminSessionGeneration(generation)) return false;
      setAdminArticles([]);
      setAdminListStatus('error');
      throw errorValue;
    }
  }

  useEffect(() => {
    if (
      adminUnlockScenario === 'expired' ||
      adminUnlockScenario === 'cleared'
    ) {
      const wasPreview = window.location.hash.startsWith('#/preview');
      clearAdminPrivateState();
      setNotice(initialAdminUnlockNotice(adminUnlockScenario));
      if (wasPreview) window.location.hash = '/admin';
      return;
    }
    const storedSession = readStoredAdminSession();
    if (!storedSession) {
      setSessionRestoreStatus('idle');
      if (window.location.hash.startsWith('#/preview'))
        window.location.hash = '/admin';
      return;
    }
    const generation = beginAdminSessionGeneration();
    let active = true;
    setSessionRestoreStatus('checking');
    api
      .post('/api/admin/session/validate', {
        sessionToken: storedSession.sessionToken,
      })
      .then(response => {
        if (!active || !isCurrentAdminSessionGeneration(generation)) return;
        const validation = getPayload<{
          authenticated: boolean;
          expiresAt?: string | number;
        }>(response);
        if (!validation.authenticated) {
          clearExpiredSession();
          return;
        }
        const validatedExpiry = validation.expiresAt ?? storedSession.expiresAt;
        setSessionToken(storedSession.sessionToken);
        setExpiresAt(validatedExpiry);
        storeAdminSession(storedSession.sessionToken, validatedExpiry);
        setAuthenticated(true);
        setSessionRestoreStatus('idle');
        void loadAdminArticles(storedSession.sessionToken, generation).catch(
          () => undefined
        );
      })
      .catch(errorValue => {
        if (!active || !isCurrentAdminSessionGeneration(generation)) return;
        if (isUnauthorized(errorValue)) clearExpiredSession();
        else setSessionRestoreStatus('error');
      });
    return () => {
      active = false;
    };
  }, [adminUnlockScenario, sessionRestoreAttempt]);

  useEffect(() => {
    const syncPreviewRoute = () => {
      const nextPreviewRoute = parsePrivatePreviewRoute();
      if (window.location.hash.startsWith('#/preview') && !nextPreviewRoute) {
        setPreviewRoute(null);
        setPreviewLoading(false);
        setPreviewState('ready');
        window.location.hash = '/admin';
        return;
      }
      setPreviewRoute(nextPreviewRoute);
      if (nextPreviewRoute?.kind === 'saved') {
        // Never show a previous draft while a different saved route is loading.
        setDraft(createEmptyDraft());
        setSavedFingerprint('');
      }
      setPreviewLoading(nextPreviewRoute?.kind === 'saved');
      setPreviewState('ready');
    };
    syncPreviewRoute();
    window.addEventListener('hashchange', syncPreviewRoute);
    return () => window.removeEventListener('hashchange', syncPreviewRoute);
  }, []);

  useEffect(() => {
    if (!authenticated || previewRoute?.kind !== 'saved') return;
    const articleId = previewRoute.articleId;
    const generation = adminSessionGenerationRef.current;
    let active = true;
    setPreviewLoading(true);
    setPreviewState('ready');
    adminRequest(
      () =>
        api.post(
          `/api/admin/articles/${encodeURIComponent(articleId)}/detail`,
          { sessionToken }
        ),
      generation
    )
      .then(response => {
        if (!active || !isCurrentAdminSessionGeneration(generation)) return;
        const detail = getEntity<Article>(response, 'article');
        const nextDraft = {
          ...detail,
          pages: [...(detail.pages ?? [])].sort(
            (left, right) => left.order - right.order
          ),
        };
        setDraft(nextDraft);
        setSavedFingerprint(draftFingerprint(nextDraft));
      })
      .catch((errorValue: unknown) => {
        if (!active || !isCurrentAdminSessionGeneration(generation)) return;
        if (getErrorStatus(errorValue) === 404) {
          setPreviewState('unavailable');
        } else if (!isUnauthorized(errorValue)) {
          setNotice({
            tone: 'error',
            message: '預覽暫時無法載入，請稍後再試。',
          });
          window.location.hash = '/admin';
        }
      })
      .finally(() => {
        if (active && isCurrentAdminSessionGeneration(generation))
          setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, previewRoute, sessionToken]);

  useEffect(() => {
    if (
      !authenticated ||
      !editorFixtureArticleId ||
      editorFixtureLoadedRef.current
    )
      return;
    const generation = adminSessionGenerationRef.current;
    editorFixtureLoadedRef.current = true;
    setBusy(true);
    setEditorLoadPending(true);
    setNotice(null);
    adminRequest(
      () =>
        api.post(`/api/admin/articles/${editorFixtureArticleId}/detail`, {
          sessionToken,
        }),
      generation
    )
      .then(response => {
        if (!isCurrentAdminSessionGeneration(generation)) return;
        const detail = getEntity<Article>(response, 'article');
        const nextDraft = {
          ...detail,
          pages: [...(detail.pages ?? [])].sort(
            (left, right) => left.order - right.order
          ),
        };
        setDraft(nextDraft);
        setSavedFingerprint(draftFingerprint(nextDraft));
        setShowBookList(false);
      })
      .catch(errorValue => {
        if (
          isCurrentAdminSessionGeneration(generation) &&
          !isUnauthorized(errorValue)
        )
          setNotice({
            tone: 'error',
            message: '草稿暫時無法載入，請回到研究書目重試。',
          });
      })
      .finally(() => {
        if (isCurrentAdminSessionGeneration(generation)) {
          setBusy(false);
          setEditorLoadPending(false);
        }
      });
  }, [authenticated, editorFixtureArticleId, sessionToken]);

  useEffect(() => {
    if (!authenticated && sessionRestoreStatus === 'idle')
      secretInputRef.current?.focus();
  }, [authenticated, sessionRestoreStatus]);

  useEffect(() => {
    if (authenticated || adminUnlockScenario !== 'checking') return;
    const timeout = window.setTimeout(() => setBusy(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [adminUnlockScenario, authenticated]);

  useEffect(() => {
    if (!authenticated && notice?.tone === 'error')
      unlockNoticeRef.current?.focus();
  }, [authenticated, notice]);

  useEffect(() => {
    if (logoutStatus === 'error') adminSessionNoticeRef.current?.focus();
  }, [logoutStatus]);

  useEffect(() => {
    onDirtyChange(authenticated && (isDirty || etfDirty));
    return () => onDirtyChange(false);
  }, [authenticated, isDirty, etfDirty, onDirtyChange]);

  useEffect(() => {
    if (!authenticated || !isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [authenticated, isDirty]);

  useEffect(() => {
    if (!authenticated || !expiresAt) return;
    const expiryTime =
      typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
    const remaining = expiryTime - Date.now();
    if (remaining <= 0) {
      clearExpiredSession();
      return;
    }
    setAdminSessionWarning(remaining <= ADMIN_SESSION_WARNING_MS);
    const warningTimer =
      remaining > ADMIN_SESSION_WARNING_MS
        ? window.setTimeout(
            () => setAdminSessionWarning(true),
            remaining - ADMIN_SESSION_WARNING_MS
          )
        : undefined;
    const expiryTimer = window.setTimeout(
      () => clearExpiredSession(),
      remaining
    );
    return () => {
      if (warningTimer) window.clearTimeout(warningTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [authenticated, expiresAt]);

  useEffect(() => {
    if (!confirmation) return;
    const dialog = confirmationDialogRef.current;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert ?? false;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const initialFocusable = focusable();
    (initialFocusable[0] ?? dialog)?.focus();
    if (appRoot) appRoot.inert = true;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (lifecycleMutationRef.current?.state !== 'pending')
          setConfirmation(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (!dialog?.contains(event.target as Node))
        (focusable()[0] ?? dialog)?.focus();
    };
    window.addEventListener('keydown', handleDialogKeys);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      document.removeEventListener('focusin', keepFocusInside);
      if (appRoot) appRoot.inert = wasInert;
      const trigger = confirmationTriggerRef.current;
      confirmationTriggerRef.current = null;
      if (trigger && document.contains(trigger)) trigger.focus();
      else adminListHeadingRef.current?.focus();
    };
  }, [confirmation]);

  useEffect(() => {
    if (!pageRemovalConfirmation) return;
    const dialog = pageRemovalDialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []
      );
    focusable()[0]?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPageRemovalConfirmation(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      const trigger = pageRemovalTriggerRef.current;
      pageRemovalTriggerRef.current = null;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [pageRemovalConfirmation]);

  function openConfirmation(
    action: AdminLifecycleAction,
    article: Article | AdminDraft = draft,
    source: 'editor' | 'list' = 'editor'
  ) {
    if (!article.id) {
      setNotice({ tone: 'error', message: '請先儲存草稿，再變更發布狀態。' });
      return;
    }
    confirmationTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDeleteConfirmationText('');
    setLifecycleMutation(null);
    setConfirmation({
      action,
      articleId: article.id,
      articleTitle: article.title || '未命名研究',
      source,
    });
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!secret || logoutStatus !== 'idle') {
      if (!secret)
        setNotice({ tone: 'error', message: '作者密鑰不正確，請重新輸入。' });
      return;
    }
    const generation = beginAdminSessionGeneration();
    setLogoutStatus('idle');
    setAdminSessionWarning(false);
    setBusy(true);
    setNotice(null);
    try {
      const loginResponse = await api.post('/api/admin/session', { secret });
      if (!isCurrentAdminSessionGeneration(generation)) return;
      const loginSession = getPayload<{
        authenticated: boolean;
        expiresAt?: string | number;
        sessionToken?: string;
      }>(loginResponse);
      if (!loginSession.authenticated || !loginSession.sessionToken)
        throw new Error('Session token missing.');
      setSessionToken(loginSession.sessionToken);
      const nextExpiry = loginSession.expiresAt ?? '';
      setExpiresAt(nextExpiry);
      storeAdminSession(loginSession.sessionToken, nextExpiry);
      setSecret('');
      setAuthenticated(true);
      try {
        const loaded = await loadAdminArticles(
          loginSession.sessionToken,
          generation
        );
        if (!isCurrentAdminSessionGeneration(generation)) return;
        setNotice(
          loaded
            ? null
            : {
                tone: 'error',
                message: '已登入作者工作區，但書目暫時無法載入，請重試。',
              }
        );
      } catch (errorValue) {
        if (
          !isCurrentAdminSessionGeneration(generation) ||
          isUnauthorized(errorValue)
        )
          throw errorValue;
        setNotice({
          tone: 'error',
          message: '已登入作者工作區，但書目暫時無法載入，請重試。',
        });
      }
    } catch (errorValue) {
      if (!isCurrentAdminSessionGeneration(generation)) return;
      const status = getErrorStatus(errorValue);
      setSecret('');
      setSessionToken('');
      removeStoredAdminSession();
      setExpiresAt('');
      setAuthenticated(false);
      const message =
        status === 401
          ? '作者密鑰不正確，請重新輸入。'
          : status === 429
            ? '嘗試次數過多，請稍後再試。'
            : status === 403
              ? '登入未能完成，請重新開啟作者登入頁後再試。'
              : status === 503
                ? '作者登入暫時無法使用，請稍後再試。'
                : '登入失敗，請確認作者密鑰，或稍後再試。';
      setNotice({ tone: 'error', message });
    } finally {
      if (isCurrentAdminSessionGeneration(generation)) {
        setBusy(false);
      }
    }
  }

  async function logout() {
    if (logoutStatus === 'pending') return;
    if ((isDirty || etfDirty) && !await confirmDiscard('登出後，尚未儲存的變更將會遺失。')) return;
    const token = adminLogoutRetryTokenRef.current || sessionToken;
    adminLogoutRetryTokenRef.current = token;
    clearAdminPrivateState();
    setLogoutStatus('pending');
    setNotice(null);
    try {
      await api.delete(
        '/api/admin/session',
        token ? { sessionToken: token } : {}
      );
      adminLogoutRetryTokenRef.current = '';
      setNotice({ tone: 'success', message: '已登出作者工作區。' });
    } catch (errorValue) {
      if (isUnauthorized(errorValue)) {
        adminLogoutRetryTokenRef.current = '';
        setNotice({ tone: 'success', message: '已登出作者工作區。' });
        return;
      }
      setLogoutStatus('error');
      setNotice(null);
    } finally {
      if (!adminLogoutRetryTokenRef.current) setLogoutStatus('idle');
    }
  }

  function renderAdminSessionStatus() {
    return (
      <>
        {adminSessionWarning && (
          <div
            className="admin-session-status admin-session-warning"
            role="alert"
            aria-live="polite"
          >
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>作者登入即將到期</strong>
              <span>作者登入將在 15 分鐘內到期，請先儲存變更。</span>
            </div>
          </div>
        )}
        {logoutStatus === 'pending' && (
          <div
            className="admin-session-status admin-session-pending"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <LogOut size={18} aria-hidden="true" />
            <div>
              <strong><PendingIndicator>登出中…</PendingIndicator></strong>
              <span>正在登出作者工作區，請稍候。</span>
            </div>
          </div>
        )}
        {logoutStatus === 'error' && (
          <div
            ref={adminSessionNoticeRef}
            className="admin-session-status admin-session-error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>登出尚未完成</strong>
              <span>請再試一次以完成登出。</span>
            </div>
            <button type="button" onClick={() => void logout()}>
              重試登出
            </button>
          </div>
        )}
      </>
    );
  }

  async function editArticle(article: Article) {
    if (editorLoadPending || uploadPending || editorLifecyclePending) return;
    if (isDirty && !await confirmDiscard('開啟其他研究後，目前尚未儲存的變更將會遺失。'))
      return;
    setBusy(true);
    setEditorLoadPending(true);
    editorRevisionRef.current += 1;
    const generation = adminSessionGenerationRef.current;
    setNotice(null);
    try {
      const response = await adminRequest(
        () =>
          api.post(`/api/admin/articles/${article.id}/detail`, {
            sessionToken,
          }),
        generation
      );
      if (!isCurrentAdminSessionGeneration(generation)) return;
      const detail = getEntity<Article>(response, 'article');
      const nextDraft = {
        ...detail,
        pages: [...(detail.pages ?? [])].sort((a, b) => a.order - b.order),
      };
      setDraft(nextDraft);
      setSavedFingerprint(draftFingerprint(nextDraft));
      setValidationRequested(false);
      setShowBookList(false);
      setMobileChooserOpen(false);
      window.location.hash = `/admin/article/${encodeURIComponent(article.id)}`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (errorValue) {
      if (
        isCurrentAdminSessionGeneration(generation) &&
        !isUnauthorized(errorValue)
      )
        setNotice({ tone: 'error', message: '草稿暫時無法載入，請稍後再試。' });
    } finally {
      if (isCurrentAdminSessionGeneration(generation)) {
        setBusy(false);
        setEditorLoadPending(false);
      }
    }
  }

  function clearAdminFilters() {
    setAdminSearch('');
    setAdminStatusFilter('all');
  }

  async function refreshAdminList() {
    setAdminActionFeedback(null);
    setNotice(null);
    try {
      await loadAdminArticles();
    } catch (errorValue) {
      if (!isUnauthorized(errorValue))
        setNotice({
          tone: 'error',
          message: '書目暫時無法載入，搜尋與篩選條件已保留。',
        });
    }
  }

  function requestLifecycleAction(article: Article) {
    if (adminActionFeedback?.state === 'pending') return;
    openConfirmation(
      articleIsPublished(article) ? 'unpublish' : 'publish',
      article,
      'list'
    );
  }

  async function startNewDraft() {
    if (editorLoadPending || uploadPending || editorLifecyclePending) return;
    if (isDirty && !await confirmDiscard('建立其他研究書後，目前尚未儲存的變更將會遺失。')) return;
    editorRevisionRef.current += 1;
    const nextDraft = createEmptyDraft();
    setDraft(nextDraft);
    setSavedFingerprint(draftFingerprint(nextDraft));
    setValidationRequested(false);
    setNotice(null);
    setFileActivity('');
    setShowBookList(false);
    setMobileChooserOpen(false);
  }

  async function returnToBookList() {
    if (editorLoadPending || uploadPending || editorLifecyclePending) return;
    if (isDirty && !await confirmDiscard('返回研究書目後，尚未儲存的變更將會遺失。'))
      return;
    editorRevisionRef.current += 1;
    setNotice(null);
    setShowBookList(true);
    setMobileChooserOpen(false);
    if (window.location.hash !== '#/admin') window.location.hash = '/admin';
  }

  function addTag() {
    if (editorInteractionLocked) return;
    const nextTag = tagInput.trim();
    if (nextTag && !draft.tags.includes(nextTag))
      setDraft({ ...draft, tags: [...draft.tags, nextTag] });
    setTagInput('');
  }

  function focusFirstInvalidMetadata() {
    window.setTimeout(() => {
      if (!draft.title.trim()) {
        metadataTitleInputRef.current?.focus();
      } else if (!draft.sector.trim()) {
        metadataSectorInputRef.current?.focus();
      } else if (!isValidDraftPublicationDate(draft.publicationDate)) {
        metadataDateInputRef.current?.focus();
      } else if (!draft.summary.trim()) {
        metadataSummaryInputRef.current?.focus();
      }
    }, 0);
  }

  function updateUploadFile(
    id: string,
    state: UploadFileState['state'],
    detail: string
  ) {
    setUploadRecoveryState(current =>
      current
        ? {
            ...current,
            files: current.files.map(file =>
              file.id === id ? { ...file, state, detail } : file
            ),
          }
        : current
    );
  }

  async function prepareImagePage(
    file: File,
    index: number
  ): Promise<ArticlePage> {
    const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!supportedTypes.has(file.type))
      throw new Error('請選擇 JPG、PNG 或 WebP 圖片。');
    if (file.size > 7_500_000) throw new Error('每張圖片須小於 7.5 MB。');
    const imageUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (adminLocalScenario === 'admin-editor-upload-pending') {
      await new Promise<void>(resolve => window.setTimeout(resolve, 12_000));
    }
    if (adminLocalScenario === 'admin-editor-upload-error')
      throw new Error('圖片未能處理，請重新選擇。');
    if (adminLocalScenario === 'admin-editor-upload-partial' && index > 0)
      throw new Error('圖片未能處理，請重新選擇。');
    return {
      clientKey: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, ''),
      imageUrl,
      altText: '',
      order: 0,
    };
  }

  async function addImages(files: File[]) {
    if (
      editorInteractionLocked ||
      uploadBatchActiveRef.current ||
      files.length === 0
    )
      return;
    const availableSlots = 80 - draft.pages.length;
    if (availableSlots <= 0) {
      setNotice({
        tone: 'error',
        message: '每本研究最多 80 頁，請先移除一頁再加入。',
      });
      return;
    }
    const acceptedFiles = files.slice(0, availableSlots);
    uploadBatchActiveRef.current = true;
    setNotice(null);
    setFileActivity(`正在處理 ${acceptedFiles.length} 張圖片…`);
    setUploadRecoveryState({
      state: 'pending',
      files: acceptedFiles.map((file, index) => ({
        id: `${index}-${file.name}`,
        name: file.name,
        state: 'preparing',
        detail: '處理中',
      })),
    });
    try {
      const results = await Promise.all(
        acceptedFiles.map(async (file, index) => {
          const id = `${index}-${file.name}`;
          try {
            const page = await prepareImagePage(file, index);
            updateUploadFile(id, 'uploaded', '可儲存');
            return { id, file, page, error: null };
          } catch (errorValue) {
            const detail =
              errorValue instanceof Error
                ? errorValue.message
                : '圖片未能處理，請重新選擇。';
            updateUploadFile(id, 'failed', detail);
            return { id, file, page: null, error: detail };
          }
        })
      );
      const preparedPages = results.flatMap(result =>
        result.page ? [result.page] : []
      );
      const failedFiles = results.filter(result => result.error);
      setDraft(current => {
        const pagesToAppend = preparedPages.slice(
          0,
          Math.max(0, 80 - current.pages.length)
        );
        return {
          ...current,
          coverPageId:
            current.coverPageId ?? pagesToAppend[0]?.clientKey ?? null,
          pages: [
            ...current.pages,
            ...pagesToAppend.map((page, offset) => ({
              ...page,
              order: current.pages.length + offset,
            })),
          ],
        };
      });
      if (failedFiles.length === 0) {
        setUploadRecoveryState(null);
        setFileActivity(
          `${preparedPages.length} 張圖片已加入草稿，儲存時將上傳。`
        );
      } else {
        setUploadRecoveryState({
          state: preparedPages.length ? 'partial' : 'error',
          files: results.map(result => ({
            id: result.id,
            name: result.file.name,
            state: result.error ? 'failed' : 'uploaded',
            detail: result.error ?? '可儲存',
          })),
        });
        setFileActivity(
          preparedPages.length
            ? '已處理的圖片仍保留在草稿中。'
            : '尚未加入任何圖片。'
        );
      }
      if (files.length > acceptedFiles.length) {
        setNotice({
          tone: 'error',
          message: `還可加入 ${availableSlots} 頁圖片，每本研究最多 80 頁。`,
        });
      }
    } finally {
      uploadBatchActiveRef.current = false;
    }
  }

  function movePage(index: number, direction: -1 | 1) {
    if (editorInteractionLocked) return;
    const target = index + direction;
    if (target < 0 || target >= draft.pages.length) return;
    const pages = [...draft.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    setDraft({
      ...draft,
      pages: pages.map((page, order) => ({ ...page, order })),
    });
    setEditorPage(Math.floor(target / EDITOR_PAGE_SIZE));
    setPagePositionMessage(
      `${draft.pages[index].title || `第 ${index + 1} 頁`} 已移至第 ${target + 1} 頁，共 ${draft.pages.length} 頁。`
    );
  }

  function selectCover(page: ArticlePage, index: number) {
    if (editorInteractionLocked) return;
    setDraft({ ...draft, coverPageId: pageIdentity(page, index) });
    setPagePositionMessage(
      `${page.title || `第 ${index + 1} 頁`} 已設為封面。`
    );
  }

  function requestRemovePage(index: number) {
    if (editorInteractionLocked || !draft.pages[index]) return;
    pageRemovalTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPageRemovalConfirmation({
      index,
      pageTitle: draft.pages[index].title || `第 ${index + 1} 頁`,
    });
  }

  function removePage(index: number) {
    if (editorInteractionLocked) return;
    const removedIdentity = pageIdentity(draft.pages[index], index);
    const pages = draft.pages
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, order) => ({ ...item, order }));
    const coverPageId =
      draft.coverPageId === removedIdentity
        ? pages[0]
          ? pageIdentity(pages[0], 0)
          : null
        : draft.coverPageId;
    setDraft({ ...draft, pages, coverPageId });
    setPagePositionMessage(
      coverPageId
        ? `${draft.pages[index].title || `第 ${index + 1} 頁`} 已移除。 ${pages.find((page, itemIndex) => pageIdentity(page, itemIndex) === coverPageId)?.title || '第一個剩餘頁面'} 已設為封面。`
        : `${draft.pages[index].title || `第 ${index + 1} 頁`} 已移除。 目前沒有剩餘頁面。`
    );
  }

  function confirmRemovePage() {
    const index = pageRemovalConfirmation?.index;
    setPageRemovalConfirmation(null);
    if (typeof index === 'number') removePage(index);
  }

  function retryUploadRecovery() {
    if (
      uploadRecoveryState?.state !== 'error' &&
      uploadRecoveryState?.state !== 'partial'
    )
      return;
    setUploadRecoveryState(null);
    setNotice(null);
    uploadInputRef.current?.click();
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (editorSavePendingRef.current) return;
    if (articleIsPublished(draft as Article)) {
      setNotice({ tone: 'error', message: '請先下架研究，再進行編輯。' });
      return;
    }
    if (
      !draft.title.trim() ||
      !draft.summary.trim() ||
      !draft.sector.trim() ||
      !isValidDraftPublicationDate(draft.publicationDate)
    ) {
      setValidationRequested(true);
      setNotice({
        tone: 'error',
        message: '請填寫書名、簡介、產業類別，並選擇有效的發布日期。',
      });
      focusFirstInvalidMetadata();
      return;
    }
    if (draft.pages.some(page => !page.title.trim() || !page.altText.trim())) {
      setValidationRequested(true);
      setNotice({ tone: 'error', message: '請填寫每頁的標題與圖片說明。' });
      return;
    }
    const saveRevision = editorRevisionRef.current;
    const saveRequestFingerprint = draftFingerprint(draft);
    const sameEditorContext = () => editorRevisionRef.current === saveRevision;
    const applySavedDraft = (detail: Article, successMessage: string) => {
      if (!sameEditorContext()) return false;
      const savedDraft = { ...detail, pages: detail.pages ?? [] };
      const hasNewerEdits =
        draftFingerprint(draftRef.current) !== saveRequestFingerprint;
      setDraft(current => {
        if (draftFingerprint(current) === saveRequestFingerprint)
          return savedDraft;
        return {
          ...current,
          id: savedDraft.id ?? current.id,
          status: savedDraft.status,
          published: savedDraft.published,
          updatedAt: savedDraft.updatedAt,
        };
      });
      setSavedFingerprint(draftFingerprint(savedDraft));
      if (!hasNewerEdits) {
        setValidationRequested(false);
        setUploadRecoveryState(null);
      }
      setNotice({
        tone: 'success',
        message: hasNewerEdits
          ? '草稿已儲存。 Newer changes remain in the editor; save again to persist them.'
          : successMessage,
      });
      setFileActivity(
        hasNewerEdits
          ? '先前的變更已儲存，之後的修改尚未儲存。'
          : '所有變更已儲存。'
      );
      return true;
    };
    editorSavePendingRef.current = true;
    setEditorSavePending(true);
    setBusy(true);
    setNotice(null);
    setFileActivity(
      newPageCount > 0
        ? `正在上傳 ${newPageCount} 張新圖片…`
        : '正在儲存書籍資訊與頁面順序…'
    );
    if (newPageCount > 0) {
      setUploadRecoveryState({
        state: 'pending',
        files: draft.pages
          .filter(page => !page.id)
          .map((page, index) => ({
            id: `${index}-${page.clientKey ?? page.title}`,
            name: page.title || '未命名頁面',
            state: 'preparing',
            detail: '上傳中',
          })),
      });
    }
    let workingArticleId = draft.id ?? '';
    let createdArticle = false;
    let finalized = false;
    let finalPutAttempted = false;
    let expectedFinalPages: SavedPageDescriptor[] = [];
    let expectedFinalCoverPageId: string | null = null;
    const uploadedPageIds: string[] = [];
    let pagePersistenceFailed = false;
    const metadata: ArticleMetadata = {
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      sector: draft.sector.trim(),
      publicationDate: draft.publicationDate,
      tags: [
        ...new Set(
          draft.tags.map(item => item.trim().slice(0, 40)).filter(Boolean)
        ),
      ].slice(0, 12),
    };
    try {
      const selectedCoverOrder = draft.pages.findIndex(
        (page, index) => pageIdentity(page, index) === draft.coverPageId
      );
      if (!workingArticleId) {
        const createResponse = await adminRequest(() =>
          api.post('/api/admin/articles', {
            sessionToken,
            ...metadata,
            pages: [],
            coverPageId: null,
          })
        );
        const created = getEntity<Article>(createResponse, 'article');
        workingArticleId = created.id;
        createdArticle = true;
        if (!workingArticleId)
          throw new Error('Created article is missing an id.');
      }
      const finalPages: Array<SavedPageDescriptor | null> = draft.pages.map(
        (page, order) =>
          page.id && page.storagePath
            ? {
                id: page.id,
                title: page.title.trim().slice(0, 120),
                altText: page.altText.trim().slice(0, 500),
                storagePath: page.storagePath,
                order,
              }
            : null
      );
      for (const [order, page] of draft.pages.entries()) {
        if (page.id) continue;
        const match = page.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('New page image is not encoded.');
        let uploadResponse;
        try {
          uploadResponse = await adminRequest(() =>
            api.post(`/api/admin/articles/${workingArticleId}/pages`, {
              sessionToken,
              content: match[2],
              contentType: match[1],
              title: page.title,
              altText: page.altText,
              order,
            })
          );
        } catch (errorValue) {
          pagePersistenceFailed = true;
          throw errorValue;
        }
        const uploaded = getEntity<ArticlePage>(uploadResponse, 'page');
        if (!uploaded.id || !uploaded.storagePath)
          throw new Error('Uploaded page descriptor is incomplete.');
        uploadedPageIds.push(uploaded.id);
        finalPages[order] = {
          id: uploaded.id,
          title: uploaded.title,
          altText: uploaded.altText,
          storagePath: uploaded.storagePath,
          order,
        };
      }
      if (finalPages.some(page => page === null))
        throw new Error('Page order could not be reconciled.');
      const finalCoverPageId =
        selectedCoverOrder >= 0
          ? (finalPages[selectedCoverOrder]?.id ?? null)
          : null;
      if (!finalCoverPageId && finalPages.length > 0)
        throw new Error('Cover page could not be reconciled.');
      expectedFinalPages = finalPages as SavedPageDescriptor[];
      expectedFinalCoverPageId = finalCoverPageId;
      finalPutAttempted = true;
      const finalResponse = await adminRequest(() =>
        api.put(`/api/admin/articles/${workingArticleId}`, {
          sessionToken,
          ...metadata,
          pages: expectedFinalPages,
          coverPageId: finalCoverPageId,
          ...(draft.id && newPageCount === 0 && draft.updatedAt
            ? { baseUpdatedAt: draft.updatedAt }
            : {}),
        })
      );
      finalized = true;
      const detail = getEntity<Article>(finalResponse, 'article');
      applySavedDraft(detail, '草稿已儲存。');
      try {
        await loadAdminArticles();
        await onDataChanged();
      } catch (refreshError) {
        if (sameEditorContext() && !isUnauthorized(refreshError)) {
          setNotice({
            tone: 'success',
            message: '草稿已儲存。重新開啟研究書目後會顯示最新內容。',
          });
        }
      }
    } catch (errorValue) {
      let reconciliation: 'not-committed' | 'unknown' = finalPutAttempted
        ? 'unknown'
        : 'not-committed';
      let reconciledToServer = false;
      if (!finalized && finalPutAttempted && workingArticleId) {
        try {
          const reconciliationResponse = await adminRequest(() =>
            api.post(`/api/admin/articles/${workingArticleId}/detail`, {
              sessionToken,
            })
          );
          const serverDetail = getEntity<Article>(
            reconciliationResponse,
            'article'
          );
          if (
            matchesIntendedSave(
              serverDetail,
              metadata,
              expectedFinalPages,
              expectedFinalCoverPageId
            )
          ) {
            finalized = true;
            applySavedDraft(
              serverDetail,
              '草稿已儲存。連線中斷後已確認儲存成功。'
            );
            try {
              await loadAdminArticles();
              await onDataChanged();
            } catch {
              /* The committed detail is already authoritative. */
            }
            return;
          }
          reconciliation = 'not-committed';
          if (newPageCount === 0 && sameEditorContext()) {
            const authoritativeDraft = {
              ...serverDetail,
              pages: [...(serverDetail.pages ?? [])].sort(
                (left, right) => left.order - right.order
              ),
            };
            setSavedFingerprint(draftFingerprint(authoritativeDraft));
            if (
              matchesIntendedPages(
                serverDetail,
                expectedFinalPages,
                expectedFinalCoverPageId
              )
            ) {
              setDraft(current => ({
                ...current,
                updatedAt: serverDetail.updatedAt,
              }));
              setNotice({
                tone: 'error',
                message: '草稿未能儲存，你的修改已保留，請重試儲存。',
              });
              setFileActivity('儲存失敗，你的修改已保留，請重試。');
            } else {
              setDraft(authoritativeDraft);
              setValidationRequested(false);
              setUploadRecoveryState(null);
              setNotice({
                tone: 'error',
                message:
                  '頁面變更未能套用。目前顯示最新儲存的版本，請確認後再修改。',
              });
              setFileActivity('目前顯示最新儲存的版本。');
            }
            reconciledToServer = true;
          }
        } catch {
          reconciliation = 'unknown';
        }
      }
      if (
        !finalized &&
        workingArticleId &&
        reconciliation === 'not-committed'
      ) {
        if (uploadedPageIds.length > 0) {
          if (sameEditorContext())
            setFileActivity('儲存失敗，正在復原本次上傳…');
          for (const pageId of uploadedPageIds) {
            try {
              await api.delete(
                `/api/admin/articles/${workingArticleId}/pages/${pageId}`,
                { sessionToken }
              );
            } catch {
              /* Best-effort rollback; the original error remains authoritative. */
            }
          }
        }
        if (createdArticle) {
          try {
            await api.delete(`/api/admin/articles/${workingArticleId}`, {
              sessionToken,
              confirmation: 'DELETE',
            });
          } catch {
            /* Best-effort rollback of the empty article shell. */
          }
        }
      }
      if (!sameEditorContext()) return;
      if (pagePersistenceFailed) {
        const localPages = draft.pages.filter(page => !page.id);
        setUploadRecoveryState({
          state: uploadedPageIds.length ? 'partial' : 'error',
          files: localPages.map((page, index) => ({
            id: `${index}-${page.clientKey ?? page.title}`,
            name: page.title || `第 ${index + 1} 頁`,
            state: index < uploadedPageIds.length ? 'uploaded' : 'failed',
            detail:
              index < uploadedPageIds.length
                ? '圖片已保留，重試儲存時將重新上傳。'
                : '圖片未能儲存，請重新選擇或重試儲存。',
          })),
        });
      } else if (newPageCount > 0) {
        setUploadRecoveryState(null);
      }
      if (!finalized && reconciliation === 'unknown') {
        if (!isUnauthorized(errorValue))
          setNotice({
            tone: 'error',
            message:
              '尚無法確認是否已儲存。請重新載入研究後再試，以免重複上傳。',
          });
        setFileActivity('尚無法確認儲存結果，上傳的圖片已保留。');
      } else if (!finalized && !reconciledToServer) {
        if (!isUnauthorized(errorValue))
          setNotice({
            tone: 'error',
            message: '草稿未能儲存，請檢查欄位後再試。',
          });
        setFileActivity('儲存失敗，你的草稿已保留，請重試。');
      }
    } finally {
      editorSavePendingRef.current = false;
      setEditorSavePending(false);
      setBusy(false);
    }
  }

  async function reconcileDeletedArticleInventories() {
    let reconciled = true;
    try {
      await loadAdminArticles();
    } catch (errorValue) {
      if (isUnauthorized(errorValue)) throw errorValue;
      reconciled = false;
    }
    try {
      await onDataChanged();
    } catch {
      reconciled = false;
    }
    return reconciled;
  }

  async function runLifecycleMutation() {
    if (!confirmation || lifecycleMutation?.state === 'pending') return;
    const { action, articleId, articleTitle, source } = confirmation;
    if (action === 'delete' && deleteConfirmationText !== 'DELETE') return;
    const editorAction = source === 'editor';
    const publish = action === 'publish';
    if (editorAction && action === 'unpublish' && isDirty) {
      setNotice({
        tone: 'error',
        message: '請先儲存或放棄尚未儲存的變更，再下架研究。',
      });
      return;
    }
    if (editorAction && publish && !publishReady) {
      setNotice({
        tone: 'error',
        message: '請完成發布條件，並先儲存所有變更。',
      });
      return;
    }

    setLifecycleMutation({ action, articleId, state: 'pending' });
    if (editorAction) setBusy(true);
    setNotice(null);
    const generation = adminSessionGenerationRef.current;
    try {
      const response =
        action === 'delete'
          ? await adminRequest(
              () =>
                api.post(
                  `/api/admin/articles/${encodeURIComponent(articleId)}/delete`,
                  { sessionToken, confirmation: 'DELETE' }
                ),
              generation
            )
          : await adminRequest(
              () =>
                api.post(
                  `/api/admin/articles/${encodeURIComponent(articleId)}/${action}`,
                  { sessionToken }
                ),
              generation
            );
      if (!isCurrentAdminSessionGeneration(generation)) return;
      const payload = getPayload<{
        article?: Article;
        deleted?: boolean;
        cleanupPending?: boolean;
      }>(response);

      if (action === 'delete') {
        if (payload.deleted !== true)
          throw new Error('Deletion was not confirmed by the server.');
        const inventoriesReconciled =
          await reconcileDeletedArticleInventories();
        if (!isCurrentAdminSessionGeneration(generation)) return;
        if (payload.cleanupPending) {
          setLifecycleMutation({
            action,
            articleId,
            state: 'partial',
            message: inventoriesReconciled
              ? `「${articleTitle}」已隱藏，刪除尚未完成，請重試。`
              : `“${articleTitle}” was removed, but this view could not refresh. Bounded cleanup is still pending; retry to finish it.`,
          });
          return;
        }
        setNotice({
          tone: 'success',
          message: inventoriesReconciled
            ? `「${articleTitle}」已永久刪除。`
            : `「${articleTitle}」已永久刪除，請重新整理研究書目。`,
        });
        setLifecycleMutation(null);
        setConfirmation(null);
        return;
      }

      const updated =
        payload.article ?? getEntity<Article>(response, 'article');
      if (editorAction) {
        const hydratedPages =
          updated.pages?.length > 0 &&
          updated.pages.every(page => Boolean(page.imageUrl))
            ? updated.pages
            : draft.pages;
        const nextDraft = {
          ...draft,
          ...updated,
          pages: hydratedPages,
          status: publish ? ('published' as const) : ('draft' as const),
          published: publish,
        };
        setDraft(nextDraft);
        setSavedFingerprint(draftFingerprint(nextDraft));
      }
      if (!publish)
        setRepublishArticleIds(current => new Set(current).add(articleId));
      await loadAdminArticles();
      await onDataChanged();
      if (!isCurrentAdminSessionGeneration(generation)) return;
      setNotice({
        tone: 'success',
        message: publish
          ? republishArticleIds.has(articleId)
            ? '研究已重新發布，先前移除的收藏不會復原。'
            : '研究已發布。'
          : '研究已下架。公開留言與評論已保留，讀者收藏已永久移除，重新發布也不會復原。先前開啟的圖片可能短暫仍可檢視。',
      });
      setLifecycleMutation(null);
      setConfirmation(null);
    } catch (errorValue) {
      if (
        !isCurrentAdminSessionGeneration(generation) ||
        isUnauthorized(errorValue)
      )
        return;
      const errorPayload = getErrorPayload<{
        cleanupPending?: boolean;
        error?: string;
        message?: string;
        readiness?: { issues?: unknown };
      }>(errorValue);
      const readinessIssues = Array.isArray(errorPayload?.readiness?.issues)
        ? errorPayload.readiness.issues.filter(
            (issue): issue is string =>
              typeof issue === 'string' && Boolean(issue.trim())
          )
        : [];
      if (
        action === 'publish' &&
        getErrorStatus(errorValue) === 400 &&
        readinessIssues.length > 0
      ) {
        if (editorAction) setValidationRequested(true);
        setLifecycleMutation({
          action,
          articleId,
          state: 'validation',
          message:
            errorPayload?.error ??
            errorPayload?.message ??
            '請完成發布條件後再試。',
          issues: readinessIssues,
        });
        return;
      }
      if (action === 'delete' && errorPayload?.cleanupPending) {
        setLifecycleMutation({
          action,
          articleId,
          state: 'partial',
          message: `「${articleTitle}」已隱藏，刪除尚未完成，請重試。`,
        });
      } else {
        setLifecycleMutation({
          action,
          articleId,
          state: 'failed',
          message:
            action === 'delete'
              ? `尚無法確認「${articleTitle}」的刪除結果，請重新整理後確認。`
              : `尚無法確認「${articleTitle}」的發布狀態，請重新整理後確認。`,
        });
      }
    } finally {
      if (editorAction && isCurrentAdminSessionGeneration(generation))
        setBusy(false);
    }
  }

  async function setPublication(publish: boolean) {
    if (
      !confirmation ||
      confirmation.action !== (publish ? 'publish' : 'unpublish')
    )
      return;
    await runLifecycleMutation();
  }

  function renderConfirmationDialog() {
    if (!confirmation) return null;
    const book =
      confirmation.source === 'editor'
        ? draft
        : adminArticles.find(article => article.id === confirmation.articleId);
    const pending = lifecycleMutation?.state === 'pending';
    return createPortal(
      <div
        className="confirmation-backdrop admin-view admin-book-list-view"
        role="presentation"
        onMouseDown={event => {
          if (
            event.currentTarget === event.target &&
            lifecycleMutation?.state !== 'pending'
          )
            setConfirmation(null);
        }}
      >
        <div
          ref={confirmationDialogRef}
          className={`confirmation-dialog publication-dialog is-${confirmation.action}`}
          role="dialog"
          aria-modal="true"
          aria-busy={lifecycleMutation?.state === 'pending'}
          aria-labelledby="publication-confirmation-title"
          aria-describedby="publication-confirmation-copy"
          tabIndex={-1}
        >
          <button
            type="button"
            className="publication-close"
            aria-label="關閉確認對話框"
            disabled={pending}
            onClick={() => setConfirmation(null)}
          >
            <X size={21} />
          </button>
          <div className="publication-symbol" aria-hidden="true">
            {confirmation.action === 'delete' ? (
              <Trash2 size={36} />
            ) : confirmation.action === 'unpublish' ? (
              <EyeOff size={36} />
            ) : (
              <BookOpen size={36} />
            )}
          </div>
          <h2 id="publication-confirmation-title">
            {confirmation.action === 'delete'
              ? '確定要刪除這本書嗎？'
              : confirmation.action === 'unpublish'
                ? '確定下架這本書嗎？'
                : republishArticleIds.has(confirmation.articleId)
                  ? '確定重新發布這本書嗎？'
                  : '確定要發布這本書嗎？'}
          </h2>
          <p id="publication-confirmation-copy">
            {confirmation.action === 'delete'
              ? '此操作將永久刪除書籍、圖片、公開留言、收藏與評論，且無法復原。請輸入 DELETE 以確認刪除。'
              : confirmation.action === 'publish'
                ? '發布後，所有讀者皆可在 PocketStocks 閱讀此書。重新發布不會復原先前移除的收藏。'
                : '下架後，此書不再對外顯示。作者草稿、留言與評論會保留；讀者收藏將永久移除。先前開啟的圖片可能短暫仍可檢視。'}
          </p>
          <div className="publication-book">
            {book && (
              <span className="publication-cover">
                <CoverArtwork
                  article={{ ...book, id: confirmation.articleId }}
                  refreshCover={refreshAdminCover}
                />
              </span>
            )}
            <div>
              <h3>{confirmation.articleTitle}</h3>
              <p>產業：{book?.sector || '尚未填寫'}</p>
              <p>
                {confirmation.action === 'unpublish' ? '發布日期' : '研究日期'}
                ：{book?.publicationDate || '尚未填寫'}
              </p>
            </div>
          </div>
          {confirmation.action === 'delete' && (
            <label className="confirmation-delete-field">
              請輸入 DELETE 以確認
              <div>
                <input
                  value={deleteConfirmationText}
                  disabled={pending}
                  onChange={event =>
                    setDeleteConfirmationText(event.target.value)
                  }
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="請輸入 DELETE 以確認永久刪除"
                />
                <button
                  type="button"
                  disabled={pending || !deleteConfirmationText}
                  aria-label="清除確認文字"
                  onClick={() => setDeleteConfirmationText('')}
                >
                  <X size={16} />
                </button>
              </div>
            </label>
          )}
          {lifecycleMutation && lifecycleMutation.state !== 'pending' && (
            <div
              className={`confirmation-feedback ${lifecycleMutation.state}`}
              role={
                lifecycleMutation.state === 'failed' ||
                lifecycleMutation.state === 'validation'
                  ? 'alert'
                  : 'status'
              }
              aria-live="polite"
            >
              <strong>
                {lifecycleMutation.state === 'partial'
                  ? '清理尚未完成'
                  : lifecycleMutation.state === 'stale'
                    ? '需要重新整理'
                    : lifecycleMutation.state === 'validation'
                      ? '請完成發布條件'
                      : '狀態尚未變更'}
              </strong>
              <span>{lifecycleMutation.message}</span>
              {lifecycleMutation.state === 'validation' &&
                lifecycleMutation.issues && (
                  <ul>
                    {lifecycleMutation.issues.map(issue => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
            </div>
          )}
          <div className="confirmation-actions">
            <button
              type="button"
              disabled={lifecycleMutation?.state === 'pending'}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              type="button"
              className={
                confirmation.action === 'delete'
                  ? 'danger-action'
                  : confirmation.action === 'unpublish'
                    ? 'unpublish-action'
                    : 'primary-action'
              }
              disabled={
                lifecycleMutation?.state === 'pending' ||
                (confirmation.action === 'delete' &&
                  deleteConfirmationText !== 'DELETE')
              }
              onClick={() =>
                confirmation.action === 'delete'
                  ? void runLifecycleMutation()
                  : void setPublication(confirmation.action === 'publish')
              }
            >
              {lifecycleMutation?.state === 'pending'
                ? confirmation.action === 'delete'
                  ? '刪除中…'
                  : confirmation.action === 'unpublish'
                    ? '下架中…'
                    : '發布中…'
                : lifecycleMutation?.state === 'partial'
                  ? '重試清理'
                  : lifecycleMutation?.state === 'failed' ||
                      lifecycleMutation?.state === 'stale' ||
                      lifecycleMutation?.state === 'validation'
                    ? confirmation.action === 'delete'
                      ? '重試刪除'
                      : '重試'
                    : confirmation.action === 'delete'
                      ? '確認刪除'
                      : confirmation.action === 'unpublish'
                        ? '確認下架'
                        : republishArticleIds.has(confirmation.articleId)
                          ? '確認重新發布'
                          : '確認發布'}
            </button>
          </div>
          <p className="publication-footnote">
            {confirmation.action === 'delete'
              ? '刪除後永久移除此書，所有內容將無法復原。'
              : confirmation.action === 'unpublish'
                ? '下架後仍可在作者工作區管理與重新發布。'
                : '發布後將立即對所有讀者可見。'}
          </p>
        </div>
      </div>,
      document.body
    );
  }

  function renderPageRemovalDialog() {
    if (!pageRemovalConfirmation) return null;
    return (
      <div
        className="confirmation-backdrop"
        role="presentation"
        onMouseDown={event => {
          if (event.currentTarget === event.target)
            setPageRemovalConfirmation(null);
        }}
      >
        <div
          ref={pageRemovalDialogRef}
          className="confirmation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="page-removal-confirmation-title"
          aria-describedby="page-removal-confirmation-copy"
          tabIndex={-1}
        >
          <h2 id="page-removal-confirmation-title">
            移除「{pageRemovalConfirmation.pageTitle}」？
          </h2>
          <p id="page-removal-confirmation-copy">
            儲存草稿後才會套用此變更。若移除封面，第一個剩餘頁面會成為封面。
          </p>
          <div className="confirmation-actions">
            <button
              type="button"
              onClick={() => setPageRemovalConfirmation(null)}
            >
              保留頁面
            </button>
            <button
              type="button"
              className="danger-action"
              onClick={confirmRemovePage}
            >
              移除頁面
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated && sessionRestoreStatus !== 'idle')
    return (
      <section className="login-view admin-unlock-view">
        <header className="application-banner admin-catalog-header">
          <ApplicationBrand
            onClick={() => {
              window.location.hash = '/';
            }}
          />
          <nav aria-label="作者登入導覽">
            <button
              type="button"
              onClick={() => {
                window.location.hash = '/';
              }}
            >
              研究書庫
            </button>
            <strong>作者登入</strong>
          </nav>
        </header>
        <main className="admin-unlock-layout">
          <section
            className="admin-unlock-form-panel"
            aria-busy={sessionRestoreStatus === 'checking'}
          >
            <h1>作者工作區</h1>
            {sessionRestoreStatus === 'checking' ? (
              <p className="admin-unlock-lead" role="status">
                <PendingIndicator>正在恢復作者工作階段…</PendingIndicator>
              </p>
            ) : (
              <>
                <p className="admin-unlock-lead" role="alert">
                  暫時無法確認作者工作階段。請重試，或稍後返回。
                </p>
                <button
                  type="button"
                  className="primary-action admin-unlock-submit"
                  onClick={() =>
                    setSessionRestoreAttempt(attempt => attempt + 1)
                  }
                >
                  重試工作階段
                </button>
              </>
            )}
          </section>
        </main>
      </section>
    );

  if (!authenticated)
    return (
      <section className="login-view admin-unlock-view">
        <header className="application-banner admin-catalog-header">
          <ApplicationBrand
            onClick={() => {
              window.location.hash = '/';
            }}
          />
          <nav aria-label="作者登入導覽">
            <button
              type="button"
              onClick={() => {
                window.location.hash = '/';
              }}
            >
              研究書庫
            </button>
            <strong>作者登入</strong>
          </nav>
        </header>
        <main className="admin-unlock-layout">
          <form
            className="admin-unlock-form-panel"
            onSubmit={login}
            aria-busy={busy}
          >
            <h1>作者工作區</h1>
            <label className="admin-unlock-label" htmlFor="admin-master-secret">
              作者密鑰
            </label>
            <div className="admin-unlock-input-row">
              <LockKeyhole size={21} aria-hidden="true" />
              <input
                id="admin-master-secret"
                ref={secretInputRef}
                type="password"
                value={secret}
                disabled={logoutStatus !== 'idle'}
                onChange={event => {
                  setSecret(event.target.value);
                  if (notice?.tone === 'error') setNotice(null);
                }}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={notice?.tone === 'error' || undefined}
                aria-describedby={
                  notice?.tone === 'error'
                    ? 'master-secret-help master-secret-status'
                    : 'master-secret-help'
                }
              />
            </div>
            <span id="master-secret-help" className="sr-only">
              作者密鑰僅由伺服器驗證。
            </span>
            <button
              className="primary-action admin-unlock-submit"
              disabled={busy || logoutStatus !== 'idle'}
              aria-busy={busy}
            >
              {busy ? (
                '驗證中…'
              ) : (
                <>
                  登入 <ArrowRight size={22} aria-hidden="true" />
                </>
              )}
            </button>
            {busy && (
              <div
                className="admin-unlock-pending"
                role="status"
                aria-live="polite"
              >
                <PendingIndicator>正在驗證作者密鑰…</PendingIndicator>
              </div>
            )}
            {notice && (
              <div
                ref={unlockNoticeRef}
                id="master-secret-status"
                tabIndex={-1}
                className={`admin-unlock-notice ${notice.tone}`}
                role={notice.tone === 'error' ? 'alert' : 'status'}
                aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
              >
                {notice.tone === 'error' ? (
                  <CircleAlert size={17} aria-hidden="true" />
                ) : (
                  <Check size={17} aria-hidden="true" />
                )}
                <span>{notice.message}</span>
              </div>
            )}
            {renderAdminSessionStatus()}
          </form>
        </main>
      </section>
    );

  if (isPreview && previewLoading)
    return (
      <>
        {renderAdminSessionStatus()}
        <section className='admin-loading'>
          <LoadingSkeleton kind='preview' label='正在載入私人預覽…' />
        </section>
      </>
    );
  if (isPreview)
    return (
      <>
        {renderAdminSessionStatus()}
        <DraftPreview
          article={draft}
          persistenceNote={
            previewArticleId
              ? '已儲存的預覽，可重新載入。'
              : '包含尚未儲存的變更；重新載入前請返回編輯器儲存。'
          }
          canPublish={publishReady}
          onPublish={() => openConfirmation('publish', draft)}
          previewState={previewState}
          onBack={() => {
            window.location.hash = draft.id
              ? `/admin/article/${encodeURIComponent(draft.id)}`
              : '/admin';
          }}
        />
        {renderConfirmationDialog()}
      </>
    );

  const normalizedAdminSearch = adminSearch.trim().toLocaleLowerCase();
  const listedAdminArticles = adminArticles.filter(article => {
    const matchesStatus =
      adminStatusFilter === 'all' ||
      (adminStatusFilter === 'published'
        ? articleIsPublished(article)
        : !articleIsPublished(article));
    const matchesSearch =
      !normalizedAdminSearch ||
      article.title.toLocaleLowerCase().includes(normalizedAdminSearch);
    return matchesStatus && matchesSearch;
  });
  const adminCatalogSize = 3;
  const adminCatalogCount = Math.max(
    1,
    Math.ceil(listedAdminArticles.length / adminCatalogSize)
  );
  const activeAdminCatalogPage = Math.min(
    adminCatalogPage,
    adminCatalogCount - 1
  );
  const pagedAdminArticles = listedAdminArticles.slice(
    activeAdminCatalogPage * adminCatalogSize,
    (activeAdminCatalogPage + 1) * adminCatalogSize
  );
  function renderBookActions(article: Article) {
    return (
      <div className="admin-row-actions">
        <button
          type="button"
          aria-label={`編輯 ${article.title}`}
          onClick={() => void editArticle(article)}
        >
          <FileImage size={14} /> 編輯
        </button>
        <button
          type="button"
          aria-label={`${articleIsPublished(article) ? '取消公開' : '發布'} ${article.title}`}
          disabled={
            adminActionFeedback?.articleId === article.id &&
            adminActionFeedback.state === 'pending'
          }
          onClick={() => requestLifecycleAction(article)}
        >
          {adminActionFeedback?.articleId === article.id &&
          adminActionFeedback.state === 'pending'
            ? `${articleIsPublished(article) ? '取消公開中' : '發布中'}…`
            : articleIsPublished(article)
              ? '取消公開'
              : '發布'}
        </button>
        <button
          type="button"
          aria-label={`預覽 ${article.title}`}
          onClick={() => {
            if (article.id)
              window.location.hash = `/preview/${encodeURIComponent(article.id)}`;
          }}
        >
          <Eye size={14} /> 預覽
        </button>
        <button
          type="button"
          className="admin-delete-intent"
          aria-label={`刪除 ${article.title}`}
          disabled={
            adminActionFeedback?.articleId === article.id &&
            adminActionFeedback.state === 'pending'
          }
          onClick={() => openConfirmation('delete', article, 'list')}
        >
          <Trash2 size={14} /> 刪除
        </button>
      </div>
    );
  }
  async function requestFeedbackPage(
    kind: FeedbackKind,
    nextToken?: string
  ): Promise<FeedbackPage> {
    const generation = adminSessionGenerationRef.current;
    const response = await adminRequest(
      () =>
        api.post('/api/admin/reader-forms/list', {
          sessionToken,
          kind,
          nextToken,
        }),
      generation
    );
    return getPayload<FeedbackPage>(response);
  }

  async function requestEtfAction(
    action: 'list' | 'get' | 'validate' | 'save' | 'publish' | 'status' | 'visibility',
    payload: Record<string, unknown>
  ): Promise<unknown> {
    const generation = adminSessionGenerationRef.current;
    const response = await adminRequest(
      () => api.post(`/api/admin/etf-reports/${action}`, {
        ...payload,
        sessionToken,
      }),
      generation
    );
    if (!isCurrentAdminSessionGeneration(generation))
      throw new Error('作者登入已更新，請重新開啟報告。');
    return getPayload<unknown>(response);
  }

  async function requestEtfEndpoint(
    path: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    if (!path.startsWith('/api/admin/calendar/') && !path.startsWith('/api/admin/institutional-research/') && !path.startsWith('/api/admin/etf-data/') && !path.startsWith('/api/admin/etf-reports/bodies') && !path.startsWith('/api/admin/etf-markdown/') && !path.startsWith('/api/admin/etf-research/')) {
      throw new Error('這個ETF操作不在作者工作區的範圍。');
    }
    const generation = adminSessionGenerationRef.current;
    const response = await adminRequest(
      () => api.post(path, { ...payload, sessionToken }),
      generation
    );
    if (!isCurrentAdminSessionGeneration(generation)) {
      throw new Error('作者登入已更新，請重新開啟資料任務。');
    }
    return getPayload<unknown>(response);
  }

  function renderUploadTypes(etf = false) {
    return <section className="author-upload-types" aria-labelledby="author-upload-title">
      <h2 id="author-upload-title">選擇上傳內容</h2>
      <a href="#/admin" aria-current={!etf && !institutionalRoute && !calendarRoute ? 'page' : undefined}>
        <BookOpen size={24} aria-hidden="true" /><strong>研究書籍</strong>
        <small>JPG、PNG、WebP 頁面圖片</small>
      </a>
      <a href="#/admin/active-etf?workflow=markdown" aria-current={etf && !institutionalRoute ? 'page' : undefined}>
        <FileSearch size={24} aria-hidden="true" /><strong>ETF 分析報告</strong>
        <small>JSON 研究文章、歷史 Markdown 與資料包</small>
      </a>
      <a href="#/admin/institutional-flows" aria-current={institutionalRoute ? 'page' : undefined}><FileSearch size={24} aria-hidden="true" /><strong>三大法人研究</strong><small>獨立草稿、四組圖表與文章發布</small></a>
      <a href="#/admin/calendar" aria-current={calendarRoute ? 'page' : undefined}><FileSearch size={24} aria-hidden="true" /><strong>投資行事曆</strong><small>手動匯入事件 JSON，保存本機</small></a>
    </section>;
  }

  function renderAuthorHeader(feedback: boolean, etf = false) {
    return (
      <header className="admin-catalog-header application-banner">
        <ApplicationBrand
          onClick={() => {
            window.location.hash = '/';
          }}
          label="查看 PocketStocks 公開書庫"
        />
        <nav className="author-workspace-nav" aria-label="作者工作區導覽">
          <button
            type="button"
            aria-current={!feedback && !etf && !institutionalRoute && !calendarRoute ? 'page' : undefined}
            onClick={() => {
              window.location.hash = '/admin';
            }}
          >
            研究書目
          </button>
          <button
            type="button"
            aria-current={feedback ? 'page' : undefined}
            onClick={() => {
              window.location.hash = '/admin/reader-feedback';
            }}
          >
            讀者回饋
          </button>
          <button
            type="button"
            aria-current={etf && !institutionalRoute ? 'page' : undefined}
            onClick={() => { window.location.hash = '/admin/active-etf?workflow=markdown'; }}
          >
            ETF報告
          </button>
          <button type="button" aria-current={institutionalRoute ? 'page' : undefined} onClick={() => { window.location.hash = '/admin/institutional-flows'; }}>三大法人</button>
          <button type="button" aria-current={calendarRoute ? 'page' : undefined} onClick={() => { window.location.hash = '/admin/calendar'; }}>投資日曆</button>
        </nav>
        <div className="admin-session-actions">
          <button
            type="button"
            onClick={() => {
              window.location.hash = '/';
            }}
          >
            <BookOpen size={15} /> 公開書庫
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={logoutStatus === 'pending'}
          >
            <LogOut size={15} />{' '}
            {logoutStatus === 'pending' ? '登出中…' : '登出'}
          </button>
        </div>
      </header>
    );
  }

  if (calendarRoute) return <section className="admin-view admin-book-list-view active-etf-author-view">{renderAuthorHeader(false)}{renderAdminSessionStatus()}{renderUploadTypes()}<InvestmentCalendarAuthor key={sessionToken} onDirtyChange={setEtfDirty} request={(action,payload)=>requestEtfEndpoint('/api/admin/calendar/'+action,payload)}/></section>;

  if (institutionalRoute) return <section className="admin-view admin-book-list-view active-etf-author-view">{renderAuthorHeader(false,true)}{renderAdminSessionStatus()}{renderUploadTypes()}<InstitutionalAuthor key={sessionToken} sessionToken={sessionToken} onDirtyChange={setEtfDirty} request={(action,payload)=>requestEtfEndpoint('/api/admin/institutional-research/'+action,payload)}/></section>;

  if (etfRoute)
    return (
      <section className="admin-view admin-book-list-view active-etf-author-view">
        {renderAuthorHeader(false, true)}
        {renderAdminSessionStatus()}
        {renderUploadTypes(true)}
        <EtfAuthorWorkspace
          key={sessionToken}
          sessionToken={sessionToken}
          request={requestEtfAction}
          requestEndpoint={requestEtfEndpoint}
          onDirtyChange={setEtfDirty}
        />
      </section>
    );

  if (feedbackRoute)
    return (
      <section className="admin-view admin-book-list-view author-feedback-view">
        {renderAuthorHeader(true)}
        {renderAdminSessionStatus()}
        <AuthorFeedbackView
          key={sessionToken}
          sessionToken={sessionToken}
          requestPage={requestFeedbackPage}
        />
      </section>
    );

  if (showBookList)
    return (
      <section className="admin-view admin-book-list-view">
        {renderAuthorHeader(false)} {renderAdminSessionStatus()}
        {renderUploadTypes()}
        <main className="admin-catalog-main">
          <div className="admin-catalog-title">
            <div ref={adminListHeadingRef} tabIndex={-1}>
              <h1>研究書目</h1>
            </div>
          </div>
          {notice && (
            <div
              className={`inline-notice ${notice.tone}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              {notice.message}
            </div>
          )}
          {adminActionFeedback && (
            <div
              className={`admin-action-feedback ${adminActionFeedback.state}`}
              role={adminActionFeedback.state === 'failed' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div>
                <span>
                  {adminActionFeedback.state === 'pending'
                    ? '操作處理中'
                    : adminActionFeedback.state === 'failed'
                      ? '操作失敗'
                      : '狀態資訊已過期'}
                </span>
                <strong>
                  {adminActionFeedback.state === 'pending'
                    ? `${adminActionFeedback.action === 'publish' ? '發布中' : '取消公開中'}…`
                    : adminActionFeedback.state === 'failed'
                      ? '狀態未變更'
                      : '需要重新整理'}
                </strong>
                <p>
                  {adminActionFeedback.state === 'pending'
                    ? 'PocketStocks 正在確認書目狀態，確認完成前書目會保留在清單中。'
                    : adminActionFeedback.state === 'failed'
                      ? '狀態未更新。仍可編輯或預覽，準備好後可重試。'
                      : '請先重新載入最新書目，再嘗試變更狀態。'}
                </p>
              </div>
              {adminActionFeedback.state === 'failed' && (
                <button
                  type="button"
                  onClick={() =>
                    setAdminActionFeedback({
                      ...adminActionFeedback,
                      state: 'pending',
                    })
                  }
                >
                  重試
                </button>
              )}
              {adminActionFeedback.state === 'stale' && (
                <button type="button" onClick={() => void refreshAdminList()}>
                  重新整理
                </button>
              )}
            </div>
          )}
          <div className="admin-catalog-tools">
            <CatalogSearch label="依書名搜尋" placeholder="搜尋書名…" value={adminSearch} onChange={setAdminSearch} />
            <CatalogSelect label="依公開狀態篩選" value={adminStatusFilter}
              options={[{value:'all',label:'全部狀態'},{value:'published',label:'已發布'},{value:'draft',label:'草稿'}]}
              onChange={value => setAdminStatusFilter(value as 'all' | 'published' | 'draft')} />
            {adminListStatus === 'ready' &&
              (normalizedAdminSearch || adminStatusFilter !== 'all') && (
                <span
                  className="admin-book-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  符合 {listedAdminArticles.length} 本
                </span>
              )}
          </div>
          <div className="admin-status-summary" aria-label="書目狀態摘要">
            <span>
              <strong>
                {adminListStatus === 'ready' ? adminArticles.length : '—'}
              </strong>{' '}
              本書
            </span>
            <span>
              <strong>
                {adminListStatus === 'ready'
                  ? adminArticles.filter(articleIsPublished).length
                  : '—'}
              </strong>{' '}
              已發布
            </span>
            <span>
              <strong>
                {adminListStatus === 'ready'
                  ? adminArticles.filter(
                      article => !articleIsPublished(article)
                    ).length
                  : '—'}
              </strong>{' '}
              草稿
            </span>
            <button
              type="button"
              className="admin-create-book"
              onClick={startNewDraft}
            >
              <Plus size={17} /> 建立新書
            </button>
          </div>
          {adminListStatus === 'loading' || adminListStatus === 'idle' ? (
            <section
              className="admin-list-state is-loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <LoadingSkeleton label='正在載入書目並確認草稿與公開狀態…' rows={4} />
            </section>
          ) : adminListStatus === 'error' ? (
            <section className="admin-list-state is-error" role="alert">
              <CircleAlert />
              <span>服務暫時無法使用</span>
              <h2>目前無法載入書目</h2>
              <p>已保留搜尋與篩選條件。請稍後再試。</p>
              <button type="button" onClick={() => void refreshAdminList()}>
                重試
              </button>
            </section>
          ) : adminArticles.length === 0 ? (
            <section className="admin-list-state" role="status">
              <BookOpen />
              <h2>還沒有研究書</h2>
              <p>建立第一本 PocketStocks 研究書；發布前只有作者可以查看。</p>
              <button type="button" onClick={startNewDraft}>
                建立新書
              </button>
            </section>
          ) : listedAdminArticles.length === 0 ? (
            <section className="admin-list-state" role="status">
              <Search />
              <h2>找不到相符書目</h2>
              <p>
                找不到符合
                {normalizedAdminSearch
                  ? `「${adminSearch.trim()}」`
                  : '目前搜尋條件'}
                的書籍
                {adminStatusFilter !== 'all'
                  ? `（${adminStatusFilter === 'published' ? '已發布' : '草稿'}）`
                  : ''}
                。
              </p>
              <button type="button" onClick={clearAdminFilters}>
                清除篩選
              </button>
            </section>
          ) : (
            <div
              className="admin-book-table"
              role="region"
              aria-label="作者私人書目"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">研究書</th>
                    <th scope="col">產業</th>
                    <th scope="col">狀態</th>
                    <th scope="col">更新日期</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAdminArticles.map(article => (
                    <tr
                      key={article.id}
                      aria-busy={
                        adminActionFeedback?.articleId === article.id &&
                        adminActionFeedback.state === 'pending'
                      }
                    >
                      <td>
                        <span className="admin-book-cover" aria-hidden="true">
                          <CoverArtwork
                            article={article}
                            refreshCover={refreshAdminCover}
                          />
                        </span>
                        <span>
                          <strong>{article.title}</strong>
                          <small>{adminImagePageLabel(article)}</small>
                        </span>
                      </td>
                      <td>{article.sector}</td>
                      <td>
                        <span
                          className={`admin-publication-status ${articleIsPublished(article) ? 'published' : 'draft'}`}
                        >
                          {articleIsPublished(article) ? '已發布' : '草稿'}
                        </span>
                      </td>
                      <td>
                        <time dateTime={article.updatedAt}>
                          {formatDate(article.updatedAt ?? '')}
                        </time>
                      </td>
                      <td>{renderBookActions(article)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {adminListStatus === 'ready' && listedAdminArticles.length > 0 && (
            <ul className="admin-book-stack" aria-label="作者私人書目">
              {pagedAdminArticles.map(article => (
                <li
                  key={article.id}
                  className="admin-book-stack-row"
                  aria-busy={
                    adminActionFeedback?.articleId === article.id &&
                    adminActionFeedback.state === 'pending'
                  }
                >
                  <span className="admin-book-cover" aria-hidden="true">
                    <CoverArtwork
                      article={article}
                      refreshCover={refreshAdminCover}
                    />
                  </span>
                  <span
                    className={`admin-publication-status ${articleIsPublished(article) ? 'published' : 'draft'}`}
                  >
                    {articleIsPublished(article) ? '已發布' : '草稿'}
                  </span>
                  <h2>{article.title}</h2>
                  <p className="admin-book-stack-metadata">
                    <span>{article.sector}</span>
                    <span>{adminImagePageLabel(article)}</span>
                    <time dateTime={article.updatedAt}>
                      更新於 {formatDate(article.updatedAt ?? '')}
                    </time>
                  </p>
                  {renderBookActions(article)}
                </li>
              ))}
            </ul>
          )}
          {adminListStatus === 'ready' && listedAdminArticles.length > 0 && (
            <CatalogPagination
              page={activeAdminCatalogPage}
              count={adminCatalogCount}
              total={listedAdminArticles.length}
              size={adminCatalogSize}
              label="作者書目分頁"
              onChange={setAdminCatalogPage}
            />
          )}
        </main>
        {renderConfirmationDialog()}
      </section>
    );

  return (
    <section className="admin-view admin-editor-view">
      <header className="admin-catalog-header application-banner">
        <ApplicationBrand
          onClick={() => {
            window.location.hash = '/';
          }}
          label="查看 PocketStocks 公開書庫"
        />
        <nav aria-label="作者工作區導覽">
          <button type="button" onClick={returnToBookList}>
            研究書目
          </button>
        </nav>
        <div className="admin-session-actions">
          <button
            type="button"
            onClick={() => {
              window.location.hash = '/';
            }}
          >
            <BookOpen size={15} /> 公開書庫
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={logoutStatus === 'pending'}
          >
            <LogOut size={15} />{' '}
            {logoutStatus === 'pending' ? '登出中…' : '登出'}
          </button>
        </div>
      </header>
      {renderAdminSessionStatus()}
      <div className="admin-layout">
        <button
          ref={mobileChooserTriggerRef}
          type="button"
          className="mobile-chooser-trigger"
          disabled={editorInteractionLocked}
          onClick={() => setMobileChooserOpen(true)}
          aria-expanded={mobileChooserOpen}
          aria-controls="mobile-research-chooser"
        >
          <FileImage size={17} /> 研究書{' '}
          <span>{draft.title || '建立研究書'}</span>
        </button>
        <aside
          ref={mobileChooserRef}
          id="mobile-research-chooser"
          className={
            mobileChooserOpen ? 'draft-index chooser-open' : 'draft-index'
          }
          role={mobileChooserOpen ? 'dialog' : undefined}
          aria-modal={mobileChooserOpen ? 'true' : undefined}
          aria-labelledby={
            mobileChooserOpen ? 'mobile-chooser-title' : undefined
          }
        >
          <div className="mobile-chooser-heading">
            <strong id="mobile-chooser-title">選擇研究書</strong>
            <button
              type="button"
              onClick={() => {
                setMobileChooserOpen(false);
                window.setTimeout(
                  () => mobileChooserTriggerRef.current?.focus(),
                  0
                );
              }}
              aria-label="關閉研究書選擇器"
            >
              <X size={20} />
            </button>
          </div>
          <button
            className="new-draft"
            disabled={editorInteractionLocked}
            onClick={startNewDraft}
          >
            <Plus size={17} /> 建立研究書
          </button>
          <nav className="admin-destinations" aria-label="作者工作區導覽">
            <button
              type="button"
              className={adminDestination === 'all' ? 'active' : ''}
              onClick={() => setAdminDestination('all')}
            >
              <FileImage size={16} /> 全部研究{' '}
              <span>{adminArticles.length}</span>
            </button>
            <button
              type="button"
              className={adminDestination === 'published' ? 'active' : ''}
              onClick={() => setAdminDestination('published')}
            >
              <Check size={16} /> 已發布{' '}
              <span>{adminArticles.filter(articleIsPublished).length}</span>
            </button>
            <button
              type="button"
              className={adminDestination === 'drafts' ? 'active' : ''}
              onClick={() => setAdminDestination('drafts')}
            >
              <FileImage size={16} /> 草稿{' '}
              <span>
                {
                  adminArticles.filter(article => !articleIsPublished(article))
                    .length
                }
              </span>
            </button>
            <button
              type="button"
              className={adminDestination === 'comments' ? 'active' : ''}
              onClick={() => setAdminDestination('comments')}
            >
              <MessageSquare size={16} /> 公開留言
            </button>
          </nav>
          <h2>
            {adminDestination === 'comments'
              ? '公開留言'
              : adminDestination === 'all'
                ? '全部研究'
                : adminDestination === 'published'
                  ? '已發布'
                  : '草稿'}
          </h2>
          {adminDestination === 'comments' ? (
            <p>請在各研究的公開頁面查看留言。</p>
          ) : visibleAdminArticles.length === 0 ? (
            <p>目前沒有符合條件的研究。</p>
          ) : (
            visibleAdminArticles.map(article => (
              <button
                key={article.id}
                className={draft.id === article.id ? 'active' : ''}
                disabled={editorInteractionLocked}
                onClick={() => void editArticle(article)}
              >
                <span className="catalog-mini-cover" aria-hidden="true">
                  <CoverArtwork
                    article={article}
                    refreshCover={refreshAdminCover}
                  />
                </span>
                <span className="catalog-record-copy">
                  <span>{article.title}</span>
                  <small>
                    {articleIsPublished(article) ? '已發布' : '草稿'} ·{' '}
                    {article.sector}
                  </small>
                </span>
              </button>
            ))
          )}
        </aside>
        {editorLoadPending ? <LoadingSkeleton kind='form' label='正在載入研究草稿…' rows={5} /> : <form
          className="editor-form"
          onSubmit={saveDraft}
          noValidate
          aria-busy={editorBusy || uploadPending || editorLifecyclePending}
        >
          <div className="editor-title">
            <div className="editor-title-row">
              <h2>{draft.id ? '編輯研究書' : '建立研究書'}</h2>
              <span
                className={`editor-state-badge ${isDirty ? 'is-dirty' : ''}`}
              >
                {articleIsPublished(draft as Article) ? '已發布' : '草稿'} ·{' '}
                {editorSavePending
                  ? '儲存中'
                  : editorLoadPending
                    ? '載入中'
                    : isDirty
                      ? '尚未儲存'
                      : draft.id
                        ? '已儲存'
                        : '新研究書'}
              </span>
              <span className="editor-save-time">
                {draft.updatedAt
                  ? `上次儲存：${new Date(draft.updatedAt).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                  : '尚未儲存'}
              </span>
              {draft.pages.length > 0 && (
                <button
                  type="button"
                  className="editor-preview-action"
                  disabled={
                    editorLoadPending || uploadPending || editorLifecyclePending
                  }
                  onClick={() => {
                    window.location.hash =
                      draft.id && !isDirty
                        ? `/preview/${encodeURIComponent(draft.id)}`
                        : '/preview';
                  }}
                >
                  <Eye size={20} /> 預覽
                </button>
              )}
              {editorLocked ? (
                <button
                  type="button"
                  className="editor-top-save editor-unpublish-action"
                  disabled={editorBusy || editorLifecyclePending || isDirty}
                  onClick={() => openConfirmation('unpublish')}
                >
                  下架後編輯
                </button>
              ) : (
                <button
                  type="submit"
                  className="editor-top-save"
                  disabled={
                    editorInteractionLocked || editorSavePending || !isDirty
                  }
                  aria-busy={editorSavePending}
                >
                  <Check size={20} />{' '}
                  {editorSavePending ? '儲存中…' : '儲存草稿'}
                </button>
              )}
              {!editorLocked && (
                <button
                  type="button"
                  className="editor-publish-action"
                  disabled={
                    editorBusy || editorLifecyclePending || uploadPending
                  }
                  aria-disabled={!publishReady}
                  onClick={() =>
                    publishReady
                      ? openConfirmation('publish')
                      : setNotice({
                          tone: 'error',
                          message: uploadRecoveryState
                            ? '發布前請先處理圖片上傳狀態。'
                            : '請完成必要書籍資訊與圖片，並先儲存所有變更。',
                        })
                  }
                >
                  <Send size={15} /> 發布研究書
                </button>
              )}
            </div>
            <p id="editor-workflow-help" className="sr-only">
              填寫書籍資訊，為每頁加入簡介並調整章節順序與封面。
            </p>
          </div>
          {notice && (
            <div
              className={`inline-notice ${notice.tone}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              {notice.message}
            </div>
          )}
          <section className="editor-metadata" aria-labelledby="metadata-title">
            <div className="editor-section-heading">
              <h3 id="metadata-title">書籍資訊</h3>
            </div>
            {validationRequested && metadataIssues.length > 0 && (
              <div className="editor-validation-summary" role="alert">
                <strong>請完成必要書籍資訊</strong>
                <span>{metadataIssues.join(' ')}</span>
              </div>
            )}
            <div className="field-grid">
              <label className="span-two">
                書名 *
                <input
                  ref={metadataTitleInputRef}
                  value={draft.title}
                  disabled={editorInteractionLocked}
                  aria-invalid={validationRequested && !draft.title.trim()}
                  aria-describedby={
                    validationRequested && !draft.title.trim()
                      ? 'title-help editor-workflow-help title-error'
                      : 'title-help editor-workflow-help'
                  }
                  aria-errormessage={
                    validationRequested && !draft.title.trim()
                      ? 'title-error'
                      : undefined
                  }
                  onChange={event =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  maxLength={160}
                  required
                />
                <span id="title-help" className="field-hint">
                  {draft.title.length}/160
                </span>
                {validationRequested && !draft.title.trim() && (
                  <span id="title-error" className="field-error">
                    請填寫書名。
                  </span>
                )}
              </label>
              <label className="span-two">
                書籍簡介 *
                <textarea
                  ref={metadataSummaryInputRef}
                  value={draft.summary}
                  disabled={editorInteractionLocked}
                  aria-invalid={validationRequested && !draft.summary.trim()}
                  aria-describedby={
                    validationRequested && !draft.summary.trim()
                      ? 'summary-help summary-error'
                      : 'summary-help'
                  }
                  aria-errormessage={
                    validationRequested && !draft.summary.trim()
                      ? 'summary-error'
                      : undefined
                  }
                  onChange={event =>
                    setDraft({ ...draft, summary: event.target.value })
                  }
                  rows={4}
                  maxLength={1000}
                  required
                />
                <span id="summary-help" className="field-hint">
                  {draft.summary.length}/1000
                </span>
                {validationRequested && !draft.summary.trim() && (
                  <span id="summary-error" className="field-error">
                    請填寫簡介。
                  </span>
                )}
              </label>
              <label>
                產業類別 *
                <input
                  ref={metadataSectorInputRef}
                  value={draft.sector}
                  disabled={editorInteractionLocked}
                  aria-invalid={validationRequested && !draft.sector.trim()}
                  aria-describedby={
                    validationRequested && !draft.sector.trim()
                      ? 'sector-error'
                      : undefined
                  }
                  aria-errormessage={
                    validationRequested && !draft.sector.trim()
                      ? 'sector-error'
                      : undefined
                  }
                  onChange={event =>
                    setDraft({ ...draft, sector: event.target.value })
                  }
                  maxLength={80}
                  required
                />
                {validationRequested && !draft.sector.trim() && (
                  <span id="sector-error" className="field-error">
                    請填寫產業類別。
                  </span>
                )}
              </label>
              <label>
                預計發布日期 *
                <input
                  ref={metadataDateInputRef}
                  type="date"
                  value={draft.publicationDate.slice(0, 10)}
                  disabled={editorInteractionLocked}
                  aria-invalid={
                    validationRequested &&
                    !isValidDraftPublicationDate(draft.publicationDate)
                  }
                  aria-describedby={
                    validationRequested &&
                    !isValidDraftPublicationDate(draft.publicationDate)
                      ? 'publication-date-error'
                      : undefined
                  }
                  aria-errormessage={
                    validationRequested &&
                    !isValidDraftPublicationDate(draft.publicationDate)
                      ? 'publication-date-error'
                      : undefined
                  }
                  onChange={event =>
                    setDraft({ ...draft, publicationDate: event.target.value })
                  }
                  required
                />
                {validationRequested &&
                  !isValidDraftPublicationDate(draft.publicationDate) && (
                    <span id="publication-date-error" className="field-error">
                      請選擇有效的發布日期。
                    </span>
                  )}
              </label>
            </div>
            <div className="tag-editor">
              <label>標籤</label>
              <div className="editor-tag-chips">
                {draft.tags.map(item => (
                  <button
                    type="button"
                    key={item}
                    disabled={editorInteractionLocked}
                    aria-label={`移除標籤 ${item}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        tags: draft.tags.filter(tagItem => tagItem !== item),
                      })
                    }
                  >
                    {item}
                    <X size={14} />
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="editor-tag-input">
                輸入標籤
              </label>
              <div className="editor-tag-input">
                <input
                  id="editor-tag-input"
                  value={tagInput}
                  disabled={editorInteractionLocked}
                  onChange={event => setTagInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="輸入標籤後按 Enter"
                />
                <button
                  type="button"
                  disabled={editorInteractionLocked}
                  onClick={addTag}
                >
                  加入
                </button>
              </div>
            </div>
          </section>
          <section className="page-editor">
            <div className="page-editor-heading">
              <div>
                <h3>書籍內容</h3>
                <p>調整章節順序，為每一頁加入圖片與簡介，打造你的研究書。</p>
                <span className="sr-only">
                  {draft.pages.length} 頁 ·{' '}
                  {hasSelectedCover ? '已選擇封面' : '請選擇封面'}
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="upload-button"
                  disabled={editorInteractionLocked}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <FileImage size={19} /> 加入圖片 +
                </button>
                <input
                  ref={uploadInputRef}
                  className="sr-only"
                  tabIndex={-1}
                  type="file"
                  aria-label="上傳研究頁面圖片"
                  disabled={editorInteractionLocked}
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={event => {
                    void addImages(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
              </div>
            </div>
            {draft.pages.length === 0 && (
              <button
                type="button"
                className="upload-dropzone"
                disabled={editorInteractionLocked}
                onClick={() => uploadInputRef.current?.click()}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  if (!editorInteractionLocked)
                    void addImages(Array.from(event.dataTransfer.files));
                }}
              >
                <Upload size={24} />
                <strong>加入研究圖片</strong>
                <span>拖放圖片至此，或選擇檔案</span>
                <small>
                  JPG、PNG、WebP · 最多 80 頁 · 每張 7.5 MB · 建議寬度 1920 px
                </small>
              </button>
            )}
            {uploadRecoveryState && (
              <section
                className={`upload-recovery ${uploadRecoveryState.state}`}
                role={
                  uploadRecoveryState.state === 'pending' ? 'status' : 'alert'
                }
                aria-live="polite"
              >
                {uploadRecoveryState.state === 'pending' ? (
                  <>
                    <strong><PendingIndicator>
                      正在處理 {uploadRecoveryState.files.length} 張圖片…
                    </PendingIndicator></strong>
                    <span>請保持編輯器開啟，待圖片處理完成後再繼續編輯。</span>
                  </>
                ) : uploadRecoveryState.state === 'partial' ? (
                  <>
                    <strong>部分圖片未能處理。</strong>
                    <span>
                      已處理的圖片保留在草稿中。請替換失敗的圖片，或重試儲存。
                    </span>
                  </>
                ) : (
                  <>
                    <strong>圖片未能處理。</strong>
                    <span>
                      草稿與頁面順序已保留。請重新選擇圖片，或重試儲存。
                    </span>
                  </>
                )}
                <ul>
                  {uploadRecoveryState.files.map(file => (
                    <li key={file.id}>
                      <span>{file.name}</span>
                      <span>{file.detail}</span>
                    </li>
                  ))}
                </ul>
                {uploadRecoveryState.state !== 'pending' && (
                  <button type="button" onClick={retryUploadRecovery}>
                    {uploadRecoveryState.state === 'partial'
                      ? '選擇替代圖片'
                      : '重新選擇圖片'}
                  </button>
                )}
              </section>
            )}
            {fileActivity && (
              <p className="file-activity" role="status">
                {editorBusy || uploadPending ? <PendingIndicator>{fileActivity}</PendingIndicator> : fileActivity}
              </p>
            )}
            {validationRequested && pageIssues.length > 0 && (
              <div className="editor-validation-summary" role="alert">
                <strong>請完成每頁圖片與說明</strong>
                <span>{pageIssues.join(' ')}</span>
              </div>
            )}
            {draft.pages.length > 0 && (
              <nav className="editor-pagination" aria-label="書籍內容分頁">
                <span role="status" aria-live="polite">
                  第 {editorPageStart + 1}–
                  {Math.min(
                    editorPageStart + EDITOR_PAGE_SIZE,
                    draft.pages.length
                  )}{' '}
                  頁，共 {draft.pages.length} 頁
                </span>
                <div>
                  <button
                    type="button"
                    disabled={
                      activeEditorPage === 0 ||
                      editorLoadPending ||
                      uploadPending ||
                      editorLifecyclePending
                    }
                    aria-label="上一組圖片"
                    onClick={() => setEditorPage(activeEditorPage - 1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  {Array.from(
                    { length: editorPageCount },
                    (_, pageIndex) => pageIndex
                  )
                    .filter(
                      pageIndex =>
                        pageIndex === 0 ||
                        pageIndex === editorPageCount - 1 ||
                        Math.abs(pageIndex - activeEditorPage) <= 1
                    )
                    .map((pageIndex, index, numbers) => (
                      <span key={pageIndex}>
                        {index > 0 && pageIndex - numbers[index - 1] > 1 && (
                          <span className="pagination-gap" aria-hidden="true">
                            …
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={
                            editorLoadPending ||
                            uploadPending ||
                            editorLifecyclePending
                          }
                          aria-label={`第 ${pageIndex + 1} 組圖片`}
                          aria-current={
                            pageIndex === activeEditorPage ? 'page' : undefined
                          }
                          onClick={() => setEditorPage(pageIndex)}
                        >
                          {pageIndex + 1}
                        </button>
                      </span>
                    ))}
                  <button
                    type="button"
                    disabled={
                      activeEditorPage === editorPageCount - 1 ||
                      editorLoadPending ||
                      uploadPending ||
                      editorLifecyclePending
                    }
                    aria-label="下一組圖片"
                    onClick={() => setEditorPage(activeEditorPage + 1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </nav>
            )}
            {draft.pages.length > 0 && (
              <div className="page-list">
                {visibleEditorPages.map(({ page, index }) => (
                  <article key={page.id ?? page.clientKey ?? `page-${index}`}>
                    <div className="page-thumbnail">
                      <img src={page.imageUrl} alt="" />
                      {pageIdentity(page, index) === draft.coverPageId && (
                        <span>封面</span>
                      )}
                    </div>
                    <span className="page-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <label>
                      頁面簡介 *
                      <input
                        value={page.altText}
                        disabled={editorInteractionLocked}
                        aria-invalid={
                          validationRequested && !page.altText.trim()
                        }
                        maxLength={500}
                        required
                        onChange={event =>
                          setDraft({
                            ...draft,
                            pages: draft.pages.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, altText: event.target.value }
                                : item
                            ),
                          })
                        }
                        placeholder="描述圖片內容與研究重點"
                      />
                      <span className="field-hint">
                        {page.altText.length} / 500
                      </span>
                    </label>
                    <label>
                      頁面標題 *
                      <input
                        value={page.title}
                        disabled={editorInteractionLocked}
                        aria-invalid={validationRequested && !page.title.trim()}
                        maxLength={120}
                        required
                        onChange={event =>
                          setDraft({
                            ...draft,
                            pages: draft.pages.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, title: event.target.value }
                                : item
                            ),
                          })
                        }
                      />
                      <span className="field-hint">
                        {page.title.length} / 120
                      </span>
                    </label>
                    <div
                      className="page-actions"
                      aria-label={`調整第 ${index + 1} 頁順序`}
                    >
                      <button
                        type="button"
                        className={
                          pageIdentity(page, index) === draft.coverPageId
                            ? 'cover-action selected'
                            : 'cover-action'
                        }
                        disabled={
                          editorInteractionLocked ||
                          pageIdentity(page, index) === draft.coverPageId
                        }
                        aria-label={`將第 ${index + 1} 頁設為封面`}
                        onClick={() => selectCover(page, index)}
                      >
                        <Check size={17} />{' '}
                        {pageIdentity(page, index) === draft.coverPageId
                          ? '封面'
                          : '設為封面'}
                      </button>
                      <button
                        type="button"
                        disabled={editorInteractionLocked || index === 0}
                        aria-label={`上移第 ${index + 1} 頁`}
                        onClick={() => movePage(index, -1)}
                      >
                        <MoveUp size={15} /> 上移
                      </button>
                      <button
                        type="button"
                        disabled={
                          editorInteractionLocked ||
                          index === draft.pages.length - 1
                        }
                        aria-label={`下移第 ${index + 1} 頁`}
                        onClick={() => movePage(index, 1)}
                      >
                        <MoveDown size={15} /> 下移
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={editorInteractionLocked}
                        aria-label={`移除第 ${index + 1} 頁`}
                        onClick={() => requestRemovePage(index)}
                      >
                        <Trash2 size={18} />
                        <span className="sr-only">移除</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="sr-only" role="status" aria-live="polite">
              {pagePositionMessage}
            </p>
          </section>
        </form>}
      </div>
      {renderConfirmationDialog()}
      {renderPageRemovalDialog()}
    </section>
  );
}

export default App;
