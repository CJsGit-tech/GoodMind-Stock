import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../core/types';
import { STATUSES, toggle } from '../lib/filters';
import type { FilterState } from '../lib/filters';
import type { GroupTree } from '../core/groups';
import { useTranslation } from 'react-i18next';
import { colorOf, groupLabel, LINK_TONES, relName, statusLabel, statusTone, typeName } from '../lib/theme';

export default function FilterPanel({ f, set, types, preds, nodes, edges, focusName, onReset, locked, onUnlock, showDerived, setShowDerived,
  tree, groupName, showSuggested, setShowSuggested, minStrength, setMinStrength, suggestionCount, suggestionTotal }: {
  f: FilterState; set: (f: FilterState) => void; types: EntityType[]; preds: EdgeType[]; nodes: GraphNode[]; edges: GraphEdge[];
  focusName?: string; onReset: () => void; locked: boolean; onUnlock: () => void; showDerived: boolean; setShowDerived: (v: boolean) => void;
  tree: GroupTree; groupName?: string; showSuggested: boolean; setShowSuggested: (v: boolean) => void;
  minStrength: number; setMinStrength: (v: number) => void; suggestionCount: number; suggestionTotal: number;
}) {
  const { t } = useTranslation();
  const nCount = (t: string) => nodes.filter(n => n.type === t).length;
  const eCount = (p: string) => edges.filter(e => e.predicate === p).length;
  const groups = [...new Set(preds.map(p => p.group))];
  return (
    <aside className="glass panel-left" aria-label={t('進階篩選')}>
      <header className="ph"><div><p className="eyebrow">{t('進階篩選')}</p><h2>{t('篩選圖譜')}</h2></div><button className="ghost-btn sm" onClick={onReset}>{t('重設')}</button></header>
      {locked && <div className="notice">{t('目前只顯示回答用到的資料。')} <button className="link" onClick={onUnlock}>{t('回到篩選')}</button></div>}
      <fieldset disabled={locked} className="scroll">
        <label className="search"><span>⌕</span><input value={f.q} onChange={e => set({ ...f, q: e.target.value })} placeholder={t('中文名、英文名、別名或代號')} /></label>
        {f.focusId && (
          <div className="focus-chip"><span>{t('聚焦：')}<b>{focusName}</b></span>
            <div className="seg">{([1, 2] as const).map(d => <button key={d} className={f.depth === d ? 'on' : ''} onClick={() => set({ ...f, depth: d })}>{t('{{n}} 層', { n: d })}</button>)}</div>
            <button className="link" aria-label={t('取消聚焦')} onClick={() => set({ ...f, focusId: null })}>✕</button></div>)}

        <section>
          <h3>{t('產業分組')} <span className="sub">{t('產業 › 區隔 › 類別')}</span></h3>
          {f.groupId && <div className="focus-chip group-chip"><span>{t('範圍：')}<b>{groupName}</b></span><button className="link" aria-label={t('取消範圍')} onClick={() => set({ ...f, groupId: null })}>✕</button></div>}
          <select className="path-select" value={f.groupId ?? ''} onChange={e => set({ ...f, groupId: e.target.value || null, focusId: null })} aria-label={t('選擇分組')}>
            <option value="">{t('全部（不分組）')}</option>
            {tree.map(({ industry, segments }) => (
              <optgroup key={industry.id} label={industry.name}>
                <option value={industry.id}>{t('{{name}}（全部）', { name: industry.name })}</option>
                {segments.map(({ segment, categories, companies }) => [
                  <option key={segment.id} value={segment.id}>　{segment.name} ({companies})</option>,
                  ...categories.map(c => <option key={c.id} value={c.id}>　　› {c.name}</option>)])}
              </optgroup>))}
          </select>
        </section>

        <section className="suggest-box">
          <label className="row switch"><input type="checkbox" checked={showSuggested} onChange={() => setShowSuggested(!showSuggested)} />
            <span><b>{t('AI 建議的關係')}</b> · {t('虛線，由共同分組推算（顯示 {{n}} / {{m}}）', { n: suggestionCount, m: suggestionTotal })}</span></label>
          <div className="seg strength" role="group" aria-label={t('建議強度下限')}>
            {([[0.7, '強'], [0.5, '中'], [0, '全部']] as const).map(([v, label]) => (
              <button key={label} className={minStrength === v ? 'on' : ''} disabled={!showSuggested} onClick={() => setMinStrength(v)}>{t(label)}{v ? ` ≥${Math.round(v * 100)}%` : ''}</button>))}
          </div>
          <p className="fine">{t('點虛線或公司，可以接受（建立紀錄）或拒絕建議。')}</p>
        </section>

        <section>
          <h3>{t('節點類型')}<span className="mini"><button className="link" onClick={() => set({ ...f, types: new Set(types.map(x => x.name)) })}>{t('全選')}</button><button className="link" onClick={() => set({ ...f, types: new Set() })}>{t('全不選')}</button></span></h3>
          <div className="type-grid">
            {types.filter(x => !x.abstract).map(x => {
              const on = f.types.has(x.name), c = nCount(x.name);
              return (
                <button key={x.name} title={x.definition} className={`type-pill ${on ? 'on' : ''} ${c ? '' : 'zero'}`} style={{ ['--c' as string]: colorOf(types, x.name) }} onClick={() => set({ ...f, types: toggle(f.types, x.name) })}>
                  <i /><span>{typeName(types, x.name)}</span><em>{c}</em></button>);
            })}
          </div>
        </section>

        <section>
          <h3>{t('關係類型')}<span className="mini"><button className="link" onClick={() => set({ ...f, preds: new Set(preds.map(p => p.predicate)) })}>{t('全選')}</button><button className="link" onClick={() => set({ ...f, preds: new Set() })}>{t('全不選')}</button></span></h3>
          {groups.map(g => {
            const ps = preds.filter(p => p.group === g), used = ps.filter(p => eCount(p.predicate) > 0);
            return (
              <details key={g} open={used.length > 0} className="rel-group">
                <summary><span>{groupLabel(g)}</span><em>{used.reduce((s, p) => s + eCount(p.predicate), 0)}</em></summary>
                {ps.map(p => (
                  <label key={p.predicate} className={`row ${eCount(p.predicate) ? '' : 'zero'}`} title={`${p.predicate}: ${p.from.join('/')} → ${p.to.join('/')} — ${p.meaning}`}>
                    <input type="checkbox" checked={f.preds.has(p.predicate)} onChange={() => set({ ...f, preds: toggle(f.preds, p.predicate) })} />
                    <span>{relName(preds, p.predicate)}</span><em>{eCount(p.predicate)}</em></label>))}
              </details>);
          })}
        </section>

        <label className="row switch derived-switch"><input type="checkbox" checked={showDerived} onChange={() => setShowDerived(!showDerived)} />
          <span><b>{t('系統算出的關係')}</b> · {t('由競爭、供應、合作紀錄推算（{{n}} 條）', { n: edges.filter(e => e.derived === true).length })}</span></label>

        <section>
          <h3>{t('資料可靠度')}</h3>
          <div className="status-wrap">{STATUSES.map(s => (
            <button key={s} className={`status ${statusTone(s)} ${f.statuses.has(s) ? 'on' : ''}`} onClick={() => set({ ...f, statuses: toggle(f.statuses, s) })}>{statusLabel(s)}</button>))}</div>
        </section>
        <div className="tone-legend" aria-label={t('線條顏色說明')}>{Object.entries(LINK_TONES).map(([k, tone]) => <span key={k}><i style={{ background: `rgb(${tone.color})` }} />{t(tone.label)}</span>)}</div>
        <label className="row switch"><input type="checkbox" checked={f.hideIsolated} onChange={() => set({ ...f, hideIsolated: !f.hideIsolated })} /><span>{t('隱藏沒有關係的節點')}</span></label>
      </fieldset>
    </aside>
  );
}
