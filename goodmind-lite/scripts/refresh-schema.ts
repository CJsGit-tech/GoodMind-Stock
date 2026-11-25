// Usage: npx tsx scripts/refresh-schema.ts — re-applies the code-side v4 registry to data/seed.json (data untouched).
import fs from 'node:fs';
import { applySchema } from '../lib/ontology';
const f = 'data/seed.json';
fs.writeFileSync(f, JSON.stringify(applySchema(JSON.parse(fs.readFileSync(f, 'utf8'))), null, 2));
console.log('seed.json schema refreshed');
