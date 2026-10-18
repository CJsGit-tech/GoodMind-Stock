import type { Root, RootContent, PhrasingContent, Paragraph, Text } from 'mdast';

const financialNumber = /[+−-]?\d[\d,]*(?:\.\d+)?(?:億元|萬元|元|張|倍|百分點|%|％)/g;
const followUpTitle = /跟進|追蹤條件|觀察條件|反證/;
const plainText = (nodes: PhrasingContent[]): string => nodes.map(node => 'value' in node ? node.value : 'children' in node ? plainText(node.children as PhrasingContent[]) : '').join('');

function paragraph(children: PhrasingContent[], className?: string): Paragraph {
  return { type: 'paragraph', children, ...(className ? { data: { hProperties: { className: [className] } } } : {}) };
}

// Work on parsed text, never the Markdown source or URLs. Dates and ETF codes are not financial highlights.
function highlight(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.flatMap(node => {
    if (node.type === 'link' || node.type === 'inlineCode' || node.type === 'image') return [node];
    if (node.type !== 'text') {
      return ['strong', 'emphasis', 'delete'].includes(node.type) && 'children' in node
        ? [{ ...node, children: highlight(node.children as PhrasingContent[]) } as PhrasingContent] : [node];
    }
    const result: PhrasingContent[] = [];
    let end = 0;
    for (const match of node.value.matchAll(financialNumber)) {
      if (match.index! > end) result.push({ type: 'text', value: node.value.slice(end, match.index) });
      result.push({ type: 'strong', children: [{ type: 'text', value: match[0] }], data: { hName: 'mark', hProperties: { className: ['md-data-highlight'] } } });
      end = match.index! + match[0].length;
    }
    if (end < node.value.length) result.push({ type: 'text', value: node.value.slice(end) });
    return result;
  });
}

function readingParagraphs(nodes: PhrasingContent[]): Paragraph[] {
  const blocks: Paragraph[] = [];
  let body: PhrasingContent[] = [], sources: PhrasingContent[] = [];
  const flushBody = () => { if (plainText(body).trim() || body.some(n => n.type !== 'text')) blocks.push(paragraph(highlight(body))); body = []; };
  const flushSources = () => { if (sources.length) blocks.push(paragraph([{ type: 'text', value: '來源：' }, ...sources], 'md-prose-sources')); sources = []; };
  for (const node of nodes) {
    if (node.type === 'link' && (sources.length > 0 || !body.length || /[。！？]$/.test(plainText(body).trimEnd()))) {
      flushBody();
      if (sources.length) sources.push({ type: 'text', value: ' · ' });
      sources.push(node);
    } else if (sources.length && node.type === 'text' && /^[\s·、]*$/.test(node.value)) {
      // Adjacent source separators are rendered once by flushSources.
    } else {
      flushSources();
      body.push(node);
    }
  }
  flushBody(); flushSources();
  return blocks;
}

function emphasizeOpening(node: Paragraph) {
  const opening: PhrasingContent[] = [], rest: PhrasingContent[] = [];
  let complete = false;
  for (const child of node.children) {
    if (complete) { rest.push(child); continue; }
    const stop = child.type === 'text' ? child.value.indexOf('。') : -1;
    if (child.type === 'text' && stop >= 0) {
      opening.push({ ...child, value: child.value.slice(0, stop + 1) });
      if (stop + 1 < child.value.length) rest.push({ ...child, value: child.value.slice(stop + 1) });
      complete = true;
    } else opening.push(child);
  }
  if (complete) node.children = [{ type: 'strong', children: opening }, ...rest];
}

/** A presentation-only Markdown adapter shared by published reading and Author preview. */
export function remarkAnalysisReading() {
  return (tree: Root) => {
    const blocks: RootContent[] = [];
    for (const node of tree.children) {
      if (node.type !== 'paragraph') { blocks.push(node); continue; }
      let children = node.children;
      const first = children[0];
      // Older reports use a short bold prefix instead of an actual section heading.
      if (first?.type === 'strong' && first.children.every(child => child.type === 'text')) {
        const title = plainText(first.children).trim().replace(/[。．：:]$/, '');
        if (title && title.length <= 24 && children.length > 1) {
          blocks.push({ type: 'heading', depth: 3, children: [{ type: 'text', value: title }] });
          children = children.slice(1);
          if (children[0]?.type === 'text') children = [{ ...children[0], value: children[0].value.trimStart() } as Text, ...children.slice(1)];
        }
      }
      blocks.push(...readingParagraphs(children));
    }

    const result: RootContent[] = [];
    let section: RootContent[] | null = null;
    let title = '';
    let followUpPlaced = false;
    const flushSection = () => {
      if (!section) return;
      const opening = section.find(node => node.type === 'paragraph');
      if (opening?.type === 'paragraph' && !opening.data?.hProperties?.className) emphasizeOpening(opening);
      const followUp = followUpTitle.test(title) && !followUpPlaced;
      followUpPlaced ||= followUp;
      result.push({ type: 'blockquote', children: section as import('mdast').BlockContent[], data: { hName: 'section', hProperties: { className: ['md-analysis-section'], 'data-analysis-kind': followUp ? 'follow-up' : 'main' } } });
      section = null;
    };
    for (const node of blocks) {
      if (node.type === 'heading' && node.depth <= 3) {
        flushSection(); title = plainText(node.children); section = [node];
      } else if (section) section.push(node);
      else result.push(node);
    }
    flushSection();
    tree.children = result;
  };
}
