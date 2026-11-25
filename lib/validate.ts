// Schema-driven data quality report (v4). Reads the property schemas and rules declared in the ontology
// instead of hard-coding checks. Errors = violations; warnings = curation gaps.
// The same checks run at write time in lib/write.ts, so new data cannot add errors.
import type { Graph, GraphEdge, GraphNode, PropertyDef } from './types';
import { at, atList, isA, isAny } from './types';
import { deriveEdges } from './derive';
import type { Rule } from './ontology';
import { UNSPECIFIED } from './ontology';

export type Issue = { level: 'error' | 'warning'; rule: string; id: string; message: string };
export type QualityReport = { ok: boolean; errors: number; warnings: number; byRule: { rule: string; level: string; count: number; description: string }[]; issues: Issue[] };

const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
export function checkValue(p: PropertyDef, v: unknown): string | null {
  switch (p.datatype) {
    case 'string': case 'text': return typeof v === 'string' ? null : '必須是文字';
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? null : '必須是數字';
    case 'boolean': return typeof v === 'boolean' ? null : '必須是 true/false';
    case 'date': return isDate(v) ? null : '必須是日期（YYYY-MM-DD）';
    case 'url': return typeof v === 'string' && /^https?:\/\//i.test(v) ? null : '必須是 http(s) 網址';
    case 'enum': return p.values?.includes(String(v)) ? null : `必須是 ${p.values?.join('、')} 之一`;
    case 'string[]': return Array.isArray(v) && v.every(x => typeof x === 'string') ? null : '必須是文字陣列';
    case 'ref[]': return Array.isArray(v) ? null : '必須是 id 陣列';
    case 'object': return v && typeof v === 'object' && !Array.isArray(v) ? null : '必須是物件';
    case 'any': return null;
  }
}
export const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
export const KEY_RE = /^[a-z][a-z0-9_]*$/;
export const hasCjk = (s: string) => /[㐀-鿿]/.test(s);

/** Attribute checks shared by the report and the write gate. */
export function attributeIssues(item: GraphNode | GraphEdge, defs: PropertyDef[] | undefined, where: string): { rule: string; message: string; level: Issue['level'] }[] {
  const out: { rule: string; message: string; level: Issue['level'] }[] = [];
  const attrs = item.attributes ?? {};
  const known = new Set(Array.isArray(attrs.needs_review) ? attrs.needs_review.map(String) : []);   // acknowledged gaps → reported as Q-needs-review
  for (const p of defs ?? []) {
    const v = attrs[p.name];
    if (blank(v)) { if (p.required && !known.has(p.name)) out.push({ level: 'error', rule: 'S-required', message: `${where}.${p.name} 必填` }); continue; }
    const bad = checkValue(p, v);
    if (bad) out.push({ level: 'error', rule: 'S-datatype', message: `${where}.${p.name} ${bad}` });
    else if (p.required && v === UNSPECIFIED) out.push({ level: 'warning', rule: 'Q-unspecified', message: `${where}.${p.name} 仍是 unspecified，待整理` });
  }
  for (const k of Object.keys(attrs)) if (!KEY_RE.test(k)) out.push({ level: 'error', rule: 'S-attribute-key', message: `attributes key「${k}」要用 snake_case` });
  return out;
}

