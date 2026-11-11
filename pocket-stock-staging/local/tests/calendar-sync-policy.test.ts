import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyCalendar, mergeCalendar, parseCalendarBundle } from '../../shared/investment-calendar.ts';
import { addDays, calendarResearchSources, officialPublisher, prepareCalendarResearch } from '../calendar-sync-policy.ts';
import { runCalendarSync } from '../calendar-sync.ts';

const now = new Date('2026-10-25T02:00:00Z');
function researchFixture() {
  return { schemaVersion: 1, sources: [{ id: 'bea', name: 'BEA', url: 'https://www.bea.gov/news/schedule/full', checkedAt: now.toISOString(), usageBasis: 'Official public-domain date facts.', usageUrl: 'https://www.bea.gov/help/faq/147' }],
    observations: [{ kind: 'bea.pio', period: '2026-10', sourceId: 'bea', sourceDate: '2026-11-25', startsAt: '2026-11-25T13:30:00Z', precision: 'exact', confirmation: 'confirmed', status: 'scheduled', evidence: 'November 25 8:30 AM Personal Income and Outlays, October 2026' }] };
}
test('research produces a bounded source plan, canonical IDs and quarter-specific titles', () => {
  const sourcePlan = calendarResearchSources(now);
  assert.equal(sourcePlan.start, '2026-10-18'); assert.equal(sourcePlan.upcomingStart, '2026-10-25'); assert.equal(sourcePlan.endExclusive, '2026-12-24');
  assert.equal(sourcePlan.urls.length, 8); assert.equal(sourcePlan.maximumPageReads, 32);
  const first = prepareCalendarResearch(emptyCalendar(), JSON.stringify(researchFixture()), now);
  assert.equal(first.bundle!.events[0].id, 'bea-202610-pio'); assert.equal(first.added, 1);
  const research = researchFixture(); research.observations[0].kind = 'bea.gdp.third'; research.observations[0].period = '2026-Q4';
  assert.equal(prepareCalendarResearch(emptyCalendar(), JSON.stringify(research), now).bundle!.events[0].title, 'GDP 第四季第三次估計');
});
test('same official event preserves manual source ID and notes; changed time is quarantined', () => {
  const sample = parseCalendarBundle(readFileSync(new URL('../../samples/investment-calendar.json', import.meta.url), 'utf8'));
  const state = mergeCalendar(emptyCalendar(), sample, now.toISOString()).state;
  const plan = prepareCalendarResearch(state, JSON.stringify(researchFixture()), now);
  assert.equal(plan.added, 0); assert.equal(plan.unchanged, 1); assert.equal(plan.bundle!.events[0].sourceId, 'bea-calendar');
  const research = researchFixture(); research.observations[0].startsAt = '2026-11-25T14:00:00Z';
  const changed = prepareCalendarResearch(state, JSON.stringify(research), now);
  assert.equal(changed.bundle, null); assert.equal(changed.review.length, 1);
  assert.equal(state.events.find(e => e.id === 'bea-202610-pio')!.startsAt, '2026-11-25T13:30:00.000Z');
  const legacy = structuredClone(state); legacy.events.find(e => e.id === 'bea-202610-pio')!.id = 'manual-pce';
  assert.equal(prepareCalendarResearch(legacy, JSON.stringify(researchFixture()), now).bundle!.events[0].id, 'manual-pce');
});
test('cancelled and estimated observations require review even for new events', () => {
  for (const field of ['status', 'confirmation'] as const) {
    const input = researchFixture(); input.observations[0][field] = field === 'status' ? 'cancelled' : 'estimated';
    const plan = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
    assert.equal(plan.bundle, null); assert.equal(plan.review.length, 1);
  }
});
test('60-day interval excludes the end boundary without deleting old records', () => {
  const input = researchFixture(); input.observations[0].sourceDate = addDays('2026-10-25', 60); input.observations[0].startsAt = input.observations[0].sourceDate + 'T13:30:00Z';
  const plan = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
  assert.equal(plan.bundle, null); assert.equal(plan.outsideWindow.length, 1);
});
test('unapproved hosts, lookalikes, paths, credentials, usage and publisher mismatch fail closed', () => {
  for (const url of ['https://www.bea.gov.evil.test/news/schedule/full', 'https://user:pass@www.bea.gov/news/schedule/full', 'http://www.bea.gov/news/schedule/full', 'https://www.bea.gov/news/schedule/full?redirect=x', 'https://www.bea.gov/unapproved', 'https://www.bea.gov/news/schedule/full#x']) assert.throws(() => officialPublisher(url));
  const input = researchFixture(); input.sources[0].usageUrl = 'https://unapproved.test/terms';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now), /使用依據/);
  const mismatch = researchFixture(); mismatch.observations[0].kind = 'bls.cpi';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(mismatch), now), /機構/);
});
test('stale/future evidence, duplicate events and missing proof are rejected', () => {
  const input = researchFixture(); input.sources[0].checkedAt = '2026-10-23T02:00:00Z';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now), /24/);
  input.sources[0].checkedAt = '2026-10-26T02:00:00Z';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now), /未來/);
  const duplicate = researchFixture(); duplicate.observations.push({ ...duplicate.observations[0] });
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(duplicate), now), /重複/);
  const missing = researchFixture(); missing.observations[0].evidence = '';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(missing), now), /證據/);
});
test('capacity limits fail without deleting or changing the original state', () => {
  const sample = parseCalendarBundle(readFileSync(new URL('../../samples/investment-calendar.json', import.meta.url), 'utf8'));
  const state = mergeCalendar(emptyCalendar(), sample, now.toISOString()).state;
  state.events = Array.from({ length: 100 }, (_, index) => ({ ...state.events[0], id: `saved-${index}`, period: `legacy ${index}` }));
  const before = JSON.stringify(state);
  assert.throws(() => prepareCalendarResearch(state, JSON.stringify(researchFixture()), now), /100/);
  assert.equal(JSON.stringify(state), before);
});
function companyResearch(publisher = 'msft', date = '2026-10-28', period = '2027-Q1') {
  const urls: Record<string, string> = { msft: 'https://www.microsoft.com/en-us/investor/default', amzn: 'https://ir.aboutamazon.com/overview/default.aspx', googl: 'https://abc.xyz/investor/', meta: 'https://investor.atmeta.com/investor-events/' };
  return { schemaVersion: 1, sources: [{ id: 'company', name: publisher, url: urls[publisher], checkedAt: now.toISOString(), usageBasis: 'Official date facts only.', usageUrl: 'https://www.copyright.gov/help/faq/faq-protect.html' }], observations: [{ kind: `${publisher}.call`, period, sourceId: 'company', sourceDate: date, startsAt: null, precision: 'date_only', confirmation: 'confirmed', status: 'scheduled', evidence: 'Official IR calendar explicitly announces this date.' }] };
}
test('the four CSPs are mandatory and release dates remain separate from calls and fiscal years', () => {
  const plan = calendarResearchSources(now);
  for (const publisher of ['msft', 'amzn', 'googl', 'meta']) {
    assert.ok(plan.mandatoryPublishers.includes(publisher));
    const input = companyResearch(publisher, publisher === 'meta' ? '2026-10-21' : '2026-10-28', publisher === 'msft' ? '2027-Q1' : '2026-Q3');
    const result = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
    assert.equal(result.added, 1); assert.equal(result.bundle!.events[0].category, 'csp');
    assert.equal(result.bundle!.events[0].startsAt, null);
  }
  const input = companyResearch();
  input.observations.push({ ...input.observations[0], kind: 'msft.earnings' });
  const result = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
  assert.deepEqual(result.bundle!.events.map(event => event.id), ['msft-2027q1-call', 'msft-2027q1-earnings']);
  assert.match(result.bundle!.events[0].period, /^FY2027/);
});
test('Pacific winter time is validated and corporate-lookalike and cross-company sources fail', () => {
  const input = companyResearch('amzn', '2026-11-03', '2026-Q3');
  const exact = { ...input, observations: [{ ...input.observations[0], startsAt: '2026-11-03T22:00:00Z', precision: 'exact' }] };
  const result = prepareCalendarResearch(emptyCalendar(), JSON.stringify(exact), now);
  assert.equal(result.bundle!.events[0].sourceTimezone, 'America/Los_Angeles');
  assert.equal(result.bundle!.events[0].startsAt, '2026-11-03T22:00:00.000Z');
  for (const url of ['https://abc.xyz.evil.test/investor/', 'https://www.microsoft.com.evil.test/en-us/investor/default', 'https://ir.aboutamazon.com/overview/default.aspx?redirect=x', 'https://abc.xyz/unapproved']) assert.throws(() => officialPublisher(url));
  input.observations[0].kind = 'msft.call';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now), /機構/);
});
test('Taiwan sources retain Taipei dates and seven-day lookback does not fabricate dates', () => {
  const input = { schemaVersion: 1, sources: [{ id: 'cbc', name: 'CBC', url: 'https://www.cbc.gov.tw/tw/cp-432-189514-82841-1.html', checkedAt: now.toISOString(), usageBasis: 'Open government data.', usageUrl: 'https://www.cbc.gov.tw/tw/cp-307-36676-DE020-1.html' }], observations: [{ kind: 'cbc.meeting', period: '2026-12', sourceId: 'cbc', sourceDate: '2026-12-17', startsAt: null, precision: 'date_only', confirmation: 'confirmed', status: 'scheduled', evidence: 'Official annual schedule: December 17, 2026.' }] };
  const result = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
  assert.equal(result.bundle!.events[0].sourceTimezone, 'Asia/Taipei');
  assert.equal(result.bundle!.events[0].category, 'central_bank');
  assert.equal(result.bundle!.events[0].startsAt, null);
  const old = companyResearch('meta', '2026-10-17', '2026-Q3');
  assert.equal(prepareCalendarResearch(emptyCalendar(), JSON.stringify(old), now).outsideWindow.length, 1);
  const unknown = companyResearch('meta'); unknown.observations[0].sourceDate = '';
  assert.throws(() => prepareCalendarResearch(emptyCalendar(), JSON.stringify(unknown), now));
});
test('cloud field order does not create spurious review differences', () => {
  const input = companyResearch();
  const first = prepareCalendarResearch(emptyCalendar(), JSON.stringify(input), now);
  const saved = mergeCalendar(emptyCalendar(), first.bundle!, now.toISOString()).state;
  saved.events = saved.events.map(event => Object.fromEntries(Object.entries(event).reverse()) as typeof event);
  const repeat = prepareCalendarResearch(saved, JSON.stringify(input), now);
  assert.equal(repeat.review.length, 0); assert.equal(repeat.unchanged, 1);
});
test('production review-file validates without localhost, credentials, or network writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-production-review-'));
  try {
    const researchPath = join(directory, 'research.json'), statePath = join(directory, 'state.json');
    writeFileSync(researchPath, JSON.stringify(companyResearch()));
    writeFileSync(statePath, JSON.stringify(emptyCalendar()));
    const result = await runCalendarSync(['review-file', researchPath, statePath], { directory, now });
    assert.equal(result.offline, true); assert.equal(result.added, 1);
    assert.equal(JSON.parse(readFileSync(join(directory, 'production/import.json'), 'utf8')).events[0].id, 'msft-2027q1-call');
    assert.equal(JSON.parse(readFileSync(join(directory, 'production/review.json'), 'utf8')).baseRevision, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
