// Local "DB": data/db.json (copied from data/seed.json on first run).
import fs from 'node:fs';
import path from 'node:path';
import type { Graph } from './types';
import { isAny, STORAGE_POLICIES } from './types';
import { applySchema, ONTOLOGY_VERSION, schemaHash } from './ontology';

const DIR = path.join(process.cwd(), 'data');
const DB = path.join(DIR, 'db.json');
const SEED = path.join(DIR, 'seed.json');

export function readDb(): Graph {
  if (!fs.existsSync(DB)) fs.copyFileSync(SEED, DB);
  const g = JSON.parse(fs.readFileSync(DB, 'utf8')) as Graph;
  if (g.ontology_version !== ONTOLOGY_VERSION || g.schema_hash !== schemaHash()) {
    // Refresh the schema stored with the data. Data from before ontology 4.0 is not supported.
    if (!String(g.ontology_version ?? '').startsWith('4.')) throw new Error('data/db.json is not ontology 4.x data.');
    const up = applySchema(g);
    writeDb(up); return up;
  }
  return g;
}
export function writeDb(g: Graph) { fs.writeFileSync(DB, JSON.stringify(g, null, 2)); }
export function resetDb(): Graph { fs.copyFileSync(SEED, DB); return readDb(); }
