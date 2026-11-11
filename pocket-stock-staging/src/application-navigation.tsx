import type { ReactNode } from 'react';

/** One public navigation, including the parent section of an open article. */
export function ApplicationNavigation({ active, open, showDiscussion, onLibrary, onDiscussion, onEtf, onInstitutional, onCalendar, children }: {
  active: 'library' | 'discussion' | 'active-etf' | 'institutional-flows' | 'calendar' | null;
  open: boolean;
  showDiscussion: boolean;
  onLibrary: () => void;
  onDiscussion: () => void;
  onEtf: () => void;
  onInstitutional: () => void;
  onCalendar?: () => void;
  children?: ReactNode;
}) {
  const items = [
    { id: 'library', label: '研究書庫', onClick: onLibrary },
    ...(showDiscussion ? [{ id: 'discussion', label: '討論吧', onClick: onDiscussion }] : []),
    { id: 'active-etf', label: '主動式ETF', onClick: onEtf },
    { id: 'institutional-flows', label: '三大法人', onClick: onInstitutional },
    ...(onCalendar ? [{ id: 'calendar', label: '投資行事曆', onClick: onCalendar }] : []),
  ];
  return <nav className={'nav-links application-navigation' + (open ? ' is-open' : '')} aria-label='主要導覽'>
    {items.map(item => <button key={item.id} type='button' className={active === item.id ? 'active' : ''}
      aria-current={active === item.id ? 'page' : undefined} onClick={item.onClick}>
      <span className='application-navigation-label'>{item.label}</span>
    </button>)}
    {children}
  </nav>;
}
