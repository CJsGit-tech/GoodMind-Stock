// Graph storage, lookup, drafts and publishing. Every other backend file goes through here.
// Records are read by chosen ID (db.get); nothing is found by scanning. Readers only ever see the snapshot.
import { createHash } from 'node:crypto';
import { db, storage } from '@appdeploy/sdk';
import type { Book, BookPage, Decision, Detection, Draft, DraftPackage, DraftSummary, DraftView, GraphLink, GraphNode, LibraryItem, LocalGraph, LookupResult, NodePage, NodeType, PreviewGraph, SearchEntry, Seg, Snapshot, TextAttr } from '../shared/graph.ts';
import { decidedCount } from '../shared/graph.ts';

export const T = { nodes: 'kg_nodes', aliases: 'kg_aliases', links: 'kg_links', attrs: 'kg_attrs', books: 'kg_books', drafts: 'kg_drafts', meta: 'kg_meta', sessions: 'kg_owner_sessions' } as const;
const NODE_TYPES: NodeType[] = ['company', 'etf', 'inst', 'concept'];
const LOCAL_CAP = 60;

export class Refused extends Error { constructor(readonly status: number, message: string, readonly data: Record<string, unknown> = {}) { super(message); } }

// ---------- identity ----------
export const norm = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20);
/** A node's ID comes from its official name, so the same name can never become two nodes. */
export const nodeId = (name: string) => 'n' + hash(norm(name));
export const aliasId = (alias: string) => 'a' + hash(norm(alias));
const linkId = (l: GraphLink) => 'l' + hash([l.from, l.to, l.kind, l.name || ''].join('|'));
const attrId = (a: TextAttr) => 't' + hash([a.nodeId, a.name, norm(a.value)].join('|'));
export const draftId = (requestId: string) => 'd' + hash(requestId);

// ---------- snapshot ----------
interface Meta { id: string; version: number; seq: number }
let cache: Snapshot | null = null;
export async function meta(): Promise<Meta | null> { return (await db.get<Meta>(T.meta, ['graph'], { consistent: true }))[0]; }
const snapshotPath = (version: number) => `kg/graph-v${version}.json`;
export async function snapshot(): Promise<Snapshot> {
  const m = await meta();
  if (!m) return { version: 0, nodes: [], books: [], links: [], attrs: [] };
  if (cache?.version === m.version) return cache;
  const [file] = await storage.read([snapshotPath(m.version)]);
  if (!file.content) throw new Error('Graph snapshot is missing.');
  return (cache = JSON.parse(file.content) as Snapshot);
}
const writeSnapshot = (s: Snapshot) => storage.write([{ path: snapshotPath(s.version), content: JSON.stringify(s), contentType: 'application/json' }]);
export const resetCache = () => { cache = null; };

