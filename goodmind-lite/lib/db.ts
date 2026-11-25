// Local "DB": data/db.json (copied from data/seed.json on first run).
import fs from 'node:fs';
import path from 'node:path';
import type { Graph } from './types';
import { isAny, STORAGE_POLICIES } from './types';
import { applySchema, ONTOLOGY_VERSION, schemaHash } from './ontology';
import { migrateToV4 } from './migrate-v4';

const DIR = path.join(process.cwd(), 'data');
const DB = path.join(DIR, 'db.json');
const SEED = path.join(DIR, 'seed.json');

export function readDb(): Graph {
  if (!fs.existsSync(DB)) fs.copyFileSync(SEED, DB);
  const g = JSON.parse(fs.readFileSync(DB, 'utf8')) as Graph;
  if (g.ontology_version !== ONTOLOGY_VERSION || g.schema_hash !== schemaHash()) {
    // 4.x: refresh the schema only; older data: full v2 → v4 migration (names, attributes, canonical ids).
    const up = String(g.ontology_version ?? '').startsWith('4.') ? applySchema(g) : migrateToV4(g).graph;
    writeDb(up); return up;
  }
  return g;
}
export function writeDb(g: Graph) { fs.writeFileSync(DB, JSON.stringify(g, null, 2)); }
export function resetDb(): Graph { fs.copyFileSync(SEED, DB); return readDb(); }

/** The workspace only manages the ontology; this checks it never contradicts the stored data. */
export function validateOntology(g: Graph): string[] {
  const errors: string[] = [];
  const types = new Map(g.entityTypes.map(t => [t.name, t]));
  const preds = new Map(g.edgeTypes.map(p => [p.predicate, p]));
  if (types.size !== g.entityTypes.length) errors.push('節點類型代號重複。');
  if (preds.size !== g.edgeTypes.length) errors.push('關係代號重複。');
  for (const t of g.entityTypes) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,59}$/.test(t.name)) errors.push(`類型代號「${t.name}」只能用英文字母與數字，並以字母開頭。`);
    if (!t.label?.trim()) errors.push(`類型「${t.name}」需要中文名稱。`);
    if (!t.definition?.trim()) errors.push(`類型「${t.name}」需要說明（為什麼要有）。`);
    if (t.parent && !types.has(t.parent)) errors.push(`類型「${t.name}」的上層「${t.parent}」不存在。`);
  }
  for (const p of g.edgeTypes) {
    if (!/^[A-Z][A-Z0-9_]{0,59}$/.test(p.predicate)) errors.push(`關係代號「${p.predicate}」要用 UPPER_SNAKE_CASE。`);
    if (!p.label?.trim()) errors.push(`關係「${p.predicate}」需要中文名稱。`);
    if (!p.from.length || !p.to.length || ![...p.from, ...p.to].every(t => types.has(t))) errors.push(`${p.predicate}：兩端的節點類型必須存在。`);
    if (!STORAGE_POLICIES.includes(p.storage)) errors.push(`${p.predicate}：儲存方式不合法。`);
    if (!p.group?.trim() || !p.meaning?.trim()) errors.push(`${p.predicate}：需要群組與說明。`);
  }
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  for (const n of g.nodes) if (!types.has(n.type)) errors.push(`節點 ${n.id} 使用了被刪除的類型「${n.type}」。`);
  for (const e of g.edges) {
    const p = preds.get(e.predicate);
    if (!p) { errors.push(`關係 ${e.id} 使用了被刪除的關係「${e.predicate}」。`); continue; }
    if (!isAny(g.entityTypes, byId.get(e.from)?.type, p.from) || !isAny(g.entityTypes, byId.get(e.to)?.type, p.to))
      errors.push(`${e.id}（${p.label}）將不再符合 ${p.from.join('/')} → ${p.to.join('/')}。`);
  }
  for (const t of g.entityTypes) {
    const names = (t.properties ?? []).map(p => p.name);
    if (new Set(names).size !== names.length) errors.push(`${t.name}：欄位名稱重複。`);
    for (const p of t.properties ?? []) if (p.datatype === 'enum' && !p.values?.length) errors.push(`${t.name}.${p.name}：選項欄位需要選項值。`);
  }
  return [...new Set(errors)].slice(0, 12);
}
