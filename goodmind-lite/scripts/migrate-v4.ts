// Usage: npx tsx scripts/migrate-v4.ts [--dry]
// Migrates data/seed.json and data/db.json from ontology v2.0 to v4.0 (backups: *.v2_0.json).
import fs from 'node:fs';
import path from 'node:path';
import { migrateToV4 } from '../lib/migrate-v4';
import { validateData } from '../lib/validate';
import type { Graph } from '../lib/types';

const dir = path.join(process.cwd(), 'data');
const dry = process.argv.includes('--dry');
for (const f of ['seed.json', 'db.json']) {
  const file = path.join(dir, f), g = JSON.parse(fs.readFileSync(file, 'utf8')) as Graph;
  if (String(g.ontology_version).startsWith('4.')) { console.log(`${f}: already v4`); continue; }
  const backup = path.join(dir, f.replace('.json', '.v2_0.json'));
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const { graph, changes, idMap } = migrateToV4(g);
  const q = validateData(graph);
  console.log(`${f}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${Object.keys(idMap).length} ids renamed, ${changes.length} changes; quality ${q.errors} errors / ${q.warnings} warnings`);
  for (const r of q.byRule) console.log(`  ${r.level.padEnd(7)} ${r.rule.padEnd(26)} ${String(r.count).padStart(4)}  ${r.description}`);
  if (!dry) {
    fs.writeFileSync(file, JSON.stringify(graph, null, 2));
    fs.writeFileSync(path.join(dir, 'migration-v4', `${f.replace('.json', '')}-changes.json`), JSON.stringify({ idMap, changes }, null, 2));
  }
}
