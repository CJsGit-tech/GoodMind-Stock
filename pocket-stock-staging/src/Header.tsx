import React, { useState } from 'react';
import { NavLink, SearchField, useMedia } from './ui';
import { useLoad, useStore } from './store';
import type { DraftSummary } from '../shared/graph';

/** The same header on every route: brand, the main routes, and one search. */
export function Header() {
  const s = useStore();
  const sm = useMedia('(max-width: 699px)');
  const [menu, setMenu] = useState(false);
  const drafts = useLoad<{ waiting: DraftSummary[] }>(s.owner ? '/api/owner/drafts' : null, s.dataTick);
  const waiting = drafts.data?.waiting.length || 0;
  const here = (sc: string) => s.route.screen === sc || (sc === 'library' && s.route.screen === 'article') || (sc === 'graph' && s.route.screen === 'node');
  const entries = (
    <>
      <NavLink screen="graph" ariaCurrent={here('graph')} className="hdr-link" onClick={() => setMenu(false)}>圖譜</NavLink>
      <NavLink screen="library" ariaCurrent={here('library')} className="hdr-link" onClick={() => setMenu(false)}>書庫</NavLink>
      <NavLink screen="about" ariaCurrent={here('about')} className="hdr-link" onClick={() => setMenu(false)}>關於</NavLink>
      {s.owner ? <NavLink screen="review" ariaCurrent={here('review')} className="hdr-link owner" onClick={() => setMenu(false)}>Owner{waiting ? <span className="dot" aria-label={`${waiting} draft${waiting > 1 ? 's' : ''} waiting`} /> : null}</NavLink> : null}
    </>
  );
  return (
    <header className="hdr">
      <NavLink screen="graph" className="brand" label="口袋股，回到圖譜" onClick={() => setMenu(false)}><span className="brand-mark" aria-hidden="true" />口袋股</NavLink>
      {!sm ? <nav className="hdr-nav" aria-label="Main">{entries}</nav> : null}
      <SearchField id="search" />
      {sm ? <button type="button" className="btn-text menu-btn" aria-expanded={menu} aria-controls="m-menu" onClick={() => setMenu(m => !m)}>{menu ? '關閉' : '選單'}</button> : null}
      {sm && menu ? <nav id="m-menu" className="mobile-menu" aria-label="Main">{entries}</nav> : null}
    </header>
  );
}
