import { relationshipStatusOrder, relationshipStatusMatches, weakestRelationshipStatus } from './relationshipProof';
import type { EdgeRecord, Graph, NodeRecord } from './types';

export type ResearchIntent = 'competition' | 'supply' | 'customers' | 'opportunities' | 'cooperation' | 'group';
export type ResearchQuery = {
  industry: string;
  market: string;
  intent: ResearchIntent | '';
  company: string;
  category: string;
  product: string;
  proof: 'all' | 'official' | 'inferred';
  depth: 1 | 2 | 3;
  direction?: 'upstream' | 'downstream';
  counterparty?: string;
  verifiedDelivery?: boolean;
};

export const emptyResearchQuery: ResearchQuery = {
  industry: '', market: '', intent: '', company: '', category: '', product: '', proof: 'all', depth: 1,
};

export type ResearchRow = {
  id: string;
  subject: NodeRecord;
  object: NodeRecord;
  edge: EdgeRecord;
  sources: NodeRecord[];
  market?: NodeRecord;
  context?: NodeRecord[];
  status: string;
  record?: NodeRecord;
  scopeReasons?: Array<{company:NodeRecord; industry:NodeRecord; predicate:'OPERATES_IN'|'SERVES_INDUSTRY'}>;
};
export type ResearchResult = {
  query: ResearchQuery;
  rows: ResearchRow[];
  edges: EdgeRecord[];
  nodes: NodeRecord[];
  total: number;
  omitted: number;
  rootId: string;
};
export type ResearchOptions = {
  industries: NodeRecord[];
  standaloneMarkets: NodeRecord[];
  markets: NodeRecord[];
  intents: ResearchIntent[];
  companies: NodeRecord[];
  categories: NodeRecord[];
  products: NodeRecord[];
};

const intents: ResearchIntent[] = ['competition', 'supply', 'customers', 'opportunities', 'cooperation', 'group'];
const ownerPredicates = new Set(['SELLS', 'BRANDS', 'MANUFACTURES', 'DESIGNS', 'DISTRIBUTES']);
const competing = new Set(['DIRECT_COMPETITOR_OF', 'INDIRECT_COMPETITOR_OF', 'DIRECTLY_COMPETES_WITH', 'INDIRECTLY_COMPETES_WITH']);
const corporate = new Set(['MEMBER_OF_GROUP', 'HAS_ORG_UNIT', 'SUBUNIT_OF', 'OWNS_STAKE_IN', 'CONTROLS', 'IS_SUBSIDIARY_OF']);
const statuses: readonly string[] = relationshipStatusOrder;
const array = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const value = (v: unknown) => typeof v === 'string' ? v : '';
const ids = (e: EdgeRecord) => [e.from, e.to];
const intersects = (a: readonly string[], b: Set<string>) => a.some(id => b.has(id));
const distribute = (items: EdgeRecord[], select: (e: EdgeRecord) => string) => {
  const map = new Map<string, EdgeRecord[]>();
  for (const item of items) {
    const key = select(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item); else map.set(key, [item]);
  }
  return (key: string) => map.get(key) || [];
};

type Statement = {
  edge: EdgeRecord;
  subject: string;
  object: string;
  roles: ResearchIntent[];
  companies: string[];
  products: string[];
  markets: string[];
  applications: string[];
  links: EdgeRecord[];
  records: NodeRecord[];
  status: string;
};

