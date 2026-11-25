// Details panel. Order: what it is → key facts → relations → evidence → find a connection → AI suggestions (collapsed).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../../lib/types';
import { at, atList } from '../../lib/types';
import { findPaths, STATUS_WEIGHT } from '../../lib/query';
import type { RankedPath } from '../../lib/query';
import type { Suggestion } from '../../lib/suggest';
import { attrLabel, valueLabel } from '../i18n';
import { searchText } from '../lib/filters';
import { colorOf, LINK_TONES, linkTone, relName, statusLabel, statusTone, typeName } from '../lib/theme';

/** Bookkeeping fields that are not shown as facts. */
const SKIP = new Set(['evidence_ids', 'legacy_ids', 'curation', 'needs_review', 'verification_legacy', 'name_en', 'recorded_at', 'name_zh_missing', 'name_is_zh_usage', 'publisher_method', 'date_method', 'link_checked_at', 'link_status', 'reverified_for_package', 'split_from']);
const FREE_TEXT = new Set(['notes', 'scope', 'aliases', 'basis', 'ticker', 'url', 'website', 'publisher', 'exchange', 'buyer_type', 'region', 'source_type']);
const DAY = 86400000;
/** How an incoming relation reads from this node's side when the registry has no inverse name. */
const INCOMING: Record<string, string> = { HAS_PARTICIPANT: '參與的合作', HAS_SUPPLIER: '擔任供應方的紀錄', HAS_BUYER: '擔任買方的紀錄', HOLDS_CONSTITUENT: '持有它的 ETF', OFFERING_A: '相關的競爭評估', OFFERING_B: '相關的競爭評估',
  FOR_SUPPLIED_PRODUCT: '相關的供應紀錄', FOR_SUPPLIED_SERVICE: '相關的供應紀錄', FOCUSES_ON_PRODUCT: '相關的合作', FOCUSES_ON_TECHNOLOGY: '相關的合作', TARGETS_MARKET: '相關的合作', COMPETES_IN_SEGMENT: '這裡的競爭評估', COMPETES_IN_CATEGORY: '這裡的競爭評估',
  TARGETS_SEGMENT: '這個區隔的商品', IN_CATEGORY: '這個類別的商品', USES_TECHNOLOGY: '使用它的商品', SUPPORTS_APPLICATION: '支援它的商品', OPERATES_IN: '經營這個產業的公司', BUSINESS_LINE_IN_SEGMENT: '這個區隔的業務線', OPERATES_BUSINESS_LINE: '經營的公司', FEEDS_SEGMENT: '上游區隔' };
const STORAGE_ZH: Record<string, string> = { asserted: '人工建立', asserted_or_derived: '人工建立或系統算出', derived_or_asserted: '人工建立或系統算出', derived_only: '系統算出', query_derived_only: '查詢時算出', suggested_only: 'AI 建議' };

function Evidence({ ids, byId }: { ids: unknown; byId: Map<string, GraphNode> }) {
  const { t } = useTranslation();
  const ev = (Array.isArray(ids) ? ids : []).map(i => byId.get(String(i))).filter(Boolean) as GraphNode[];
  if (!ev.length) return <p className="fine">{t('沒有附來源，請視為尚未證實。')}</p>;
  return <ul className="evidence">{ev.map(x => {
    const d = at(x, 'last_verified_at') ?? at(x, 'published_at'), ok = !!d && !Number.isNaN(Date.parse(String(d)));
    const days = ok ? Math.floor((Date.now() - Date.parse(String(d))) / DAY) : 0;
    return (
      <li key={x.id}><a href={String(at(x, 'url'))} target="_blank" rel="noreferrer">{x.name} ↗</a>
        <span className="fine">{[at(x, 'publisher'), ok ? String(d) : t('日期未記錄')].filter(Boolean).join(' · ')}</span>
        {ok && days > 540 && <span className="status on warn">{t('超過 18 個月')}</span>}</li>); })}</ul>;
}

type Common = { nodes: GraphNode[]; edges: GraphEdge[]; types: EntityType[]; edgeTypes: EdgeType[]; onSelect: (id: string) => void; onClose: () => void;
  suggestions: Suggestion[]; onGroup: (id: string) => void;
  groupsOf: (id: string) => { segment: GraphNode; industry?: GraphNode }[] };

