import React from 'react';
import { AI_NOTICE } from '../shared/graph';
import { StoreProvider, parseHash, useStore } from './store';
import { Header } from './Header';
import { Canvas } from './Canvas';
import { AboutPage, BookPage, LibraryPage, NodePage } from './pages/Public';
import { OwnerPage } from './pages/Owner';
import './styles.css';

// Local staging tools exist only in the dev server. A production build drops this import and the whole src/staging folder.
// The folder is found with a glob, so a deployment that leaves it out still builds.
const stagingModules = import.meta.glob<{ default: React.ComponentType }>('./staging/StagingTools.tsx');
const loadStaging = stagingModules['./staging/StagingTools.tsx'];
const StagingTools = import.meta.env.DEV && loadStaging ? React.lazy(loadStaging) : null;

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

export default function Root() {
  return <StoreProvider><div className="shell"><Site />{StagingTools ? <React.Suspense fallback={null}><StagingTools /></React.Suspense> : null}</div></StoreProvider>;
}
