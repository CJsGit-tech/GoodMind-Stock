import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixtureMarkdown, markdownFixtureParts } from '../../tests/fixtures/etf-markdown-fixture.ts';

// Actual Chrome/HTTP/SQLite. Research, credentials and publications exist only in this disposable local database.
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const dataDir = mkdtempSync(join(tmpdir(), 'pocketstocks-markdown-ui-'));
const origin = `http://localhost:${port}`;
const secret = randomBytes(32).toString('base64url');
const id = 'qa-markdown-browser';
const fixtureParts = markdownFixtureParts(id);
// A long registry reproduces nested closed disclosures inside the bounded source scroller.
const sourceCount = 80;
for (let index = 2; index <= sourceCount; index++) {
  const sourceId = 'QA' + index;
  fixtureParts.shared.source_registry[sourceId] = { ...fixtureParts.shared.source_registry.QA1, source_id: sourceId, title: '合成幾何測試來源 ' + index, url: 'https://example.invalid/source/' + index, request_method: 'GET', request_params: { period: '2026-10-14/2026-10-15', annotation: '合成資料註記。'.repeat(24) }, request_note: '可展開完整紀錄，收合時不得延伸頁面。' };
}
const source = fixtureMarkdown(fixtureParts).replace('沒有推薦。', '沒有推薦。參考[週端點來源](#weekly-trend-sources)與[估值方法](#estimate-methods)。');
const passed = [], pageErrors = [], referenceGeometry = [];
let child, browser, page;
const role = (name, kind = 'button') => page.getByRole(kind, { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible', timeout: 15000 });
const hidden = locator => locator.waitFor({ state: 'hidden', timeout: 15000 });
async function check(name, test) { await test(); passed.push(name); console.log('PASS ' + name); }
async function goto(hash) { await page.goto(origin + '/#' + hash); }
async function api(action, payload = {}) {
  const response = await page.request.post(origin + '/api/admin/etf-research/' + action, { headers: { Origin: origin }, data: payload });
  assert.ok(response.ok(), `Author ${action}: HTTP ${response.status()}`); return response.json();
}
async function publicReport(version) {
  const response = await page.request.get(origin + '/api/etf/reports/' + id + (version ? '?version=' + version : ''));
  return { status: response.status(), value: await response.json() };
}
async function importSource(raw = source) {
  await page.getByLabel('選擇研究資料檔', { exact: true }).setInputFiles({ name: 'report.md', mimeType: 'text/markdown', buffer: Buffer.from(raw) });
}
async function sourceEditor() {
  const details = page.locator('.md-author-source').filter({ has: page.getByLabel('來源內容', { exact: true }) });
  if (!(await details.getAttribute('open') !== null)) await details.locator('summary').click();
  return page.getByLabel('來源內容', { exact: true });
}
async function editSource(raw) {
  await role('資料匯入', 'tab').click(); await (await sourceEditor()).fill(raw);
  await role('重新驗證').click(); await visible(page.getByRole('heading', { name: '資料部分覆蓋', exact: true }));
  await role('資料匯入', 'tab').click();
}
async function assertReferenceGeometry(reader, label) {
  assert.equal(await reader.locator('.md-citation-list > li').count(), sourceCount, label + ': all numbered citations remain present');
  const citations = await reader.locator('.md-citation-list').evaluate(node => ({ style: getComputedStyle(node).listStyleType,
    overflow: getComputedStyle(node).overflowY, maxHeight: getComputedStyle(node).maxHeight,
    numbers: [...node.querySelectorAll('.md-citation-number')].map(number => number.textContent),
    containsMetadata: !!node.querySelector('details,dl,small'), columns: getComputedStyle(node).gridTemplateColumns.split(/\s+/).length,
    size: getComputedStyle(node.firstElementChild).fontSize,
    first: [...node.children].slice(0, 4).map(item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y }; }) }));
  assert.equal(citations.style, 'none', label + ': no duplicate native decimal marker');
  assert.equal(citations.overflow, 'visible', label + ': citations use normal document scrolling');
  assert.equal(citations.maxHeight, 'none', label + ': citations are not clipped to an internal scroller');
  assert.deepEqual(citations.numbers, Array.from({ length: sourceCount }, (_, index) => '[' + (index + 1) + ']'));
  assert.equal(citations.containsMetadata, false, label + ': default bibliography has no per-source verification blocks');
  assert.equal(citations.columns, 3, label + ': desktop bibliography uses three columns');
  assert.equal(citations.size, '14px', label + ': source text remains readable');
  assert.ok(citations.first[0].x < citations.first[1].x && citations.first[1].x < citations.first[2].x, label + ': first row follows left-to-right citation order');
  assert.ok(citations.first.slice(0, 3).every(item => Math.abs(item.y - citations.first[0].y) < 1), label + ': citations 1–3 share the first row');
  assert.ok(citations.first[3].y > citations.first[0].y && Math.abs(citations.first[3].x - citations.first[0].x) < 1, label + ': citation 4 starts the next row');
  assert.equal(await reader.locator('.md-references details,.md-references dl').count(), 0, label + ': references contain citations only');
  const geometry = await reader.locator('.md-references').evaluate(node => {
    const bottom = element => element ? element.getBoundingClientRect().bottom + scrollY : 0;
    return { documentHeight: document.documentElement.scrollHeight, normalBottom: Math.max(innerHeight, bottom(document.body), bottom(document.getElementById('root'))), referencesBottom: bottom(node), viewport: innerHeight };
  });
  assert.ok(geometry.documentHeight <= geometry.normalBottom + 64, label + ': document has no overflow beyond the rendered app: ' + JSON.stringify(geometry));
  assert.ok(geometry.documentHeight <= geometry.referencesBottom + geometry.viewport, label + ': no viewport-sized blank tail after references: ' + JSON.stringify(geometry));
  referenceGeometry.push({ label, ...geometry });

}
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No document-level horizontal overflow'); }
try {
  child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, PORT: String(port), POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret, POCKETSTOCKS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stderr.on('data', value => { diagnostics += value; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/_healthcheck')).ok) { ready = true; break; } } catch {} if (child.exitCode !== null) throw Error(diagnostics); await delay(100); }
  assert.ok(ready, 'Disposable runtime ready');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(12000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await goto('/admin'); await page.getByLabel('作者密鑰').fill(secret); await role('登入').click();
  await visible(role('建立新書'));
  await goto('/admin/active-etf?workflow=markdown');
  await visible(role('選擇 data.json'));

  await check('US-27 TC11/12 MD selection, invalid input and canceled replacement preserve editing', async () => {
    await importSource(); await visible(page.getByText('解析完成，尚未保存或發布。結構驗證不代表已查證市場資料。', { exact: true }));
    assert.equal((await publicReport()).status, 404);
    assert.equal((await api('list')).items.length, 0, 'Selection does not save');
    assert.equal(await (await sourceEditor()).inputValue(), source);
    await importSource('# 無效 Markdown'); await visible(page.getByText('選取的檔案無法匯入，原有編輯內容已保留。', { exact: true }));
    await role('資料匯入', 'tab').click(); assert.equal(await (await sourceEditor()).inputValue(), source);
    await page.getByLabel('選擇研究資料檔', { exact: true }).setInputFiles([]);
    assert.equal(await (await sourceEditor()).inputValue(), source);
    await importSource(source.replace('沒有推薦。', '取消取代的候選內容。'));
    const dialog = page.getByRole('dialog', { name: '有尚未保存的變更', exact: true }); await visible(dialog);
    await dialog.getByRole('button', { name: '繼續編輯', exact: true }).click();
    assert.equal(await (await sourceEditor()).inputValue(), source);
    assert.equal((await api('list')).items.length, 0);
    await noOverflow();
  });
  await check('US-27 TC11/15 private save, exact get and selected-draft reload', async () => {
    await role('保存私有草稿').click(); await visible(page.getByText('私有草稿已保存。文章與內嵌資料尚未公開。', { exact: true }));
    assert.equal((await publicReport()).status, 404);
    const saved = (await api('get', { id })).entry; assert.equal(saved.revision, 1); assert.equal(saved.draft.rawMarkdown, source);
    assert.match(page.url(), /reportId=qa-markdown-browser/);
    await page.reload(); await visible(page.getByText('已載入私有草稿，公開版本維持原狀。', { exact: true }));
    assert.equal(await (await sourceEditor()).inputValue(), source);
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) { await page.setViewportSize(viewport); await noOverflow(); }
  });
  await check('US-27 TC13/16 preview and review require explicit publication confirmation', async () => {
    await role('預覽', 'tab').click(); await visible(page.locator('.md-preview'));
    const previewRoute = new URL(page.url()).hash;
    const previewReader = page.locator('.md-preview');
    await previewReader.getByRole('button', { name: '週端點來源', exact: true }).click();
    assert.equal(await previewReader.getByRole('tab', { name: '參考來源依據', exact: true }).getAttribute('aria-selected'), 'true');
    const previewSources = previewReader.getByRole('heading', { name: '文章與圖表來源（' + sourceCount + ' 筆）', exact: true });
    await visible(previewSources);
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-reference-sources') && !!document.activeElement.closest('.md-preview'));
    assert.equal(await previewSources.evaluate(node => node === document.activeElement), true, 'Private weekly citation focuses source bibliography');
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) { await page.setViewportSize(viewport); await assertReferenceGeometry(previewReader, 'Private preview ' + viewport.width); }
    assert.equal(new URL(page.url()).hash, previewRoute, 'Private source navigation does not alter the Author route');
    await previewReader.getByRole('tab', { name: '重點分析', exact: true }).click();
    await previewReader.getByRole('button', { name: '估值方法', exact: true }).click();
    await visible(previewSources);
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-reference-sources') && !!document.activeElement.closest('.md-preview'));
    assert.equal(new URL(page.url()).hash, previewRoute, 'Private method citation uses source bibliography without changing the Author route');
    await previewReader.getByRole('tab', { name: '重點分析', exact: true }).click();
    assert.equal(await role('確認發布…').isEnabled(), false);
    await page.getByRole('checkbox', { name: '我已閱讀完整文章、三組圖表、來源與缺口，確認本次修訂。', exact: true }).check();
    await role('記錄本次審閱').click(); await visible(page.getByText('已記錄這個修訂的審閱，可確認發布。', { exact: true }));
    assert.equal((await publicReport()).status, 404, 'Review remains private');
    await role('確認發布…').click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await publicReport()).status, 404, 'Cancel does not publish');
    await role('確認發布…').click(); await page.getByRole('dialog').getByRole('button', { name: '確認發布', exact: true }).click();
    await visible(page.getByRole('heading', { name: '已發布', exact: true }));
    assert.match(await page.locator('.site-research-footer').innerText(), /公開版本 v1/);
    const published = await publicReport(1); assert.equal(published.status, 200); assert.equal(published.value.report.rawMarkdown, source); assert.equal(published.value.report.visualizations.length, 3);
  });
  const revision2 = source.replace('沒有推薦。', '保留已公開版本，測試私有修訂。');
  await check('US-27 TC13/15 edits invalidate review, root navigation cancellation preserves task and source', async () => {
    await editSource(revision2);
    const locationBefore = new URL(page.url()).hash;
    await role('公開書庫').click(); const dialog = page.getByRole('alertdialog'); await visible(dialog);
    await dialog.getByRole('button', { name: '繼續編輯', exact: true }).click(); await hidden(dialog);
    assert.equal(new URL(page.url()).hash, locationBefore); assert.equal(await (await sourceEditor()).inputValue(), revision2);
    assert.match(page.url(), /workflow=markdown/); assert.match(page.url(), /reportId=qa-markdown-browser/);
    await role('預覽', 'tab').click(); await visible(page.getByRole('heading', { name: '先保存私有草稿', exact: true }));
    await role('資料匯入', 'tab').click(); await role('保存私有草稿').click();
    await visible(page.getByText('私有草稿已保存。文章與內嵌資料尚未公開。', { exact: true }));
    const entry = (await api('get', { id })).entry; assert.equal(entry.revision, 2); assert.equal(entry.reviewHash, null);
    await role('預覽', 'tab').click(); assert.equal(await role('確認發布…').isEnabled(), false);
    assert.equal((await publicReport()).value.report.rawMarkdown, source);
  });
  await check('US-27 reversible visibility cancels safely, blocks duplicate submission and restores public v1 instead of private r2', async () => {
    await role('發布紀錄', 'tab').click();
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await role('下架公開文章…').click(); const dialog = page.getByRole('dialog', { name: '下架公開文章？', exact: true }); await visible(dialog);
      assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(node => node === document.activeElement), true);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal((await publicReport(1)).status, 200); await noOverflow();
    }
    let visibilityRequests = 0;
    await page.route('**/api/admin/etf-research/visibility', async route => {
      visibilityRequests += 1; const committed = await route.fetch(); assert.equal(committed.status(), 200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Controlled lost visibility response after commit"}' });
    });
    await role('下架公開文章…').click(); await page.getByRole('dialog').getByRole('button', { name: '下架公開文章', exact: true }).click();
    const dialog = page.getByRole('dialog'); await visible(dialog.getByRole('button', { name: '查詢操作狀態', exact: true }));
    assert.equal(await dialog.getByRole('button', { name: '下架公開文章', exact: true }).isEnabled(), false);
    assert.equal((await publicReport(1)).status, 404);
    await page.reload(); await visible(page.getByRole('heading', { name: '操作結果尚未確認', exact: true }));
    await role('查詢操作狀態').click(); await visible(page.getByRole('heading', { name: '已下架', exact: true }));
    assert.equal(visibilityRequests, 1); await page.unroute('**/api/admin/etf-research/visibility');
    const archived = (await api('get', { id })).entry;
    assert.equal(archived.archived, true); assert.equal(archived.revision, 2); assert.equal(archived.publishedVersion, 1); assert.equal(archived.draft.rawMarkdown, revision2);
    assert.equal(await page.getByRole('link', { name: '查看公開文章 →', exact: true }).count(), 0);
    await role('恢復公開文章…').click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await publicReport(1)).status, 404);
    await role('恢復公開文章…').click(); await visible(page.getByText('將恢復原已發布內容，不會發布目前尚未公開的草稿。', { exact: true }));
    await page.getByRole('dialog').getByRole('button', { name: '恢復公開文章', exact: true }).click();
    await visible(page.getByRole('heading', { name: '已發布', exact: true }));
    assert.equal((await publicReport(1)).value.report.rawMarkdown, source);
    assert.equal((await api('get', { id })).entry.draft.rawMarkdown, revision2);
    assert.equal((await api('get', { id })).entry.revision, 2); await noOverflow();
  });
  const revision3 = source.replace('沒有推薦。', '結果未知回執查詢測試。');
  await check('US-27 TC17 committed save with lost response recovers by receipt without resubmission', async () => {
    await editSource(revision3); let saves = 0, statuses = 0;
    await page.route('**/api/admin/etf-research/save', async route => { saves += 1; const committed = await route.fetch(); assert.equal(committed.status(), 200); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Controlled lost response after commit"}' }); });
    page.on('request', request => { if (request.url().endsWith('/api/admin/etf-research/status')) statuses += 1; });
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/admin/etf-research/save') && response.status() === 503), role('保存私有草稿').click()]); await visible(page.getByRole('heading', { name: '操作結果尚未確認', exact: true }));
    assert.equal((await api('get', { id })).entry.revision, 3);
    assert.equal(await role('保存私有草稿').isEnabled(), false);
    await page.reload(); await visible(page.getByRole('heading', { name: '操作結果尚未確認', exact: true }));
    await role('查詢操作狀態').click(); await visible(page.getByText('已確認上次操作成功，沒有重複提交。', { exact: true }));
    assert.equal(saves, 1); assert.equal(statuses, 1); assert.equal(await (await sourceEditor()).inputValue(), revision3);
    assert.equal((await publicReport()).value.report.rawMarkdown, source);
    await page.unroute('**/api/admin/etf-research/save');
  });
  await check('US-27 TC17 actual concurrent revision conflict preserves local source', async () => {
    const external = revision3.replace('結果未知回執查詢測試。', '另一個作者視窗已保存的修訂。');
    await api('save', { rawMarkdown: external, baseRevision: 3, requestId: 'browser-external-save-4' });
    const local = revision3.replace('結果未知回執查詢測試。', '本機尚未保存的衝突內容。');
    await editSource(local); await role('保存私有草稿').click();
    await visible(page.getByText('版本已變更，這次操作未套用。目前輸入仍保留；請重新載入已保存版本後比較。', { exact: true }));
    assert.equal(await (await sourceEditor()).inputValue(), local); assert.equal((await api('get', { id })).entry.draft.rawMarkdown, external);
    assert.equal((await publicReport()).value.report.rawMarkdown, source);
  });
  // A second page avoids carrying private unsaved author input into public reader tests.
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(12000); page.on('pageerror', error => pageErrors.push(error.message));
  await check('US-21 TC07/08/09/10 public same-version tabs, filters, keyboard and desktop restoration', async () => {
    await goto('/active-etf/' + id + '?v=1'); await visible(role('重點分析', 'tab'));
    assert.match(await page.locator('.site-research-footer').innerText(), /文章版本 v1/);
    assert.doesNotMatch(await page.locator('.md-etf-reader').innerText(), /\bv\d+\b/);
    assert.equal(await page.getByRole('tablist', { name: '研究報告內容', exact: true }).getByRole('tab').count(), 3);
    await role('重點分析', 'tab').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await role('配置圖表', 'tab').evaluate(node => node === document.activeElement), true);
    assert.equal(await role('重點分析', 'tab').getAttribute('aria-selected'), 'true', 'Arrow changes focus before activation');
    await page.keyboard.press('Enter'); await role('個股異動').click();
    await role('基金篩選', 'combobox').click(); await page.getByRole('listbox', {name:'基金篩選'}).locator('[data-value="QA001A"]').click(); await role('產業篩選', 'combobox').click(); await page.getByRole('listbox', {name:'產業篩選'}).locator('[data-value="01"]').click(); await role('億元').click();
    const state = new URL(page.url()).hash; await page.reload(); await visible(role('配置圖表', 'tab'));
    assert.equal(new URL(page.url()).hash, state); assert.equal(await role('基金篩選', 'combobox').getAttribute('data-value'), 'QA001A'); assert.equal(await role('產業篩選', 'combobox').getAttribute('data-value'), '01'); assert.equal(await role('億元').getAttribute('aria-pressed'), 'true');
    await page.locator('.md-heat-cell').first().click(); await visible(page.locator('.md-evidence'));
    assert.equal(await page.locator('.md-evidence .md-source-list').count(), 1, 'Contextual evidence retains its detailed source list');
    assert.ok(await page.locator('.md-evidence .md-reference-metadata').count() > 0, 'Contextual evidence retains full source metadata disclosures');
    await role('關閉精確證據').click();
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) { await page.setViewportSize(viewport); await noOverflow(); }
    await role('週度趨勢').click(); await visible(page.getByRole('heading', { name: '週度淨變動估值（億元）', exact: true })); await visible(page.getByText(/可比完整週不足/).first());
    await role('產業方向').click(); await role('重設篩選').click(); assert.equal(await role('基金篩選', 'combobox').getAttribute('data-value'), ''); assert.equal(await role('產業篩選', 'combobox').getAttribute('data-value'), '');
    await role('基金篩選', 'combobox').click(); await page.getByRole('listbox', {name:'基金篩選'}).locator('[data-value="QA001A"]').click(); await role('產業篩選', 'combobox').click(); await page.getByRole('listbox', {name:'產業篩選'}).locator('[data-value="01"]').click();
    await role('查看這張圖的參考來源').click();
    assert.equal(await role('參考來源依據', 'tab').getAttribute('aria-selected'), 'true');
    const sourceHeading = page.getByRole('heading', { name: '文章與圖表來源（' + sourceCount + ' 筆）', exact: true });
    await visible(sourceHeading);
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-reference-sources'));
    assert.equal(await sourceHeading.evaluate(node => node === document.activeElement), true, 'Chart source navigation focuses registry');
    assert.match(page.url(), /mdTab=references/);
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) { await page.setViewportSize(viewport); await assertReferenceGeometry(page.locator('.md-etf-reader'), 'Public reader ' + viewport.width); }
    const referenceRoute = new URL(page.url()).hash; await page.reload(); await visible(role('參考來源依據', 'tab'));
    assert.equal(new URL(page.url()).hash, referenceRoute);
    assert.equal(await role('參考來源依據', 'tab').getAttribute('aria-selected'), 'true');
    await role('配置圖表', 'tab').click(); assert.equal(await role('產業方向').getAttribute('aria-pressed'), 'true');
    assert.equal(await role('基金篩選', 'combobox').getAttribute('data-value'), 'QA001A'); assert.equal(await role('產業篩選', 'combobox').getAttribute('data-value'), '01');
    await role('重點分析', 'tab').click(); await role('週端點來源').click();
    await visible(sourceHeading);
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-reference-sources'));
    assert.equal(await role('參考來源依據', 'tab').getAttribute('aria-selected'), 'true');
    await role('重點分析', 'tab').click(); await role('估值方法').click();
    await visible(sourceHeading);
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-reference-sources'));
    assert.equal(await sourceHeading.evaluate(node => node === document.activeElement), true, 'Former method citation focuses the source bibliography');
    assert.match(page.url(), /v=1/);
    assert.equal((await publicReport(1)).value.report.rawMarkdown, source);
  });
  await check('US-21 TC09 public load failure exposes retry and recovers exact requested version', async () => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('pageerror', error => pageErrors.push(error.message));
    const pattern = '**/api/etf/reports/' + id + '*';
    await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Controlled reader failure"}' }));
    await goto('/active-etf/' + id + '?v=1'); await visible(role('重新嘗試'));
    await page.unroute(pattern); await role('重新嘗試').click(); await visible(role('重點分析', 'tab')); assert.match(page.url(), /v=1/);
  });
  assert.deepEqual(pageErrors, []); console.log(JSON.stringify({ passed: passed.length, groups: passed, pageErrors, referenceGeometry, environment: 'disposable localhost; synthetic data; no cloud or OAuth parity' }));
} catch (error) {
  if (page) console.error('VISIBLE UI:', (await page.locator('body').innerText()).slice(-7000));
  throw error;
} finally {
  await browser?.close(); if (child && child.exitCode === null) { const end = once(child, 'exit'); const force = setTimeout(() => child.kill('SIGKILL'), 5000); child.kill('SIGTERM'); await end; clearTimeout(force); }
  rmSync(dataDir, { recursive: true, force: true });
}
