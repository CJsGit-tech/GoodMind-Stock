export type WorkspaceSort = 'name-asc' | 'name-desc' | 'source';

export function sortWorkspaceRows<T>(
  rows: T[],
  order: WorkspaceSort,
  locale: string,
  displayName: (row: T) => string,
  stableKey: (row: T) => string,
): T[] {
  if (order === 'source') return [...rows];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const direction = order === 'name-desc' ? -1 : 1;
  return [...rows].sort((a, b) =>
    direction * collator.compare(displayName(a), displayName(b)) ||
    collator.compare(stableKey(a), stableKey(b))
  );
}
