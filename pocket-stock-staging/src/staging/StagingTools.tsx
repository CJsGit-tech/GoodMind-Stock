// LOCAL STAGING ONLY — never part of the production site.
// App.tsx loads this file only in the dev server (import.meta.env.DEV), so a production build does not contain it,
// and the /__local/simulate endpoint it calls exists only in local/server.ts.
//
// It stands in for things that belong to AppDeploy or to an outside caller: switching test accounts,
// the agent calling with its secret key (the key stays on the local server), another publication changing
// the graph, and a publish that fails. It stays collapsed in a corner so the site looks as it will in production.
import React, { useEffect, useRef, useState } from 'react';
import { post, useStore } from '../store';
import './staging.css';

interface Action { id: string; label: string; hint: string; say: (r: any) => string; extra?: Record<string, unknown> }
const AGENT: Action[] = [
  { id: 'agent-upload', label: 'Upload a draft', hint: 'Sends a sample package. It stays private until the owner approves it.', say: r => `Agent uploaded draft #${r.number}. Open Owner to review it.` },
  { id: 'agent-retry', label: 'Upload twice', hint: 'Sends one package two times. Only one draft may be created.', say: r => `Same package sent twice: draft #${r.first.number}, second call duplicate = ${r.second.duplicate}.` },
  { id: 'agent-lookup', label: 'Look up names', hint: 'Checks four names against the live graph.', say: r => r.results.map((x: any) => `${x.name}: ${x.match === 'none' ? (x.close.length ? 'close to ' + x.close[0].name : 'not found') : x.match + ' → ' + x.node.name}`).join(' · ') },
  { id: 'agent-publish', label: 'Try to publish', hint: 'Calls owner routes with the agent key. Both must be refused.', say: r => `Agent key on owner routes: list drafts → ${r.listDrafts}, approve → ${r.approve}.` },
];
const SIMULATE: Action[] = [
  { id: 'conflict', label: 'Same-name node appears', hint: 'Another publication adds 外資買超 after the agent’s lookup, so approval must ask again.', say: r => (r.added ? `「${r.name}」 was published by another draft.` : `「${r.name}」 already exists.`) },
  { id: 'fail-next-publish', label: 'Next publish fails', hint: 'The next Approve & publish fails once.', say: () => 'The next Approve & publish will fail once.' },
];

export default function StagingTools() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); pill.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && e.target !== pill.current) setOpen(false); };
    window.addEventListener('keydown', key); window.addEventListener('mousedown', away);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', away); };
  }, [open]);
  const run = async (action: string, say: (r: any) => string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { const r = await post<any>('/__local/simulate', { action, ...extra }); setNote(say(r)); await s.refreshSession(); s.reloadGraph(); }
    catch (e: any) { setNote(`${action} did not work: ${e.message}`); }
    finally { setBusy(false); }
  };
  const row = (a: Action) => <li key={a.id}><button type="button" className="stg-row" disabled={busy} onClick={() => run(a.id, a.say, a.extra)}><b>{a.label}</b><small>{a.hint}</small></button></li>;
  return (
    <div className="stg">
      {open ? (
        <div className="stg-panel" id="stg-panel" ref={panel} role="dialog" aria-label="Local staging tools">
          <header className="stg-head"><div><b>Local staging tools</b><small>For testing on this computer. Not part of the site.</small></div><button type="button" className="stg-x" aria-label="Close staging tools" onClick={close}>×</button></header>
          <p className="stg-note" role="status" aria-live="polite">{note || 'Nothing run yet.'}</p>
          <h2>Test account</h2>
          <div className="stg-seg" role="group" aria-label="Test account">
            <button type="button" aria-pressed={!s.owner} disabled={busy} onClick={() => run('reader', () => 'Signed out. You are a reader.')}>Reader</button>
            <button type="button" aria-pressed={s.owner} disabled={busy} onClick={() => run('owner', () => 'Signed in as the owner (simulated sign-in).')}>Owner</button>
          </div>
          <h2>Agent key</h2>
          <ul>{AGENT.map(row)}</ul>
          <h2>Simulate</h2>
          <ul>{SIMULATE.map(row)}</ul>
          <button type="button" className="stg-reset" disabled={busy} onClick={() => run('reset', () => 'Sample data restored. You are a reader.')}>Reset sample data</button>
        </div>) : null}
      <button type="button" ref={pill} className="stg-pill" aria-expanded={open} aria-controls="stg-panel" aria-label={`Local staging tools. Test account: ${s.owner ? 'Owner' : 'Reader'}`} onClick={() => setOpen(o => !o)}>
        <span className="stg-dot" aria-hidden="true" />Staging<span className="stg-role">{s.owner ? 'Owner' : 'Reader'}</span>
      </button>
    </div>
  );
}
