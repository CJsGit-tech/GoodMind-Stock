import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { calendarResearchSources, prepareCalendarResearch, sourceHash } from './calendar-sync-policy.ts';
import { canonicalJson, parseCalendarBundle, type CalendarState } from '../shared/investment-calendar.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
type Prepared = { version: 1; createdAt: string; rawResearch: string; baseState: CalendarState; rawSource: string; hash: string; requestId: string; attempted: boolean; applied?: { revision: number; added: number; unchanged: number; verifiedAt: string } };
function readJson<T>(path: string): T | null { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null; }
function saveJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}
export function calendarLocalConfig() {
  const file = existsSync(resolve(root, '.env')) ? parseEnv(readFileSync(resolve(root, '.env'), 'utf8')) : {};
  const port = Number(process.env.PORT || file.PORT || 5173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('本機 PORT 無效。');
  return { origin: `http://localhost:${port}`, secret: process.env.POCKETSTOCKS_LOCAL_ADMIN_SECRET || file.ADMIN_MASTER_SECRET || '' };
}
export class CalendarSyncClient {
  private cookie = '';
  constructor(private origin: string, private fetcher: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== 'localhost' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('配套只允許明確連接埠的 localhost HTTP，不接受正式網站。');
    this.origin = url.origin;
  }
  async request(path: string, method = 'GET', body?: unknown) {
    const response = await this.fetcher(this.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Origin: this.origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw Object.assign(new Error(`本機 API 回應 ${response.status}，資料未能確認；保留原請求，不改其他目的地。`), { status: response.status });
    const value = await response.json();
    return { value, response };
  }
  async state(): Promise<CalendarState> {
    const { value } = await this.request('/api/calendar/events');
    if (!value || !Number.isSafeInteger(value.revision) || !Array.isArray(value.events) || !Array.isArray(value.sources)) throw Error('本機日曆回應格式無效。');
    return value;
  }
  async login(secret: string) {
    if (!secret.trim()) throw Error('找不到本機 .env 的作者憑證。');
    const { response } = await this.request('/api/admin/session', 'POST', { secret });
    const cookie = response.headers.get('set-cookie');
    if (!cookie) throw Error('本機作者登入未建立工作階段。');
    this.cookie = cookie.split(';')[0];
  }
  async logout() {
    if (!this.cookie) return;
    try { await this.request('/api/admin/session', 'DELETE'); } finally { this.cookie = ''; }
  }
}
export async function runCalendarSync(args: string[], options: { directory?: string; client?: CalendarSyncClient; secret?: string; now?: Date } = {}) {
  const [command, input] = args;
  const now = options.now || new Date();
  const directory = options.directory || resolve(root, '.local/calendar-sync');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (command === 'review-file') {
    const statePath = args[2];
    if (!input || !statePath || args.length !== 3) throw Error('review-file 需要研究 JSON 與公開日曆狀態 JSON。');
    if (statSync(input).size > 128 * 1024 || statSync(statePath).size > 230 * 1024) throw Error('研究或公開狀態檔案超過上限。');
    const state = readJson<CalendarState>(statePath);
    if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.events) || !Array.isArray(state.sources)) throw Error('公開日曆狀態格式不正確。');
    if (state.events.length || state.sources.length) {
      parseCalendarBundle(JSON.stringify({ schemaVersion: 1, sources: state.sources, events: state.events }));
      if (state.events.some(event => !Array.isArray(event.history) || event.history.length > 5)) throw Error('公開日曆修訂紀錄格式不正確。');
    }
    const plan = prepareCalendarResearch(state, readFileSync(input, 'utf8'), now);
    const output = resolve(directory, 'production/review.json');
    const bundlePath = resolve(directory, 'production/import.json');
    saveJson(output, { checkedAt: now.toISOString(), ...plan });
    if (plan.bundle) saveJson(bundlePath, plan.bundle);
    else if (existsSync(bundlePath)) rmSync(bundlePath);
    return { command, offline: true, baseRevision: plan.baseRevision, added: plan.added, unchanged: plan.unchanged, requiresReview: plan.review.length, outsideWindow: plan.outsideWindow.length, wouldWrite: plan.wouldWrite, output, bundlePath: plan.bundle ? bundlePath : null };
  }
  const config = calendarLocalConfig();
  const attemptPath = resolve(directory, 'research-attempt.json'), preparedPath = resolve(directory, 'prepared.json'), reviewPath = resolve(directory, 'review.json');
  const client = options.client || new CalendarSyncClient(config.origin);
    if (!['status', 'begin', 'prepare', 'apply'].includes(command)) throw Error('用法：calendar:sync -- status | begin | prepare <research.json> | apply | review-file <research.json> <public-state.json>');
  const lock = resolve(directory, '.operation-lock');
  // A killed operation can leave a lock. Fail closed instead of guessing whether
  // another import is still committing; the owner can inspect and remove it.
  try { mkdirSync(lock); } catch { throw Error('另一次日曆操作進行中或留下鎖定；請先核對，勿並行重送。'); }
  try {
    const prepared = readJson<Prepared>(preparedPath);
    if (command === 'status' || command === 'begin') {
      const state = await client.state();
      const attempt = readJson<{ attemptedAt: string }>(attemptPath);
      const allowed = !attempt || now.getTime() - Date.parse(attempt.attemptedAt) >= 24 * 3600000;
      if (command === 'begin') {
        if (prepared?.attempted && !prepared.applied) throw Error('上一輪匯入結果尚未核實，先以 apply 重試同一請求；不得重新研究或取代輸入。');
        if (!allowed) throw Error('距上次開始研究未滿 24 小時；重用已保存輸入，不再請求來源。');
        saveJson(attemptPath, { attemptedAt: now.toISOString() });
      }
      return { command, destination: config.origin, state, researchAllowed: allowed, lastResearchAttempt: attempt?.attemptedAt || null, pendingImport: !!prepared?.attempted && !prepared.applied, sourcePlan: calendarResearchSources(now) };
    }
    if (command === 'prepare') {
      if (!input || args.length !== 2) throw Error('prepare 需要一個研究 JSON 檔案路徑。');
      if (prepared?.attempted && !prepared.applied) throw Error('上一輪結果尚未確認，保留原輸入與 requestId，先執行 apply。');
      if (statSync(input).size > 128 * 1024) throw Error('研究輸入不可超過 128 KiB。');
      const rawResearch = readFileSync(input, 'utf8'), state = await client.state();
      const plan = prepareCalendarResearch(state, rawResearch, now);
      saveJson(reviewPath, { checkedAt: now.toISOString(), baseRevision: state.revision, review: plan.review, outsideWindow: plan.outsideWindow });
      const rawSource = plan.bundle ? JSON.stringify(plan.bundle) : '';
      const next: Prepared = { version: 1, createdAt: now.toISOString(), rawResearch, baseState: state, rawSource, hash: sourceHash(rawSource), requestId: randomUUID(), attempted: false };
      saveJson(preparedPath, next);
      return { command, baseRevision: state.revision, window: { start: plan.start, endExclusive: plan.endExclusive }, added: plan.added, unchanged: plan.unchanged, requiresReview: plan.review.length, outsideWindow: plan.outsideWindow.length, wouldWrite: plan.wouldWrite, preparedPath, reviewPath };
    }
    if (!prepared || prepared.version !== 1) throw Error('尚無已驗證的匯入；先 prepare。');
    if (prepared.applied) return { command, alreadyApplied: true, ...prepared.applied };
    if (!prepared.rawSource) return { command, noEligibleEvents: true, reviewPath };
    // Derive the payload again from the original research and snapshot. Editing
    // a prepared payload cannot silently bypass the review policy.
    const planned = prepareCalendarResearch(prepared.baseState, prepared.rawResearch, new Date(prepared.createdAt));
    if (!planned.bundle || JSON.stringify(planned.bundle) !== prepared.rawSource || sourceHash(prepared.rawSource) !== prepared.hash || !/^[a-zA-Z0-9-]{16,100}$/.test(prepared.requestId)) throw Error('已驗證輸入被修改，停止匯入。');
    const current = await client.state();
    if (!prepared.attempted) {
      if (now.getTime() - Date.parse(prepared.createdAt) > 24 * 3600000 || now.getTime() < Date.parse(prepared.createdAt) - 60000) throw Error('預覽已超過 24 小時或時間異常，請重新核對。');
      if (current.revision !== prepared.baseState.revision) throw Error('本機版本已變更，請重新 prepare；不覆蓋其他修改。');
      // Re-check the rolling window immediately before the first write.
      const refreshed = prepareCalendarResearch(current, prepared.rawResearch, now);
      if (JSON.stringify(refreshed.bundle) !== prepared.rawSource) throw Error('日期範圍已變動，請重新 prepare。');
    }
    const expected = parseCalendarBundle(prepared.rawSource);
    if (!planned.wouldWrite) {
      return { command, unchanged: expected.events.length, noWriteNeeded: true, revision: current.revision };
    }
    await client.login(options.secret ?? config.secret);
    try {
      prepared.attempted = true; saveJson(preparedPath, prepared);
      const { value } = await client.request('/api/admin/calendar/import', 'POST', { rawSource: prepared.rawSource, baseRevision: prepared.baseState.revision, requestId: prepared.requestId, usageConfirmed: true });
      const saved = await client.state();
      const matches = expected.events.every(event => {
        const actual = saved.events.find(item => item.id === event.id);
        if (!actual) return false;
        const { history: _history, ...fields } = actual;
        return canonicalJson(fields) === canonicalJson(event);
      }) && expected.sources.every(source => canonicalJson(saved.sources.find(item => item.id === source.id)) === canonicalJson(source));
      if (!Number.isSafeInteger(value.revision) || saved.revision < value.revision || !matches) throw Error('寫入回應與讀回內容不一致；保留請求供核對，不重建 requestId。');
      prepared.applied = { revision: value.revision, added: value.added, unchanged: value.unchanged, verifiedAt: now.toISOString() };
      saveJson(preparedPath, prepared);
      saveJson(resolve(directory, 'last-success.json'), { requestId: prepared.requestId, sourceHash: prepared.hash, ...prepared.applied });
      return { command, ...prepared.applied, replayed: !!value.replayed, reviewPath };
    } catch (caught) {
      if ([400, 409].includes((caught as { status?: number }).status || 0)) {
        prepared.attempted = false; saveJson(preparedPath, prepared);
      }
      throw caught;
    } finally { await client.logout().catch(() => undefined); }
  } finally { rmSync(lock, { recursive: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCalendarSync(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2)), caught => {
    // Never print request bodies, cookies, environment contents or raw network errors.
    console.error(caught instanceof Error && !/fetch failed|network|ECONN|timeout|abort/i.test(caught.message) ? caught.message : '無法連線本機日曆，保留上次資料與請求；請確認本機服務已啟動。');
    process.exitCode = 1;
  });
}