/** One suggested link: who, why and how strong. */
export function SuggestionCard({ s, self, by, onSelect }: { s: Suggestion; self?: string; by: Map<string, GraphNode>; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const other = self ? (s.from === self ? s.to : s.from) : null;
  const verb = s.kind === 'competition' ? t('可能競爭') : self ? (s.from === self ? t('可能供應給') : t('可能採購自')) : t('可能供應給');
  return (
    <li className={`sugg ${s.kind}`}>
      <div className="sugg-head">
        {other ? <><span className="verb">{verb}</span><button className="link" onClick={() => onSelect(other)}>{by.get(other)?.name ?? other}</button></>
          : <><button className="link" onClick={() => onSelect(s.from)}>{by.get(s.from)?.name}</button><span className="verb">{verb}</span><button className="link" onClick={() => onSelect(s.to)}>{by.get(s.to)?.name}</button></>}
        <span className="score"><i style={{ width: `${Math.round(s.strength * 100)}%` }} />{Math.round(s.strength * 100)}%</span>
      </div>
      <ul className="why">{s.reasons.slice(0, 3).map(r => <li key={r}>{r}</li>)}</ul>
    </li>);
}

function GroupCrumbs({ node, p }: { node: GraphNode; p: Common }) {
  const { t } = useTranslation();
  const crumbs = p.groupsOf(node.id);
  if (['Industry', 'MarketSegment', 'ProductCategory'].includes(node.type))
    return <div className="crumbs"><button className="ghost-btn sm" onClick={() => p.onGroup(node.id)}>{t('顯示這個分組的所有成員')}</button></div>;
  if (!crumbs.length) return null;
  return <div className="crumbs">{crumbs.map(({ segment, industry }) => (
    <span key={segment.id} className="crumb">{industry && <><button className="link" onClick={() => p.onGroup(industry.id)}>{industry.name}</button><em>›</em></>}
      <button className="link" onClick={() => p.onGroup(segment.id)}>{segment.name}</button></span>))}</div>;
}

/** Key facts with friendly labels and translated values. */
function Facts({ item }: { item: GraphNode | GraphEdge }) {
  const rows = Object.entries(item.attributes).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '' && (typeof v !== 'object' || (Array.isArray(v) && v.length > 0)));
  if (!rows.length) return null;
  const show = (k: string, v: unknown): React.ReactNode => {
    if (k === 'verification_status') return <span className={`status on ${statusTone(v)}`}>{statusLabel(v)}</span>;
    if ((k === 'url' || k === 'website') && typeof v === 'string') return <a href={v} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)} ↗</a>;
    if (Array.isArray(v)) return FREE_TEXT.has(k) ? v.join(' · ') : v.map(valueLabel).join(' · ');
    return FREE_TEXT.has(k) || typeof v === 'number' || /^\d{4}-\d{2}/.test(String(v)) ? String(v) : valueLabel(v);
  };
  return <dl className="attrs">{rows.map(([k, v]) => <div key={k}><dt>{attrLabel(k)}</dt><dd>{show(k, v)}</dd></div>)}</dl>;
}

