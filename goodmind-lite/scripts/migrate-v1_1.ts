// Upgrades data/seed.json (and data/db.json if present) to ontology v1.1. Keeps a v1.0 backup.
// Usage: npx tsx scripts/migrate-v1_1.ts
import fs from 'node:fs';
import { upgradeGraph, ONTOLOGY_VERSION } from '../lib/ontology';
import { validateData } from '../lib/validate';
import type { Graph } from '../lib/types';

for (const file of ['data/seed.json', 'data/db.json']) {
  if (!fs.existsSync(file)) continue;
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as Graph;
  if (g.ontology_version === ONTOLOGY_VERSION) { console.log(`${file}: already ${ONTOLOGY_VERSION}`); continue; }
  const backup = file.replace('.json', '.v1_0.json');
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const { graph, changes } = upgradeGraph(g);
  fs.writeFileSync(file, JSON.stringify(graph, null, 2));
  const kinds = changes.reduce<Record<string, number>>((m, c) => { const k = c.startsWith('+') ? c : c.replace(/^[^:]+: /, '').replace(/ = .*\(/, ' ('); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(`\n${file}: ${g.ontology_version ?? '1.0.0'} → ${ONTOLOGY_VERSION} (backup ${backup})`);
  for (const [k, n] of Object.entries(kinds)) console.log(`  ${String(n).padStart(3)} × ${k}`);
  const q = validateData(graph);
  console.log(`  validation: ${q.errors} errors, ${q.warnings} warnings`);
  for (const r of q.byRule) console.log(`    [${r.level}] ${r.rule.padEnd(22)} ${String(r.count).padStart(3)}  ${r.description}`);
}
