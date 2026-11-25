// Usage (from goodmind-lite/): npx tsx <skill>/scripts/ontology.ts
// Prints the live ontology: node types with required attributes, and the relations that may be stored.
import { appLib, loadGraph } from './common';

(async () => {
  const o = await appLib('ontology'), t = await appLib('types');
  const g = o.applySchema(loadGraph().graph);
  console.log(`ontology ${o.ONTOLOGY_VERSION} · schema hash ${o.schemaHash()}\n\nNODE TYPES  (key 中文: required attributes)`);
  for (const n of g.entityTypes) {
    if (n.abstract) continue;
    const req = (n.properties ?? []).filter((p: any) => p.required).map((p: any) => p.values ? `${p.name}(${p.values.join('|')})` : p.name);   // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log(`- ${n.name} ${n.label}: ${req.join(', ') || '—'}`);
  }
  console.log('\nSTORABLE RELATIONS  (predicate 中文: from → to)  * = evidence required');
  for (const p of g.edgeTypes) if (t.WRITABLE_STORAGE.has(p.storage))
    console.log(`- ${p.predicate}${p.evidenceRequired ? '*' : ''} ${p.label}: ${p.from.join('/')} → ${p.to.join('/')}`);
})();
