export type GraphNode = {
  id: string;
  type: string;
  name: string;
  [key: string]: unknown;
};
export type GraphEdge = {
  id: string;
  predicate: string;
  from: string;
  to: string;
  [key: string]: unknown;
};
export type EntityType = { name: string; definition: string };
export type EdgeType = {
  group: string;
  predicate: string;
  from: string;
  to: string;
  storage: string;
  meaning: string;
};
export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entityTypes: EntityType[];
  edgeTypes: EdgeType[];
  [key: string]: unknown;
};
export const verificationStates = [
  'officially_disclosed',
  'corroborated',
  'reported',
  'analyst_inferred',
  'hypothesis',
  'disputed',
  'rejected',
];
export const derivedPredicates = [
  'SUPPLIES_TO',
  'INDIRECT_SUPPLIER_OF',
  'COLLABORATES_WITH',
  'DIRECTLY_COMPETES_WITH',
  'INDIRECTLY_COMPETES_WITH',
  'DIRECT_COMPETITOR_OF',
  'INDIRECT_COMPETITOR_OF',
];
const recordTypes = [
  'SupplyRelationship',
  'CustomerOpportunity',
  'Collaboration',
  'CompetitionAssessment',
];

export function validateGraph(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['Graph must be an object.'];
  const graph = value as Graph;
  if (
    ![graph.nodes, graph.edges, graph.entityTypes, graph.edgeTypes].every(
      Array.isArray
    )
  ) {
    return ['nodes, edges, entityTypes and edgeTypes must be arrays.'];
  }
  if (
    graph.nodes.length > 250 ||
    graph.edges.length > 750 ||
    graph.entityTypes.length > 80 ||
    graph.edgeTypes.length > 160
  ) {
    errors.push(
      'Workspace limit: 250 nodes, 750 edges, 80 classes and 160 predicates.'
    );
  }
  const unique = (values: unknown[], label: string) => {
    if (values.some(v => typeof v !== 'string' || !v.trim() || v.length > 180))
      errors.push(
        `${label}: non-empty IDs/names up to 180 characters required.`
      );
    if (new Set(values).size !== values.length)
      errors.push(`${label}: duplicate IDs/names.`);
  };
  if (
    [
      ...graph.nodes,
      ...graph.edges,
      ...graph.entityTypes,
      ...graph.edgeTypes,
    ].some(v => !v || typeof v !== 'object')
  )
    return ['All graph entries must be objects.'];
  unique(
    graph.nodes.map(n => n.id),
    'Nodes'
  );
  unique(
    graph.edges.map(e => e.id),
    'Edges'
  );
  unique(
    graph.entityTypes.map(t => t.name),
    'Classes'
  );
  unique(
    graph.edgeTypes.map(t => t.predicate),
    'Predicates'
  );
  const types = new Set(graph.entityTypes.map(t => t.name));
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const predicates = new Map(graph.edgeTypes.map(t => [t.predicate, t]));
  for (const t of graph.entityTypes) {
    if (typeof t.definition !== 'string' || !t.definition.trim())
      errors.push(`${t.name}: definition is required.`);
  }
  for (const t of graph.edgeTypes) {
    if (!types.has(t.from) || !types.has(t.to))
      errors.push(`${t.predicate}: endpoint classes must exist.`);
    if (
      ![
        'asserted',
        'derived_only',
        'query_derived_only',
        'derived_or_asserted',
        'asserted_or_derived',
      ].includes(t.storage)
    )
      errors.push(`${t.predicate}: invalid storage policy.`);
    if (!t.group || !t.meaning)
      errors.push(`${t.predicate}: group and meaning required.`);
    if (
      derivedPredicates.includes(t.predicate) &&
      !['derived_only', 'query_derived_only'].includes(t.storage)
    )
      errors.push(
        `${t.predicate}: canonical derived predicate cannot be stored.`
      );
  }
  const validateMetadata = (item: GraphNode | GraphEdge) => {
    if (
      item.verification_status &&
      !verificationStates.includes(String(item.verification_status))
    )
      errors.push(`${item.id}: invalid verification status.`);
    if (
      item.evidence_ids !== undefined &&
      (!Array.isArray(item.evidence_ids) ||
        item.evidence_ids.some(
          id => nodes.get(String(id))?.type !== 'Evidence'
        ))
    )
      errors.push(`${item.id}: evidence_ids must refer to Evidence nodes.`);
    for (const key of ['url', 'website']) {
      if (
        item[key] &&
        (typeof item[key] !== 'string' ||
          !/^https?:\/\//i.test(String(item[key])))
      )
        errors.push(`${item.id}: ${key} must use HTTP(S).`);
    }
    for (const key of [
      'valid_from',
      'valid_to',
      'source_published_at',
      'last_verified_at',
    ]) {
      if (item[key] && Number.isNaN(Date.parse(String(item[key]))))
        errors.push(`${item.id}: invalid date for ${key}.`);
    }
    if (
      item.valid_from &&
      item.valid_to &&
      String(item.valid_from) > String(item.valid_to)
    )
      errors.push(`${item.id}: valid_to precedes valid_from.`);
  };
  for (const n of graph.nodes) {
    if (!types.has(n.type)) errors.push(`${n.id}: unknown entity class.`);
    if (['__proto__', 'constructor', 'prototype'].includes(n.id))
      errors.push(
        'Reserved node ID. Use a namespaced ID such as company:example.'
      );
    if (typeof n.name !== 'string' || !n.name.trim())
      errors.push(`${n.id}: name is required.`);
    validateMetadata(n);
  }
  for (const e of graph.edges) {
    const p = predicates.get(e.predicate);
    if (!p) errors.push(`${e.id}: unknown predicate.`);
    else {
      if (
        p.storage === 'derived_only' ||
        p.storage === 'query_derived_only' ||
        derivedPredicates.includes(e.predicate)
      )
        errors.push(
          `${e.id}: derived predicates cannot be saved as base edges.`
        );
      if (nodes.get(e.from)?.type !== p.from || nodes.get(e.to)?.type !== p.to)
        errors.push(`${e.id}: endpoints must be ${p.from} → ${p.to}.`);
    }
    if (e.from === e.to) errors.push(`${e.id}: self-links are not supported.`);
    validateMetadata(e);
  }
  return errors.slice(0, 20);
}

export function qualityIssues(graph: Graph): string[] {
  const issues: string[] = [];
  const links = (id: string, predicate: string) =>
    graph.edges
      .filter(e => e.from === id && e.predicate === predicate)
      .map(e => e.to);
  for (const node of graph.nodes.filter(n => recordTypes.includes(n.type))) {
    let complete = true;
    if (node.type === 'SupplyRelationship')
      complete =
        links(node.id, 'HAS_SUPPLIER').length === 1 &&
        links(node.id, 'HAS_BUYER').length === 1 &&
        links(node.id, 'FOR_SUPPLIED_PRODUCT').length >= 1;
    if (node.type === 'CustomerOpportunity')
      complete =
        links(node.id, 'PROSPECTIVE_SELLER').length === 1 &&
        links(node.id, 'TARGET_CUSTOMER').length === 1 &&
        links(node.id, 'PROPOSED_PRODUCT').length >= 1;
    if (node.type === 'Collaboration')
      complete = new Set(links(node.id, 'HAS_PARTICIPANT')).size >= 2;
    if (node.type === 'CompetitionAssessment') {
      const a = links(node.id, 'OFFERING_A');
      const b = links(node.id, 'OFFERING_B');
      complete =
        a.length === 1 &&
        b.length === 1 &&
        a[0] !== b[0] &&
        links(node.id, 'COMPETES_IN_SEGMENT').length === 1 &&
        ['DIRECT', 'INDIRECT'].includes(String(node.competition_type)) &&
        Array.isArray(node.basis) &&
        node.basis.length > 0;
    }
    if (!complete)
      issues.push(
        `${node.name}: incomplete relationship record; treated as draft, excluded from projections.`
      );
    if (!node.verification_status)
      issues.push(
        `${node.name}: no verification status; not a confirmed claim.`
      );
  }
  return issues;
}