// ---------- lookup ----------
const bigrams = (s: string) => { const t = norm(s).replace(/\s/g, ''); const out = new Set<string>(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
function similarity(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if ((x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) / Math.max(x.length, y.length) >= 0.6) return 0.9;
  const p = bigrams(a), q = bigrams(b); if (!p.size || !q.size) return 0;
  let both = 0; p.forEach(g => { if (q.has(g)) both++; });
  return (2 * both) / (p.size + q.size);
}
/** Exact name first, then alias, then close matches. Exact and alias checks read the live records, not the snapshot. */
export async function lookup(name: string): Promise<LookupResult> {
  const [node] = await db.get<GraphNode>(T.nodes, [nodeId(name)], { consistent: true });
  if (node) return { name, match: 'exact', node, close: [] };
  const [alias] = await db.get<{ nodeId: string }>(T.aliases, [aliasId(name)], { consistent: true });
  if (alias) { const [owner] = await db.get<GraphNode>(T.nodes, [alias.nodeId], { consistent: true }); if (owner) return { name, match: 'alias', node: owner, close: [] }; }
  const snap = await snapshot();
  const close = snap.nodes.map(n => ({ n, s: Math.max(similarity(name, n.name), ...n.aliases.map(a => similarity(name, a))) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.n);
  return { name, match: 'none', close };
}

// ---------- drafts ----------
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
function validatePackage(p: any): DraftPackage {
  const bad = (why: string): never => { throw new Refused(400, 'Invalid draft package: ' + why); };
  if (!p || typeof p !== 'object') bad('not an object');
  const requestId = text(p.requestId, 120) ?? bad('requestId'), title = text(p.title, 200) ?? bad('title');
  if (!Array.isArray(p.detections) || p.detections.length < 1 || p.detections.length > 40) bad('1 to 40 detections');
  const ids = new Set<string>();
  const detections = p.detections.map((d: any) => {
    const id = text(d?.id, 60) ?? bad('detection id'), term = text(d.term, 80) ?? bad('detection term');
    if (ids.has(id)) bad('duplicate detection id'); ids.add(id);
    const attributes = Array.isArray(d.attributes) ? d.attributes.slice(0, 8).map((a: any) => ({ name: text(a?.name, 40) ?? bad('attribute name'), value: text(a.value, 80) ?? bad('attribute value') })) : undefined;
    const demoteHint = d.demoteHint ? { to: text(d.demoteHint.to, 60) ?? bad('demoteHint.to'), name: text(d.demoteHint.name, 40) ?? bad('demoteHint.name') } : undefined;
    return { id, term, sentence: text(d.sentence, 400) ?? '', nodeType: NODE_TYPES.includes(d.nodeType) ? d.nodeType : 'concept', note: text(d.note, 400) ?? '', attributes, demoteHint };
  });
  detections.forEach((d: any) => { if (d.demoteHint && (!ids.has(d.demoteHint.to) || d.demoteHint.to === d.id)) bad('demoteHint.to must name another detection'); });
  const paragraphs: Seg[][] = Array.isArray(p.paragraphs) ? p.paragraphs.slice(0, 200).map((para: any) => (Array.isArray(para) ? para : []).map((s: any) => ({ t: String(s?.t ?? '').slice(0, 2000), ...(typeof s?.d === 'string' && ids.has(s.d) ? { d: s.d } : {}) }))) : [];
  return { requestId, title, industry: text(p.industry, 60) ?? '', date: text(p.date, 40) ?? '', pages: Number.isInteger(p.pages) && p.pages > 0 && p.pages < 1000 ? p.pages : 1, excerpt: text(p.excerpt, 600) ?? '', paragraphs, detections };
}
async function propose(d: DraftPackage['detections'][number]): Promise<Detection> {
  const r = await lookup(d.term);
  if (r.match === 'exact') return { ...d, proposal: 'existing', targetId: r.node!.id, targetName: r.node!.name };
  if (r.match === 'alias') return { ...d, proposal: 'alias', targetId: r.node!.id, targetName: r.node!.name };
  if (r.close.length) return { ...d, proposal: 'close', targetId: r.close[0].id, targetName: r.close[0].name };
  return { ...d, proposal: 'new' };
}
/** One upload creates one private draft. A retry with the same requestId returns the first receipt. */
export async function uploadDraft(input: unknown) {
  const pkg = validatePackage(input);
  const id = draftId(pkg.requestId);
  const receipt = (d: Draft, duplicate: boolean) => ({ draftId: d.id, number: d.number, status: d.status, duplicate });
  const detections = await Promise.all(pkg.detections.map(propose));
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await db.get<Draft>(T.drafts, [id], { consistent: true });
    if (existing) return receipt(existing, true);
    const m = (await meta())!;
    const draft: Draft = { ...pkg, id, number: m.seq + 1, status: 'draft', version: 1, uploadedAt: Date.now(), detections };
    if (Buffer.byteLength(JSON.stringify(draft)) > 200 * 1024) throw new Refused(413, 'Draft package is too large.');
    try {
      await db.transact([db.tx.add(T.drafts, [draft as any]), db.tx.update(T.meta, [{ id: 'graph', record: { seq: m.seq + 1 }, if: { seq: m.seq } }], { patch: true })]);
      return receipt(draft, false);
    } catch (e: any) { if (!['AppDatabaseDuplicateId', 'AppDatabaseConditionFailed'].includes(e?.code)) throw e; }
  }
  throw new Refused(503, 'Upload could not be completed. Retry with the same requestId.');
}
async function listAll<R>(table: string): Promise<R[]> {
  const out: R[] = []; let nextToken: string | undefined;
  do { const page = await db.list<R>(table, { limit: 500, nextToken }); out.push(...(page.items as R[])); nextToken = page.nextToken; } while (nextToken);
  return out;
}
export async function listDrafts(): Promise<{ waiting: DraftSummary[]; last: DraftSummary | null }> {
  const all = (await listAll<Draft>(T.drafts)).sort((a, b) => b.uploadedAt - a.uploadedAt);
  const sum = (d: Draft): DraftSummary => ({ id: d.id, number: d.number, title: d.title, status: d.status, decided: decidedCount(d), total: d.detections.length, bookId: d.bookId });
  return { waiting: all.filter(d => d.status === 'draft').map(sum), last: all.filter(d => d.status !== 'draft').map(sum)[0] || null };
}
export async function getDraft(id: string): Promise<Draft> {
  const [d] = await db.get<Draft>(T.drafts, [id], { consistent: true });
  if (!d) throw new Refused(404, 'Draft not found.');
  return d;
}

// ---------- the plan: what a draft would add ----------
interface Plan { book: Book; newNodes: (GraphNode & { det: string })[]; aliasAdds: { nodeId: string; alias: string }[]; links: GraphLink[]; attrs: TextAttr[]; converted: TextAttr[]; resolved: Record<string, string> }
const DEFAULT: Record<Detection['proposal'], Decision> = { existing: 'confirmed', alias: 'confirmed', new: 'confirmed', close: 'new' };
/** `assume` fills undecided rows with the agent's proposal, for the preview only. `useExisting` holds recheck answers. */
function plan(draft: Draft, snap: Snapshot, opts: { assume?: boolean; useExisting?: Record<string, string> } = {}): Plan {
  const bookId = 'b' + draft.id.slice(1);
  const book: Book = { id: bookId, title: draft.title, industry: draft.industry, date: draft.date, pages: draft.pages, excerpt: draft.excerpt, publishedAt: Date.now() };
  const byName = new Map(snap.nodes.map(n => [norm(n.name), n]));
  const p: Plan = { book, newNodes: [], aliasAdds: [], links: [], attrs: [], converted: [], resolved: {} };
  const mention = (d: Detection, to: string) => { p.resolved[d.id] = to; if (!p.links.some(l => l.kind === 'mention' && l.to === to)) p.links.push({ from: bookId, to, kind: 'mention', sentence: d.sentence }); };
  const decisionOf = (d: Detection) => d.decision || (opts.assume ? DEFAULT[d.proposal] : undefined);
  const create = (d: Detection) => {
    const name = d.rename || d.term, id = nodeId(name);
    const already = opts.useExisting?.[d.id] || byName.get(norm(name))?.id;
    if (already) return mention(d, already);
    if (!p.newNodes.some(n => n.id === id)) p.newNodes.push({ id, name, type: d.nodeType, aliases: [], det: d.id });
    mention(d, id);
  };
  for (const d of draft.detections) {
    const dec = decisionOf(d);
    if (!dec || dec === 'rejected' || dec === 'demoted') continue;
    if (d.proposal === 'existing' || d.proposal === 'alias') mention(d, d.targetId!);
    else if (d.proposal === 'close' && dec === 'same') { mention(d, d.targetId!); if (!p.aliasAdds.some(a => norm(a.alias) === norm(d.term))) p.aliasAdds.push({ nodeId: d.targetId!, alias: d.term }); }
    else create(d);
  }
  const nameToId = (value: string) => byName.get(norm(value))?.id || p.newNodes.find(n => norm(n.name) === norm(value))?.id;
  /** An attribute value equal to a node's official name is a link; anything else, including an alias, stays text. */
  const attribute = (owner: string, name: string, value: string) => {
    const target = nameToId(value);
    if (target && target !== owner) { if (!p.links.some(l => l.kind === 'attr' && l.from === owner && l.to === target && l.name === name)) p.links.push({ from: owner, to: target, kind: 'attr', name }); }
    else p.attrs.push({ nodeId: owner, name, value });
  };
  for (const d of draft.detections) {
    const dec = decisionOf(d), owner = p.resolved[d.id];
    if (owner && p.newNodes.some(n => n.id === owner && n.det === d.id)) (d.attributes || []).forEach(a => attribute(owner, a.name, a.value));
    if (dec === 'demoted' && d.demoteHint && p.resolved[d.demoteHint.to]) attribute(p.resolved[d.demoteHint.to], d.demoteHint.name, d.targetName || d.term);
  }
  // A plain-text attribute whose value is the name of a node published now becomes a link, with no further review.
  for (const n of p.newNodes) for (const a of snap.attrs) if (norm(a.value) === norm(n.name) && a.nodeId !== n.id) { p.converted.push(a); p.links.push({ from: a.nodeId, to: n.id, kind: 'attr', name: a.name }); }
  return p;
}
function apply(snap: Snapshot, p: Plan, paragraphsText: string): Snapshot {
  const nodes = snap.nodes.map(n => ({ ...n, aliases: [...n.aliases, ...p.aliasAdds.filter(a => a.nodeId === n.id).map(a => a.alias)] }));
  const gone = new Set(p.converted.map(attrId));
  return { version: snap.version + 1, nodes: [...nodes, ...p.newNodes.map(({ det, ...n }) => n)], books: [{ ...p.book, text: paragraphsText } as Book, ...snap.books],
    links: [...snap.links, ...p.links], attrs: [...snap.attrs.filter(a => !gone.has(attrId(a))), ...p.attrs] };
}

export async function draftView(draft: Draft): Promise<DraftView> {
  const snap = await snapshot();
  const p = plan(draft, snap, { assume: true });
  const ids = new Set<string>(p.links.flatMap(l => [l.from, l.to]));
  const fresh = new Map(p.newNodes.map(n => [n.id, n]));
  const nodes: PreviewGraph['nodes'] = [{ id: p.book.id, name: draft.title, type: 'concept', aliases: [], ghost: draft.status === 'draft', book: true }];
  ids.forEach(id => { const n = fresh.get(id) || snap.nodes.find(x => x.id === id); if (n) nodes.push({ id: n.id, name: n.name, type: n.type, aliases: n.aliases, ghost: fresh.has(id) && draft.status === 'draft' }); });
  const targetAttrs: DraftView['targetAttrs'] = {};
  draft.detections.filter(d => d.proposal === 'close' && d.targetId).forEach(d => {
    const target = snap.nodes.find(n => n.id === d.targetId);
    targetAttrs[d.id] = [...(target?.aliases.length ? [{ name: '別名', value: target.aliases.join('、') }] : []), ...nodeAttrs(snap, d.targetId!).map(({ name, value }) => ({ name, value }))]; });
  return { ...draft, preview: { nodes, links: p.links.map(l => ({ ...l, ghost: draft.status === 'draft' })) }, targetAttrs, newNodeCount: plan(draft, snap).newNodes.length };
}

const ALLOWED: Record<Detection['proposal'], Decision[]> = { existing: ['confirmed', 'rejected', 'demoted'], alias: ['confirmed', 'rejected'], new: ['confirmed', 'rejected', 'demoted'], close: ['same', 'new', 'rejected'] };
/** Saves one decision or one rename. A save made against an older version is refused, never merged. */
export async function decide(id: string, version: number, detectionId: string, change: { decision?: Decision | null; rename?: string }): Promise<Draft> {
  const draft = await getDraft(id);
  if (draft.status !== 'draft') throw new Refused(409, 'This draft is no longer open.', { code: 'closed' });
  const d = draft.detections.find(x => x.id === detectionId);
  if (!d) throw new Refused(404, 'Detection not found.');
  const next: Detection = { ...d };
  if (change.rename !== undefined) {
    if (d.proposal !== 'new' && d.proposal !== 'close') throw new Refused(400, 'Only a proposed new node can be renamed.');
    const name = text(change.rename, 80); if (!name) throw new Refused(400, 'The official name cannot be empty.');
    next.rename = name === d.term ? undefined : name;
  }
  if (change.decision !== undefined) {
    if (change.decision === null) delete next.decision;
    else {
      if (!ALLOWED[d.proposal].includes(change.decision) || (change.decision === 'demoted' && !d.demoteHint)) throw new Refused(400, 'That decision does not apply to this detection.');
      next.decision = change.decision;
    }
  }
  const record = { detections: draft.detections.map(x => (x.id === detectionId ? next : x)), version: draft.version + 1 };
  const [ok] = await db.tx.update(T.drafts, [{ id, record, if: { version } }], { patch: true });
  if (!ok) throw new Refused(409, 'This draft changed since you opened it. It has been reloaded.', { code: 'stale' });
  return { ...draft, ...record };
}
export async function discard(id: string, version: number): Promise<Draft> {
  const draft = await getDraft(id);
  if (draft.status !== 'draft') throw new Refused(409, 'This draft is no longer open.', { code: 'closed' });
  const [ok] = await db.tx.update(T.drafts, [{ id, record: { status: 'discarded', version: draft.version + 1 }, if: { version } }], { patch: true });
  if (!ok) throw new Refused(409, 'This draft changed since you opened it. It has been reloaded.', { code: 'stale' });
  return { ...draft, status: 'discarded', version: draft.version + 1 };
}

/**
 * Approval publishes the book with its nodes, aliases, attributes and links in one transaction, or nothing.
 * Before that, every proposed new node is checked against the live graph (not the snapshot the agent saw).
 */
export async function approve(id: string, version: number, useExisting: Record<string, boolean> = {}) {
  const draft = await getDraft(id);
  if (draft.status !== 'draft') throw new Refused(409, 'This draft is no longer open.', { code: 'closed' });
  if (draft.version !== version) throw new Refused(409, 'This draft changed since you opened it. It has been reloaded.', { code: 'stale' });
  if (decidedCount(draft) !== draft.detections.length) throw new Refused(409, 'Every detection must be decided before approval.', { code: 'undecided' });
  const snap = await snapshot();
  // A detection the agent proposed as new is asked about again if its name exists now, whether as a node or an alias.
  const conflicts: { detectionId: string; name: string; nodeId: string }[] = [], answers: Record<string, string> = {};
  for (const d of draft.detections) {
    if (!((d.proposal === 'new' && d.decision === 'confirmed') || (d.proposal === 'close' && d.decision === 'new'))) continue;
    const found = await lookup(d.rename || d.term);
    if (found.match === 'none') continue;
    if (useExisting[d.id]) answers[d.id] = found.node!.id; else conflicts.push({ detectionId: d.id, name: d.rename || d.term, nodeId: found.node!.id });
  }
  if (conflicts.length) return { status: 'recheck' as const, conflicts };
  const live = snap;
  const p = plan(draft, live, { useExisting: answers });
  const paragraphs = draft.paragraphs.map(para => para.map(s => ({ t: s.t, ...(s.d && p.resolved[s.d] ? { n: p.resolved[s.d] } : {}) })));
  const next = apply(live, p, draft.paragraphs.map(para => para.map(s => s.t).join('')).join('\n'));
  const aliasPatch = [...new Set(p.aliasAdds.map(a => a.nodeId))].map(nid => ({ id: nid, record: { aliases: next.nodes.find(n => n.id === nid)!.aliases } }));
  const ops = [
    db.tx.add(T.books, [p.book as any]),
    db.tx.update(T.drafts, [{ id, record: { status: 'published', bookId: p.book.id, version: draft.version + 1 }, if: { version } }], { patch: true }),
    db.tx.update(T.meta, [{ id: 'graph', record: { version: next.version }, if: { version: live.version } }], { patch: true }),
    ...(p.newNodes.length ? [db.tx.add(T.nodes, p.newNodes.map(({ det, ...n }) => n as any))] : []),
    ...(p.aliasAdds.length ? [db.tx.add(T.aliases, p.aliasAdds.map(a => ({ id: aliasId(a.alias), nodeId: a.nodeId, alias: a.alias }))), db.tx.update(T.nodes, aliasPatch, { patch: true })] : []),
    ...(p.links.length ? [db.tx.add(T.links, p.links.map(l => ({ id: linkId(l), ...l })))] : []),
    ...(p.attrs.length ? [db.tx.add(T.attrs, p.attrs.map(a => ({ id: attrId(a), ...a })))] : []),
    ...(p.converted.length ? [db.tx.delete(T.attrs, p.converted.map(attrId))] : []),
  ];
  // Files first, on new versioned paths. Readers switch only when the transaction moves the version.
  await storage.write([{ path: `kg/books/${p.book.id}.json`, content: JSON.stringify(paragraphs), contentType: 'application/json' }]);
  await writeSnapshot(next);
  if (process.env.KG_FAIL_NEXT_PUBLISH && process.env.POCKETSTOCKS_LOCAL_ORIGIN) { delete process.env.KG_FAIL_NEXT_PUBLISH; throw new Refused(500, 'Publishing did not finish.', { code: 'publish-failed' }); } // local staging test hook
  try { await db.transact(ops as any); } catch (e: any) {
    if (e?.code === 'AppDatabaseTransactionTooLarge') throw new Refused(413, 'This draft is too large to publish in one step.', { code: 'publish-failed' });
    throw new Refused(e?.code === 'AppDatabaseConditionFailed' ? 409 : 500, 'Publishing did not finish.', { code: 'publish-failed' });
  }
  cache = next;
  return { status: 'published' as const, bookId: p.book.id, newNodes: p.newNodes.length, version: next.version };
}

/** Reads every published record and writes a fresh snapshot. Used by the seed and by local simulations that change the graph outside a publish. */
export async function rebuildSnapshot(fromVersion: number, bump = false): Promise<Snapshot> {
  const [nodes, books, links, attrs] = await Promise.all([listAll<GraphNode>(T.nodes), listAll<Book>(T.books), listAll<GraphLink & { id?: string }>(T.links), listAll<TextAttr & { id?: string }>(T.attrs)]);
  const old = cache?.version === fromVersion ? cache : null;
  const textOf = new Map((old?.books || []).map(b => [b.id, (b as any).text]));
  const snap: Snapshot = { version: bump ? fromVersion + 1 : fromVersion, nodes: nodes.map(({ id, name, type, aliases }) => ({ id, name, type, aliases: aliases || [] })),
    books: books.sort((a, b) => b.publishedAt - a.publishedAt).map(b => ({ ...b, ...(textOf.get(b.id) ? { text: textOf.get(b.id) } : {}) }) as Book),
    links: links.map(({ from, to, kind, name, sentence }) => ({ from, to, kind, name, sentence })), attrs: attrs.map(({ nodeId: n, name, value }) => ({ nodeId: n, name, value })) };
  await writeSnapshot(snap); cache = snap;
  return snap;
}

// ---------- reader views, all from the snapshot ----------
const isBook = (snap: Snapshot, id: string) => snap.books.some(b => b.id === id);
function nodeAttrs(snap: Snapshot, id: string) {
  const name = (x: string) => snap.nodes.find(n => n.id === x)?.name || x;
  return [...snap.links.filter(l => l.kind === 'attr' && l.from === id).map(l => ({ name: l.name || '', value: name(l.to), valueId: l.to as string | undefined })),
    ...snap.attrs.filter(a => a.nodeId === id).map(a => ({ name: a.name, value: a.value, valueId: undefined as string | undefined }))];
}
export function nodePage(snap: Snapshot, id: string): NodePage | null {
  const node = snap.nodes.find(n => n.id === id); if (!node) return null;
  const mentions = snap.links.filter(l => l.kind === 'mention' && l.to === id).map(l => ({ l, b: snap.books.find(b => b.id === l.from)! })).filter(x => x.b).sort((a, b) => b.b.publishedAt - a.b.publishedAt);
  return { node, attrs: nodeAttrs(snap, id),
    books: mentions.map(({ b }) => ({ id: b.id, title: b.title, industry: b.industry, date: b.date })),
    backlinks: [...mentions.map(({ l, b }) => ({ id: b.id, title: b.title, context: l.sentence || b.excerpt, book: true })),
      ...snap.links.filter(l => l.kind === 'attr' && l.to === id).map(l => ({ id: l.from, title: snap.nodes.find(n => n.id === l.from)?.name || l.from, context: `${l.name} = ${node.name}`, book: false }))] };
}
const tagsOf = (snap: Snapshot, bookId: string) => snap.links.filter(l => l.kind === 'mention' && l.from === bookId).map(l => snap.nodes.find(n => n.id === l.to)!).filter(Boolean).map(n => ({ id: n.id, name: n.name }));
const publicBook = (b: Book): Book => { const { text: _t, ...rest } = b as Book & { text?: string }; return rest; };
export async function bookPage(snap: Snapshot, id: string): Promise<BookPage | null> {
  const book = snap.books.find(b => b.id === id); if (!book) return null;
  const tags = tagsOf(snap, id), mine = new Set(tags.map(t => t.id));
  const related = snap.books.filter(b => b.id !== id).map(b => ({ id: b.id, title: b.title, shared: tagsOf(snap, b.id).filter(t => mine.has(t.id)).map(t => t.name) })).filter(r => r.shared.length);
  const [file] = await storage.read([`kg/books/${id}.json`]);
  return { book: publicBook(book), tags, related, paragraphs: file.content ? JSON.parse(file.content) : [] };
}
export const library = (snap: Snapshot): LibraryItem[] => snap.books.map(b => ({ ...publicBook(b), tags: tagsOf(snap, b.id) }));
export function localGraph(snap: Snapshot, center: string, depth: number): LocalGraph | null {
  if (!snap.nodes.some(n => n.id === center) && !isBook(snap, center)) return null;
  const seen = new Set([center]); let frontier = [center], capped = false;
  for (let d = 0; d < depth && !capped; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const l of snap.links) {
      const o = l.from === id ? l.to : l.to === id ? l.from : null;
      if (!o || seen.has(o)) continue;
      if (seen.size >= LOCAL_CAP) { capped = true; break; }
      seen.add(o); next.push(o);
    }
    frontier = next;
  }
  const nodes: LocalGraph['nodes'] = [];
  seen.forEach(id => { const n = snap.nodes.find(x => x.id === id); const b = snap.books.find(x => x.id === id); if (n) nodes.push(n); else if (b) nodes.push({ id: b.id, name: b.title, type: 'concept', aliases: [], book: true }); });
  return { center, nodes, links: snap.links.filter(l => seen.has(l.from) && seen.has(l.to)).map(({ from, to, kind, name }) => ({ from, to, kind, name })), capped };
}
export const searchEntries = (snap: Snapshot): SearchEntry[] => [
  ...snap.nodes.map(n => ({ kind: 'node' as const, id: n.id, label: n.name, sub: n.type, aliases: n.aliases, text: '' })),
  ...snap.books.map(b => ({ kind: 'book' as const, id: b.id, label: b.title, sub: b.excerpt, aliases: [], text: [b.industry, b.excerpt, (b as any).text || ''].join(' ') })),
];
/** The graph readers see: nodes, books as squares, and links without sentences. */
export const publicGraph = (snap: Snapshot) => ({ version: snap.version, nodes: snap.nodes, books: snap.books.map(b => ({ id: b.id, title: b.title })), links: snap.links.map(({ from, to, kind }) => ({ from, to, kind })) });
