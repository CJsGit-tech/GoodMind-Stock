// Operates the local staging UI in headless Chrome and saves JPG evidence. Start `npm run dev` first, then: npm run test:ui
// It resets the local sample data. Output: .local/evidence/*.jpg and a pass/fail line per check.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.local', 'evidence'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const BASE = process.env.STAGING_URL || 'http://localhost:5173/';
const PORT = 9341;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'ps2-ui-'))}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');

const HELP = `
const W = ms => new Promise(r => setTimeout(r, ms));
const C = async s => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) throw new Error('missing ' + s); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await W(350); };
const T = async (t, scope = '.site') => { const e = [...document.querySelectorAll(scope + ' button, ' + scope + ' a')].find(x => x.textContent.trim().includes(t) && !x.disabled); if (!e) throw new Error('no control: ' + t); await C(e); };
const TYPE = async (sel, v) => { const e = document.querySelector(sel); e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); await W(450); };
const ROW = async i => C(document.querySelectorAll('.row-head')[i]);
const TXT = s => (document.querySelector(s) || {}).textContent || '';
const SIM = async (action, extra = {}) => { const r = await fetch('/__local/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }); return r.json(); };
const GO = async h => { location.hash = h; await W(700); };
const NODE = name => [...document.querySelectorAll('.gnode')].find(n => n.getAttribute('aria-label').startsWith(name + ','));
`;
const results = [];
let size = [1440, 900];
async function view(w, h) { size = [w, h]; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); }
async function open(hash) { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url: BASE + '#' + hash }); await sleep(1300); }
async function run(js) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${HELP} ${js} })()`, awaitPromise: true, returnByValue: true });
  if (!r.result) throw new Error('page navigated away during the step');
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
  return r.result.result.value;
}
async function snap(name) { await sleep(300); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); const file = `${name}_${size[0]}x${size[1]}.jpg`; writeFileSync(path.join(out, file), Buffer.from(r.result.data, 'base64')); return file; }
/** One check: operate, compare, optionally capture. */
async function check(name, js, expect, shot) {
  try {
    const got = await run(js);
    const ok = typeof expect === 'function' ? !!expect(got) : JSON.stringify(got) === JSON.stringify(expect);
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}${shot ? '  [' + (await snap(shot)) + ']' : ''}`);
  } catch (e) { results.push(`FAIL  ${name}  error: ${e.message.split('\n')[0]}`); }
}
const DECIDE = `for (const i of [0, 1, 2, 3, 4]) { await ROW(i); await T('Confirm', '.row-open'); }`;

