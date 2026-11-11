// Backend behavior against the local AppDeploy stand-in. Run: npm run test:backend
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.POCKETSTOCKS_LOCAL_ORIGIN = 'http://localhost:5173';
process.env.POCKETSTOCKS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps2-test-'));
Object.assign(process.env, { ADMIN_MASTER_SECRET: 'test-signing', MASTER_USER: 'owner', MASTER_PASSWORD: 'test-password', AGENT_KEY: 'test-agent-key' });
const { handler } = await import('../backend/index.ts');
const { simulate } = await import('../local/simulate.ts');
const { nodeId } = await import('../backend/store.ts');

type Res = { status: number; data: any; cookie?: string };
async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const [rawPath, rawQueryString = ''] = path.split('?');
  const r = await handler({ headers, rawPath, rawQueryString, body: body === undefined ? '' : JSON.stringify(body), requestContext: { http: { method } } });
  return { status: r.statusCode, data: JSON.parse(r.body), cookie: r.headers['Set-Cookie']?.split(';')[0] };
}
const sim = async (action: string, extra = {}) => JSON.parse((await simulate({ headers: {} }, { action, ...extra })).body);
const AGENT = { 'x-agent-key': 'test-agent-key' };
let OWNER: Record<string, string> = {};
async function fresh() {
  await sim('reset');
  const login = await req('POST', '/api/owner/login', { user: 'owner', password: 'test-password' });
  OWNER = { cookie: login.cookie! };
  const { data } = await req('GET', '/api/owner/drafts', undefined, OWNER);
  return data.waiting[0].id as string;
}
const draft = async (id: string) => (await req('GET', `/api/owner/drafts/${id}`, undefined, OWNER)).data;
async function decideAll(id: string, choices: Record<string, string>) {
  for (const [detectionId, decision] of Object.entries(choices)) {
    const d = await draft(id);
    const r = await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId, decision }, OWNER);
    assert.equal(r.status, 200, `${detectionId}: ${r.data.error}`);
  }
}
const ALL = { tsmc: 'confirmed', TSMC: 'confirmed', '2330': 'confirmed', semi: 'confirmed', flow: 'confirmed', aisup: 'new', big3: 'demoted' };
const approve = async (id: string, extra = {}) => req('POST', `/api/owner/drafts/${id}/approve`, { version: (await draft(id)).version, ...extra }, OWNER);
const graph = async () => (await req('GET', '/api/graph')).data;
const names = (g: any) => g.nodes.map((n: any) => n.name);

before(async () => { await fresh(); });

test('readers see the seeded graph and nothing from the waiting draft', async () => {
  const g = await graph();
  assert.equal(g.nodes.length, 50); assert.equal(g.books.length, 15);
  const page = (await req('GET', '/api/books/b-cooling')).data;
  assert.ok(page.book.sample && page.paragraphs.length === 3 && page.paragraphs[1].some((seg: any) => seg.n), 'a sample book reads with node links');
  assert.ok(!names(g).includes('外資買超'));
  const lib = (await req('GET', '/api/library')).data.books;
  assert.ok(!lib.some((b: any) => b.title === '外資買超台積電的觀察'));
  const search = (await req('GET', '/api/search')).data.entries;
  assert.ok(!search.some((e: any) => e.label.includes('外資買超')));
  assert.equal((await req('GET', '/api/books/nope')).status, 404);
});

test('the agent key can look up and upload, and nothing else', async () => {
  assert.equal((await req('POST', '/api/agent/lookup', { names: ['台積電'] })).status, 401);
  assert.equal((await req('POST', '/api/agent/lookup', { names: ['台積電'] }, { 'x-agent-key': 'wrong' })).status, 401);
  const { results } = (await req('POST', '/api/agent/lookup', { names: ['台積電', 'tsmc', 'AI 伺服器供應鏈', '外資買超', '液冷散熱'] }, AGENT)).data;
  assert.deepEqual(results.map((r: any) => r.match), ['exact', 'alias', 'none', 'none', 'none']);
  assert.equal(results[1].node.name, '台積電');
  assert.equal(results[2].close[0].name, 'AI 伺服器');
  assert.equal(results[3].close.length, 0); assert.equal(results[4].close.length, 0);
  const retry = await sim('agent-retry');
  assert.equal(retry.first.duplicate, false); assert.equal(retry.second.duplicate, true); assert.equal(retry.first.draftId, retry.second.draftId);
  assert.equal(retry.first.number, 13);
  assert.equal((await req('GET', '/api/owner/drafts', undefined, AGENT)).status, 401);
  assert.equal((await req('POST', '/api/owner/drafts/x/approve', { version: 1 }, AGENT)).status, 401);
  assert.equal((await req('POST', '/api/agent/drafts', { requestId: 'x' }, AGENT)).status, 400);
});

