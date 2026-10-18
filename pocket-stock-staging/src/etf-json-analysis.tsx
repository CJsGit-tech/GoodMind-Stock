import { createElement, type ReactNode } from 'react';
import { analysisText, type AnalysisToken, type EtfAnalysis } from '../shared/etf-analysis';
import { isSafeMarkdownUrl } from '../shared/etf-markdown';

function renderTokens(tokens: AnalysisToken[], sourceJump: (href: string) => void): ReactNode[] {
  const root: ReactNode[] = [];
  const stack: { token: AnalysisToken; children: ReactNode[] }[] = [];
  const append = (node: ReactNode) => (stack.at(-1)?.children || root).push(node);
  for (const [i, token] of tokens.entries()) {
    if (token.type === 'inline') { append(renderTokens(token.children || [], sourceJump)); continue; }
    if (token.nesting === 1) { stack.push({ token, children: [] }); continue; }
    if (token.nesting === -1) {
      const frame = stack.pop();
      if (!frame) continue; // The shared validator rejects malformed trees before storage and preview.
      const opened = frame.token;
      if (opened.type === 'link_open') {
        const href = opened.attrs?.href || '';
        append(!isSafeMarkdownUrl(href) ? frame.children : href.startsWith('#')
          ? <button key={i} type='button' className='md-source-jump' onClick={() => sourceJump(href)}>{frame.children}</button>
          : <a key={i} href={href} target='_blank' rel='noopener noreferrer'>{frame.children}<span className='sr-only'>（開啟新分頁）</span></a>);
      } else {
        const allowedTags = ['p', 'h3', 'h4', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote'];
        if (!allowedTags.includes(opened.tag)) { append(frame.children); continue; }
        const tag = opened.semantic === 'data_highlight' ? 'mark' : opened.tag;
        append(createElement(tag, { key: i, ...(opened.semantic === 'data_highlight' ? { className: 'md-data-highlight' } : {}) }, frame.children));
      }
    } else if (token.type === 'hardbreak') append(<br key={i} />);
    else if (token.type === 'softbreak') append(' ');
    else if (token.type === 'code_inline') append(<code key={i}>{token.content || ''}</code>);
    else if (token.type === 'text') {
      const presentation = token.presentation;
      if (presentation?.role === 'company_name') append(<span key={i} className='md-company-name' data-stock-code={presentation.stock_code}>{token.content || ''}</span>);
      else if (presentation?.role === 'numeric' && Number.isFinite(presentation.value)) {
        const tone = presentation.value > 0 ? 'md-up' : presentation.value < 0 ? 'md-down' : 'md-zero';
        append(<span key={i} className={'md-analysis-number ' + tone} data-value={presentation.value}>{token.content || ''}</span>);
      } else append(token.content || '');
    }
  }
  return root;
}

// Reuse the reference HTML's label/value/context hierarchy from explicit tokens.
// Non-card structures keep the general token renderer instead of inferring metrics.
const hasNumericPresentation = (tokens: AnalysisToken[]): boolean => tokens.some(token =>
  token.presentation?.role === 'numeric' || !!token.children && hasNumericPresentation(token.children));
function JsonKeyMetrics({ tokens, sourceJump }: { tokens: AnalysisToken[]; sourceJump: (href: string) => void }) {
  const items: AnalysisToken[][] = [], remainder: AnalysisToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'list_item_open') {
      const item: AnalysisToken[] = [];
      let depth = 1;
      while (i + 1 < tokens.length && depth) {
        i++;
        if (tokens[i].type === 'list_item_open') depth++;
        if (tokens[i].type === 'list_item_close') depth--;
        if (depth) item.push(tokens[i]);
      }
      items.push(item);
    } else if (!['bullet_list_open', 'bullet_list_close', 'ordered_list_open', 'ordered_list_close'].includes(token.type)) remainder.push(token);
  }
  const cards = items.map(item => {
    const inline = item.filter(t => t.type === 'inline').flatMap(t => t.children || []);
    const spans: { start: number; end: number; semantic?: string }[] = [];
    for (let i = 0; i < inline.length; i++) {
      if (inline[i].type !== 'strong_open') continue;
      const start = i, semantic = inline[i].semantic;
      let depth = 1;
      while (i + 1 < inline.length && depth) { i++; if (inline[i].type === 'strong_open') depth++; if (inline[i].type === 'strong_close') depth--; }
      spans.push({ start, end: i, semantic });
    }
    const label = spans.find(s => !s.semantic), value = spans.find(s => s.semantic === 'data_highlight');
    if (!label || !value) return null;
    const context = inline.filter((_, i) => ![label, value].some(s => i >= s.start && i <= s.end));
    const title = analysisText(inline.slice(label.start + 1, label.end));
    // Preserve the approved legacy card treatment only when the entire card predates numeric markers.
    const tone = hasNumericPresentation(item) ? '' : title.startsWith('主要增配') ? 'up' : title.startsWith('主要減配') ? 'down' : 'neutral';
    return { title, value: inline.slice(value.start + 1, value.end), context: context.map(t => t.type === 'text' ? { ...t, content: t.content || '' } : t), tone };
  });
  if (!cards.length || cards.some(c => !c)) return <>{renderTokens(tokens, sourceJump)}</>;
  return <><dl className='md-json-figures' aria-label='關鍵數據'>{cards.map((card, i) => {
    // Empty text tokens may precede the list punctuation; preserve all authored words and links.
    let leading = true;
    const context = card!.context.map(token => {
      if (!leading || token.type !== 'text') { leading = false; return token; }
      const content = (token.content || '').replace(/^[：:。\s]+/, '');
      leading = !content;
      return { ...token, content };
    });
    if (context.at(-1)?.type === 'text') context[context.length - 1] = { ...context.at(-1)!, content: (context.at(-1)!.content || '').replace(/[。\s]+$/, '') };
    return <div key={i}><dt>{card!.title}</dt><dd className={['md-json-figure-value', card!.tone].filter(Boolean).join(' ')}><mark className='md-data-highlight'>{renderTokens(card!.value, sourceJump)}</mark></dd><dd className='md-json-figure-context'>{renderTokens(context, sourceJump)}</dd></div>;
  })}</dl>{renderTokens(remainder, sourceJump)}</>;
}

export function JsonAnalysis({ analysis, sourceJump }: { analysis: EtfAnalysis; sourceJump: (href: string) => void }) {
  return <div className='md-analysis md-json-analysis'>
    {analysis.sections.filter(s => s.id === 'intro' || s.id === 'key_metrics').map(s => <section key={s.id} className={s.id === 'key_metrics' ? 'md-json-key-metrics md-prose' : 'md-prose'}><h2>{s.title}</h2>{s.id === 'key_metrics' ? <JsonKeyMetrics tokens={s.tokens} sourceJump={sourceJump} /> : renderTokens(s.tokens, sourceJump)}</section>)}
    <div className='md-prose md-analysis-prose'>{analysis.sections.filter(s => s.id !== 'intro' && s.id !== 'key_metrics').map(s => <section key={s.id} className='md-analysis-section' data-analysis-kind={s.id === 'follow_conditions' ? 'follow-up' : 'main'}><h3>{s.title}</h3>{renderTokens(s.tokens, sourceJump)}</section>)}</div>
  </div>;
}
