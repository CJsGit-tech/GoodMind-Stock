// npx tsx <skill>/scripts/dates.test.ts
import { quoteStates } from './dates';
const cases: [string, string, boolean][] = [
  ['2026-09-30', '115年9月30日', true], ['2026-09-30', '115.9.30', true], ['2026-09-30', '民國115年09月30日', true],
  ['2026-09-30', '2026/9/30 公告', true], ['2026-09-30', '2026-09-30', true], ['2026-09-30', 'as of September 30, 2026', true],
  ['2026-09-30', '30 Sep 2026', true], ['2026-11-05', '2026/11/5 15:00開始', true], ['2026-11-05', '11/5 15:00開始', false],
  ['2025-12-31', '目前主要商品及服務項目', false], ['2025-12-31', '114年度年報', false], ['2025-12-31', '2025 annual report', false],
  ['2026-09-30', '2026年9月3日', false], ['2026-09-03', '2026年9月30日', false], ['2026-01-02', '版本 115.1.25', false],
  ['2026-09', '2026年9月', true], ['2026-09', 'September 2026', true], ['2026', '2026 roadmap', true], ['2026', '營收 12026 元', false],
];
let bad = 0;
for (const [d, q, want] of cases) if (quoteStates(d, [q]) !== want) { bad++; console.log(`FAIL ${d} | ${q} → expected ${want}`); }
console.log(`${cases.length - bad}/${cases.length} date cases pass`);
process.exit(bad ? 1 : 0);
