// Usage: npm run check -- <ops-file>.json
// Validates a batch of write operations against the current data/db.json with the real write gate (lib/write.ts),
// without saving anything. Prints every refusal reason, or a summary when the batch would be accepted.
import fs from 'node:fs';
import { readDb } from '../lib/db';
import { applyWrites } from '../lib/write';
import type { WriteOp } from '../lib/write';

const file = process.argv[2];
if (!file) { console.error('usage: npm run check -- <ops-file>.json'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const ops: WriteOp[] = Array.isArray(raw) ? raw : raw.ops;
const r = applyWrites(readDb(), ops, 'research-import');
if (!r.ok) { console.log(`REFUSED: ${r.errors.length} problem(s)`); for (const e of r.errors) console.log(' -', e); process.exit(1); }
const types = new Map<string, number>(); let edges = 0;
for (const o of ops) { if (o.op === 'createNode') types.set(o.node.type, (types.get(o.node.type) ?? 0) + 1); if (o.op === 'createEdge') edges++; }
console.log(`OK: ${ops.length} operations would be accepted (${[...types].map(([t, n]) => `${t} ${n}`).join(', ')}, edges ${edges}).`);
