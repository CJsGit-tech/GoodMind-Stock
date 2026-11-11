import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { GraphView, PublicGraph, toView } from './model';

export type Screen = 'about' | 'graph' | 'library' | 'article' | 'node' | 'review';
export const SCREENS: Screen[] = ['about', 'graph', 'library', 'article', 'node', 'review'];
export interface Route { screen: Screen; subject: string }
export interface Filters { q: string; depth: number; colorBy: 'type' | 'none' }
export interface ApiError { status: number; message: string; data: any }

const fail = (e: any): ApiError => ({ status: e?.status || 0, message: e?.response?.data?.error || (e?.status ? e.message : '無法連線，請再試一次。'), data: e?.response?.data || {} });
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
  const [graph, setGraph] = useState<GraphView | null>(null);
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
  }), [route, owner, refreshSession, graph, graphError, tick, filters]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
