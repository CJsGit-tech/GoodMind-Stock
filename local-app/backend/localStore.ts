// Local stand-in for the AppDeploy database: one JSON file under .data/
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), '.data', 'store.json');
type Store = Record<string, Record<string, any>>;
function load(): Store {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(s: Store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s));
}
export const localDb = {
  get<T = any>(table: string, id: string): T | null { return (load()[table]?.[id] as T) ?? null; },
  set(table: string, id: string, value: unknown) {
    const s = load(); (s[table] ||= {})[id] = value; save(s);
  },
  patch(table: string, id: string, value: Record<string, unknown>) {
    const s = load(); const t = (s[table] ||= {}); t[id] = { ...(t[id] || {}), ...value }; save(s);
  },
};
