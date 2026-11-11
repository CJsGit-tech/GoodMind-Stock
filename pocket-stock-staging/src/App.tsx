import React, { useState } from 'react';
import { AI_NOTICE } from '../shared/graph';
import { StoreProvider, parseHash, post, useStore } from './store';
import { Header } from './Header';
import { Canvas } from './Canvas';
import { AboutPage, BookPage, LibraryPage, NodePage } from './pages/Public';
import { OwnerPage } from './pages/Owner';

/**
 * Local staging only. Stands in for what AppDeploy or an outside caller does later:
 * switching test accounts, the agent calling with its secret key, another publication, and a failed publish.
 * The agent key never reaches the browser; the local server makes those calls.
 */
function StagingBar() {
  const s = useStore();
  const [note, setNote] = useState('');
  const run = async (action: string, describe: (r: any) => string, extra: Record<string, unknown> = {}) => {
    try { const r = await post<any>('/__local/simulate', { action, ...extra }); setNote(describe(r)); await s.refreshSession(); s.reloadGraph(); }
    catch (e: any) { setNote(`${action}: ${e.message}`); }
  };
  const chip = (label: string, fn: () => void, pressed?: boolean, title?: string) => <button type="button" className="chip" aria-pressed={pressed} title={title} onClick={fn}>{label}</button>;
  return (
    <nav className="menu" aria-label="Local staging tools">
      <strong>本機 STAGING</strong><span>Account</span>
      {chip('Reader', () => run('reader', () => 'Signed out. You are a reader.'), !s.owner, 'Sign out of the owner workspace')}
      {chip('Owner', () => run('owner', () => 'Signed in as the owner (simulated sign-in).'), s.owner, 'Sign in as the owner without typing the local password')}
      <i /><span>Agent key</span>
      {chip('Upload a draft', () => run('agent-upload', r => `Agent uploaded draft #${r.number}. It is private until the owner approves it.`), undefined, 'The agent uploads a sample package with its secret key')}
      {chip('Upload twice', () => run('agent-retry', r => `Same package sent twice: draft #${r.first.number}, second call duplicate = ${r.second.duplicate}.`), undefined, 'A retry with the same requestId must not create a second draft')}
      {chip('Look up names', () => run('agent-lookup', r => r.results.map((x: any) => `${x.name}: ${x.match === 'none' ? (x.close.length ? 'close to ' + x.close[0].name : 'not found') : x.match + ' → ' + x.node.name}`).join(' · ')), undefined, 'The agent checks names against the live graph')}
      {chip('Try to publish', () => run('agent-publish', r => `Agent key on owner routes: list drafts → ${r.listDrafts}, approve → ${r.approve}.`), undefined, 'The agent key must be refused on owner routes')}
      <i /><span>Simulate</span>
      {chip('Same-name node appears', () => run('conflict', r => (r.added ? `「${r.name}」 was published by another draft.` : `「${r.name}」 already exists.`)), undefined, 'Another publication adds 外資買超 after the agent’s lookup')}
      {chip('Next publish fails', () => run('fail-next-publish', () => 'The next Approve & publish will fail once.'))}
      <span className="grow" />
      <span className="menu-note" role="status" aria-live="polite">{note}</span>
      {chip('Reset data', () => run('reset', () => 'Sample data restored.'))}
    </nav>
  );
}

function Site() {
  const s = useStore();
  const r = s.route;
  const first = React.useRef(true);
  const path = `/${r.screen}${r.subject ? '/' + r.subject : ''}`;
  // state → hash
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    const now = decodeURIComponent(window.location.hash.replace(/^#/, '')).split('?')[0];
    if (now !== path) window.location.hash = path;
    (document.querySelector('.page') as HTMLElement | null)?.scrollTo(0, 0);
    const id = window.setTimeout(() => (document.querySelector('#main h1') as HTMLElement | null)?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [path]);
  // hash → state (browser Back and Forward, typed addresses)
  React.useEffect(() => {
    const onHash = () => { const next = parseHash(); if (next.screen !== s.route.screen || next.subject !== s.route.subject) s.go(next); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
  if (r.screen === 'graph') return <div className="site"><Header /><main id="main" className="stage"><Canvas /><p className="stage-foot">{AI_NOTICE}</p></main></div>;
  const page = r.screen === 'node' ? <NodePage id={r.subject} />
    : r.screen === 'article' ? <BookPage id={r.subject.split('~')[0]} reading={r.subject.endsWith('~read')} />
    : r.screen === 'library' ? <LibraryPage />
    : r.screen === 'about' ? <AboutPage />
    : <OwnerPage subject={r.subject} />;
  return (
    <div className="site">
      <a className="skip" href="#main" onClick={e => { e.preventDefault(); (document.querySelector('#main h1') as HTMLElement | null)?.focus(); }}>跳到內容</a>
      <Header />
      <main id="main" className="page">{page}</main>
    </div>
  );
}

export default function App() {
  return <StoreProvider><div className="shell"><StagingBar /><Site /></div></StoreProvider>;
}
