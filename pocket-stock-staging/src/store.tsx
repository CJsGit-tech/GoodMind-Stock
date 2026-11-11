import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { GraphView, PublicGraph, toView } from './model';

export type Screen = 'about' | 'graph' | 'library' | 'article' | 'node' | 'review';
export const SCREENS: Screen[] = ['about', 'graph', 'library', 'article', 'node', 'review'];
export interface Route { screen: Screen; subject: string }
export interface Filters { q: string; depth: number; colorBy: 'type' | 'none' }
export interface ApiError { status: number; message: string; data: any }

const fail = (e: any): ApiError => ({ status: e?.status || e?.response?.status || 0, message: e?.response?.data?.error || (e?.status || e?.response?.status ? e.message : '無法連線，請再試一次。'), data: e?.response?.data || {} });
export const get = <T,>(path: string) => api.get(path).then(r => r.data as T, e => { throw fail(e); });
export const post = <T,>(path: string, body?: unknown) => api.post(path, body).then(r => r.data as T, e => { throw fail(e); });

/** Loads one resource. Keeps the last data on screen while a newer request is running. */
export function useLoad<T>(path: string | null, tick: unknown = 0) {
  const [state, set] = useState<{ data?: T; error?: ApiError; loading: boolean; path?: string }>({ loading: !!path });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { set({ loading: false }); return; }
    let live = true;
    set(s => ({ ...(s.path === path ? s : {}), loading: true, path }));
    get<T>(path).then(data => live && set({ data, loading: false, path }), error => live && set({ error, loading: false, path }));
    return () => { live = false; };
  }, [path, tick, n]);
  return { ...state, reload: useCallback(() => setN(x => x + 1), []) };
}

interface Store {
  route: Route; go(r: Route): void;
  owner: boolean; refreshSession(): Promise<void>;
  graph: GraphView | null; graphError: ApiError | null; reloadGraph(): void; dataTick: number;
  filters: Filters; setFilters(f: Partial<Filters>): void;
  /** Positions the reader dragged nodes to. They last until the page is reloaded or the layout is reset. */
  moveNodes(positions: Record<string, { x: number; y: number }>, portrait: boolean): void; layoutMoved: boolean; resetLayout(): void;
}
const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

export function parseHash(): Route {
  const [screen, subject = ''] = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('?')[0].split('/');
  return SCREENS.includes(screen as Screen) ? { screen: screen as Screen, subject } : { screen: 'graph', subject: '' };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash);
  const [owner, setOwner] = useState(false);
  const [base, setGraph] = useState<GraphView | null>(null);
  const [moved, setMoved] = useState<Record<string, Partial<{ x: number; y: number; px: number; py: number }>>>({});
  const layoutMoved = Object.keys(moved).length > 0;
  const graph = useMemo(() => (base && layoutMoved ? { ...base, nodes: base.nodes.map(n => (moved[n.id] ? { ...n, ...moved[n.id] } : n)) } : base), [base, moved, layoutMoved]);
  const moveNodes = useCallback((positions: Record<string, { x: number; y: number }>, portrait: boolean) => setMoved(m => {
    const next = { ...m };
    for (const [id, p] of Object.entries(positions)) next[id] = { ...next[id], ...(portrait ? { px: p.x, py: p.y } : { x: p.x, y: p.y }) };
    return next;
  }), []);
  const [graphError, setGraphError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const [filters, setF] = useState<Filters>({ q: '', depth: 2, colorBy: 'type' });
  const refreshSession = useCallback(() => get<{ owner: boolean }>('/api/owner/session').then(s => setOwner(s.owner), () => setOwner(false)), []);
  useEffect(() => { refreshSession(); }, [refreshSession]);
  useEffect(() => {
    let live = true;
    get<PublicGraph>('/api/graph').then(g => { if (live) { setGraph(toView(g)); setGraphError(null); } }, e => live && setGraphError(e));
    return () => { live = false; };
  }, [tick]);
  const value = useMemo<Store>(() => ({
    route, go: setRoute, owner, refreshSession, graph, graphError, reloadGraph: () => setTick(t => t + 1), dataTick: tick,
    filters, setFilters: f => setF(x => ({ ...x, ...f })),
    moveNodes, layoutMoved, resetLayout: () => setMoved({}),
  }), [route, owner, refreshSession, graph, graphError, tick, filters, moveNodes, layoutMoved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
