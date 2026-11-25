// Picks the graph view: the 2D canvas view by default, or the 3D galaxy when the user asks for it and the browser can
// run WebGL. A failure inside either view stays inside this component, so the assistant, search and details keep working.
import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { canUse3D } from './graphShared';
import type { GraphProps } from './graphShared';

// Each view is only downloaded when it is shown, so the default 2D page never loads three.js.
const Graph2D = lazy(() => import('./Graph2D'));
const GalaxyGraph = lazy(() => import('./GalaxyGraph'));

class GraphBoundary extends Component<{ onError?: () => void; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('graph view failed', e instanceof Error ? e.message : e); this.props.onError?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function GraphView({ want3d, ...props }: GraphProps & { want3d: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState(true);
  const supported = useMemo(() => want3d && canUse3D(), [want3d]);
  const use3d = supported && !failed;
  const unavailable = want3d && !use3d;   // asked for 3D, showing 2D
  // Choosing 2D clears an earlier failure, so picking 3D again retries it.
  useEffect(() => { if (!want3d) setFailed(false); }, [want3d]);
  useEffect(() => { if (!unavailable) return; setNote(true); const timer = setTimeout(() => setNote(false), 8000); return () => clearTimeout(timer); }, [unavailable]);

  // The keys matter: without them React would reuse the failed 3D boundary for 2D and never try the 2D view.
  if (use3d) return <GraphBoundary key="3d" onError={() => setFailed(true)} fallback={null}><Suspense fallback={null}><GalaxyGraph {...props} /></Suspense></GraphBoundary>;
  return (<>
    <GraphBoundary key="2d" fallback={<div className="void" role="alert">{t('圖譜無法顯示；左側的瀏覽、搜尋和資料仍可使用。')}</div>}>
      <Suspense fallback={null}><Graph2D {...props} /></Suspense>
    </GraphBoundary>
    {unavailable && note && <div className="graph-note" role="status">{t('此瀏覽器無法啟動 3D，已改用 2D 圖譜。')}
      <button className="link" onClick={() => setNote(false)} aria-label={t('關閉')}>✕</button></div>}
  </>);
}
