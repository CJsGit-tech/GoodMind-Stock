// One-time, idempotent migration from ontology v2.0 data to v4.0.
// What it does (and never does):
//   • moves every field except id/type/name into `attributes` (nodes and edges);
//   • makes `name` Chinese and moves English / original names to attributes.name_en (+ aliases);
//   • gives entities stable canonical ids (company:tsmc) and keeps the old id in attributes.legacy_ids;
//   • turns "business line" pseudo-products into BusinessLine nodes, and foundry/test/packaging offerings into Services;
//   • maps v2 verification labels to V4 states (keeps the old label in verification_legacy) and adds lifecycle_status;
//   • fills `country` only where it is known; anything uncertain is listed in attributes.needs_review — never guessed.
import crypto from 'node:crypto';
import type { Attrs, Graph, GraphEdge, GraphNode } from './types';
import { applySchema } from './ontology';

type Old = { id: string; type: string; name: string; [k: string]: unknown };
type OldEdge = { id: string; predicate: string; from: string; to: string; [k: string]: unknown };

/** Companies: canonical slug, Chinese name, English name, country (null = not known → needs_review). */
const COMPANIES: Record<string, [string, string, string, string | null, boolean?]> = {
  'company:adlink': ['adlink', '凌華', 'ADLINK', 'TW'], 'company:nexcom': ['nexcom', '新漢', 'NEXCOM', 'TW'],
  'company:nexcobot': ['nexcobot', 'NexCOBOT', 'NexCOBOT', 'TW', true], 'company:aaeon': ['aaeon', '研揚', 'AAEON', 'TW'],
  'company:axiomtek': ['axiomtek', '艾訊', 'Axiomtek', 'TW'], 'company:advantech': ['advantech', '研華', 'Advantech', 'TW'],
  'company:innodisk': ['innodisk', '宜鼎', 'Innodisk', 'TW'], 'company:aetina': ['aetina', '安提', 'Aetina', 'TW'],
  'company:foxconn': ['foxconn', '鴻海', 'Foxconn', 'TW'], 'company:farobot': ['farobot', 'FARobot', 'FARobot', 'TW', true],
  'company:aeolus': ['aeolus-robotics', 'Aeolus Robotics', 'Aeolus Robotics', null, true], 'company:mobisnet': ['mobisnet', 'MOBISNET', 'MOBISNET', null, true],
  'company:deepx': ['deepx', 'DEEPX', 'DEEPX', 'KR', true],
  b1236908: ['umc', '聯電', 'UMC', 'TW'], '36bc8be9': ['ardentec', '欣銓', 'Ardentec', 'TW'], d73ef9f5: ['powertech', '力成', 'Powertech Technology', 'TW'],
  '1c572f97': ['tsmc', '台積電', 'TSMC', 'TW'], '345e3fdc': ['wafer-works', '合晶', 'Wafer Works', 'TW'], '7d5a3e33': ['allied-supreme', '上品', 'Allied Supreme', 'TW'],
  be5bfdab: ['g-tech', '正達', 'G-TECH Optoelectronics', 'TW'], '13b27b3d': ['wnc', '啟碁', 'WNC Corporation', 'TW'], '20dcef76': ['liteon', '光寶科', 'LITEON Technology', 'TW'],
  ef1e6628: ['auo', '友達', 'AUO', 'TW'], '6e7b4d48': ['taiwan-glass', '台玻', 'Taiwan Glass', 'TW'], '5d19df3e': ['unimicron', '欣興', 'Unimicron', 'TW'],
  '41c1f350': ['compeq', '華通', 'Compeq Manufacturing', 'TW'], '857f7869': ['allied-circuit', '博智', 'Allied Circuit', 'TW'], '61b99ebc': ['chang-wah-technology', '長科', 'Chang Wah Technology', 'TW'],
  '8ec827ea': ['qct', '雲達科技', 'Quanta Cloud Technology', 'TW'], '79ab3ecc': ['nvidia', '輝達', 'NVIDIA', 'US'], '0b38e392': ['bull', 'Bull', 'Bull', 'FR', true],
  '951c3066': ['samsung-electronics', '三星電子', 'Samsung Electronics', 'KR'], efd172fb: ['kyec', '京元電', 'KYEC', 'TW'], e4974e27: ['globalwafers', '環球晶', 'GlobalWafers', 'TW'],
  '0c26bffa': ['agc', '旭硝子', 'AGC', 'JP'], '52b048d9': ['ase', '日月光半導體', 'Advanced Semiconductor Engineering', 'TW'], '1a93251b': ['gce', '金像電', 'Gold Circuit Electronics', 'TW'],
  '0e6428bc': ['shinko', '新光電氣', 'SHINKO Electric Industries', 'JP'], '90aed267': ['apple', '蘋果', 'Apple', 'US'], '8fc9e532': ['taiwan-autoglass', '台灣汽車玻璃', 'Taiwan Autoglass', 'TW'],
  d63f4489: ['toyota', '豐田汽車', 'Toyota Motor', 'JP'], d8d9c83f: ['giga-solution', '全智科技', 'Giga Solution Tech', 'TW'], f4dbaf16: ['tera-probe', 'Tera Probe', 'Tera Probe', 'JP', true],
  '082b2629': ['terapower', 'TeraPower', 'TeraPower Technology', null, true], a7854805: ['jasm', '日本先進半導體製造', 'Japan Advanced Semiconductor Manufacturing', 'JP'],
  f994a28f: ['tsmc-arizona', '台積電亞利桑那', 'TSMC Arizona', 'US'], c6bfb4b2: ['esmc', '歐洲半導體製造', 'European Semiconductor Manufacturing Company', 'DE'],
  '4eb1ad4f': ['usjc', '聯電日本半導體', 'United Semiconductor Japan', 'JP'], f7f9993d: ['u-media', '宇智網通', 'U-MEDIA', 'TW'], d50f7244: ['chang-wah-electromaterials', '長華電材', 'Chang Wah Electromaterials', 'TW'],
  '61a652fe': ['meiko', '名幸電子', 'Meiko Electronics', 'JP'], '65bf6401': ['foxtron', '鴻華先進', 'Foxtron Vehicle Technologies', 'TW'], b80d770d: ['mitsubishi-motors', '三菱汽車', 'Mitsubishi Motors', 'JP'],
  '469f807a': ['entegris', '英特格', 'Entegris', 'US'], fa0f3a2b: ['accton', '智邦', 'Accton', 'TW'], '5b3816ce': ['delta', '台達電', 'Delta Electronics', 'TW'],
  '9433864b': ['supermicro', '美超微', 'Supermicro', 'US'], '610dd86b': ['innolux', '群創', 'Innolux', 'TW'], '45d7e771': ['nittobo', '日東紡', 'Nittobo', 'JP'],
  a2b9fc8a: ['kinsus', '景碩', 'Kinsus', 'TW'], ce7fd3da: ['silith', 'SILITH', 'SILITH Technology', null, true], e50d3cec: ['chemours', '科慕', 'Chemours', 'US'],
  '5b989afc': ['daikin', '大金工業', 'Daikin Industries', 'JP'], '77fdd193': ['3m', '3M', '3M', 'US'], '5b298237': ['silicon-works', '睿晶科技', 'Silicon Works Technology', null],
  f7b73356: ['wnc-usa', '啟碁美國', 'WNC USA Corporation', 'US'],
};
/** Groups / tags whose v2 name was English. */
const RENAME: Record<string, [string, string]> = {
  'industry:industrial-computing': ['工業電腦', 'Industrial Computing'], 'industry:robotics': ['機器人與自動化', 'Robotics & Automation'],
  'market:robotic-edge-computing': ['機器人邊緣運算', 'Robotic Edge Computing'],
  'category:robotic-edge-controller': ['機器人邊緣控制器', 'Robotic Edge Controller'], 'category:industrial-edge-ai-computer': ['邊緣 AI 工業電腦', 'Industrial Edge AI Computer'],
  'technology:thor': ['NVIDIA Jetson Thor 平台', 'NVIDIA Jetson Thor'], 'technology:orin': ['NVIDIA Jetson Orin 平台', 'NVIDIA Jetson Orin'],
  'application:robotics-control': ['機器人控制', 'Robotics Control'],
  'group:innodisk': ['宜鼎集團', 'Innodisk Group'], 'group:nexcom': ['新漢集團', 'NEXCOM Group'],
};
/** v2 "products" that are really services (foundry processes, test, packaging). */
const SERVICES: Record<string, string> = {
  '6b074e46': 'foundry', '93b86a7b': 'packaging', e8d8391c: 'testing', f5462c3a: 'testing', '21f600bb': 'foundry', '7bd9993f': 'foundry',
  '76db2cca': 'foundry', '1698890e': 'foundry', '78497ffa': 'testing', d7981291: 'testing', ccbb588b: 'foundry',
};
/** Product form, by keyword (first match wins). */
const KIND_RULES: [RegExp, string][] = [
  [/模組|module/i, 'module'], [/ASX/, 'vehicle'], [/晶圓材料|磊晶|玻璃基板|玻纖|玻璃纖維|原料/, 'material'],
  [/載板|電路板|PCB|導線架|蓋板|汽車玻璃|PFA|儲槽|顯示面板|積體電路晶圓/i, 'component'],
  [/交換器|機架|電源|顯示器|DLAP|MARS|BOXER|AIE|AFE|APEX/i, 'system'],
];
const KIND_FIX: Record<string, string> = { testing_and_packaging: 'assembly_and_test' };
const VERIFY_MAP: Record<string, string> = { officially_disclosed: 'verified', corroborated: 'verified', reported: 'reported', analyst_inferred: 'inferred', hypothesis: 'suggested', disputed: 'disputed', rejected: 'disputed' };
const COLLAB_LIFE: Record<string, string> = { rumoured: 'announced', announced: 'announced', mou_signed: 'announced', in_development: 'active', launched: 'active', ended: 'completed' };
const SUPPLY_LIFE: Record<string, string> = { design_win: 'active', mass_production: 'active', ended: 'completed' };
const OPP_LIFE: Record<string, string> = { won: 'completed', lost: 'expired' };
const COLLAB_WORD: Record<string, string> = { joint_venture: '合資', mou: '合作備忘錄', technical_integration: '技術整合', joint_development: '共同開發', strategic_partnership: '策略合作', investment: '投資', other: '合作' };

