// GQC acceptance tests (V4 tests/acceptance-tests.md): Q01–Q12 and the negative / invariant cases.
// Run: npm run test:gqc   — uses a SYNTHETIC fixture (fictional companies), never the real dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySchema } from '../lib/ontology';
import { runGqc } from '../lib/gqc';
import type { GqcResponse } from '../lib/gqc';
import { resolve } from '../lib/write';
import type { Attrs, Graph, GraphEdge, GraphNode } from '../lib/types';

// ---------------------------------------------------------------- synthetic fixture
const N = (id: string, type: string, name: string, attributes: Attrs = {}): GraphNode => ({ id, type, name, attributes });
let k = 0;
const E = (predicate: string, from: string, to: string, attributes: Attrs = {}): GraphEdge => ({ id: `fact:t${++k}`, predicate, from, to, attributes: { verification_status: 'verified', evidence_ids: ['evidence:x'], ...attributes } });
const rec = (status = 'verified', extra: Attrs = {}) => ({ verification_status: status, evidence_ids: ['evidence:x'], ...extra });

function fixture(): Graph {
  k = 0;
  const nodes: GraphNode[] = [
    N('evidence:x', 'Evidence', '示範來源', { url: 'https://example.test/a', publisher: 'example.test', published_at: '2026-01-01' }),
    N('industry:ipc', 'Industry', '工業電腦', { name_en: 'Industrial Computing' }),
    N('industry:ipc-edge', 'Industry', '邊緣工業電腦'),
    N('industry:semi', 'Industry', '半導體'),
    N('segment:edge', 'MarketSegment', '工業邊緣 AI 電腦'),
    N('segment:robot', 'MarketSegment', '機器人'),
    N('technology:edge-ai', 'Technology', 'Edge AI 推論', { name_en: 'Edge AI' }),
    N('topic:physical-ai', 'Topic', 'Physical AI 主題', { slug: 'physical-ai', name_en: 'Physical AI' }),
    N('application:automation', 'Application', '工業自動化'),
    N('company:a', 'Company', '示範甲', { name_en: 'Alpha', aliases: ['甲公司'], ticker: '1111', exchange: 'TWSE', country: 'TW' }),
    N('company:b', 'Company', '示範乙', { name_en: 'Beta', ticker: '2222', exchange: 'TPEx', country: 'TW' }),
    N('company:c', 'Company', '示範丙', { name_en: 'Gamma', ticker: '3333', exchange: 'TWSE', country: 'TW' }),
    N('company:d', 'Company', '示範丁', { name_en: 'Delta', ticker: '4444', country: 'TW' }),                 // no products; market not recorded
    N('company:e', 'Company', '示範戊', { name_en: 'Epsilon', country: 'US' }),                              // foreign, unlisted
    N('company:f', 'Company', '示範己', { name_en: 'Zeta', country: 'TW' }),                                 // subsidiary of 甲
    N('company:h', 'Company', '示範庚', { name_en: 'Eta', ticker: '5555', exchange: 'TWSE', country: 'TW' }), // same industry as 乙, no assessment
    N('product:a', 'Product', '甲邊緣電腦 A1', { kind: 'system' }),
    N('product:b', 'Product', '乙邊緣電腦 B1', { kind: 'system' }),
    N('product:c', 'Product', '丙加速器 C1', { kind: 'module' }),
    N('product:e', 'Product', '戊軟體 E1', { kind: 'software' }),
    N('product:h', 'Product', '庚閘道器 H1', { kind: 'system' }),
    N('competition:ab', 'CompetitionAssessment', '甲邊緣電腦 A1 對 乙邊緣電腦 B1', rec('verified', { competition_type: 'DIRECT', overlap_scope: 'market', basis: ['同一買家需求'] })),
    N('competition:ac', 'CompetitionAssessment', '甲邊緣電腦 A1 對 丙加速器 C1', rec('verified', { competition_type: 'INDIRECT', overlap_scope: 'application', basis: ['不同架構'] })),
    N('collaboration:ac', 'Collaboration', '甲與丙合作備忘錄', rec('verified', { collaboration_type: 'mou', stage: 'announced', lifecycle_status: 'announced', valid_from: '2026-03-01' })),
    N('collaboration:ab-old', 'Collaboration', '甲與乙共同開發', rec('verified', { collaboration_type: 'joint_development', stage: 'launched', lifecycle_status: 'active', valid_from: '2024-01-01', valid_to: '2025-01-01' })),
    N('collaboration:robot', 'Collaboration', '甲與庚機器人策略聯盟', rec('reported', { collaboration_type: 'strategic_partnership', stage: 'in_development', lifecycle_status: 'active' })),
    N('supply:ca', 'SupplyRelationship', '丙供應甲', rec('verified', { stage: 'mass_production' })),
    N('supply:ba', 'SupplyRelationship', '乙可能供應甲', rec('inferred', { stage: 'prospect' })),
    N('event:launch', 'Event', '甲發表 Physical AI 機器人', rec('verified', { event_type: 'launch', occurred_at: '2026-06-01' })),
    N('mention:d', 'TopicMention', '新聞提及丁', { mentioned_at: '2026-07-01', evidence_ids: ['evidence:x'] }),
    N('etf:9999', 'ETF', '示範 ETF', { ticker: '9999', as_of: '2026-11-01' }),
  ];
  const edges: GraphEdge[] = [
    E('SUBINDUSTRY_OF', 'industry:ipc-edge', 'industry:ipc'), E('SEGMENT_OF_INDUSTRY', 'segment:edge', 'industry:ipc'),
    E('OPERATES_IN', 'company:a', 'industry:ipc-edge'), E('OPERATES_IN', 'company:b', 'industry:ipc'), E('OPERATES_IN', 'company:h', 'industry:ipc'), E('OPERATES_IN', 'company:c', 'industry:semi'),
    E('SELLS', 'company:a', 'product:a'), E('SELLS', 'company:b', 'product:b'), E('SELLS', 'company:c', 'product:c'), E('SELLS', 'company:e', 'product:e', { verification_status: 'inferred' }), E('SELLS', 'company:h', 'product:h'),
    E('USES_TECHNOLOGY', 'product:a', 'technology:edge-ai'), E('USES_TECHNOLOGY', 'product:b', 'technology:edge-ai'), E('USES_TECHNOLOGY', 'product:c', 'technology:edge-ai'), E('USES_TECHNOLOGY', 'product:e', 'technology:edge-ai'),
    E('USES_TECHNOLOGY', 'product:h', 'technology:edge-ai', { verification_status: 'disputed' }),
    E('SUPPORTS_APPLICATION', 'product:a', 'application:automation'), E('SUPPORTS_APPLICATION', 'product:b', 'application:automation'),
    E('TARGETS_SEGMENT', 'product:a', 'segment:edge'),
    E('RELATED_TECHNOLOGY', 'topic:physical-ai', 'technology:edge-ai'),
    E('OFFERING_A', 'competition:ab', 'product:a'), E('OFFERING_B', 'competition:ab', 'product:b'), E('COMPETES_IN_SEGMENT', 'competition:ab', 'segment:edge'),
    E('OFFERING_A', 'competition:ac', 'product:a'), E('OFFERING_B', 'competition:ac', 'product:c'), E('COMPETES_IN_SEGMENT', 'competition:ac', 'segment:edge'),
    E('HAS_PARTICIPANT', 'collaboration:ac', 'company:a'), E('HAS_PARTICIPANT', 'collaboration:ac', 'company:c'),
    E('HAS_PARTICIPANT', 'collaboration:ab-old', 'company:a'), E('HAS_PARTICIPANT', 'collaboration:ab-old', 'company:b'),
    E('HAS_PARTICIPANT', 'collaboration:robot', 'company:a'), E('HAS_PARTICIPANT', 'collaboration:robot', 'company:h'), E('TARGETS_MARKET', 'collaboration:robot', 'segment:robot'),
    E('HAS_SUPPLIER', 'supply:ca', 'company:c'), E('HAS_BUYER', 'supply:ca', 'company:a'),
    E('HAS_SUPPLIER', 'supply:ba', 'company:b', { verification_status: 'inferred' }), E('HAS_BUYER', 'supply:ba', 'company:a', { verification_status: 'inferred' }),
    E('IS_SUBSIDIARY_OF', 'company:f', 'company:a'), E('IS_SUBSIDIARY_OF', 'company:a', 'company:f', { verification_status: 'reported' }),   // deliberate cycle
    E('EVENT_PARTICIPANT', 'event:launch', 'company:a'), E('ABOUT_TOPIC', 'event:launch', 'topic:physical-ai'),
    E('MENTIONS_ENTITY', 'mention:d', 'company:d'), E('ABOUT_TOPIC', 'mention:d', 'topic:physical-ai'),
    E('HOLDS_CONSTITUENT', 'etf:9999', 'company:a', { weight_pct: 5, as_of: '2026-11-01' }),
  ];
  return applySchema({ nodes, edges, entityTypes: [], edgeTypes: [] });
}

