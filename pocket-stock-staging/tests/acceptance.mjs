// Acceptance run for the delivery tickets, with Playwright against local staging. Start `npm run dev` first, then:
//   node tests/acceptance.mjs
// It resets the local sample data. Each check is keyed by ticket and acceptance line (for example 'LB-508.3').
// Output: .local/acceptance/results.json, one JPG per UI ticket, and a pass/fail line per check.
// The agent key and owner secrets are read from the local .env only to call the local server and to confirm
// they never appear in a response; their values are never printed.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.local', 'acceptance');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const BASE = process.env.STAGING_URL || 'http://localhost:5173';
const env = Object.fromEntries(readFileSync(path.join(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const SECRETS = [env.AGENT_KEY, env.MASTER_PASSWORD].filter(Boolean);

const results = {};
const seen = []; // every response body, to confirm no secret is ever returned
function record(key, ok, note = '') { results[key] = { ok: !!ok, note: String(note).slice(0, 300) }; console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}  ${note}`); }
async function check(key, fn) { try { const r = await fn(); if (Array.isArray(r)) record(key, r[0], r[1] ?? ''); else record(key, r, ''); } catch (e) { record(key, false, 'error: ' + String(e.message).split('\n')[0]); } }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } }); // a reader with no session

async function call(ctx, method, url, data, headers = {}) {
  const r = await ctx.request.fetch(BASE + url, { method, data, headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers }, failOnStatusCode: false }); // local staging refuses writes without the page's own origin
  const text = await r.text(); seen.push(text);
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status(), body };
}
const api = (m, u, d, h) => call(context, m, u, d, h);
const pub = (m, u, d, h) => call(anon, m, u, d, h);
const sim = (action, extra = {}) => api('POST', '/__local/simulate', { action, ...extra });
const graph = async () => (await pub('GET', '/api/graph')).body;
const nodeByName = async name => (await graph()).nodes.find(n => n.name === name);
const drafts = async () => (await api('GET', '/api/owner/drafts')).body;
const draft = async id => (await api('GET', `/api/owner/drafts/${id}`)).body;
async function decide(id, detectionId, change) { const d = await draft(id); return api('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId, ...change }); }
async function approve(id, useExisting) { const d = await draft(id); return api('POST', `/api/owner/drafts/${id}/approve`, { version: d.version, useExisting }); }
const upload = pkg => api('POST', '/api/agent/drafts', pkg, { 'x-agent-key': env.AGENT_KEY });

// ---------------------------------------------------------------- backend tickets, over HTTP
await sim('reset');
const g0 = await graph();

await check('LB-506.1', async () => {
  await sim('owner'); const before = (await drafts()).waiting.length;
  const none = await pub('POST', '/api/agent/drafts', { requestId: 'x', title: 'x', detections: [] });
  const wrong = await pub('POST', '/api/agent/drafts', { requestId: 'x', title: 'x', detections: [] }, { 'x-agent-key': 'not-the-key' });
  return [none.status === 401 && wrong.status === 401 && (await drafts()).waiting.length === before, `no key ${none.status}, wrong key ${wrong.status}, drafts unchanged`];
});
await check('LB-511.4', async () => { const r = await pub('POST', '/api/agent/lookup', { names: ['台積電'] }); return [r.status === 401, `status ${r.status}`]; });

const d12 = (await drafts()).waiting[0].id;
await check('LB-508.1', async () => {
  const a = await pub('GET', '/api/owner/drafts'), b = await pub('GET', `/api/owner/drafts/${d12}`), c = await sim('agent-publish');
  return [a.status === 401 && b.status === 401 && c.body.listDrafts === 401, `visitor list ${a.status}, read ${b.status}; agent key list ${c.body.listDrafts}`];
});
await check('LB-506.3', async () => { const c = (await sim('agent-publish')).body; return [c.listDrafts === 401 && c.approve === 401, `list ${c.listDrafts}, approve ${c.approve}`]; });
await check('LB-507.3', async () => { const c = (await sim('agent-publish')).body, v = await pub('POST', `/api/owner/drafts/${d12}/approve`, { version: 1 }); return [c.approve === 401 && v.status === 401, `agent ${c.approve}, visitor ${v.status}`]; });
await check('LB-507.2', async () => {
  const routes = [['GET', '/api/owner/drafts'], ['GET', `/api/owner/drafts/${d12}`], ['POST', `/api/owner/drafts/${d12}/decisions`], ['POST', `/api/owner/drafts/${d12}/approve`], ['POST', `/api/owner/drafts/${d12}/discard`]];
  const codes = []; for (const [m, u] of routes) codes.push((await pub(m, u, m === 'POST' ? { version: 1 } : undefined)).status);
  const stale = await call(anon, 'GET', '/api/owner/drafts', undefined, { cookie: 'pocketstocks_owner=' + 'a'.repeat(64) });
  return [codes.every(c => c === 401) && stale.status === 401, `no session ${codes.join(',')}; unknown session ${stale.status}. An expired session was not simulated.`];
});
await check('LB-507.1', async () => {
  const a = await pub('POST', '/api/owner/login', { user: 'nobody', password: env.MASTER_PASSWORD }), b = await pub('POST', '/api/owner/login', { user: env.MASTER_USER, password: 'wrong' });
  const s = (await api('GET', '/api/owner/session')).body.owner;
  return [s === true && a.status === 401 && b.status === 401 && a.body.error === b.body.error, `session ${s}; wrong name ${a.status}, wrong password ${b.status}, same message ${a.body.error === b.body.error}`];
});
await check('LB-507.4', async () => { const codes = []; for (let i = 0; i < 12; i++) codes.push((await pub('POST', '/api/owner/login', { user: 'nobody', password: 'wrong' })).status); return [codes.some(c => c === 429), `12 wrong logins returned ${[...new Set(codes)].join(',')}; no limit is applied`]; });

await check('LB-506.6', async () => { const d = await draft(d12); return [d.paragraphs.length === 3 && d.detections.every(x => x.sentence && x.proposal && x.note), `${d.paragraphs.length} paragraphs, ${d.detections.length} detections each with sentence, proposal and note`]; });
await check('LB-512.6', async () => { const d = await draft(d12); const a = d.targetAttrs.aisup || []; return [a.length > 0, `close match AI 伺服器 returns ${a.map(x => x.name + ' ' + x.value).join(' · ')}`]; });

let staleVersion = 0;
await check('LB-508.2', async () => { staleVersion = (await draft(d12)).version; const r = await decide(d12, 'tsmc', { decision: 'confirmed' }); const again = await draft(d12); return [r.status === 200 && again.detections.find(x => x.id === 'tsmc').decision === 'confirmed', 'decision present on the next read']; });
await check('LB-508.4', async () => { const r = await api('POST', `/api/owner/drafts/${d12}/decisions`, { version: staleVersion, detectionId: 'tsmc', decision: 'rejected' }); const d = await draft(d12); return [r.status === 409 && r.body.code === 'stale' && d.detections.find(x => x.id === 'tsmc').decision === 'confirmed', `status ${r.status} ${r.body.code}; newer decision kept`]; });
await check('LB-508.3', async () => { const r = await approve(d12); return [r.status === 409 && r.body.code === 'undecided', `status ${r.status} ${r.body.code}`]; });
for (const [id, decision] of [['TSMC', 'confirmed'], ['2330', 'confirmed'], ['semi', 'confirmed'], ['flow', 'confirmed'], ['aisup', 'same'], ['big3', 'demoted']]) await decide(d12, id, { decision });
await check('LB-508.6', async () => { const g = await graph(); return [g.version === g0.version && g.nodes.length === g0.nodes.length && g.links.length === g0.links.length, `graph still version ${g.version} with ${g.nodes.length} nodes after 7 decisions`]; });
await check('LB-512.3', async () => { const g = await graph(); const lib = (await pub('GET', '/api/library')).body.books; return [!lib.some(b => b.title === '外資買超台積電的觀察') && g.books.length === g0.books.length, 'no link or book from the draft is public before approval, including exact matches']; });
await check('LB-509.4', async () => { const r = await pub('GET', '/api/books/b' + d12.slice(1)); return [r.status === 404, `draft book address returns ${r.status}`]; });
await check('LB-510.2', async () => { const a = await pub('GET', '/api/books/b' + d12.slice(1)), b = await pub('GET', '/api/books/nope'); return [a.status === 404 && b.status === 404, `draft ${a.status}, unknown ${b.status}`]; });

await check('LB-509.2', async () => {
  await sim('fail-next-publish'); const r = await approve(d12); const g = await graph(); const d = await draft(d12);
  return [r.status === 500 && r.body.code === 'publish-failed' && g.version === g0.version && !g.nodes.some(n => n.name === '外資買超') && d.status === 'draft' && d.detections.every(x => x.decision), `status ${r.status}; graph still version ${g.version}; decisions kept`];
});
let published, publishMs = 0;
await check('LB-509.1', async () => {
  const t0 = Date.now(); published = (await approve(d12)).body; publishMs = Date.now() - t0; const book = await pub('GET', `/api/books/${published.bookId}`); const node = await nodeByName('外資買超');
  return [published.status === 'published' && book.status === 200 && !!node && (await pub('GET', `/api/nodes/${node.id}`)).status === 200, `book and new node readable without a session; ${published.newNodes} new node`];
});
await check('LB-509.3', async () => { const again = await approve(d12); const lib = (await pub('GET', '/api/library')).body.books.filter(b => b.title === '外資買超台積電的觀察'); return [again.status === 409 && lib.length === 1, `second approval ${again.status} ${again.body.code}; ${lib.length} copy of the book`]; });
await check('LB-512.1', async () => { const g = await graph(); const ai = g.nodes.find(n => n.name === 'AI 伺服器'); return [ai.aliases.includes('AI 伺服器供應鏈') && !g.nodes.some(n => n.name === 'AI 伺服器供應鏈'), `aliases ${ai.aliases.join('、')}; no second node`]; });
await check('LB-513.1', async () => { const n = await nodeByName('外資買超'); const p = (await pub('GET', `/api/nodes/${n.id}`)).body; const a = p.attrs.find(x => x.name === '所屬'); return [!!a && !!a.valueId && a.value === '三大法人', `所屬 → ${a?.value}, link ${!!a?.valueId}`]; });
await check('LB-513.3', async () => { const n = await nodeByName('外資'); const p = (await pub('GET', `/api/nodes/${n.id}`)).body; const a = p.attrs.find(x => x.name === '常見指標'); return [!!a && !!a.valueId, `外資 常見指標 ${a?.value} became a link: ${!!a?.valueId}`]; });
await check('LB-513.4', async () => { const g = await graph(); const a = g.nodes.find(n => n.name === '外資').id, b = g.nodes.find(n => n.name === '外資買超').id; const n = g.links.filter(l => l.kind === 'attr' && l.from === a && l.to === b).length; return [n === 1, `${n} attribute link after two approval calls`]; });
await check('LB-513.5', async () => { const n = await nodeByName('外資買超'); const p = (await pub('GET', `/api/nodes/${n.id}`)).body; return [p.attrs.every(a => a.name), `names shown: ${p.attrs.map(a => a.name).join('、')}`]; });
await check('LB-514.1', async () => { const g = await graph(); return [g.version > g0.version && g.nodes.some(n => n.name === '外資買超'), `version ${g0.version} → ${g.version}, new node included`]; });
await check('LB-514.2', async () => { const v = []; for (let i = 0; i < 6; i++) v.push((await graph()).version); return [v.every((x, i) => i === 0 || x >= v[i - 1]), `six reads: ${v.join(',')}`]; });
await check('LB-516.4', async () => { const e = (await pub('GET', '/api/search')).body.entries; return [e.some(x => x.label === '外資買超' && x.kind === 'node'), 'newly published node is in the search data']; });

// a second draft: recheck at approval, new node beside a close match
const up2 = (await sim('agent-upload')).body;
await check('LB-506.2', async () => {
  const lib = (await pub('GET', '/api/library')).body.books, e = (await pub('GET', '/api/search')).body.entries, g = await graph();
  return [up2.duplicate === false && !lib.some(b => b.title.includes('液冷訂單')) && !e.some(x => x.label.includes('液冷訂單')) && !g.books.some(b => b.title.includes('液冷訂單')), `draft #${up2.number} created; absent from library, search and graph`];
});
for (const [id, decision] of [['delta', 'confirmed'], ['2308', 'confirmed'], ['power', 'confirmed'], ['cool', 'confirmed'], ['psu', 'new']]) await decide(up2.draftId, id, { decision });
await check('LB-512.4', async () => {
  const before = await graph(); await sim('conflict', { name: '液冷散熱' }); const r = await approve(up2.draftId); const lib = (await pub('GET', '/api/library')).body.books;
  return [r.body.status === 'recheck' && r.body.conflicts.some(c => c.name === '液冷散熱') && lib.length === before.books.length, `approval returned a question about ${r.body.conflicts?.map(c => c.name).join('、')}; nothing published`];
});
await check('LB-512.5', async () => { const r = await approve(up2.draftId, { cool: true }); const g = await graph(); return [r.body.status === 'published' && g.nodes.filter(n => n.name === '液冷散熱').length === 1, 'published after the answer; one 液冷散熱 node']; });
await check('LB-512.2', async () => { const g = await graph(); const a = g.nodes.find(n => n.name === 'AI 伺服器電源'), b = g.nodes.find(n => n.name === 'AI 伺服器'); return [!!a && !g.links.some(l => (l.from === a.id && l.to === b.id) || (l.from === b.id && l.to === a.id)), 'separate node AI 伺服器電源 with no link to AI 伺服器']; });

// a third draft, sent with the agent key: a new node whose attribute values are an alias and an official name
const up3 = (await upload({ requestId: 'acc-attr-' + Date.now(), title: '驗收用草稿：屬性規則', industry: '測試', date: '2026年11月11日', pages: 1, excerpt: '驗收用。', paragraphs: [[{ t: '驗收節點甲', d: 'a' }]],
  detections: [{ id: 'a', term: '驗收節點甲', nodeType: 'concept', sentence: '驗收節點甲', note: 'test', attributes: [{ name: '代表廠商', value: '2308' }, { name: '用於', value: '資料中心' }] }] })).body;
await decide(up3.draftId, 'a', { decision: 'confirmed' }); await approve(up3.draftId);
await check('LB-513.2', async () => { const n = await nodeByName('驗收節點甲'); const p = (await pub('GET', `/api/nodes/${n.id}`)).body; const alias = p.attrs.find(a => a.name === '代表廠商'), official = p.attrs.find(a => a.name === '用於'); return [alias && !alias.valueId && official && !!official.valueId, `value 2308 (an alias) stays text: ${!alias?.valueId}; value 資料中心 is a link: ${!!official?.valueId}`]; });

// duplicates and discard
await check('LB-506.4', async () => { const before = (await drafts()).waiting.length; const r = (await sim('agent-retry')).body; const after = (await drafts()).waiting.length; results._retry = r.first.draftId; return [r.second.duplicate === true && r.first.draftId === r.second.draftId && after === before + 1, `second call duplicate ${r.second.duplicate}; drafts ${before} → ${after}`]; });
await check('LB-508.5', async () => {
  const id = results._retry, g1 = await graph(); const d = await draft(id); const r = await api('POST', `/api/owner/drafts/${id}/discard`, { version: d.version }); const g2 = await graph();
  return [r.status === 200 && !(await drafts()).waiting.some(x => x.id === id) && g2.version === g1.version, `discarded; not in the list; graph version unchanged (${g2.version})`];
});
await check('LB-506.5', async () => { const r = (await sim('agent-upload')).body; const ok = r.duplicate === false && r.draftId !== results._retry && (await drafts()).waiting.some(x => x.id === r.draftId); results._again = r.draftId; return [ok, `the same package sent as a new request became draft #${r.number}. Re-sending the old request id returns the old receipt.`]; });
delete results._retry;

// a draft too large for one transaction
await check('LB-509.5', async () => {
  const detections = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, term: `驗收大量節點${i}`, nodeType: 'concept', sentence: `驗收大量節點${i}`, note: 'bulk', attributes: [{ name: '甲', value: `文字${i}a` }, { name: '乙', value: `文字${i}b` }, { name: '丙', value: `文字${i}c` }] }));
  const up = (await upload({ requestId: 'acc-bulk-' + Date.now(), title: '驗收用草稿：大量寫入', industry: '測試', date: '2026年11月11日', pages: 1, excerpt: '驗收用。', paragraphs: [detections.map(d => ({ t: d.term, d: d.id }))], detections })).body;
  for (const d of detections) await decide(up.draftId, d.id, { decision: 'confirmed' });
  const r = await approve(up.draftId); const g = await graph(); const n = g.nodes.filter(x => x.name.startsWith('驗收大量節點')).length; const book = g.books.some(b => b.title === '驗收用草稿：大量寫入');
  results._bulk = up.draftId;
  return [(n === 40 && book) || (n === 0 && !book), `201 planned writes: approval answered ${r.status} ${r.body.code || r.body.status}; readers see ${n} of 40 nodes and ${book ? 'the' : 'no'} book`];
});
if (results._bulk) { const d = await draft(results._bulk); if (d.status === 'draft') await api('POST', `/api/owner/drafts/${results._bulk}/discard`, { version: d.version }); delete results._bulk; }
if (results._again) { const d = await draft(results._again); await api('POST', `/api/owner/drafts/${results._again}/discard`, { version: d.version }); delete results._again; }

