// Research assistant (left panel). Progressive disclosure: three icon tiles open one panel at a time; drilling in
// replaces the panel with a single step (breadcrumb, a title with a few numbers, then visual choices).
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type GuideAction = { t: 'start' | 'industries' | 'reset' | 'more' | 'q-fields' | 'shuffle' } | { t: 'group' | 'companies' | 'company'; id: string } | { t: 'lens'; k: 'competition' | 'supply' | 'collaboration' | 'all' }
  | { t: 'q-pick'; field: string } | { t: 'q-add'; field: string; id: string } | { t: 'q-clear' };
/** kind decides how an option is drawn: bar = row with a count bar, company = compact tile, chip = small pill,
 *  lens = relation toggle, nav = quiet link; default = plain row. */
export type GuideOption = { label: string; action?: GuideAction; hint?: string; short?: string; kind?: 'bar' | 'company' | 'chip' | 'lens' | 'nav' | 'row'; count?: number; section?: string };
export type GuideReply = { title?: string; stats?: string[]; text: string; options: GuideOption[] };
type Crumb = { label: string; action: GuideAction };
/** A step pushed in from outside (⚙ query results, an industry pill). `home` returns to the start instead. */
export type Injected = { id: number; user?: string; reply: GuideReply; home?: boolean; crumb?: Crumb };
type Tile = 'industries' | 'query' | 'lens';

const Icon = ({ k }: { k: Tile }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {k === 'industries' && <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>}
    {k === 'query' && <><path d="M4 6h16M7 12h10M10 18h4" /></>}
    {k === 'lens' && <><circle cx="6" cy="7" r="2.3" /><circle cx="18" cy="7" r="2.3" /><circle cx="12" cy="18" r="2.3" /><path d="M8.2 7.6h7.6M7.2 9l3.6 7M16.8 9l-3.6 7" /></>}
  </svg>);

