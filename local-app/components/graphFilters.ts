import type { Graph } from './types';

export function graphFilterOptions(graph: Graph) {
  const unique = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))].sort();
  const definitions = new Map(graph.edgeTypes.map(definition => [definition.predicate, definition]));
  return {
    types: unique(graph.nodes.map(node => node.type)),
    groups: unique(graph.edges.map(edge => definitions.get(edge.predicate)?.group)),
    statuses: unique([...graph.nodes, ...graph.edges].map(record => record.verification_status)),
  };
}
