import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Real UI, real HTTP and SQLite; all writes target a disposable local database.
const root = new URL('../../', import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'pocketstocks-ui-'));
const evidenceDir = process.env.POCKETSTOCKS_UI_EVIDENCE_DIR;
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://localhost:${port}`;
const secret = randomBytes(32).toString('base64url');
process.env.POCKETSTOCKS_DATA_DIR = dataDir;
process.env.POCKETSTOCKS_LOCAL_ORIGIN = origin;
process.env.ADMIN_MASTER_SECRET = secret;
const { seedDemo } = await import('../seed-demo.mjs');
const { db } = await import('../sdk.ts');
await seedDemo({ omitIndex: 10 });
const { seedReport } = await import('../../shared/etf-seed.ts');
const { makeEtfRoutes } = await import('../../backend/etf-reports.ts');
const reportRoutes = makeEtfRoutes({ requireAdmin: async () => ({ id: 'disposable-local-test' }), isSameOriginMutation: () => true });
async function reportCall(path, body) {
  for (const handler of reportRoutes['POST /api/admin/etf-reports/' + path]) {
    const r = await handler({ body, params: {}, query: {}, event: {} });
    if (r) { assert.ok(r.statusCode < 400, r.body); return; }
  }
}
await reportCall('save', { report: seedReport, baseRevision: 0, requestId: 'local-ui-report-save' });
await reportCall('publish', { id: seedReport.id, baseRevision: 1, requestId: 'local-ui-report-publish', reviewed: true });
for (let i = 1; i <= 5; i++) {
  const report = {...seedReport, id: 'local-catalog-' + i, title: '可拋棄分析 ' + i};
  await reportCall('save', {report, baseRevision:0, requestId:'catalog-save-' + i});
  await reportCall('publish', {id:report.id, baseRevision:1, requestId:'catalog-publish-' + i, reviewed:true});
}
db.close();
let child, browser, page;
const passed = [], pageErrors = [];
const role = (name, kind = 'button') => page.getByRole(kind, { name, exact: true });
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 15000 }); }
async function absent(locator) { await locator.waitFor({ state: 'hidden', timeout: 15000 }); }
async function check(name, fn) { await fn(); passed.push(name); console.log('PASS ' + name); }
async function shot(name) { if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); await page.locator('img').evaluateAll(imgs => Promise.all(imgs.filter(img => { const r=img.getBoundingClientRect(); return r.width && r.height && r.top < innerHeight && r.bottom > 0; }).map(img => Promise.race([img.decode(), new Promise(resolve => setTimeout(resolve, 2000))]).catch(() => {})))); await page.screenshot({ path: join(evidenceDir, name + '.jpg'), type: 'jpeg', quality: 88 }); } }
async function goto(hash) { await page.goto(origin + '/#' + hash); }
async function signin(reader = 'A') {
  await role('開啟登入選單').click(); await page.getByRole('button', {name: /^讀者登入/}).click();
  await role('使用測試讀者 ' + reader).click();
  await absent(page.getByRole('dialog', { name: '本機測試讀者登入', exact: true }));
}
async function account(action) { const trigger = page.getByRole('button', {name: /讀者帳號選單/}); if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click(); await role(action).click(); }
async function api(path, method = 'GET', data) {
  const r = await page.request.fetch(origin + path, { method, headers: { Origin: origin }, data });
  assert.ok(r.ok(), `${method} ${path}: HTTP ${r.status()}`); return r.json();
}
try {
  child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], { cwd: root, env: { ...process.env, PORT: String(port), POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stderr.on('data', c => { diagnostics += c; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/_healthcheck')).ok) break; } catch {} if (child.exitCode !== null) throw Error(diagnostics); await delay(100); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(12000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await goto('/');
  const first = page.getByRole('link', { name: /^開啟研究：/ }).first(); await visible(first);
  const bookHash = (await first.getAttribute('href')).slice(1); const bookId = bookHash.split('/').at(-1);
  await check('US-01–04 library/search/filters/no-results and recovery', async () => {
    await role('搜尋已上架研究', 'searchbox').fill('nonexistent-local-qa');
    await visible(page.getByRole('heading', { name: '找不到相關研究', exact: true }));
    await role('清除搜尋文字').click(); await visible(first);
    await role('產業篩選', 'combobox').click(); await page.getByRole('listbox', {name:'產業篩選'}).getByRole('option').nth(1).click();
    await role('產業篩選', 'combobox').click(); await page.getByRole('listbox', {name:'產業篩選'}).getByRole('option').nth(0).click();
    await first.click(); await role('開始閱讀').click();
    await page.getByRole('region', { name: '研究頁面閱讀區' }).getByRole('img').evaluate(img => img.decode());
    await role('下一頁').click(); await page.waitForURL(/page-2/);
    await page.keyboard.press('ArrowLeft'); await page.waitForURL(/page-1/);
  });
  await check('US-05 anonymous reader comment and return context', async () => {
    await role('新增留言').click(); await role('留言內容', 'textbox').fill('可拋棄本機匿名測試留言');
    await role('顯示名稱', 'textbox').fill('本機匿名測試');
    await page.getByRole('dialog').getByRole('button', { name: /發布|送出/ }).click();
    await absent(page.getByRole('dialog')); assert.match(page.url(), /page-1/);
    await role('討論吧').click(); await visible(page.getByText('可拋棄本機匿名測試留言', { exact: true }));
    assert.equal(await role('留言', 'textbox').count(), 0);
    await page.goBack(); await visible(role('新增留言'));
  });
  await check('US-10–14 local sign-in return, favorite and persistence', async () => {
    await role('返回研究書').click(); await page.getByRole('button', { name: /^登入並收藏研究/ }).click();
    await role('使用測試讀者 A').click(); await absent(page.getByRole('dialog'));
    await visible(page.getByRole('button', { name: /^從收藏移除：/ }));
    await page.reload(); await visible(page.getByRole('button', { name: /^從收藏移除：/ }));
    await account('我的收藏'); await visible(page.getByRole('heading', { name: '我的書庫', exact: true }));
    await shot('reader-favorites-1366');
  });
  await check('US-12–13 retained private review edit and My Comments inventory', async () => {
    await api('/api/reader/reviews/' + bookId, 'PUT', { text: '既有私人測試評論', baseVersion: 0, baseUpdatedAt: null, mutationId: 'local-ui-review-seed' });
    await goto('/my-library/reviews'); await visible(page.getByText('既有私人測試評論', { exact: true }));
    await page.getByRole('button', { name: /編輯/ }).first().click();
    await role('評論內容', 'textbox').fill('更新後私人測試評論');
    await role('更新評論').click(); await visible(page.getByText('更新後私人測試評論', { exact: true }).first());
  });
  await check('US-15–16 private forms validation, submit and receipt', async () => {
    await goto('/reader/suggestions'); await role('送出建議').click();
    assert.equal(await page.getByRole('textbox').getAttribute('aria-invalid'), 'true');
    await page.getByRole('textbox').fill('本機測試建議：希望研究能保留不同期間的資料來源。'); await role('送出建議').click();
    await visible(page.getByRole('heading', { name: '建議已送出，謝謝你的分享。' }));
    await goto('/reader/research-interest');
    await page.getByLabel(/聯絡 Email/).fill('local-test@example.invalid');
    await page.getByLabel('標的 1', {exact:true}).fill('測試公司 QA01');
    await role('送出需求').click();
    await page.getByRole('checkbox').check(); await role('送出需求').click();
    await visible(page.getByRole('heading', { name: '研究需求已收到，謝謝你的分享。' }));
  });
  await check('US-17–19 owned public comment independent from favorites', async () => {
    await goto(bookHash); await role('討論吧').click();
    await visible(page.getByText('可拋棄本機匿名測試留言', { exact: true }));
    await role('顯示名稱', 'textbox').fill('本機讀者A'); await role('留言', 'textbox').fill('可拋棄本機帳號留言');
    await page.getByRole('button', { name: /發表留言/ }).click(); await visible(page.getByText('可拋棄本機帳號留言', { exact: true }));
    await goto('/my-library/reviews'); await visible(page.getByText('可拋棄本機帳號留言', { exact: true }));
    await account('登出讀者帳號'); await signin('B'); await goto('/my-library/reviews');
    assert.equal(await page.getByText('更新後私人測試評論', { exact: true }).count(), 0);
    assert.equal(await page.getByText('可拋棄本機帳號留言', { exact: true }).count(), 0);
    await goto('/my-library'); assert.equal(await page.getByRole('link', { name: /^開啟研究：/ }).count(), 0);
    await account('登出讀者帳號');
    await signin('A'); await goto('/my-library/reviews');
    const ownedDelete = page.getByRole('button', { name: /^刪除公開留言：/ });
    await ownedDelete.click(); await role('保留留言').click();
    await ownedDelete.click(); await page.getByRole('dialog').getByRole('button', { name: '確認刪除', exact: true }).click();
    await absent(page.getByRole('dialog')); await absent(ownedDelete);
    await page.getByRole('button', { name: /^刪除評論：/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '確認刪除', exact: true }).click();
    await goto('/my-library/reviews'); await absent(page.getByText('更新後私人測試評論', { exact: true }));
    await goto('/my-library'); await page.getByRole('button', { name: /^移除收藏：/ }).click();
    await absent(page.getByRole('button', { name: /^移除收藏：/ })); await account('登出讀者帳號');
  });
  await check('US-06–09 author sign-in, create, upload, save, preview, publish', async () => {
    await goto('/admin'); await visible(page.getByLabel('作者密鑰')); await page.getByLabel('作者密鑰').fill(secret); await role('登入').click();
    await visible(role('建立新書')); await page.reload(); await visible(role('建立新書'));
    await role('建立新書').click();
    await page.getByLabel('書名 *', { exact: false }).fill('可拋棄本機功能測試研究');
    await role('公開書庫').click(); await visible(page.getByRole('alertdialog'));
    assert.equal(await role('繼續編輯').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await absent(page.getByRole('alertdialog'));
    assert.equal(await page.getByLabel('書名 *', { exact: false }).inputValue(), '可拋棄本機功能測試研究');
    await page.getByLabel('書籍簡介 *', { exact: false }).fill('完整流程使用的虛構研究書，測試結束會隨隔離資料庫刪除。');
    await page.getByLabel('產業類別 *', { exact: false }).fill('本機測試');
    await page.getByLabel('預計發布日期 *', { exact: false }).fill('2026-10-15');
    await role('儲存草稿').click();
    await page.getByLabel('上傳研究頁面圖片').setInputFiles(new URL('../../src/assets/library-hero-v6.jpg', import.meta.url).pathname);
    await page.getByPlaceholder('描述圖片內容與研究重點').fill('本機測試用書籍與桌面圖片。');
    await role('儲存草稿').click(); await page.waitForFunction(() => document.querySelector('.editor-state-badge')?.textContent.includes('已儲存'));
    await role('預覽').click(); await visible(page.getByRole('img', { name: /本機測試用書籍/ }));
    await page.getByRole('button', { name: /返回編輯/ }).click(); await role('發布研究書').click();
    await page.getByRole('dialog').getByRole('button', { name: '確認發布', exact: true }).click();
    await visible(role('下架後編輯')); await shot('author-published-1366');
    await role('下架後編輯').click(); await page.getByRole('dialog').getByRole('button', { name: '確認下架', exact: true }).click();
    await visible(role('發布研究書'));
    await role('研究書目').click();
    const deleteBook = role('刪除 可拋棄本機功能測試研究');
    await deleteBook.click(); await page.keyboard.press('Escape'); await absent(page.getByRole('dialog'));
    await deleteBook.click(); await page.getByLabel('請輸入 DELETE 以確認永久刪除').fill('DELETE');
    await page.getByRole('dialog').getByRole('button', { name: '確認刪除', exact: true }).click();
    await absent(deleteBook);
  });
  await check('US-01/06 recover catalog and author-session read failures', async () => {
    await page.route(/\/api\/articles(?:\?|$)/, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled local test failure' }) }));
    await goto('/'); await page.reload(); await visible(page.getByRole('button', { name: /重試/ }).first());
    await page.unroute(/\/api\/articles(?:\?|$)/); await page.getByRole('button', { name: /重試/ }).first().click();
    await visible(page.getByRole('link', { name: /^開啟研究：/ }).first());
    await page.route('**/api/admin/session/validate', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled local test failure' }) }));
    await goto('/admin'); await page.reload(); await visible(page.getByText('暫時無法確認作者工作階段。請重試，或稍後返回。', { exact: true }));
    assert.equal(await role('建立新書').count(), 0);
    await page.unroute('**/api/admin/session/validate'); await page.getByRole('button', { name: /重試/ }).first().click();
    await visible(role('建立新書'));
  });
  await check('US-18 author reads private feedback', async () => {
    await goto('/admin/reader-feedback'); await visible(page.getByRole('heading', { name: '讀者回饋', exact: true }));
    await role('意見箱').click(); await page.locator('.author-feedback-list').getByRole('button').first().click();
    await visible(page.getByText('本機測試建議：希望研究能保留不同期間的資料來源。', { exact: true }).first());
    await role('研究需求').click(); await page.locator('.author-feedback-list').getByRole('button').first().click();
    await visible(page.getByText('local-test@example.invalid', { exact: true })); await shot('author-feedback-1366');
  });
  await check('US-21/24 ETF library catalog search, filters, persistence and retired history', async () => {
    await goto('/active-etf/history?dataset=synthetic');
    await page.waitForURL(origin + '/#/active-etf');
    assert.equal(await role('歷史追蹤', 'link').count(), 0);
    assert.equal(await role('ETF 測試資料', 'link').count(), 0);
    const reports = page.getByRole('link', { name: /^開啟 ETF 分析：/ });
    await visible(reports.first()); assert.equal(await reports.count(), 4);
    await role('下一頁分析').click(); assert.equal(await reports.count(), 2);
    await page.reload(); await visible(reports.first()); assert.equal(await reports.count(), 2);
    assert.ok(page.url().includes('page=2')); await role('上一頁分析').click();
    assert.equal(await role('搜尋 ETF 分析').count(), 0, 'Search does not require a separate submit button');
    await role('搜尋 ETF 分析', 'searchbox').fill('找不到的本機ETF研究');
    await visible(page.getByRole('heading', {name:'找不到相關分析',exact:true}));
    await role('清除 ETF 搜尋文字').click(); await visible(reports.first());
    await role('研究月份篩選', 'combobox').click();
    await page.getByRole('listbox', { name: '研究月份篩選', exact: true }).getByRole('option').nth(1).click();
    await role('ETF 報告排序', 'combobox').press('ArrowDown');
    await role('ETF 報告排序', 'combobox').press('End');
    await role('ETF 報告排序', 'combobox').press('Enter');
    await page.reload(); await visible(reports.first());
    assert.equal(await role('ETF 報告排序', 'combobox').innerText(), '最早發布');
    await role('ETF 報告排序', 'combobox').press('Space');
    await role('ETF 報告排序', 'combobox').press('Home');
    await role('ETF 報告排序', 'combobox').press('Escape');
    assert.equal(await role('ETF 報告排序', 'combobox').innerText(), '最早發布', 'Escape does not commit the active option');
    assert.equal(await role('ETF 報告排序', 'combobox').evaluate(node => node === document.activeElement), true);
    for (const [width,height] of [[1366,768],[1440,900]]) {
      await page.setViewportSize({width,height}); await shot('etf-catalog-' + width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await reports.first().click(); await visible(role('分析總結','tab')); await role('返回報告列表').click();
    await visible(reports.first()); assert.ok(page.url().includes('sort=oldest'));
    await page.route('**/api/etf/reports', route => route.fulfill({status:503,contentType:'application/json',body:'{"error":"Controlled local test failure"}'}));
    await page.reload(); await visible(page.getByRole('heading',{name:'ETF 報告暫時無法載入',exact:true}));
    await page.unroute('**/api/etf/reports'); await role('重新嘗試').click(); await visible(reports.first());
    await page.route('**/api/etf/reports', route => route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'}));
    await page.reload(); await visible(page.getByRole('heading',{name:'目前沒有已發布的 ETF 報告',exact:true}));
    await page.unroute('**/api/etf/reports'); await page.reload(); await visible(reports.first());
  });
  await check('US-21–26 complete report tabs and optional extensions', async () => {
    await goto('/active-etf'); await page.getByRole('link', {name:/^開啟 ETF 分析：/}).first().click();
    for (const label of ['分析總結', '產業異動', '基金共識', '營運對照', '數據與來源', '持股配置', '法人對照']) {
      await role(label, 'tab').click(); await visible(role(label, 'tabpanel'));
      assert.ok((await role(label, 'tabpanel').innerText()).trim().length > 20);
      assert.equal(await page.getByRole('tabpanel').count(), 1);
    }
    await page.reload(); await visible(role('法人對照', 'tabpanel')); await shot('report-tabs-1440');
    await role('基金共識', 'tab').click(); await shot('report-matrix-1440');
  });
  await check('both desktop sizes: login and dirty-editor cancel/accept', async () => {
    for (const [width, height] of [[1366, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height }); await goto('/my-library/reviews');
      await role('開啟登入選單').click(); await page.getByRole('button', { name: /^讀者登入/ }).click();
      await visible(page.getByRole('dialog', { name: '本機測試讀者登入' })); await shot('local-login-' + width);
      await role('使用測試讀者 B').click(); await absent(page.getByRole('dialog'));
      await account('登出讀者帳號');
      await goto('/admin'); await role('建立新書').click();
      await page.getByLabel('書名 *', { exact: false }).fill('不保存的本機導覽測試');
      await role('公開書庫').click(); await visible(page.getByRole('alertdialog')); await shot('author-discard-' + width);
      await page.keyboard.press('Escape'); await absent(page.getByRole('alertdialog'));
      assert.equal(await page.getByLabel('書名 *', { exact: false }).inputValue(), '不保存的本機導覽測試');
      await role('公開書庫').click(); await role('放棄變更並繼續').click();
      await visible(page.getByRole('heading', { name: '投資前先看看書', exact: true }));
      assert.ok((await page.title()).includes('研究書庫'));
    }
  });
  await check('US-27 daily data import, preview, explicit publish and restore', async () => {
    const { qaPackage } = await import('../../backend/tests/etf-history-fixture.mjs');
    await goto('/admin/active-etf?workflow=daily');
    await page.getByLabel('每日資料包', { exact: true }).fill(JSON.stringify(qaPackage(10)));
    await role('建立私有任務').click(); await role('保存／繼續匯入各批資料').click();
    await role('驗證與缺口', 'tab').click(); await role('驗證並封存資料').click();
    await role('預覽', 'tab').click(); await role('載入保存版本的預覽').click();
    await role('發布紀錄', 'tab').click();
    await page.getByRole('checkbox', { name: '我已閱讀此版本的全部資料、來源選擇理由及缺口。', exact: true }).check();
    await role('記錄目前版本審閱').click(); await role('預覽', 'tab').click(); await role('載入保存版本的預覽').click(); await role('發布紀錄', 'tab').click(); await role('確認發布內容').click();
    await page.getByRole('dialog').getByRole('button', { name: '確認發布至 STAGING', exact: true }).click();
    await visible(page.getByText(/每日資料版本 v1/));
    const batchId = new URLSearchParams(page.url().split('?')[1]).get('batchId');
    const saved = await api('/api/admin/etf-data/batches/' + batchId + '/get', 'POST', {});
    const record = saved.data || saved;
    await page.getByLabel('舊資料發布識別', { exact: true }).fill(record.batch.publicationId);
    await page.getByLabel('回復理由', { exact: true }).fill('可拋棄本機 UI 回復測試');
    await role('載入回復來源版本').click(); await role('檢查回復內容').click();
    await page.getByRole('dialog').getByRole('button', { name: '確認建立回復版本', exact: true }).click();
    await visible(page.getByText(/每日資料版本 v2/)); await shot('daily-data-published-1440');
  });
  await check('US-07/27 Author book and ETF JSON uploads, validation and publication', async () => {
    await goto('/admin');
    const choices = page.getByRole('region', {name:'選擇上傳內容',exact:true});
    await visible(choices); await visible(choices.getByRole('link',{name:/研究書籍/}));
    await choices.getByRole('link',{name:/ETF 分析報告/}).click();
    await page.getByRole('link', {name:'歷史 JSON 報告',exact:true}).click();
    const raw = page.getByLabel('研究資料包',{exact:true}); await visible(raw);
    await raw.fill('{"keep":"原有內容"}');
    await page.getByRole('region',{name:'選擇上傳內容',exact:true}).getByRole('link',{name:/研究書籍/}).click();
    await visible(page.getByRole('alertdialog')); await page.keyboard.press('Escape');
    await absent(page.getByRole('alertdialog')); assert.equal(await raw.inputValue(), '{"keep":"原有內容"}');
    const file = page.getByLabel('選擇 ETF 分析報告 JSON 檔案',{exact:true});
    await file.setInputFiles({name:'wrong.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not a report')});
    await visible(page.getByText(/請選擇 JSON 報告檔案/)); assert.equal(await raw.inputValue(), '{"keep":"原有內容"}');
    await file.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await visible(page.getByText('JSON 格式無法讀取，原有內容已保留。請修正檔案後重試。',{exact:true}));
    assert.equal(await raw.inputValue(), '{"keep":"原有內容"}');
    const uploaded={...seedReport,id:'disposable-etf-file-upload',title:'可拋棄ETF檔案上傳測試'};
    await file.setInputFiles({name:'local-analysis.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(uploaded))});
    await visible(page.getByRole('dialog',{name:'離開未保存的研究？'}));
    await role('繼續編輯').click(); assert.equal(await raw.inputValue(), '{"keep":"原有內容"}');
    await file.setInputFiles({name:'local-analysis.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(uploaded))});
    await role('放棄變更並繼續').click(); await page.waitForFunction(() => document.querySelector('textarea[aria-label="研究資料包"]')?.value.includes('可拋棄ETF檔案上傳測試')); assert.match(await raw.inputValue(), /可拋棄ETF檔案上傳測試/);
    await role('保存私有草稿').click(); await visible(page.getByText(/草稿已保存。尚未發布/));
    await role('驗證資料').click();
    await role('預覽完整報告').click(); await visible(page.getByRole('heading',{name:uploaded.title,exact:true}));
    await page.getByRole('checkbox',{name:'我已閱讀完整評論、來源與資料缺口，確認本次發布版本。',exact:true}).check();
    await role('審閱後發布').click(); await page.getByRole('dialog',{name:'發布這份研究？'}).getByRole('button',{name:/發布/}).click();
    await visible(page.getByText(/發布已確認。數據、評論/));
    for (const [width,height] of [[1366,768],[1440,900]]) {
      await page.setViewportSize({width,height}); await goto('/admin/active-etf?workflow=reports');
      await visible(page.getByRole('region',{name:'選擇上傳內容',exact:true})); if (await page.locator('.global-notice button').count()) await page.locator('.global-notice button').click(); await page.evaluate(() => window.scrollTo(0,0)); await shot('author-upload-types-' + width);
    }
    await goto('/active-etf'); await visible(page.getByRole('link',{name:'開啟 ETF 分析：'+uploaded.title,exact:true}));
  });
  await check('US-09 author logout clears private access', async () => { await goto('/admin'); await role('登出').click(); await visible(page.getByLabel('作者密鑰')); await goto('/admin/reader-feedback'); await visible(page.getByLabel('作者密鑰')); });
  assert.deepEqual(pageErrors, []); console.log(JSON.stringify({ passed: passed.length, groups: passed, pageErrors }));
} catch (error) {
  if (page) { console.error('VISIBLE UI:', (await page.locator('body').innerText()).slice(-8500)); await shot('failure'); }
  throw error;
} finally {
  await browser?.close(); if (child && child.exitCode === null) { const end = once(child, 'exit'); child.kill('SIGTERM'); await end; }
  rmSync(dataDir, { recursive: true, force: true });
}
