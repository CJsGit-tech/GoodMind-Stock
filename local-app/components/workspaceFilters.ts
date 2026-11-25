import { Graph } from './types';

export type WorkspaceMode = 'nodes' | 'edges' | 'entityTypes' | 'edgeTypes';
export type WorkspaceFilters = {
  query: string;
  type: string;
  status: string;
  predicate: string;
  endpoint: string;
  group: string;
  storage: string;
  usage: string;
};
export const emptyWorkspaceFilters: WorkspaceFilters = {
  query: '', type: '', status: '', predicate: '', endpoint: '',
  group: '', storage: '', usage: '',
};
export function filterWorkspaceRows(
  graph: Graph,
  mode: WorkspaceMode,
  filters: WorkspaceFilters,
  searchText: (row: Record<string, unknown>) => string = row => JSON.stringify(row),
) {
  return (graph[mode] as unknown as Record<string, unknown>[]).filter(row => {
    if (filters.query.trim() && !searchText(row).toLocaleLowerCase().includes(filters.query.trim().toLocaleLowerCase())) return false;
    if (mode === 'nodes' && filters.type && row.type !== filters.type) return false;
    if ((mode === 'nodes' || mode === 'edges') && filters.status &&
      (row.verification_status || '__unmarked') !== filters.status) return false;
    if (mode === 'edges') {
      if (filters.predicate && row.predicate !== filters.predicate) return false;
      if (filters.endpoint && row.from !== filters.endpoint && row.to !== filters.endpoint) return false;
    }
    if (mode === 'edgeTypes') {
      if (filters.group && row.group !== filters.group) return false;
      if (filters.storage && row.storage !== filters.storage) return false;
    }
    if (mode === 'entityTypes' && filters.usage) {
      const used = graph.nodes.some(node => node.type === row.name) ||
        graph.edgeTypes.some(edge => edge.from === row.name || edge.to === row.name);
      if ((filters.usage === 'used') !== used) return false;
    }
    return true;
  });
}

/** Drop stale facet values after data edits while preserving the search query. */
export function pruneWorkspaceFilters(
  graph: Graph,
  mode: WorkspaceMode,
  filters: WorkspaceFilters,
): WorkspaceFilters {
  const used = (name: string) => graph.nodes.some(node => node.type === name) ||
    graph.edgeTypes.some(edge => edge.from === name || edge.to === name);
  const allowed: Partial<Record<keyof WorkspaceFilters, string[]>> = {};
  if (mode === 'nodes') allowed.type = graph.nodes.map(node => node.type);
  if (mode === 'nodes' || mode === 'edges') allowed.status =
    (mode === 'nodes' ? graph.nodes : graph.edges).map(row => String(row.verification_status || '__unmarked'));
  if (mode === 'edges') {
    allowed.predicate = graph.edges.map(edge => edge.predicate);
    allowed.endpoint = graph.edges.flatMap(edge => [edge.from, edge.to]);
  }
  if (mode === 'edgeTypes') {
    allowed.group = graph.edgeTypes.map(edge => edge.group);
    allowed.storage = graph.edgeTypes.map(edge => edge.storage);
  }
  if (mode === 'entityTypes') allowed.usage = graph.entityTypes.map(type => used(type.name) ? 'used' : 'unused');
  const next = {...filters};
  for (const key of Object.keys(allowed) as (keyof WorkspaceFilters)[]) {
    if (next[key] && !allowed[key]!.includes(next[key])) next[key] = '';
  }
  return Object.keys(filters).every(key => next[key as keyof WorkspaceFilters] === filters[key as keyof WorkspaceFilters]) ? filters : next;
}