export default function ResearchConsole({ guide, chips, settings, settingsOpen, onGear, inject, onRestart, lens }: {
  onRestart: () => void; lens: string | null; guide: (a: GuideAction) => GuideReply | Promise<GuideReply>;
  chips: ReactNode; settings: ReactNode; settingsOpen: boolean; onGear: () => void; inject: Injected | null;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [step, setStep] = useState<GuideReply | null>(null);
  const [tile, setTile] = useState<Tile | null>('industries');
  const [panel, setPanel] = useState<GuideReply | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());   // sections opened past their first few items
  useEffect(() => setExpanded(new Set()), [step, tile]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: 0 }); }, [step]);
  useEffect(() => {
    if (!inject) return;
    if (inject.home) { setStep(null); setTrail([]); return; }
    setStep(inject.reply); setTrail(inject.crumb ? [inject.crumb] : inject.user ? [{ label: inject.user, action: { t: 'more' } }] : []);
  }, [inject]);
  // The open tile's content (industries with counts, query fields) comes from the same guide as every step.
  useEffect(() => {
    if (tile === 'industries' || tile === 'query') Promise.resolve(guide({ t: tile === 'industries' ? 'industries' : 'q-fields' })).then(setPanel);
    else setPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile, t]);

  async function go(action: GuideAction, nextTrail: Crumb[]) {
    setBusy(true);
    try { const r = await guide(action); setStep(r); setTrail(nextTrail); }
    catch { setStep({ title: t('查詢失敗'), text: t('請再試一次。'), options: [] }); }
    finally { setBusy(false); }
  }
  function home() { setStep(null); setTrail([]); onRestart(); }
  async function choose(o: GuideOption) {
    if (busy) return;
    const a = o.action; if (!a) return;
    if (a.t === 'reset') return home();
    if (a.t === 'lens') { await guide(a); return; }                                 // a toggle: the step stays
    if (a.t === 'shuffle' || a.t === 'q-clear') { await guide(a); setStep(null); setTrail([]); return; }
    const at = trail.findIndex(c => JSON.stringify(c.action) === JSON.stringify(a));
    await go(a, at >= 0 ? trail.slice(0, at + 1) : [...trail, { label: o.label, action: a }]);
  }

  /** Draws options grouped by section, each kind in its own visual form. */
  function Options({ options }: { options: GuideOption[] }) {
    const body = options.filter(o => o.kind !== 'nav' && o.kind !== 'lens');
    const sections: { name: string; items: GuideOption[] }[] = [];
    for (const o of body) { const name = o.section ?? ''; const s = sections.find(x => x.name === name); if (s) s.items.push(o); else sections.push({ name, items: [o] }); }
    return <>{sections.map(sec => {
      const kind = sec.items[0].kind ?? 'row', max = Math.max(1, ...sec.items.map(o => o.count ?? 0));
      const limit = kind === 'company' ? 8 : kind === 'chip' ? 14 : 6, all = sec.items, open = expanded.has(sec.name) || all.length <= limit + 2;
      sec = { ...sec, items: open ? all : all.slice(0, limit) };
      return (
        <div key={sec.name} className="opt-sec">
          {sec.name && <h4 className="opt-h">{sec.name}<span>{all.length}</span></h4>}
          {kind === 'bar' && <div className="bars">{sec.items.map(o => (
            <button key={o.label} disabled={busy} onClick={() => choose(o)} title={o.label}>
              <span className="bar-name">{o.label}</span><span className="bar-track"><i style={{ width: `${Math.max(6, ((o.count ?? 0) / max) * 100)}%` }} /></span><span className="bar-n">{o.count}</span></button>))}</div>}
          {kind === 'company' && <div className="tiles-co">{sec.items.map(o => <button key={o.label} disabled={busy} onClick={() => choose(o)} title={o.label}><i />{o.label}</button>)}</div>}
          {kind === 'chip' && <div className="chip-cloud">{sec.items.map(o => <button key={o.label} disabled={busy} onClick={() => choose(o)}>{o.label}</button>)}</div>}
          {!open && <button className="more-btn" onClick={() => setExpanded(e => new Set([...e, sec.name]))}>{t('顯示全部 {{n}}', { n: all.length })}</button>}
          {kind === 'row' && <div className="menu step-menu">{sec.items.map(o => (
            <button key={o.label} disabled={busy} onClick={() => choose(o)}><span><b>{o.label}</b>{o.hint && <small>{o.hint}</small>}</span><i aria-hidden>›</i></button>))}</div>}
        </div>);
    })}</>;
  }
  const LensBar = ({ options }: { options: GuideOption[] }) => options.length ? (
    <div className="lens-bar" role="group" aria-label={t('只看一種關係')}>
      {options.map(o => { const k = o.action && 'k' in o.action ? o.action.k : ''; return (
        <button key={o.label} className={`lens-${k} ${lens === k ? 'on' : ''}`} aria-pressed={lens === k} title={o.hint} onClick={() => choose(o)}><i />{o.short ?? o.label}</button>); })}
    </div>) : null;

  const TILES: [Tile, string][] = [['industries', t('產業')], ['query', t('條件')], ['lens', t('關係')]];
  const lensOpts = [{ label: t('競爭'), short: t('競爭'), hint: t('誰跟誰競爭'), kind: 'lens', action: { t: 'lens', k: 'competition' } }, { label: t('供應'), short: t('供應'), hint: t('誰供應給誰'), kind: 'lens', action: { t: 'lens', k: 'supply' } }, { label: t('合作'), short: t('合作'), hint: t('誰和誰合作'), kind: 'lens', action: { t: 'lens', k: 'collaboration' } }] as GuideOption[];

  return (
    <section className="glass panel-right console2" aria-label={t('研究助理')}>
      <header className="ph"><h2>{t('探索圖譜')}</h2>
        <div className="ph-acts">
          {step && <button className="icon-btn" disabled={busy} onClick={home} aria-label={t('重新開始')} title={t('重新開始')}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-4.9 6H5.07A7 7 0 1 0 12 5Z"/></svg></button>}
          <button className={`icon-btn ${settingsOpen ? 'on' : ''}`} onClick={onGear} aria-expanded={settingsOpen} aria-label={t('進階設定')} title={t('進階設定')}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg></button>
        </div></header>
      {chips}
      {settingsOpen && settings}
      <div ref={box} className="msgs scroll" aria-live="polite" hidden={settingsOpen}>
        {!step && <>
          <div className="tiles" role="tablist">{TILES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tile === k} className={tile === k ? 'on' : ''} onClick={() => setTile(tile === k ? null : k)}><Icon k={k} /><span>{label}</span></button>))}</div>
          {tile === 'lens' && <div className="tile-panel"><LensBar options={lensOpts} /><p className="fine">{t('只留下一種關係，再點一次取消。')}</p></div>}
          {tile !== 'lens' && tile && panel && <div className="tile-panel"><Options options={panel.options} /></div>}
        </>}
        {step && (
          <div className="step">
            <nav className="crumbs" aria-label={t('瀏覽路徑')}>
              <button onClick={home} disabled={busy}>‹ {t('開場')}</button>
              {(step.title ? trail.slice(0, -1) : trail).map((c, i, list) => <Fragment key={i}><span aria-hidden>/</span>
                {(!step.title && i === list.length - 1) || c.action.t === 'q-add' ? <b>{c.label}</b> : <button disabled={busy} onClick={() => go(c.action, trail.slice(0, i + 1))}>{c.label}</button>}</Fragment>)}
            </nav>
            {step.title && <div className="ctx"><h3>{step.title}</h3>{!!step.stats?.length && <div className="stats">{step.stats.map(s => <span key={s}>{s}</span>)}</div>}</div>}
            {busy ? <div className="scanning"><span /><span /><span /></div> : <>
              {step.text && <p className="step-note">{step.text}</p>}
              <LensBar options={step.options.filter(o => o.kind === 'lens')} />
              <Options options={step.options} />
              {step.options.some(o => o.kind === 'nav' && o.action?.t !== 'reset') && <div className="step-nav">{step.options.filter(o => o.kind === 'nav' && o.action?.t !== 'reset').map(o => <button key={o.label} className="link" onClick={() => choose(o)}>{o.label}</button>)}</div>}
            </>}
          </div>)}
      </div>
    </section>
  );
}
