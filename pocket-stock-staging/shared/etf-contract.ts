export interface SourceLink {
  label: string;
  url: string;
  eventDate: string | null;
}

export interface Fund {
  code: string;
  name: string;
  aumBillion: number | null;
  rankAsOf: string | null;
  holdingsDate: string | null;
  coverage: string;
  sourceUrl: string;
}

export interface FlowRow {
  etf: string;
  code: string;
  name: string;
  sector: string;
  deltaLots: number | null;
  weightDeltaPp: number | null;
  estimateNtd: number | null;
  sourceUrl: string;
  sourceDate: string;
}

export interface Comment {
  title: string;
  text: string;
  sources: SourceLink[];
}

export interface OperatingEvidence {
  code: string;
  name: string;
  metrics: { label: string; value: string; period: string }[];
  eventDate: string | null;
  sourceUrl: string;
}

export interface HoldingRow {
  code: string;
  name: string;
  sector: string;
  market: string | null;
  weightPct: number | null;
  weightUpperBoundPct: number | null;
  weightRaw: string;
  shares: number | null;
}

export interface HoldingFund {
  etf: string;
  date: string;
  sourceUrl: string;
  note: string;
  rows: HoldingRow[];
  currentComplete?: boolean;
  baseline?: {
    date: string;
    sourceUrl: string;
    complete: boolean;
    rows: HoldingRow[];
  };
}

export interface Institutional {
  date: string;
  marketScope: string;
  marketUnit: 'TWD';
  stockUnit: 'shares';
  market: {
    foreign: number | null;
    trust: number | null;
    dealer: number | null;
    hedge: number | null;
    total: number | null;
  };
  stocks: {
    code: string;
    name: string;
    market: string;
    foreignShares: number | null;
    trustShares: number | null;
    dealerShares: number | null;
    hedgeShares: number | null;
    sourceUrl: string;
  }[];
  sources: SourceLink[];
}

export interface EtfReport {
  schemaVersion: 1;
  id: string;
  reportType: 'flows';
  title: string;
  excerpt: string;
  period: { start: string; end: string };
  evidenceDate: string;
  funds: Fund[];
  rows: FlowRow[];
  summary: Comment[];
  operations: OperatingEvidence[];
  sampleNote: string;
  warnings: string[];
  holdings?: HoldingFund[];
  institutional?: Institutional;
}

export interface Entry {
  archived?: boolean;
  id: string;
  draft: EtfReport;
  revision: number;
  updatedAt: string;
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
}

export interface ReportSummary {
  id: string;
  title: string;
  excerpt: string;
  period: { start: string; end: string };
  evidenceDate: string;
  publishedAt: string;
  version: number;
}

export interface ReportValidation {
  report?: EtfReport;
  errors: string[];
  warnings: string[];
  counts: { [etf: string]: number };
}

export const MAX_REPORT_BYTES = 180 * 1024;

export const REPORT_UNITS = {
  aumBillion: 'TWD billion',
  deltaLots: '1000 shares',
  weightDeltaPp: 'percentage points',
  estimateNtd: 'TWD',
  shares: 'shares',
  institutionalMarket: 'TWD',
} as const;

export function isReportId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$/.test(value);
}