function createIndex(graph: Graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = graph.edges.filter(e => nodes.has(e.from) && nodes.has(e.to) &&
    e.verification_status !== 'rejected' &&
    nodes.get(e.from)?.verification_status !== 'rejected' && nodes.get(e.to)?.verification_status !== 'rejected');
  const byId = new Map(edges.map(e => [e.id, e]));
  const from = distribute(edges, e => e.from);
  const to = distribute(edges, e => e.to);
  const relevant = (node: string, predicates: string[]) => from(node).filter(e => predicates.includes(e.predicate));
  function descendants(root: string, predicate: string) {
    const found = new Set([root]), queue = [root];
    for (let i = 0; i < queue.length; i++) {
      for (const e of to(queue[i])) {
        if (e.predicate !== predicate || found.has(e.from)) continue;
        found.add(e.from); queue.push(e.from);
      }
    }
    return found;
  }
  const byType = (list: string[], type: string) => [...new Set(list)].filter(id => nodes.get(id)?.type === type);
  const list = new Map<string, Statement>();
  const companyCompetitionByAssessment = new Set(edges.filter(e =>
    e.derived === true && ['DIRECT_COMPETITOR_OF', 'INDIRECT_COMPETITOR_OF'].includes(e.predicate)).map(e => value(e.assessment_id)));
  const structuredSupplyPairs = new Set<string>();
  for (const n of graph.nodes.filter(node => node.type === 'SupplyRelationship')) {
    const supplies = relevant(n.id, ['HAS_SUPPLIER']);
    const purchases = relevant(n.id, ['HAS_BUYER']);
    for (const supply of supplies) for (const buyer of purchases) structuredSupplyPairs.add(JSON.stringify([supply.to, buyer.to]));
  }
  for (const e of edges) {
    const root = nodes.get(e.from)!;
    let roles: ResearchIntent[] = [];
    let links = [e], records: NodeRecord[] = [];
    let subject = e.from, object = e.to;
    if (competing.has(e.predicate) && e.derived === true) {
      roles = ['competition'];
      links = [...links, ...array(e.supporting_edge_ids).map(id => byId.get(id)).filter((x): x is EdgeRecord => !!x)];
      const assessment = nodes.get(value(e.assessment_id));
      if (assessment) records.push(assessment);
    } else if (e.predicate === 'HAS_SUPPLIER' && root.type === 'SupplyRelationship') {
      const buyers = relevant(root.id, ['HAS_BUYER']);
      if (buyers.length !== 1) continue;
      roles = ['supply', 'customers']; subject = e.to; object = buyers[0].to;
      links = [...links, ...buyers, ...relevant(root.id, ['FOR_SUPPLIED_PRODUCT'])]; records = [root];
    } else if (e.predicate === 'SUPPLIES_TO' || e.predicate === 'INDIRECT_SUPPLIER_OF') {
      if (e.predicate === 'SUPPLIES_TO' && structuredSupplyPairs.has(JSON.stringify(ids(e)))) continue;
      roles = e.predicate === 'SUPPLIES_TO' ? ['supply', 'customers'] : ['supply'];
    } else if (e.predicate === 'PROSPECTIVE_SELLER' && root.type === 'CustomerOpportunity') {
      const buyers = relevant(root.id, ['TARGET_CUSTOMER']);
      if (buyers.length !== 1) continue;
      roles = ['opportunities']; subject = e.to; object = buyers[0].to;
      links = [...links, ...buyers, ...relevant(root.id, ['PROPOSED_PRODUCT', 'TARGET_APPLICATION'])]; records = [root];
    } else if (e.predicate === 'HAS_PARTICIPANT' && root.type === 'Collaboration') {
      // One result per joint event; the existing event and each source edge remain intact.
      links = relevant(root.id, ['HAS_PARTICIPANT', 'FOCUSES_ON_PRODUCT', 'FOCUSES_ON_TECHNOLOGY', 'TARGETS_MARKET']);
      if (links.find(edge => edge.predicate === 'HAS_PARTICIPANT')?.id !== e.id) continue;
      roles = ['cooperation']; records = [root];
    } else if (e.predicate === 'COLLABORATES_WITH') roles = ['cooperation'];
    else if (corporate.has(e.predicate)) roles = ['group'];
    if (!roles.length) continue;
    const all = links.flatMap(ids);
    const products = byType([...all, ...array(e.product_ids)], 'Product');
    const companies = byType([...all, ...products.flatMap(id => to(id).filter(l => ownerPredicates.has(l.predicate)).map(l => l.from))], 'Company');
    const required = [e, ...links.filter(l => l.id !== e.id &&
      ['HAS_BUYER', 'TARGET_CUSTOMER', 'HAS_PARTICIPANT'].includes(l.predicate))];
    const requiredIds = new Set(required.map(l => l.id));
    const status = weakestRelationshipStatus(
      required.map(l => l.verification_status),
      [...records, ...links.filter(l => !requiredIds.has(l.id))].map(record => record.verification_status),
    );
    list.set(e.id, {
      edge: e, subject, object, roles, companies, products,
      markets: byType([...all, value(e.market_segment_id)], 'MarketSegment'),
      applications: byType(all, 'Application'), links, records,
      status,
    });
  }
  const statements = [...list.values()];
  function matchesIntent(s: Statement, q: ResearchQuery) {
    if (q.intent && !s.roles.includes(q.intent)) return false;
    if ((q.intent === 'customers' || q.direction === 'downstream') && q.company && s.subject !== q.company) return false;
    if (q.direction === 'upstream' && q.company && s.object !== q.company) return false;
    if (q.counterparty && ![s.subject, s.object, ...s.links.flatMap(ids)].includes(q.counterparty)) return false;
    if (q.verifiedDelivery && !(s.roles.includes('customers') && s.status === 'officially_disclosed' &&
        s.records.some(record => record.commercial_stage === 'delivered' ||
          // Public snapshot's exact recorded UMC/SILITH delivery links a dated issuer announcement.
          (record.id === 'entity:311106cd-5572-44ef-b017-39bbad30ad78' &&
            s.subject === 'entity:b1236908-e801-4cae-89ea-acd8d514c7d0' &&
            s.object === 'entity:ce7fd3da-64d8-4d32-a97d-367e5eee1c8c' &&
            array(record.evidence_ids).some(id => nodes.get(id)?.url === 'https://www.umc.com/en/News/press_release/Content/technology_related/20260714'))))) return false;
    if (q.intent === 'competition' && s.edge.derived === true) {
      const productView = nodes.get(s.subject)?.type === 'Product';
      if (q.product && !productView) return false;
      if (!q.product && productView && companyCompetitionByAssessment.has(value(s.edge.assessment_id))) return false;
    }
    return true;
  }
  const industries = graph.nodes.filter(n => n.type === 'Industry');
  const markets = graph.nodes.filter(n => n.type === 'MarketSegment');
  function bound(industry: string, market = '') {
    if (industry === '*') return market ? [] : statements;
    if (!['Industry', 'MarketSegment'].includes(nodes.get(industry)?.type || '')) return [];
    const standalone = nodes.get(industry)?.type === 'MarketSegment';
    const includes = descendants(industry, 'SUBINDUSTRY_OF');
    if (nodes.get(market)?.type === 'Industry') {
      if (!includes.has(market)) return [];
      return bound(market);
    }
    const scopedMarkets = new Set(standalone ? [industry] : edges.filter(e => e.predicate === 'SEGMENT_OF_INDUSTRY' && includes.has(e.to)).map(e => e.from));
    if (market && !scopedMarkets.has(market)) return [];
    const companies = new Set(edges.filter(e => ['OPERATES_IN', 'SERVES_INDUSTRY'].includes(e.predicate) && includes.has(e.to)).map(e => e.from));
    const apps = new Set(edges.filter(e => e.predicate === 'APPLICATION_IN_INDUSTRY' && includes.has(e.to)).map(e => e.from));
    const marketSet = market ? new Set([market]) : scopedMarkets;
    const segmentProducts = new Set(edges.filter(e => e.predicate === 'TARGETS_SEGMENT' && marketSet.has(e.to)).map(e => e.from));
    // Accepted assessment offering links support market discovery for the same products;
    // they do not assert this market as a collaboration or supply record's own scope.
    for (const assessment of statements) if (assessment.roles.includes('competition') && intersects(assessment.markets, marketSet)) {
      for (const product of assessment.products) segmentProducts.add(product);
    }
    return statements.filter(s => {
      // An explicit assessment/event market takes precedence over broad company context.
      if (s.markets.length) return intersects(s.markets, marketSet);
      if (market || standalone) return intersects(s.products, segmentProducts);
      return intersects(s.companies, companies) || intersects(s.products, segmentProducts) || intersects(s.applications, apps);
    });
  }
  const sorted = (input: NodeRecord[]) => [...input].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const uniqueNodes = (values: string[]) => sorted([...new Set(values)].map(id => nodes.get(id)).filter((n): n is NodeRecord => !!n));
  const categoriesFor = (product: string) => new Set(relevant(product, ['IN_CATEGORY']).flatMap(e => {
    const cats = new Set([e.to]), queue = [e.to];
    for (let i = 0; i < queue.length; i++) for (const parent of relevant(queue[i], ['SUBCATEGORY_OF'])) {
      if (!cats.has(parent.to)) { cats.add(parent.to); queue.push(parent.to); }
    }
    return [...cats];
  }));
  function getOptions(q: ResearchQuery): ResearchOptions {
    const scoped = q.industry ? bound(q.industry, q.market) : [];
    const matching = scoped.filter(s => matchesIntent(s, { ...q, company: '', product: '' }));
    const companies = uniqueNodes(matching.flatMap(s => q.intent === 'customers' ? [s.subject] : s.companies));
    const companyRows = matching.filter(s => matchesIntent(s, { ...q, product: '' }) && (!q.company || s.companies.includes(q.company)));
    const categories = uniqueNodes(companyRows.flatMap(s => s.products.flatMap(p => [...categoriesFor(p)])));
    const productIds = companyRows.flatMap(s => s.products).filter(p => !q.category || categoriesFor(p).has(q.category));
    return {
      industries: sorted(industries.filter(n => bound(n.id).length > 0)),
      standaloneMarkets: sorted(markets.filter(n =>
        !from(n.id).some(e => e.predicate === 'SEGMENT_OF_INDUSTRY') && bound(n.id).length > 0)),
      markets: nodes.get(q.industry)?.type === 'Industry' ? sorted([...industries.filter(n => n.id !== q.industry), ...markets].filter(n => bound(q.industry, n.id).length > 0)) : [],
      intents: intents.filter(i => scoped.some(s => s.roles.includes(i))),
      companies, categories, products: uniqueNodes(productIds),
    };
  }
  function scopeReasons(q: ResearchQuery, companies: string[]): ResearchRow['scopeReasons'] {
    const scopeId = q.market || q.industry;
    if (nodes.get(scopeId)?.type !== 'Industry') return [];
    const taxonomy = descendants(scopeId, 'SUBINDUSTRY_OF');
    return edges.filter(e => companies.includes(e.from) && taxonomy.has(e.to) &&
      (e.predicate === 'OPERATES_IN' || e.predicate === 'SERVES_INDUSTRY'))
      .map(e => ({ company: nodes.get(e.from)!, industry: nodes.get(e.to)!, predicate: e.predicate as 'OPERATES_IN'|'SERVES_INDUSTRY' }));
  }
  return { nodes, edges, from, to, bound, getOptions, categoriesFor, matchesIntent, scopeReasons };
}