export function EdgeDossier({ edge, ...p }: Common & { edge: GraphEdge }) {
  const { t } = useTranslation();
  const by = new Map(p.nodes.map(n => [n.id, n]));
  const a = by.get(edge.from), b = by.get(edge.to), def = p.edgeTypes.find(x => x.predicate === edge.predicate);
  const tone = linkTone(at(edge, 'verification_status'), edge.derived === true, edge.suggested === true);
  const records = atList(edge, 'source_records').map(id => by.get(id)).filter(Boolean) as GraphNode[];
  return (
    <aside className="glass dossier" style={{ ['--c' as string]: `rgb(${LINK_TONES[tone].color})` }} aria-label={t('關係資料')}>
      <header className="ph">
        <div><p className="eyebrow"><i className="dot" />{t('關係')}{edge.derived && !edge.suggested ? ` · ${t('系統算出')}` : ''}</p><h2>{relName(p.edgeTypes, edge.predicate)}</h2></div>
        <button className="ghost-btn sm" onClick={p.onClose} aria-label={t('關閉')}>✕</button>
      </header>
      <div className="scroll dossier-body">
        <div className="edge-ends">
          <button className="end" style={{ ['--c' as string]: colorOf(p.types, a?.type ?? '') }} onClick={() => a && p.onSelect(a.id)}><i />{a?.name}<small>{typeName(p.types, a?.type ?? '')}</small></button>
          <span className="edge-arrow">{edge.symmetric ? '⟷' : '⟶'}</span>
          <button className="end" style={{ ['--c' as string]: colorOf(p.types, b?.type ?? '') }} onClick={() => b && p.onSelect(b.id)}><i />{b?.name}<small>{typeName(p.types, b?.type ?? '')}</small></button>
        </div>
        {def && <p className="meaning-text">{def.meaning}</p>}
        {edge.suggested === true && (() => { const s = p.suggestions.find(x => x.id === at(edge, 'suggestion_id')); return s ? <>
          <h3>{t('為什麼建議')} <span className="sub">{t('接受前不是事實')}</span></h3>
          <ul className="rels suggs"><SuggestionCard s={s} by={by} onSelect={p.onSelect} /></ul></> : null; })()}
        <dl className="attrs">
          <div><dt>{attrLabel('verification_status')}</dt><dd><span className={`status on ${statusTone(at(edge, 'verification_status'))}`}>{statusLabel(at(edge, 'verification_status'))}</span></dd></div>
          {at(edge, 'lifecycle_status') ? <div><dt>{attrLabel('lifecycle_status')}</dt><dd>{valueLabel(at(edge, 'lifecycle_status'))}</dd></div> : null}
          {at(edge, 'role') ? <div><dt>{attrLabel('role')}</dt><dd>{valueLabel(at(edge, 'role'))}</dd></div> : null}
          <div><dt>{t('信心權重')}</dt><dd>{Math.round((STATUS_WEIGHT[String(at(edge, 'verification_status') ?? 'reported')] ?? 0.4) * 100)}%</dd></div>
          {def && <div><dt>{t('來源方式')}</dt><dd>{t(STORAGE_ZH[def.storage] ?? def.storage)}</dd></div>}
        </dl>
        {edge.derived === true && edge.suggested !== true && <>
          <h3>{t('依據的紀錄')} <span className="sub">{records.length}</span></h3>
          <p className="fine">{t('這條關係由下列紀錄推算，不是獨立驗證的事實。')}</p>
          <ul className="rels">{records.map(r => <li key={r.id}><button className="link" onClick={() => p.onSelect(r.id)}>{r.name}</button></li>)}</ul>
        </>}
        <h3>{t('來源')}</h3>
        <Evidence ids={at(edge, 'evidence_ids')} byId={by} />
      </div>
    </aside>
  );
}