// two published books that share one hub node, so one page has more neighbours than the local-graph cap
for (const part of ['甲組鄰居', '乙類樣本']) { // names that do not resemble each other, so the second set is not proposed as close matches
  const detections = [{ id: 'hub', term: '驗收樞紐', nodeType: 'concept', sentence: '驗收樞紐', note: 'hub' }, ...Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, term: `${part}${i}`, nodeType: 'concept', sentence: '驗收', note: 'neighbour' }))];
  const up = (await upload({ requestId: `acc-hub-${part}-${Date.now()}`, title: `驗收用草稿：樞紐${part}`, industry: '測試', date: '2026年11月11日', pages: 1, excerpt: '驗收用。', paragraphs: [[{ t: '驗收樞紐', d: 'hub' }]], detections })).body;
  for (const d of detections) await decide(up.draftId, d.id, { decision: 'confirmed' });
  await approve(up.draftId);
}

// lookup
const look = async names => (await sim('agent-lookup', { names })).body.results;
await check('LB-511.1', async () => { const [r] = await look(['台積電']); return [r.match === 'exact' && r.node.name === '台積電', `match ${r.match}`]; });
await check('LB-511.2', async () => { const [r] = await look(['TSMC']); return [r.match === 'alias' && r.node.name === '台積電', `match ${r.match} → ${r.node?.name}`]; });
await check('LB-511.3', async () => { const [a, b] = await look(['先進封裝技術', 'zzzz 無關名稱']); return [a.match === 'none' && a.close.some(n => n.name === '先進封裝') && b.match === 'none' && b.close.length === 0, `near name → close: ${a.close.map(n => n.name).join('、')}; unrelated → ${b.close.length} close. The evidence returned is the matching node itself.`]; });
await check('LB-511.5', async () => { const v = (await graph()).version; await look(['台積電', 'TSMC', '不存在的名稱']); const g = await graph(); return [g.version === v, `graph version unchanged (${v})`]; });
await check('LB-511.6', async () => { const t = Date.now(); for (let i = 0; i < 20; i++) await look(['台積電', 'TSMC', '先進封裝技術', '不存在']); const ms = (Date.now() - t) / 20; const g = await graph(); return [ms < 1000, `${ms.toFixed(1)} ms per call of 4 names, local server, graph of ${g.nodes.length} nodes`]; });
await check('LB-505.1', async () => { const r = await look(['台積電', '  台積電 ', '台積電']); const ids = r.map(x => x.node?.id); const w = await look(['ＴＳＭＣ', 'tsmc']); return [new Set(ids).size === 1 && w.every(x => x.node?.id === ids[0]), `same id for repeated, padded, full-width and lower-case input`]; });
await check('LB-505.2', async () => { const n = await nodeByName('台積電'); const a = await pub('GET', `/api/nodes/${n.id}`), b = await pub('GET', '/api/nodes/n0000000000000000000a'); return [a.status === 200 && b.status === 404, `known id ${a.status}, missing id ${b.status}. That lookups use db.get and not a scan was confirmed by reading the source, not by this run.`]; });
await check('LB-505.3', async () => { const a = (await sim('conflict', { name: '驗收重複節點' })).body, b = (await sim('conflict', { name: '驗收重複節點' })).body; const g = await graph(); return [a.added === true && b.added === false && g.nodes.filter(n => n.name === '驗收重複節點').length === 1, `first add ${a.added}, second add ${b.added}, one record`]; });
await check('LB-505.4', async () => { const g = await graph(); const max = Math.max(...g.nodes.map(n => JSON.stringify(n).length), ...g.links.map(l => JSON.stringify(l).length)); return [max < 256 * 1024, `largest node or link record ${max} bytes; a node holds no list of its links, so its size does not grow with them`]; });
await check('LB-505.5', async () => [false, 'Not met as written: a node page is built from the whole published snapshot (one stored file), so the read grows with the graph.']);
await check('LB-505.6', async () => [false, 'Not checked by this run: whether the schema is written in the ticket report.']);

