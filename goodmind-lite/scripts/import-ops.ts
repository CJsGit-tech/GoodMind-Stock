// Usage: npx tsx scripts/import-ops.ts data/imports/a.json [b.json …]
// Applies each batch through the write gate (lib/write.ts) in order and saves data/db.json after each accepted batch.
// Stops at the first refused batch. Pass --seed to also copy the result to data/seed.json (the reset baseline).
import fs from 'node:fs';
import { readDb, writeDb } from '../lib/db';
import { applyWrites } from '../lib/write';
import type { WriteOp } from '../lib/write';

const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ops: WriteOp[] = Array.isArray(raw) ? raw : raw.ops;
  const r = applyWrites(readDb(), ops, `research-import:${raw.source_folder ?? file}`);
  if (!r.ok) { console.log(`REFUSED ${file}:`); for (const e of r.errors) console.log(' -', e); process.exit(1); }
  writeDb(r.graph);
  console.log(`imported ${file}: ${ops.length} operations → ${r.graph.nodes.length} nodes, ${r.graph.edges.length} edges`);
}
if (args.includes('--seed')) { fs.copyFileSync('data/db.json', 'data/seed.json'); console.log('copied to data/seed.json'); }
