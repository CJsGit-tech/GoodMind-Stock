export const CALENDAR_SOURCE_LIMIT = 128 * 1024;
export const CALENDAR_CATEGORIES = { economy: '經濟數據', central_bank: '央行會議', csp: 'CSP 財報', earnings: '產業財報／營收', ai_capex: 'AI 資本支出' } as const;
export type CalendarCategory = keyof typeof CALENDAR_CATEGORIES;
export type CalendarZone = 'Asia/Taipei' | 'America/New_York';
export type CalendarSource = { id: string; name: string; url: string; checkedAt: string; usageBasis: string; usageUrl: string };
export type InvestmentEvent = {
  id: string; title: string; category: CalendarCategory; entity: string; period: string;
  sourceId: string; sourceDate: string; sourceEndDate?: string; sourceTimezone: string;
  startsAt: string | null; precision: 'exact' | 'date_only'; confirmation: 'confirmed' | 'estimated';
  status: 'scheduled' | 'cancelled'; note: string;
};
export type CalendarBundle = { schemaVersion: 1; sources: CalendarSource[]; events: InvestmentEvent[] };
export type CalendarChange = { changedAt: string; previous: InvestmentEvent };
export type SavedCalendarEvent = InvestmentEvent & { history: CalendarChange[] };
export type CalendarState = { revision: number; importedAt: string | null; sources: CalendarSource[]; events: SavedCalendarEvent[] };
export const emptyCalendar = (): CalendarState => ({ revision: 0, importedAt: null, sources: [], events: [] });
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('資料必須是 JSON 物件。');
  return v as Record<string, unknown>;
};
function text(v: unknown, name: string, max = 200, optional = false): string {
  if (optional && v === undefined) return '';
  if (typeof v !== 'string' || (!optional && !v.trim()) || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)) throw Error(`${name}格式不正確或超過 ${max} 字。`);
  return v.trim();
}
function key(v: unknown, name: string) {
  const value = text(v, name, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw Error(`${name}只能使用英數字、點、底線及連字號。`);
  return value;
}
export function calendarDate(v: unknown): string {
  const date = text(v, '日期', 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('日期必須是有效的 YYYY-MM-DD。');
  return date;
}
function instant(v: unknown, name: string): string {
  const value = text(v, name, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error(`${name}必須包含秒數與明確時區。`);
  // Reject rollover dates such as February 30 before normalizing the offset.
  calendarDate(value.slice(0, 10));
  if (+value.slice(11, 13) > 23 || +value.slice(14, 16) > 59 || +value.slice(17, 19) > 59) throw Error(`${name}時間無效。`);
  return new Date(value).toISOString();
}
function url(v: unknown, name: string) {
  const value = text(v, name, 1000);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw Error(`${name}必須是 HTTPS 網址。`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || /^(localhost|127\.|0\.|10\.|192\.168\.|\[)/i.test(parsed.hostname)) throw Error(`${name}必須是公開 HTTPS 網址，不可帶登入資訊。`);
  return value;
}
export function eventDay(event: InvestmentEvent, zone: string): string {
  if (!event.startsAt) return event.sourceDate;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.startsAt));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function eventTime(event: InvestmentEvent, zone: string) {
  return event.startsAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(event.startsAt)) : '時間未公布';
}
export function parseCalendarBundle(raw: string): CalendarBundle {
  if (new TextEncoder().encode(raw).length > CALENDAR_SOURCE_LIMIT) throw Error('JSON 檔案不可超過 128 KiB。');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error('無法讀取 JSON，請檢查檔案格式。'); }
  const root = object(value);
  if (root.schemaVersion !== 1 || !Array.isArray(root.sources) || !Array.isArray(root.events) || !root.sources.length || root.sources.length > 30 || !root.events.length || root.events.length > 100) throw Error('需要 schemaVersion: 1、1–30 個來源及 1–100 筆事件。');
  const sources = root.sources.map(input => {
    const source = object(input);
    const checkedAt = instant(source.checkedAt, '查核時間');
    if (Date.parse(checkedAt) > Date.now() + 60000) throw Error('查核時間不可晚於目前時間。');
    return { id: key(source.id, '來源 ID'), name: text(source.name, '來源名稱'), url: url(source.url, '來源網址'),
      checkedAt, usageBasis: text(source.usageBasis, '允許使用依據', 600), usageUrl: url(source.usageUrl, '使用依據網址') };
  });
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw Error('來源 ID 不可重複。');
  const events: InvestmentEvent[] = root.events.map(input => {
    const event = object(input);
    const sourceId = key(event.sourceId, '來源 ID');
    if (!sources.some(source => source.id === sourceId)) throw Error('每筆事件都必須對應套件內的來源。');
    if (!Object.hasOwn(CALENDAR_CATEGORIES, String(event.category))) throw Error('事件類別無效。');
    if (!['exact', 'date_only'].includes(String(event.precision)) || !['confirmed', 'estimated'].includes(String(event.confirmation)) || !['scheduled', 'cancelled'].includes(String(event.status))) throw Error('事件的時間精度、確認或取消狀態無效。');
    const sourceDate = calendarDate(event.sourceDate);
    const sourceEndDate = event.sourceEndDate === undefined ? undefined : calendarDate(event.sourceEndDate);
    if (sourceEndDate && (sourceEndDate < sourceDate || (Date.parse(sourceEndDate) - Date.parse(sourceDate)) / 86400000 > 31)) throw Error('日期區間不可倒置或超過 31 日。');
    const sourceTimezone = text(event.sourceTimezone, '來源時區', 80);
    try { new Intl.DateTimeFormat('en', { timeZone: sourceTimezone }); } catch { throw Error('來源時區必須是有效的 IANA 時區。'); }
    const startsAt = event.precision === 'exact' ? instant(event.startsAt, '發布時間') : null;
    if (event.precision === 'date_only' && event.startsAt !== null) throw Error('僅日期事件的 startsAt 必須為 null，不可填午夜。');
    const result: InvestmentEvent = { id: key(event.id, '事件 ID'), title: text(event.title, '事件名稱'), category: event.category as CalendarCategory,
      entity: text(event.entity, '公司／機構', 100), period: text(event.period, '報告期間', 100), sourceId, sourceDate,
      ...(sourceEndDate ? { sourceEndDate } : {}), sourceTimezone, startsAt, precision: event.precision as InvestmentEvent['precision'],
      confirmation: event.confirmation as InvestmentEvent['confirmation'], status: event.status as InvestmentEvent['status'], note: text(event.note, '事件說明', 600, true) };
    if (startsAt && eventDay(result, sourceTimezone) !== sourceDate) throw Error('發布時間與來源日期／時區不一致。');
    return result;
  });
  if (new Set(events.map(e => e.id)).size !== events.length) throw Error('同一套件的事件 ID 不可重複。');
  return { schemaVersion: 1, sources, events };
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function mergeCalendar(state: CalendarState, bundle: CalendarBundle, now: string) {
  let added = 0, changed = 0;
  const sourceMap = new Map(state.sources.map(s => [s.id, s]));
  for (const source of bundle.sources) sourceMap.set(source.id, source);
  const eventMap = new Map(state.events.map(e => [e.id, e]));
  for (const event of bundle.events) {
    const old = eventMap.get(event.id);
    const original = old && (({ history: _history, ...rest }) => rest)(old);
    if (original && canonicalJson(original) === canonicalJson(event)) continue;
    const history = old ? [{ changedAt: now, previous: original! }, ...old.history].slice(0, 5) : [];
    if (old) changed++; else added++;
    eventMap.set(event.id, { ...event, history });
  }
  const sources = [...sourceMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const events = [...eventMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (events.length > 100 || sources.length > 30) throw Error('本機月曆最多保存 100 筆事件與 30 個來源。');
  const sourceChanged = canonicalJson(sources) !== canonicalJson([...state.sources].sort((a, b) => a.id.localeCompare(b.id)));
  const updated = added + changed > 0 || sourceChanged;
  const next: CalendarState = updated ? { revision: state.revision + 1, importedAt: now, sources, events } : state;
  if (new TextEncoder().encode(JSON.stringify(next)).length > 220 * 1024) throw Error('含歷史的資料超過保存上限，請縮小套件。');
  return { state: next, added, changed, unchanged: bundle.events.length - added - changed, updated };
}
export function calendarDays(month: string): string[] {
  const [year, index] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  const start = first.getUTCDate() - (first.getUTCDay() + 6) % 7;
  const count = Math.ceil(((first.getUTCDay() + 6) % 7 + new Date(Date.UTC(year, index, 0)).getUTCDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, index - 1, start + i)).toISOString().slice(0, 10));
}
