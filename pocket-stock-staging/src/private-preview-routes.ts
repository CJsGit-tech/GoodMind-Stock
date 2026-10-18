export type PrivatePreviewRoute =
  | { kind: 'memory' }
  | { kind: 'saved'; articleId: string };

const MAX_ARTICLE_ID_LENGTH = 200;

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isSafeArticleId(value: string | null): value is string {
  if (!value) return false;
  return (
    value.length <= MAX_ARTICLE_ID_LENGTH &&
    value.trim() === value &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\u0000-\u001F\u007F?#]/u.test(value)
  );
}

export function parsePrivatePreviewRoute(
  hash = window.location.hash
): PrivatePreviewRoute | null {
  const route = hash.replace(/^#/, '');
  if (route === '/preview') return { kind: 'memory' };

  const match = route.match(/^\/preview\/([^/?#]+)$/u);
  if (!match) return null;

  const articleId = decodeRouteSegment(match[1]);
  return isSafeArticleId(articleId) ? { kind: 'saved', articleId } : null;
}
