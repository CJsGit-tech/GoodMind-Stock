// ⚙ Advanced settings inside the research assistant: query conditions (GQC), reliability policy,
// graph display and language. Guided clicks in the assistant cover the common cases; this is for fine control.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityType, GraphNode } from '../../lib/types';
import { isA, VERIFICATION } from '../../lib/types';
import { LOCALES, setLocale } from '../i18n';
import { statusLabel, typeName } from '../lib/theme';
import { fetchQueryRegistry } from '../lib/api';
import type { SampleOptions } from '../../lib/sample';

export type SampleCfg = Omit<SampleOptions, 'seed'>;

export type QRow = { key: number; mode: 'all' | 'any' | 'not'; field: string; operator: string; values: string[] };
export type QPolicy = { verification: string[]; asOf: string; listed: boolean };
export type FieldDef = { label: string; operators: string[]; valueTypes: string[]; note: string; rules?: Record<string, string[]> };
export type Registry = { fields: Record<string, FieldDef>; paths: Record<string, { label: string; path: string }> };
export type Display = { labels: boolean; suggested: boolean; derived: boolean; filterPanel: boolean; threeD: boolean };

const MODE_ZH = { all: '全部符合', any: '任一符合', not: '排除' };
const OP_ZH: Record<string, string> = { related_to: '相關', operates_in: '經營（嚴格）', provides: '提供', active_in: '實質參與', attention: '只被提及', direct: '直接', indirect: '間接', any: '任一', confirmed: '確定', potential: '潛在', in: '屬於' };
let seq = 1000;
export const newRow = (field = 'technology', operator = 'related_to', values: string[] = [], mode: QRow['mode'] = 'all'): QRow => ({ key: seq++, mode, field, operator, values });

let regCache: Registry | null = null;
export function useRegistry() {
  const [reg, setReg] = useState<Registry | null>(regCache);
  useEffect(() => { if (!regCache) fetchQueryRegistry().then(r => { if (r.ok) { regCache = r.data; setReg(r.data); } }); }, []);
  return reg;
}

const SAMPLE_FIELDS: [keyof SampleCfg, string, number, number][] = [['industries', '產業數', 1, 6], ['perIndustry', '每個產業的公司數', 1, 10], ['depth', '公司關係深度', 0, 3], ['maxNodes', '最多顯示節點', 30, 100]];

