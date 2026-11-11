import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterFlowStocks, flowHeatScale, flowStockPage, flowStockValue, type FlowStock } from '../src/institutional-chart-model.ts';

const day = '2026-10-27';
function stock(code: string, net: number | null, patch: Partial<FlowStock> = {}): FlowStock {
  return { market: 'TWSE', stock_code: code, stock_name: '公司' + code, sector_code: '24', sector_name: '半導體業',
    trade_date: day, price_date: day, close: 100, accounts: { foreign_ex_dealer: { net }, investment_trust: { net: 0 } }, ...patch };
}

test('shares and close estimates retain known zero, missing accounts and invalid or stale prices', () => {
  assert.equal(flowStockValue(stock('1', -1250), 'foreign_ex_dealer', 'lots'), -1.25);
  assert.equal(flowStockValue(stock('1', -1250), 'foreign_ex_dealer', 'value'), -.00125);
  assert.equal(flowStockValue(stock('1', 0), 'foreign_ex_dealer', 'value'), 0);
  assert.equal(flowStockValue(stock('1', null), 'foreign_ex_dealer', 'lots'), null);
  assert.equal(flowStockValue(stock('1', 20), 'dealer_self', 'lots'), null);
  for (const close of [null, undefined, 0, -1, NaN, Infinity]) {
    const row = stock('1', 0, { close });
    assert.equal(flowStockValue(row, 'foreign_ex_dealer', 'value'), null);
    assert.equal(flowStockValue(row, 'foreign_ex_dealer', 'lots'), 0);
  }
  assert.equal(flowStockValue(stock('1', 20, { price_date: '2026-10-22' }), 'foreign_ex_dealer', 'value'), null);
  assert.equal(flowStockValue(stock('1', 20, { trade_date: '2026-10-22' }), 'foreign_ex_dealer', 'lots', day), null);
});

test('the same-market scale includes every displayed account and stays fixed while filters change', () => {
  const rows = [stock('1001', 1000), stock('1002', -50000, { sector_code: '10' }),
    stock('1003', 1, { accounts: { investment_trust: { net: 100000 } } })];
  const maximum = flowHeatScale(rows, 'lots', day);
  assert.equal(maximum, 100);
  const result = filterFlowStocks(rows, { market: 'TWSE', sector: '24', query: '1001', account: 'foreign_ex_dealer', unit: 'lots', sort: 'buy', researchDate: day });
  assert.equal(result.length, 1);
  assert.equal(flowHeatScale(rows, 'lots', day), maximum);
  assert.equal(flowHeatScale(rows, 'value', day), .1);
  assert.equal(flowHeatScale([stock('0', null)], 'lots', day), 0);
});

test('numeric sorts use stable code ties, keep unknown values last in both directions, and never mutate input', () => {
  const rows = [stock('1003', 1000), stock('1001', 1000), stock('1002', -2000), stock('1004', null), stock('1005', 2000, { close: null })];
  const options = { market: 'TWSE', sector: '', query: '', account: 'foreign_ex_dealer' as const, unit: 'value' as const, researchDate: day };
  assert.deepEqual(filterFlowStocks(rows, { ...options, sort: 'buy' }).map(r => r.stock_code), ['1001', '1003', '1002', '1004', '1005']);
  assert.deepEqual(filterFlowStocks(rows, { ...options, sort: 'sell' }).map(r => r.stock_code), ['1002', '1001', '1003', '1004', '1005']);
  assert.deepEqual(rows.map(r => r.stock_code), ['1003', '1001', '1002', '1004', '1005']);
});

test('all rows remain reachable through pagination, and filtering clamps a stale last page', () => {
  const rows = Array.from({ length: 53 }, (_, i) => stock(String(1000 + i), i));
  const pages = [1, 2, 3].flatMap(page => flowStockPage(rows, page).rows);
  assert.equal(new Set(pages.map(r => r.stock_code)).size, 53);
  assert.deepEqual([flowStockPage(rows, 3).start, flowStockPage(rows, 3).end], [41, 53]);
  const narrowed = rows.filter(r => r.stock_code === '1052');
  assert.equal(flowStockPage(narrowed, 3).page, 1);
  assert.deepEqual(flowStockPage([], 99), { page: 1, pageCount: 1, count: 0, start: 0, end: 0, rows: [] });
});
