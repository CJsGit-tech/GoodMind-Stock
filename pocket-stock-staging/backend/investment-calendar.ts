import { db, json, error, type RouterRoutes } from '@appdeploy/sdk';
import { emptyCalendar, mergeCalendar, parseCalendarBundle, type CalendarState } from '../shared/investment-calendar.ts';

type Helpers = { requireAdmin: (event: unknown, body?: unknown) => Promise<unknown>; isSameOriginMutation: (event: unknown) => boolean };
const STATE_TABLE = 'investment_calendar';
const RECEIPTS_TABLE = 'investment_calendar_receipts';
type Receipt = { owner: string; hash: string; revision: number; added: number; changed: number; unchanged: number };
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function makeInvestmentCalendarRoutes(helpers: Helpers): RouterRoutes {
  async function read() { return (await db.get<CalendarState>(STATE_TABLE, ['local'], { consistent: true }))[0] || emptyCalendar(); }
  return {
    'GET /api/calendar/events': [async () => {
      try { return json(await read()); } catch { return error('行事曆暫時無法讀取，請重試。', 503); }
    }],
    'POST /api/admin/calendar/import': [async ({ event, body }) => {
      if (!helpers.isSameOriginMutation(event)) return error('此請求來源不受允許。', 403);
      const owner = await helpers.requireAdmin(event, body);
      if (!owner) return error('請先登入作者工作區。', 401);
      const input = body as { rawSource?: unknown; baseRevision?: unknown; requestId?: unknown; usageConfirmed?: unknown } | null;
      if (typeof input?.rawSource !== 'string' || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId) || !Number.isSafeInteger(input.baseRevision) || input.usageConfirmed !== true) return error('請確認資料使用依據、請求識別與版本。', 400);
      let bundle;
      try { bundle = parseCalendarBundle(input.rawSource); } catch (caught) { return error((caught as Error).message, 400); }
      const hash = await digest(input.rawSource);
      // This application has one configured Author. Sessions rotate after login;
      // scope receipts to that authenticated role so a lost response can be
      // recovered after reconnecting, without persisting a session cookie.
      const ownerId = 'calendar-single-author';
      const sessionId = (owner as { id: string }).id;
      const requestId = input.requestId;
      try {
        const [receipt] = await db.get<Receipt>(RECEIPTS_TABLE, [requestId], { consistent: true });
        if (receipt) return receipt.hash === hash && (receipt.owner === ownerId || receipt.owner === sessionId) ? json({ ...receipt, replayed: true }) : error('請求識別已用於其他資料。', 409);
        const state = await read();
        if (state.revision !== input.baseRevision) return error('日曆版本已更新，請重新載入後再預覽匯入。', 409);
        let result;
        try { result = mergeCalendar(state, bundle, new Date().toISOString()); }
        catch (caught) { return error((caught as Error).message, 400); }
        const receiptData: Receipt = { owner: ownerId, hash, revision: result.state.revision, added: result.added, changed: result.changed, unchanged: result.unchanged };
        if (!result.updated) return json(receiptData);
        const effect = state.revision === 0
          ? db.tx.add(STATE_TABLE, [{ id: 'local', ...result.state }])
          : db.tx.update(STATE_TABLE, [{ id: 'local', record: result.state, if: { revision: state.revision } }]);
        await db.transact([effect, db.tx.add(RECEIPTS_TABLE, [{ id: requestId, ...receiptData }])]);
        return json(receiptData);
      } catch {
        // A lost response can follow a committed transaction. Reconcile the same request.
        try {
          const [receipt] = await db.get<Receipt>(RECEIPTS_TABLE, [requestId], { consistent: true });
          if (receipt?.hash === hash && (receipt.owner === ownerId || receipt.owner === sessionId)) return json({ ...receipt, replayed: true });
        } catch { /* Preserve the original request ID for a manual retry. */ }
        return error('匯入未能確認。請保留此頁，以相同請求重試；原有日曆不會被清空。', 503);
      }
    }],
  };
}
