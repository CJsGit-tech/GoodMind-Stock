// Sample content for local staging: a small published graph and one draft waiting for review.
// Everything here is fictional sample data except the four live-site book titles.
import { db } from '@appdeploy/sdk';
import type { Book, DraftPackage, GraphLink, GraphNode, NodeType } from '../shared/graph.ts';
import { T, aliasId, meta, nodeId, rebuildSnapshot, uploadDraft } from './store.ts';

const NODES: [string, NodeType, string[]?][] = [
  ['半導體', 'concept'], ['台積電', 'company', ['TSMC', '2330']], ['聯發科', 'company'], ['AI 伺服器', 'concept', ['AI server']], ['元大台灣50', 'etf', ['0050']], ['外資', 'inst'], ['三大法人', 'concept'],
  ['資料中心', 'concept'], ['電力設備', 'concept'], ['預製模組', 'concept'], ['機房驗收', 'concept'], ['營收認列', 'concept'], ['台達電', 'company', ['2308']],
  ['玻纖布', 'concept'], ['銅箔基板', 'concept'], ['電路板', 'concept'], ['富喬', 'company'], ['鋼構', 'concept'], ['鋼筋', 'concept'], ['科技廠擴建', 'concept'], ['東鋼', 'company'],
  ['FCC', 'concept'], ['檢測認證', 'concept'], ['實驗室', 'concept'], ['耕興', 'company'],
];
const BOOKS: (Omit<Book, 'publishedAt'> & { tags: string[] })[] = [
  { id: 'b-machine-room', title: '機房裝好了，為何還不能開機？', industry: 'AI資料中心與電力設備', date: '2026年11月9日', pages: 11, tags: ['資料中心', '電力設備', '預製模組', '機房驗收', '營收認列', '台達電'], excerpt: '橘寶想把模型機房點亮，卻發現買設備、接電、測試和營收各有自己的時間。Codey帶他從馬來西亞投資計畫走到台達的設備案例，再用一次停電演練，找出機房能開機之前還要完成的工作。' },
  { id: 'b-fuqiao', title: '富喬營收創高，為何淨利還會降？', industry: '玻纖布與電子材料', date: '2026年11月6日', pages: 11, tags: ['玻纖布', '銅箔基板', '電路板', '富喬'], excerpt: '橘寶與Codey從一卷玻纖布走進銅箔基板與電路板的供應鏈，理解客戶為何選材料、認證與良率如何影響生意，再對照富喬同口徑的單季數字。' },
  { id: 'b-dongsteel', title: '蓋科技廠，東鋼怎麼接到生意？', industry: '鋼鐵與鋼構', date: '2026年11月2日', pages: 11, tags: ['鋼構', '鋼筋', '科技廠擴建', '東鋼', '營收認列'], excerpt: '科技廠擴建如何變成鋼鐵公司的生意？橘寶與Codey從建築模型出發，沿著東鋼的鋼筋加工、型鋼與鋼構交付，追到實際收入組合與收款時間差。' },
  { id: 'b-fcc', title: 'FCC新規之後，耕興怎麼接案？', industry: '電子產品檢測認證', date: '2026年10月30日', pages: 12, tags: ['FCC', '檢測認證', '實驗室', '耕興', '營收認列'], excerpt: '從一台假設銷美的無線設備出發，跟著橘寶與Codey看懂實驗室、TCB與FCC的分工，說明資格、排程、履約和外部收入如何接起來。' },
  { id: 'b-semi', title: '半導體產業觀察', industry: '半導體', date: '2026年10月20日', pages: 10, sample: true, tags: ['聯發科', '半導體', '台積電', 'AI 伺服器'], excerpt: '示範文章：半導體族群與供應鏈的整理。' },
  { id: 'b-0050', title: '0050 持股變化', industry: '主動式ETF', date: '2026年10月12日', pages: 9, sample: true, tags: ['元大台灣50', '台積電'], excerpt: '示範文章：元大台灣50 的持股變化紀錄。' },
  { id: 'b-foreign', title: '外資入門', industry: '三大法人', date: '2026年10月5日', pages: 8, sample: true, tags: ['外資', '三大法人'], excerpt: '示範文章：外資與三大法人的基本介紹。' },
];
const ATTRS: [string, string, string][] = [
  ['台積電', '產業', '半導體'], ['聯發科', '產業', '半導體'], ['外資', '所屬', '三大法人'], ['台達電', '產業', '電力設備'], ['資料中心', '相關', 'AI 伺服器'],
  ['富喬', '產業', '玻纖布'], ['銅箔基板', '用於', '電路板'], ['東鋼', '產業', '鋼構'], ['耕興', '產業', '檢測認證'], ['電路板', '相關', '半導體'], ['科技廠擴建', '相關', '資料中心'], ['AI 伺服器', '相關', '資料中心'],
];
/** Draft #12: the review example from the approved design. */
export const SAMPLE_DRAFT: DraftPackage = {
  requestId: 'sample-draft-12', title: '外資買超台積電的觀察', industry: '三大法人', date: '2026年11月11日', pages: 11,
  excerpt: '外資買超台積電（TSMC，2330）連日出現，市場關注 AI 伺服器供應鏈的需求變化。',
  paragraphs: [
    [{ t: '外資買超', d: 'flow' }, { t: '台積電', d: 'tsmc' }, { t: '（' }, { t: 'TSMC', d: 'TSMC' }, { t: '，' }, { t: '2330', d: '2330' }, { t: '）連日出現，市場關注 ' }, { t: 'AI 伺服器供應鏈', d: 'aisup' }, { t: '的需求變化。' }],
    [{ t: '半導體', d: 'semi' }, { t: '族群中，' }, { t: '台積電', d: 'tsmc' }, { t: '的外資持股最受矚目。' }],
    [{ t: '外資買超', d: 'flow' }, { t: '屬於' }, { t: '三大法人', d: 'big3' }, { t: '籌碼資料的一部分。' }],
  ],
  detections: [
    { id: 'tsmc', term: '台積電', nodeType: 'company', sentence: '外資買超台積電（TSMC，2330）連日出現…', note: 'Official name of an existing company node' },
    { id: 'TSMC', term: 'TSMC', nodeType: 'company', sentence: '（TSMC，2330）', note: 'Alias of 台積電' },
    { id: '2330', term: '2330', nodeType: 'company', sentence: '（TSMC，2330）', note: 'Alias of 台積電' },
    { id: 'semi', term: '半導體', nodeType: 'concept', sentence: '半導體族群中，台積電的外資持股最受矚目。', note: 'Official name of an existing concept node' },
    { id: 'flow', term: '外資買超', nodeType: 'concept', sentence: '外資買超屬於三大法人籌碼資料的一部分。', note: 'Nothing in the graph resembles it' },
    { id: 'aisup', term: 'AI 伺服器供應鏈', nodeType: 'concept', sentence: '市場關注 AI 伺服器供應鏈的需求變化。', note: 'A narrower term that shares words, but the definition differs' },
    { id: 'big3', term: '三大法人', nodeType: 'concept', sentence: '外資買超屬於三大法人籌碼資料的一部分。', note: 'Official name of an existing concept node', demoteHint: { to: 'flow', name: '所屬' } },
  ],
};