export function validateData(g: Graph): QualityReport {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], rule: string, id: string, message: string) => issues.push({ level, rule, id, message });
  const types = new Map(g.entityTypes.map(t => [t.name, t]));
  const preds = new Map(g.edgeTypes.map(p => [p.predicate, p]));
  const nodes = new Map(g.nodes.map(n => [n.id, n]));
  const rules = (Array.isArray(g.rules) ? g.rules : []) as Rule[];

  for (const n of g.nodes) {
    const t = types.get(n.type);
    if (!t) { add('error', 'S-class', n.id, `未知的節點類型 ${n.type}`); continue; }
    if (t.abstract) add('error', 'S-abstract', n.id, `${t.label} 是抽象類型，請改用產品或服務`);
    for (const i of attributeIssues(n, t.properties, t.label)) add(i.level, i.rule, n.id, i.message);
    for (const ev of atList(n, 'evidence_ids')) if (nodes.get(ev)?.type !== 'Evidence') add('error', 'S-evidence-ref', n.id, `evidence_ids → ${ev} 不是證據節點`);
    if (!hasCjk(n.name) && !at(n, 'name_is_zh_usage') && !['Evidence', 'Product', 'Service'].includes(n.type)) add('warning', 'Q-name-zh', n.id, `「${n.name}」沒有中文名稱${at(n, 'name_zh_missing') ? '（已標記 name_zh_missing）' : ''}`);
    const review = atList(n, 'needs_review');
    if (review.length) add('warning', 'Q-needs-review', n.id, `${n.name}：待確認 ${review.join('、')}`);
  }
  const seen = new Set<string>();
  for (const e of g.edges) {
    const p = preds.get(e.predicate);
    if (!p) { add('error', 'S-predicate', e.id, `未知的關係 ${e.predicate}`); continue; }
    if (p.storage === 'derived_only' || p.storage === 'query_derived_only' || p.storage === 'suggested_only') add('error', 'S-derived-stored', e.id, `「${p.label}」是系統算出的，不能存成事實`);
    if (!isAny(g.entityTypes, nodes.get(e.from)?.type, p.from) || !isAny(g.entityTypes, nodes.get(e.to)?.type, p.to)) add('error', 'S-domain-range', e.id, `「${p.label}」只能連 ${p.from.join('/')} → ${p.to.join('/')}`);
    if (e.from === e.to) add('error', 'S-self-loop', e.id, `「${p.label}」不能連到自己`);
    const k = `${e.predicate}|${e.from}|${e.to}`; if (seen.has(k)) add('error', 'S-duplicate', e.id, '重複的關係'); seen.add(k);
    for (const i of attributeIssues(e, p.properties, p.label)) add(i.level, i.rule, e.id, i.message);
    if (p.evidenceRequired && !atList(e, 'evidence_ids').length) {
      if (atList(e, 'needs_review').includes('evidence_ids')) add('warning', 'Q-needs-review', e.id, `「${p.label}」待補證據`);
      else add('error', 'S-edge-evidence', e.id, `「${p.label}」需要證據`);
    }
  }

  const derived = deriveEdges(g);
  const out = (id: string, pred: string) => g.edges.filter(e => e.from === id && e.predicate === pred).map(e => e.to);
  for (const r of rules) {
    if (r.kind === 'cardinality') for (const n of g.nodes.filter(x => x.type === r.class)) {
      const c = new Set(out(n.id, r.predicate)).size;
      if (c < r.min || (r.max !== undefined && c > r.max)) add('error', r.id, n.id, `${r.predicate}：${c} 條，應為 ${r.max === r.min ? r.min : `${r.min}${r.max !== undefined ? `–${r.max}` : '+'}`}`);
    }
    if (r.kind === 'distinct_targets') for (const n of g.nodes.filter(x => x.type === r.class)) {
      const targets = r.predicates.flatMap(p => out(n.id, p));
      if (new Set(targets).size < targets.length) add('error', r.id, n.id, `${r.predicates.join(' 與 ')} 指向同一個節點`);
    }
    if (r.kind === 'coverage') {
      const es = r.includeDerived ? [...g.edges, ...derived] : g.edges;
      for (const n of g.nodes.filter(x => isA(g.entityTypes, x.type, r.class)))
        if (!r.anyOf.some(a => es.some(e => e.predicate === a.predicate && (a.direction === 'out' ? e.from === n.id : e.to === n.id))))
          add('warning', r.id, n.id, `${n.name}：${r.description.replace(/。$/, '')} — 尚未`);
    }
    if (r.kind === 'evidence_required') for (const n of g.nodes.filter(x => r.classes.includes(x.type)))
      if (!atList(n, 'evidence_ids').length) add('error', r.id, n.id, '沒有支持的證據');
  }
  for (const n of g.nodes.filter(x => x.type === 'Evidence')) {
    const status = at(n, 'link_status');
    if (status !== undefined && String(status) !== '200') add('warning', 'Q-unreachable-link', n.id, `來源無法讀取（${String(status)}），請人工確認`);
  }

  const desc = new Map<string, string>([
    ['S-required', '缺少必填欄位'], ['S-datatype', '欄位值不符合宣告的型別'], ['S-class', '未知的節點類型'], ['S-abstract', '使用了抽象類型'],
    ['S-attribute-key', 'attributes key 不是 snake_case'], ['S-predicate', '未知的關係'], ['S-domain-range', '關係兩端的節點類型不合法'],
    ['S-derived-stored', '系統算出的關係被存成事實'], ['S-self-loop', '關係連到自己'], ['S-duplicate', '重複的關係'], ['S-edge-evidence', '需要證據的關係沒有證據'],
    ['S-evidence-ref', 'evidence_ids 必須指向證據節點'], ['Q-unspecified', '必填欄位仍是 unspecified'], ['Q-name-zh', 'name 不是中文'],
    ['Q-needs-review', '遷移時無法確定、待人工確認的欄位'], ['Q-unreachable-link', '證據網址無法讀取'], ...rules.map(r => [r.id, r.description] as [string, string]),
  ]);
  const counts = new Map<string, { level: string; count: number }>();
  for (const i of issues) { const c = counts.get(i.rule) ?? { level: i.level, count: 0 }; c.count++; counts.set(i.rule, c); }
  const errors = issues.filter(i => i.level === 'error').length;
  return {
    ok: errors === 0, errors, warnings: issues.length - errors,
    byRule: [...counts].map(([rule, c]) => ({ rule, ...c, description: desc.get(rule) ?? rule })).sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'error' ? -1 : 1)),
    issues: issues.slice(0, 800),
  };
}
