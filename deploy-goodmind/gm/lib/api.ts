import { useCallback, useEffect, useState } from 'react';
import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../core/types';
import type { WriteOp } from '../core/write';
import { http } from './http';

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; entityTypes: EntityType[]; edgeTypes: EdgeType[]; meta: Record<string, unknown>; aiConfigured: boolean };

export function useGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => { const r = await http('GET', '/api/graph'); if (r.ok) { setData(r.data); setError(''); } else setError('unreachable'); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

export type QualityReport = { ok: boolean; errors: number; warnings: number; byRule: { rule: string; level: string; count: number; description: string }[]; issues: { level: string; rule: string; id: string; message: string }[] };
export async function fetchQuality(): Promise<QualityReport> {
  const r = await http('GET', '/api/quality'); if (!r.ok) throw new Error('quality unavailable'); return r.data;
}

export async function ontology(body: object): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const r = await http('POST', '/api/ontology', body);
  return r.ok ? { ok: true } : { ok: false, errors: r.data.errors ?? ['Request failed.'] };
}

export async function decideSuggestion(id: string, decision: 'accept' | 'reject'): Promise<{ ok: true; recordId?: string } | { ok: false; error: string }> {
  const r = await http('POST', '/api/suggestions/decide', { id, decision });
  return r.ok ? { ok: true, recordId: r.data.recordId } : { ok: false, error: r.data.error ?? 'Request failed.' };
}

/** The single write entry. dryRun validates without saving. */
export async function writeFacts(ops: WriteOp[], dryRun = false): Promise<{ ok: true; created: string[] } | { ok: false; errors: string[] }> {
  const r = await http('POST', `/api/write${dryRun ? '?dryRun=1' : ''}`, { ops });
  return r.ok ? { ok: true, created: r.data.created ?? [] } : { ok: false, errors: r.data.errors ?? ['Request failed.'] };
}

/** Company search (GQC). Returns the response, or the list of reasons the query was refused. */
export const runQuery = (query: object) => http('POST', '/api/query', query);
export const fetchQueryRegistry = () => http('GET', '/api/query/registry');

/** Admin session. admin = signed in; configured = credentials are set on the server; needsUsername = sign-in asks for a user name. */
export function useAdmin() {
  const [state, setState] = useState<{ admin: boolean; configured: boolean; needsUsername?: boolean } | null>(null);
  const refresh = useCallback(async () => { const r = await http('GET', '/api/admin/me'); setState(r.ok ? r.data : { admin: false, configured: false }); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = async (username: string, password: string): Promise<string | null> => {
    const r = await http('POST', '/api/admin/login', { username, password });
    await refresh();
    return r.ok ? null : r.data.error ?? 'Sign-in failed.';
  };
  const logout = async () => { await http('POST', '/api/admin/logout'); await refresh(); };
  return { ...state, ready: state !== null, login, logout };
}
