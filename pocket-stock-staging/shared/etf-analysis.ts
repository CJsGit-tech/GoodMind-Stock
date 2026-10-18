export type AnalysisPresentation =
  | { role: 'company_name'; stock_code: string }
  | { role: 'numeric'; value: number };
export type AnalysisToken = {
  type: string; tag: string; nesting: number; content?: string;
  semantic?: 'data_highlight'; attrs?: { href: string }; children?: AnalysisToken[]; lines?: number[];
  presentation?: AnalysisPresentation;
};
export type EtfAnalysis = { format_version: '1.0.0'; sections: { id: string; title: string; tokens: AnalysisToken[] }[] };
export const ANALYSIS_SECTIONS = ['key_metrics', 'allocation_analysis', 'follow_conditions', 'weekly_context'];
const paired: Record<string, string[]> = { paragraph: ['p'], heading: ['h3', 'h4'], strong: ['strong'], em: ['em'], link: ['a'], bullet_list: ['ul'], ordered_list: ['ol'], list_item: ['li'], blockquote: ['blockquote'] };
export function validateAnalysis(value: any, safeUrl: (url: string) => boolean): asserts value is EtfAnalysis {
  const fail = (path: string, message: string): never => { throw Object.assign(new Error(message), { analysisPath: path }); };
  if (!value || value.format_version !== '1.0.0' || !Array.isArray(value.sections)) fail('analysis', '不支援的分析格式。');
  const ids = value.sections.map((section: any) => section?.id);
  if (![JSON.stringify(ANALYSIS_SECTIONS), JSON.stringify(['intro', ...ANALYSIS_SECTIONS])].includes(JSON.stringify(ids))) fail('analysis.sections', '分析章節需依序為關鍵數據、操作分析、跟進條件與週度背景。');
  let count = 0;
  const tokens = (items: unknown, path: string, depth = 0) => {
    if (!Array.isArray(items) || depth > 12) fail(path, '需要有效的分析 token 陣列。');
    const stack: { base: string; tag: string; semantic?: string }[] = [];
    for (const [i, token] of (items as any[]).entries()) {
      const p = path + '[' + i + ']';
      if (++count > 20000 || !token || typeof token !== 'object') fail(p, '分析資料過大或格式不正確。');
      if (Object.hasOwn(token, 'presentation')) {
        const presentation = token.presentation, presentationPath = p + '.presentation';
        if (token.type !== 'text' || typeof token.content !== 'string' || !token.content.trim()) fail(presentationPath, '文字呈現標記只接受有內容的 text 葉節點。');
        if (Object.keys(token).some(key => !['type', 'tag', 'nesting', 'content', 'presentation', 'lines'].includes(key))) fail(presentationPath, '文字呈現節點不接受樣式、HTML 或其他額外欄位。');
        if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation) || Object.getPrototypeOf(presentation) !== Object.prototype) fail(presentationPath, '文字呈現標記必須為一般物件。');
        const keys = Object.keys(presentation).sort().join(',');
        if (presentation.role === 'company_name') {
          if (keys !== 'role,stock_code' || typeof presentation.stock_code !== 'string' || !/^\d{4,6}[A-Za-z]?$/.test(presentation.stock_code)) fail(presentationPath, '公司名稱呈現標記需要有效台股代碼，且不可包含額外欄位。');
        } else if (presentation.role === 'numeric') {
          if (keys !== 'role,value' || typeof presentation.value !== 'number' || !Number.isFinite(presentation.value)) fail(presentationPath, '數值呈現標記需要有限數字，且不可包含額外欄位。');
        } else fail(presentationPath, '不支援的文字呈現角色。');
      }
      const pair = typeof token.type === 'string' && token.type.match(/^(.+)_(open|close)$/);
      if (pair && paired[pair[1]]) {
        if (!paired[pair[1]].includes(token.tag) || token.nesting !== (pair[2] === 'open' ? 1 : -1)) fail(p, '分析標記型別、標籤或巢狀值不符。');
        if (token.semantic !== undefined && (token.semantic !== 'data_highlight' || pair[1] !== 'strong')) fail(p, '數據重點只接受明確的 strong 標記。');
        if (pair[2] === 'open') stack.push({ base: pair[1], tag: token.tag, semantic: token.semantic });
        else { const opened = stack.pop(); if (!opened || opened.base !== pair[1] || opened.tag !== token.tag || opened.semantic !== token.semantic) fail(p, '分析開啟／關閉標記不成對。'); }
        if (token.type === 'link_open' && (typeof token.attrs?.href !== 'string' || !safeUrl(token.attrs.href))) fail(p + '.attrs.href', '分析連結只接受安全 HTTP(S) 或內部錨點。');
      } else if (['inline', 'text', 'softbreak', 'hardbreak', 'code_inline'].includes(token.type)) {
        if (token.nesting !== 0 || token.semantic !== undefined || token.tag !== (token.type === 'code_inline' ? 'code' : token.type === 'hardbreak' ? 'br' : '')) fail(p, '分析葉節點標記不正確。');
        if (token.content !== undefined && typeof token.content !== 'string') fail(p + '.content', '文字內容必須為字串。');
      } else fail(p, '不支援的分析 token；不接受 HTML。');
      if (token.children !== undefined) { if (token.type !== 'inline') fail(p, '只有 inline 可包含子 token。'); tokens(token.children, p + '.children', depth + 1); }
    }
    if (stack.length) fail(path, '分析標記未關閉。');
  };
  for (const [i, section] of value.sections.entries()) {
    const path = 'analysis.sections[' + i + ']';
    if (typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200) fail(path + '.title', '需要章節標題。');
    tokens(section.tokens, path + '.tokens');
    if (section.id === 'key_metrics' && section.tokens.filter((t: any) => t.type === 'list_item_open').length > 3) fail(path, '關鍵數據最多三項。');
  }
}
export function analysisText(tokens: AnalysisToken[]): string {
  return tokens.map(token => token.children ? analysisText(token.children) : ['text', 'code_inline'].includes(token.type) ? token.content || '' : ['softbreak', 'hardbreak', 'paragraph_close'].includes(token.type) ? ' ' : '').join('');
}
