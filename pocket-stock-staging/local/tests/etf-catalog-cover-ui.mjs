import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real React/image decoding with controlled HTTP assets; no application server, database or research files.
const output = await mkdtemp(join(tmpdir(), 'pocketstocks-catalog-cover-'));
let browser, server;
const passed = [], errors = [];
const base = { id: 'cover-fixture', title: '合成封面驗證', excerpt: '僅供隔離測試', period: { start: '2026-10-14', end: '2026-10-15' }, evidenceDate: '2026-10-16', publishedAt: '2026-10-17T12:00:00Z', version: 3 };
const descriptor = (url, hash = 'a'.repeat(64)) => ({ sha256: hash, bytes: 1024, width: 480, height: 360, contentType: 'image/jpeg', url });
try {
  await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{EtfReportCatalog}from${JSON.stringify(resolve('src/etf-report-catalog.tsx'))};
    function Fixture(){const[cover,setCover]=useState(null),[version,setVersion]=useState(3),[opened,setOpened]=useState('');
    const choose=(url,hash='a'.repeat(64),v=3)=>{setVersion(v);setCover(url?{sha256:hash,bytes:1024,width:480,height:360,contentType:'image/jpeg',url}:null)};
    return <main className='public-library'><div><button onClick={()=>choose(null)}>無封面</button><button onClick={()=>choose('/test-cover/ok.jpg')}>有效封面</button><button onClick={()=>choose('/test-cover/fail.jpg')}>失效封面</button><button onClick={()=>choose('/test-cover/new.jpg','b'.repeat(64),4)}>新版封面</button><button onClick={()=>choose('/test-cover/new-url.jpg')}>網址更新</button></div><output>{opened}</output><EtfReportCatalog items={[{...${JSON.stringify(base)},version,cover}]} ready loading={false} fallback={null} onOpen={item=>setOpened('已開啟 '+item.id)}/></main>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'browser', format: 'esm', outfile: join(output, 'fixture.js') });
  await writeFile(join(output, 'index.html'), '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/active-etf.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const files = { '/': ['index.html', 'text/html'], '/fixture.js': ['fixture.js', 'application/javascript'], '/fixture.css': ['fixture.css', 'text/css'], '/index.css': [resolve('src/index.css'), 'text/css'], '/active-etf.css': [resolve('src/active-etf.css'), 'text/css'] };
    const file = files[path];
    if (!file) { response.writeHead(404); response.end(); return; }
    try { response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); response.end(await readFile(file[0].startsWith('/') ? file[0] : join(output, file[0]))); }
    catch { response.writeHead(500); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/#/active-etf');
  const jpeg = Buffer.from((await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 360; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#56b7a9'; ctx.fillRect(0, 0, 480, 360); return canvas.toDataURL('image/jpeg'); })).split(',')[1], 'base64');
  let imageFailures = 0, refreshes = 0, mode = 'success', delayedRefresh, delayedSignal;
  await page.route('**/test-cover/**', route => {
    if (route.request().url().includes('/fail.jpg')) { imageFailures++; return route.fulfill({ status: 503, body: 'controlled failure' }); }
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg });
  });
  await page.route('**/api/etf/reports/cover-fixture/cover?*', async route => {
    refreshes++;
    const query = new URL(route.request().url()).searchParams;
    assert.equal(query.get('version'), '3'); assert.equal(query.get('sha256'), 'a'.repeat(64));
    if (mode === 'delayed') { delayedRefresh = route; delayedSignal?.(); return; }
    return route.fulfill({ json: { cover: mode === 'missing' ? null : descriptor('/test-cover/refreshed.jpg', mode === 'wrong-hash' ? 'b'.repeat(64) : undefined) } });
  });
  const choose = name => page.getByRole('button', { name, exact: true }).click();
  const waitForDelayedRefresh = async () => {
    let timer;
    const started = new Promise(resolve => { delayedSignal = resolve; });
    const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Pinned refresh did not start')), 4000); });
    try {
      await Promise.all([choose('失效封面'), Promise.race([started, expired])]);
    } finally { clearTimeout(timer); delayedSignal = undefined; }
  };
  const readyImage = async expected => {
    await page.waitForFunction(path => { const image = document.querySelector('.etf-report-cover img'); return image?.getAttribute('src') === path && image.complete && image.naturalWidth === 480 && image.naturalHeight === 360 && image.getAttribute('data-loading') === 'false'; }, expected);
  };
  async function check(name, fn) { await fn(); passed.push(name); console.log('PASS ' + name); }
  await check('legacy placeholder and supplied cover decode preserve compact 4:3 contain and card interaction', async () => {
    assert.equal(await page.locator('.etf-report-cover img').count(), 0);
    await choose('有效封面'); await readyImage('/test-cover/ok.jpg');
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const box = await page.locator('.etf-report-cover').evaluate(node => { const r = node.getBoundingClientRect(), image = node.querySelector('img'), ir = image.getBoundingClientRect(); return { ratio: r.width / r.height, fit: getComputedStyle(image).objectFit, imageWidth: ir.width, imageHeight: ir.height, width: r.width, height: r.height, transform: getComputedStyle(image).transform }; });
      assert.ok(Math.abs(box.ratio - 4 / 3) < 0.01); assert.equal(box.fit, 'contain'); assert.equal(box.transform, 'none');
      assert.ok(Math.abs(box.width - box.imageWidth) < 1 && Math.abs(box.height - box.imageHeight) < 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.equal(await page.locator('.etf-analysis-card button').count(), 0);
    await page.locator('.etf-report-cover img').click(); assert.equal(await page.locator('output').innerText(), '已開啟 cover-fixture');
  });
  await check('transient image failure retries once then refreshes the pinned version/hash', async () => {
    imageFailures = 0; refreshes = 0; mode = 'success';
    await choose('失效封面'); await readyImage('/test-cover/refreshed.jpg');
    assert.equal(imageFailures, 2); assert.equal(refreshes, 1);
  });
  await check('unavailable or mismatched refresh falls back and a same-hash URL update recovers', async () => {
    for (const failure of ['missing', 'wrong-hash']) {
      await choose('無封面'); mode = failure; refreshes = 0;
      await choose('失效封面'); await page.getByText('封面暫時無法顯示', { exact: true }).waitFor();
      assert.equal(refreshes, 1); assert.equal(await page.locator('.etf-report-cover img').count(), 0);
      await choose('網址更新'); await readyImage('/test-cover/new-url.jpg');
    }
  });
  await check('a stale refresh and pending retry cannot overwrite a replacement cover hash/version', async () => {
    await choose('無封面'); mode = 'delayed'; delayedRefresh = undefined;
    await waitForDelayedRefresh();
    assert.ok(delayedRefresh, 'The old cover refresh is pending');
    await choose('新版封面'); await readyImage('/test-cover/new.jpg');
    await delayedRefresh.fulfill({ json: { cover: descriptor('/test-cover/refreshed.jpg') } }).catch(() => {});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.etf-report-cover img').getAttribute('src'), '/test-cover/new.jpg');
    assert.match(await page.locator('.etf-analysis-card').getAttribute('href'), /v=4/);
    await choose('失效封面'); await choose('新版封面'); await readyImage('/test-cover/new.jpg');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.etf-report-cover img').getAttribute('src'), '/test-cover/new.jpg');
  });
  await check('a stalled signed-URL refresh reaches the bounded failure placeholder', async () => {
    await choose('無封面'); mode = 'delayed';
    await waitForDelayedRefresh();
    await page.getByText('封面暫時無法顯示', { exact: true }).waitFor({ timeout: 17000 });
    assert.equal(await page.locator('.etf-report-cover img').count(), 0);
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: passed.length, groups: passed, pageErrors: errors, environment: 'isolated local fixture; generated test pixels; no database or research publication' }));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
