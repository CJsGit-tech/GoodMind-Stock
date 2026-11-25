// Usage: npx tsx scripts/sample-depth.ts [runs=500]
// Depth analysis of the opening sample (lib/sample.ts) on data/db.json: node counts per run, how often the cap cuts,
// which industries get picked, and how many companies each depth adds.
import { readDb } from '../lib/db';
import { withDerived } from '../lib/derive';
import { sampleGraph, SAMPLE_DEFAULTS } from '../lib/sample';
import { groupMembers } from '../lib/groups';
import type { Graph } from '../lib/types';

const runs = Number(process.argv[2] ?? 500);
const db = readDb();
const g = withDerived({ ...db, suggestionDecisions: db.meta?.suggestionDecisions } as Graph);
const name = new Map(g.nodes.map(n => [n.id, n.name]));
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const depth of [1, 2, 3]) {
  const sizes: number[] = [], uncapped: number[] = [], d1: number[] = [], d2: number[] = []; let cut = 0;
  const pick = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const s = sampleGraph(g, { ...SAMPLE_DEFAULTS, depth, seed: `run-${i}` });
    const raw = sampleGraph(g, { ...SAMPLE_DEFAULTS, depth, maxNodes: 1e9, seed: `run-${i}` });
    sizes.push(s.nodeIds.size); uncapped.push(raw.nodeIds.size); if (s.truncated) cut++;
    d1.push(s.byDepth[0]?.length ?? 0); d2.push(s.byDepth[1]?.length ?? 0);
    s.industries.forEach(x => pick.set(x, (pick.get(x) ?? 0) + 1));
  }
  console.log(`\ndepth ${depth}: shown nodes median ${q(sizes, .5)} · p90 ${q(sizes, .9)} · max ${Math.max(...sizes)} | before cap median ${q(uncapped, .5)} · p90 ${q(uncapped, .9)} · max ${Math.max(...uncapped)} | cap cut ${cut}/${runs}`);
  console.log(`  companies added: depth1 median ${q(d1, .5)} (max ${Math.max(...d1)}), depth2 median ${q(d2, .5)} (max ${Math.max(...d2)})`);
  if (depth === 2) console.log('  industry pick rate:', [...pick].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${name.get(k)} ${Math.round(100 * v / runs)}%`).join(' · '));
}
const inds = g.nodes.filter(n => n.type === 'Industry');
console.log('\nindustries:', inds.map(i => `${i.name}(${[...groupMembers(g, i.id)].filter(x => g.nodes.find(n => n.id === x)?.type === 'Company').length})`).join(' '));
const a = sampleGraph(g, { ...SAMPLE_DEFAULTS, seed: 'demo' }), again = sampleGraph(g, { ...SAMPLE_DEFAULTS, seed: 'demo' });
console.log('repeatable:', [...a.nodeIds].join() === [...again.nodeIds].join(), '· demo industries:', a.industries.map(x => name.get(x)).join('、'), '· seeds:', a.seeds.map(x => name.get(x)).join('、'));