export function jsonByteSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string'
      ? new TextEncoder().encode(serialized).byteLength
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// JSON.parse alone silently accepts duplicate object keys. Walk the exact raw
// input first, decoding key escapes before comparing them.
export function parseReportJson(raw: string, maxBytes = MAX_REPORT_BYTES): unknown {
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error('研究資料超過 180 KiB。');
  }

  let offset = 0;

  function fail(message: string): never {
    throw new Error(message + '（第 ' + String(offset + 1) + ' 字元）');
  }

  function whitespace() {
    while (/\s/.test(raw[offset] ?? '') && offset < raw.length) {
      offset += 1;
    }
  }

  function stringToken(): string {
    const start = offset;
    offset += 1;
    let escaped = false;

    while (offset < raw.length) {
      const char = raw[offset++];
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        try {
          return JSON.parse(raw.slice(start, offset)) as string;
        } catch {
          return fail('JSON 字串格式錯誤');
        }
      }
    }

    return fail('JSON 字串未結束');
  }

  function walk(depth: number): void {
    if (depth > 40) fail('JSON 巢狀層數過多');
    whitespace();
    const char = raw[offset];

    if (char === '{') {
      offset += 1;
      whitespace();
      const keys = new Set<string>();

      if (raw[offset] === '}') {
        offset += 1;
        return;
      }

      while (offset < raw.length) {
        if (raw[offset] !== '"') fail('JSON 欄位名稱格式錯誤');
        const key = stringToken();

        if (keys.has(key)) fail('JSON 含重複欄位');
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          fail('JSON 含不允許的欄位');
        }

        keys.add(key);
        whitespace();
        if (raw[offset++] !== ':') fail('JSON 欄位缺少冒號');
        walk(depth + 1);
        whitespace();

        if (raw[offset] === '}') {
          offset += 1;
          return;
        }

        if (raw[offset++] !== ',') fail('JSON 物件格式錯誤');
        whitespace();
      }

      fail('JSON 物件未結束');
    } else if (char === '[') {
      offset += 1;
      whitespace();

      if (raw[offset] === ']') {
        offset += 1;
        return;
      }

      while (offset < raw.length) {
        walk(depth + 1);
        whitespace();

        if (raw[offset] === ']') {
          offset += 1;
          return;
        }

        if (raw[offset++] !== ',') fail('JSON 陣列格式錯誤');
      }

      fail('JSON 陣列未結束');
    } else if (char === '"') {
      stringToken();
    } else {
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
          raw.slice(offset)
        );

      if (!token) fail('JSON 值格式錯誤');
      offset += token[0].length;
    }
  }

  walk(0);
  whitespace();
  if (offset !== raw.length) fail('JSON 含多餘內容');

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('JSON 格式錯誤。');
  }
}

