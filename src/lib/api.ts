import { useCallback, useEffect, useState } from 'react';
import type { EdgeType, EntityType, GraphEdge, GraphNode } from '../../lib/types';
import { http } from './http';

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; entityTypes: EntityType[]; edgeTypes: EdgeType[]; meta: Record<string, unknown> };

export function useGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => { const r = await http('GET', '/api/graph'); if (r.ok) { setData(r.data); setError(''); } else setError('unreachable'); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

/** Company search (GQC). Returns the response, or the list of reasons the query was refused. */
export const runQuery = (query: object) => http('POST', '/api/query', query);
export const fetchQueryRegistry = () => http('GET', '/api/query/registry');
