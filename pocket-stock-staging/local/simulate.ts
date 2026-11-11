// Local staging only. Stands in for things that belong to AppDeploy or to an outside caller:
// switching test accounts without typing the owner password, an agent calling with its secret key,
// another publication changing the graph, and a publish that fails. None of this ships.
import { db, error, json } from './sdk.ts';
import type { RouterResponse } from './sdk.ts';
import { handler } from '../backend/index.ts';
import { T, meta, nodeId, rebuildSnapshot, resetCache } from '../backend/store.ts';
import { seedIfEmpty } from '../backend/seed.ts';
import type { DraftPackage } from '../shared/graph.ts';

const call = (event: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<RouterResponse> =>
  handler({ ...event, headers: { ...event.headers, ...headers }, rawPath: path, rawQueryString: '', body: body === undefined ? '' : JSON.stringify(body), requestContext: { http: { method } } });
const agent = () => ({ 'x-agent-key': process.env.AGENT_KEY! });
const samplePackage = (): DraftPackage => ({
  requestId: 'local-sim-' + Date.now(), title: '台達電的液冷訂單觀察', industry: 'AI資料中心與電力設備', date: new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }), pages: 9,
  excerpt: '示範草稿：台達電（2308）的電力設備與液冷散熱訂單，如何跟著 AI 伺服器電源需求變化。',
  paragraphs: [
    [{ t: '台達電', d: 'delta' }, { t: '（' }, { t: '2308', d: '2308' }, { t: '）的' }, { t: '電力設備', d: 'power' }, { t: '訂單持續成長。' }],
    [{ t: '液冷散熱', d: 'cool' }, { t: '成為新機房的標準配備，' }, { t: 'AI 伺服器電源', d: 'psu' }, { t: '的規格也跟著提高。' }],
  ],
  detections: [
    { id: 'delta', term: '台達電', nodeType: 'company', sentence: '台達電（2308）的電力設備訂單持續成長。', note: 'Official name of an existing company node' },
    { id: '2308', term: '2308', nodeType: 'company', sentence: '台達電（2308）', note: 'Alias of 台達電' },
    { id: 'power', term: '電力設備', nodeType: 'concept', sentence: '台達電（2308）的電力設備訂單持續成長。', note: 'Official name of an existing concept node' },
    { id: 'cool', term: '液冷散熱', nodeType: 'concept', sentence: '液冷散熱成為新機房的標準配備。', note: 'Nothing in the graph resembles it',
      attributes: [{ name: '用於', value: '資料中心' }, { name: '代表廠商', value: '2308' }] },
    { id: 'psu', term: 'AI 伺服器電源', nodeType: 'concept', sentence: 'AI 伺服器電源的規格也跟著提高。', note: 'A component of AI servers, not the servers themselves' },
  ],
});

export async function simulate(event: any, input: any): Promise<RouterResponse> {
  await seedIfEmpty();
  switch (input?.action) {
    case 'owner': return call(event, 'POST', '/api/owner/login', { user: process.env.MASTER_USER, password: process.env.MASTER_PASSWORD });
    case 'reader': return call(event, 'POST', '/api/owner/logout');
    case 'agent-upload': return call(event, 'POST', '/api/agent/drafts', samplePackage(), agent());
    case 'agent-retry': { // the same package twice: one draft, the second call returns the first receipt
      const pkg = samplePackage();
      const first = await call(event, 'POST', '/api/agent/drafts', pkg, agent()), second = await call(event, 'POST', '/api/agent/drafts', pkg, agent());
      return json({ first: JSON.parse(first.body), second: JSON.parse(second.body) });
    }
    case 'agent-lookup': return call(event, 'POST', '/api/agent/lookup', { names: Array.isArray(input.names) ? input.names : ['台積電', 'TSMC', 'AI 伺服器供應鏈', '液冷散熱'] }, agent());
    case 'agent-publish': { // what happens when the agent key tries owner routes
      const drafts = await call({ ...event, headers: {} }, 'GET', '/api/owner/drafts', undefined, agent());
      const approve = await call({ ...event, headers: {} }, 'POST', '/api/owner/drafts/any/approve', { version: 1 }, agent());
      return json({ listDrafts: drafts.statusCode, approve: approve.statusCode });
    }
    case 'fail-next-publish': process.env.KG_FAIL_NEXT_PUBLISH = '1'; return json({ ok: true });
    case 'conflict': { // another publication adds a node with this official name after the agent's lookup
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '外資買超';
      const [added] = await db.tx.add(T.nodes, [{ id: nodeId(name), name, type: 'concept', aliases: [] }]);
      if (added) { const m = (await meta())!; await rebuildSnapshot(m.version, true); await db.tx.update(T.meta, [{ id: 'graph', record: { version: m.version + 1 } }], { patch: true }); }
      return json({ ok: true, name, added: !!added });
    }
    case 'reset': {
      for (const table of Object.values(T)) {
        let nextToken: string | undefined;
        do { const page = await db.list(table, { limit: 500, nextToken }); if (page.items.length) await db.delete(table, page.items.map(i => i.id)); nextToken = page.nextToken; } while (nextToken);
      }
      resetCache(); delete process.env.KG_FAIL_NEXT_PUBLISH; await seedIfEmpty();
      return { ...json({ ok: true }), headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'pocketstocks_owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' } };
    }
    default: return error('Unknown simulation.', 400);
  }
}
