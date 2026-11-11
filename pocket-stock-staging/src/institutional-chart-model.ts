export const FLOW_ACCOUNTS = ['foreign_ex_dealer', 'investment_trust', 'dealer_self', 'dealer_hedge'] as const;
export type FlowAccount = typeof FLOW_ACCOUNTS[number];
export type FlowUnit = 'lots' | 'value';
export type FlowStock = {
  market: string; stock_code: string; stock_name: string; sector_code: string; sector_name: string;
  trade_date: string; close?: number | null; price_date?: string | null; source_ids?: string[];
  accounts: Record<string, { net?: number | null; buy?: number | null; sell?: number | null } | undefined>;
};
export const finiteFlow = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A missing or differently dated close cannot turn an observed share count into an estimate. */
export function flowStockValue(stock: FlowStock, account: FlowAccount, unit: FlowUnit, researchDate = stock.trade_date): number | null {
  const net = stock.accounts[account]?.net;
  if (!finiteFlow(net) || stock.trade_date !== researchDate) return null;
  if (unit === 'lots') return net / 1000;
  if (!finiteFlow(stock.close) || stock.close <= 0 || stock.price_date !== researchDate) return null;
  const value = net * stock.close / 1e8;
  return finiteFlow(value) ? value : null;
}

/** Call with the whole market before applying any search, sector or pagination. */
export function flowHeatScale(stocks: FlowStock[], unit: FlowUnit, researchDate: string): number {
  let maximum = 0;
  for (const stock of stocks) for (const account of FLOW_ACCOUNTS) {
    const value = flowStockValue(stock, account, unit, researchDate);
    if (value !== null) maximum = Math.max(maximum, Math.abs(value));
  }
  return maximum;
}

export function filterFlowStocks(stocks: FlowStock[], options: {
  market: string; sector: string; query: string; account: FlowAccount; unit: FlowUnit;
  sort: 'buy' | 'sell' | 'code'; researchDate: string;
}): FlowStock[] {
  const query = options.query.trim().toLocaleLowerCase();
  return stocks.filter(stock => stock.market === options.market && (!options.sector || stock.sector_code === options.sector)
    && (!query || stock.stock_code.toLocaleLowerCase().includes(query) || stock.stock_name.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      const byCode = a.stock_code.localeCompare(b.stock_code);
      if (options.sort === 'code') return byCode;
      const av = flowStockValue(a, options.account, options.unit, options.researchDate);
      const bv = flowStockValue(b, options.account, options.unit, options.researchDate);
      if (av === null) return bv === null ? byCode : 1;
      if (bv === null) return -1;
      return (options.sort === 'buy' ? bv - av : av - bv) || byCode;
    });
}

export function flowStockPage(stocks: FlowStock[], requestedPage: number, pageSize = 20) {
  const pageCount = Math.max(1, Math.ceil(stocks.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  const offset = (page - 1) * pageSize;
  return { page, pageCount, count: stocks.length, start: stocks.length ? offset + 1 : 0,
    end: Math.min(offset + pageSize, stocks.length), rows: stocks.slice(offset, offset + pageSize) };
}
