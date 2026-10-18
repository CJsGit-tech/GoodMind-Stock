/**
 * Restores the admin catalog's page collection invariant at the API boundary.
 * A missing collection means the server reported no page records; it does not
 * synthesize a page or alter any valid records.
 */
export function normalizeAdminArticlePages<T extends { pages?: unknown }>(
  article: T
) {
  type Page = T extends { pages: (infer Item)[] } ? Item : never;
  return {
    ...article,
    pages: Array.isArray(article.pages) ? (article.pages as Page[]) : [],
  } as Omit<T, 'pages'> & { pages: Page[] };
}
