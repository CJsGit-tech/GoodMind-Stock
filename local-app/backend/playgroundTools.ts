import { searchEntities } from '../components/questionQuery';
import { z } from 'zod';
import type { Graph, GraphNode, GraphEdge } from '../shared/model';
import { localizedName } from '../components/locale-core';
import { withCompetitionProjections } from '../components/competitionProjections';

type Locale = 'zh-TW' | 'en';
const pair = (zh: string, en: string) => ({ 'zh-TW': zh, en });
export const catalog = [
  { name: 'search_entities', label: pair('搜尋實體', 'Search entities'), description: pair('依名稱、別名或類型搜尋圖譜，最多傳回 20 筆。', 'Search graph names, aliases, or types; returns at most 20 entities.') },
  { name: 'get_entity', label: pair('查看實體', 'Inspect entity'), description: pair('取得指定實體的基本資料、驗證狀態與來源證據。', 'Read one entity’s curated attributes, verification status, and evidence.') },
  { name: 'get_relations', label: pair('查詢關係', 'Find relations'), description: pair('查詢實體的關係與競爭推論，保留方向、驗證狀態與依據。', 'Read relationships including assessment-derived competition, direction, verification, and provenance.') },
  { name: 'find_path', label: pair('尋找連結路徑', 'Find connection path'), description: pair('沿雙向連接尋找最多三層的最短路徑，並保留每條關係的原始方向。', 'Find a shortest connection path up to three hops, traversing either direction while preserving original edge direction.') },
  { name: 'graph_summary', label: pair('圖譜概覽', 'Graph summary'), description: pair('讀取實體與關係數量、類型分布，不傳回完整圖譜。', 'Read entity and relation counts and type distributions without returning the full graph.') },
];
const text = (v: unknown, size = 500): string => typeof v === 'string' ? v.slice(0, size) : '';
const strings = (v: unknown, limit = 8): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, limit).map(s => text(s)) : [];
const allowed = ['description', 'summary', 'ticker', 'exchange', 'country', 'website', 'url', 'source_url', 'publisher', 'published_at', 'source_published_at', 'last_verified_at', 'reverified_for_package', 'as_of', 'status', 'verification_status', 'competition_type', 'collaboration_type', 'commercial_competition_verified', 'basis', 'notes'] as const;
function curated(record: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = record[key];
    if (typeof value === 'string') out[key] = text(value);
    else if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = strings(value);
  }
  return out;
}
const identifier = z.string().min(1).max(240);
const take = z.number().int().min(1).max(20);
export function createGraphQueries(source: Graph, locale: Locale) {
  // Operates exclusively on this immutable snapshot; never database or network access.
  const graph = withCompetitionProjections(source);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = graph.edges.filter(e => nodes.has(e.from) && nodes.has(e.to));
  const name = (n: GraphNode) => text(localizedName(n, locale), 200);
  const basic = (n: GraphNode) => ({ id: text(n.id, 240), name: name(n), type: text(n.type, 120) });
  const evidenceWarning = (record: Record<string, unknown>) => record.reverified_for_package === true ? {} : { evidenceWarning: locale === 'zh-TW' ? '此來源未確認經過重新驗證；不可視為目前已查證的事實。' : 'This source has not been confirmed as reverified; do not treat it as currently verified fact.' };
  const evidence = (record: Record<string, unknown>) => strings(record.evidence_ids, 5).map(id => nodes.get(id)).filter((n): n is GraphNode => !!n && n.type === 'Evidence').map(n => ({ ...basic(n), ...curated(n), ...evidenceWarning(n) }));
  const edge = (e: GraphEdge) => ({ id: text(e.id, 1000), relation: text(e.predicate, 120), from: basic(nodes.get(e.from)!), to: basic(nodes.get(e.to)!), verification: text(e.verification_status || 'unverified', 100), derived: e.derived === true, symmetric: e.symmetric === true, ...(e.derived === true ? { assessmentId: text(e.assessment_id, 240), marketSegmentId: text(e.market_segment_id, 240), derivation: 'Assessment-scoped projection, not independently verified competition.' } : {}), evidence: evidence(e) });
  const result = (data: unknown, count: number) => ({ data, count, summary: locale === 'zh-TW' ? `已讀取 ${count} 筆結果` : `Read ${count} result${count === 1 ? '' : 's'}` });
  function definition(index: number, parameters: z.ZodObject<any>, execute: (input: any) => ReturnType<typeof result>) {
    return { ...catalog[index], parameters, execute: (input: unknown) => execute(parameters.parse(input)) };
  }
  return [
    definition(0, z.object({ query: z.string().max(200), type: z.string().max(120).nullable(), limit: take }), ({query, type, limit}) => {
      const matches = searchEntities(graph, query, { type, limit });
      return result({ entities: matches.entities.map(basic), totalMatches: matches.totalMatches, truncated: matches.totalMatches > limit }, matches.entities.length);
    }),
    definition(1, z.object({ entityId: identifier }), ({entityId}) => {
      const n = nodes.get(entityId);
      return result(n ? { ...basic(n), attributes: curated(n), ...(n.type === 'Evidence' ? evidenceWarning(n) : {}), evidence: evidence(n) } : { found: false }, n ? 1 : 0);
    }),
    definition(2, z.object({ entityId: identifier, predicate: z.string().max(120).nullable(), direction: z.enum(['incoming','outgoing','both']), limit: take }), ({entityId, predicate, direction, limit}) => {
      const matches = edges.filter(e => (!predicate || e.predicate === predicate) && ((direction !== 'incoming' && e.from === entityId) || (direction !== 'outgoing' && e.to === entityId) || (e.symmetric === true && (e.from === entityId || e.to === entityId))));
      return result({ relations: matches.slice(0, limit).map(edge), totalMatches: matches.length, truncated: matches.length > limit }, Math.min(matches.length, limit));
    }),
    definition(3, z.object({ from: identifier, to: identifier, maxDepth: z.number().int().min(1).max(3) }), ({from, to, maxDepth}) => {
      if (!nodes.has(from) || !nodes.has(to)) return result({ found: false, reason: 'Unknown endpoint' }, 0);
      if (from === to) return result({ found: true, entities: [basic(nodes.get(from)!)], relations: [], traversal: 'Either direction' }, 1);
      const queue: { id: string; path: GraphEdge[]; ids: string[] }[] = [{id: from, path: [], ids: [from]}];
      const seen = new Set<string>([from]);
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor];
        if (current.path.length >= maxDepth) continue;
        for (const relation of edges) {
          if (relation.from !== current.id && relation.to !== current.id) continue;
          const next = relation.from === current.id ? relation.to : relation.from;
          if (seen.has(next)) continue;
          seen.add(next);
          const path = [...current.path, relation], ids = [...current.ids, next];
          if (next === to) return result({ found: true, entities: ids.map(id => basic(nodes.get(id)!)), relations: path.map(edge), traversal: 'Either direction; relations preserve original from/to' }, path.length);
          queue.push({id: next, path, ids});
        }
      }
      return result({found: false, maxDepth, reason: 'No connection found within requested depth; this does not prove no relationship exists.'}, 0);
    }),
    definition(4, z.object({}), () => {
      const counts = (values: string[]) => Array.from(values.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map<string,number>())).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([name,count])=>({name:text(name,120),count}));
      return result({ entities: graph.nodes.length, relations: edges.length, derivedRelations: edges.filter(e=>e.derived === true).length, entityTypes: counts(graph.nodes.map(n=>n.type)), relationTypes: counts(edges.map(e=>e.predicate)), note: 'Counts reflect recorded and assessment-derived relationships, not proof of completeness or truth.' }, 1);
    }),
  ];
}
