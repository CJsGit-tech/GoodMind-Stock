import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarDays, emptyCalendar, eventDay, eventTime, mergeCalendar, parseCalendarBundle } from '../../shared/investment-calendar.ts';

const raw = readFileSync(new URL('../../samples/investment-calendar.json', import.meta.url), 'utf8');
const bundle = parseCalendarBundle(raw);
const now = '2026-10-24T09:00:00Z';
test('manual sample retains nine events, three official sources and explicit usage evidence', () => {
  assert.equal(bundle.events.length, 9); assert.equal(bundle.sources.length, 3);
  for (const source of bundle.sources) { assert.ok(source.usageBasis); assert.ok(new URL(source.usageUrl).protocol === 'https:'); }
  assert.equal(bundle.events.filter(event => event.precision === 'date_only').length, 1);
});
test('IANA display handles summer, winter and Taiwan midnight crossing', () => {
  const summer = bundle.events.find(event => event.id === 'bea-202609-pio')!;
  const winter = bundle.events.find(event => event.id === 'bea-202610-pio')!;
  const decision = bundle.events.find(event => event.id === 'fed-202610-decision')!;
  assert.equal(eventTime(summer, 'Asia/Taipei'), '20:30');
  assert.equal(eventTime(winter, 'Asia/Taipei'), '21:30');
  assert.equal(eventDay(decision, 'Asia/Taipei'), '2026-10-29');
  assert.equal(eventTime(decision, 'Asia/Taipei'), '02:00');
  assert.equal(eventDay(decision, 'America/New_York'), '2026-10-28');
  assert.equal(eventTime(decision, 'America/New_York'), '14:00');
});
test('unknown time remains null and retains original date range', () => {
  const meeting = bundle.events.find(event => event.id === 'fed-202610-meeting')!;
  assert.equal(meeting.startsAt, null); assert.equal(meeting.sourceDate, '2026-10-27'); assert.equal(meeting.sourceEndDate, '2026-10-28');
  const bad = structuredClone(bundle); bad.events[2].startsAt = '2026-10-27T00:00:00Z';
  assert.throws(() => parseCalendarBundle(JSON.stringify(bad)), /午夜/);
});
test('reimport is idempotent; reschedule preserves identity and historical source evidence', () => {
  const initial = mergeCalendar(emptyCalendar(), bundle, now);
  assert.equal(initial.added, 9); assert.equal(initial.state.revision, 1);
  const repeat = mergeCalendar(initial.state, bundle, now);
  assert.equal(repeat.updated, false); assert.equal(repeat.unchanged, 9);
  const changed = structuredClone(bundle); changed.events[0].sourceDate = '2026-11-02'; changed.events[0].startsAt = '2026-11-02T13:30:00Z';
  const result = mergeCalendar(initial.state, changed, now);
  assert.equal(result.changed, 1); assert.equal(result.state.events.length, 9);
  assert.equal(result.state.events.find(e => e.id === changed.events[0].id)!.history[0].previous.sourceDate, '2026-10-02');
  assert.equal(initial.state.events.find(e => e.id === changed.events[0].id)!.sourceDate, '2026-10-02');
});
test('database object-key ordering does not manufacture event or source revisions', () => {
  const initial = mergeCalendar(emptyCalendar(), bundle, now);
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
    return value;
  };
  const stored = reorder(initial.state) as typeof initial.state;
  const repeat = mergeCalendar(stored, bundle, now);
  assert.equal(repeat.updated, false);
  assert.equal(repeat.changed, 0);
  assert.equal(repeat.unchanged, 9);
  assert.equal(repeat.state.revision, 1);
});
test('invalid dates, offset mismatches, duplicate IDs, missing usage and unsafe links are rejected', () => {
  for (const change of [
    (value: any) => value.events[0].sourceDate = '2026-02-30',
    (value: any) => value.events[0].startsAt = '2026-10-02T25:30:00Z',
    (value: any) => value.events[0].sourceDate = '2026-10-03',
    (value: any) => value.events.push(value.events[0]),
    (value: any) => value.sources[0].usageBasis = '',
    (value: any) => value.sources[0].url = 'javascript:alert(1)',
    (value: any) => value.events[0].sourceTimezone = 'unrecognized-zone',
  ]) { const value = structuredClone(bundle); change(value); assert.throws(() => parseCalendarBundle(JSON.stringify(value))); }
});
test('calendar week cells cover leap days, year edges and full weeks without overflow', () => {
  const leap = calendarDays('2028-02'); assert.ok(leap.includes('2028-02-29')); assert.equal(leap.length % 7, 0);
  const january = calendarDays('2027-01'); assert.equal(january[0], '2026-12-28'); assert.equal(january.at(-1), '2027-01-31');
});