export default function Dossier({ node, onFocus, onShowPath, activePath, ...p }: Common & {
  node: GraphNode; onFocus: (id: string) => void;
  onShowPath: (path: RankedPath | null, label?: string) => void; activePath: string | null;
}) {
  const { t } = useTranslation();
  const by = new Map(p.nodes.map(n => [n.id, n]));
  const rel = p.edges.filter(e => (e.from === node.id || e.to === node.id) && !e.suggested);
  const review = atList(node, 'needs_review');
  const [target, setTarget] = useState('');
  const [q, setQ] = useState('');
  const paths = useMemo(() => (target ? findPaths({ nodes: p.nodes, edges: p.edges.filter(e => !e.suggested), entityTypes: p.types, edgeTypes: p.edgeTypes }, node.id, target, 3, 6) : []), [target, node.id, p.nodes, p.edges, p.types, p.edgeTypes]);
  const s = q.normalize('NFKC').toLowerCase().trim();
  const hits = s ? p.nodes.filter(n => n.id !== node.id && n.type !== 'Evidence' && searchText(n).normalize('NFKC').toLowerCase().includes(s)).slice(0, 8) : [];
  const pathKey = (x: RankedPath) => x.edges.map(e => e.id).join('>');
  const mine = p.suggestions.filter(x => x.from === node.id || x.to === node.id);
  // Relations grouped by relation and direction, so a company with 30 links reads as a handful of lines.
  const grouped = useMemo(() => {
    const m = new Map<string, { key: string; out: boolean; predicate: string; items: { e: GraphEdge; o: GraphNode | undefined }[] }>();
    for (const e of rel) { const out = e.from === node.id, key = `${e.predicate}|${out}`; (m.get(key) ?? m.set(key, { key, out, predicate: e.predicate, items: [] }).get(key)!).items.push({ e, o: by.get(out ? e.to : e.from) }); }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel.length, node.id]);
  const inverse = (pred: string) => INCOMING[pred] ?? p.edgeTypes.find(x => x.predicate === pred)?.inverse_label;
  return (
    <aside className="glass dossier" style={{ ['--c' as string]: colorOf(p.types, node.type) }} aria-label={t('節點資料')}>
      <header className="ph">
        <div><p className="eyebrow"><i className="dot" />{typeName(p.types, node.type)}</p><h2>{node.name}</h2>{at(node, 'name_en') ? <p className="fine">{String(at(node, 'name_en'))}</p> : null}</div>
        <button className="ghost-btn sm" onClick={p.onClose} aria-label={t('關閉')}>✕</button>
      </header>
      <div className="actions">
        <button className="primary-btn" onClick={() => onFocus(node.id)}>{t('只看它的關係')}</button>
      </div>
      <div className="scroll dossier-body">
        <GroupCrumbs node={node} p={p} />
        {review.length > 0 && <p className="curation-note"><span className="status on warn">{t('待補資料')}</span> {review.map(attrLabel).join('、')}</p>}
        <Facts item={node} />

        <h3>{t('關係')} <span className="sub">{rel.length}</span></h3>
        {!rel.length && <p className="fine">{t('目前沒有記錄任何關係。')}</p>}
        <div className="rel-groups">{grouped.map(g => (
          <details key={g.key} open={grouped.length <= 6 || g.items.length <= 4}>
            <summary><span>{g.out ? relName(p.edgeTypes, g.predicate) : (inverse(g.predicate) && t(inverse(g.predicate)!)) || t('被「{{rel}}」', { rel: relName(p.edgeTypes, g.predicate) })}</span><em>{g.items.length}</em></summary>
            <ul className="rels">{g.items.map(({ e, o }) => (
              <li key={e.id}>
                <button className="link" onClick={() => o && p.onSelect(o.id)}>{o?.name ?? '?'}</button>
                {e.derived === true && <span className="tag">{t('系統算出')}</span>}
                <span className={`status on ${statusTone(at(e, 'verification_status'))}`}>{statusLabel(at(e, 'verification_status'))}</span>
              </li>))}</ul>
          </details>))}</div>

        <h3>{t('來源')}</h3>
        <Evidence ids={at(node, 'evidence_ids')} byId={by} />

        <h3>{t('找出和另一個節點的連結')}</h3>
        {target ? <div className="focus-chip"><span>{node.name} → <b>{by.get(target)?.name}</b></span><button className="link" aria-label={t('清除')} onClick={() => { setTarget(''); onShowPath(null); }}>✕</button></div>
          : <div className="conn-search"><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('輸入公司、產品或技術名稱')} aria-label={t('找出和另一個節點的連結')} />
            {hits.length > 0 && <ul>{hits.map(n => <li key={n.id}><button className="link" onClick={() => { setTarget(n.id); setQ(''); }}>{n.name}</button><span className="fine">{typeName(p.types, n.type)}</span></li>)}</ul>}</div>}
        {target && !paths.length && <p className="fine">{t('3 層以內找不到連結；這不代表沒有關係。')}</p>}
        {paths.length > 0 && <ol className="paths">{paths.map((x, i) => {
          const k = pathKey(x), on = activePath === k;
          return (
            <li key={k}><button className={`path ${on ? 'on' : ''}`} onClick={() => onShowPath(on ? null : x, `${node.name} → ${by.get(target)?.name}`)}>
              <span className="rank">#{i + 1}</span>
              <span className="chain">{x.nodeIds.map((id, j) => <Frag key={id + j} last={j === x.nodeIds.length - 1} name={by.get(id)?.name ?? id} edge={x.edges[j]} label={x.edges[j] ? relName(p.edgeTypes, x.edges[j].predicate) : ''} />)}</span>
              <span className="score"><i style={{ width: `${Math.round(x.score * 100)}%` }} />{Math.round(x.score * 100)}%</span>
            </button></li>);
        })}</ol>}

        {mine.length > 0 && <details className="sugg-fold">
          <summary><span>{t('AI 建議的關係')}</span><em>{mine.length}</em></summary>
          <p className="fine">{t('由共同分組推算，接受前不是事實。')}</p>
          <ul className="rels suggs">{mine.slice(0, 8).map(x => <SuggestionCard key={x.id} s={x} self={node.id} by={by} onSelect={p.onSelect} />)}</ul>
          {mine.length > 8 && <p className="fine">{t('另有 {{n}} 筆較弱的建議，可在「資料規則」頁查看。', { n: mine.length - 8 })}</p>}
        </details>}
        <p className="fine id-line"><code>{node.id}</code></p>
      </div>
    </aside>
  );
}

function Frag({ name, edge, last, label }: { name: string; edge?: GraphEdge; last: boolean; label: string }) {
  return <><b>{name}</b>{!last && edge && <em className={`hop ${linkTone(at(edge, 'verification_status'), edge.derived === true)}`}>{label}</em>}</>;
}
