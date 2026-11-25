// Ontology v4 data model.
// Every node and edge has a fixed core (id, type/predicate, name or endpoints) and free JSON `attributes`.
// `name` is Chinese (zh-TW); English and original-language names live in attributes (name_en, name_ja…).
export type Attrs = Record<string, unknown>;
export type GraphNode = { id: string; type: string; name: string; attributes: Attrs };
/** derived / suggested / symmetric are read-model flags: set on computed edges, never stored. */
export type GraphEdge = { id: string; predicate: string; from: string; to: string; attributes: Attrs; derived?: boolean; suggested?: boolean; symmetric?: boolean };

export type Datatype = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'url' | 'enum' | 'string[]' | 'ref[]' | 'object' | 'any';
export type PropertyDef = { name: string; datatype: Datatype; required?: boolean; values?: string[]; description: string };

/** Node type. `name` is the stable code key used in data (e.g. Company); `label` is the Chinese display name. */
export type EntityType = {
  name: string; id: string; label: string; label_en: string; definition: string;
  parent?: string; abstract?: boolean; status: string;
  naming_rule: string; extraction_rule: string; properties: PropertyDef[];
};
/** Relation type. `predicate` is the stable code key (e.g. SELLS); `label` is the Chinese display name.
 *  from / to list the allowed endpoint types (subclasses are accepted). */
export type EdgeType = {
  predicate: string; id: string; label: string; inverse_label?: string | null; label_en: string;
  group: string; from: string[]; to: string[]; storage: string; cardinality: string; meaning: string; meaning_en?: string;
  status: string; evidenceRequired?: boolean; symmetric?: boolean; inverse?: string | null; derivedBy?: string; properties?: PropertyDef[];
};
export type Graph = {
  nodes: GraphNode[]; edges: GraphEdge[]; entityTypes: EntityType[]; edgeTypes: EdgeType[];
  [k: string]: unknown;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ToolStep = { name: string; summary: string; nodeIds: string[]; edgeIds: string[] };
export type Citation = { n: number; id: string };          // id = edge id (relation) or node id
export type ChatResult = {
  answer: string;              // may contain [n] markers that refer to citations
  citations: Citation[];
  followUps: string[];
  nodeIds: string[];           // subset to display
  edgeIds: string[];           // relations the answer relied on (highlighted)
  toolCalls: ToolStep[];
  simulated: boolean;
};
/** A highlighted subset on the map: from a chat answer or a path. */
export type Subset = { kind: 'answer' | 'path'; label: string; nodeIds: string[]; edgeIds: string[] };
export const STORAGE_POLICIES = ['asserted', 'derived_only', 'query_derived_only', 'derived_or_asserted', 'asserted_or_derived', 'suggested_only'];
/** Relations that may be written by hand (through the write gate). */
export const WRITABLE_STORAGE = new Set(['asserted', 'asserted_or_derived', 'derived_or_asserted']);

/** V4 verification states (how reliable) — separate from lifecycle (what stage). */
export const VERIFICATION = ['verified', 'reported', 'inferred', 'suggested', 'disputed'];
export const LIFECYCLE = ['announced', 'active', 'completed', 'expired'];

/** Attribute accessor. */
export const at = (x: { attributes?: Attrs } | null | undefined, k: string): unknown => x?.attributes?.[k];
export const atStr = (x: { attributes?: Attrs } | null | undefined, k: string, d = ''): string => { const v = at(x, k); return v === undefined || v === null ? d : String(v); };
export const atList = (x: { attributes?: Attrs } | null | undefined, k: string): string[] => { const v = at(x, k); return Array.isArray(v) ? v.map(String) : []; };

/** Class hierarchy: true when t is ancestor or a subclass of it (Product → Offering). */
export function isA(types: EntityType[], t: string | undefined, ancestor: string): boolean {
  for (let cur = t, i = 0; cur && i < 8; i++) { if (cur === ancestor) return true; cur = types.find(x => x.name === cur)?.parent; }
  return false;
}
/** True when node type t is accepted by any of the allowed endpoint types. */
export const isAny = (types: EntityType[], t: string | undefined, allowed: string[]) => allowed.some(a => isA(types, t, a));
/** Display helpers: Chinese label for a type key / relation key. */
export const typeLabel = (types: EntityType[], key: string) => types.find(t => t.name === key)?.label ?? key;
export const relLabel = (preds: EdgeType[], key: string) => preds.find(p => p.predicate === key)?.label ?? key;
