// Scripted GoodMind v2 demo tour. Captures CDP screencast frames with timestamps.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? 'frames');
const DRY = process.argv.includes('--dry');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const W = 1440, H = 900, BASE = 'http://localhost:3100';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const sleep = ms => page.waitForTimeout(ms);

// Caption bar + click ripple injected on every page.
await page.addInitScript(() => {
  const css = `#demo-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:99999;max-width:900px;
    padding:14px 26px;border-radius:14px;background:rgba(8,10,24,.86);border:1px solid rgba(140,160,255,.35);
    color:#eef;font:600 22px/1.35 -apple-system,"PingFang TC",system-ui,sans-serif;text-align:center;
    box-shadow:0 10px 40px rgba(0,0,0,.5);transition:opacity .35s;opacity:0;pointer-events:none}
    #demo-cap small{display:block;font-weight:400;font-size:16px;color:#aab;margin-top:4px}
    #demo-card{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:radial-gradient(circle at 50% 40%,#1b1f4a,#05060f 70%);color:#fff;font-family:-apple-system,"PingFang TC",system-ui,sans-serif;transition:opacity .6s}
    #demo-card h1{font-size:64px;margin:0 0 12px;letter-spacing:.5px} #demo-card p{font-size:26px;color:#b8bfff;margin:6px}
    #demo-card ul{font-size:22px;color:#dde;line-height:1.7;margin-top:24px}
    .demo-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #9fb0ff;z-index:99998;
    pointer-events:none;animation:dr .7s ease-out forwards}@keyframes dr{from{transform:scale(.3);opacity:1}to{transform:scale(1.8);opacity:0}}`;
  const add = () => { if (document.getElementById('demo-style')) return; const s = document.createElement('style'); s.id = 'demo-style'; s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'demo-cap'; document.body.appendChild(c); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add) : add();
  window.__cap = (t, sub) => { add(); const c = document.getElementById('demo-cap'); if (!t) { c.style.opacity = 0; return; } c.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); c.style.opacity = 1; };
  window.__card = (html) => { add(); let d = document.getElementById('demo-card'); if (!html) { if (d) { d.style.opacity = 0; setTimeout(() => d.remove(), 650); } return; }
    if (!d) { d = document.createElement('div'); d.id = 'demo-card'; document.body.appendChild(d); } d.innerHTML = html; d.style.opacity = 1; };
  window.__ripple = (x, y) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 800); };
});
const cap = (t, sub) => page.evaluate(([t, sub]) => window.__cap(t, sub), [t, sub ?? '']);
const card = html => page.evaluate(h => window.__card(h), html);
async function click(loc) {
  await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox();
  if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.evaluate(([x, y]) => window.__ripple(x, y), [b.x + b.width / 2, b.y + b.height / 2]); }
  await loc.click();
}

