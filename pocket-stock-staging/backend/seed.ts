// Sample content for a new, empty app: a published graph and one draft waiting for review.
// Everything here is fictional sample data except the four live-site book titles. Company and fund names are real
// so the graph reads naturally, but no figure, claim or relationship here is research. Sample books say so in their text.
import { db, storage } from '@appdeploy/sdk';
import type { Book, DraftPackage, GraphLink, GraphNode, NodeType, Seg } from '../shared/graph.ts';
import { T, aliasId, meta, nodeId, rebuildSnapshot, uploadDraft } from './store.ts';

const NODES: [string, NodeType, string[]?][] = [
  ['半導體', 'concept'], ['台積電', 'company', ['TSMC', '2330']], ['聯發科', 'company'], ['AI 伺服器', 'concept', ['AI server']], ['元大台灣50', 'etf', ['0050']], ['外資', 'inst'], ['三大法人', 'concept'],
  ['資料中心', 'concept'], ['電力設備', 'concept'], ['預製模組', 'concept'], ['機房驗收', 'concept'], ['營收認列', 'concept'], ['台達電', 'company', ['2308']],
  ['玻纖布', 'concept'], ['銅箔基板', 'concept'], ['電路板', 'concept'], ['富喬', 'company'], ['鋼構', 'concept'], ['鋼筋', 'concept'], ['科技廠擴建', 'concept'], ['東鋼', 'company'],
  ['FCC', 'concept'], ['檢測認證', 'concept'], ['實驗室', 'concept'], ['耕興', 'company'],
  ['散熱', 'concept'], ['液冷', 'concept'], ['奇鋐', 'company', ['3017']], ['伺服器代工', 'concept'], ['鴻海', 'company', ['2317', 'Foxconn']], ['廣達', 'company', ['2382']],
  ['先進封裝', 'concept', ['CoWoS']], ['日月光投控', 'company', ['3711']], ['成熟製程', 'concept'], ['聯電', 'company', ['UMC', '2303']], ['記憶體', 'concept'], ['南亞科', 'company', ['2408']],
  ['高股息 ETF', 'concept'], ['元大高股息', 'etf', ['0056']], ['國泰永續高股息', 'etf', ['00878']], ['殖利率', 'concept'],
  ['金融股', 'concept'], ['富邦金', 'company', ['2881']], ['國泰金', 'company', ['2882']], ['升息', 'concept'],
  ['航運', 'concept'], ['長榮', 'company', ['2603']], ['運價指數', 'concept'], ['投信', 'inst'], ['自營商', 'inst'],
];
const BOOKS: (Omit<Book, 'publishedAt'> & { tags: string[] })[] = [
  { id: 'b-machine-room', title: '機房裝好了，為何還不能開機？', industry: 'AI資料中心與電力設備', date: '2026年11月9日', pages: 11, tags: ['資料中心', '電力設備', '預製模組', '機房驗收', '營收認列', '台達電'], excerpt: '橘寶想把模型機房點亮，卻發現買設備、接電、測試和營收各有自己的時間。Codey帶他從馬來西亞投資計畫走到台達的設備案例，再用一次停電演練，找出機房能開機之前還要完成的工作。' },
  { id: 'b-fuqiao', title: '富喬營收創高，為何淨利還會降？', industry: '玻纖布與電子材料', date: '2026年11月6日', pages: 11, tags: ['玻纖布', '銅箔基板', '電路板', '富喬'], excerpt: '橘寶與Codey從一卷玻纖布走進銅箔基板與電路板的供應鏈，理解客戶為何選材料、認證與良率如何影響生意，再對照富喬同口徑的單季數字。' },
  { id: 'b-dongsteel', title: '蓋科技廠，東鋼怎麼接到生意？', industry: '鋼鐵與鋼構', date: '2026年11月2日', pages: 11, tags: ['鋼構', '鋼筋', '科技廠擴建', '東鋼', '營收認列'], excerpt: '科技廠擴建如何變成鋼鐵公司的生意？橘寶與Codey從建築模型出發，沿著東鋼的鋼筋加工、型鋼與鋼構交付，追到實際收入組合與收款時間差。' },
  { id: 'b-fcc', title: 'FCC新規之後，耕興怎麼接案？', industry: '電子產品檢測認證', date: '2026年10月30日', pages: 12, tags: ['FCC', '檢測認證', '實驗室', '耕興', '營收認列'], excerpt: '從一台假設銷美的無線設備出發，跟著橘寶與Codey看懂實驗室、TCB與FCC的分工，說明資格、排程、履約和外部收入如何接起來。' },
  { id: 'b-semi', title: '半導體產業觀察', industry: '半導體', date: '2026年10月20日', pages: 10, sample: true, tags: ['聯發科', '半導體', '台積電', 'AI 伺服器'], excerpt: '示範文章：半導體族群與供應鏈的整理。' },
  { id: 'b-0050', title: '0050 持股變化', industry: '主動式ETF', date: '2026年10月12日', pages: 9, sample: true, tags: ['元大台灣50', '台積電'], excerpt: '示範文章：元大台灣50 的持股變化紀錄。' },
  { id: 'b-foreign', title: '外資入門', industry: '三大法人', date: '2026年10月5日', pages: 8, sample: true, tags: ['外資', '三大法人'], excerpt: '示範文章：外資與三大法人的基本介紹。' },
  { id: 'b-cooling', title: 'AI 伺服器為什麼需要液冷？', industry: '散熱', date: '2026年9月28日', pages: 10, sample: true, tags: ['散熱', '液冷', '奇鋐', 'AI 伺服器', '資料中心'], excerpt: '示範文章：從機櫃的熱從哪裡來談起，整理氣冷與液冷的差別。' },
  { id: 'b-odm', title: '伺服器代工在做什麼？', industry: '伺服器代工', date: '2026年9月21日', pages: 9, sample: true, tags: ['伺服器代工', '鴻海', '廣達', 'AI 伺服器'], excerpt: '示範文章：一台伺服器從設計、組裝到出貨，代工廠負責哪些工作。' },
  { id: 'b-packaging', title: '先進封裝入門', industry: '半導體', date: '2026年9月14日', pages: 12, sample: true, tags: ['先進封裝', '日月光投控', '台積電', '半導體'], excerpt: '示範文章：晶片做好之後還要封裝，先進封裝解決的是什麼問題。' },
  { id: 'b-mature', title: '成熟製程與記憶體', industry: '半導體', date: '2026年9月7日', pages: 10, sample: true, tags: ['成熟製程', '聯電', '記憶體', '南亞科', '半導體'], excerpt: '示範文章：不是每顆晶片都用最新製程，成熟製程與記憶體各有自己的景氣循環。' },
  { id: 'b-dividend', title: '高股息 ETF 怎麼選成分股？', industry: 'ETF', date: '2026年8月31日', pages: 8, sample: true, tags: ['高股息 ETF', '元大高股息', '國泰永續高股息', '殖利率'], excerpt: '示範文章：同樣叫高股息，選股規則不同，持股也會不同。' },
  { id: 'b-financial', title: '升息對金融股的影響', industry: '金融', date: '2026年8月24日', pages: 9, sample: true, tags: ['金融股', '富邦金', '國泰金', '升息', '殖利率'], excerpt: '示範文章：利率變動如何影響銀行與壽險的獲利來源。' },
  { id: 'b-shipping', title: '運價指數怎麼看？', industry: '航運', date: '2026年8月17日', pages: 8, sample: true, tags: ['航運', '長榮', '運價指數'], excerpt: '示範文章：運價指數代表什麼，和航運公司的營收有什麼關係。' },
  { id: 'b-trust', title: '投信與自營商入門', industry: '三大法人', date: '2026年8月10日', pages: 7, sample: true, tags: ['投信', '自營商', '三大法人', '外資'], excerpt: '示範文章：三大法人裡的另外兩位，各自為誰買賣。' },
];
const ATTRS: [string, string, string][] = [
  ['台積電', '產業', '半導體'], ['聯發科', '產業', '半導體'], ['外資', '所屬', '三大法人'], ['台達電', '產業', '電力設備'], ['資料中心', '相關', 'AI 伺服器'],
  ['富喬', '產業', '玻纖布'], ['銅箔基板', '用於', '電路板'], ['東鋼', '產業', '鋼構'], ['耕興', '產業', '檢測認證'], ['電路板', '相關', '半導體'], ['科技廠擴建', '相關', '資料中心'], ['AI 伺服器', '相關', '資料中心'],
  ['奇鋐', '產業', '散熱'], ['液冷', '相關', '散熱'], ['散熱', '相關', 'AI 伺服器'], ['鴻海', '產業', '伺服器代工'], ['廣達', '產業', '伺服器代工'], ['伺服器代工', '相關', 'AI 伺服器'],
  ['日月光投控', '產業', '先進封裝'], ['先進封裝', '相關', '半導體'], ['聯電', '產業', '成熟製程'], ['成熟製程', '相關', '半導體'], ['南亞科', '產業', '記憶體'], ['記憶體', '相關', '半導體'],
  ['元大高股息', '類型', '高股息 ETF'], ['國泰永續高股息', '類型', '高股息 ETF'], ['富邦金', '產業', '金融股'], ['國泰金', '產業', '金融股'], ['長榮', '產業', '航運'],
  ['投信', '所屬', '三大法人'], ['自營商', '所屬', '三大法人'],
];
/** Placeholder reading text for a seeded book: it names the book's nodes as links and says plainly that it is sample text. */
function sampleText(tags: string[]): Seg[][] {
  const link = (name: string): Seg => ({ t: name, n: nodeId(name) });
  const list = (names: string[]) => names.flatMap((n, i) => (i ? [{ t: '、' }, link(n)] : [link(n)]));
  const [first, ...rest] = tags;
  return [
    [{ t: '這是示範內文，用來展示閱讀畫面與節點連結。內容不是真實研究，也不含真實數據。' }],
    [{ t: '這本書從' }, link(first), { t: '談起' }, ...(rest.length ? [{ t: '，再說明它和' }, ...list(rest), { t: '之間的關係' }] : []), { t: '。' }],
    [{ t: '文中每一個有底線的名詞都是圖譜上的節點。點選它，可以找到提到同一個節點的其他研究書。' }],
  ];
}
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

let seeding: Promise<void> | null = null;
/** Seeds an empty app once. Requests that arrive while it runs wait for the same run. */
export function seedIfEmpty(): Promise<void> {
  if (!seeding) seeding = seed().finally(() => { seeding = null; });
  return seeding;
}
async function seed() {
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
  await storage.write(BOOKS.map(b => ({ path: `kg/books/${b.id}.json`, content: JSON.stringify(sampleText(b.tags)), contentType: 'application/json' })));
  await db.tx.add(T.links, links.map((l, i) => ({ id: 'seed' + i, ...l })));
  await db.tx.add(T.attrs, [{ id: 'seed-text-1', nodeId: nodeId('外資'), name: '常見指標', value: '外資買超' }]); // becomes a link when 外資買超 is published
  await db.tx.add(T.meta, [{ id: 'graph', version: 0, seq: 11 }]);
  await rebuildSnapshot(0, true);
  await db.tx.update(T.meta, [{ id: 'graph', record: { version: 1 } }], { patch: true });
  await uploadDraft(SAMPLE_DRAFT);
}
