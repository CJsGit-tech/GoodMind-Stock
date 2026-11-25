// Restores the packed dataset (nodes1-N.json, edges.json) to full nodes and edges.
// Edges are stored as [relation, from, to, reliability, sources, other attributes] using node positions.
import part1 from './nodes1.json';
import part2 from './nodes2.json';
import part3 from './nodes3.json';
import part4 from './nodes4.json';
import part5 from './nodes5.json';
import part6 from './nodes6.json';
import part7 from './nodes7.json';
import part8 from './nodes8.json';
import part9 from './nodes9.json';
import part10 from './nodes10.json';
import part11 from './nodes11.json';
import packedEdges from './edges.json';
import { factId } from '../core/write';
import type { GraphEdge, GraphNode } from '../core/types';

const META = {
  "as_of": "2026-11-18",
  "dataset_id": "taiwan-physical-edge-ai-design-fixture",
  "disclaimer": "Illustrative graph based on previously assembled example and inherited URLs; evidence was not independently re-verified for this ZIP. Competition assessments are analyst-inferred, not proof of market share or head-to-head bids. No confirmed real-world customer sales links included."
};
const RELATIONS: string[] = [
  'BRANDS',
  'BUSINESS_LINE_IN_SEGMENT',
  'CATEGORY_IN_SEGMENT',
  'COMPETES_IN_CATEGORY',
  'COMPETES_IN_SEGMENT',
  'COMPETES_ON_APPLICATION',
  'CONTROLS',
  'DESIGNS',
  'EVENT_PARTICIPANT',
  'FEEDS_SEGMENT',
  'FOCUSES_ON_PRODUCT',
  'FOR_SUPPLIED_PRODUCT',
  'FOR_SUPPLIED_SERVICE',
  'HAS_BUYER',
  'HAS_CAPABILITY',
  'HAS_PARTICIPANT',
  'HAS_SUPPLIER',
  'HOLDS_CONSTITUENT',
  'IN_CATEGORY',
  'IS_SUBSIDIARY_OF',
  'MANUFACTURES',
  'MEMBER_OF_GROUP',
  'OFFERING_A',
  'OFFERING_B',
  'OFFERS_SERVICE',
  'OPERATES_BUSINESS_LINE',
  'OPERATES_IN',
  'OWNS_STAKE_IN',
  'PROVIDES_TECHNOLOGY',
  'SEGMENT_FOR_APPLICATION',
  'SEGMENT_OF_INDUSTRY',
  'SELLS',
  'SERVES_INDUSTRY',
  'SUPPORTED_BY',
  'SUPPORTS_APPLICATION',
  'TARGETS_SEGMENT',
  'USES_TECHNOLOGY',
];
const EXPECTED = { nodes: 1046, edges: 1100, check: 48936 };
const STATUS: Record<string, string> = { v: 'verified', r: 'reported', i: 'inferred', s: 'suggested', d: 'disputed' };
type Row = [number, number, number, string, number[], Record<string, unknown>?];

export function decodeSeed(): { as_of: string; dataset_id: string; disclaimer: string; nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [...part1.nodes, ...part2.nodes, ...part3.nodes, ...part4.nodes, ...part5.nodes, ...part6.nodes, ...part7.nodes, ...part8.nodes, ...part9.nodes, ...part10.nodes, ...part11.nodes] as unknown as GraphNode[];
  const rows = packedEdges.edges as unknown as Row[];
  const check = nodes.reduce((sum, n) => sum + n.id.length + n.name.length, 0);
  if (nodes.length !== EXPECTED.nodes || rows.length !== EXPECTED.edges || check !== EXPECTED.check) {
    console.error('GoodMind dataset is incomplete', { nodes: nodes.length, edges: rows.length, check });
  }
  const edges = rows.map(([rel, from, to, status, sources, extra]) => {
    const predicate = RELATIONS[rel];
    return {
      id: factId(predicate, nodes[from].id, nodes[to].id), predicate, from: nodes[from].id, to: nodes[to].id,
      attributes: { verification_status: STATUS[status], ...(sources.length ? { evidence_ids: sources.map(i => nodes[i].id) } : {}), ...(extra ?? {}) },
    };
  });
  return { ...META, nodes, edges };
}