const g = fixture();
const base = { version: '4.0', result_type: 'company' } as const;
const run = (q: object) => { const r = runGqc(g, { ...base, ...q }); if ('errors' in r) assert.fail(r.errors.join('; ')); return r as GqcResponse; };
const ids = (r: GqcResponse) => r.results.map(x => x.company_id).sort();
const only = (field: string, values: string[], operator?: string, extra: object = {}) => ({ filters: { all: [{ field, values, ...(operator ? { operator } : {}), ...extra }] } });
const AS_OF = { as_of: '2026-11-24' };

// ---------------------------------------------------------------- Q01–Q12
test('Q01 哪些公司屬於工業電腦：只依經營產業與合法子產業', () => {
  const r = run({ ...only('industry', ['Industrial Computing'], 'operates_in'), policy: AS_OF });
  assert.deepEqual(ids(r), ['company:a', 'company:b', 'company:h']);   // 甲 via 子產業
  assert.ok(r.results.find(x => x.company_id === 'company:a')!.matching_paths[0].fact_ids.length === 2);
});
test('Q02 台灣公司參與 Edge AI：經核准的技術／主題路徑，不靠新聞提及', () => {
  const r = run({ universe: { country: ['TW'] }, ...only('topic', ['topic:physical-ai'], 'active_in'), policy: AS_OF });
  assert.deepEqual(ids(r), ['company:a', 'company:b', 'company:c']);
  assert.ok(!ids(r).includes('company:d'), '只有提及的丁不算參與');
});
test('Q03 Edge AI 且工業自動化產品：交集', () => {
  const r = run({ filters: { all: [{ field: 'technology', values: ['Edge AI'] }, { field: 'application', values: ['工業自動化'] }] }, policy: AS_OF });
  assert.deepEqual(ids(r), ['company:a', 'company:b']);
});
test('Q04 公司甲有哪些產品：區分角色', () => {
  const r = run({ ...only('country', ['TW']), universe: { ids: ['company:a'] }, expand: ['products'], policy: AS_OF });
  assert.deepEqual((r.results[0].expansions.products as { id: string; roles: string[] }[]).map(p => [p.id, p.roles]), [['product:a', ['SELLS']]]);
});
test('Q05 直接競爭者：需要競爭評估，不能靠同產業', () => {
  const r = run({ ...only('competitor_of', ['示範甲'], 'direct'), policy: AS_OF });
  assert.deepEqual(ids(r), ['company:b']);
  assert.ok(!ids(r).includes('company:h'), '庚與乙同產業但沒有評估');
});
test('Q06 間接競爭者：獨立評估，不與直接混用', () => {
  assert.deepEqual(ids(run({ ...only('competitor_of', ['示範甲'], 'indirect'), policy: AS_OF })), ['company:c']);
});
test('Q07 公司甲的夥伴：合作紀錄、階段、日期、來源', () => {
  const r = run({ ...only('partner_of', ['示範甲']), expand: ['partnerships'], policy: AS_OF });
  assert.deepEqual(ids(r), ['company:c', 'company:h']);   // 過期的甲乙合作不算
  const p = (r.results.find(x => x.company_id === 'company:c')!.expansions.partnerships as { stage: string; lifecycle_status: string; evidence_ids: string[] }[])[0];
  assert.equal(p.stage, 'announced'); assert.equal(p.lifecycle_status, 'announced'); assert.deepEqual(p.evidence_ids, ['evidence:x']);
});
test('Q08 機器人策略聯盟：合作類型 + 市場', () => {
  const r = run({ ...only('collaboration_focus', ['機器人'], undefined, { collaboration_type: ['strategic_partnership'] }), policy: AS_OF });
  assert.deepEqual(ids(r), ['company:a', 'company:h']);
  assert.deepEqual(ids(run({ ...only('collaboration_focus', ['機器人'], undefined, { collaboration_type: ['mou'] }), policy: AS_OF })), []);
});
test('Q09 集團子公司：持股／控制層次', () => {
  assert.deepEqual(ids(run({ ...only('subsidiary_of', ['示範甲']), policy: AS_OF })), ['company:f']);
});
test('Q10 上游供應商：只用合格供應紀錄，區分潛在', () => {
  assert.deepEqual(ids(run({ ...only('customer_of', ['company:c'], 'confirmed'), policy: AS_OF })), ['company:a']);
  assert.deepEqual(ids(run({ ...only('supplier_of', ['示範甲'], 'confirmed'), policy: AS_OF })), ['company:c']);
  assert.deepEqual(ids(run({ ...only('supplier_of', ['示範甲'], 'potential'), policy: { ...AS_OF, include_inferred: true } })), ['company:b']);
});
test('Q11 Physical AI：熱度（提及）與實質參與分開', () => {
  const act = run({ ...only('topic', ['Physical AI'], 'active_in'), policy: AS_OF });
  const att = run({ ...only('topic', ['Physical AI'], 'attention'), policy: AS_OF });
  assert.ok(act.results.find(x => x.company_id === 'company:a')!.matching_paths.some(p => p.rule_id === 'topic_activity_v1'));
  assert.deepEqual(ids(att), ['company:d']);
  assert.ok(!ids(act).includes('company:d'));
});
test('Q12 時間回放：合作在哪個時間點有效', () => {
  assert.deepEqual(ids(run({ ...only('partner_of', ['示範甲']), policy: { as_of: '2024-06-01' } })), ['company:b', 'company:h']);
  assert.deepEqual(ids(run({ ...only('partner_of', ['示範甲']), policy: { as_of: '2026-11-24' } })), ['company:c', 'company:h']);
  assert.deepEqual(ids(run({ ...only('topic', ['Physical AI'], 'active_in'), policy: { as_of: '2026-05-01' } })).includes('company:a'), true);   // via technology, not the future event
  assert.ok(!run({ ...only('topic', ['Physical AI'], 'active_in'), policy: { as_of: '2026-05-01' } }).results.find(x => x.company_id === 'company:a')!.matching_paths.some(p => p.rule_id === 'topic_activity_v1'));
});

