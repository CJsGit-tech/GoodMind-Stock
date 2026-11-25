// Workspace logic: manages ONLY the allowed node types and relations (the registry). Nodes/edges are
// written through /api/write (lib/write.ts), never here.
import { z } from 'zod';
import { readDb, resetDb, validateOntology, writeDb } from '../lib/db';
import { STORAGE_POLICIES } from '../lib/types';
import type { EdgeType, EntityType } from '../lib/types';

// passthrough keeps schema fields the editor does not show (properties, naming rules, traits).
const type = z.object({ name: z.string().trim(), label: z.string().trim(), label_en: z.string().trim().default(''), definition: z.string().trim() }).passthrough();
const pred = z.object({ group: z.string().trim(), predicate: z.string().trim(), label: z.string().trim(), from: z.array(z.string()).min(1), to: z.array(z.string()).min(1), storage: z.enum(STORAGE_POLICIES as [string, ...string[]]), meaning: z.string().trim() }).passthrough();
export const ontologyAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsertType'), item: type, originalName: z.string().optional() }),
  z.object({ action: z.literal('deleteType'), name: z.string() }),
  z.object({ action: z.literal('upsertPredicate'), item: pred, originalName: z.string().optional() }),
  z.object({ action: z.literal('deletePredicate'), name: z.string() }),
  z.object({ action: z.literal('reset') }),
]);

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export function applyOntology(a: z.infer<typeof ontologyAction>): { status: number; body: unknown } {
  const fail = (...errors: string[]) => ({ status: 400, body: { errors } });
  if (a.action === 'reset') { const g = resetDb(); return { status: 200, body: { entityTypes: g.entityTypes, edgeTypes: g.edgeTypes } }; }
  const g = readDb();
  if (a.action === 'upsertType') {
    const old = a.originalName ?? a.item.name;
    const i = g.entityTypes.findIndex(t => t.name === old);
    if (a.originalName && a.originalName !== a.item.name) {
      if (g.entityTypes.some(t => t.name === a.item.name)) return fail(`類型「${a.item.name}」已存在。`);
      g.nodes.forEach(n => { if (n.type === old) n.type = a.item.name; });
      g.edgeTypes.forEach(e => { e.from = e.from.map(t => (t === old ? a.item.name : t)); e.to = e.to.map(t => (t === old ? a.item.name : t)); });
      g.entityTypes.forEach(t => { if (t.parent === old) t.parent = a.item.name; });
    } else if (i < 0 && g.entityTypes.some(t => t.name === a.item.name)) return fail(`類型「${a.item.name}」已存在。`);
    const base: EntityType = i >= 0 ? g.entityTypes[i] : { name: a.item.name, id: `type:${snake(a.item.name)}`, label: '', label_en: '', definition: '', status: '自訂', naming_rule: '中文優先', extraction_rule: '', properties: [] };
    const next = { ...base, ...a.item, id: `type:${snake(a.item.name)}` } as EntityType;
    if (i >= 0) g.entityTypes[i] = next; else g.entityTypes.push(next);
  }
  if (a.action === 'deleteType') {
    const nodes = g.nodes.filter(n => n.type === a.name).length, preds = g.edgeTypes.filter(e => e.from.includes(a.name) || e.to.includes(a.name)).length;
    if (nodes || preds) return fail(`無法刪除「${a.name}」：還有 ${nodes} 個節點、${preds} 種關係在使用。`);
    g.entityTypes = g.entityTypes.filter(t => t.name !== a.name);
  }
  if (a.action === 'upsertPredicate') {
    const old = a.originalName ?? a.item.predicate;
    const i = g.edgeTypes.findIndex(t => t.predicate === old);
    if (a.originalName && a.originalName !== a.item.predicate) {
      if (g.edgeTypes.some(t => t.predicate === a.item.predicate)) return fail(`關係「${a.item.predicate}」已存在。`);
      g.edges.forEach(e => { if (e.predicate === old) e.predicate = a.item.predicate; });
    } else if (i < 0 && g.edgeTypes.some(t => t.predicate === a.item.predicate)) return fail(`關係「${a.item.predicate}」已存在。`);
    const base: EdgeType = i >= 0 ? g.edgeTypes[i] : { predicate: a.item.predicate, id: '', label: '', label_en: a.item.predicate, group: '', from: [], to: [], storage: 'asserted', cardinality: '多對多', meaning: '', status: '自訂' };
    const next = { ...base, ...a.item, id: `rel:${a.item.predicate.toLowerCase()}` } as EdgeType;
    if (i >= 0) g.edgeTypes[i] = next; else g.edgeTypes.push(next);
  }
  if (a.action === 'deletePredicate') {
    const used = g.edges.filter(e => e.predicate === a.name).length;
    if (used) return fail(`無法刪除「${a.name}」：還有 ${used} 條關係在使用。`);
    g.edgeTypes = g.edgeTypes.filter(t => t.predicate !== a.name);
  }
  const errors = validateOntology(g);
  if (errors.length) return fail(...errors);
  writeDb(g);
  return { status: 200, body: { entityTypes: g.entityTypes, edgeTypes: g.edgeTypes } };
}