const slug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
const hasCjk = (s: string) => /[㐀-鿿]/.test(s);
/** Space between Chinese and Latin runs in generated names: 「研華與 Aeolus Robotics 技術整合」. */
const pad = (s: string) => s.replace(/([㐀-鿿])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([㐀-鿿])/g, '$1 $2');
const short = (id: string) => id.replace(/^entity:/, '').slice(0, 8);
const CORE = new Set(['id', 'type', 'name']);

export function migrateToV4(input: Graph): { graph: Graph; changes: string[]; idMap: Record<string, string> } {
  const src = JSON.parse(JSON.stringify(input)) as { nodes: Old[]; edges: OldEdge[]; [k: string]: unknown };
  const changes: string[] = [];
  const idMap: Record<string, string> = {};
  const used = new Set<string>();
  const claim = (want: string) => { let id = want, i = 2; while (used.has(id)) id = `${want}-${i++}`; used.add(id); return id; };
  const byOld = new Map(src.nodes.map(n => [n.id, n]));
  const out = (id: string, p: string) => src.edges.filter(e => e.from === id && e.predicate === p).map(e => e.to);

  // Pass 1 — new type, name, name_en and canonical id for every node.
  const plan = new Map<string, { type: string; name: string; en?: string; id: string; extra: Attrs }>();
  const companyOf = (o: Old) => COMPANIES[o.id] ?? COMPANIES[short(o.id)];
  for (const o of src.nodes) {
    const loc = (o.localized_names ?? {}) as Record<string, string>;
    let type = o.type, name = loc['zh-TW'] && hasCjk(loc['zh-TW']) ? loc['zh-TW'] : o.name, en = loc.en;
    const extra: Attrs = {};
    let want = o.id;
    if (o.type === 'Company') {
      const c = companyOf(o);
      if (c) { [, name, en] = c; want = `company:${c[0]}`; if (c[3]) extra.country = c[3]; else extra.needs_review = ['country']; if (c[4]) extra.name_zh_missing = true; }
    } else if (RENAME[o.id]) { [name, en] = RENAME[o.id]; }
    if (o.type === 'Product' && o.kind === 'business_line') {
      type = 'BusinessLine';
      const seller = src.edges.find(e => e.to === o.id && e.predicate === 'SELLS')?.from, seg = out(o.id, 'TARGETS_SEGMENT')[0];
      const sc = seller ? companyOf(byOld.get(seller)!) : undefined;
      const segName = seg ? ((byOld.get(seg)?.localized_names as Record<string, string> | undefined)?.['zh-TW'] ?? byOld.get(seg)?.name) : '';
      if (sc && segName) name = pad(`${sc[1]}・${segName}業務`);
      want = `business_line:${sc?.[0] ?? short(o.id)}-${slug(String((byOld.get(seg ?? '')?.localized_names as Record<string, string> | undefined)?.en ?? seg ?? 'segment'))}`;
    } else if (o.type === 'Product' && SERVICES[short(o.id)]) {
      type = 'Service'; extra.kind = SERVICES[short(o.id)];
    }
    if ((type === 'Service' || type === 'Product') && o.split_from) {                              // 「欣銓 半導體…」→「欣銓・半導體…」
      const seller = src.edges.find(e => e.to === o.id && /SELLS|OFFERS_SERVICE/.test(e.predicate))?.from, sc = seller ? companyOf(byOld.get(seller)!) : undefined;
      if (sc) name = `${sc[1]}・${name.replace(new RegExp(`^${sc[1]}\\s+`), '')}`;
    }
    if (o.id.startsWith('entity:') || o.id.startsWith('market:') || o.id.startsWith('offering:') || type !== o.type) {
      const base = slug(en ?? o.name);
      if (type === 'MarketSegment') want = `segment:${base}`;
      else if (type === 'Product') want = o.id.includes(':', 7) ? `product:${base}-${slug(companyOf(byOld.get(src.edges.find(e => e.to === o.id && e.predicate === 'SELLS')?.from ?? '') ?? o)?.[0] ?? short(o.id.split(':').pop()!))}` : `product:${base}`;
      else if (type === 'Service') want = o.split_from ? `service:${slug(companyOf(byOld.get(src.edges.find(e => e.to === o.id && /SELLS|OFFERS_SERVICE/.test(e.predicate))?.from ?? '') ?? o)?.[0] ?? '')}-${base}` : `service:${base}`;
      else if (type === 'CompetitionAssessment') want = `competition:${base}`;
      else if (type === 'SupplyRelationship') want = `supply:${base}`;
      else if (type === 'Collaboration') want = `collaboration:${base}`;
      else if (type === 'ETF') want = `etf:${String(o.ticker ?? base)}`;
      else if (type === 'Evidence') want = `evidence:${short(o.id)}`;
      else if (type !== 'Company' && type !== 'BusinessLine') want = `${type.toLowerCase()}:${base}`;
    }
    if (type !== 'Evidence') name = pad(name);
    plan.set(o.id, { type, name, en, id: claim(want), extra });
  }
  for (const [old, p] of plan) if (old !== p.id) idMap[old] = p.id;
  const mapId = (x: unknown) => (typeof x === 'string' ? idMap[x] ?? x : x);

  // Record names that were English or code-like → the V4 naming rule (「A 對 B」, 「A 與 B 合資」).
  const nm = (oldId: string | undefined) => (oldId ? plan.get(oldId)?.name ?? oldId : '?');
  for (const o of src.nodes) {
    const p = plan.get(o.id)!;
    if (hasCjk(p.name)) continue;
    if (o.type === 'CompetitionAssessment') { p.en ??= o.name; p.name = pad(`${nm(out(o.id, 'OFFERING_A')[0])} 對 ${nm(out(o.id, 'OFFERING_B')[0])}`); }
    if (o.type === 'Collaboration') {
      const ps = out(o.id, 'HAS_PARTICIPANT').map(nm);
      p.en ??= o.name; p.name = pad(`${ps.slice(0, -1).join('、')}${ps.length > 1 ? '與' : ''}${ps[ps.length - 1] ?? ''}${COLLAB_WORD[String(o.collaboration_type)] ?? '合作'}`);
    }
  }

  // Pass 2 — build v4 nodes.
  const nodes: GraphNode[] = src.nodes.map(o => {
    const p = plan.get(o.id)!;
    const a: Attrs = {};
    for (const [k, v] of Object.entries(o)) if (!CORE.has(k) && k !== 'localized_names' && v !== undefined && v !== null && v !== '') a[k] = v;
    Object.assign(a, p.extra);
    if (p.en && p.en !== p.name) a.name_en = p.en;
    // Model numbers (DLAP-711) and source titles are not translated; other non-Chinese names are flagged.
    if (p.name === '3M') a.name_is_zh_usage = true;
    else if (!hasCjk(p.name) && !a.name_zh_missing && !['Evidence', 'Product', 'Service'].includes(p.type)) a.name_zh_missing = true;
    if (p.type === 'ETF' && !a.as_of) {   // snapshot date = latest constituent snapshot recorded on its holdings
      const dates = src.edges.filter(e => e.from === o.id && e.predicate === 'HOLDS_CONSTITUENT').map(e => String(e.as_of ?? '')).filter(Boolean).sort();
      if (dates.length) { a.as_of = dates[dates.length - 1]; changes.push(`${p.id}: as_of = ${a.as_of}（取自成分股紀錄）`); } else a.needs_review = ['as_of'];
    }
    // aliases: every other name the record already had (entity resolution: 凌華 / ADLINK / 6166)
    const loc = (o.localized_names ?? {}) as Record<string, string>;
    const al = new Set<string>([...(Array.isArray(o.aliases) ? o.aliases.map(String) : []), o.name, ...Object.values(loc), p.en ?? ''].filter(x => x && x !== p.name && x.length > 1));
    if (p.type === 'Company') { for (const x of [...al]) if (/^(Robotics|Probe|美國|WNC)$/.test(x)) al.delete(x); if (a.ticker) al.add(String(a.ticker)); }
    if (al.size && ['Company', 'ETF', 'CorporateGroup', 'Technology'].includes(p.type)) a.aliases = [...al]; else delete a.aliases;
    if (p.type !== o.type) changes.push(`${o.id}: ${o.type} → ${p.type}`);
    if (p.name !== o.name) changes.push(`${o.id}: 名稱「${o.name}」→「${p.name}」`);
    if (o.id !== p.id) a.legacy_ids = [o.id];
    // kinds
    if (p.type === 'Product') {
      if (a.kind === 'business_line') delete a.kind;
      if (!a.kind) { const r = KIND_RULES.find(([re]) => re.test(`${p.name} ${p.en ?? ''}`)); if (r) { a.kind = r[1]; changes.push(`${p.id}: kind = ${r[1]}（依品名）`); } else a.needs_review = [...((a.needs_review as string[]) ?? []), 'kind']; }
    }
    if (p.type === 'BusinessLine') delete a.kind;
    if (typeof a.kind === 'string' && KIND_FIX[a.kind]) a.kind = KIND_FIX[a.kind];
    // verification ≠ lifecycle
    if (typeof a.verification_status === 'string' && VERIFY_MAP[a.verification_status]) { a.verification_legacy = a.verification_status; a.verification_status = VERIFY_MAP[a.verification_status]; }
    const stage = String(a.stage ?? '');
    if (p.type === 'Collaboration' && COLLAB_LIFE[stage]) a.lifecycle_status = COLLAB_LIFE[stage];
    if (p.type === 'SupplyRelationship' && SUPPLY_LIFE[stage]) a.lifecycle_status = SUPPLY_LIFE[stage];
    if (p.type === 'CustomerOpportunity' && OPP_LIFE[stage]) a.lifecycle_status = OPP_LIFE[stage];
    if (p.type === 'SupplyRelationship') {
      const offs = [...out(o.id, 'FOR_SUPPLIED_PRODUCT'), ...out(o.id, 'FOR_SUPPLIED_SERVICE')].map(x => plan.get(x)?.type);
      if (offs.length) a.offering_kind = offs.every(t => t === 'Service') ? 'service' : offs.every(t => t === 'Product') ? 'product' : a.offering_kind;
    }
    if (p.type === 'Collaboration' && a.announced_at && !a.valid_from) a.valid_from = a.announced_at;
    // Evidence: V4 required url · publisher · published_at
    if (p.type === 'Evidence') {
      if (a.source_published_at) { a.published_at = a.source_published_at; delete a.source_published_at; }
      if (!a.publisher && typeof a.url === 'string') { try { a.publisher = new URL(a.url).hostname.replace(/^www\./, ''); a.publisher_method = 'url_host'; } catch { /* keep missing */ } }
      if (/ public source$/.test(p.name)) a.needs_review = [...((a.needs_review as string[]) ?? []), 'title'];
      if (!a.published_at) a.needs_review = [...((a.needs_review as string[]) ?? []), 'published_at'];
    }
    if (Array.isArray(a.evidence_ids)) a.evidence_ids = a.evidence_ids.map(mapId);
    if (a.split_from) a.split_from = mapId(a.split_from);
    return { id: p.id, type: p.type, name: p.name, attributes: a };
  });

  // Pass 3 — edges: remap ids, re-point relations for converted types, canonical fact ids.
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of src.edges) {
    const from = mapId(e.from) as string, to = mapId(e.to) as string;
    let predicate = e.predicate;
    if (typeOf.get(to) === 'BusinessLine' && predicate === 'SELLS') predicate = 'OPERATES_BUSINESS_LINE';
    if (typeOf.get(from) === 'BusinessLine' && predicate === 'TARGETS_SEGMENT') predicate = 'BUSINESS_LINE_IN_SEGMENT';
    if (typeOf.get(to) === 'Service' && predicate === 'FOR_SUPPLIED_PRODUCT') predicate = 'FOR_SUPPLIED_SERVICE';
    const a: Attrs = {};
    for (const [k, v] of Object.entries(e)) if (!['id', 'predicate', 'from', 'to'].includes(k) && v !== undefined && v !== null && v !== '') a[k] = v;
    if (typeof a.verification_status === 'string' && VERIFY_MAP[a.verification_status]) { a.verification_legacy = a.verification_status; a.verification_status = VERIFY_MAP[a.verification_status]; }
    if (Array.isArray(a.evidence_ids)) a.evidence_ids = a.evidence_ids.map(mapId);
    // Business-line links need evidence (V4); the business line's own sources support them.
    if ((predicate === 'OPERATES_BUSINESS_LINE' || predicate === 'BUSINESS_LINE_IN_SEGMENT') && !(Array.isArray(a.evidence_ids) && a.evidence_ids.length)) {
      const bl = nodes.find(n => n.id === (predicate === 'OPERATES_BUSINESS_LINE' ? to : from));
      const ev = Array.isArray(bl?.attributes.evidence_ids) ? bl!.attributes.evidence_ids : [];
      if (ev.length) { a.evidence_ids = ev; changes.push(`${e.id}: 證據取自業務線節點`); } else a.needs_review = ['evidence_ids'];
    }
    a.legacy_ids = [e.id];
    if (predicate !== e.predicate) changes.push(`${e.id}: ${e.predicate} → ${predicate}`);
    const key = `${predicate}|${from}|${to}`;
    if (seen.has(key)) { changes.push(`${e.id}: 重複的關係已合併`); continue; }
    seen.add(key);
    edges.push({ id: `fact:${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`, predicate, from, to, attributes: a });
  }

  const decisions = Array.isArray(src.suggestionDecisions) ? (src.suggestionDecisions as { id: string; recordId?: string }[]).map(d => ({ ...d, id: Object.entries(idMap).reduce((s, [o, n]) => s.split(o).join(n), d.id), recordId: d.recordId ? mapId(d.recordId) as string : undefined })) : [];
  const { nodes: _n, edges: _e, entityTypes: _t, edgeTypes: _p, ...meta } = src;
  const graph = applySchema({ ...meta, nodes, edges, entityTypes: [], edgeTypes: [], suggestionDecisions: decisions, migrated_from: String(src.ontology_version ?? 'unknown') } as Graph);
  return { graph, changes, idMap };
}