export default function ChatSettings({ nodes, types, rows, setRows, policy, setPolicy, display, setDisplay, onApply, onClose, sample, setSample, onShuffle }: {
  sample: SampleCfg; setSample: (c: SampleCfg) => void; onShuffle: () => void;
  nodes: GraphNode[]; types: EntityType[]; rows: QRow[]; setRows: (r: QRow[]) => void; policy: QPolicy; setPolicy: (p: QPolicy) => void;
  display: Display; setDisplay: (d: Display) => void; onApply: () => void; onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const reg = useRegistry();
  const name = (id: string) => nodes.find(n => n.id === id)?.name ?? id;
  const set = (k: number, patch: Partial<QRow>) => setRows(rows.map(r => (r.key === k ? { ...r, ...patch } : r)));
  const optionsFor = (field: string) => nodes.filter(n => reg?.fields[field]?.valueTypes.some(x => isA(types, n.type, x))).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const toggle = (k: keyof Display) => setDisplay({ ...display, [k]: !display[k] });
  return (
    <div className="chat-settings" role="dialog" aria-label={t('進階設定')}>
      <header className="cs-head"><h3>{t('進階設定')}</h3><button className="ghost-btn sm" onClick={onClose} aria-label={t('關閉')}>✕</button></header>
      <div className="cs-body scroll">
        <section>
          <h4>{t('條件')}</h4>
          <p className="fine">{t('用條件找出符合的公司；結果會顯示在左側面板，圖譜只留下符合的公司。')}</p>
          {!reg && <p className="fine">{t('載入中…')}</p>}
          {reg && rows.map(r => { const def = reg.fields[r.field]; const opts = def.valueTypes.length ? optionsFor(r.field) : []; return (
            <div key={r.key} className="cs-row">
              <div className="cs-line">
                <select value={r.mode} onChange={e => set(r.key, { mode: e.target.value as QRow['mode'] })} aria-label={t('組合方式')}>{(['all', 'any', 'not'] as const).map(m => <option key={m} value={m}>{t(MODE_ZH[m])}</option>)}</select>
                <select value={r.field} onChange={e => set(r.key, { field: e.target.value, operator: reg.fields[e.target.value].operators[0], values: [] })} aria-label={t('條件類型')}>{Object.entries(reg.fields).map(([k, f]) => <option key={k} value={k}>{t(f.label)}</option>)}</select>
                {def.operators.length > 1 && <select value={r.operator} onChange={e => set(r.key, { operator: e.target.value })} aria-label={t('比對方式')}>{def.operators.map(o => <option key={o} value={o}>{t(OP_ZH[o] ?? o)}</option>)}</select>}
                <button className="link danger" onClick={() => setRows(rows.filter(x => x.key !== r.key))} aria-label={t('刪除條件')}>✕</button>
              </div>
              <div className="cs-line">
                {def.valueTypes.length
                  ? <select value="" onChange={e => e.target.value && set(r.key, { values: [...new Set([...r.values, e.target.value])] })} aria-label={t('加入值')}>
                      <option value="">{t('＋ 選擇{{what}}…', { what: def.valueTypes.map(x => typeName(types, x)).join('／') })}</option>
                      {opts.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
                  : <input placeholder={t('例：TW')} aria-label={t('輸入後按 Enter')} onKeyDown={e => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === 'Enter' && v) { set(r.key, { values: [...new Set([...r.values, v])] }); (e.target as HTMLInputElement).value = ''; } }} />}
              </div>
              {r.values.length > 0 && <div className="chips">{r.values.map(v => <span key={v} className="chip">{name(v)}<button aria-label={t('移除 {{name}}', { name: name(v) })} onClick={() => set(r.key, { values: r.values.filter(x => x !== v) })}>✕</button></span>)}</div>}
            </div>); })}
          <div className="cs-actions">
            <button className="ghost-btn sm" onClick={() => setRows([...rows, newRow()])}>{t('＋ 加條件')}</button>
            <button className="primary-btn sm" disabled={!rows.some(r => r.values.length)} onClick={onApply}>{t('找出公司')}</button>
          </div>
        </section>
        <section>
          <h4>{t('採用的資料可靠度')}</h4>
          <div className="cs-checks">{VERIFICATION.map(v => <label key={v}><input type="checkbox" checked={policy.verification.includes(v)} onChange={() => setPolicy({ ...policy, verification: policy.verification.includes(v) ? policy.verification.filter(x => x !== v) : [...policy.verification, v] })} />{statusLabel(v)}</label>)}</div>
          <div className="cs-checks">
            <label><input type="checkbox" checked={policy.listed} onChange={() => setPolicy({ ...policy, listed: !policy.listed })} />{t('只限上市櫃公司')}</label>
            <label className="cs-date">{t('基準日')} <input type="date" value={policy.asOf} onChange={e => setPolicy({ ...policy, asOf: e.target.value })} /></label>
          </div>
        </section>
        <section>
          <h4>{t('開場取樣')}</h4>
          <p className="fine">{t('開場隨機挑產業，再依關係多寡挑公司，沿著公司之間的競爭、供應、合作、持股關係往外延伸。產品和市場區隔只列出被挑中的公司。')}</p>
          <div className="cs-nums">{SAMPLE_FIELDS.map(([k, label, min, max]) => (
            <label key={k}><span>{t(label)}</span>
              <input type="number" min={min} max={max} value={sample[k]} onChange={e => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) setSample({ ...sample, [k]: Math.max(min, Math.min(max, v)) }); }} /></label>))}</div>
          <div className="cs-actions"><button className="ghost-btn sm" onClick={onShuffle}>{t('換一組')}</button></div>
        </section>
        <section>
          <h4>{t('圖譜顯示')}</h4>
          <div className="seg graph-mode" role="group" aria-label={t('圖譜檢視')}>{[false, true].map(v => <button key={String(v)} className={display.threeD === v ? 'on' : ''} aria-pressed={display.threeD === v} onClick={() => setDisplay({ ...display, threeD: v })}>{v ? '3D' : '2D'}</button>)}</div>
          <div className="cs-checks col">
            <label><input type="checkbox" checked={display.labels} onChange={() => toggle('labels')} />{t('節點名稱')}</label>
            <label><input type="checkbox" checked={display.suggested} onChange={() => toggle('suggested')} />{t('AI 建議的關係')}</label>
            <label><input type="checkbox" checked={display.derived} onChange={() => toggle('derived')} />{t('系統算出的關係')}</label>
            <label><input type="checkbox" checked={display.filterPanel} onChange={() => toggle('filterPanel')} />{t('進階篩選面板')}</label>
          </div>
        </section>
        {LOCALES.length > 1 && <section>
          <h4>{t('語言')}</h4>
          <div className="seg">{LOCALES.map(l => <button key={l.code} className={i18n.language === l.code ? 'on' : ''} onClick={() => setLocale(l.code)}>{l.label}</button>)}</div>
        </section>}
      </div>
    </div>);
}
