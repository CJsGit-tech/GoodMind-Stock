export function isReaderAccountDestination(route: string) {
  return [
    '/my-library', '/my-library/favorites', '/my-library/reviews',
    '/reader/suggestions', '/reader/research-interest',
    '/active-etf', '/active-etf/history',
  ].includes(route) || /^\/active-etf\/[A-Za-z0-9._-]{1,120}$/.test(route);
}
