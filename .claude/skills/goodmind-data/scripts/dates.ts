// A date on a record must be written in one of the quotes it cites. This only checks that the date is there;
// whether it dates this fact is still the verifier's call.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Check-time stamps say when we looked, not something a source states. */
const EXEMPT = new Set(['recorded_at', 'last_verified_at', 'observed_at', 'link_checked_at', 'published_at']);
export const isDateKey = (k: string) => !EXEMPT.has(k) && (k === 'as_of' || k === 'since' || k === 'valid_from' || k === 'valid_to' || k.endsWith('_at') || k.endsWith('_date'));

export function quoteStates(date: string, quotes: string[]): boolean {
  const m = date.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T.*)?$/);
  if (!m) return false;
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : 0, d = m[3] ? Number(m[3]) : 0;
  const years = `(?<!\\d)(?:${y}|(?:民國)?${y - 1911}(?=\\s*(?:年|[./]\\s*\\d)))`;   // Gregorian, or ROC year when written as a date
  const patterns: RegExp[] = [];
  const sep = '\\s*(?:年|[-./])\\s*';
  if (d) {
    const name = `(?:${MONTHS[mo - 1]}|${MONTHS[mo - 1].slice(0, 3)}\\.?)`;
    patterns.push(new RegExp(`${years}${sep}0?${mo}\\s*(?:月|[-./])\\s*0?${d}(?!\\d)`));
    patterns.push(new RegExp(`${name}\\s+0?${d}(?:st|nd|rd|th)?,?\\s+${y}(?!\\d)`, 'i'), new RegExp(`(?<!\\d)0?${d}\\s+${name},?\\s+${y}(?!\\d)`, 'i'));
    if (String(date).startsWith(`${y}-`)) patterns.push(new RegExp(`(?<!\\d)${y}${m[2]}${m[3]}(?!\\d)`));
  } else if (mo) {
    patterns.push(new RegExp(`${years}${sep}0?${mo}(?!\\d)`), new RegExp(`(?:${MONTHS[mo - 1]}|${MONTHS[mo - 1].slice(0, 3)}\\.?),?\\s+${y}(?!\\d)`, 'i'));
  } else patterns.push(new RegExp(`(?<!\\d)${y}(?!\\d)`), new RegExp(`(?<!\\d)(?:民國)?${y - 1911}\\s*年`));
  return quotes.some(q => patterns.some(p => p.test(q.normalize('NFKC'))));
}