export async function seedIfEmpty() {
  if (await meta()) return;
  const nodes: GraphNode[] = NODES.map(([name, type, aliases = []]) => ({ id: nodeId(name), name, type, aliases }));
  const day = 86400000, now = Date.now();
  const books: Book[] = BOOKS.map(({ tags, ...b }, i) => ({ ...b, publishedAt: now - (i + 1) * day }));
  const links: GraphLink[] = [
    ...BOOKS.flatMap(b => b.tags.map(tag => ({ from: b.id, to: nodeId(tag), kind: 'mention' as const, sentence: b.excerpt }))),
    ...ATTRS.map(([from, name, to]) => ({ from: nodeId(from), to: nodeId(to), kind: 'attr' as const, name })),
  ];
  await db.tx.add(T.nodes, nodes as any);
  await db.tx.add(T.aliases, nodes.flatMap(n => n.aliases.map(alias => ({ id: aliasId(alias), nodeId: n.id, alias }))));
  await db.tx.add(T.books, books as any);
  await db.tx.add(T.links, links.map((l, i) => ({ id: 'seed' + i, ...l })));
  await db.tx.add(T.attrs, [{ id: 'seed-text-1', nodeId: nodeId('外資'), name: '常見指標', value: '外資買超' }]); // becomes a link when 外資買超 is published
  await db.tx.add(T.meta, [{ id: 'graph', version: 0, seq: 11 }]);
  await rebuildSnapshot(0, true);
  await db.tx.update(T.meta, [{ id: 'graph', record: { version: 1 } }], { patch: true });
  await uploadDraft(SAMPLE_DRAFT);
}