test('only the signed-in owner reaches drafts', async () => {
  const id = await fresh();
  assert.equal((await req('GET', '/api/owner/drafts')).status, 401);
  assert.equal((await req('GET', `/api/owner/drafts/${id}`)).status, 401);
  assert.equal((await req('POST', '/api/owner/login', { user: 'owner', password: 'nope' })).status, 401);
  const d = await draft(id);
  assert.equal(d.number, 12);
  assert.deepEqual(d.detections.map((x: any) => x.proposal), ['existing', 'alias', 'alias', 'existing', 'new', 'close', 'existing']);
  assert.equal(d.detections[5].targetName, 'AI 伺服器');
  assert.ok(d.targetAttrs.aisup.some((a: any) => a.name === '別名'));
  assert.ok(d.preview.nodes.some((n: any) => n.name === '外資買超' && n.ghost));
  await req('POST', '/api/owner/logout', undefined, OWNER);
  assert.equal((await req('GET', '/api/owner/drafts', undefined, OWNER)).status, 401);
});

test('decisions are validated, versioned and required before approval', async () => {
  const id = await fresh();
  assert.equal((await approve(id)).data.code, 'undecided');
  const d = await draft(id);
  assert.equal((await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'tsmc', decision: 'same' }, OWNER)).status, 400);
  assert.equal((await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'TSMC', decision: 'demoted' }, OWNER)).status, 400);
  assert.equal((await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'tsmc', rename: 'X' }, OWNER)).status, 400);
  assert.equal((await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'tsmc', decision: 'confirmed' }, OWNER)).status, 200);
  const stale = await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'semi', decision: 'confirmed' }, OWNER);
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'stale');
  assert.equal((await draft(id)).detections.find((x: any) => x.id === 'semi').decision, undefined);
});

test('approval publishes the book, nodes, alias and attribute links together', async () => {
  const id = await fresh();
  const before = await graph();
  await decideAll(id, { ...ALL, aisup: 'same' });
  const r = await approve(id);
  assert.equal(r.data.status, 'published'); assert.equal(r.data.newNodes, 1);
  const g = await graph();
  assert.equal(g.version, before.version + 1);
  assert.ok(names(g).includes('外資買超')); assert.ok(!names(g).includes('AI 伺服器供應鏈'));
  assert.ok(g.nodes.find((n: any) => n.name === 'AI 伺服器').aliases.includes('AI 伺服器供應鏈'));
  const flow = (await req('GET', `/api/nodes/${nodeId('外資買超')}`)).data;
  assert.deepEqual(flow.attrs.map((a: any) => [a.name, a.value, !!a.valueId]), [['所屬', '三大法人', true]]);
  assert.equal(flow.books.length, 1);
  assert.ok(flow.backlinks.some((b: any) => b.context === '常見指標 = 外資買超'), 'a plain-text attribute became a link when its node was published');
  const fi = (await req('GET', `/api/nodes/${nodeId('外資')}`)).data;
  assert.ok(fi.attrs.some((a: any) => a.name === '常見指標' && a.valueId === nodeId('外資買超')));
  const big3 = (await req('GET', `/api/nodes/${nodeId('三大法人')}`)).data;
  assert.ok(big3.backlinks.some((b: any) => b.context === '所屬 = 三大法人' && b.title === '外資買超'));
  assert.ok(!big3.books.some((b: any) => b.id === r.data.bookId), 'a demoted detection is not a mention');
  assert.ok(!g.links.some((l: any) => l.from === nodeId('外資買超') && l.to === nodeId('AI 伺服器')), 'same-node creates no link between the two');
  const book = (await req('GET', `/api/books/${r.data.bookId}`)).data;
  assert.deepEqual(book.tags.map((t: any) => t.name).sort(), ['AI 伺服器', '半導體', '台積電', '外資買超'].sort());
  assert.equal(book.paragraphs[0][0].n, nodeId('外資買超'));
  assert.ok(book.related.length > 0);
  const search = (await req('GET', '/api/search')).data.entries;
  assert.ok(search.some((e: any) => e.kind === 'book' && e.text.includes('籌碼資料')));
  const list = (await req('GET', '/api/owner/drafts', undefined, OWNER)).data;
  assert.equal(list.waiting.length, 0); assert.equal(list.last.status, 'published');
  assert.equal((await approve(id)).data.code, 'closed');
});

