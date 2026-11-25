// Shared helpers. Scripts run from the app folder (goodmind-lite/) so they use the app's real ontology and write gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function appLib(name: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const file = path.join(process.cwd(), 'lib', `${name}.ts`);
  if (!fs.existsSync(file)) { console.error(`run this from the app folder (goodmind-lite/): ${file} not found`); process.exit(2); }
  const m = await import(pathToFileURL(file).href);
  return m.default ?? m;
}
export const readJson = <T>(file: string, fallback?: T): T => {
  if (!fs.existsSync(file)) { if (fallback !== undefined) return fallback; console.error(`missing ${file}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
};
export const writeJson = (file: string, v: unknown) => fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n');
export const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
/** --graph <file> checks against another graph file; the default is the app's data/db.json. Read-only. */
export function loadGraph(): { graph: any; file: string } {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const i = process.argv.indexOf('--graph');
  const file = i > 0 ? process.argv[i + 1] : path.join(process.cwd(), 'data/db.json');
  return { graph: readJson(file), file };
}
export type Op = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
export const keyOf = (o: Op): string => o.op === 'createNode' ? o.node.id : o.op === 'updateNode' ? `update:${o.id}` : `${o.edge.predicate}|${o.edge.from}|${o.edge.to}`;
export const attrsOf = (o: Op): Record<string, unknown> => (o.op === 'createNode' ? o.node.attributes : o.op === 'updateNode' ? o.attributes : o.edge.attributes) ?? {};
export const normUrl = (u: unknown) => String(u ?? '').trim().replace(/#.*$/, '').replace(/\/+$/, '').replace(/^http:/, 'https:').replace('://www.', '://').toLowerCase();