// ---------------------------------------------------------------- invariants
test('N1 別名、代號、英文名 → 同一個 canonical id', () => {
  for (const q of ['示範甲', 'Alpha', '甲公司', '1111', 'company:a']) assert.deepEqual(resolve(g, q, 'Company').map(n => n.id), ['company:a']);
});
test('N2 兩條有效路徑 → 一筆公司結果、兩條 matching_paths', () => {
  const r = run({ filters: { any: [{ field: 'technology', values: ['Edge AI'] }, { field: 'application', values: ['工業自動化'] }] }, policy: AS_OF });
  const a = r.results.filter(x => x.company_id === 'company:a');
  assert.equal(a.length, 1); assert.equal(a[0].matching_paths.length, 2);
});
test('N3 同產業不會自動產生直接競爭', () => { assert.ok(!ids(run({ ...only('competitor_of', ['示範乙'], 'direct'), policy: AS_OF })).includes('company:h')); });
test('N4 潛在（suggested/prospect）供應不出現在確定供應', () => {
  assert.deepEqual(ids(run({ ...only('supplier_of', ['示範甲'], 'confirmed'), policy: { ...AS_OF, include_inferred: true } })), ['company:c']);
});
test('N5 已宣布的 MOU 不等於進行中的合作', () => {
  assert.deepEqual(ids(run({ ...only('partner_of', ['示範甲'], undefined, { lifecycle: ['active'] }), policy: AS_OF })), ['company:h']);
});
test('N6 過期事實不符合現在的 as_of', () => { assert.ok(!ids(run({ ...only('partner_of', ['示範甲']), policy: AS_OF })).includes('company:b')); });
test('N7 循環圖在 max_hops 內結束', () => {
  const r = run({ ...only('subsidiary_of', ['示範己']), policy: { ...AS_OF, max_hops: 6 } });
  assert.deepEqual(ids(r), ['company:a']);
});
test('N8 not 不會把缺資料當成「確定沒有」', () => {
  const r = run({ filters: { all: [{ field: 'country', values: ['TW'] }], not: [{ field: 'technology', values: ['Edge AI'] }] }, policy: AS_OF });
  const d = r.results.find(x => x.company_id === 'company:d')!;
  assert.ok(d, '丁沒有商品資料，仍保留'); assert.deepEqual(d.unknown_fields, ['technology']);
  assert.ok(!ids(r).includes('company:a'));
  assert.equal(r.coverage.status, 'partial');
});
test('N9 有爭議的事實預設不使用、不自動升級', () => {
  assert.ok(!ids(run({ ...only('technology', ['Edge AI']), policy: AS_OF })).includes('company:h'));
  assert.ok(ids(run({ ...only('technology', ['Edge AI']), policy: { ...AS_OF, verification: ['verified', 'reported', 'disputed'] } })).includes('company:h'));
});
test('N10 固定 snapshot + query + 規則版本 → 相同輸出；分頁穩定；資料變更後 cursor 失效', () => {
  const q = { ...only('technology', ['Edge AI']), policy: { ...AS_OF, include_inferred: true } };
  assert.deepEqual(run(q), run(q));
  const full = run(q).results.map(x => x.company_id);
  const p1 = run({ ...q, policy: { ...q.policy, limit: 2 } });
  const p2 = run({ ...q, policy: { ...q.policy, limit: 2, cursor: p1.next_cursor! } });
  assert.deepEqual([...p1.results, ...p2.results].map(x => x.company_id), full);
  const changed: Graph = { ...g, nodes: [...g.nodes, N('company:new', 'Company', '新公司', { country: 'TW' })] };
  const stale = runGqc(changed, { ...base, ...q, policy: { ...q.policy, limit: 2, cursor: p1.next_cursor! } });
  assert.ok('errors' in stale);
});
test('N11 expand 只擴展結果，不增減符合的公司', () => {
  const q = { ...only('technology', ['Edge AI']), policy: AS_OF };
  assert.deepEqual(ids(run(q)), ids(run({ ...q, expand: ['products', 'direct_competitors', 'indirect_competitors', 'partnerships', 'suppliers', 'customers', 'subsidiaries', 'technology_trends', 'business_lines'] })));
});
test('N12 查詢合約驗證：未登記欄位、operator、模糊值、巢狀深度都被拒絕', () => {
  const bad = (q: object) => { const r = runGqc(g, { ...base, ...q }); assert.ok('errors' in r, JSON.stringify(q)); };
  bad({ filters: { all: [{ field: 'sql', values: ['x'] }] } });
  bad({ filters: { all: [{ field: 'industry', operator: 'like', values: ['工業電腦'] }] } });
  bad({ filters: { all: [{ field: 'industry', values: ['不存在'] }] } });
  bad({ filters: { all: [{ all: [{ all: [{ all: [{ field: 'country', values: ['TW'] }] }] }] }] } });
  bad({ filters: { all: [{ field: 'country', values: ['TW'], cypher: 'MATCH (n)' }] } });
  bad({ ...only('technology', ['Edge AI']), policy: { max_hops: 50 } });
});
test('Universe：上市市場未記錄的公司標記 unknown，而不是被排除', () => {
  const r = run({ universe: { listing_market: ['TWSE', 'TPEx'] }, policy: AS_OF });
  assert.ok(ids(r).includes('company:d')); assert.equal(r.results.find(x => x.company_id === 'company:d')!.universe_status, 'unknown');
  assert.ok(!ids(r).includes('company:e') && !ids(r).includes('company:f'));
});
