// Admin workspace (/workspace). Sign-in required: creating relations, reviewing suggested links and data quality.
// The public data guide lives at /docs; nothing here is linked from the public navigation.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopBar from '../components/TopBar';
import WritePanel from '../components/WritePanel';
import { SuggestionCard } from '../components/Dossier';
import { decideSuggestion, fetchQuality, ontology, useAdmin, useGraph } from '../lib/api';
import type { QualityReport } from '../lib/api';
import { withDerived } from '../core/derive';
import { computeSuggestions } from '../core/suggest';
import type { Decision } from '../core/suggest';
import type { Graph } from '../core/types';

function SignIn({ configured, needsUsername, onLogin }: { configured: boolean; needsUsername: boolean; onLogin: (username: string, password: string) => Promise<string | null> }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="glass card signin" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const err = await onLogin(username, password); setBusy(false); if (err) { setError(err); setPassword(''); } }}>
      <p className="eyebrow">{t('管理工作區')}</p>
      <h1>{t('管理員登入')}</h1>
      <p className="fine">{t('這個區域用來維護資料，需要管理員登入。')}</p>
      {!configured && <p className="curation-note" role="alert">{t('伺服器尚未設定管理員帳號密碼，目前無法登入。')}</p>}
      {needsUsername && <label className="pick"><span className="fine">{t('帳號')}</span>
        <input type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={!configured || busy} autoFocus required /></label>}
      <label className="pick"><span className="fine">{t('密碼')}</span>
        <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={!configured || busy} autoFocus={!needsUsername} required /></label>
      {error && <p className="sugg-err" role="alert">{error}</p>}
      <button className="primary-btn" disabled={!configured || busy || !password}>{t('登入')}</button>
    </form>);
}

export default function Workspace() {
  const { t } = useTranslation();
  const auth = useAdmin();
  const { data, reload } = useGraph();
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [kind, setKind] = useState<'competition' | 'supply'>('competition');
  const [minS, setMinS] = useState(0.5);
  const [error, setError] = useState('');
  useEffect(() => { if (auth.admin) fetchQuality().then(setQuality).catch(() => setQuality(null)); }, [data, auth.admin]);
  const full = useMemo(() => (data ? withDerived({ ...data, suggestionDecisions: data.meta.suggestionDecisions } as Graph) : null), [data]);
  const sugg = useMemo(() => (full ? computeSuggestions(full) : []), [full]);
  if (!auth.ready || !data || !full) return <div className="fullscreen-msg"><div className="orb" /><p>{t('載入中…')}</p></div>;

  if (!auth.admin) return <div className="page-ws"><TopBar /><main className="ws ws-signin"><SignIn configured={!!auth.configured} needsUsername={!!auth.needsUsername} onLogin={auth.login} /></main></div>;

  const decisions = (data.meta.suggestionDecisions as Decision[] | undefined) ?? [];
  const list = sugg.filter(s => s.kind === kind && s.strength >= minS);
  const by = new Map(full.nodes.map(n => [n.id, n]));
  return (
    <div className="page-ws">
      <TopBar />
      <main className="ws">
        <section className="hero admin-hero">
          <div><p className="eyebrow">{t('管理工作區')}</p><h1>{t('維護資料')}</h1>
            <p className="lead">{t('新增關係、審核系統建議、檢查資料品質。')}</p></div>
          <button className="ghost-btn" onClick={auth.logout}>{t('登出')}</button>
        </section>
        {error && <ul className="glass errors" role="alert"><li>{error}</li></ul>}

        <WritePanel data={data} onSaved={reload} />

        <section className="glass card">
          <header className="ph"><div><p className="eyebrow">{t('系統建議的關係')}</p><h2>{t('待審核的建議')}</h2></div>
            <span className="fine">{t('已接受 {{a}} · 已拒絕 {{r}}', { a: decisions.filter(d => d.decision === 'accepted').length, r: decisions.filter(d => d.decision === 'rejected').length })}</span></header>
          <p className="fine">{t('建議由共同分組推算，不是事實。接受會建立一筆標記為「推論」的紀錄；拒絕後不再出現。')}</p>
          <div className="review-bar">
            <div className="seg">{(['competition', 'supply'] as const).map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'competition' ? t('可能競爭') : t('可能供應')} ({sugg.filter(s => s.kind === k && s.strength >= minS).length})</button>)}</div>
            <div className="seg">{([[0.7, '強'], [0.5, '中'], [0, '全部']] as const).map(([v, l]) => <button key={l} className={minS === v ? 'on' : ''} onClick={() => setMinS(v)}>{t(l)}</button>)}</div>
          </div>
          <ul className="rels suggs review">{list.slice(0, 40).map(s => (
            <SuggestionCard key={s.id} s={s} by={by} onSelect={() => {}}
              onDecide={async (id, d) => { const r = await decideSuggestion(id, d); if (!r.ok) return r.error; await reload(); }} />))}</ul>
          {list.length > 40 && <p className="fine">{t('只顯示最強的 40 筆。')}</p>}
        </section>

        {quality && <section className="glass card">
          <header className="ph"><div><p className="eyebrow">{t('資料品質')}</p><h2>{t('資料是否符合規則')}</h2></div>
            <span className={`status on ${quality.errors ? 'bad' : quality.warnings ? 'warn' : 'good'}`}>{t('{{e}} 個錯誤 · {{w}} 個待補', { e: quality.errors, w: quality.warnings })}</span></header>
          <table className="quality"><tbody>{quality.byRule.map(r => (
            <tr key={r.rule}><td><span className={`status on ${r.level === 'error' ? 'bad' : 'warn'}`}>{r.level === 'error' ? t('錯誤') : t('待補')}</span></td><td className="meaning">{r.description}</td><td className="num">{r.count}</td></tr>))}</tbody></table>
          {quality.issues.length > 0 && <details className="issues"><summary>{t('顯示前 {{n}} 筆', { n: Math.min(40, quality.issues.length) })}</summary>
            <ul>{quality.issues.slice(0, 40).map((i, k) => <li key={k}><code>{i.id}</code> {i.message}</li>)}</ul></details>}
        </section>}

        <p className="center"><button className="ghost-btn" onClick={async () => { if (!confirm(t('要把規則和資料都還原成初始版本嗎？'))) return; const r = await ontology({ action: 'reset' }); if (!r.ok) setError(r.errors.join('；')); else { setError(''); await reload(); } }}>{t('還原成初始版本')}</button></p>
      </main>
    </div>
  );
}
