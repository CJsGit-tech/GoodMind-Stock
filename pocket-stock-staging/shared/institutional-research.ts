import { array, object, parseJson, invalid, InvalidMarkdown, markdownHash, isSafeMarkdownUrl, type MarkdownValidation, type MarkdownRecord } from './etf-markdown.ts';
export const INSTITUTIONAL_SOURCE_LIMIT = 4 * 1024 * 1024;
export const PRIMARY_GROUPS = [['TWSE', 'foreign_ex_dealer'], ['TPEx', 'foreign_ex_dealer'], ['TWSE', 'investment_trust'], ['TPEx', 'investment_trust']];
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v;
const finite = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v);
function text(v: unknown, path: string, max = 500) { if (typeof v !== 'string' || !v.trim() || v.length > max)
    invalid(path, '需要有效文字。'); }
export async function parseInstitutionalSource(raw: unknown): Promise<MarkdownValidation> {
    const warnings: MarkdownValidation['warnings'] = [];
    try {
        if (typeof raw !== 'string')
            invalid('source', '請選擇法人 data.json。');
        const original = raw as string, sourceBytes = new TextEncoder().encode(original).byteLength;
        if (sourceBytes > INSTITUTIONAL_SOURCE_LIMIT)
            invalid('source', '法人研究資料不得超過4 MiB。', 'source_too_large');
        const d = object(parseJson(original, 'source'), 'source');
        if (d.schema_version !== 'institutional-flows-1.0.0')
            invalid('schema_version', '請使用法人研究 institutional-flows-1.0.0 格式。', 'unsupported_version');
        const m = object(d.metadata, 'metadata');
        for (const k of ['report_id', 'article_title', 'article_summary', 'data_status'])
            text(m[k], 'metadata.' + k);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(m.report_id))
            invalid('metadata.report_id', '文章識別碼格式錯誤。');
        for (const k of ['research_date', 'data_checked_date'])
            if (!date(m[k]))
                invalid('metadata.' + k, '需要有效日期。');
        if (m.data_checked_date < m.research_date || m.timezone !== 'Asia/Taipei')
            invalid('metadata', '日期或時區不符。');
        if (m.content_type !== 'tw_institutional_flows' || m.data_format !== 'external_json' || m.report_format !== 'html_reads_json')
            invalid('metadata', '需要法人文章交接標記。');
        const handoff = object(m.publication_handoff, 'metadata.publication_handoff');
        if (handoff.contract_version !== '1.0.0' || handoff.target !== 'PocketStocks' || handoff.workflow !== 'author_review_then_publish' || JSON.stringify(handoff.files) !== JSON.stringify({ data: 'data.json', report: 'report.html', cover: 'cover.jpg' }))
            invalid('metadata.publication_handoff', '三檔交接契約不符。');
        if (JSON.stringify(m.primary_groups) !== JSON.stringify(PRIMARY_GROUPS))
            invalid('metadata.primary_groups', '本發布區塊需要外資／投信 × 上市／上櫃四組。');
        const sources = array(d.sources, 'sources'), registry: MarkdownRecord = {};
        for (const [i, s] of sources.entries()) {
            text(s.id, 'sources.id');
            if (registry[s.id])
                invalid('sources', '來源識別碼重複。');
            if (!isSafeMarkdownUrl(s.url) || !/^https?:/.test(s.url))
                invalid('sources.' + i, '來源連結必須為HTTP(S)。');
            registry[s.id] = s;
        }
        function refs(value: any, path: string) { if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !registry[id]))
            invalid(path, '引用來源不存在。'); }
        function walk(value: any, path: string) { if (!value || typeof value !== 'object')
            return; for (const [k, v] of Object.entries(value)) {
            if (k === 'source_ids')
                refs(v, path + '.' + k);
            else if (k === 'href' && (typeof v !== 'string' || !isSafeMarkdownUrl(v)))
                invalid(path + '.href', '連結格式不安全。');
            else
                walk(v, path + '.' + k);
        } }
        walk(d.analysis, 'analysis');
        walk(d.data, 'data');
        const sections = array(object(d.analysis, 'analysis').sections, 'analysis.sections');
        if (!sections.length)
            invalid('analysis', '文章內容不得為空。');
        for (const s of sections) {
            text(s.id, 'section.id');
            text(s.title, 'section.title');
            for (const b of array(s.blocks, 'section.blocks')) {
                if (!['paragraph', 'heading', 'list'].includes(b.type))
                    invalid('analysis.blocks', '不支援的文字區塊。');
                const runs = b.type === 'list' ? array(b.items, 'block.items').flatMap(i => array(i.runs, 'item.runs')) : array(b.runs, 'block.runs');
                for (const r of runs) {
                    if (typeof r.text !== 'string')
                        invalid('analysis.runs', '文字標記不完整。');
                    if (r.role === 'numeric' && (typeof r.value !== 'number' || !Number.isFinite(r.value)))
                        invalid('analysis.runs.value', '數字標記需要有限數值。');
                }
            }
        }
        const data = object(d.data, 'data');
        array(data.source_audit,'data.source_audit');
        if(array(m.methods,'metadata.methods').some(v=>typeof v!=='string'))invalid('metadata.methods','方法須為文字。');
        for (const k of ['market_totals', 'stock_trades', 'sector_summaries', 'weekly_trends', 'group_summaries'])
            array(data[k], 'data.' + k);
        const groups = data.group_summaries;
        if (groups.length !== 4 || new Set(groups.map((g: any) => g.market + '/' + g.institution)).size !== 4)
            invalid('group_summaries', '需要四組獨立觀察。');
        for (const [market, institution] of PRIMARY_GROUPS) {
            const g = groups.find((g: any) => g.market === market && g.institution === institution);
            if (!g || g.trade_date !== m.research_date)
                invalid('group_summaries', '組別或研究日不符。');
            const totals = data.market_totals.filter((r: any) => r.market === market && r.institution === institution && r.trade_date === m.research_date);
            if (totals.length !== 1 || g.official_market_net_twd !== totals[0].net)
                invalid('group_summaries', '四組官方市場金額不一致。');
            if (g.observed_stock_count !== data.stock_trades.filter((r: any) => r.market === market && r.accounts?.[institution]).length)
                invalid('group_summaries', '觀測股票覆蓋不一致。');
        }
        for (const row of data.market_totals) {
            if (!finite(row.net) || !finite(row.buy) || !finite(row.sell) || row.unit !== 'TWD' || row.metric_basis !== 'official_market_amount')
                invalid('market_totals', '市場金額口徑錯誤。');
            if (row.buy !== null && row.sell !== null && row.net !== row.buy - row.sell)
                invalid('market_totals', '買賣超計算不一致。');
        }
        const seen = new Set<string>();
        for (const row of data.stock_trades) {
            const key = row.market + '/' + row.stock_code;
            if (seen.has(key) || row.trade_date !== m.research_date || row.unit !== 'shares' || !row.accounts)
                invalid('stock_trades', '個股重複、日期或單位錯誤。');
            seen.add(key);
            for (const a of Object.values(row.accounts) as any[]) {
                if (!finite(a.net) || !finite(a.buy) || !finite(a.sell) || a.buy !== null && a.sell !== null && a.net !== a.buy - a.sell)
                    invalid('stock_trades.accounts', '個股買賣超計算錯誤。');
            }
        }
        for (const row of data.sector_summaries) {
            if (row.trade_date !== m.research_date || !finite(row.estimate_twd))
                invalid('sector_summaries', '產業日期或估值錯誤。');
        }
        for (const row of data.weekly_trends) {
            if (row.metric_basis !== 'official_market_amount' || row.unit !== 'TWD' || !finite(row.net) || !Array.isArray(row.observed_dates) || row.observed_dates.some((x: any) => !date(x) || x > m.research_date))
                invalid('weekly_trends', '週度金額、日期或口徑錯誤。');
        }
        const charts = array(d.charts, 'charts');
        for (const c of charts) {
            if (!Array.isArray(data[c.data_key]))
                invalid('charts', '圖表資料指向不存在。');
        }
        if (m.data_status !== 'complete')
            warnings.push({ path: 'metadata.data_status', code: 'partial_coverage', message: '觀測與價格部分覆蓋；請連同來源及缺口審閱。' });
        return { report: { format: 'institutional-json', institutionalData: d, storageSchemaVersion: 3, parserVersion: 'institutional-1.0.0/handoff-1.0.0', rawJson: original, rawMarkdown: '', articleMarkdown: '', sourceHash: await markdownHash(original), sourceBytes, expandedBytes: sourceBytes, id: m.report_id, title: m.article_title, excerpt: m.article_summary, period: { start: m.research_date, end: m.research_date }, evidenceDate: m.data_checked_date, frontmatter: m, shared: { source_registry: registry, metadata: m }, visualizations: [], warnings }, errors: [], warnings };
    }
    catch (e) {
        return { report: null, errors: [e instanceof InvalidMarkdown ? e.issue : { path: 'source', code: 'parse_error', message: '無法解析法人研究資料。' }], warnings };
    }
}
