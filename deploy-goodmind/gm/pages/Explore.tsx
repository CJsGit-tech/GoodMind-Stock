import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopBar from '../components/TopBar';
import FilterPanel from '../components/FilterPanel';
import ResearchConsole from '../components/ResearchConsole';
import type { GuideAction, GuideOption, GuideReply, Injected } from '../components/ResearchConsole';
import ChatSettings, { newRow, useRegistry } from '../components/ChatSettings';
import type { QPolicy, QRow } from '../components/ChatSettings';
import GraphView from '../components/GraphView';
import { initialGraph3D, rememberGraph3D } from '../components/graphShared';
import Dossier, { EdgeDossier } from '../components/Dossier';
import { decideSuggestion, runQuery, useAdmin, useGraph } from '../lib/api';
import { applyFilters, initialFilters } from '../lib/filters';
import type { FilterState } from '../lib/filters';
import { CLUSTER_COLORS, colorOf, typeName } from '../lib/theme';
import { withDerived } from '../core/derive';
import { computeSuggestions, suggestionEdges } from '../core/suggest';
import { groupMembers, groupsOf, groupTree } from '../core/groups';
import { CHAT_ENABLED, WORKSPACE_EDITABLE } from '../lib/features';
import { capNodes, sampleGraph, SAMPLE_DEFAULTS } from '../core/sample';
import type { SampleOptions } from '../core/sample';
import type { ChatResult, Graph, GraphEdge, GraphNode, Subset, ToolStep } from '../core/types';

type SampleCfg = Omit<SampleOptions, 'seed'>;
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const newSeed = () => Math.random().toString(36).slice(2, 8);
/** Seed from ?s= in the address (shareable), else the last one used on this browser, else a new one. */
function initialSeed() {
  const fromUrl = new URLSearchParams(window.location.search).get('s');
  return fromUrl || store.get('gm.sample.seed') || newSeed();
}
function initialCfg(): SampleCfg {
  try { const c = JSON.parse(store.get('gm.sample.cfg') ?? 'null'); if (c) return { ...SAMPLE_DEFAULTS, ...c, maxNodes: Math.min(SAMPLE_DEFAULTS.maxNodes, c.maxNodes ?? SAMPLE_DEFAULTS.maxNodes) }; } catch { /* ignore */ }
  return SAMPLE_DEFAULTS;
}