export function validateReport(input: unknown): ReportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: { [etf: string]: number } = {};

  const addError = (path: string, message: string) => {
    if (errors.length < 40) errors.push(path + '：' + message);
  };

  const addWarning = (message: string) => {
    if (warnings.length < 40 && !warnings.includes(message)) {
      warnings.push(message);
    }
  };

  let parsed: unknown;

  try {
    parsed = typeof input === 'string' ? parseReportJson(input) : input;
  } catch (caught) {
    return {
      errors: [
        caught instanceof Error ? caught.message : 'JSON 格式錯誤。',
      ],
      warnings,
      counts,
    };
  }

  if (jsonByteSize(parsed) > MAX_REPORT_BYTES) {
    return { errors: ['研究資料超過 180 KiB。'], warnings, counts };
  }

  function object(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      addError(path, '需要物件');
      return {};
    }
    return value as Record<string, unknown>;
  }

  function list(
    value: unknown,
    path: string,
    maximum: number,
    minimum = 0
  ): unknown[] {
    if (
      !Array.isArray(value) ||
      value.length < minimum ||
      value.length > maximum
    ) {
      addError(
        path,
        '筆數必須介於 ' + String(minimum) + ' 與 ' + String(maximum)
      );
      return [];
    }
    return value;
  }

  function text(
    value: unknown,
    path: string,
    maximum = 1000,
    required = true
  ): string {
    if (typeof value !== 'string') {
      addError(path, '需要文字');
      return '';
    }

    const result = value.trim();

    if ((required && !result) || Array.from(result).length > maximum) {
      addError(path, '文字缺漏或超過長度限制');
    }

    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(result)) {
      addError(path, '含不允許的控制字元');
    }

    if (/<\/?[A-Za-z][^>]*>/u.test(result)) {
      addError(path, '只接受純文字，不接受 HTML');
    }

    return result;
  }

  function code(value: unknown, path: string): string {
    const result = text(value, path, 12);
    if (!/^[A-Z0-9]{3,12}$/.test(result)) {
      addError(path, '代碼格式錯誤');
    }
    return result;
  }

  function numberOrNull(
    value: unknown,
    path: string,
    minimum = -Number.MAX_SAFE_INTEGER,
    maximum = Number.MAX_SAFE_INTEGER,
    integer = false
  ): number | null {
    if (value === null) return null;

    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isSafeInteger(value))
    ) {
      addError(path, '數值、範圍或單位格式錯誤；未知值請使用 null');
      return null;
    }

    return value;
  }

  function date(
    value: unknown,
    path: string,
    nullable = false
  ): string | null {
    if (nullable && value === null) return null;

    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      addError(path, '需要 YYYY-MM-DD 日期');
      return nullable ? null : '';
    }

    const timestamp = Date.parse(value + 'T00:00:00Z');

    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    ) {
      addError(path, '日期不存在');
    }

    return value;
  }

  function url(value: unknown, path: string): string {
    const result = text(value, path, 2048);

    try {
      const candidate = new URL(result);

      if (
        !['http:', 'https:'].includes(candidate.protocol) ||
        !candidate.hostname ||
        candidate.username ||
        candidate.password
      ) {
        addError(path, '只接受不含登入資料的 http(s) 來源網址');
      }
    } catch {
      addError(path, '來源網址格式錯誤');
    }

    return result;
  }

  function sources(value: unknown, path: string): SourceLink[] {
    return list(value, path, 40).map((item, index) => {
      const row = object(item, path + '[' + index + ']');
      const at = path + '[' + index + ']';

      return {
        label: text(row.label, at + '.label', 120),
        url: url(row.url, at + '.url'),
        eventDate: date(row.eventDate, at + '.eventDate', true),
      };
    });
  }

  function readHoldingRows(
    value: unknown,
    pathRoot: string
  ): HoldingRow[] {
    const seenStocks = new Set<string>();
    const holdingRows: HoldingRow[] =
      list(value, pathRoot, 1000).map((itemRow, stockIndex) => {
        const stock = object(
          itemRow,
          pathRoot + '[' + stockIndex + ']'
        );
        const path = pathRoot + '[' + stockIndex + ']';
        const stockCode = code(stock.code, path + '.code');

        if (seenStocks.has(stockCode)) {
          addError(path + '.code', '持股代碼重複');
        }

        seenStocks.add(stockCode);

        const weightPct = numberOrNull(
          stock.weightPct,
          path + '.weightPct',
          0,
          100
        );

        const weightUpperBoundPct = numberOrNull(
          stock.weightUpperBoundPct,
          path + '.weightUpperBoundPct',
          0,
          100
        );

        const shares = numberOrNull(
          stock.shares,
          path + '.shares',
          0,
          Number.MAX_SAFE_INTEGER,
          true
        );

        if (
          weightPct !== null &&
          weightUpperBoundPct !== null &&
          weightPct > weightUpperBoundPct
        ) {
          addError(path, '權重不能大於揭露上限');
        }

        return {
          code: stockCode,
          name: text(stock.name, path + '.name', 100),
          sector: text(stock.sector, path + '.sector', 100),
          market: stock.market === null
            ? null
            : text(stock.market, path + '.market', 50),
          weightPct,
          weightUpperBoundPct,
          weightRaw: text(
            stock.weightRaw,
            path + '.weightRaw',
            100,
            false
          ),
          shares,
        };
      });

    if (
      holdingRows.reduce(
        (total, row) => total + (row.weightPct ?? 0),
        0
      ) > 100.5
    ) {
      addError(pathRoot, '已知持股權重合計超過 100%');
    }

    return holdingRows;
  }

  const root = object(parsed, 'report');

  if (root.schemaVersion !== 1) {
    addError('schemaVersion', '只支援版本 1');
  }
  if (root.reportType !== 'flows') {
    addError('reportType', '只支援 flows');
  }
  if (!isReportId(root.id)) {
    addError('id', '報告 ID 格式錯誤');
  }
  if ('units' in root) {
    addError('units', '單位由欄位定義，不能覆寫');
  }

  for (const key of [
    'heatmap',
    'matrix',
    'counts',
    'sectorTotals',
    'html',
    'rawHtml',
  ]) {
    if (key in root) {
      addError(
        key,
        '此欄位不接受匯入；圖表由原始 rows 推導'
      );
    }
  }

  const period = object(root.period, 'period');
  const start = date(period.start, 'period.start') ?? '';
  const end = date(period.end, 'period.end') ?? '';
  const evidenceDate = date(root.evidenceDate, 'evidenceDate') ?? '';

  if (start && end && start > end) {
    addError('period', '起日不能晚於迄日');
  }

  const funds: Fund[] =
    list(root.funds, 'funds', 5, 5).map((item, index) => {
      const row = object(item, 'funds[' + index + ']');
      const at = 'funds[' + index + ']';

      const rankAsOf = row.rankAsOf === null
        ? null
        : text(row.rankAsOf, at + '.rankAsOf', 80);

      if (rankAsOf) {
        date(rankAsOf.slice(0, 10), at + '.rankAsOf');
      }

      const result = {
        code: code(row.code, at + '.code'),
        name: text(row.name, at + '.name', 100),
        aumBillion: numberOrNull(
          row.aumBillion,
          at + '.aumBillion',
          0
        ),
        rankAsOf,
        holdingsDate: date(
          row.holdingsDate,
          at + '.holdingsDate',
          true
        ),
        coverage: text(row.coverage, at + '.coverage', 1000),
        sourceUrl: url(row.sourceUrl, at + '.sourceUrl'),
      };

      if (result.aumBillion === null || !result.rankAsOf) {
        addWarning(
          '選樣規模或排行日期未齊，不能宣稱已核定目標日前五大排行。'
        );
      }

      if (result.holdingsDate && result.holdingsDate !== end) {
        addWarning(
          '基金持股日期與研究迄日不同，請保留逐基金日期。'
        );
      }

      return result;
    });

  const fundCodes = new Set(funds.map(fund => fund.code));

  if (fundCodes.size !== funds.length) {
    addError('funds', '基金代碼重複');
  }

  for (const fund of funds) counts[fund.code] = 0;

  const unique = new Set<string>();
  const sectors = new Map<string, string>();

  const rows: FlowRow[] =
    list(root.rows, 'rows', 1000, 1).map((item, index) => {
      const row = object(item, 'rows[' + index + ']');
      const at = 'rows[' + index + ']';

      for (const key of [
        'units',
        'deltaUnit',
        'weightUnit',
        'estimateUnit',
      ]) {
        if (key in row) {
          addError(at + '.' + key, '不能覆寫欄位單位');
        }
      }

      const result = {
        etf: code(row.etf, at + '.etf'),
        code: code(row.code, at + '.code'),
        name: text(row.name, at + '.name', 100),
        sector: text(row.sector, at + '.sector', 100),
        deltaLots: numberOrNull(
          row.deltaLots,
          at + '.deltaLots'
        ),
        weightDeltaPp: numberOrNull(
          row.weightDeltaPp,
          at + '.weightDeltaPp',
          -100,
          100
        ),
        estimateNtd: numberOrNull(
          row.estimateNtd,
          at + '.estimateNtd'
        ),
        sourceUrl: url(row.sourceUrl, at + '.sourceUrl'),
        sourceDate: date(row.sourceDate, at + '.sourceDate') ?? '',
      };

      if (!fundCodes.has(result.etf)) {
        addError(at + '.etf', '不在選樣基金中');
      }

      const key = result.etf + ':' + result.code;

      if (unique.has(key)) {
        addError(at, 'ETF × 股票唯一鍵重複');
      }

      unique.add(key);
      const existingSector = sectors.get(result.code);

      if (existingSector && existingSector !== result.sector) {
        addError(at + '.sector', '同一股票只能有一個主分組');
      }

      sectors.set(result.code, result.sector);

      if (fundCodes.has(result.etf)) counts[result.etf] += 1;

      if (result.deltaLots === null) {
        addWarning(
          '部分股數異動未知，不可當成零或推定增減方向。'
        );
      }

      if (result.sourceDate !== end) {
        addWarning(
          '部分異動來源日期與研究迄日不同，請逐筆標示。'
        );
      }

      return result;
    });

  const summary: Comment[] =
    list(root.summary, 'summary', 12, 1).map((item, index) => {
      const row = object(item, 'summary[' + index + ']');
      const at = 'summary[' + index + ']';

      const result = {
        title: text(row.title, at + '.title', 180),
        text: text(row.text, at + '.text', 18000),
        sources: sources(row.sources, at + '.sources'),
      };

      if (!result.sources.length) {
        addWarning(
          '部分評論未列直接來源，請在發布前確認事實與推論。'
        );
      }

      return result;
    });

  const operations: OperatingEvidence[] =
    list(root.operations, 'operations', 100).map((item, index) => {
      const row = object(item, 'operations[' + index + ']');
      const at = 'operations[' + index + ']';

      return {
        code: code(row.code, at + '.code'),
        name: text(row.name, at + '.name', 100),
        metrics: list(row.metrics, at + '.metrics', 20).map(
          (metric, metricIndex) => {
            const data = object(
              metric,
              at + '.metrics[' + metricIndex + ']'
            );
            const metricPath =
              at + '.metrics[' + metricIndex + ']';

            return {
              label: text(data.label, metricPath + '.label', 120),
              value: text(data.value, metricPath + '.value', 500),
              period: text(data.period, metricPath + '.period', 120),
            };
          }
        ),
        eventDate: date(row.eventDate, at + '.eventDate', true),
        sourceUrl: url(row.sourceUrl, at + '.sourceUrl'),
      };
    });

  if (!operations.length) {
    addWarning('營運證據尚缺，對照區需顯示缺口。');
  }

  const inputWarnings =
    list(root.warnings, 'warnings', 80).map((value, index) =>
      text(value, 'warnings[' + index + ']', 1000)
    );

  const report: EtfReport = {
    schemaVersion: 1,
    id: isReportId(root.id) ? root.id : '',
    reportType: 'flows',
    title: text(root.title, 'title', 180),
    excerpt: text(root.excerpt, 'excerpt', 1200),
    period: { start, end },
    evidenceDate,
    funds,
    rows,
    summary,
    operations,
    sampleNote: text(root.sampleNote, 'sampleNote', 3000),
    warnings: [],
  };

  if (root.holdings !== undefined) {
    const seenFunds = new Set<string>();

    report.holdings =
      list(root.holdings, 'holdings', 5).map((item, index) => {
        const data = object(item, 'holdings[' + index + ']');
        const at = 'holdings[' + index + ']';
        const etf = code(data.etf, at + '.etf');

        if (!fundCodes.has(etf) || seenFunds.has(etf)) {
          addError(at + '.etf', '基金不在選樣中或重複');
        }

        seenFunds.add(etf);

        const holdingRows = readHoldingRows(data.rows, at + '.rows');
        const currentDate = date(data.date, at + '.date') ?? '';

        if (
          data.currentComplete !== undefined &&
          typeof data.currentComplete !== 'boolean'
        ) {
          addError(at + '.currentComplete', '需要布林值');
        }

        const result: HoldingFund = {
          etf,
          date: currentDate,
          sourceUrl: url(data.sourceUrl, at + '.sourceUrl'),
          note: text(data.note, at + '.note', 2000, false),
          rows: holdingRows,
          ...(typeof data.currentComplete === 'boolean'
            ? { currentComplete: data.currentComplete }
            : {}),
        };

        if (data.baseline !== undefined) {
          const baseline = object(data.baseline, at + '.baseline');
          const baselineDate =
            date(baseline.date, at + '.baseline.date') ?? '';

          if (typeof baseline.complete !== 'boolean') {
            addError(at + '.baseline.complete', '需要布林值');
          }

          if (
            baselineDate &&
            currentDate &&
            baselineDate >= currentDate
          ) {
            addError(
              at + '.baseline.date',
              '前期持股日期必須早於目前持股日期'
            );
          }

          result.baseline = {
            date: baselineDate,
            sourceUrl: url(
              baseline.sourceUrl,
              at + '.baseline.sourceUrl'
            ),
            complete: baseline.complete === true,
            rows: readHoldingRows(
              baseline.rows,
              at + '.baseline.rows'
            ),
          };
        } else {
          addWarning(
            '部分持股缺少前期快照，不可計算兩端差額或宣稱新進／退出。'
          );
        }

        return result;
      });
  }

  if (root.institutional !== undefined) {
    const data = object(root.institutional, 'institutional');
    const market = object(data.market, 'institutional.market');

    if (data.marketUnit !== 'TWD') {
      addError('institutional.marketUnit', '必須為 TWD');
    }

    if (data.stockUnit !== 'shares') {
      addError('institutional.stockUnit', '必須為 shares');
    }

    const seenStocks = new Set<string>();

    report.institutional = {
      date: date(data.date, 'institutional.date') ?? '',
      marketScope: text(
        data.marketScope,
        'institutional.marketScope',
        500
      ),
      marketUnit: 'TWD',
      stockUnit: 'shares',
      market: {
        foreign: numberOrNull(
          market.foreign,
          'institutional.market.foreign'
        ),
        trust: numberOrNull(
          market.trust,
          'institutional.market.trust'
        ),
        dealer: numberOrNull(
          market.dealer,
          'institutional.market.dealer'
        ),
        hedge: numberOrNull(
          market.hedge,
          'institutional.market.hedge'
        ),
        total: numberOrNull(
          market.total,
          'institutional.market.total'
        ),
      },
      stocks: list(
        data.stocks,
        'institutional.stocks',
        1000
      ).map((item, index) => {
        const stock = object(
          item,
          'institutional.stocks[' + index + ']'
        );
        const at = 'institutional.stocks[' + index + ']';
        const stockCode = code(stock.code, at + '.code');

        if (seenStocks.has(stockCode)) {
          addError(at + '.code', '法人個股代碼重複');
        }

        seenStocks.add(stockCode);

        return {
          code: stockCode,
          name: text(stock.name, at + '.name', 100),
          market: text(stock.market, at + '.market', 50),
          foreignShares: numberOrNull(
            stock.foreignShares,
            at + '.foreignShares',
            -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
            true
          ),
          trustShares: numberOrNull(
            stock.trustShares,
            at + '.trustShares',
            -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
            true
          ),
          dealerShares: numberOrNull(
            stock.dealerShares,
            at + '.dealerShares',
            -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
            true
          ),
          hedgeShares: numberOrNull(
            stock.hedgeShares,
            at + '.hedgeShares',
            -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
            true
          ),
          sourceUrl: url(stock.sourceUrl, at + '.sourceUrl'),
        };
      }),
      sources: sources(data.sources, 'institutional.sources'),
    };
  }

  const knownRootKeys = new Set([
    'schemaVersion',
    'id',
    'reportType',
    'title',
    'excerpt',
    'period',
    'evidenceDate',
    'funds',
    'rows',
    'summary',
    'operations',
    'sampleNote',
    'warnings',
    'holdings',
    'institutional',
  ]);

  if (Object.keys(root).some(key => !knownRootKeys.has(key))) {
    addWarning('未支援的額外欄位不會儲存或公開。');
  }

  report.warnings =
    [...new Set([...inputWarnings, ...warnings])].slice(0, 80);

  if (jsonByteSize(report) > MAX_REPORT_BYTES) {
    addError('report', '正規化資料超過 180 KiB');
  }

  return {
    ...(errors.length ? {} : { report }),
    errors,
    warnings: report.warnings,
    counts,
  };
}