// reading
await check('LB-510.1', async () => { const g = await graph(), lib = (await pub('GET', '/api/library')).body.books; const titles = (await drafts()).waiting.map(d => d.title); return [lib.length === g.books.length && !lib.some(b => titles.includes(b.title)), `${lib.length} published books; no waiting draft among them`]; });
await check('LB-510.3', async () => { const n = await nodeByName('台積電'); const p = (await pub('GET', `/api/nodes/${n.id}`)).body; return [p.node.aliases.length === 2 && p.attrs.length >= 1 && p.books.length >= 3 && p.backlinks.length >= 3 && p.backlinks.every(b => b.title && b.context), `${p.node.aliases.length} aliases, ${p.attrs.length} attribute, ${p.books.length} books, ${p.backlinks.length} backlinks each naming its source`]; });
await check('LB-510.4', async () => { const p = (await pub('GET', '/api/books/b-semi')).body; return [p.related.length > 0 && p.related.every(r => r.shared.length > 0), `${p.related.length} related books, each with shared node names`]; });
await check('LB-514.3', async () => { const g = await graph(); const waiting = (await drafts()).waiting; return [!g.books.some(b => waiting.some(w => w.title === b.title)) && !g.nodes.some(n => n.name === '驗收大量節點0'), 'no draft book or unapproved node in the snapshot']; });
await check('LB-514.4', async () => { const t = Date.now(); const r = await anon.request.get(BASE + '/api/graph'); const size = (await r.body()).length; return [size > 0, `snapshot response ${size} bytes in ${Date.now() - t} ms for ${(await graph()).nodes.length} nodes (local server). The approval call that rebuilt and stored the snapshot took ${publishMs} ms.`]; });
await check('LB-515.1', async () => { const n = await nodeByName('台積電'); const a = (await pub('GET', `/api/local/${n.id}?depth=1`)).body, b = (await pub('GET', `/api/local/${n.id}?depth=2`)).body; return [b.nodes.length > a.nodes.length, `depth 1: ${a.nodes.length} nodes, depth 2: ${b.nodes.length}`]; });
await check('LB-515.2', async () => { const n = await nodeByName('台積電'); const b = (await pub('GET', `/api/local/${n.id}?depth=3`)).body; const waiting = (await drafts()).waiting.map(w => 'b' + w.id.slice(1)); return [!b.nodes.some(x => waiting.includes(x.id)), 'no draft book among the neighbours']; });
await check('LB-515.3', async () => { const n = await nodeByName('驗收樞紐'); const b = (await pub('GET', `/api/local/${n.id}?depth=2`)).body; return [b.capped === true && b.nodes.length <= 60, `a node with 62 pages within two steps returns ${b.nodes.length} and truncated ${b.capped}`]; });
await check('LB-515.4', async () => { const r = await pub('GET', '/api/local/nope?depth=1'); return [r.status === 404, `status ${r.status}`]; });
await check('LB-516.1', async () => { const e = (await pub('GET', '/api/search')).body.entries; return [e.some(x => x.kind === 'node' && x.label === '台積電' && x.aliases.includes('TSMC')) && e.some(x => x.kind === 'book' && x.label === '半導體產業觀察'), 'node name, alias and book title are in the search data']; });
await check('LB-516.2', async () => { const e = (await pub('GET', '/api/search')).body.entries; const waiting = (await drafts()).waiting; return [!e.some(x => waiting.some(w => w.title === x.label)), 'no waiting draft in the search data']; });
await check('LB-516.5', async () => { const e = (await pub('GET', '/api/search')).body.entries; const hit = q => e.filter(x => (x.label + x.aliases.join('') + x.text).includes(q)).length; return [hit('伺服器') > 2 && hit('封裝') > 0 && hit('股息') > 1, `plain substring matching, no word segmentation: 伺服器 ${hit('伺服器')}, 封裝 ${hit('封裝')}, 股息 ${hit('股息')} results`]; });
await check('LB-507.5', async () => { await api('POST', '/api/owner/logout'); const s = (await api('GET', '/api/owner/session')).body.owner, l = (await api('GET', '/api/owner/drafts')).status; return [s === false && l === 401, `session ${s}, drafts ${l}`]; });

