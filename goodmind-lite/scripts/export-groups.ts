// Writes the v2 group tree and the current suggested links to export/groups/ (JSON + CSV).
// Usage (from goodmind-lite/): npx tsx scripts/export-groups.ts [data/seed.json]
import fs from 'node:fs';
import path from 'node:path';
import { withDerived } from '../lib/derive';
import { groupTree } from '../lib/groups';
import { computeSuggestions } from '../lib/suggest';

const g = JSON.parse(fs.readFileSync(process.argv[2] ?? 'data/seed.json', 'utf8'));
const full = withDerived(g), by = new Map(full.nodes.map(n => [n.id, n.name]));
const out = path.join('..', 'export', 'groups'); fs.mkdirSync(out, { recursive: true });
const tree = groupTree(full).map(({ industry, segments }) => ({ industry: { id: industry.id, name: industry.name }, segments: segments.map(s => ({
  id: s.segment.id, name: s.segment.name, companies: s.companies, offerings: s.offerings, categories: s.categories.map(c => ({ id: c.id, name: c.name })),
  feeds: s.feeds.map(id => ({ id, name: by.get(id) })) })) }));
fs.writeFileSync(path.join(out, 'group_tree.json'), JSON.stringify(tree, null, 2));
const sugg = computeSuggestions(full);
fs.writeFileSync(path.join(out, 'suggestions.json'), JSON.stringify(sugg.map(s => ({ ...s, from_name: by.get(s.from), to_name: by.get(s.to) })), null, 2));
const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(out, 'suggestions.csv'), '﻿' + ['id,kind,from,from_name,to,to_name,strength,rules,reasons',
  ...sugg.map(s => [s.id, s.kind, s.from, by.get(s.from), s.to, by.get(s.to), s.strength, s.rules.join('|'), s.reasons.join(' ')].map(q).join(','))].join('\n'));
console.log(`group_tree: ${tree.length} industries; suggestions: ${sugg.length}`);
