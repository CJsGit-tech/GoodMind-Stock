// Ontology v2 data upgrade: builds the group tree (Industry > Segment > Category), places every company and
// offering into it, and records the value chain, so lib/suggest.ts can propose links.
// Reads data/curation/v2-groups.json (reviewable). Idempotent; facts entailed by existing records are
// marked as such, curated ones carry rationale + confidence.
// Usage: npx tsx scripts/apply-v2.ts
import fs from 'node:fs';
import { upgradeGraph } from '../lib/ontology';
import { validateData } from '../lib/validate';
import { computeSuggestions } from '../lib/suggest';
import { isA } from '../lib/types';
import type { Graph, GraphEdge, GraphNode } from '../lib/types';

const cur = JSON.parse(fs.readFileSync('data/curation/v2-groups.json', 'utf8'));
const SELLERS = ['SELLS', 'BRANDS', 'OFFERS_SERVICE'];

function apply(input: Graph) {
  const g = upgradeGraph(input).graph;
  const stats: Record<string, number> = {}, missing: string[] = [];
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const byId = () => new Map(g.nodes.map(n => [n.id, n]));
  const named = (name: string, kind: 'Company' | 'Offering') => {
    const hits = g.nodes.filter(n => n.name === name && isA(g.entityTypes, n.type, kind));
    if (hits.length !== 1) { missing.push(`${kind} "${name}" (${hits.length} matches)`); return null; }
    return hits[0];
  };
  const seg = (key: string) => (cur.segments as { key: string; id: string }[]).find(s => s.key === key)?.id ?? null;
  const evOf = (...ids: (string | undefined)[]) => { const by = byId(); return [...new Set(ids.flatMap(id => (id && Array.isArray(by.get(id)?.evidence_ids) ? by.get(id)!.evidence_ids as string[] : [])))]; };
  const curation = (method: string, rationale: string, confidence: string, basis?: string) => ({ method, rationale, confidence, ...(basis ? { basis } : {}), at: cur.curated_at });
  const hasEdge = (p: string, from: string, to: string) => g.edges.some(e => e.predicate === p && e.from === from && e.to === to);
  const addEdge = (p: string, from: string, to: string, extra: Record<string, unknown>, stat: string) => {
    const by = byId();
    if (!from || !to || !by.has(from) || !by.has(to) || hasEdge(p, from, to)) return false;
    g.edges.push({ id: `v2:${p}:${from}|${to}`, predicate: p, from, to, ...extra } as GraphEdge); bump(stat); return true;
  };
  const addNode = (n: GraphNode, stat: string) => { if (byId().has(n.id)) return false; g.nodes.push(n); bump(stat); return true; };
  const groupNode = (id: string, type: string, zh: string, en: string, stat: string) =>
    addNode({ id, type, name: zh, localized_names: { 'zh-TW': zh, en }, verification_status: 'analyst_inferred', curation: curation('v2-grouping', 'Group node for the v2 group tree.', 'high') }, stat);
  const sellersOf = (o: string) => g.edges.filter(e => e.to === o && SELLERS.includes(e.predicate)).map(e => e.from);
  const sellEdge = (o: GraphNode) => (o.type === 'Service' ? 'OFFERS_SERVICE' : 'SELLS');

  // 1. Group tree
  const industries = new Map<string, string>();
  for (const i of cur.industries) { industries.set(i.key, i.id); if (!i.existing) groupNode(i.id, 'Industry', i.zh, i.en, 'industries'); }
  for (const s of cur.segments) {
    if (s.zh) groupNode(s.id, 'MarketSegment', s.zh, s.en, 'segments');
    if (!byId().has(s.id)) { missing.push(`segment ${s.key}`); continue; }
    addEdge('SEGMENT_OF_INDUSTRY', s.id, industries.get(s.industry)!, { verification_status: 'analyst_inferred', curation: curation('v2-grouping', `Segment belongs to ${s.industry}.`, 'high') }, 'segment → industry');
  }
  for (const c of cur.categories) if (byId().has(c.id)) addEdge('CATEGORY_IN_SEGMENT', c.id, seg(c.segment)!, { verification_status: 'analyst_inferred', curation: curation('v2-grouping', 'Category placed in its segment.', 'high') }, 'category → segment');
  for (const [up, down] of cur.value_chain) addEdge('FEEDS_SEGMENT', seg(up)!, seg(down)!, { verification_status: 'analyst_inferred', curation: curation('v2-value-chain', `${up} output is an input of ${down}.`, 'medium') }, 'value-chain links');
  for (const t of cur.technology_providers) { const c = named(t.company, 'Company'); if (c && byId().has(t.technology)) addEdge('PROVIDES_TECHNOLOGY', c.id, t.technology, { verification_status: 'analyst_inferred', evidence_ids: evOf(c.id), curation: curation('v2-grouping', t.rationale, t.confidence) }, 'technology providers'); }

  // 2. Curated sellers for offerings that had none
  for (const s of cur.offering_sellers) {
    const o = named(s.offering, 'Offering'), c = named(s.company, 'Company');
    if (o && c) addEdge(sellEdge(o), c.id, o.id, { verification_status: 'analyst_inferred', evidence_ids: evOf(o.id, c.id), curation: curation('v2-seller', s.rationale, s.confidence) }, 'curated sellers');
  }
  // 3. Entailed sellers: the supplier in a supply record offers what it supplies.
  for (const r of g.nodes.filter(n => n.type === 'SupplyRelationship')) {
    const sup = g.edges.find(e => e.from === r.id && e.predicate === 'HAS_SUPPLIER')?.to;
    for (const e of g.edges.filter(x => x.from === r.id && (x.predicate === 'FOR_SUPPLIED_PRODUCT' || x.predicate === 'FOR_SUPPLIED_SERVICE'))) {
      const o = byId().get(e.to);
      if (sup && o) addEdge(sellEdge(o), sup, o.id, { verification_status: r.verification_status ?? 'reported', evidence_ids: r.evidence_ids ?? [], curation: curation('entailed', 'The supplier in this supply record offers what it supplies.', 'high', r.id) }, 'entailed sellers');
    }
  }
  // 4. One offering per company: split offerings shared by several suppliers.
  for (const name of cur.split_by_supplier as string[]) {
    const o = named(name, 'Offering'); if (!o) continue;
    const ss = sellersOf(o.id); if (ss.length < 2) continue;
    for (const s of ss) {
      const co = byId().get(s)!, short = String(co.name).split(/\s+/)[0];
      const id = `${o.id}:${s.replace(/^entity:/, '').slice(0, 8)}`;
      addNode({ ...o, id, name: `${short} ${o.name}`, split_from: o.id, curation: curation('v2-split', 'One offering per company, so competition between suppliers can be recorded.', 'high', o.id) }, 'offerings split');
      addEdge(sellEdge(o), s, id, { verification_status: 'reported', evidence_ids: o.evidence_ids ?? [], curation: curation('v2-split', 'Seller of the split offering.', 'high', o.id) }, 'split sellers');
      for (const r of g.nodes.filter(n => n.type === 'SupplyRelationship' && g.edges.some(e => e.from === n.id && e.predicate === 'HAS_SUPPLIER' && e.to === s)))
        for (const e of g.edges) if (e.from === r.id && e.to === o.id) { e.to = id; e.id = `${e.id}:split`; }
    }
    g.edges = g.edges.filter(e => e.from !== o.id && e.to !== o.id); g.nodes = g.nodes.filter(n => n.id !== o.id); bump('shared offerings removed');
  }
  // 5. Entailed segments: offerings compared in a competition record are in that record's segment/category.
  for (const a of g.nodes.filter(n => n.type === 'CompetitionAssessment')) {
    const outs = (p: string) => g.edges.filter(e => e.from === a.id && e.predicate === p).map(e => e.to);
    for (const o of [...outs('OFFERING_A'), ...outs('OFFERING_B')]) {
      for (const s of outs('COMPETES_IN_SEGMENT')) addEdge('TARGETS_SEGMENT', o, s, { verification_status: a.verification_status ?? 'analyst_inferred', evidence_ids: a.evidence_ids ?? [], curation: curation('entailed', 'Compared in a competition record scoped to this segment.', 'high', a.id) }, 'entailed segments');
      for (const c of outs('COMPETES_IN_CATEGORY')) addEdge('IN_CATEGORY', o, c, { verification_status: a.verification_status ?? 'analyst_inferred', evidence_ids: a.evidence_ids ?? [], curation: curation('entailed', 'Compared in a competition record scoped to this category.', 'high', a.id) }, 'entailed categories');
    }
  }
  // 6. Curated placement of the remaining offerings (split offerings inherit their parent's placement)
  for (const x of cur.offering_groups) {
    const targets = g.nodes.filter(n => isA(g.entityTypes, n.type, 'Offering') && (n.name === x.offering || byId().get(String(n.split_from))?.name === x.offering || (n.split_from && String(n.name).endsWith(` ${x.offering}`))));
    if (!targets.length) { missing.push(`offering "${x.offering}"`); continue; }
    for (const o of targets) {
      const meta = { verification_status: 'analyst_inferred', evidence_ids: evOf(o.id), curation: curation('v2-grouping', x.rationale, x.confidence) };
      for (const k of x.segments ?? []) addEdge('TARGETS_SEGMENT', o.id, seg(k)!, meta, 'curated segments');
      if (x.category) addEdge('IN_CATEGORY', o.id, x.category, meta, 'curated categories');
      if (x.technology) addEdge('USES_TECHNOLOGY', o.id, x.technology, meta, 'curated technologies');
    }
  }
  // 7. New named offerings
  for (const x of cur.new_offerings) {
    const c = named(x.company, 'Company'); if (!c) continue;
    addNode({ id: x.id, type: 'Product', name: x.name, kind: x.kind, verification_status: 'analyst_inferred', evidence_ids: evOf(c.id), curation: curation('v2-offering', x.rationale, x.confidence) }, 'new offerings');
    const meta = { verification_status: 'analyst_inferred', evidence_ids: evOf(c.id), curation: curation('v2-offering', x.rationale, x.confidence) };
    addEdge('SELLS', c.id, x.id, meta, 'new offering sellers');
    for (const k of x.segments) addEdge('TARGETS_SEGMENT', x.id, seg(k)!, meta, 'curated segments');
    if (x.technology) addEdge('USES_TECHNOLOGY', x.id, x.technology, meta, 'curated technologies');
  }
  // 8. Business lines: a company's activity in a segment when no named offering is recorded there.
  const segOfOffering = (o: string) => [...g.edges.filter(e => e.from === o && e.predicate === 'TARGETS_SEGMENT').map(e => e.to),
    ...g.edges.filter(e => e.from === o && e.predicate === 'IN_CATEGORY').flatMap(e => g.edges.filter(x => x.from === e.to && x.predicate === 'CATEGORY_IN_SEGMENT').map(x => x.to))];
  for (const b of cur.business_lines) {
    const c = named(b.company, 'Company'), s = seg(b.segment); if (!c || !s) continue;
    if (g.edges.some(e => e.from === c.id && SELLERS.includes(e.predicate) && segOfOffering(e.to).includes(s))) { bump('business lines skipped (offering exists)'); continue; }
    const sn = byId().get(s)!, short = String(c.name).split(/\s+/)[0], id = `offering:bl:${c.id.replace(/^(entity|company):/, '').slice(0, 12)}:${b.segment}`;
    const meta = { verification_status: 'analyst_inferred', evidence_ids: evOf(c.id), curation: curation('v2-business-line', b.rationale, b.confidence) };
    addNode({ id, type: 'Product', name: `${short}・${sn.name}業務`, kind: 'business_line', ...meta, notes: 'Business line: the company\'s activity in this segment. Replace with named products when sourced.' }, 'business lines');
    addEdge('SELLS', c.id, id, meta, 'business line sellers');
    addEdge('TARGETS_SEGMENT', id, s, meta, 'business line segments');
  }
  // 9. Drop group nodes this script created that ended up with no members (keeps small datasets clean).
  for (let changed = true; changed;) {
    changed = false;
    for (const n of g.nodes.filter(x => (x.type === 'MarketSegment' || x.type === 'Industry') && (x.curation as { method?: string } | undefined)?.method === 'v2-grouping')) {
      const members = g.edges.some(e => e.to === n.id && (n.type === 'Industry' ? ['SEGMENT_OF_INDUSTRY', 'OPERATES_IN', 'SERVES_INDUSTRY'] : ['TARGETS_SEGMENT', 'ACTIVE_IN_SEGMENT', 'CATEGORY_IN_SEGMENT', 'COMPETES_IN_SEGMENT']).includes(e.predicate));
      if (members) continue;
      g.nodes = g.nodes.filter(x => x.id !== n.id); g.edges = g.edges.filter(e => e.from !== n.id && e.to !== n.id); bump('empty groups dropped'); changed = true;
    }
  }
  return { g, stats, missing };
}