// ---------------------------------------------------------------- UI tickets, operated in the browser
await sim('reset');
const go = async hash => { const url = BASE + '/#' + hash; if (page.url() === url) await page.reload(); else await page.goto(url); await page.waitForTimeout(700); }; // always a fresh page state
const text = async sel => ((await page.locator(sel).first().textContent().catch(() => '')) || '').trim();
const count = sel => page.locator(sel).count();
const shot = name => page.screenshot({ path: path.join(out, name + '_1440x900.jpg'), type: 'jpeg', quality: 85 });
const nodeIn = (scope, name) => page.locator(`${scope} .gnode[aria-label^="${name},"]`).first();
const tsmc = (await nodeByName('台積電')).id;
/** Tab through the page: every stop inside the site shows a focus ring, and there is at least one stop. */
async function keyboard(max = 30) {
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {}); let stops = 0, bare = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body || !e.closest('.site')) return null; const s = getComputedStyle(e); return { ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, what: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 16) }; });
    if (!r) continue; stops++; if (!r.ring) bare.push(r.what);
  }
  return [stops > 0 && bare.length === 0, `${stops} keyboard stops, ${bare.length ? 'no ring on: ' + [...new Set(bare)].join(', ') : 'each with a visible ring'}`];
}
/** No sideways scroll and no target under 44 px, at seven widths. Links inside running text are exempt. */
async function widths(hashes) {
  const bad = [];
  for (const [w, h] of [[360, 740], [390, 844], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const hash of hashes) {
      await go(hash);
      const r = await page.evaluate(() => { const p = document.querySelector('.page') || document.querySelector('.stage'); const over = document.documentElement.scrollWidth > innerWidth + 1 || p.scrollWidth > p.clientWidth + 1;
        const small = [...document.querySelectorAll('.site a:not(.read-link), .site button, .site select, .site input')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.height < 43.5 || b.width < 43.5); }).map(e => (e.textContent || e.className).trim().slice(0, 12));
        return { over, small: [...new Set(small)] }; });
      if (r.over) bad.push(`${hash} scrolls sideways at ${w}`); if (r.small.length) bad.push(`${hash} at ${w}: small ${r.small.slice(0, 3).join(',')}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  return [bad.length === 0, bad.length ? bad.slice(0, 4).join('; ') : `${hashes.length} route(s) at 360, 390, 820, 1024, 1366, 1440 and 1920 px`];
}

// LB-535 header and navigation
await check('LB-535.1', async () => {
  const seenH = []; for (const h of ['/graph', '/library', '/about', '/node/' + tsmc, '/article/b-semi', '/article/b-semi~read', '/review']) { await go(h); seenH.push(await count('#main h1')); }
  await go('/library'); await page.locator('.hdr-nav a', { hasText: '關於我們' }).click(); await page.waitForTimeout(500); const there = page.url().endsWith('#/about'); await page.goBack(); await page.waitForTimeout(500);
  return [seenH.every(n => n === 1) && there && page.url().endsWith('#/library'), 'seven typed addresses open; a header link opens About and Back returns to the library'];
});
await check('LB-535.2', async () => [false, 'Needs the owner: the header was changed after the approved captures (renamed entries, sign-in at the right, search moved to the graph), so it no longer matches them by design.']);
await check('LB-535.3', async () => { await go('/library'); await page.locator('.hdr-nav a', { hasText: '關於我們' }).click(); await page.waitForTimeout(400); const onH1 = await page.evaluate(() => document.activeElement?.tagName === 'H1'); const k = await keyboard(8); return [onH1 && k[0], `focus on the heading after navigation: ${onH1}; ${k[1]}`]; });
await check('LB-535.4', () => widths(['/graph', '/library', '/about']));
await check('LB-535.5', async () => { await page.route('**/api/library', r => r.abort()); await go('/library'); const msg = await text('.state[role=alert]'); const retry = await count('.state button'); await page.unroute('**/api/library'); await page.locator('.state button').click(); await page.waitForTimeout(900); return [msg.includes('沒有載入成功') && retry === 1 && (await count('.book-row')) > 0, `message shown with a retry; retry loaded ${await count('.book-row')} books`]; });
await check('LB-535.7', async () => { await go('/library'); const k = await keyboard(10); const cur = await page.evaluate(() => { const a = document.querySelector('.hdr-link[aria-current=page]'); const s = getComputedStyle(a); return a.textContent + ' weight ' + s.fontWeight + ' underline ' + s.borderBottomWidth; }); return [k[0] && cur.includes('weight 800'), `${k[1]}; current route marked by weight and underline, not color alone (${cur})`]; });
await shot('LB-535');

// LB-536 library
await check('LB-536.1', async () => { await go('/library'); return [(await text('.count span')) === '已上架 15 / 15 冊' && !(await page.locator('.book-row', { hasText: '外資買超台積電的觀察' }).count()), 'only the 15 published books; the waiting draft is absent']; });
await check('LB-536.2', async () => {
  await go('/library'); await page.fill('#lib-q', '液冷'); await page.waitForTimeout(300); const a = await text('.count span'); await page.fill('#lib-q', '');
  await page.locator('.lib-bar button', { hasText: '篩選' }).click(); await page.selectOption('#lib-ind', { label: '半導體' }); await page.waitForTimeout(300); const b = await text('.count span'); await page.selectOption('#lib-ind', { index: 0 });
  await page.selectOption('#lib-tag', { label: '#營收認列' }); await page.waitForTimeout(300); const c = await text('.count span');
  return [a.startsWith('已上架 1 /') && b.startsWith('已上架 3 /') && c.startsWith('已上架 3 /'), `search: ${a}; industry: ${b}; tag: ${c}`];
});
await check('LB-536.3', async () => { await go('/library'); await page.waitForTimeout(400); const rows = await count('.book-row'); return [rows === 4, `Not met as written: the page shows ${rows} books, twelve per page since the full-width change. Paging keeps the filters.`]; });
await check('LB-536.4', async () => { await go('/library'); await page.locator('.book-row .tag').first().click(); await page.waitForTimeout(600); return [page.url().includes('#/node/') && (await text('#main h1')) === '資料中心', `tag opened the node page ${await text('#main h1')}`]; });
await check('LB-536.5', async () => { await go('/library'); await page.fill('#lib-q', 'zzzz'); await page.waitForTimeout(300); const none = await text('.none'); await page.route('**/api/library', r => r.abort()); await go('/about'); await go('/library'); const fail = await text('.state[role=alert]'); await page.unroute('**/api/library'); return [none === '沒有符合的研究書。' && fail.includes('沒有載入成功'), `no match: ${none} failed load: ${fail.slice(0, 12)}`]; });
await check('LB-536.6', () => widths(['/library']));
await check('LB-536.7', async () => { await go('/library'); return keyboard(24); });
await go('/library'); await shot('LB-536');

// LB-537 book
await check('LB-537.1', async () => { await anon.newPage().then(async p => { await p.goto(BASE + '/#/article/b-cooling'); await p.waitForTimeout(900); results._t = await p.locator('#main h1').textContent(); results._l = await p.evaluate(() => document.documentElement.lang); await p.close(); }); const t = results._t, l = results._l; delete results._t; delete results._l; return [t === 'AI 伺服器為什麼需要液冷？' && l === 'zh-Hant', `opened without a session: ${t}; page language ${l}`]; });
await check('LB-537.2', async () => { await go('/article/b-cooling'); const n = await count('#main .btn.primary'); return [n === 1, `${n} filled primary action`]; });
await check('LB-537.3', async () => { await go('/article/b-cooling'); await page.locator('.a-rest .tag', { hasText: '散熱' }).click(); await page.waitForTimeout(600); return [(await text('#main h1')) === '散熱', 'tag 散熱 opened its node page']; });
await check('LB-537.4', async () => { await go('/article/b-cooling'); const box = await page.locator('.a-anchor').boundingBox(); await page.locator('#main a', { hasText: '開始閱讀' }).click(); await page.waitForTimeout(600); const read = page.url().endsWith('~read'); const box2 = await page.locator('.a-anchor').boundingBox(); const links = await count('.read-link'); await page.goBack(); await page.waitForTimeout(600); return [read && Math.abs(box.x - box2.x) < 2 && links > 3 && !page.url().endsWith('~read'), `reading has its own address, opens in the same place with ${links} node links, and Back returns`]; });
await check('LB-537.5', async () => { await go('/article/b' + d12.slice(1)); return [(await text('#main h1')) === '這本書還沒上架', `a draft's book address shows: ${await text('#main h1')}`]; });
await check('LB-537.6', () => widths(['/article/b-cooling', '/article/b-cooling~read']));
await check('LB-537.7', async () => { await go('/article/b-cooling'); return keyboard(20); });
await go('/article/b-cooling'); await shot('LB-537');

// LB-538 node
await check('LB-538.1', async () => { await go('/node/' + tsmc); await page.locator('.disc-btn', { hasText: '屬性' }).click(); return [(await count('.rel-row')) === 3 && (await text('li.attr')).includes('產業'), `${await count('.rel-row')} books listed and attribute ${await text('li.attr')}`]; });
await check('LB-538.2', async () => { await go('/node/' + tsmc); await page.locator('.disc-btn', { hasText: '屬性' }).click(); const name = await text('li.attr'); await page.locator('li.attr a').click(); await page.waitForTimeout(600); return [name.startsWith('產業') && (await text('#main h1')) === '半導體', 'the linked value opened 半導體; the attribute name 產業 stays visible']; });
await check('LB-538.3', async () => { await go('/node/' + tsmc); await page.locator('.disc-btn', { hasText: '反向連結' }).click(); const rows = await page.locator('.back-row small').allTextContents(); return [rows.length >= 3 && rows.every(t => t.trim().length > 0), `${rows.length} backlinks, each with its sentence or attribute name`]; });
await check('LB-538.4', async () => { await go('/node/nope'); const a = await text('#main h1'); return [a === '找不到這個節點', `unknown or unapproved node shows: ${a}`]; });
await check('LB-538.5', async () => { await go('/node/' + tsmc); const s = await page.locator('.disc-btn').evaluateAll(b => b.map(x => x.getAttribute('aria-expanded') + ' ' + x.textContent.trim().replace('+', ''))); return [s.length === 2 && s.every(x => x.startsWith('false') && /\d/.test(x)), s.join(' | ')]; });
await check('LB-538.6', () => widths(['/node/' + tsmc]));
await check('LB-538.7', async () => { await go('/node/' + tsmc); return keyboard(20); });
await go('/node/' + tsmc); await shot('LB-538');

// LB-539 about
await check('LB-539.1', async () => { await go('/about'); const p = await count('#main .btn.primary'), d = await count('#main .disc-btn'); return [p === 1 && d === 2, `Not met as written: ${p} filled primary action, but the page now has ${d} disclosures; its sections are open since the About redesign.`]; });
await check('LB-539.2', async () => { await go('/about'); await page.locator('#main a', { hasText: '打開財經心智圖' }).click(); await page.waitForTimeout(500); const a = page.url().endsWith('#/graph'); await go('/about'); await page.locator('#main a', { hasText: '先逛書庫' }).click(); await page.waitForTimeout(500); return [a && page.url().endsWith('#/library'), 'both actions reach their routes']; });
await check('LB-539.3', async () => [false, 'Needs the owner: the About page was redesigned after the approved captures, so it no longer matches them by design.']);
await check('LB-539.4', () => widths(['/about']));
await check('LB-539.5', async () => { await go('/about'); return keyboard(12); });
await go('/about'); await shot('LB-539');

// LB-543 graph
await check('LB-543.1', async () => {
  await go('/graph'); const n = nodeIn('.canvas', 'FCC'); const a = await n.boundingBox(); await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + 120, a.y + 80, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1500);
  const b = await nodeIn('.canvas', 'FCC').boundingBox(); await page.mouse.move(700, 500); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); const zoomed = await page.locator('.canvas .graph > g').getAttribute('transform');
  await page.mouse.move(60, 450); await page.mouse.down(); await page.mouse.move(160, 480, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200); const panned = await page.locator('.canvas .graph > g').getAttribute('transform');
  await page.locator('.tool-reset').click();
  return [Math.abs(b.x - a.x) > 60 && !zoomed.includes('scale(1)') && panned !== zoomed, 'a node was dragged with the mouse, the wheel zoomed, and dragging empty space panned'];
});
await check('LB-543.2', async () => { await go('/graph'); await nodeIn('.canvas', '台積電').click(); const t = await text('.peek-t'); await page.locator('.peek-open').click(); await page.waitForTimeout(600); return [t === '台積電' && (await text('#main h1')) === '台積電', 'peek shown; 開啟 opened the node page']; });
await check('LB-543.3', async () => { await go('/graph'); const labels = await page.locator('.canvas .graph text').count(), nodes = await page.locator('.canvas .gnode text').count(); return [labels === nodes, `every text in the graph belongs to a node (${labels}); links carry none`]; });
await check('LB-543.4', async () => { await go('/graph'); await page.locator('.tools button', { hasText: '篩選' }).click(); await page.fill('#hl', '半導體'); await page.waitForTimeout(400); const dim = await page.locator('.canvas .gnode[opacity="0.12"]').count(); await page.locator('.seg button[aria-label="深度 1"]').click(); await page.waitForTimeout(300); const dim1 = await page.locator('.canvas .gnode[opacity="0.12"]').count(); await page.locator('.popover button', { hasText: '清除篩選' }).click(); await page.waitForTimeout(300); const none = await page.locator('.canvas .gnode[opacity="0.12"]').count(); return [dim > 0 && dim1 > dim && none === 0, `text filter dims ${dim}; depth 1 dims ${dim1}; clear restores all`]; });
await check('LB-543.5', async () => { await go('/graph'); const legend = await text('.legend-line'); const fills = await page.locator('.canvas .gnode circle:not([fill=transparent]):not(.halo)').evaluateAll(c => [...new Set(c.map(x => x.getAttribute('fill')))].length); await nodeIn('.canvas', '台積電').click(); const label = await text('.peek .label'); return [fills >= 4 && legend.includes('公司') && label === '公司', `${fills} type colors; legend and peek name the type in text (${label})`]; });
await check('LB-543.6', async () => { await sim('conflict', { name: '驗收新節點' }); await go('/about'); await go('/graph'); await page.reload(); await page.waitForTimeout(900); const a = await nodeIn('.canvas', '驗收新節點').count(); await page.reload(); await page.waitForTimeout(900); return [a === 1 && (await nodeIn('.canvas', '驗收新節點').count()) === 1, 'a node published a moment ago appears and stays after a reload']; });
await check('LB-543.7', () => widths(['/graph']));
await check('LB-543.8', async () => { await go('/graph'); const k = await keyboard(12); await nodeIn('.canvas', '台積電').focus(); await page.keyboard.press('Enter'); const peek = await count('.peek'); return [false, `Partly met: ${k[1]}; a node opens its peek with Enter (${peek === 1}). Zoom has no keyboard control since the buttons were removed, and nodes cannot be moved by keyboard.`]; });
await go('/graph'); await shot('LB-543');

