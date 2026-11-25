// Usage: npm run import -- <ops-file>.json [more.json …]
// Applies each batch through the write gate (lib/write.ts) in order and saves data/db.json after each accepted batch.
// A refused batch changes nothing and stops the run. The previous data is kept as data/db.backup.json.
// data/db.json is your local data and is ignored by git.
import fs from 'node:fs';
import { readDb, writeDb } from '../lib/db';
import { applyWrites } from '../lib/write';
import type { WriteOp } from '../lib/write';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: npm run import -- <ops-file>.json [more.json …]'); process.exit(2); }
readDb();   // creates data/db.json from the empty starter on first use
fs.copyFileSync('data/db.json', 'data/db.backup.json');
for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ops: WriteOp[] = Array.isArray(raw) ? raw : raw.ops;
  const r = applyWrites(readDb(), ops, 'import');
  if (!r.ok) { console.log(`REFUSED ${file}:`); for (const e of r.errors) console.log(' -', e); process.exit(1); }
  writeDb(r.graph);
  console.log(`imported ${file}: ${ops.length} operations → ${r.graph.nodes.length} nodes, ${r.graph.edges.length} edges`);
}
