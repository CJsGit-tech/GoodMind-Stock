import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { jsonFixtureParts } from '../../tests/fixtures/etf-json-fixture.ts';

// Local-only Author cover tests. The JPEGs are explicitly synthetic test fixtures, not research covers.
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const dir = mkdtempSync(join(tmpdir(), 'pocketstocks-author-cover-ui-'));
const origin = `http://localhost:${port}`, secret = randomBytes(32).toString('base64url');
const id = 'qa-author-cover', raw = JSON.stringify(jsonFixtureParts(id));
const passed = [], pageErrors = [];
let child, browser, page, publishRequests = 0, savedSourceHash = '';
const role = (name, kind = 'button') => page.getByRole(kind, { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible', timeout: 15000 });
async function check(name, fn) { await fn(); passed.push(name); console.log('PASS ' + name); }
async function getEntry(reportId = id) {
  const response = await page.request.post(origin + '/api/admin/etf-research/get', { headers: { Origin: origin }, data: { id: reportId } });
  assert.equal(response.status(), 200); return (await response.json()).entry;
}
async function sourceFile(source = raw) { await page.getByLabel('選擇研究資料檔', { exact: true }).setInputFiles({ name: 'data.json', mimeType: 'application/json', buffer: Buffer.from(source) }); }
async function coverFile(bytes, name = 'cover.jpg', mimeType = 'image/jpeg') { await page.getByLabel('選擇研究封面 JPEG', { exact: true }).setInputFiles({ name, mimeType, buffer: bytes }); }
const coverRegion = () => page.getByRole('region', { name: '研究封面（選填）', exact: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function shownHash(expected) { await visible(coverRegion().getByText('SHA-256 ' + expected, { exact: true })); }
async function save() { await role('保存私有草稿').click(); await visible(page.getByText('私有草稿已保存。文章與內嵌資料尚未公開。', { exact: true })); }
async function imageDecoded(region) { const image = region.getByRole('img', { name: /研究封面$/ }); await visible(image); await image.evaluate(node => node.decode()); assert.deepEqual(await image.evaluate(node => [node.naturalWidth, node.naturalHeight]), [480, 360]); }
try {
  child = spawn(process.execPath, ['--import', 'tsx', 'local/server.ts'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, PORT: String(port), POCKETSTOCKS_DATA_DIR: dir, POCKETSTOCKS_LOCAL_ADMIN_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stderr.on('data', value => { diagnostics += value; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/_healthcheck')).ok) { ready = true; break; } } catch {} if (child.exitCode !== null) throw Error(diagnostics); await delay(100); }
  assert.ok(ready);
  browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(12000);
  page.on('pageerror', error => pageErrors.push(error.message)); page.on('request', request => { if (request.url().endsWith('/etf-research/publish')) publishRequests += 1; });
  await page.goto(origin + '/#/admin'); await page.getByLabel('作者密鑰').fill(secret); await role('登入').click(); await visible(role('建立新書'));
  await page.goto(origin + '/#/admin/active-etf?workflow=markdown'); await visible(role('選擇 data.json'));
  const images = await page.evaluate(() => {
    const make = (width, height, color, type = 'image/jpeg') => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height); return canvas.toDataURL(type).split(',')[1]; };
    return { first: make(480, 360, '#aa2233'), second: make(480, 360, '#2244aa'), wrongSize: make(320, 240, '#335533'), png: make(480, 360, '#333333', 'image/png') };
  });
  const first = Buffer.from(images.first, 'base64'), second = Buffer.from(images.second, 'base64');
  await check('cover selection is private and preserves full 4:3 pixels at both desktop sizes', async () => {
    await sourceFile(); await visible(page.getByText('解析完成，尚未保存或發布。結構驗證不代表已查證市場資料。', { exact: true }));
    await coverFile(first); await shownHash(sha(first));
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport); await imageDecoded(coverRegion());
      const shape = await coverRegion().getByRole('img').evaluate(node => { const box = node.getBoundingClientRect(); return { ratio: box.width / box.height, fit: getComputedStyle(node).objectFit, overflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.ok(Math.abs(shape.ratio - 4 / 3) < .001); assert.equal(shape.fit, 'contain'); assert.equal(shape.overflow, false);
    }
    assert.equal((await page.request.get(origin + '/api/etf/reports/' + id)).status(), 404);
    await save(); const entry = await getEntry(); assert.equal(entry.revision, 1); savedSourceHash = entry.draft.sourceHash; assert.equal(entry.cover.sha256, sha(first)); assert.equal(entry.reviewHash, null);
    await page.reload(); await visible(page.getByText('已載入私有草稿，公開版本維持原狀。', { exact: true })); await shownHash(sha(first)); await imageDecoded(coverRegion());
  });
  await check('invalid file type, JPEG payload, dimensions and size retain the saved cover', async () => {
    for (const fixture of [{ bytes: first, name: 'wrong.png', type: 'image/png' }, { bytes: Buffer.from(images.png, 'base64'), name: 'invalid.jpg', type: 'image/jpeg' }, { bytes: Buffer.from(images.wrongSize, 'base64'), name: 'wrong-size.jpg', type: 'image/jpeg' }, { bytes: Buffer.alloc(1024 * 1024 + 1), name: 'oversize.jpg', type: 'image/jpeg' }]) {
      await coverFile(fixture.bytes, fixture.name, fixture.type); await visible(coverRegion().getByRole('alert')); await shownHash(sha(first));
      assert.equal(await role('保存私有草稿').isEnabled(), false); assert.equal((await getEntry()).revision, 1);
    }
    await page.getByLabel('選擇研究封面 JPEG', { exact: true }).setInputFiles([]); await shownHash(sha(first));
  });
  await check('identical source and cover remain unchanged while cover-only edits save a new private revision', async () => {
    await sourceFile(); await coverFile(first); await shownHash(sha(first)); assert.equal(await role('保存私有草稿').isEnabled(), false); assert.equal((await getEntry()).revision, 1);
    await coverFile(second); await shownHash(sha(second)); assert.equal(await role('保存私有草稿').isEnabled(), true);
    await role('新增研究').click(); await visible(page.getByRole('dialog', { name: '有尚未保存的變更', exact: true })); await role('繼續編輯').click(); await shownHash(sha(second)); assert.equal((await getEntry()).cover.sha256, sha(first));
    await role('取消封面變更').click(); await shownHash(sha(first)); assert.equal(await role('保存私有草稿').isEnabled(), false);
    await coverFile(second); await shownHash(sha(second)); await save(); const entry = await getEntry(); assert.equal(entry.revision, 2); assert.equal(entry.cover.sha256, sha(second)); assert.equal(entry.draft.sourceHash, savedSourceHash, 'Cover-only edits retain the exact research source');
    assert.equal((await page.request.get(origin + '/api/etf/reports/' + id)).status(), 404);
  });
  await check('saved preview and publish confirmation use the same cover; changing cover invalidates review', async () => {
    await role('預覽', 'tab').click(); const preview = page.locator('#md-author-panel-preview'); await imageDecoded(preview); await visible(preview.getByText('SHA-256 ' + sha(second), { exact: true }));
    await page.getByRole('checkbox', { name: '我已閱讀封面、完整文章、三組圖表、來源與缺口，確認本次修訂。', exact: true }).check(); await role('記錄本次審閱').click(); await visible(page.getByText('已記錄這個修訂的審閱，可確認發布。', { exact: true }));
    await role('確認發布…').click(); const dialog = page.getByRole('dialog', { name: '確認發布這篇研究？', exact: true }); await imageDecoded(dialog); await visible(dialog.getByText('SHA-256 ' + sha(second), { exact: true })); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await role('資料匯入', 'tab').click(); await coverFile(first); await shownHash(sha(first)); await role('預覽', 'tab').click(); await visible(page.getByRole('heading', { name: '先保存私有草稿', exact: true }));
    await role('資料匯入', 'tab').click(); await save(); assert.equal((await getEntry()).revision, 3); assert.equal((await getEntry()).reviewHash, null);
    await role('預覽', 'tab').click(); assert.equal(await role('確認發布…').isEnabled(), false); await role('資料匯入', 'tab').click();
  });
  await check('changing research clears cover association and canceling a switch preserves the saved pair', async () => {
    const switched = JSON.stringify(jsonFixtureParts('qa-author-cover-other'));
    await sourceFile(switched); await visible(page.getByText('研究來源已變更，先前封面未沿用。請為這份研究重新選擇封面，或不附封面保存。', { exact: true })); assert.equal(await coverRegion().getByRole('img').count(), 0);
    await role('新增研究').click(); await role('繼續編輯').click(); assert.equal(await coverRegion().getByRole('img').count(), 0);
    assert.equal((await getEntry()).cover.sha256, sha(first));
    await page.locator('.md-author-list').getByRole('button', { name: /合成 JSON 研究/ }).click(); await role('放棄變更並繼續').click(); await visible(page.getByText('已載入私有草稿，公開版本維持原狀。', { exact: true })); await shownHash(sha(first));
    await role('移除封面').click(); assert.equal(await role('保存私有草稿').isEnabled(), true); await role('取消封面變更').click(); await shownHash(sha(first)); assert.equal(await role('保存私有草稿').isEnabled(), false);
    assert.equal((await getEntry()).revision, 3); assert.equal(publishRequests, 0);
  });
  assert.deepEqual(pageErrors, []); console.log(JSON.stringify({ passed: passed.length, groups: passed, pageErrors, publishRequests, environment: 'isolated localhost synthetic fixtures; no report was published' }));
} catch (error) { if (page) console.error('VISIBLE UI:', (await page.locator('body').innerText()).slice(-7000)); throw error; }
finally { await browser?.close(); if (child && child.exitCode === null) { const end = once(child, 'exit'); const force = setTimeout(() => child.kill('SIGKILL'), 5000); child.kill('SIGTERM'); await end; clearTimeout(force); } rmSync(dir, { recursive: true, force: true }); }
