// Usage (from goodmind-lite/): npx tsx <skill>/scripts/match.ts <run-dir> [--graph file]
// Finds possible duplicates the write gate cannot see. Writes <run-dir>/matches.json: { newKey: [{ id, why }] }.
import path from 'node:path';
import { attrsOf, loadGraph, normUrl, readJson, writeJson } from './common';
import type { Op } from './common';

const flat = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s・·.,()\-&'*＊]+/g, '');
const LEGAL = /(股份有限公司|有限公司|公司|corporation|incorporated|company|limited|holdings?|coltd|corp|inc|ltd|llc|plc|gmbh|kk)$/;
const core = (s: unknown) => { let x = flat(String(s ?? '').replace(/-KY\b/i, '')); while (LEGAL.test(x) && x.replace(LEGAL, '').length > 1) x = x.replace(LEGAL, ''); return x; };
type N = { id: string; type: string; name: string; attributes: Record<string, any> };   // eslint-disable-line @typescript-eslint/no-explicit-any
const NAMED = new Set(['Company', 'ETF', 'CorporateGroup', 'Industry', 'MarketSegment', 'ProductCategory', 'Technology', 'Application', 'Product', 'Service', 'BusinessLine', 'Capability']);
const RECORD = new Set(['Collaboration', 'SupplyRelationship', 'CompetitionAssessment']);
const PARTIES = new Set(['HAS_PARTICIPANT', 'HAS_SUPPLIER', 'HAS_BUYER', 'OFFERING_A', 'OFFERING_B']);

const names = (n: N) => new Set([n.name, n.attributes.name_en, n.attributes.legal_name_zh, n.attributes.legal_name_en, ...(n.attributes.aliases ?? [])].filter(Boolean).map(core).filter(s => s.length > 1));

const run = process.argv[2];
if (!run) { console.error('usage: match.ts <run-dir> [--graph file]'); process.exit(2); }
const { graph } = loadGraph();
const ops: Op[] = readJson<{ ops: Op[] }>(path.join(run, 'draft.json')).ops;
const fresh: N[] = ops.filter(o => o.op === 'createNode').map(o => ({ ...o.node, attributes: attrsOf(o) }));
const edges = [...graph.edges, ...ops.filter(o => o.op === 'createEdge').map(o => o.edge)];
const parties = (id: string, swap: Map<string, string>) => [...new Set(edges.filter(e => e.from === id && PARTIES.has(e.predicate)).map(e => `${e.predicate.startsWith('OFFERING') ? 'OFFERING' : e.predicate}:${swap.get(e.to) ?? e.to}`))].sort().join(',');

const out: Record<string, { id: string; why: string }[]> = {};
const swap = new Map<string, string>();   // new id -> first strong candidate, so record signatures compare correctly
const hit = (a: N, b: N, why: string) => { (out[a.id] ??= []).push({ id: b.id, why }); };
const pool: N[] = [...graph.nodes];

for (const n of fresh) {
  for (const o of pool) {
    if (o.type !== n.type || o.id === n.id) { if (o.id === n.id) hit(n, o, 'same id already exists'); continue; }
    if (n.type === 'Evidence') {
      if (normUrl(n.attributes.url) && normUrl(n.attributes.url) === normUrl(o.attributes.url)) { hit(n, o, 'same source url'); if (!swap.has(n.id)) swap.set(n.id, o.id); }
    } else if (NAMED.has(n.type)) {
      const a = names(n), same = [...names(o)].find(x => a.has(x));
      const ta = n.attributes.ticker, tb = o.attributes.ticker;
      const sameTicker = ta && String(ta) === String(tb) && (!n.attributes.country || !o.attributes.country || n.attributes.country === o.attributes.country);
      if (same || sameTicker) { hit(n, o, sameTicker ? `same ticker ${ta}` : `same name after removing legal suffixes: ${same}`); if (!swap.has(n.id)) swap.set(n.id, o.id); }
      else if (n.type === 'Company') {
        const long = (x: string) => x.length >= 4;
        const near = [...a].find(x => [...names(o)].some(y => long(x) && long(y) && (x.startsWith(y) || y.startsWith(x))));
        if (near) hit(n, o, `one name starts with the other: ${near}`);
      }
    }
  }
  pool.push(n);
}
const records: N[] = graph.nodes.filter((x: N) => RECORD.has(x.type));
for (const n of fresh.filter(x => RECORD.has(x.type))) {
  const sig = parties(n.id, swap);
  if (sig) for (const o of records) if (o.type === n.type && parties(o.id, swap) === sig) hit(n, o, 'record with the same parties (may be a different event: compare date and scope)');
  records.push(n);
}
writeJson(path.join(run, 'matches.json'), out);
console.log(`${fresh.length} new nodes checked; ${Object.keys(out).length} need a decision in decisions.json`);
for (const [k, v] of Object.entries(out)) console.log(` - ${k} → ${v.map(x => `${x.id} (${x.why})`).join('; ')}`);