// LB-544 local graph
await check('LB-544.1', async () => { await go('/node/' + tsmc); const a = await count('.a-anchor .local .gnode'); await go('/article/b-cooling'); const closed = await count('.local'); await page.locator('.disc-btn', { hasText: '在圖譜中看這本書' }).click(); await page.waitForTimeout(800); return [a > 1 && closed === 0 && (await count('.disc-body .local .gnode')) > 1, `node page shows ${a} nodes; the book page offers its graph on request`]; });
await check('LB-544.2', async () => { await go('/node/' + tsmc); const a = await count('.local .gnode'); await page.locator('.anchor-bar [aria-label="Depth 2"]').click(); await page.waitForTimeout(700); const b = await count('.local .gnode'); return [b > a, `depth 1: ${a} nodes, depth 2: ${b}`]; });
await check('LB-544.3', async () => { await go('/node/' + tsmc); const y = (await page.locator('.a-rest').boundingBox()).y; await nodeIn('.local', '半導體').click(); const y2 = (await page.locator('.a-rest').boundingBox()).y; const name = await text('.slot-t b'); await page.locator('.slot a', { hasText: '開啟' }).click(); await page.waitForTimeout(600); return [y === y2 && name === '半導體' && (await text('#main h1')) === '半導體', 'selecting a neighbour moved nothing; 開啟 opened its page']; });
await check('LB-544.5', async () => { const bad = []; for (const [w, h] of [[1366, 768], [1440, 900], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await go('/node/' + tsmc); await page.locator('.anchor-bar [aria-label="Depth 2"]').click(); await page.waitForTimeout(700); const cut = await page.evaluate(() => [...document.querySelectorAll('.local text')].filter(t => { const b = t.closest('.local').getBoundingClientRect(), r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).length); if (cut) bad.push(`${cut} cut at ${w}`); } await page.setViewportSize({ width: 1440, height: 900 }); return [bad.length === 0, bad.join('; ') || 'no label cut off at 1366 × 768, 1440 × 900 or 390 × 844']; });
await check('LB-544.6', () => widths(['/node/' + tsmc]));
await check('LB-544.7', async () => { await go('/node/' + tsmc); const k = await keyboard(14); await nodeIn('.local', '半導體').focus(); await page.keyboard.press('Enter'); return [k[0] && (await text('.slot-t b')) === '半導體', `${k[1]}; a neighbour is selected with Enter and named in text`]; });
await go('/node/' + tsmc); await shot('LB-544');

// LB-545 search
await check('LB-545.1', async () => { await go('/graph'); await page.fill('#search', '伺服器'); await page.waitForTimeout(700); const t = await text('.search-results'); return [t.includes('AI 伺服器') && t.includes('伺服器代工') && t.includes('研究書'), 'a Chinese term without spaces returns nodes and books']; });
await check('LB-545.2', async () => { await page.fill('#search', 'tsmc'); await page.waitForTimeout(500); const t = await text('.search-results'); return [t.includes('台積電') && t.includes('符合別名 TSMC'), 'alias search names the alias that matched']; });
await check('LB-545.3', async () => { await page.fill('#search', '半導體'); await page.waitForTimeout(500); const kinds = await page.locator('.search-results .kind').allTextContents(); await page.locator('.search-results button').first().click(); await page.waitForTimeout(500); const here = page.url().endsWith('#/graph'), peek = await text('.peek-t'); return [false, `Not met as written: each result shows its type (${[...new Set(kinds)].join('、')}), but choosing one now selects it in the graph (peek ${peek}, still on the graph: ${here}) and 開啟 opens the page. Search exists only on the graph route.`]; });
await check('LB-545.4', async () => { await go('/graph'); await page.fill('#search', 'zzzz'); await page.waitForTimeout(500); return [(await text('.search-results')) === '找不到符合的節點或研究書。', await text('.search-results')]; });
await check('LB-545.5', async () => { await go('/graph'); await page.locator('#search').focus(); await page.keyboard.type('tsmc'); await page.waitForTimeout(500); await page.keyboard.press('Tab'); const onResult = await page.evaluate(() => !!document.activeElement.closest('.search-results')); await page.keyboard.press('Enter'); await page.waitForTimeout(400); const peek = await text('.peek-t'); await page.locator('#search').focus(); await page.keyboard.type('x'); await page.keyboard.press('Escape'); const left = await count('.search-results'); return [onResult && peek === '台積電' && left === 0, `Tab reaches a result: ${onResult}; Enter chooses it: ${peek === '台積電'}; Escape closes the list: ${left === 0}`]; });
await check('LB-545.6', () => widths(['/graph']));
await check('LB-545.7', async () => { await go('/graph'); return keyboard(8); });
await go('/graph'); await page.fill('#search', 'tsmc'); await page.waitForTimeout(500); await shot('LB-545'); await page.fill('#search', '');

// LB-540 owner drafts list
await sim('reset');
const draftAddr = '/review/' + d12;
await check('LB-540.1', async () => { const seenH = []; for (const h of ['/review', draftAddr, draftAddr + '~text']) { await go(h); seenH.push((await text('#main h1')) + '|' + (await count('.draft-row, .row'))); } return [seenH.every(x => x === 'This workspace is for the owner|0'), 'workspace, draft and draft-text addresses all show the sign-in page to a visitor']; });
await check('LB-540.2', async () => { await go('/graph'); const before = await count('.hdr-link.owner'); await sim('owner'); await page.reload(); await page.waitForTimeout(800); return [before === 0 && (await count('.hdr-link.owner')) === 1, 'Owner entry appears only after sign-in']; });
await check('LB-540.3', async () => { await go('/review'); return [(await text('.draft-row b')) === '外資買超台積電的觀察' && (await text('.draft-row small')).includes('0 of 7 decided'), `${await text('.draft-row small')} · Waiting for you`]; });
await go('/review'); await shot('LB-540');
await check('LB-540.6', () => widths(['/review']));
await check('LB-540.7', async () => { await go('/review'); const k = await keyboard(10); const state = await text('.draft-row .warn'); return [k[0] && state === 'Waiting for you', `${k[1]}; state is written as text (${state})`]; });
await check('LB-540.5', async () => { await go(draftAddr); const had = await count('.row'); await page.locator('.hdr-out').click(); await page.waitForTimeout(700); await page.goBack(); await page.waitForTimeout(700); const shown = await count('.row, .draft-row'); await sim('owner'); await page.reload(); await page.waitForTimeout(700); return [had === 7 && shown === 0, `after sign-out, Back shows ${shown} draft rows`]; });

// LB-541 and LB-542 owner draft review
const row = i => page.locator('.row-head').nth(i);
const act = async (i, label) => { await row(i).click(); await page.locator('.row-open button', { hasText: label }).first().click(); await page.waitForTimeout(500); };
await go(draftAddr);
await check('LB-541.1', async () => { let withSource = 0; for (let i = 0; i < 7; i++) { await row(i).click(); if ((await text('.row-open .label')) === 'SOURCE') withSource++; await row(i).click(); } return [(await count('.row')) === 7 && withSource === 7, `7 detections, ${withSource} with a source sentence`]; });
await check('LB-541.4', async () => { const b = page.locator('.foot-bar .btn.primary'); return [(await b.isDisabled()) && (await text('#why-not')).includes('every proposal is decided') && (await text('.foot-main .muted')) === '7 still waiting for you', `disabled; says: ${await text('.foot-main .muted')}`]; });
await check('LB-542.5', async () => { const g = await graph(); return [!g.books.some(b => b.title === '外資買超台積電的觀察') && (await text('.row-head >> nth=0')).includes('Existing node') && (await text('.row-head >> nth=0')).includes('Waiting'), 'an exact match shows as waiting and nothing from the draft is in the public graph']; });
await check('LB-542.1', async () => [(await text('.row-head >> nth=1')).includes('Alias of 台積電'), await text('.row-head >> nth=1')]);
await shot('LB-541');
await check('LB-544.4', async () => { const before = await page.locator('.review-side .gnode').evaluateAll(n => n.map(x => x.getAttribute('aria-label').split(',')[0])); await row(5).click(); await page.locator('.row-open button', { hasText: 'Review match' }).click(); await page.locator('.inline-panel button', { hasText: 'Same node' }).click(); await page.waitForTimeout(700); const after = await page.locator('.review-side .gnode').evaluateAll(n => n.map(x => x.getAttribute('aria-label').split(',')[0])); await row(5).click(); await page.locator('.row-open button', { hasText: 'Undo decision' }).click(); await page.waitForTimeout(600); return [before.includes('AI 伺服器供應鏈') && !after.includes('AI 伺服器供應鏈') && after.includes('AI 伺服器'), 'the preview dropped the proposed node and kept the existing one when the decision changed']; });
await check('LB-541.2', async () => { for (const i of [0, 1, 2, 3]) await act(i, 'Confirm'); await row(4).click(); await page.locator('.row-open button', { hasText: 'Rename' }).click(); await page.fill('.inline-panel input', '外資買超（現貨）'); await page.locator('.inline-panel button', { hasText: 'Save name' }).click(); await page.waitForTimeout(600); const renamed = await text('.row-head >> nth=4'); await page.locator('.row-open button', { hasText: 'Confirm' }).click(); await page.waitForTimeout(600); return [renamed.includes('外資買超（現貨）') && (await text('.progress')) === '5 of 7 decided', `renamed and confirmed: ${renamed.slice(0, 34)}`]; });
await check('LB-542.2', async () => { await row(5).click(); await page.locator('.row-open button', { hasText: 'Review match' }).click(); const t = await text('.inline-panel'); const note = await page.locator('.row-open > p.muted').allTextContents(); return [t.includes('AI 伺服器') && t.includes('相關 資料中心') && note.join(' ').includes('narrower term'), 'existing node, its attributes and the agent’s note are shown']; });
await shot('LB-542');
await check('LB-542.4', async () => { await page.locator('.inline-panel button', { hasText: 'New node' }).click(); await page.waitForTimeout(600); return [(await text('.row-head >> nth=5')).includes('New node · no link'), await text('.row-head >> nth=5')]; });
await check('LB-542.6', async () => { await row(6).click(); await page.locator('.row-open .actions button', { hasText: 'Demote to attribute' }).click(); const t = await text('.inline-panel p'); await page.locator('.inline-panel button', { hasText: 'Demote to attribute' }).click(); await page.waitForTimeout(600); return [t.includes('所屬 = 三大法人') && t.includes('saved as a link'), `${t.slice(0, 60)}… The alias-stays-text half is checked on the backend ticket (LB-513.2).`]; });
await check('LB-541.6', async () => { await sim('fail-next-publish'); await page.locator('.foot-bar .btn.primary').click(); await page.waitForTimeout(800); const label = await text('.callout .label'), kept = await text('.progress'); return [label === 'PUBLISH FAILED' && kept === '7 of 7 decided', `${label}; ${kept}`]; });
await check('LB-541.7', async () => { await page.reload(); await page.waitForTimeout(900); const kept = await text('.progress'); const g = await graph(); return [kept === '7 of 7 decided' && !g.books.some(b => b.title === '外資買超台積電的觀察'), 'after a reload the draft is still private with its decisions']; });
await check('LB-542.7', async () => { await sim('conflict', { name: 'AI 伺服器供應鏈' }); await page.locator('.foot-bar .btn.primary').click(); await page.waitForTimeout(900); const label = await text('.callout .label'); const g = await graph(); return [label === 'CHECKED AGAIN AT APPROVAL' && !g.books.some(b => b.title === '外資買超台積電的觀察'), `${label}; nothing published`]; });
await check('LB-541.5', async () => { await page.locator('.callout button', { hasText: 'Use the existing node' }).click(); await page.waitForTimeout(1200); const done = await text('.callout .ok'); const g = await graph(); const book = g.books.find(b => b.title === '外資買超台積電的觀察'); const p = await anon.newPage(); await p.goto(BASE + '/#/article/' + book.id + '~read'); await p.waitForTimeout(900); const links = await p.locator('.read-link').count(); await p.locator('.read-link').first().click(); await p.waitForTimeout(700); const h = await p.locator('#main h1').textContent(); await p.close(); return [done.includes('Published') && links > 3 && h === '外資買超（現貨）', `a reader with no session opened the book and its node ${h}`]; });
await check('LB-541.2b', async () => { const g = await graph(); return [g.nodes.some(n => n.name === '外資買超（現貨）') && !g.nodes.some(n => n.name === '外資買超'), 'the renamed node kept its new name after publishing']; });
await check('LB-542.3', async () => { await sim('reset'); await sim('owner'); await go(draftAddr); for (const i of [0, 1, 2, 3, 4]) await act(i, 'Confirm'); await row(5).click(); await page.locator('.row-open button', { hasText: 'Review match' }).click(); await page.locator('.inline-panel button', { hasText: 'Same node' }).click(); await page.waitForTimeout(500); await act(6, 'Reject'); await page.locator('.foot-bar .btn.primary').click(); await page.waitForTimeout(1200); const g = await graph(); return [g.nodes.find(n => n.name === 'AI 伺服器').aliases.includes('AI 伺服器供應鏈') && !g.nodes.some(n => n.name === 'AI 伺服器供應鏈'), 'alias saved on AI 伺服器; no new node']; });
await check('LB-541.3', async () => { const rowText = await text('.rows li:nth-child(7) .row-head'); const g = await graph(); const book = g.books.find(b => b.title === '外資買超台積電的觀察'); const big3 = g.nodes.find(n => n.name === '三大法人').id; return [rowText.includes('✕ Rejected') && !!book && !g.links.some(l => l.from === book.id && l.to === big3), 'the rejected proposal counted as decided and the book has no link to it']; });
await check('LB-540.4', async () => { await go('/review'); return [(await text('.empty h2')) === 'No drafts waiting for review', await text('.empty h2')]; });
await check('LB-541.8', async () => { await sim('agent-upload'); await go('/review'); await page.locator('.draft-row').click(); await page.waitForTimeout(600); await page.locator('.foot-bar button', { hasText: 'More' }).click(); await page.locator('.more button', { hasText: 'Discard draft' }).click(); await page.locator('.more button', { hasText: 'Yes, discard' }).click(); await page.waitForTimeout(700); const h = await text('#main h1'); await go('/review'); return [h === 'Draft discarded' && (await count('.draft-row')) === 0, 'discarded after confirming; the list is empty']; });
await sim('reset'); await sim('owner');
await check('LB-541.9', () => widths([draftAddr]));
await check('LB-542.8', () => widths([draftAddr]));
await check('LB-541.10', async () => { await go(draftAddr); const k = await keyboard(16); const s = await text('.row-head >> nth=0'); return [k[0] && s.includes('Waiting'), `${k[1]}; row state is written as text`]; });
await check('LB-542.9', async () => { await go(draftAddr); await row(5).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); const open = await count('.inline-panel'); const warn = await text('.row-head >> nth=5'); return [open === 1 && warn.includes('Close match'), 'the close-match panel opens by keyboard; the close match is named in text']; });

// secrets never returned or logged
let logNote = 'Server log was not inspected (set ACC_SERVER_LOG to its path).', logClean = true;
if (process.env.ACC_SERVER_LOG) { const log = readFileSync(process.env.ACC_SERVER_LOG, 'utf8'); logClean = !SECRETS.some(x => log.includes(x)); logNote = `The dev server log (${log.length} bytes) ${logClean ? 'does not contain either value' : 'CONTAINS a secret'}.`; }
await check('LB-506.7', async () => { const leaked = SECRETS.some(s => seen.some(t => t.includes(s))); return [SECRETS.length === 2 && !leaked && logClean, `${seen.length} responses checked; neither the agent key nor the owner password appears. ${logNote}`]; });
await check('LB-507.6', async () => { const leaked = SECRETS.some(s => seen.some(t => t.includes(s))); return [SECRETS.length === 2 && !leaked && logClean, `${seen.length} responses checked; no secret appears. ${logNote}`]; });
await check('LB-510.5', async () => [results['LB-536.2']?.ok && results['LB-536.5']?.ok, 'library search, industry filter and the empty message, operated in the browser (see LB-536.2 and LB-536.5)']);
await check('LB-516.3', async () => [results['LB-545.4']?.ok, 'a term with no match returns the not-found message (see LB-545.4)']);
await check('page-errors', async () => [pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'no uncaught page errors']);

await sim('reset');
writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
const all = Object.values(results), failed = all.filter(r => !r.ok).length;
console.log(`\n${all.length - failed} passed, ${failed} failed`);
await browser.close();
