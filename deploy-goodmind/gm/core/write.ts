// The single write entry (V4 "唯一寫入口"). Every new node or edge — typed by hand, accepted from a
// suggestion, or extracted by AI — goes through applyWrites(). A batch is all-or-nothing: if any check
// fails nothing is written and every reason is returned (in Chinese).
// Checks: type / relation exists · abstract types · Chinese name rule · snake_case attribute keys ·
// required attributes and datatypes · identity (alias / ticker de-duplication) · endpoint types ·
// computed or AI-suggested relations cannot be stored · self-loops · duplicates · cardinality · evidence.
import { hashHex, randomId } from './hash';
import type { Attrs, Graph, GraphEdge, GraphNode } from './types';
import { at, atList, isAny, WRITABLE_STORAGE } from './types';
import type { Rule } from './ontology';
import { attributeIssues, hasCjk } from './validate';

export type WriteOp =
  | { op: 'createNode'; node: { id?: string; type: string; name: string; attributes?: Attrs } }
  | { op: 'createEdge'; edge: { predicate: string; from: string; to: string; attributes?: Attrs } }
  | { op: 'updateNode'; id: string; name?: string; attributes?: Attrs };
export type WriteResult = { ok: true; graph: Graph; created: string[]; updated: string[] } | { ok: false; errors: string[] };

const norm = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s・·.,()（）-]+/g, '');
const slug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const PREFIX: Record<string, string> = { Company: 'company', Product: 'product', Service: 'service', BusinessLine: 'business_line', MarketSegment: 'segment', ProductCategory: 'category', CompetitionAssessment: 'competition', SupplyRelationship: 'supply', CustomerOpportunity: 'opportunity', Collaboration: 'collaboration', TopicMention: 'mention' };
const prefixOf = (type: string) => PREFIX[type] ?? type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
/** Types whose identity is resolved through names, aliases and tickers. */
const RESOLVED = new Set(['Company', 'ETF', 'CorporateGroup', 'Industry', 'MarketSegment', 'ProductCategory', 'Technology', 'Application', 'Topic', 'ValueChainStage', 'Capability', 'EndMarket']);
const NAME_EXEMPT = new Set(['Evidence', 'Product', 'Service', 'Claim', 'TopicMention']);   // model numbers and source titles keep their original text
export const factId = (predicate: string, from: string, to: string) => `fact:${hashHex(`${predicate}|${from}|${to}`).slice(0, 12)}`;

/** Every name a node answers to: name, name_en, aliases, ticker (normalized). */
export function namesOf(n: GraphNode): string[] {
  return [n.name, at(n, 'name_en'), ...atList(n, 'aliases'), at(n, 'ticker')].filter(Boolean).map(norm).filter(s => s.length > 1);
}
/** Identity resolution: a string (Chinese name, English name, alias, ticker or id) → canonical node ids. */
export function resolve(g: Graph, q: string, type?: string): GraphNode[] {
  const k = norm(q);
  return g.nodes.filter(n => (!type || n.type === type) && (n.id === q || (at(n, 'legacy_ids') as string[] | undefined)?.includes(q) || namesOf(n).includes(k)));
}

