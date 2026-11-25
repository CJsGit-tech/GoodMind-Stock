// Manual relation creation through the single write entry (/api/write):
// 1 pick two nodes → 2 only the legal relations are listed → 3 the server checks every rule → 4 saved, or refused with reasons.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphData } from '../lib/api';
import { writeFacts } from '../lib/api';
import { isAny, VERIFICATION, WRITABLE_STORAGE } from '../../lib/types';
import type { GraphNode } from '../../lib/types';
import { searchText } from '../lib/filters';
import { relName, statusLabel, typeName as typeLabel } from '../lib/theme';

function NodePick({ label, nodes, value, onChange, types }: { label: string; nodes: GraphNode[]; value: string; onChange: (id: string) => void; types: GraphData['entityTypes'] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const s = q.normalize('NFKC').toLowerCase().trim();
  const hits = s ? nodes.filter(n => searchText(n).normalize('NFKC').toLowerCase().includes(s)).slice(0, 30) : [];
  const cur = nodes.find(n => n.id === value);
  return (
    <div className="pick">
      <span className="fine">{label}</span>
      {cur ? <div className="focus-chip"><span><b>{cur.name}</b> · {typeLabel(types, cur.type)}</span><button type="button" className="link" onClick={() => onChange('')}>✕</button></div>
        : <><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('搜尋中文名、英文名、別名或代號')} />
          {hits.length > 0 && <ul className="pick-list">{hits.map(n => <li key={n.id}><button type="button" className="link" onClick={() => { onChange(n.id); setQ(''); }}>{n.name}</button> <span className="fine">{typeLabel(types, n.type)}</span></li>)}</ul>}</>}
    </div>);
}

export default function WritePanel({ data, onSaved }: { data: GraphData; onSaved: () => void }) {
  const { t } = useTranslation();
  const [a, setA] = useState(''), [b, setB] = useState(''), [rel, setRel] = useState('');
  const [status, setStatus] = useState('reported'), [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const pickable = useMemo(() => data.nodes.filter(n => n.type !== 'Evidence'), [data.nodes]);
  const evidenceNodes = useMemo(() => data.nodes.filter(n => n.type === 'Evidence'), [data.nodes]);
  const na = data.nodes.find(n => n.id === a), nb = data.nodes.find(n => n.id === b);
  // Step 2: only relations whose endpoint types fit (either direction); computed / AI-suggested ones are shown but locked.
  const options = useMemo(() => {
    if (!na || !nb) return [];
    return data.edgeTypes.flatMap(p => [
      isAny(data.entityTypes, na.type, p.from) && isAny(data.entityTypes, nb.type, p.to) ? [{ p, from: na, to: nb }] : [],
      isAny(data.entityTypes, nb.type, p.from) && isAny(data.entityTypes, na.type, p.to) && na.id !== nb.id ? [{ p, from: nb, to: na }] : [],
    ].flat());
  }, [na, nb, data.edgeTypes, data.entityTypes]);
  const chosen = options.find(o => `${o.p.predicate}|${o.from.id}` === rel);

  async function submit(dryRun: boolean) {
    if (!chosen) return;
    setBusy(true); setMsg(null);
    const attributes: Record<string, unknown> = { verification_status: status };
    if (evidence) attributes.evidence_ids = [evidence];
    const r = await writeFacts([{ op: 'createEdge', edge: { predicate: chosen.p.predicate, from: chosen.from.id, to: chosen.to.id, attributes } }], dryRun);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, lines: r.errors });
    setMsg({ ok: true, lines: [dryRun ? t('檢查通過，可以存檔。') : t('已存檔：{{a}}「{{rel}}」{{b}}', { a: chosen.from.name, rel: relName(data.edgeTypes, chosen.p.predicate), b: chosen.to.name })] });
    if (!dryRun) { setRel(''); onSaved(); }
  }

  return (
    <section className="glass card write-panel">
      <header className="ph"><div><p className="eyebrow">{t('新增資料')}</p><h2>{t('建立關係')}</h2></div></header>
      <p className="fine">{t('選兩個節點，系統只列出它們之間允許的關係；存檔前會檢查所有規則，不合格會說明原因。')}</p>
      <div className="write-grid">
        <NodePick label={t('節點 A')} nodes={pickable} value={a} onChange={id => { setA(id); setRel(''); setMsg(null); }} types={data.entityTypes} />
        <NodePick label={t('節點 B')} nodes={pickable} value={b} onChange={id => { setB(id); setRel(''); setMsg(null); }} types={data.entityTypes} />
      </div>
      {na && nb && <>
        <h3>{t('可以建立的關係')} <span className="sub">{options.length}</span></h3>
        {!options.length && <p className="fine">{t('這兩種節點之間沒有允許的關係。')}</p>}
        <div className="rel-options">{options.map(o => { const k = `${o.p.predicate}|${o.from.id}`, locked = !WRITABLE_STORAGE.has(o.p.storage); return (
          <label key={k} className={`row ${locked ? 'zero' : ''}`} title={locked ? t('系統算出或 AI 建議的關係不能手動建立') : o.p.meaning}>
            <input type="radio" name="rel" disabled={locked} checked={rel === k} onChange={() => { setRel(k); setMsg(null); }} />
            <span>{o.from.name} <b>{relName(data.edgeTypes, o.p.predicate)}</b> {o.to.name}</span>{locked ? <span className="tag">{o.p.storage === 'suggested_only' ? t('AI 建議') : t('系統算出')}</span> : o.p.evidenceRequired ? <span className="tag">{t('需要來源')}</span> : null}</label>); })}</div>
        {chosen && <div className="write-grid">
          <label className="pick"><span className="fine">{t('可靠度')}</span><select value={status} onChange={e => setStatus(e.target.value)}>{VERIFICATION.map(v => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label>
          <label className="pick"><span className="fine">{t('來源')}</span><select value={evidence} onChange={e => setEvidence(e.target.value)}><option value="">{t('（不附來源）')}</option>{evidenceNodes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        </div>}
        {chosen && <div className="sugg-acts"><button className="ghost-btn sm" disabled={busy} onClick={() => submit(true)}>{t('先檢查')}</button><button className="primary-btn sm" disabled={busy} onClick={() => submit(false)}>{t('存檔')}</button></div>}
      </>}
      {msg && <ul className={msg.ok ? 'write-ok' : 'glass errors'} role="status">{msg.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </section>);
}
