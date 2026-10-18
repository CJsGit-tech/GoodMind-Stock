import { markdownFixtureParts } from './etf-markdown-fixture.ts';
export function jsonFixtureParts(id = 'qa-json-report') {
  const p = markdownFixtureParts(id);
  const paragraph = [
    { type: 'paragraph_open', tag: 'p', nesting: 1 },
    { type: 'inline', tag: '', nesting: 0, children: [
      { type: 'text', tag: '', nesting: 0, content: '合成資料 999；明確重點 ' },
      { type: 'strong_open', tag: 'strong', nesting: 1, semantic: 'data_highlight' },
      { type: 'text', tag: '', nesting: 0, content: '100元' },
      { type: 'strong_close', tag: 'strong', nesting: -1, semantic: 'data_highlight' },
    ] },
    { type: 'paragraph_close', tag: 'p', nesting: -1 },
  ];
  const sections = ['key_metrics', 'allocation_analysis', 'follow_conditions', 'weekly_context'];
  return {
    schema_version: '5.0.0',
    metadata: { ...p.shared.metadata, article_title: '合成 JSON 研究', data_format: 'external_json', report_format: 'html_reads_json', analysis_format: { version: '1.0.0', syntax: 'typed_token_ast', data_highlight: 'explicit_semantic', paragraph_break: 'paragraph_open_close', softbreak: 'space', hardbreak: 'break', section_order: sections } },
    analysis: { format_version: '1.0.0', sections: sections.map(id => ({ id, title: id, tokens: structuredClone(paragraph) })) },
    dashboard: { shared: p.shared, visualizations: p.visuals.map(v => ({ visualization_id: v.shape.visualization_id, title: '測試', purpose: '測試', suggested_chart: '測試圖表', shape: v.shape, rows: v.rows, source_ids: v.sources.source_ids })) },
  };
}