export default function Explore() {
  const { t } = useTranslation();
  const { data, error, reload } = useGraph();
  const { admin } = useAdmin();
  const [filters, setFilters] = useState<FilterState | null>(null);
  const [showDerived, setShowDerived] = useState(true);
  const [showSuggested, setShowSuggested] = useState(true);
  const [minStrength, setMinStrength] = useState(0.5);
  const [subset, setSubset] = useState<Subset | null>(null);           // chat answer or chosen path
  const [answer, setAnswer] = useState<ChatResult | null>(null);       // which answer the subset came from
  const [pathKey, setPathKey] = useState<string | null>(null);
  const [live, setLive] = useState<ToolStep[] | null>(null);           // retrieval steps while the agent works
  const [context, setContext] = useState(false);                       // subset: isolate vs. in context
  const [sel, setSel] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [labels, setLabels] = useState(true);
  const [threeD, setThreeD] = useState(initialGraph3D);                  // graph view: 2D unless this browser chose 3D
  const [panels, setPanels] = useState(() => ({ left: false, right: true }));   // left = advanced filters (right side), right = chat console (left side)
  const [gear, setGear] = useState(false);                               // ⚙ advanced settings inside the chat
  const [rows, setRows] = useState<QRow[]>([]);                          // query conditions (GQC)
  const [qpolicy, setQpolicy] = useState<QPolicy>(() => ({ verification: ['verified', 'reported', 'inferred'], asOf: new Date().toISOString().slice(0, 10), listed: false }));
  const [inject, setInject] = useState<Injected | null>(null);
  const [lens, setLens] = useState<string | null>(null);
  const reg = useRegistry();
  const [pending, setPending] = useState<string | null>(null);
  // Opening view: a seeded random sample (industries × companies, company-level depth), never more than cfg.maxNodes.
  const [seed, setSeedState] = useState(initialSeed);
  const [cfg, setCfgState] = useState<SampleCfg>(initialCfg);
  const [sampling, setSampling] = useState(true);
  const setSeed = (s: string) => {
    setSeedState(s); store.set('gm.sample.seed', s);
    const u = new URL(window.location.href); u.searchParams.set('s', s); window.history.replaceState(null, '', u);
  };
  const setCfg = (c: SampleCfg) => { setCfgState(c); store.set('gm.sample.cfg', JSON.stringify(c)); };

  // Ontology v2: groups → suggested links (dotted, never facts) on top of stored + computed links.
  const full = useMemo(() => (data ? withDerived({ ...data, suggestionDecisions: data.meta.suggestionDecisions } as Graph) : null), [data]);
  const sugg = useMemo(() => (full ? computeSuggestions(full) : []), [full]);
  const shownSugg = useMemo(() => sugg.filter(x => x.strength >= minStrength), [sugg, minStrength]);
  const graph = useMemo(() => {
    if (!data || !full) return null;
    const base = showDerived ? full : data;
    return showSuggested ? { ...base, edges: [...base.edges, ...suggestionEdges(shownSugg)] } : base;
  }, [data, full, showDerived, showSuggested, shownSugg]);
  const tree = useMemo(() => (full ? groupTree(full) : []), [full]);
  const sample = useMemo(() => (full ? sampleGraph(full, { ...cfg, seed }) : null), [full, cfg, seed]);
  const clusterNames = useMemo(() => (sample && full ? new Map(sample.industries.map(id => [id, full.nodes.find(n => n.id === id)?.name ?? ''])) : null), [sample, full]);
  const f = filters ?? (data ? initialFilters(data.entityTypes, data.edgeTypes) : null);
  const group = useMemo(() => (full && f?.groupId ? groupMembers(full, f.groupId) : null), [full, f?.groupId]);
  const liveSets = useMemo(() => (live ? { nodes: new Set(live.flatMap(s => s.nodeIds)), edges: new Set(live.flatMap(s => s.edgeIds)) } : null), [live]);

  const view = useMemo(() => {
    const empty = { nodes: [] as GraphNode[], edges: [] as GraphEdge[], hl: null as Set<string> | null, hlEdges: null as Set<string> | null };
    if (!graph || !f) return empty;
    const withExtra = (extra: Set<string>) => {                  // filtered galaxy + extra nodes, all lit relations kept
      const base = applyFilters(graph.nodes, graph.edges, f, null, group);
      const ids = new Set(base.nodes.map(n => n.id)); extra.forEach(id => ids.add(id));
      const keep = new Set(base.edges.map(e => e.id));
      return { nodes: graph.nodes.filter(n => ids.has(n.id)), edges: graph.edges.filter(e => ids.has(e.from) && ids.has(e.to) && (keep.has(e.id) || (extra.has(e.from) && extra.has(e.to)))) };
    };
    if (liveSets) return { ...withExtra(liveSets.nodes), hl: liveSets.nodes, hlEdges: liveSets.edges.size ? liveSets.edges : null };
    if (subset) {
      const pinned = new Set(subset.nodeIds), hlEdges = subset.edgeIds.length ? new Set(subset.edgeIds) : null;
      if (context) return { ...withExtra(pinned), hl: pinned, hlEdges };
      const iso = applyFilters(graph.nodes, graph.edges, f, pinned);
      // A path must show exactly its own hops, even when parallel relations exist between the same stars.
      return { nodes: iso.nodes, edges: subset.kind === 'path' ? iso.edges.filter(e => hlEdges?.has(e.id)) : iso.edges, hl: null, hlEdges };
    }
    const useSample = sampling && sample && !group && !f.focusId && !f.q.trim();
    return { ...applyFilters(graph.nodes, graph.edges, f, null, useSample ? sample.nodeIds : group), hl: null, hlEdges: null };
  }, [graph, f, subset, context, liveSets, group, sampling, sample]);
  // Hard cap on every view: highlighted, focused and selected nodes are kept first, then the most connected.
  const capped = useMemo(() => {
    const keep = new Set<string>([...(view.hl ?? []), ...(subset?.nodeIds ?? []), ...(f?.focusId ? [f.focusId] : []), ...(f?.groupId ? [f.groupId] : []), ...(sel ? [sel] : [])]);
    const { ids, total } = capNodes(view.nodes.map(n => n.id), view.edges, cfg.maxNodes, keep);
    if (ids.size === view.nodes.length) return { ...view, total };
    return { ...view, nodes: view.nodes.filter(n => ids.has(n.id)), edges: view.edges.filter(e => ids.has(e.from) && ids.has(e.to)), total };
  }, [view, cfg.maxNodes, subset, f?.focusId, f?.groupId, sel]);
  const fitKey = `${subset?.nodeIds.join() ?? ''}|${context}|${f?.focusId}|${f?.depth}|${showDerived}|${f?.groupId}|${sampling ? seed : ''}|${JSON.stringify(cfg)}`;

  if (error) return <div className="fullscreen-msg"><p className="eyebrow">{t('連線中斷')}</p><p>{t('無法連到 GoodMind 伺服器，請稍後再試。')}</p></div>;
  if (!data || !graph || !f) return <div className="fullscreen-msg"><div className="orb" /><p>{t('載入知識圖譜…')}</p></div>;
  const selected = sel ? graph.nodes.find(n => n.id === sel) ?? null : null;
  const selectedEdge = selEdge ? graph.edges.find(e => e.id === selEdge) ?? null : null;
  const visibleTypes = data.entityTypes.filter(t => capped.nodes.some(n => n.type === t.name));
  const allTypes = () => new Set(data.entityTypes.map(t => t.name));
  const pickNode = (id: string | null) => { setSel(id); setSelEdge(null); };
  const pickEdge = (id: string) => { setSelEdge(id); setSel(null); };
  const clearSubset = () => { setSubset(null); setAnswer(null); setPathKey(null); };
  const jump = (id: string) => {
    if (!capped.nodes.some(n => n.id === id)) { clearSubset(); setFilters({ ...f, focusId: id, depth: 1, types: allTypes() }); }
    pickNode(id);
  };
  const cite = (id: string) => {
    const e = graph.edges.find(x => x.id === id);
    const visible = (n: string) => capped.nodes.some(x => x.id === n);
    if (e ? !(visible(e.from) && visible(e.to)) : !visible(id)) setContext(true);
    if (e) pickEdge(id); else pickNode(id);
  };
  const decide = async (id: string, d: 'accept' | 'reject') => {
    const r = await decideSuggestion(id, d);
    if (!r.ok) return r.error;
    await reload();
    if (r.recordId) { setShowDerived(true); pickNode(r.recordId); } else { setSel(s => s); setSelEdge(null); }
  };
  // ---- Guided browsing: every chat option filters the galaxy live, then offers the next step.
  const byId = new Map(full!.nodes.map(n => [n.id, n]));
  const base = () => initialFilters(data.entityTypes, data.edgeTypes);
  const companiesIn = (id: string) => [...groupMembers(full!, id)].map(x => byId.get(x)!).filter(n => n?.type === 'Company').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const LENS: Record<string, { label: string; groups: string[]; extra: string[] }> = {
    competition: { label: t('誰跟誰競爭'), groups: ['competition'], extra: ['POSSIBLE_COMPETITOR', 'SELLS', 'BRANDS', 'OFFERS_SERVICE'] },
    supply: { label: t('誰供應給誰'), groups: ['supply'], extra: ['POSSIBLE_SUPPLIER', 'FEEDS_SEGMENT'] },
    collaboration: { label: t('誰和誰合作'), groups: ['collaboration'], extra: [] },
  };
  const LENS_SHORT: Record<string, string> = { competition: t('競爭'), supply: t('供應'), collaboration: t('合作') };
  const lensOptions: GuideOption[] = Object.entries(LENS).map(([k, v]) => ({ label: LENS_SHORT[k], hint: v.label, short: LENS_SHORT[k], kind: 'lens', action: { t: 'lens', k } as GuideAction }));
  const back: GuideOption = { label: t('回到開場'), kind: 'nav', action: { t: 'reset' } };
  const byIndustry: GuideOption = { label: t('依產業瀏覽'), hint: t('從產業、市場區隔一路縮小到公司'), action: { t: 'industries' } };
  const coLabel = (n: number) => t('{{n}} 家', { n });
  const companyOpts = (cos: GraphNode[], section = t('公司')): GuideOption[] => cos.slice(0, 30).map(c => ({ label: c.name, kind: 'company', section, action: { t: 'company', id: c.id } as GuideAction }));
  // ---- Query by clicking: each picked value becomes a GQC condition; results filter the graph and list companies.
  const Q_FIELDS: { field: string; types: string[] }[] = [{ field: 'industry', types: ['Industry'] }, { field: 'segment', types: ['MarketSegment'] }, { field: 'technology', types: ['Technology'] }, { field: 'application', types: ['Application'] }, { field: 'held_by', types: ['ETF'] }];
  const byQuery: GuideOption = { label: t('用條件找公司'), hint: t('用技術、應用、ETF 等條件組合'), action: { t: 'q-fields' } };
  const fieldLabel = (fld: string) => t(reg?.fields[fld]?.label ?? fld);
  async function runRows(rs: QRow[]): Promise<GuideReply> {
    const active = rs.filter(r => r.values.length);
    const more: GuideOption[] = [{ label: t('＋ 再加條件'), kind: 'nav', action: { t: 'q-fields' } }, { label: t('清除條件'), kind: 'nav', action: { t: 'q-clear' } }];
    if (!active.length) { clearSubset(); return { title: t('沒有條件'), text: '', options: [byQuery, byIndustry] }; }
    const filters: Record<string, unknown[]> = {};
    for (const r of active) (filters[r.mode] ??= []).push({ field: r.field, operator: r.operator, values: r.values });
    const body = { version: '4.0', result_type: 'company', ...(qpolicy.listed ? { universe: { listing_market: ['TWSE', 'TPEx'] } } : {}), filters, policy: { verification: qpolicy.verification.length ? qpolicy.verification : ['verified'], as_of: qpolicy.asOf, limit: 300 } };
    const res = await runQuery(body), j = res.data;
    if (!res.ok) return { title: t('查詢失敗'), text: (j.errors ?? [t('查詢失敗。')]).join('；'), options: more };
    type R = { company_id: string; name: string; matching_paths: { node_ids: string[]; fact_ids: string[] }[] };
    const results = j.results as R[];
    const nodeIds = new Set<string>(), edgeIds = new Set<string>();
    for (const r of results) { nodeIds.add(r.company_id); for (const p of r.matching_paths) { p.node_ids.forEach(x => nodeIds.add(x)); p.fact_ids.forEach(x => edgeIds.add(x)); } }
    setSel(null); setSelEdge(null); setAnswer(null); setPathKey(null); setContext(false);
    if (results.length) setSubset({ kind: 'answer', label: t('符合條件的公司'), nodeIds: [...nodeIds], edgeIds: [...edgeIds] }); else clearSubset();
    const unknown = Object.values((j.coverage?.unknown ?? {}) as Record<string, number>).reduce((s, n) => Math.max(s, n), 0);
    return { title: active.flatMap(r => r.values.map(name)).join(' ＋ '), stats: [t('{{n}} 家符合', { n: results.length }), ...(unknown ? [t('{{n}} 家資料不足', { n: unknown })] : [])],
      text: results.length ? '' : t('目前資料沒有符合的紀錄，不代表市場上不存在。'),
      options: [...results.slice(0, 30).map(r => ({ label: r.name, kind: 'company' as const, section: t('符合的公司'), action: { t: 'company', id: r.company_id } as GuideAction })), ...more] };
  }
  const guide = (a: GuideAction): GuideReply | Promise<GuideReply> => {
    const startOptions: GuideOption[] = [byQuery, byIndustry, ...lensOptions];
    if (a.t === 'start') return { text: '', options: startOptions };
    if (a.t === 'shuffle') {
      const s = newSeed(); setSeed(s); setSampling(true); clearSubset(); setSel(null); setSelEdge(null); setRows([]); setFilters({ ...f, groupId: null, focusId: null });
      return { text: '', options: [] };
    }
    if (a.t === 'q-fields') return { title: t('用條件找公司'), text: '', options: [...Q_FIELDS.map(q => ({ label: fieldLabel(q.field), kind: 'chip' as const, section: t('選一種條件'), action: { t: 'q-pick', field: q.field } as GuideAction })), ...(rows.length ? [{ label: t('清除條件'), kind: 'nav' as const, action: { t: 'q-clear' } as GuideAction }] : [])] };
    if (a.t === 'q-pick') {
      const types = Q_FIELDS.find(q => q.field === a.field)?.types ?? [];
      const vals = full!.nodes.filter(n => types.includes(n.type) && !rows.some(r => r.field === a.field && r.values.includes(n.id))).sort((x, y) => x.name.localeCompare(y.name, 'zh-Hant')).slice(0, 40);
      return { title: fieldLabel(a.field), stats: [t('{{n}} 個選項', { n: vals.length })], text: vals.length ? '' : t('目前資料沒有可選的{{field}}。', { field: fieldLabel(a.field) }),
        options: vals.map(n => ({ label: n.name, kind: 'chip' as const, action: { t: 'q-add', field: a.field, id: n.id } as GuideAction })) };
    }
    if (a.t === 'q-add') {
      const fld = reg?.fields[a.field];
      const rs = [...rows, newRow(a.field, fld?.operators[0] ?? 'related_to', [a.id])];
      setRows(rs); setFilters({ ...f, groupId: null, focusId: null });
      return runRows(rs);
    }
    if (a.t === 'q-clear') { setRows([]); clearSubset(); return { text: '', options: [] }; }
    if (a.t === 'lens') {   // a lens is a toggle on whatever is shown; it does not change the step
      const l = LENS[a.k], same = lens === a.k;
      setLens(l && !same ? a.k : null); setShowDerived(true); setShowSuggested(true);
      setFilters({ ...f, preds: new Set(data.edgeTypes.filter(p => !l || same || l.groups.includes(p.group) || l.extra.includes(p.predicate)).map(p => p.predicate)) });
      return { text: '', options: [] };
    }
    clearSubset(); setSel(null); setSelEdge(null);
    if (a.t === 'reset') { setFilters(base()); setLens(null); setRows([]); setSampling(true); return { text: '', options: startOptions }; }
    if (a.t === 'more') return f.groupId ? guide({ t: 'group', id: f.groupId }) : { text: '', options: startOptions };
    if (a.t === 'industries') return { title: t('產業'), stats: [t('{{n}} 個', { n: tree.length })], text: '',
      options: tree.map(x => ({ label: x.industry.name, kind: 'bar' as const, count: companiesIn(x.industry.id).length, action: { t: 'group', id: x.industry.id } as GuideAction })).sort((x, y) => y.count - x.count) };
    if (a.t === 'group') {
      const n = byId.get(a.id)!, cos = companiesIn(a.id);
      setFilters({ ...f, groupId: a.id, focusId: null, types: new Set(data.entityTypes.map(t => t.name).filter(t => t !== 'Evidence')) });
      const segs = n.type === 'Industry' ? tree.find(t => t.industry.id === a.id)?.segments ?? [] : [];
      return { title: n.name, stats: [t('{{n}} 家公司', { n: cos.length }), ...(segs.length ? [t('{{n}} 個區隔', { n: segs.length })] : [])], text: '',
        options: [...lensOptions,
          ...segs.map(s => ({ label: s.segment.name, kind: 'bar' as const, count: s.companies, section: t('市場區隔'), action: { t: 'group', id: s.segment.id } as GuideAction })).sort((x, y) => y.count - x.count),
          ...companyOpts(cos), ...(n.type !== 'Industry' ? [{ label: t('換一個產業'), kind: 'nav' as const, action: { t: 'industries' } as GuideAction }] : []), back] };
    }
    if (a.t === 'companies') { const cos = companiesIn(a.id); return { title: byId.get(a.id)?.name ?? '', stats: [coLabel(cos.length)], text: '', options: [...companyOpts(cos), back] }; }
    if (a.t !== 'company') return { text: '', options: startOptions };
    const c = byId.get(a.id)!;
    setFilters({ ...f, focusId: a.id, depth: 1, groupId: null, types: allTypes(), preds: new Set(data.edgeTypes.map(p => p.predicate)) }); setSel(a.id);
    const rels = full!.edges.filter(e => !e.suggested && (e.from === a.id || e.to === a.id)).length;
    const ticker = String(c.attributes?.ticker ?? c.attributes?.stock_code ?? '');
    const ask = (q: string, label: string): GuideOption => ({ label, ask: q, kind: 'ask', section: t('問問題') });
    return { title: c.name, stats: [...(ticker ? [ticker] : []), t('{{n}} 條關係', { n: rels }), ...[...new Set(groupsOf(full!, a.id).map(x => x.industry?.name).filter((x): x is string => !!x))].slice(0, 1)], text: '',
      options: [...lensOptions,
        ...(CHAT_ENABLED ? [ask(t('{{name}}的競爭對手有哪些？', { name: c.name }), t('競爭對手')), ask(t('{{name}}的供應商和客戶有哪些？', { name: c.name }), t('供應商與客戶')), ask(t('{{name}}和誰合作？', { name: c.name }), t('合作夥伴'))] : []),
        back] };
  };

  // ---- What is applied right now (shown as chips at the top of the chat; each can be removed).
  const allPreds = () => new Set(data.edgeTypes.map(p => p.predicate));
  const name = (id: string) => full!.nodes.find(n => n.id === id)?.name ?? id;
  const rerun = (rs: QRow[]) => { setRows(rs); runRows(rs).then(reply => setInject({ id: Date.now(), reply })); };
  const sampleOn = sampling && !!sample && !f.groupId && !f.focusId && !subset && !rows.some(r => r.values.length);
  const applied: { key: string; label: string; clear: () => void }[] = [
    ...(f.groupId ? [{ key: 'group', label: t('範圍：{{name}}', { name: name(f.groupId) }), clear: () => setFilters({ ...f, groupId: null }) }] : []),
    ...(lens ? [{ key: 'lens', label: LENS[lens]?.label, clear: () => { setLens(null); setFilters({ ...f, preds: allPreds() }); } }] : []),
    ...(f.focusId ? [{ key: 'focus', label: t('聚焦：{{name}}', { name: name(f.focusId) }), clear: () => setFilters({ ...f, focusId: null }) }] : []),
    ...rows.filter(r => r.values.length).map(r => ({ key: `q${r.key}`, label: `${r.mode === 'not' ? t('排除') + ' ' : r.mode === 'any' ? t('或') + ' ' : ''}${fieldLabel(r.field)}：${r.values.map(name).join('、')}`, clear: () => rerun(rows.filter(x => x.key !== r.key)) })),
  ];
  const clearAll = () => { setFilters(base()); setLens(null); setRows([]); clearSubset(); pickNode(null); setSampling(true); };
  const doShuffle = () => { const r = guide({ t: 'shuffle' }) as GuideReply; setInject({ id: Date.now(), reply: r, home: true }); };   // the sample bar already names the new set
  const openGroup = (id: string) => { const r = guide({ t: 'group', id }) as GuideReply; setInject({ id: Date.now(), reply: r, crumb: { label: byId.get(id)?.name ?? '', action: { t: 'group', id } } }); };
  const sampleChip = sampleOn ? (
    <div className="sample-bar" aria-label={t('隨機樣本')}>
      <div className="sample-pills">{sample!.industries.map((x, i) => (
        <button key={x} className="sample-pill" onClick={() => openGroup(x)} title={t('只看{{name}}', { name: byId.get(x)?.name })}><i style={{ background: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }} />{byId.get(x)?.name}</button>))}</div>
      <button className="icon-btn dice" onClick={doShuffle} aria-label={t('換一組')} title={t('換一組 · {{b}} 家公司 · 深度 {{d}}', { b: sample!.seeds.length, d: cfg.depth })}>
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor"/></svg>
      </button>
    </div>) : null;
  const chips = applied.length || sampleChip ? (<>
    {sampleChip}
    {applied.length > 0 && <div className="applied" aria-label={t('目前套用的篩選')}>
      {applied.map(c => <span key={c.key} className="chip">{c.label}<button aria-label={t('移除 {{name}}', { name: c.label })} onClick={c.clear}>✕</button></span>)}
      <button className="link" onClick={clearAll}>{t('全部清除')}</button>
    </div>}</>) : null;
  const settings = <ChatSettings nodes={full!.nodes} types={data.entityTypes} rows={rows.length ? rows : [newRow()]} setRows={setRows} policy={qpolicy} setPolicy={setQpolicy}
    display={{ labels, suggested: showSuggested, derived: showDerived, filterPanel: panels.left, threeD }}
    sample={cfg} setSample={c => { setCfg(c); setSampling(true); }} onShuffle={() => { setGear(false); doShuffle(); }}
    setDisplay={d => { if (d.threeD !== threeD) { setThreeD(d.threeD); rememberGraph3D(d.threeD); } setLabels(d.labels); setShowSuggested(d.suggested); setShowDerived(d.derived); setPanels(p => ({ ...p, left: d.filterPanel })); }}
    onApply={() => { const rs = rows.filter(r => r.values.length); setGear(false); setFilters({ ...f, groupId: null, focusId: null }); runRows(rs).then(reply => setInject({ id: Date.now(), user: t('用進階設定找公司'), reply })); }}
    onClose={() => setGear(false)} />;

  const common = { nodes: graph.nodes, edges: graph.edges, types: data.entityTypes, edgeTypes: data.edgeTypes, onSelect: pickNode, onClose: () => { setSel(null); setSelEdge(null); },
    suggestions: sugg, onDecide: WORKSPACE_EDITABLE && admin ? decide : undefined, onGroup: (id: string) => { clearSubset(); setFilters({ ...f, groupId: id, focusId: null, types: new Set(data.entityTypes.map(t => t.name).filter(t => t !== 'Evidence')) }); setSel(null); setSelEdge(null); },
    groupsOf: (id: string) => groupsOf(full!, id) };

  return (
    <div className={`app ${panels.left ? '' : 'no-left'} ${panels.right ? '' : 'no-right'} ${selected || selectedEdge ? 'has-dossier' : ''}`}>
      <div className="starfield" aria-hidden />
      <GraphView want3d={threeD} nodes={capped.nodes} edges={capped.edges} types={data.entityTypes} edgeTypes={data.edgeTypes} selectedId={subset?.kind === 'path' ? null : sel} selectedEdgeId={selEdge}
        highlight={capped.hl} highlightEdges={capped.hlEdges} clusters={sampleOn ? sample!.cluster : null} clusterNames={clusterNames} onSelect={pickNode} onSelectEdge={pickEdge} showLabels={labels} fitKey={fitKey}
        offsetX={window.innerWidth > 860 ? (panels.right ? 165 : 0) - (selected || selectedEdge || panels.left ? 155 : 0) : 0} />
      <TopBar stats={capped.total > capped.nodes.length ? t('{{n}} / {{total}} 個節點 · {{m}} 條關係', { n: capped.nodes.length, total: capped.total, m: capped.edges.length }) : t('{{n}} 個節點 · {{m}} 條關係', { n: capped.nodes.length, m: capped.edges.length })} nodes={graph.nodes} types={data.entityTypes} onJump={jump} />

      {panels.left && !selected && !selectedEdge && <FilterPanel f={f} set={setFilters} types={data.entityTypes} preds={data.edgeTypes} nodes={graph.nodes} edges={graph.edges}
        focusName={graph.nodes.find(n => n.id === f.focusId)?.name} locked={!!subset} onUnlock={clearSubset}
        showDerived={showDerived} setShowDerived={setShowDerived}
        tree={tree} groupName={full?.nodes.find(n => n.id === f.groupId)?.name}
        showSuggested={showSuggested} setShowSuggested={setShowSuggested} minStrength={minStrength} setMinStrength={setMinStrength}
        suggestionCount={shownSugg.length} suggestionTotal={sugg.length}
        onReset={() => { setFilters(initialFilters(data.entityTypes, data.edgeTypes)); clearSubset(); pickNode(null); }} />}
      {panels.right && <ResearchConsole aiConfigured={data.aiConfigured} chatEnabled={CHAT_ENABLED} guide={guide} activeResult={answer}
        lens={lens} chips={chips} settings={settings} settingsOpen={gear} onGear={() => setGear(v => !v)} inject={inject} onRestart={() => { setGear(false); clearAll(); }} pending={pending} clearPending={() => setPending(null)}
        onLive={steps => { setLive(steps); if (steps) { setSel(null); setSelEdge(null); } }} onCite={cite}
        onResult={r => { setAnswer(r); setPathKey(null); setSubset({ kind: 'answer', label: t('回答用到的資料'), nodeIds: r.nodeIds, edgeIds: r.edgeIds }); setSel(null); setSelEdge(null); }} />}

      <div className="hud">
        {live && <div className="hud-chip live"><span>{t('查詢中 · 已找到 {{n}} 個節點', { n: liveSets!.nodes.size })}</span></div>}
        {!live && subset && <div className={`hud-chip ${subset.kind}`}><span>{subset.label} · {t('{{n}} 個節點', { n: subset.nodeIds.length })}</span>
          <div className="seg"><button className={!context ? 'on' : ''} onClick={() => setContext(false)}>{t('只看這些')}</button><button className={context ? 'on' : ''} onClick={() => setContext(true)}>{t('放回全圖')}</button></div>
          <button className="link" onClick={clearSubset}>{t('清除')}</button></div>}
      </div>

      <div className="legend">{visibleTypes.map(x => <span key={x.name} style={{ ['--c' as string]: colorOf(data.entityTypes, x.name) }}><i />{typeName(data.entityTypes, x.name)}</span>)}</div>
      {!capped.nodes.length && <div className="void">{t('沒有符合篩選條件的節點。')}</div>}

      {selectedEdge && <EdgeDossier edge={selectedEdge} {...common} />}
      {selected && <Dossier node={selected} {...common} activePath={pathKey}
        onAsk={CHAT_ENABLED ? q => { setPanels(p => ({ ...p, right: true })); setPending(q); } : undefined}
        onShowPath={(path, label) => {
          if (!path) { if (subset?.kind === 'path') clearSubset(); return; }
          setAnswer(null); setContext(false); setPathKey(path.edges.map(e => e.id).join('>'));
          setSubset({ kind: 'path', label: label ?? t('連結路徑'), nodeIds: path.nodeIds, edgeIds: path.edges.map(e => e.id) });
        }}
        onFocus={id => { clearSubset(); setFilters({ ...f, focusId: id, groupId: null, types: allTypes() }); }} />}
    </div>
  );
}
