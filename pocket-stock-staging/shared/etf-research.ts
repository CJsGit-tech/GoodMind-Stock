import { parseEtfMarkdown, MAX_MARKDOWN_SOURCE_BYTES, MAX_MARKDOWN_EXPANDED_BYTES, markdownHash, InvalidMarkdown, invalid, object, array, parseJson, sources, validateRows, validateResearchMetadata, validateResearchShared, isSafeMarkdownUrl } from './etf-markdown.ts';
import type { MarkdownReport, MarkdownValidation, MarkdownIssue, MarkdownVisualization } from './etf-markdown.ts';
import { validateAnalysis, analysisText } from './etf-analysis.ts';

export const JSON_PARSER_VERSION = 'json-5.0.0/analysis-1.0.0';
export const researchSource = (report: MarkdownReport) => report.format === 'etf-json' ? report.rawJson || '' : report.rawMarkdown;
export const researchFilename = (report?: MarkdownReport | null) => report?.format === 'etf-json' ? 'data.json' : 'report.md';
export async function parseEtfResearchSource(raw: unknown): Promise<MarkdownValidation> {
  return typeof raw === 'string' && raw.trimStart().startsWith('{') ? parseEtfJson(raw) : parseEtfMarkdown(raw);
}
export async function parseEtfJson(raw: unknown): Promise<MarkdownValidation> {
  const warnings: MarkdownIssue[] = [];
  try {
    if (typeof raw !== 'string') invalid('source', '需要 data.json 原文。');
    const original = raw as string, sourceBytes = new TextEncoder().encode(original).byteLength;
    if (sourceBytes > MAX_MARKDOWN_SOURCE_BYTES) invalid('source', 'data.json 超過 512 KiB，不會截斷。', 'source_too_large');
    const data = object(parseJson(original, 'source'), 'source');
    if (data.schema_version !== '5.0.0') invalid('schema_version', '只支援 JSON 研究契約 5.0.0。', 'unsupported_version');
    const fm: Record<string, any> = { ...object(data.metadata, 'metadata'), schema_version: data.schema_version };
    validateResearchMetadata(fm, '5.0.0');
    if (typeof fm.article_title !== 'string' || !fm.article_title.trim() || fm.article_title.length > 300) invalid('metadata.article_title', '需要研究標題。');
    if (fm.data_format !== 'external_json' || fm.report_format !== 'html_reads_json') invalid('metadata', 'JSON／HTML來源標記不符5.0契約。');
    validateAnalysis(data.analysis, isSafeMarkdownUrl);
    const format = object(fm.analysis_format, 'metadata.analysis_format');
    const expectedFormat = { version: '1.0.0', syntax: 'typed_token_ast', data_highlight: 'explicit_semantic', paragraph_break: 'paragraph_open_close', softbreak: 'space', hardbreak: 'break' };
    for (const [key, value] of Object.entries(expectedFormat)) if (format[key] !== value) invalid('metadata.analysis_format.' + key, '分析格式宣告不符1.0契約。');
    if (JSON.stringify(format.section_order) !== JSON.stringify(data.analysis.sections.map(s => s.id))) invalid('metadata.analysis_format.section_order', '分析章節順序與宣告不一致。');
    const dashboard = object(data.dashboard, 'dashboard'), shared = object(dashboard.shared, 'dashboard.shared');
    const periodIds = validateResearchShared(fm, shared);
    for (const [id, source] of Object.entries(shared.source_registry) as [string, any][]) {
      if (!/^https?:\/\//i.test(source.url)) invalid('sources.' + id, '來源需為HTTP(S)。');
      const credentials = /^(?:authorization|password|secret|access_token|refresh_token|api_?key|token)$/i;
      if (Object.keys(source.request_params || {}).some(k => credentials.test(k)) || [...new URL(source.url).searchParams.keys()].some(k => credentials.test(k))) invalid('sources.' + id, '來源不得包含憑證。', 'unsafe_content');
    }
    const expected = ['industry_allocation_changes', 'stock_holding_changes', 'weekly_industry_allocation_trend'];
    const views = array(dashboard.visualizations, 'dashboard.visualizations');
    if (JSON.stringify(views.map(v => v.visualization_id)) !== JSON.stringify(expected)) invalid('dashboard.visualizations', '需要依序提供三組圖表。');
    const visualizations: MarkdownVisualization[] = views.map((value, i) => {
      const path = 'dashboard.visualizations[' + i + ']', v = object(value, path), shape = object(v.shape, path + '.shape'), rows = array(v.rows, path + '.rows');
      if (v.visualization_id !== shape.visualization_id) invalid(path, '圖表識別不一致。');
      for (const k of ['title', 'purpose', 'suggested_chart']) if (typeof v[k] !== 'string') invalid(path + '.' + k, '需要文字欄位。');
      const ids = sources(v.source_ids, shared.source_registry, path + '.source_ids');
      const expanded = validateRows(shape, rows, shared, ids, path);
      if (v.visualization_id === expected[2] && expanded.records.some(r => !periodIds.has(r.period_id))) invalid(path, '圖表週期間不存在。');
      return { id: v.visualization_id, title: v.title, purpose: v.purpose, suggestedChart: v.suggested_chart, shape, rows, sourceIds: ids, ...expanded };
    });
    if (data.navigation !== undefined) for (const [i, nav] of array(data.navigation, 'navigation').entries()) {
      if (typeof nav.href !== 'string' || !/^\.\.\/[^/?#]+\/report\.html$/.test(nav.href) || typeof nav.label !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nav.date)) invalid('navigation[' + i + ']', '跨日期導覽需為受限的相對報告連結。');
    }
    const expandedBytes = new TextEncoder().encode(JSON.stringify({ shared, visualizations, analysis: data.analysis })).byteLength;
    if (expandedBytes > MAX_MARKDOWN_EXPANDED_BYTES) invalid('dashboard', '展開內容超過4 MiB。', 'expanded_too_large');
    if (fm.data_status !== 'complete') warnings.push({ path: 'metadata.data_status', code: 'partial_coverage', message: '資料部分覆蓋，請審閱來源與缺口。' });
    if (shared.weekly_periods.filter((p: any) => p.complete).length < 2) warnings.push({ path: 'weekly', code: 'insufficient_complete_weeks', message: '完整可比週少於兩週，不足以主張趨勢。' });
    return { report: { format: 'etf-json', storageSchemaVersion: 3, parserVersion: JSON_PARSER_VERSION, rawMarkdown: '', articleMarkdown: '', rawJson: original, analysis: data.analysis, sourceHash: await markdownHash(original), sourceBytes, expandedBytes, id: fm.report_id, title: fm.article_title.trim(), excerpt: data.analysis.sections.map(s => analysisText(s.tokens)).join(' ').trim().slice(0, 280), period: { start: fm.baseline_date, end: fm.research_date }, evidenceDate: fm.data_checked_date, frontmatter: fm, shared, visualizations, warnings }, errors: [], warnings };
  } catch (caught) {
    const e = caught as Error & { analysisPath?: string };
    const issue = caught instanceof InvalidMarkdown ? caught.issue : e.analysisPath ? { path: e.analysisPath, message: e.message, code: 'invalid_analysis' } : { path: 'source', message: '無法解析data.json，請檢查結構。', code: 'parse_error' };
    return { report: null, errors: [issue], warnings };
  }
}