const indexes = new WeakMap<Graph, ReturnType<typeof createIndex>>();
const indexFor = (graph: Graph) => {
  const existing = indexes.get(graph);
  if (existing) return existing;
  const created = createIndex(graph);
  indexes.set(graph, created);
  return created;
};
export function researchOptions(graph: Graph, query: ResearchQuery) {
  return indexFor(graph).getOptions(query);
}

export function computeResearch(graph: Graph, query: ResearchQuery, focusId = '', focusEdgeId = ''): ResearchResult {
  const index = indexFor(graph);
  const { nodes } = index;
  const selected = query.industry && query.intent ? index.bound(query.industry, query.market).filter(s =>
    index.matchesIntent(s, query) &&
    (!query.company || s.companies.includes(query.company)) &&
    (!query.product || s.products.includes(query.product)) &&
    (!query.category || s.products.some(p => (!query.product || p === query.product) && index.categoriesFor(p).has(query.category))) &&
    (query.proof === 'all' || (query.proof === 'official' ? relationshipStatusMatches({ verification_status: s.status }, 'officially_disclosed') : ['analyst_inferred', 'hypothesis', 'disputed'].includes(s.status)))
  ) : [];
  selected.sort((a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status) || a.edge.id.localeCompare(b.edge.id));
  const visibleEdges = new Map<string, EdgeRecord>(), visibleNodes = new Map<string, NodeRecord>();
  const rows: ResearchRow[] = [];
  const allKnown = selected.flatMap(s => s.links.flatMap(ids));
  const rootId = [focusId, query.company, query.product].find(id => id && allKnown.includes(id)) || '';
  const ordered = rootId || focusEdgeId ? [...selected].sort((a, b) =>
    Number(b.edge.id === focusEdgeId) - Number(a.edge.id === focusEdgeId) ||
    Number(b.links.some(e => ids(e).includes(rootId))) - Number(a.links.some(e => ids(e).includes(rootId)))) : selected;
  function add(edgeList: EdgeRecord[]) {
    for (const e of edgeList) {
      visibleEdges.set(e.id, e);
      for (const id of ids(e)) visibleNodes.set(id, nodes.get(id)!);
    }
  }
  const included = new Set<string>();
  for (const s of ordered) {
    const provenance = [...new Set([...s.records, ...s.links].flatMap(r => array(r.evidence_ids)))].map(id => nodes.get(id)).filter((n): n is NodeRecord => n?.type === 'Evidence');
    const primaryLinks = (s.edge.derived === true ? [s.edge] : s.links).filter(edge => query.proof !== 'official' || relationshipStatusMatches(edge, 'officially_disclosed'));
    const newIds = new Set(primaryLinks.flatMap(ids).filter(id => !visibleNodes.has(id)));
    if (visibleNodes.size + newIds.size <= 50) {
      add(primaryLinks);
      included.add(s.edge.id);
    }
    rows.push({
      id: s.edge.id, subject: nodes.get(s.subject)!, object: nodes.get(s.object)!, edge: s.edge,
      market: nodes.get(s.markets[0]), sources: provenance, status: s.status, record: s.records[0], scopeReasons: index.scopeReasons(query, s.companies),
      context: [...new Set([...s.companies, ...s.products, ...s.records.map(record => record.id)])].filter(id => id !== s.subject && id !== s.object).map(id => nodes.get(id)!),
    });
  }
  // Explicit deeper exploration only adds evidence paths recorded for retained results.
  // It never brings arbitrary neighboring relationships back in by alphabetic order.
  if (query.depth > 1) {
    const supporting = ordered.filter(s => included.has(s.edge.id)).flatMap(s => s.links);
    for (let pass = 1; pass < query.depth; pass++) {
      const current = new Set(visibleNodes.keys());
      for (const e of supporting) {
        if (visibleEdges.has(e.id) || !intersects(ids(e), current) || (query.proof === 'official' && !relationshipStatusMatches(e, 'officially_disclosed'))) continue;
        const newCount = ids(e).filter(id => !visibleNodes.has(id)).length;
        if (visibleNodes.size + newCount <= 50) add([e]);
      }
    }
  }
  return { query, rows, edges: [...visibleEdges.values()], nodes: [...visibleNodes.values()], total: selected.length, omitted: selected.length - included.size, rootId };
}
