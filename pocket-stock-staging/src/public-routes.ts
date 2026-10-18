const RETIRED_PUBLIC_ROUTES = new Set(['/about', '/methodology']);

export function normalizePublicRoute(route: string) {
  return RETIRED_PUBLIC_ROUTES.has(route) ? '/' : route;
}

export type PublicArticleRoute = {
  articleId: string;
  reader: boolean;
  pageIndex: number | null;
  invalidPage: boolean;
};

function decodeRouteSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isSafeArticleId(articleId: string | null): articleId is string {
  if (!articleId) return false;
  return (
    articleId.length <= 200 &&
    articleId.trim() === articleId &&
    articleId !== '.' &&
    articleId !== '..' &&
    !/[\\/\u0000-\u001F\u007F?#]/u.test(articleId)
  );
}

export function parsePublicArticleRoute(
  route: string
): PublicArticleRoute | null {
  const detailMatch = route.match(/^\/article\/([^/]+)$/u);
  const readerMatch = route.match(/^\/article\/([^/]+)\/read\/([^/]+)$/u);
  if (!detailMatch && !readerMatch) return null;

  const articleId = decodeRouteSegment((detailMatch ?? readerMatch)![1]);
  if (!isSafeArticleId(articleId)) return null;
  if (detailMatch)
    return { articleId, reader: false, pageIndex: null, invalidPage: false };

  const pageToken = decodeRouteSegment(readerMatch![2]);
  const pageMatch = pageToken?.match(/^page-(\d+)$/u);
  if (!pageMatch)
    return { articleId, reader: true, pageIndex: null, invalidPage: true };
  const pageNumber = Number(pageMatch[1]);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    return { articleId, reader: true, pageIndex: null, invalidPage: true };
  }
  return {
    articleId,
    reader: true,
    pageIndex: pageNumber - 1,
    invalidPage: false,
  };
}