export function applyWrites(input: Graph, ops: WriteOp[], source = 'manual'): WriteResult {
  const g: Graph = { ...input, nodes: [...input.nodes], edges: [...input.edges] };
  const errors: string[] = [], created: string[] = [], updated: string[] = [];
  const types = new Map(g.entityTypes.map(t => [t.name, t])), preds = new Map(g.edgeTypes.map(p => [p.predicate, p]));
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const rules = (Array.isArray(g.rules) ? g.rules : []) as Rule[];
  const today = new Date().toISOString().slice(0, 10);

  ops.forEach((o, i) => {
    const fail = (m: string) => errors.push(`#${i + 1} ${m}`);
    if (o.op === 'createNode') {
      const { type, name } = o.node, attributes: Attrs = { ...(o.node.attributes ?? {}) };
      const t = types.get(type);
      if (!t) return fail(`沒有「${type}」這種節點類型`);
      if (t.abstract) return fail(`「${t.label}」是抽象類型，請改用它的子類型`);
      if (!name?.trim()) return fail(`${t.label}需要名稱`);
      if (!hasCjk(name) && !NAME_EXEMPT.has(type) && attributes.name_zh_missing !== true && attributes.name_is_zh_usage !== true) return fail(`名稱「${name}」不是中文：name 一律寫中文，英文放 attributes.name_en；真的沒有中文名請加 name_zh_missing: true`);
      const id = o.node.id ?? `${prefixOf(type)}:${slug(String(attributes.name_en ?? '')) || randomId()}`;
      if (byId.has(id)) return fail(`id ${id} 已存在`);
      const node: GraphNode = { id, type, name: name.trim(), attributes: { recorded_at: today, ...attributes, curation: attributes.curation ?? { method: source, at: today } } };
      if (RESOLVED.has(type)) {
        const mine = new Set(namesOf(node));
        const dup = g.nodes.find(n => n.type === type && namesOf(n).some(x => mine.has(x)));
        if (dup) return fail(`「${name}」已存在：${dup.name}（${dup.id}）。請改用它，或把新叫法加進它的 aliases`);
      }
      for (const x of attributeIssues(node, t.properties, t.label)) if (x.level === 'error') fail(x.message);
      for (const ev of atList(node, 'evidence_ids')) if (byId.get(ev)?.type !== 'Evidence') fail(`evidence_ids → ${ev} 不是證據節點`);
      if (rules.some(r => r.kind === 'evidence_required' && r.classes.includes(type)) && !atList(node, 'evidence_ids').length) fail(`${t.label}至少要引用 1 筆證據（evidence_ids）`);
      g.nodes.push(node); byId.set(id, node); created.push(id);
      return;
    }
    if (o.op === 'updateNode') {
      const n = byId.get(o.id);
      if (!n) return fail(`找不到節點 ${o.id}`);
      const t = types.get(n.type)!;
      const attributes = { ...n.attributes };
      for (const [k, v] of Object.entries(o.attributes ?? {})) { if (v === null) delete attributes[k]; else attributes[k] = v; }
      const next: GraphNode = { ...n, name: o.name?.trim() || n.name, attributes };
      if (!hasCjk(next.name) && !NAME_EXEMPT.has(n.type) && attributes.name_zh_missing !== true && attributes.name_is_zh_usage !== true) return fail(`名稱「${next.name}」不是中文`);
      for (const x of attributeIssues(next, t.properties, t.label)) if (x.level === 'error') fail(x.message);
      g.nodes[g.nodes.indexOf(n)] = next; byId.set(n.id, next); updated.push(n.id);
      return;
    }
    const { predicate, from, to } = o.edge, attributes: Attrs = { ...(o.edge.attributes ?? {}) };
    const p = preds.get(predicate);
    if (!p) return fail(`沒有「${predicate}」這種關係`);
    if (!WRITABLE_STORAGE.has(p.storage)) return fail(p.storage === 'suggested_only' ? `「${p.label}」是 AI 建議，只能接受或拒絕，不能直接建立` : `「${p.label}」是系統算出的，不能手動建立；請改建立對應的紀錄（競爭評估、供應紀錄或合作紀錄）`);
    const a = byId.get(from), b = byId.get(to);
    if (!a || !b) return fail(`「${p.label}」的端點不存在：${!a ? from : to}`);
    if (from === to) return fail(`「${p.label}」不能連到自己`);
    const tl = (k: string) => types.get(k)?.label ?? k;
    if (!isAny(g.entityTypes, a.type, p.from) || !isAny(g.entityTypes, b.type, p.to))
      return fail(`方向或類型錯誤：「${p.label}」只能 ${p.from.map(tl).join('／')} → ${p.to.map(tl).join('／')}，這裡是 ${tl(a.type)} → ${tl(b.type)}`);
    if (g.edges.some(e => e.predicate === predicate && e.from === from && e.to === to)) return fail(`已經有「${a.name} ${p.label} ${b.name}」`);
    for (const r of rules) {
      if (r.kind === 'cardinality' && r.predicate === predicate && r.max !== undefined && a.type === r.class) {
        const c = new Set(g.edges.filter(e => e.from === from && e.predicate === predicate).map(e => e.to)).size;
        if (c + 1 > r.max) fail(`超過上限：${r.description}`);
      }
      if (r.kind === 'distinct_targets' && r.predicates.includes(predicate) && a.type === r.class && g.edges.some(e => e.from === from && r.predicates.includes(e.predicate) && e.predicate !== predicate && e.to === to)) fail(r.description);
    }
    const edge: GraphEdge = { id: factId(predicate, from, to), predicate, from, to, attributes: { recorded_at: today, ...attributes } };
    for (const x of attributeIssues(edge, p.properties, p.label)) if (x.level === 'error') fail(x.message);
    if (p.evidenceRequired && !atList(edge, 'evidence_ids').length) fail(`「${p.label}」需要證據（evidence_ids）`);
    for (const ev of atList(edge, 'evidence_ids')) if (byId.get(ev)?.type !== 'Evidence') fail(`evidence_ids → ${ev} 不是證據節點`);
    g.edges.push(edge); created.push(edge.id);
  });

  // Minimum cardinality for records created in this batch (e.g. a collaboration needs 2 participants).
  for (const id of created) {
    const n = byId.get(id); if (!n) continue;
    for (const r of rules) if (r.kind === 'cardinality' && r.class === n.type) {
      const c = new Set(g.edges.filter(e => e.from === id && e.predicate === r.predicate).map(e => e.to)).size;
      if (c < r.min) errors.push(`${n.name}：${r.description}（目前 ${c} 條）`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, graph: g, created, updated };
}
