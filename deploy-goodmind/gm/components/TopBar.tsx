import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { EntityType, GraphNode } from '../core/types';
import { typeLabel } from '../core/types';
import { jumpMatches } from '../lib/filters';

export default function TopBar({ stats, nodes, types = [], onJump }: { stats?: string; nodes?: GraphNode[]; types?: EntityType[]; onJump?: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const hits = nodes ? jumpMatches(nodes, q) : [];
  return (
    <header className="topbar glass">
      <div className="brand"><span className="logo" aria-hidden>✦</span><div><b>股脈 GoodMind</b><small>{t('產業知識圖譜')}</small></div></div>
      <nav>
        <NavLink to="/" end>{t('探索')}</NavLink>
        <NavLink to="/docs">{t('資料說明')}</NavLink>
      </nav>
      {onJump && (
        <div className="jump">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('搜尋公司、產品或股票代號')} aria-label={t('搜尋節點')} />
          {hits.length > 0 && <ul>{hits.map(n => <li key={n.id}><button onClick={() => { onJump(n.id); setQ(''); }}><b>{n.name}</b><span>{typeLabel(types, n.type)}</span></button></li>)}</ul>}
        </div>)}
      {stats && <span className="stats">{stats}</span>}
    </header>
  );
}
