// Data reference (V4 ontology), kept short on purpose: node type schema, search structure, available relations.
// All three tables are read live from the registry, so they never drift from the rules in use.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphData } from '../lib/api';
import { attrLabel, valueLabel } from '../i18n';
import { colorOf, groupLabel, relName, typeName } from '../lib/theme';
import { useRegistry } from './ChatSettings';

const LAYERS: [string, string[]][] = [
  ['主體', ['Company', 'CorporateGroup', 'OrganizationUnit', 'Product', 'Service', 'ProductFamily', 'BusinessLine']],
  ['分類', ['Industry', 'MarketSegment', 'ProductCategory', 'Technology', 'Application']],
  ['關係紀錄', ['SupplyRelationship', 'CustomerOpportunity', 'Collaboration', 'CompetitionAssessment']],
  ['來源', ['Evidence', 'Claim']],
  ['趨勢', ['Topic', 'Event', 'TopicMention']],
  ['產業鏈與資金', ['ValueChainStage', 'Capability', 'Facility', 'EndMarket', 'ETF']],
];
/** Fields every node may carry; listed once instead of on every type. */
const COMMON = ['name_en', 'aliases', 'evidence_ids', 'verification_status', 'lifecycle_status', 'valid_from', 'valid_to', 'notes'];
const HIDDEN = new Set([...COMMON, 'name_zh_missing', 'name_is_zh_usage', 'legacy_ids', 'observed_at', 'recorded_at', 'curation', 'needs_review', 'verification_legacy', 'split_from', 'publisher_method', 'date_method', 'link_checked_at', 'link_status', 'reverified_for_package', 'period_end', 'last_verified_at']);
const TYPE_ZH: Record<string, string> = { string: '文字', text: '文字', number: '數字', boolean: '是／否', date: '日期', url: '網址', enum: '選項', 'string[]': '文字清單', 'ref[]': '節點清單', object: '物件', any: '任意' };
const STORAGE_ZH: Record<string, string> = { asserted: '人工建立', asserted_or_derived: '人工或系統', derived_or_asserted: '人工或系統', derived_only: '系統算出', query_derived_only: '查詢時算出', suggested_only: 'AI 建議' };
const OP_ZH: Record<string, string> = { related_to: '相關', operates_in: '經營（嚴格）', provides: '提供', active_in: '實質參與', attention: '只被提及', direct: '直接', indirect: '間接', any: '任一', confirmed: '確定', potential: '潛在', in: '屬於' };
const SECTIONS: [string, string][] = [['nodes', '節點類型'], ['relations', '可用關係'], ['search', '搜尋結構'], ['method', '方法']];
const METHOD: [string, string[]][] = [
  ['資料怎麼進來', ['來源是官網、公告、年報與新聞；每個事實都附來源。', '公司先用名稱、別名、股票代號比對，同一家公司只建一筆。', '名稱一律用中文，英文與原文名稱另外保存。', '所有資料寫入前都檢查類型、方向、必填與來源，不合格就退回。']],
  ['可靠度怎麼標', ['每個事實標示：已驗證、有報導、推論、建議或有爭議。', '「可靠度」和「目前階段」分開：已公告的 MOU 可以是已驗證，但不代表有營收。', '互相矛盾的來源會保留並標示有爭議，不會自動覆蓋。']],
  ['哪些關係是算出來的', ['供應、合作、競爭都先記成一筆紀錄，再由紀錄推算出公司之間的關係。', '同產業或同技術只會產生「建議」，不會自動變成已確認的競爭或合作。', '建議要經人工接受，才會成為標示為「推論」的紀錄。']],
  ['搜尋怎麼保證一致', ['搜尋只走登記過的路徑；同樣的條件和資料一定得到同樣的結果。', '同一家公司只出現一次，並列出每條符合的路徑與來源。', '缺資料標示為「未知」，不當成「沒有」。']],
];

