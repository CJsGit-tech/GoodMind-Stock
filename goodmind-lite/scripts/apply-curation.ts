// Applies reviewed curation files to the data: data/curation/v1_1-curation.json + evidence_dates.json,
// converts subcontracting services, and adds ETF holdings from weights recorded in ETF notes.
// Idempotent. Usage: npx tsx scripts/apply-curation.ts
import fs from 'node:fs';
import { upgradeGraph } from '../lib/ontology';
import { validateData } from '../lib/validate';
import type { Graph, GraphEdge, GraphNode } from '../lib/types';

const cur = JSON.parse(fs.readFileSync('data/curation/v1_1-curation.json', 'utf8'));
const dates = JSON.parse(fs.readFileSync('data/curation/evidence_dates.json', 'utf8'));

function apply(input: Graph) {
  const g = upgradeGraph(input).graph;          // re-applies the latest declared schema and rules
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const stamp = (n: GraphNode, fields: string[], rationale: string, confidence: string) => {
    n.curation = { fields, method: 'assisted', basis: 'record notes / basis text / evidence page', rationale, confidence, at: cur.curated_at };
  };
  // 1. Field decisions
  for (const d of cur.decisions) {
    const n = by.get(d.id); if (!n) { bump('missing record'); continue; }
    Object.assign(n, d.set); stamp(n, Object.keys(d.set), d.rationale, d.confidence); bump('records curated');
  }
  // 2. Scope links
  const addEdge = (e: GraphEdge) => { if (!g.edges.some(x => x.id === e.id)) { g.edges.push(e); return true; } return false; };
  for (const l of cur.links) {
    const src = by.get(l.from)!;
    if (addEdge({ id: `curated:${l.predicate}:${l.from}`, predicate: l.predicate, from: l.from, to: l.to, verification_status: 'analyst_inferred', evidence_ids: src.evidence_ids ?? [], notes: l.rationale })) bump('scope links');
  }
  // 3. Participant roles
  for (const r of cur.roles) { const e = g.edges.find(x => x.id === r.edge); if (e) { e.role = r.role; bump('roles'); } }
  // 4. Subcontracting "products" that are really services
  for (const name of cur.services.convert_products_named as string[]) {
    for (const n of g.nodes.filter(x => x.name === name && x.type === 'Product')) {
      n.type = 'Service'; n.kind = 'testing_and_packaging'; bump('products → services');
      for (const e of g.edges) {
        if (e.to === n.id && e.predicate === 'FOR_SUPPLIED_PRODUCT') e.predicate = 'FOR_SUPPLIED_SERVICE';
        if (e.to === n.id && ['SELLS', 'BRANDS', 'DISTRIBUTES'].includes(e.predicate)) e.predicate = 'OFFERS_SERVICE';
      }
    }
  }
  // 5. Evidence dates + link checks
  for (const r of dates.results) {
    const n = by.get(r.id); if (!n) continue;
    n.link_checked_at = dates.checked_at; n.link_status = String(r.status);
    if (!r.date || n.source_published_at) continue;
    // Fiscal-year-end dates taken from notes are reporting periods, not publication dates.
    if (r.method === 'record_note' && /-12-31$/.test(r.date)) n.period_end = r.date;
    else { n.source_published_at = r.date; n.date_method = r.method; }
    bump('evidence dated');
  }
  // 6. ETF holdings from the weights listed in each ETF's notes (only companies already in the graph)
  const byTicker = new Map(g.nodes.filter(n => n.type === 'Company' && n.ticker).map(n => [String(n.ticker), n]));
  const byName = (s: string) => g.nodes.find(n => n.type === 'Company' && s.length > 3 && String(n.name).toLowerCase().includes(s.toLowerCase()));
  for (const etf of g.nodes.filter(n => n.type === 'ETF')) {
    const notes = String(etf.notes ?? ''), asOf = /As of (\d{4}-\d{2}-\d{2})/.exec(notes)?.[1];
    const thirdParty = /third-party|第三方/i.test(notes);
    for (const m of notes.matchAll(/(\d{3,4}[A-Z]?)\s+([^；;%\d][^；;%]*?)\s+(\d+(?:\.\d+)?)%/g)) {
      const [, code, label, w] = m;
      const co = byTicker.get(code) ?? byName(label.trim());
      if (!co) continue;
      if (addEdge({ id: `holding:${etf.id}:${co.id}`, predicate: 'HOLDS_CONSTITUENT', from: etf.id, to: co.id, weight_pct: Number(w), as_of: asOf,
        weight_source: etf.url, verification_status: thirdParty ? 'reported' : 'officially_disclosed', notes: `${code} ${label.trim()} ${w}% (from ETF holdings note)` })) bump('ETF holdings');
    }
  }
  return { g, stats };
}

for (const file of ['data/seed.json', 'data/db.json']) {
  if (!fs.existsSync(file)) continue;
  const { g, stats } = apply(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify(g, null, 2));
  const q = validateData(g);
  console.log(`\n${file}:`, stats);
  console.log(`  validation: ${q.errors} errors, ${q.warnings} warnings`);
  for (const r of q.byRule) console.log(`    [${r.level}] ${r.rule.padEnd(22)} ${String(r.count).padStart(3)}  ${r.description}`);
  for (const i of q.issues.filter(x => x.level === 'error').slice(0, 10)) console.log('   ', i.id, i.message);
}