test('a close match marked new, a rename and a rejection', async () => {
  const id = await fresh();
  const d = await draft(id);
  await req('POST', `/api/owner/drafts/${id}/decisions`, { version: d.version, detectionId: 'flow', rename: '外資買超（現貨）' }, OWNER);
  await decideAll(id, { ...ALL, semi: 'rejected', big3: 'rejected' });
  const r = await approve(id);
  assert.equal(r.data.newNodes, 2);
  const g = await graph();
  assert.ok(names(g).includes('外資買超（現貨）')); assert.ok(names(g).includes('AI 伺服器供應鏈')); assert.ok(!names(g).includes('外資買超'));
  const book = (await req('GET', `/api/books/${r.data.bookId}`)).data;
  assert.ok(!book.tags.some((t: any) => t.name === '半導體' || t.name === '三大法人'), 'rejected detections add nothing');
  assert.ok(!g.links.some((l: any) => [l.from, l.to].includes(nodeId('AI 伺服器供應鏈')) && [l.from, l.to].includes(nodeId('AI 伺服器'))));
});

test('approval asks again when a same-name node appeared after the upload', async () => {
  const id = await fresh();
  await decideAll(id, ALL);
  await sim('conflict', { name: '外資買超' });
  const r = await approve(id);
  assert.equal(r.data.status, 'recheck'); assert.equal(r.data.conflicts[0].detectionId, 'flow');
  assert.ok(!(await req('GET', '/api/library')).data.books.some((b: any) => b.title === '外資買超台積電的觀察'));
  const ok = await approve(id, { useExisting: { flow: true } });
  assert.equal(ok.data.status, 'published'); assert.equal(ok.data.newNodes, 1);
  assert.equal(names(await graph()).filter((n: string) => n === '外資買超').length, 1);
});

test('a failed publish shows nothing and keeps the decisions', async () => {
  const id = await fresh();
  await decideAll(id, ALL);
  const v = (await graph()).version;
  await sim('fail-next-publish');
  const failed = await approve(id);
  assert.equal(failed.status, 500); assert.equal(failed.data.code, 'publish-failed');
  const g = await graph();
  assert.equal(g.version, v); assert.ok(!names(g).includes('外資買超'));
  const d = await draft(id);
  assert.equal(d.status, 'draft'); assert.equal(d.detections.filter((x: any) => x.decision).length, 7);
  assert.equal((await approve(id)).data.status, 'published');
});

test('discard removes the draft and changes nothing public', async () => {
  const id = await fresh();
  const v = (await graph()).version;
  const d = await draft(id);
  assert.equal((await req('POST', `/api/owner/drafts/${id}/discard`, { version: d.version }, OWNER)).data.status, 'discarded');
  const list = (await req('GET', '/api/owner/drafts', undefined, OWNER)).data;
  assert.equal(list.waiting.length, 0); assert.equal(list.last.status, 'discarded');
  assert.equal((await graph()).version, v);
});

test('attribute values link only on an official name, and the local graph grows with depth', async () => {
  await fresh();
  const up = await sim('agent-upload');
  const d = await draft(up.draftId);
  assert.deepEqual(d.detections.map((x: any) => x.proposal), ['existing', 'alias', 'existing', 'new', 'close']);
  await decideAll(up.draftId, { delta: 'confirmed', '2308': 'confirmed', power: 'confirmed', cool: 'confirmed', psu: 'new' });
  assert.equal((await approve(up.draftId)).data.status, 'published');
  const cool = (await req('GET', `/api/nodes/${nodeId('液冷散熱')}`)).data;
  assert.deepEqual(cool.attrs.map((a: any) => [a.name, a.value, !!a.valueId]), [['用於', '資料中心', true], ['代表廠商', '2308', false]]);
  const d1 = (await req('GET', `/api/local/${nodeId('營收認列')}?depth=1`)).data, d2 = (await req('GET', `/api/local/${nodeId('營收認列')}?depth=2`)).data;
  assert.equal(d1.nodes.length, 4); assert.ok(d2.nodes.length > d1.nodes.length); assert.equal(d1.capped, false);
  assert.equal((await req('GET', '/api/local/nope')).status, 404);
});
