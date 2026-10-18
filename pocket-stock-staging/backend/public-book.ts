export interface PublishedBookPageDescriptor {
  id: string;
  order: number;
  title: string;
  altText: string;
  storagePath: string;
}

export interface PublicPageManifestItem {
  id: string;
  order: number;
  title: string;
  altText: string;
  imageUrl: string;
}

function isExactText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isPublicBookPageId(value: unknown): value is string {
  return isExactText(value, 100) && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isPublicBookPageDescriptor(
  value: unknown
): value is PublishedBookPageDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const page = value as Record<string, unknown>;
  return (
    isPublicBookPageId(page.id) &&
    isExactText(page.title, 120) &&
    isExactText(page.altText, 500) &&
    isExactText(page.storagePath, 500) &&
    !/[\\\u0000-\u001F\u007F]/.test(page.storagePath)
  );
}

function validSourcePageOrder(order: number): number | null {
  return Number.isSafeInteger(order) && order >= 0 ? order : null;
}

export function orderPublishedBookPages<T extends PublishedBookPageDescriptor>(
  pages: T[]
): T[] {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => {
      const leftOrder = validSourcePageOrder(left.page.order);
      const rightOrder = validSourcePageOrder(right.page.order);
      if (leftOrder === null)
        return rightOrder === null ? left.index - right.index : 1;
      if (rightOrder === null) return -1;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ page }, order) => ({ ...page, order }));
}

export function selectPublishedBookCover<T extends { id: string }>(
  pages: readonly T[],
  coverPageId: string | null | undefined
): T | undefined {
  return pages.find(page => page.id === coverPageId) ?? pages[0];
}

export function preparePublicBookPages(
  pages: unknown
): PublishedBookPageDescriptor[] | null {
  if (!Array.isArray(pages)) return null;
  const pageIds = new Set<string>();
  const publicPages: PublishedBookPageDescriptor[] = [];

  for (const candidate of pages) {
    if (!isPublicBookPageDescriptor(candidate) || pageIds.has(candidate.id))
      return null;
    pageIds.add(candidate.id);
    publicPages.push({
      id: candidate.id,
      order: typeof candidate.order === 'number' ? candidate.order : Number.NaN,
      title: candidate.title,
      altText: candidate.altText,
      storagePath: candidate.storagePath,
    });
  }

  return orderPublishedBookPages(publicPages);
}

// The local runtime explicitly opts into signed assets on its exact loopback origin.
export function isPublicAssetUrl(value: string): boolean {
  if (value.startsWith('https://')) return true;
  const origin = typeof process !== 'undefined' ? process.env.POCKETSTOCKS_LOCAL_ORIGIN : undefined;
  if (!origin) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === 'localhost' && url.origin === origin && url.pathname === '/__local/storage';
  } catch { return false; }
}

export function createPublicPageManifest(
  pages: PublishedBookPageDescriptor[],
  urlsByStoragePath: ReadonlyMap<string, string>
): PublicPageManifestItem[] {
  const publicPages = preparePublicBookPages(pages);
  if (!publicPages) throw new Error('Published page manifest is invalid.');

  return publicPages.map(page => {
    const resolvedUrl = urlsByStoragePath.get(page.storagePath);
    const imageUrl = typeof resolvedUrl === 'string' ? resolvedUrl.trim() : '';
    if (!isPublicAssetUrl(imageUrl)) {
      throw new Error(`Published page asset is unavailable: ${page.id}`);
    }
    return {
      id: page.id,
      order: page.order,
      title: page.title,
      altText: page.altText,
      imageUrl,
    };
  });
}
