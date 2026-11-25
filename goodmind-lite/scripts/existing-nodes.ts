// Usage: npx tsx scripts/existing-nodes.ts
// Rewrites data/imports/EXISTING-NODES.md from data/db.json: the shared nodes (industries, segments, companies,
// technologies, applications, ETFs) an extraction must reuse instead of creating duplicates. Run it after every import.
import fs from 'node:fs';
import { readDb } from '../lib/db';

const TYPES = ['Industry', 'MarketSegment', 'Company', 'Technology', 'Application', 'ETF'];
const g = readDb();
const lines = ['# Existing nodes you must REUSE (do not create duplicates). Use these ids in edges.', '', `_Generated from data/db.json on ${new Date().toISOString().slice(0, 10)} (${g.nodes.length} nodes)._`];
for (const type of TYPES) {
  lines.push('', `## ${type}`);
  for (const n of g.nodes.filter(x => x.type === type)) {
    const a = n.attributes ?? {}, en = a.name_en ? ` (${a.name_en})` : '', ticker = a.ticker ? ` · ${a.ticker}` : '';
    lines.push(`- ${n.id} — ${n.name}${en}${ticker}`);
  }
}
fs.writeFileSync('data/imports/EXISTING-NODES.md', lines.join('\n') + '\n');
console.log(`wrote data/imports/EXISTING-NODES.md (${TYPES.map(t => `${t} ${g.nodes.filter(x => x.type === t).length}`).join(', ')})`);