for (const file of ['data/seed.json', 'data/db.json', 'data/seed.sample.json']) {
  if (!fs.existsSync(file)) continue;
  const { g, stats, missing } = apply(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify(g, null, 2));
  const q = validateData(g), sugg = computeSuggestions(g);
  console.log(`\n${file}: ${g.nodes.length} nodes, ${g.edges.length} edges`, stats);
  if (missing.length) console.log('  not found (skipped):', [...new Set(missing)].slice(0, 12).join('; '), missing.length > 12 ? `… +${missing.length - 12}` : '');
  console.log(`  validation: ${q.errors} errors, ${q.warnings} warnings`);
  for (const r of q.byRule) console.log(`    [${r.level}] ${r.rule.padEnd(22)} ${String(r.count).padStart(3)}  ${r.description}`);
  for (const i of q.issues.filter(x => x.level === 'error' || x.rule.startsWith('G-')).slice(0, 12)) console.log('     ', i.rule, i.message);
  const by = (k: string) => sugg.filter(s => s.rules.includes(k)).length;
  console.log(`  suggestions: ${sugg.length} (competition ${sugg.filter(s => s.kind === 'competition').length}, supply ${sugg.filter(s => s.kind === 'supply').length})`,
    Object.fromEntries(['S-same-offering', 'S-same-category', 'S-same-segment', 'S-shared-technology', 'S-technology-provider', 'S-value-chain'].map(k => [k, by(k)])));
}
