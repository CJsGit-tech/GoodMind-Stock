// Usage (from the repository root): npx tsx <skill>/scripts/gaps.ts [name or id ...] [--graph file]
// No names: counts quality gaps by rule. With names: each node's current relations and gaps.
// Run it for every node the user names, so a wrong premise ("it has no products") is caught before research.
import { appLib, loadGraph } from './common';

(async () => {
  const { validateData } = await appLib('validate'), ontology = await appLib('ontology');
  const g = ontology.applySchema(loadGraph().graph);
  const args = process.argv.slice(2).filter((x, i, a) => x !== '--graph' && a[i - 1] !== '--graph');
  const q = validateData(g);
  if (!args.length) {
    console.log(`${q.errors} errors, ${q.warnings} warnings${q.issues.length < q.errors + q.warnings ? ' (issue list is truncated at 800)' : ''}`);
    for (const r of q.byRule) console.log(`- ${r.rule} ${r.count}: ${r.description}`);
    return;
  }
  const by = new Map<string, any>(g.nodes.map((n: any) => [n.id, n]));   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const a of args) {
    const hits = g.nodes.filter((n: any) => n.id === a || n.name === a || (n.attributes.aliases ?? []).includes(a));   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!hits.length) console.log(`${a}: not in the graph under this id, name or alias`);
    for (const n of hits) {
      console.log(`${n.name} (${n.id}, ${n.type})`);
      for (const e of g.edges) if (e.from === n.id || e.to === n.id) console.log(`  ${e.from === n.id ? `${e.predicate} → ${by.get(e.to)?.name} [${e.to}]` : `${by.get(e.from)?.name} [${e.from}] ${e.predicate} →`}`);
      for (const i of q.issues.filter((i: any) => i.id === n.id)) console.log(`  gap: ${i.rule} ${i.message}`);   // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
})();