// Screencast capture.
const frames = [];
let cdp;
async function startCapture() {
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const f = path.join(OUT, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
}
const shot = async name => DRY && page.screenshot({ path: path.join(OUT, `dry-${name}.png`) });

// ---- Load the app and let the galaxy settle before recording.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 60000 });
await sleep(14000);
const hideConsole = page.getByRole('button', { name: /Hide console/ });
if (await hideConsole.count()) await hideConsole.click();
await card(`<h1>✦ 股脈 GoodMind</h1><p>Knowledge graph · ontology v2</p><ul><li>Things — companies and what they sell</li><li>Groups — industry › segment › category</li><li>Facts — and suggested links you accept or reject</li></ul>`);
await startCapture();
await sleep(3500);
await card(null); await sleep(900);

// 1. Galaxy overview
await cap('303 companies, offerings, groups and records as a 3D galaxy', 'Solid lines are facts · dotted lines are suggestions');
await page.mouse.move(800, 450); await page.mouse.down(); await page.mouse.move(980, 420, { steps: 40 }); await page.mouse.up();
await sleep(3500); await shot('1-galaxy');

// 2. Group filter
await cap('Every company now sits in a group', 'Industry › segment › category');
const sel = page.getByLabel('Show one group');
await click(sel); await sleep(600);
await sel.selectOption('segment:industrial-edge-ai');
await sleep(1200);
await cap('Pick a group to see only its members', 'Industrial edge AI computers: companies, offerings and their links');
await sleep(5000); await shot('2-group');

// 3. Jump to Advantech
await cap('Open a company', 'Search for Advantech');
const jump = page.getByLabel('Jump to node');
await click(jump); await jump.pressSequentially('Advantech', { delay: 90 }); await sleep(700);
await click(page.locator('.jump li button').filter({ hasText: '研華 Advantech' }).first());
await sleep(2500);
await cap('The detail panel shows where it belongs', 'Group breadcrumbs: industry › segment');
await sleep(3500); await shot('3-dossier');

// 4. Suggestions
const sugHead = page.locator('.dossier-body h3', { hasText: 'Suggested links' });
await sugHead.scrollIntoViewIfNeeded(); await sleep(800);
await cap('Suggested links come from shared groups', 'Axiomtek 90% · AAEON 85% · NVIDIA may supply 65% — not facts yet');
await sleep(5000); await shot('4-suggestions');

// 5. Accept one
const card1 = page.locator('.suggs li').filter({ hasText: 'Axiomtek' }).first();
await card1.scrollIntoViewIfNeeded(); await sleep(500);
await cap('Accept turns a suggestion into a real record', 'Marked analyst-inferred, with evidence from both sides');
await sleep(1500);
if (!DRY) { await click(card1.getByRole('button', { name: /Accept/ })); }
await sleep(4500); await shot('5-accepted');
await cap('A new competition record now links the two companies', 'Reject hides a suggestion for good');
await sleep(4000);

// 6. Strength filter
const close = page.locator('.dossier .close, button[aria-label="Close"]').first();
if (await close.count()) await click(close); else await page.keyboard.press('Escape');
await sleep(1200);
const clearGroup = page.getByLabel('Clear group');
if (await clearGroup.count()) await click(clearGroup);
await sleep(1500);
await cap('Control how many suggestions you see', 'Strong ≥70% · Likely ≥50% (default) · All');
const strong = page.locator('.seg.strength button', { hasText: 'Strong' });
if (await strong.count()) { await click(strong); await sleep(2500); await click(page.locator('.seg.strength button', { hasText: 'All' })); await sleep(2500); await click(page.locator('.seg.strength button', { hasText: 'Likely' })); }
await sleep(2500); await shot('6-strength');

// 7. Ontology workspace
await cap('The Ontology page shows the whole group tree');
await click(page.getByRole('link', { name: 'Ontology' }));
await sleep(2500);
const treeHead = page.locator('h2', { hasText: 'Where everything belongs' });
await treeHead.scrollIntoViewIfNeeded(); await page.mouse.wheel(0, -80); await sleep(1000);
await cap('10 industries · 31 segments', 'Arrows show the value chain: what one segment makes goes into another');
await sleep(3000); await page.mouse.wheel(0, 300); await sleep(2500); await shot('7-tree');

// 8. Review queue
const rev = page.locator('h2', { hasText: 'Links to review' });
await rev.scrollIntoViewIfNeeded(); await page.mouse.wheel(0, -60); await sleep(1000);
await cap('Links to review: one queue for every suggestion', 'Who may compete · who may supply');
await sleep(3000);
await click(page.locator('.review-bar button', { hasText: 'Who may supply' })); await sleep(2500);
await click(page.locator('.review-bar button', { hasText: 'Who may compete' })); await sleep(2500); await shot('8-review');

// End card
await cap(null);
await card(`<h1>✦ GoodMind v2</h1><p>Things · Groups · Facts</p><ul><li>Every company placed in an industry › segment › category</li><li>Competitor and supplier links suggested from shared groups</li><li>Nothing becomes a fact until you accept it</li></ul>`);
await sleep(4000);

if (cdp) await cdp.send('Page.stopScreencast');
await sleep(300);
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames));
console.log('frames', frames.length, frames.length ? (frames.at(-1).t - frames[0].t).toFixed(1) + 's' : '');
await browser.close();