for (const [w, h] of [[1440, 900], [1366, 768]]) {
  await view(w, h); await open('/graph'); await run(`await SIM('reset');`); await open('/graph');
  const first = w === 1440;
  // readers
  await check('graph shows the published nodes and books', `return document.querySelectorAll('.canvas .gnode').length;`, 32, 'graph_first');
  await check('graph has no owner entry for a reader', `return !!document.querySelector('.hdr-link.owner');`, false);
  await check('selecting a node shows the peek', `await C(NODE('台積電')); return TXT('.peek-t') + '|' + TXT('.peek .muted');`, '台積電|又稱 TSMC、2330', 'graph_peek');
  await check('filter narrows the graph and clear restores it', `await T('篩選'); await TYPE('#hl', '半導體'); const dim = [...document.querySelectorAll('.gnode')].filter(n => n.getAttribute('opacity') === '0.12').length; await T('清除篩選'); const after = [...document.querySelectorAll('.gnode')].filter(n => n.getAttribute('opacity') === '0.12').length; return dim > 0 && after === 0;`, true);
  await check('filter with no match says so', `await TYPE('#hl', 'zzzz'); return TXT('.nomatch b');`, '沒有節點符合「zzzz」', first ? 'graph_no-match' : null);
  await check('peek opens the node page with focus on its heading', `await T('清除篩選'); await T('篩選'); await C(NODE('台積電')); await C('.peek-open'); await W(600); return [location.hash.startsWith('#/node/'), TXT('#main h1'), document.activeElement === document.querySelector('#main h1')];`, [true, '台積電', true], 'node_first');
  await check('node page stages books, attributes and backlinks', `const closed = [...document.querySelectorAll('.disc-btn')].every(b => b.getAttribute('aria-expanded') === 'false'); await T('屬性'); await T('反向連結'); return [closed, TXT('li.attr'), document.querySelectorAll('.back-row').length];`, [true, '產業　半導體', 2]);
  await check('neighbour peek does not move the layout and depth adds neighbours', `const y = document.querySelector('.a-rest').getBoundingClientRect().top, n1 = document.querySelectorAll('.local .gnode').length; await C([...document.querySelectorAll('.local .gnode')].find(n => !n.getAttribute('aria-label').startsWith('台積電'))); const moved = document.querySelector('.a-rest').getBoundingClientRect().top - y; const peek = !!document.querySelector('.slot-t'); await C('.anchor-bar [aria-label="Depth 2"]'); await W(500); return [moved, peek, document.querySelectorAll('.local .gnode').length > n1];`, [0, true, true], 'node_engaged');
  await check('local graph labels stay inside the graph area', `const box = document.querySelector('.local').getBoundingClientRect(); return [...document.querySelectorAll('.local text')].every(t => { const r = t.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });`, true);
  await check('library lists published books, four per page', `await GO('/library'); return [TXT('.count'), document.querySelectorAll('.book-row').length];`, ['已上架 7 / 7 冊', 4], 'library_first');
  await check('library tag filter and no-match message', `await T('篩選'); const sel = document.querySelector('#lib-tag'); sel.value = [...sel.options].find(o => o.text === '#營收認列').value; sel.dispatchEvent(new Event('change', { bubbles: true })); await W(300); const n = TXT('.count'); await TYPE('#lib-q', 'zzzz'); return [n, TXT('.wrap .muted:not(.count)')];`, v => v[0] === '已上架 3 / 7 冊' && v[1].includes('沒有符合的研究書'));
  await check('book page has one primary action and hides secondary features', `await GO('/about'); await GO('/library'); await C('.book-t a'); await W(600); return [document.querySelectorAll('#main .btn.primary').length, !!document.querySelector('.local'), TXT('#main h1')];`, [1, false, '機房裝好了，為何還不能開機？'], 'book_first');
  await check('book local graph opens on request; reading has its own address and Back returns', `await T('在圖譜中看這本書'); await W(700); const n = document.querySelectorAll('.local .gnode').length; await T('開始閱讀'); const h = location.hash; history.back(); await W(600); return [n, h.endsWith('~read'), location.hash.endsWith('~read')];`, [7, true, false]);
  await check('search finds a node by alias and opens it', `await TYPE('#search', 'tsmc'); const t = TXT('.search-results'); await C('.search-results button'); await W(500); return [t.includes('符合別名 TSMC'), TXT('#main h1')];`, [true, '台積電'], first ? null : null);
  await check('search with no match says so', `await TYPE('#search', 'zzzz'); const t = TXT('.search-results'); await TYPE('#search', ''); document.activeElement.blur(); await W(250); return t;`, '找不到符合的節點或研究書。');
  await check('unknown node and unknown book show their own messages', `await GO('/node/nope'); const a = TXT('#main h1'); await GO('/article/nope'); return [a, TXT('#main h1')];`, ['找不到這個節點', '這本書還沒上架']);
  // access
  await check('a reader opening an owner address gets the sign-in page, not a draft', `await GO('/review'); return [TXT('#main h1'), !!document.querySelector('.draft-row'), !!document.querySelector('#o-pass')];`, ['This workspace is for the owner', false, true], 'owner_denied');
  await check('a wrong password is refused', `await TYPE('#o-user', 'owner'); await TYPE('#o-pass', 'wrong'); await T('Sign in'); await W(500); return TXT('.login [role=alert]');`, 'That name or password is not right.');
  await check('agent key is refused on owner routes', `await T('Try to publish', '.menu'); await W(500); return TXT('.menu-note');`, 'Agent key on owner routes: list drafts → 401, approve → 401.');
  // owner
  await check('owner sees the waiting draft', `await T('Owner', '.menu'); await W(700); await GO('/review'); return [TXT('.draft-row b'), TXT('.draft-row small'), !!document.querySelector('.hdr-link.owner .dot')];`, ['外資買超台積電的觀察', 'Draft #12 · 0 of 7 decided', true], 'drafts_waiting');
  await check('draft review opens with approval unavailable', `await C('.draft-row'); await W(700); return [TXT('.progress'), document.querySelector('.foot-bar .btn.primary').disabled, document.querySelectorAll('.row').length];`, ['0 of 7 decided', true, 7], 'review_first');
  await check('a row opens its source and actions; rename is kept', `await ROW(4); const actions = [...document.querySelectorAll('.row-open .actions button')].map(b => b.textContent).join('|'); await T('Rename', '.row-open'); await TYPE('.inline-panel input', '外資買超（現貨）'); await T('Save name'); await W(400); return [actions, TXT('.rows li:nth-child(5) .term')];`, ['Rename|Confirm|Reject', '外資買超（現貨）'], 'review_row-open');
  await check('close match shows the existing node with its attributes', `${DECIDE} await ROW(5); await T('Review match', '.row-open'); document.querySelector('.page').scrollTo(0, 9999); return TXT('.inline-panel');`, v => v.includes('AI 伺服器') && v.includes('別名 AI server') && v.includes('Nothing links automatically'), 'review_close-match');
  await check('graph preview follows the decisions', `await T('Same node', '.inline-panel'); await ROW(6); await T('Demote to attribute', '.row-open .actions'); const p = TXT('.inline-panel p'); await T('Demote to attribute', '.inline-panel'); document.querySelector('.page').scrollTo(0, 0); await T('Preview in the graph'); await W(600); return [p.includes('所屬 = 三大法人'), [...document.querySelectorAll('.local .gnode')].map(n => n.getAttribute('aria-label').split(',')[0]).includes('AI 伺服器供應鏈'), TXT('.progress'), document.querySelector('.foot-bar .btn.primary').disabled];`, [true, false, '7 of 7 decided', false], 'review_all-decided');
  await check('a failed publish says so and keeps the decisions', `await SIM('fail-next-publish'); await T('Approve & publish'); await W(700); return [TXT('.callout .label'), TXT('.progress')];`, ['PUBLISH FAILED', '7 of 7 decided'], 'review_publish-failed');
  await check('retry publishes', `await T('Retry publishing'); await W(900); return TXT('.callout .ok');`, '✓ Published · 1 new node · graph updated', 'review_published');
  await check('the published book reads with node links', `await T('Open the book'); await W(700); const tags = TXT('.tags'); await T('開始閱讀'); await W(500); return [tags, document.querySelectorAll('.read-link').length > 3, TXT('.read-link')];`, ['#台積電#半導體#外資買超（現貨）#AI 伺服器', true, '外資買超'], 'book_reading');
  await check('the new node shows its attribute link and the graph has it', `await C('.read-link'); await W(700); const h = TXT('#main h1'); await T('屬性'); const a = TXT('li.attr'); await GO('/graph'); return [h, a, !!NODE('外資買超（現貨）'), document.querySelectorAll('.canvas .gnode').length];`, ['外資買超（現貨）', '所屬　三大法人', true, 34], 'graph_after-publish');
  await check('alias saved by Same node is searchable', `await TYPE('#search', '供應鏈'); const ok = TXT('.search-results').includes('符合別名 AI 伺服器供應鏈'); await TYPE('#search', ''); document.activeElement.blur(); await W(250); return ok;`, true);
  await check('drafts list is empty after publishing', `await GO('/review'); return [TXT('.empty h2'), TXT('.empty .muted').startsWith('Draft #12 was published.')];`, ['No drafts waiting for review', true], first ? 'drafts_empty' : null);
  // recheck, reject, discard, agent upload
  await run(`await SIM('reset');`); await open('/graph');
  await check('approval asks again when a same-name node appeared', `await T('Owner', '.menu'); await W(600); await GO('/review'); await C('.draft-row'); await W(600); ${DECIDE} await ROW(5); await T('Review match', '.row-open'); await T('New node', '.inline-panel'); await ROW(6); await T('Reject', '.row-open'); await T('Same-name node appears', '.menu'); await W(600); await T('Approve & publish'); await W(700); return [TXT('.callout .label'), TXT('.rows li:nth-child(7) .row-head').includes('✕ Rejected')];`, ['CHECKED AGAIN AT APPROVAL', true], 'review_recheck');
  await check('using the existing node publishes without a duplicate', `await T('Use the existing node'); await W(900); const ok = TXT('.callout .ok'); await GO('/graph'); return [ok, [...document.querySelectorAll('.canvas .gnode')].filter(n => n.getAttribute('aria-label').startsWith('外資買超,')).length];`, ['✓ Published · 1 new node · graph updated', 1]);
  await check('agent upload creates a private draft; sending it twice creates one', `await T('Upload twice', '.menu'); await W(700); const note = TXT('.menu-note'); await GO('/review'); await W(400); const lib = await (await fetch('/api/library')).json(); return [note, document.querySelectorAll('.draft-row').length, lib.books.some(b => b.title === '台達電的液冷訂單觀察')];`, ['Same package sent twice: draft #13, second call duplicate = true.', 1, false], 'drafts_agent-upload');
  await check('discard removes the draft', `await C('.draft-row'); await W(600); await T('More'); await T('Discard draft'); await W(600); const h = TXT('#main h1'); await T('Back to drafts'); await W(500); return [h, TXT('.empty h2')];`, ['Draft discarded', 'No drafts waiting for review'], first ? 'review_discarded' : null);
  await check('signing out hides the workspace', `await T('Sign out'); await W(600); return [TXT('#main h1'), !!document.querySelector('.hdr-link.owner')];`, ['This workspace is for the owner', false]);
  await check('about has one primary action and closed disclosures', `await GO('/about'); return [document.querySelectorAll('#main .btn.primary').length, [...document.querySelectorAll('.disc-btn')].every(b => b.getAttribute('aria-expanded') === 'false')];`, [1, true], 'about_first');
}
// widths: no sideways scroll, no small targets
await run(`await SIM('reset');`);
for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [820, 1180], [600, 900], [390, 844], [360, 740]]) {
  await view(w, h); await open('/graph');
  await check(`layout at ${w}px`, `await T('Owner', '.menu'); await W(500); const bad = []; const ids = await (await fetch('/api/library')).json(); const node = (await (await fetch('/api/graph')).json()).nodes.find(n => n.name === '營收認列').id; const draft = (await (await fetch('/api/owner/drafts')).json()).waiting[0].id;
    for (const h of ['/graph', '/node/' + node, '/article/' + ids.books[0].id, '/article/' + ids.books[0].id + '~read', '/library', '/about', '/review', '/review/' + draft]) { await GO(h);
      const page = document.querySelector('.page') || document.querySelector('.stage');
      if (document.documentElement.scrollWidth > innerWidth + 1 || page.scrollWidth > page.clientWidth + 1) bad.push(h + ' overflow');
      const small = [...document.querySelectorAll('.site a, .site button, .site select, .site input')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(e => (e.textContent || e.className).trim().slice(0, 10));
      if (small.length) bad.push(h + ' small: ' + [...new Set(small)].slice(0, 4).join(','));
      const clipped = [...document.querySelectorAll('.local text')].filter(t => { const b = t.closest('.local').getBoundingClientRect(), r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).length; if (clipped) bad.push(h + ' clipped labels ' + clipped);
    } await T('Reader', '.menu'); return bad;`, [], w === 390 ? null : null);
}
await view(390, 844); await open('/graph'); await run(`await W(300);`); results.push('      [' + (await snap('graph_phone')) + ']');
await run(`const node = (await (await fetch('/api/graph')).json()).nodes.find(n => n.name === '營收認列').id; await GO('/node/' + node);`); results.push('      [' + (await snap('node_phone')) + ']');
if (pageErrors.length) results.push('FAIL  page errors: ' + [...new Set(pageErrors)].join(' | ').slice(0, 400)); else results.push('PASS  no uncaught page errors');
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(results.join('\n') + `\n\n${results.filter(r => r.startsWith('PASS')).length} passed, ${failed} failed`);
writeFileSync(path.join(out, 'results.txt'), results.join('\n'));
ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
