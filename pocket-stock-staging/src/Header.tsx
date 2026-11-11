import { useState } from 'react';
import { NavLink, useMedia } from './ui';
import { post, useLoad, useStore } from './store';
import type { DraftSummary } from '../shared/graph';

/** The same header on every route: brand, the three main routes, and sign-in at the far right. Search belongs to the graph route. Only the owner has an account. */
export function Header() {
  const s = useStore();
  const sm = useMedia('(max-width: 699px)');
  const [menu, setMenu] = useState(false);
  const drafts = useLoad<{ waiting: DraftSummary[] }>(s.owner ? '/api/owner/drafts' : null, s.dataTick);
  const waiting = drafts.data?.waiting.length || 0;
  const here = (sc: string) => s.route.screen === sc || (sc === 'library' && s.route.screen === 'article') || (sc === 'graph' && s.route.screen === 'node');
  const signOut = async () => { setMenu(false); await post('/api/owner/logout').catch(() => {}); await s.refreshSession(); };
  const entries = (
    <>
      <NavLink screen="graph" ariaCurrent={here('graph')} className="hdr-link" onClick={() => setMenu(false)}>財經心智圖</NavLink>
      <NavLink screen="library" ariaCurrent={here('library')} className="hdr-link" onClick={() => setMenu(false)}>書庫</NavLink>
      <NavLink screen="about" ariaCurrent={here('about')} className="hdr-link" onClick={() => setMenu(false)}>關於我們</NavLink>
    </>
  );
  const account = s.owner ? (
    <>
      <NavLink screen="review" ariaCurrent={here('review')} className="hdr-link owner" onClick={() => setMenu(false)}>Owner{waiting ? <span className="dot" aria-label={`${waiting} draft${waiting > 1 ? 's' : ''} waiting`} /> : null}</NavLink>
      <button type="button" className="hdr-link hdr-out" onClick={signOut}>登出</button>
    </>
  ) : <NavLink screen="review" ariaCurrent={here('review')} className="hdr-link login" onClick={() => setMenu(false)}>登入</NavLink>;
  return (
    <header className="hdr">
      <NavLink screen="graph" className="brand" label="股脈，回到財經心智圖" onClick={() => setMenu(false)}><span className="brand-mark" aria-hidden="true" />股脈</NavLink>
      {!sm ? <nav className="hdr-nav" aria-label="Main">{entries}</nav> : null}
      {!sm ? <div className="hdr-account">{account}</div> : null}
      {sm ? <button type="button" className="btn-text menu-btn" aria-expanded={menu} aria-controls="m-menu" onClick={() => setMenu(m => !m)}>{menu ? '關閉' : '選單'}</button> : null}
      {sm && menu ? <nav id="m-menu" className="mobile-menu" aria-label="Main">{entries}{account}</nav> : null}
    </header>
  );
}