export default function Docs({ data, version }: { data: GraphData; version: string }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language === 'en';
  const reg = useRegistry();
  const [q, setQ] = useState('');
  const types = data.entityTypes, preds = data.edgeTypes;
  const count = useMemo(() => { const m = new Map<string, number>(); data.nodes.forEach(n => m.set(n.type, (m.get(n.type) ?? 0) + 1)); return m; }, [data.nodes]);
  const used = useMemo(() => { const m = new Map<string, number>(); data.edges.forEach(e => m.set(e.predicate, (m.get(e.predicate) ?? 0) + 1)); return m; }, [data.edges]);
  const tn = (k: string) => typeName(types, k);
  const s = q.trim().toLowerCase();
  const shown = preds.filter(p => !s || `${p.label} ${p.predicate} ${p.from.map(tn).join(' ')} ${p.to.map(tn).join(' ')}`.toLowerCase().includes(s));
  const groups = [...new Set(shown.map(p => p.group))];

  return (
    <div className="docs">
      <nav className="docs-toc" aria-label={t('目錄')}>
        {SECTIONS.map(([id, label]) => <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t(label)}</button>)}
      </nav>
      <article className="docs-body">
        <header>
          <p className="eyebrow">{t('資料說明 · 版本 {{v}}', { v: version })}</p>
          <h1>{t('資料結構')}</h1>
          <p className="fine">{t('{{a}} 種節點、{{b}} 種關係；目前有 {{c}} 個節點、{{d}} 條關係。', { a: types.filter(x => !x.abstract).length, b: preds.length, c: data.nodes.length, d: data.edges.length })}</p>
        </header>

        <section id="nodes">
          <h2>{t('節點類型')}</h2>
          <p className="fine">{t('每個節點都有：代號、類型、中文名稱、屬性。＊＝必填。所有類型都可以有：')}{COMMON.map(attrLabel).join('、')}。</p>
          <div className="doc-scroll"><table className="doc-table schema">
            <thead><tr><th>{t('類型')}</th><th>{t('屬性')}</th><th className="num">{t('筆數')}</th></tr></thead>
            {LAYERS.map(([layer, keys]) => (
              <tbody key={layer}>
                <tr className="layer"><td colSpan={3}>{t(layer)}</td></tr>
                {keys.map(k => types.find(x => x.name === k)).filter(Boolean).map(x => { const ps = x!.properties.filter(p => p.required || !HIDDEN.has(p.name)); return (
                  <tr key={x!.name} title={x!.definition}>
                    <td><i className="dot" style={{ background: colorOf(types, x!.name) }} /><b>{tn(x!.name)}</b>{!en && <span className="fine"> {x!.label_en}</span>}</td>
                    <td>{ps.length ? ps.map(p => <span key={p.name} className={`field ${p.required ? 'req' : ''}`} title={p.values ? p.values.map(valueLabel).join('、') : p.name}>{attrLabel(p.name)}{p.required ? '＊' : ''}<em>{t(TYPE_ZH[p.datatype] ?? p.datatype)}</em></span>) : <span className="fine">—</span>}</td>
                    <td className="num">{count.get(x!.name) ?? 0}</td>
                  </tr>); })}
              </tbody>))}
          </table></div>
        </section>

        <section id="relations">
          <h2>{t('可用關係')}</h2>
          <input className="doc-search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('搜尋關係，例如：賣、供應、公司')} aria-label={t('搜尋關係')} />
          <div className="doc-scroll"><table className="doc-table">
            <thead><tr><th>{t('關係')}</th><th>{t('從 → 到')}</th><th>{t('建立方式')}</th><th className="num">{t('筆數')}</th></tr></thead>
            {groups.map(g => (
              <tbody key={g}>
                <tr className="layer"><td colSpan={4}>{groupLabel(g)}</td></tr>
                {shown.filter(p => p.group === g).map(p => (
                  <tr key={p.predicate} title={p.meaning}>
                    <td><b>{relName(preds, p.predicate)}</b></td>
                    <td>{p.from.map(tn).join('／')} → {p.to.map(tn).join('／')}</td>
                    <td><span className={`tag ${p.storage.includes('derived') || p.storage === 'suggested_only' ? 'soft' : ''}`}>{t(STORAGE_ZH[p.storage] ?? p.storage)}</span></td>
                    <td className="num">{used.get(p.predicate) ?? 0}</td>
                  </tr>))}
              </tbody>))}
          </table></div>
          {!shown.length && <p className="fine">{t('沒有符合的關係。')}</p>}
        </section>
        <section id="search">
          <h2>{t('搜尋結構')}</h2>
          <p className="fine">{t('可以用這些條件找公司，並用「全部符合／任一符合／排除」組合。每個條件只走右邊登記的路徑。')}</p>
          {reg && <div className="doc-scroll"><table className="doc-table">
            <thead><tr><th>{t('條件')}</th><th>{t('比對方式')}</th><th>{t('走的路徑')}</th></tr></thead>
            <tbody>{Object.entries(reg.fields).map(([k, f]) => { const rules = [...new Set(Object.values(f.rules ?? {}).flat())]; return (
              <tr key={k}>
                <td><b>{t(f.label)}</b></td>
                <td>{f.operators.map(o => <span key={o} className="tag">{t(OP_ZH[o] ?? o)}</span>)}</td>
                <td className="paths">{rules.map(r => <div key={r}>{reg.paths[r]?.path ?? r}</div>)}</td>
              </tr>); })}</tbody></table></div>}
        </section>

        <section id="method">
          <h2>{t('方法')}</h2>
          <div className="doc-cards">{METHOD.map(([h, items]) => <div key={h} className="doc-card"><h3>{t(h)}</h3><ul>{items.map(x => <li key={x}>{t(x)}</li>)}</ul></div>)}</div>
        </section>
      </article>
    </div>);
}
