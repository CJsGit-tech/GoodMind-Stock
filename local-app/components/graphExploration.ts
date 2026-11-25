import { relationshipStatusMatches } from './relationshipProof';
import { Graph } from './types';

export type ExplorationOptions = {
  query: string;
  type: string;
  group: string;
  status: string;
  limit: number;
  evidence: boolean;
  selectedId: string;
  focusOnly: boolean;
  hops: number;
};

/** Traverses supplied base edges and provenance-backed read-only projections. */
export function computeExploration(graph: Graph, options: ExplorationOptions) {
  const { query, type, group, status, evidence, selectedId, focusOnly } = options;
  const hops = Math.max(0, Math.min(3, Math.floor(options.hops)));
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit)));
  const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
  const typesByPredicate = Object.fromEntries(graph.edgeTypes.map(edge => [edge.predicate, edge]));

    const eligibleEdges = graph.edges.filter(
      e =>
        (!group || typesByPredicate[e.predicate]?.group === group) &&
        relationshipStatusMatches(e, status)
    );
    const connected = new Set(eligibleEdges.flatMap(e => [e.from, e.to]));
    const neighbors = new Set([
      selectedId,
      ...eligibleEdges
        .filter(e => e.from === selectedId || e.to === selectedId)
        .flatMap(e => [e.from, e.to]),
    ]);
    const q = query.trim().toLowerCase();
    const matching = new Set(
      graph.nodes
        .filter(n =>
          [
            n.name,
            n.id,
            n.ticker,
            ...(Array.isArray(n.aliases) ? n.aliases : []),
          ].some(v =>
            String(v || '')
              .toLowerCase()
              .includes(q)
          )
        )
        .map(n => n.id)
    );
    const searchContext = new Set([
      ...matching,
      ...eligibleEdges
        .filter(e => matching.has(e.from) || matching.has(e.to))
        .flatMap(e => [e.from, e.to]),
    ]);
    const pool = graph.nodes
      .filter(
        n =>
          (evidence || type === n.type || !['Evidence', 'Claim'].includes(n.type)) &&
          (!type || n.type === type) &&
          (!group || connected.has(n.id)) &&
          (!status || n.verification_status === status || connected.has(n.id)) &&
          (!q || searchContext.has(n.id)) &&
          (!focusOnly || neighbors.has(n.id))
      )
      .sort(
        (a, b) =>
          Number(b.type === 'Company') - Number(a.type === 'Company') ||
          a.name.localeCompare(b.name)
      );
    const baseIds = new Set(pool.map(n => n.id));
    const expansionIds: string[] = [];
    const seen = new Set<string>();
    if (hops > 0 && byId[selectedId]) {
      seen.add(selectedId);
      expansionIds.push(selectedId);
      let frontier = [selectedId];
      for (let level = 0; level < hops; level++) {
        const next = new Set<string>();
        for (const id of frontier) {
          for (const edge of eligibleEdges) {
            const other = edge.from === id ? edge.to : edge.to === id ? edge.from : '';
            const node = byId[other];
            if (!node || seen.has(other)) continue;
            if (!evidence && type !== node.type && ['Evidence', 'Claim'].includes(node.type)) continue;
            next.add(other);
          }
        }
        frontier = [...next].sort();
        for (const id of frontier) {
          seen.add(id);
          expansionIds.push(id);
        }
      }
    }
    // Focus mode includes only the root and its real BFS neighborhood.
    // This makes the node cap deterministic and never drops the exploration root.
    const orderedIds = [...expansionIds];
    if (!hops && baseIds.has(selectedId)) orderedIds.push(selectedId);
    const orderedSet = new Set(orderedIds);
    for (const node of hops > 0 ? [] : pool) {
      if (!orderedSet.has(node.id)) {
        orderedIds.push(node.id);
        orderedSet.add(node.id);
      }
    }
    const allIds = new Set(orderedIds);
    const nodes = orderedIds.slice(0, limit).map(id => byId[id]);
    const ids = new Set(nodes.map(n => n.id));
    const poolEdges = eligibleEdges.filter(e => allIds.has(e.from) && allIds.has(e.to));
    const edges = poolEdges.filter(e => ids.has(e.from) && ids.has(e.to));
    const hiddenByType = eligibleEdges.filter(e =>
      (baseIds.has(e.from) && !baseIds.has(e.to) && byId[e.to]?.type !== type) ||
      (baseIds.has(e.to) && !baseIds.has(e.from) && byId[e.from]?.type !== type)
    ).length;
    return {
      nodes,
      edges,
      total: orderedIds.length,
      added: expansionIds.filter(id => !baseIds.has(id)).length,
      hiddenByType: type ? hiddenByType : 0,
      hiddenByCap: poolEdges.length - edges.length,
      outsideBase: hops > 0 && Boolean(byId[selectedId]) && !baseIds.has(selectedId),
    };
}
