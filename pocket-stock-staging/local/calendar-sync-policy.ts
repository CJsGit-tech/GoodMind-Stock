import { createHash } from 'node:crypto';
import { canonicalJson, eventDay, mergeCalendar, parseCalendarBundle, type CalendarBundle, type CalendarCategory, type CalendarSource, type CalendarState, type InvestmentEvent } from '../shared/investment-calendar.ts';

type Publisher = 'bls' | 'bea' | 'fed' | 'census' | 'cbc' | 'mof' | 'dgbas' | 'msft' | 'amzn' | 'googl' | 'meta' | 'nvda' | 'amd' | 'aapl' | 'mu' | 'orcl' | 'tsmc';
type Release = { publisher: Publisher; suffix: string; title: string; quarter?: boolean; category?: CalendarCategory; fiscal?: boolean };
export const CALENDAR_RELEASES: Record<string, Release> = {
  'bls.employment': { publisher: 'bls', suffix: 'employment', title: '非農就業與失業率' },
  'bls.cpi': { publisher: 'bls', suffix: 'cpi', title: 'CPI 消費者物價指數' },
  'bls.ppi': { publisher: 'bls', suffix: 'ppi', title: 'PPI 生產者物價指數' },
  'bls.jolts': { publisher: 'bls', suffix: 'jolts', title: 'JOLTS 職缺與勞動流動' },
  'bls.eci': { publisher: 'bls', suffix: 'eci', title: 'ECI 就業成本指數', quarter: true },
  'bea.pio': { publisher: 'bea', suffix: 'pio', title: 'PCE／個人所得與支出' },
  'bea.gdp.advance': { publisher: 'bea', suffix: 'gdp-advance', title: 'GDP 第三季初估', quarter: true },
  'bea.gdp.second': { publisher: 'bea', suffix: 'gdp-second', title: 'GDP 第三季第二次估計', quarter: true },
  'bea.gdp.third': { publisher: 'bea', suffix: 'gdp-third', title: 'GDP 第三季第三次估計', quarter: true },
  'fed.meeting': { publisher: 'fed', suffix: 'meeting', title: 'FOMC 兩日會議' },
  'fed.decision': { publisher: 'fed', suffix: 'decision', title: 'FOMC 利率決策' },
  'fed.conference': { publisher: 'fed', suffix: 'conference', title: 'FOMC 記者會' },
  'fed.minutes': { publisher: 'fed', suffix: 'minutes', title: 'FOMC 會議紀錄' },
  'census.retail': { publisher: 'census', suffix: 'retail', title: '美國零售銷售初估' },
  'cbc.meeting': { publisher: 'cbc', suffix: 'meeting', title: '台灣央行理監事會議', category: 'central_bank' },
  'mof.exports': { publisher: 'mof', suffix: 'exports', title: '台灣進出口統計' },
  'dgbas.gdp': { publisher: 'dgbas', suffix: 'gdp', title: '台灣 GDP', quarter: true },
  'dgbas.cpi': { publisher: 'dgbas', suffix: 'cpi', title: '台灣 CPI' },
};
const FACTS_USAGE_URL = 'https://www.copyright.gov/help/faq/faq-protect.html';
const FACTS_USAGE = '自行整理官方公開日程的名稱與日期事實，保留出處；不重製公告正文、圖像或投影片。日期事實不等於公告全文授權，仍須遵守網站存取限制。';
export const COMPANY_CALENDARS = {
  msft: { name: 'Microsoft', url: 'https://www.microsoft.com/en-us/investor/default', zone: 'America/Los_Angeles', csp: true, fiscal: true, impact: '觀察 Azure 成長與 AI 資本支出，連結台灣伺服器、網通、電源及散熱供應鏈。' },
  amzn: { name: 'Amazon', url: 'https://ir.aboutamazon.com/overview/default.aspx', zone: 'America/Los_Angeles', csp: true, fiscal: false, impact: '觀察 AWS 成長與資料中心投資，連結台灣伺服器、網通與 AI 基礎設施需求。' },
  googl: { name: 'Alphabet', url: 'https://abc.xyz/investor/', zone: 'America/Los_Angeles', csp: true, fiscal: false, impact: '觀察 Google Cloud、TPU 與資本支出，連結台灣 ASIC、伺服器及網通供應鏈。' },
  meta: { name: 'Meta', url: 'https://investor.atmeta.com/investor-events/', zone: 'America/Los_Angeles', csp: true, fiscal: false, impact: '觀察 AI 基礎設施與資本支出，連結台灣伺服器、網通及散熱。此處列為四大 AI 基建買家之一。' },
  nvda: { name: 'NVIDIA', url: 'https://investor.nvidia.com/events-and-presentations/events-and-presentations/default.aspx', zone: 'America/Los_Angeles', csp: false, fiscal: true, impact: '觀察 AI GPU 需求、供給與產品進度，連結台灣晶圓代工、先進封裝及伺服器供應鏈。' },
  amd: { name: 'AMD', url: 'https://ir.amd.com/news-events/ir-calendar', zone: 'America/Los_Angeles', csp: false, fiscal: false, impact: '觀察 CPU／GPU 與 AI 伺服器展望，連結台灣晶圓代工、封裝及板卡供應鏈。' },
  aapl: { name: 'Apple', url: 'https://investor.apple.com/investor-relations/default.aspx', zone: 'America/Los_Angeles', csp: false, fiscal: true, impact: '觀察終端需求與產品組合，連結台灣晶圓代工、組裝與電子零組件。' },
  mu: { name: 'Micron', url: 'https://investors.micron.com/events-and-presentations/', zone: 'America/New_York', csp: false, fiscal: true, impact: '觀察 DRAM／NAND／HBM 需求、價格與供給，作為台灣記憶體產業景氣參考。' },
  orcl: { name: 'Oracle', url: 'https://investor.oracle.com/events-and-presentations/default.aspx', zone: 'America/Chicago', csp: true, fiscal: true, impact: '觀察 OCI、AI 訂單及資料中心投資，補充四大 AI 基建買家以外的需求訊號。' },
  tsmc: { name: 'TSMC 台積電', url: 'https://investor.tsmc.com/english/financial-calendar', zone: 'Asia/Taipei', csp: false, fiscal: false, impact: '觀察製程需求、營收、資本支出與先進封裝展望；可能影響台股權值與半導體供應鏈。' },
} as const;
for (const [publisher, company] of Object.entries(COMPANY_CALENDARS)) {
  for (const [suffix, label] of [['earnings', '財報發布'], ['call', '財報電話會議']] as const) {
    CALENDAR_RELEASES[`${publisher}.${suffix}`] = { publisher: publisher as Publisher, suffix, title: `${company.name} ${label}`, quarter: true, category: company.csp ? 'csp' : 'earnings', fiscal: company.fiscal };
  }
}
CALENDAR_RELEASES['tsmc.revenue'] = { publisher: 'tsmc', suffix: 'revenue', title: '台積電月營收', category: 'earnings' };
export const SOURCE_POLICIES: Record<Publisher, { name: string; usageUrl: string; usageBasis: string }> = {
  bls: { name: 'U.S. Bureau of Labor Statistics', usageUrl: 'https://www.bls.gov/bls/linksite.htm', usageBasis: 'BLS 公有領域日程；僅整理日期事實並保留出處，不使用標誌或第三方素材。' },
  bea: { name: 'U.S. Bureau of Economic Analysis', usageUrl: 'https://www.bea.gov/help/faq/147', usageBasis: 'BEA 未另有聲明的網站資訊為公有領域；僅整理日期事實並保留出處。' },
  fed: { name: 'Federal Reserve Board', usageUrl: 'https://www.federalreserve.gov/disclaimer.htm', usageBasis: 'Federal Reserve Board 未另標示的資訊為公有領域；僅整理日程事實並保留來源。' },
  census: { name: 'U.S. Census Bureau', usageUrl: FACTS_USAGE_URL, usageBasis: FACTS_USAGE },
  cbc: { name: '台灣中央銀行', usageUrl: 'https://www.cbc.gov.tw/tw/cp-307-36676-DE020-1.html', usageBasis: '央行政府資料開放宣告採政府資料開放授權條款第1版；保留來源，不使用標誌或第三方素材。' },
  mof: { name: '台灣財政部', usageUrl: 'https://www.mof.gov.tw/singlehtml/23b4129de54f4a2b947416628c4002dc?cntId=132c02e56adf447b9aa9f8872761079c', usageBasis: '財政部政府網站資料開放宣告採政府資料開放授權條款第1版；保留出處與原意，不使用標誌或另有限制的第三方素材。' },
  dgbas: { name: '行政院主計總處', usageUrl: 'https://www.stat.gov.tw/cp.aspx?n=3164', usageBasis: '主計總處政府網站資料開放宣告採政府資料開放授權條款第1版；保留出處與原意，不使用標誌或另有限制的第三方素材。' },
  ...Object.fromEntries(Object.entries(COMPANY_CALENDARS).map(([key, company]) => [key, { name: company.name, usageUrl: FACTS_USAGE_URL, usageBasis: FACTS_USAGE }])),
} as Record<Publisher, { name: string; usageUrl: string; usageBasis: string }>;
export const sourceHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const addDays = (day: string, count: number) => new Date(Date.parse(day + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export const taipeiDay = (now: Date) => eventDay({ startsAt: now.toISOString() } as InvestmentEvent, 'Asia/Taipei');
export function officialPublisher(value: string): Publisher {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.hash || url.username || url.password) throw Error('來源只接受白名單中的官方 HTTPS 日程。');
  if (url.search && !(['www.mof.gov.tw', 'www.stat.gov.tw'].includes(url.hostname) && [...url.searchParams.keys()].every(key => ['cntId', 'n', 'sms', 'Create', 'pid', 's', 'csn', 'icode', 'MetaI_D'].includes(key)))) throw Error('來源網址包含未允許的查詢參數。');
  if (url.hostname === 'www.bls.gov' && /^\/schedule\/20\d{2}\/(0[1-9]|1[0-2])_sched\.htm$/.test(url.pathname)) return 'bls';
  if (url.hostname === 'www.bea.gov' && url.pathname === '/news/schedule/full') return 'bea';
  if (url.hostname === 'www.federalreserve.gov' && (/^\/newsevents\/20\d{2}-(january|february|march|april|may|june|july|august|september|october|november|december)\.htm$/.test(url.pathname) || url.pathname === '/monetarypolicy/fomccalendars.htm')) return 'fed';
  if (url.hostname === 'www.census.gov' && (url.pathname === '/retail/release_schedule.html' || /^\/economic-indicators\/(?:20\d{2}-)?calendar(?:-listview)?(?:-20\d{2})?\.html$/.test(url.pathname))) return 'census';
  if (url.hostname === 'www.cbc.gov.tw' && /^\/tw\/(?:cp-[\w-]+\.html|mp-1\.html)$/.test(url.pathname)) return 'cbc';
  if (url.hostname === 'www.mof.gov.tw' && /^\/(?:singlehtml|multiplehtml)\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return 'mof';
  if (url.hostname === 'www.stat.gov.tw' && /^\/(?:News|Standard|ct|np|lp)[A-Za-z0-9_/.-]*$/i.test(url.pathname)) return 'dgbas';
  const companyPaths: Record<string, [Publisher, RegExp]> = {
    'www.microsoft.com': ['msft', /^\/en-us\/investor(?:\/|$)/i],
    'ir.aboutamazon.com': ['amzn', /^\/(?:overview|events|news-release|quarterly-results)(?:\/|$)/],
    'abc.xyz': ['googl', /^\/investor(?:\/|$)/],
    'investor.atmeta.com': ['meta', /^\/(?:home|investor-events|investor-news|financials)(?:\/|$)/],
    'investor.nvidia.com': ['nvda', /^\/(?:events-and-presentations|financial-info)(?:\/|$)/],
    'ir.amd.com': ['amd', /^\/(?:news-events|news-releases)(?:\/|$)/],
    'investor.apple.com': ['aapl', /^\/(?:investor-relations|events|earnings)(?:\/|$)/],
    'investors.micron.com': ['mu', /^\/(?:events-and-presentations|news-releases)(?:\/|$)/],
    'investor.oracle.com': ['orcl', /^\/(?:events-and-presentations|investor-news|Financial-Analyst-Meeting-20\d{2})(?:\/|$)/],
    'investor.tsmc.com': ['tsmc', /^\/(?:english|chinese)\/(?:financial-calendar|quarterly-results|monthly-revenue)(?:\/|$)/],
  };
  const company = Object.hasOwn(companyPaths, url.hostname) ? companyPaths[url.hostname] : undefined;
  if (company && company[1].test(url.pathname)) return company[0];
  throw Error('來源不在已核對的官方日程白名單。');
}
export function calendarResearchSources(now = new Date()) {
  const upcomingStart = taipeiDay(now), start = addDays(upcomingStart, -7), endExclusive = addDays(upcomingStart, 60);
  const months = new Set<string>();
  for (let day = start; day < endExclusive; day = addDays(day, 1)) months.add(day.slice(0, 7));
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return { start, upcomingStart, endExclusive, maximumPageReads: 32, minimumResearchIntervalHours: 24,
    urls: [...months].flatMap(month => [`https://www.bls.gov/schedule/${month.slice(0, 4)}/${month.slice(5)}_sched.htm`, `https://www.federalreserve.gov/newsevents/${month.slice(0, 4)}-${monthNames[Number(month.slice(5)) - 1]}.htm`]).concat('https://www.bea.gov/news/schedule/full', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
    companies: COMPANY_CALENDARS,
    domestic: { cbc: 'https://www.cbc.gov.tw/tw/mp-1.html', mof: 'https://www.mof.gov.tw/singlehtml/277?cntId=63569', dgbas: 'https://www.stat.gov.tw/News_NoticeCalendar_Change.aspx?n=3782&sms=11502' },
    additional: ['https://www.census.gov/retail/release_schedule.html'],
    mandatoryPublishers: ['msft', 'amzn', 'googl', 'meta', 'bls', 'bea', 'fed'],
    policies: SOURCE_POLICIES, releaseKinds: Object.keys(CALENDAR_RELEASES) };
}
type Observation = { kind: string; period: string; sourceId: string; sourceDate: string; sourceEndDate?: string; startsAt: string | null; precision: string; confirmation: string; status: string; evidence: string; sourceTimezone?: string; note?: string };
export type CalendarResearch = { schemaVersion: 1; sources: CalendarSource[]; observations: Observation[] };
export type ReviewItem = { id: string; reason: string; proposed: InvestmentEvent; previous?: InvestmentEvent };
export function prepareCalendarResearch(state: CalendarState, raw: string, now = new Date()) {
  if (Buffer.byteLength(raw) > 128 * 1024) throw Error('研究輸入不可超過 128 KiB。');
  const research = JSON.parse(raw) as CalendarResearch;
  if (!research || research.schemaVersion !== 1 || !Array.isArray(research.sources) || !Array.isArray(research.observations) || !research.observations.length || research.observations.length > 100) throw Error('研究格式需要 schemaVersion: 1、sources 與 1–100 筆 observations。');
  const sourceIds = new Map<string, string>(), publisherById = new Map<string, Publisher>();
  const sources = research.sources.map(source => {
    const publisher = officialPublisher(source.url), policy = SOURCE_POLICIES[publisher];
    if (source.usageUrl !== policy.usageUrl) throw Error('來源使用依據與已核對的官方政策不一致。');
    if (!Number.isFinite(Date.parse(source.checkedAt)) || now.getTime() - Date.parse(source.checkedAt) > 24 * 3600000 || Date.parse(source.checkedAt) > now.getTime() + 60000) throw Error('來源必須在本輪前 24 小時內查核，不得填未來時間。');
    if (sourceIds.has(source.id)) throw Error('來源 ID 不可重複。');
    const previous = state.sources.find(old => old.url === source.url);
    const id = previous?.id || `${publisher}-source-${sourceHash(source.url).slice(0, 16)}`;
    sourceIds.set(source.id, id); publisherById.set(source.id, publisher);
    return previous ? { ...previous, checkedAt: source.checkedAt } : { ...source, id, name: policy.name, usageBasis: policy.usageBasis };
  });
  if (new Set(sources.map(source => source.url)).size !== sources.length) throw Error('同一來源網址不可重複。');
  const events = research.observations.map(observation => {
    const release = Object.hasOwn(CALENDAR_RELEASES, observation.kind) ? CALENDAR_RELEASES[observation.kind] : undefined;
    if (!release || publisherById.get(observation.sourceId) !== release.publisher) throw Error('發布種類與官方來源機構不一致。');
    if (typeof observation.evidence !== 'string' || !observation.evidence.trim() || observation.evidence.length > 300) throw Error('每筆事件需要不超過 300 字的來源日期事實證據。');
    const pattern = release.quarter ? /^20\d{2}-Q[1-4]$/ : /^20\d{2}-(0[1-9]|1[0-2])$/;
    if (!pattern.test(observation.period)) throw Error('報告期間必須是 YYYY-MM，季度資料使用 YYYY-Q1～Q4。');
    const year = observation.period.slice(0, 4), unit = observation.period.slice(5);
    const periodKey = release.quarter ? `${year}q${unit.slice(1)}` : `${year}${unit}`;
    const id = `${release.publisher}-${periodKey}-${release.suffix}`;
    const period = release.quarter ? `${release.fiscal ? 'FY' : ''}${year} 年第${['一', '二', '三', '四'][Number(unit.slice(1)) - 1]}季` : `${year} 年 ${Number(unit)} 月`;
    const title = observation.kind.startsWith('bea.gdp.') ? release.title.replace('第三季', `第${['一', '二', '三', '四'][Number(unit.slice(1)) - 1]}季`) : release.title;
    const company = Object.hasOwn(COMPANY_CALENDARS, release.publisher) ? COMPANY_CALENDARS[release.publisher as keyof typeof COMPANY_CALENDARS] : undefined;
    const sourceTimezone = observation.sourceTimezone || company?.zone || (['cbc', 'mof', 'dgbas'].includes(release.publisher) ? 'Asia/Taipei' : 'America/New_York');
    if (!['Asia/Taipei', 'America/New_York', 'America/Los_Angeles', 'America/Chicago'].includes(sourceTimezone)) throw Error('來源時區不在已核對的 IANA 白名單。');
    return { id, title, category: release.category || (release.publisher === 'fed' ? 'central_bank' : 'economy'), entity: company?.name || (release.publisher === 'fed' ? 'Federal Reserve' : release.publisher === 'bls' || release.publisher === 'bea' ? release.publisher.toUpperCase() : SOURCE_POLICIES[release.publisher].name), period,
      sourceId: sourceIds.get(observation.sourceId), sourceDate: observation.sourceDate, ...(observation.sourceEndDate ? { sourceEndDate: observation.sourceEndDate } : {}), startsAt: observation.startsAt,
      sourceTimezone, precision: observation.precision, confirmation: observation.confirmation, status: observation.status, note: observation.note || company?.impact || '' };
  });
  const bundle = parseCalendarBundle(JSON.stringify({ schemaVersion: 1, sources, events }));
  const { start, endExclusive } = calendarResearchSources(now);
  const eligible: InvestmentEvent[] = [], review: ReviewItem[] = [], outsideWindow: string[] = [];
  let unchanged = 0;
  for (const event of bundle.events) {
    const day = eventDay(event, 'Asia/Taipei');
    if (day >= endExclusive || (event.sourceEndDate || day) < start) { outsideWindow.push(event.id); continue; }
    const old = state.events.find(item => item.id === event.id);
    // Match legacy manual IDs by semantic identity as well, so title/date changes
    // cannot create a second active event for the same release and period.
    const identity = state.events.find(item => item.entity === event.entity && item.category === event.category && item.period === event.period && item.title === event.title);
    if (!old && identity) { event.id = identity.id; }
    const previous = old || identity;
    if (previous) event.note = previous.note;
    const { history: _history, ...original } = previous || { history: [] };
    if (event.confirmation !== 'confirmed' || event.status === 'cancelled') review.push({ id: event.id, reason: '預估或取消須由作者覆核。', proposed: event, ...(previous ? { previous: original as InvestmentEvent } : {}) });
    else if (previous && canonicalJson(original) !== canonicalJson(event)) review.push({ id: event.id, reason: '既有事件的日期、時間、來源或身分有變更，未自動覆寫。', proposed: event, previous: original as InvestmentEvent });
    else { eligible.push(event); if (previous) unchanged++; }
  }
  const used = new Set(eligible.map(event => event.sourceId));
  const importBundle: CalendarBundle | null = eligible.length ? { schemaVersion: 1, sources: bundle.sources.filter(source => used.has(source.id)), events: eligible } : null;
  const result = importBundle ? mergeCalendar(state, importBundle, now.toISOString()) : null;
  return { start, endExclusive, baseRevision: state.revision, bundle: importBundle, review, outsideWindow, added: eligible.length - unchanged, unchanged, wouldWrite: result?.updated || false };
}
