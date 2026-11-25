// Usage (from the repository root): npx tsx <skill>/scripts/package.ts <run-dir> [--graph file] [--taxonomy file]
// Sorts draft operations into ready / held and writes <run-dir>/out/. Saves nothing to the graph.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appLib, attrsOf, keyOf, loadGraph, normUrl, readJson, sha, writeJson } from './common';
import type { Op } from './common';
import { isDateKey, quoteStates } from './dates';

(async () => {
  const run = process.argv[2];
  if (!run) { console.error('usage: package.ts <run-dir> [--graph file] [--taxonomy file]'); process.exit(2); }
  const ti = process.argv.indexOf('--taxonomy');
  const taxonomyFile = ti > 0 ? process.argv[ti + 1] : fileURLToPath(new URL('../taxonomy.json', import.meta.url));
  type Entry = { id: string; name: string; industry?: string };
  const taxonomy = readJson<{ approved: { industries: Entry[]; segments: Entry[] } }>(taxonomyFile).approved;
  const { applyWrites } = await appLib('write'), { validateData } = await appLib('validate'), ontology = await appLib('ontology');
  const loaded = loadGraph(), graph = ontology.applySchema(loaded.graph);
  const R = (f: string) => path.join(run, f);
  const draft: Op[] = readJson<{ ops: Op[] }>(R('draft.json')).ops;
  const sources = readJson<any[]>(R('sources.json'));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const claims = readJson<any[]>(R('claims.json'));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const decisions = readJson<Record<string, { same_as?: string; distinct?: boolean; reason?: string }>>(R('decisions.json'), {});
  const verdicts = readJson<any[]>(R('verdicts.json'), []);   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!fs.existsSync(R('matches.json'))) { console.error('run match.ts first'); process.exit(2); }
  const matches = readJson<Record<string, { id: string; why: string }[]>>(R('matches.json'));
  if (fs.statSync(R('matches.json')).mtimeMs < fs.statSync(R('draft.json')).mtimeMs) { console.error('draft.json changed after match.ts ran; run match.ts again'); process.exit(2); }

  const sourceById = new Map(sources.map(s => [s.id, s])), claimById = new Map(claims.map(c => [c.id, c]));
  const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
  const textCache = new Map<string, string>();
  const sourceText = (s: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!textCache.has(s.id)) { const f = s.text_file ? R(s.text_file) : ''; textCache.set(s.id, f && fs.existsSync(f) ? squash(fs.readFileSync(f, 'utf8')) : ''); }
    return textCache.get(s.id)!;
  };

  // a reader must reach the quoted text from the published link: downloaded from it, or a local copy that matched a download
  const reaches = (s: any) => s.captured?.from === 'download' || (s.captured?.from === 'local copy' && s.captured?.url_check === 'same document');   // eslint-disable-line @typescript-eslint/no-explicit-any
  const held = new Map<string, { op: Op; reasons: string[]; unblock: string[] }>();
  const hold = (o: Op, reason: string, unblock: string) => { const k = keyOf(o); const h = held.get(k) ?? { op: o, reasons: [], unblock: [] }; if (!h.reasons.includes(reason)) h.reasons.push(reason); if (!h.unblock.includes(unblock)) h.unblock.push(unblock); held.set(k, h); };

  // 1. apply duplicate decisions: merged nodes disappear and references move to the kept record
  const merged = new Map<string, string>();
  for (const [id, d] of Object.entries(decisions)) if (d.same_as) merged.set(id, d.same_as);
  const to = (x: string) => merged.get(x) ?? x;
  const remap = (a: Record<string, unknown>) => Array.isArray(a.evidence_ids) ? { ...a, evidence_ids: [...new Set((a.evidence_ids as string[]).map(to))] } : a;
  let ops: Op[] = draft.filter(o => !(o.op === 'createNode' && merged.has(o.node.id))).map(o =>
    o.op === 'createNode' ? { ...o, node: { ...o.node, attributes: remap(attrsOf(o)) } }
      : o.op === 'updateNode' ? { ...o, id: to(o.id), attributes: remap(attrsOf(o)) }
        : { ...o, edge: { ...o.edge, from: to(o.edge.from), to: to(o.edge.to), attributes: remap(attrsOf(o)) } });

  const urlOfEvidence = new Map<string, string>();
  for (const n of graph.nodes) if (n.type === 'Evidence') urlOfEvidence.set(n.id, normUrl(n.attributes.url));
  for (const o of ops) if (o.op === 'createNode' && o.node.type === 'Evidence') urlOfEvidence.set(o.node.id, normUrl(attrsOf(o).url));

  // 2. mechanical checks
  const queue: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const o of ops) {
    const key = keyOf(o);
    if (o.op === 'createNode' && matches[o.node.id]?.length && !decisions[o.node.id]?.distinct)
      hold(o, `possible duplicate of ${matches[o.node.id].map(m => m.id).join(', ')}`, 'record same_as or distinct in decisions.json');
    if (o.op === 'createNode' && (o.node.type === 'Industry' || o.node.type === 'MarketSegment')) {
      const list = o.node.type === 'Industry' ? taxonomy.industries : taxonomy.segments;
      if (!list.some(x => x.id === o.node.id && x.name === o.node.name)) hold(o, 'category not on the approved list', 'reuse an approved or existing category, or propose it in taxonomy-proposals.md for the user to approve');
    }
    if (o.op === 'createEdge' && o.edge.predicate === 'SEGMENT_OF_INDUSTRY') {
      const listed = taxonomy.segments.find(x => x.id === o.edge.from);
      if (listed && listed.industry !== o.edge.to) hold(o, `category not on the approved list: ${o.edge.from} belongs to ${listed.industry}`, 'link the segment to its approved industry');
    }
    if (o.op === 'createNode' && o.node.type === 'Evidence') {
      const url = normUrl(attrsOf(o).url);
      const saved = sources.filter(s => s.public === true && normUrl(s.url) === url && sourceText(s));
      if (!saved.length) hold(o, 'no public source with saved text for this url', 'add it to sources.json with text_file');
      else if (!saved.some(reaches)) hold(o, 'link not shown to open the cited document', 'save it with fetch_source.py from a url that returns the document itself');
      continue;
    }
    const cs = ((o.claims ?? []) as string[]).map(id => claimById.get(id));
    if (!cs.length || cs.some(c => !c)) { hold(o, 'no claims, or a claim id that does not exist', 'link the operation to claims.json'); continue; }
    const evidence = (attrsOf(o).evidence_ids ?? []) as string[];
    const citable = cs.some(c => { const s = sourceById.get(c.source); return s?.public === true && s.url; });
    if (!evidence.length && citable) hold(o, 'no evidence_ids', 'cite the Evidence node for the claim source');
    const used: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const c of cs) {
      const s = sourceById.get(c.source);
      const quoted = !!s && !!c.quote && squash(c.quote).length >= 8 && sourceText(s).includes(squash(c.quote));
      if (s && s.text_file && !quoted) hold(o, `claim ${c.id}: quote not found in the saved source text`, 'copy the quote exactly from the source');
      if (!s || s.public !== true || !s.url) { hold(o, `claim ${c.id}: no public source`, 'find a public source that says this'); continue; }
      if (!s.text_file && !quoted) hold(o, `claim ${c.id}: quote not found in the saved source text`, 'save the source text with fetch_source.py');
      if (!reaches(s)) hold(o, `claim ${c.id}: link not shown to open the cited document`, 'save it with fetch_source.py from a url that returns the document itself');
      if (!evidence.some(e => urlOfEvidence.get(e) === normUrl(s.url))) hold(o, `claim ${c.id}: its source is not among evidence_ids`, 'cite the Evidence node with the same url');
      used.push({ ...c, source_url: s.url, source_title: s.title, source_text_file: s.text_file });
    }
    const quotes = cs.map(c => String(c.quote ?? ''));
    for (const [k, value] of Object.entries(attrsOf(o))) {
      if (!isDateKey(k) || typeof value !== 'string' || !value) continue;
      // an update that repeats the stored value is not adding a date
      if (o.op === 'updateNode' && graph.nodes.find((n: any) => n.id === o.id)?.attributes?.[k] === value) continue;   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!quoteStates(value, quotes)) hold(o, `date not stated in a cited quote: ${k} ${value}`, 'cite a quote that states this date for this fact, or remove the date');
    }
    if (!held.has(key)) {
      const { claims: _c, ...record } = o;
      queue.push({ key, checked_on: new Date().toISOString().slice(0, 10), fingerprint: sha(JSON.stringify([record, used])).slice(0, 16), record, claims: used });
    }
  }

  const anyNode = new Map<string, any>([...graph.nodes, ...ops.filter(o => o.op === 'createNode').map(o => ({ ...o.node, proposed: true }))].map((n: any) => [n.id, n]));   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const q of queue) {
    const r = q.record, refs: string[] = r.op === 'createEdge' ? [r.edge.from, r.edge.to] : r.op === 'updateNode' ? [r.id] : [];
    if (refs.length) q.context = refs.map(id => { const n = anyNode.get(id); return n ? { id, type: n.type, name: n.name, in_graph: !n.proposed, name_en: n.attributes?.name_en, stage: n.attributes?.stage, scope: n.attributes?.scope } : { id, missing: true }; });
  }
  const pending = queue.filter(q => !verdicts.some(x => x.key === q.key && x.fingerprint === q.fingerprint));

  // 3. independent verdicts (must match the current fingerprint)
  const opByKey = new Map(ops.map(o => [keyOf(o), o]));
  for (const q of queue) {
    const v = verdicts.filter(x => x.key === q.key && x.fingerprint === q.fingerprint);
    if (!v.length) hold(opByKey.get(q.key), 'not verified yet', 'run the verifier on out/verify-queue.json');
    else if (v.some(x => x.verdict !== 'pass')) hold(opByKey.get(q.key), `verifier failed it: ${v.filter(x => x.verdict !== 'pass').map(x => x.reason).join('; ')}`, 'correct the record to what the source supports, then verify again');
  }

  // 4. hold dependents, then let the real write gate refuse what remains, until nothing changes
  const known = new Set<string>(graph.nodes.map((n: any) => n.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const order = (o: Op) => o.op === 'createNode' ? (o.node.type === 'Evidence' ? 0 : 1) : o.op === 'updateNode' ? 2 : 3;
  ops = [...ops].sort((a, b) => order(a) - order(b));
  let result: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
  let ready: Op[] = [];
  for (;;) {
    const before = held.size;
    const okNodes = new Set([...known, ...ops.filter(o => o.op === 'createNode' && !held.has(keyOf(o))).map(o => o.node.id)]);
    for (const o of ops) {
      if (held.has(keyOf(o))) continue;
      const refs = [...((attrsOf(o).evidence_ids ?? []) as string[]), ...(o.op === 'createEdge' ? [o.edge.from, o.edge.to] : o.op === 'updateNode' ? [o.id] : [])];
      const missing = refs.filter(r => !okNodes.has(r));
      if (missing.length) hold(o, `depends on held or missing ${[...new Set(missing)].join(', ')}`, 'resolve those records first');
    }
    // a new node must not go up disconnected: offerings need a company, everything else needs at least one relation
    const live = [...graph.edges, ...ops.filter(o => o.op === 'createEdge' && !held.has(keyOf(o))).map(o => o.edge)];
    const typeOf = new Map<string, string>([...graph.nodes, ...ops.filter(o => o.op === 'createNode').map(o => o.node)].map((n: any) => [n.id, n.type]));   // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const o of ops) {
      if (held.has(keyOf(o)) || o.op !== 'createNode' || o.node.type === 'Evidence') continue;
      const mine = live.filter(e => e.from === o.node.id || e.to === o.node.id);
      if (['Product', 'Service', 'BusinessLine'].includes(o.node.type)) {
        if (!mine.some(e => e.to === o.node.id && typeOf.get(e.from) === 'Company')) hold(o, 'disconnected: no ready relation from a company', 'get a company relation for it ready (sells, offers, makes, operates)');
      } else if (!mine.length) hold(o, 'disconnected: no ready relation', 'get at least one of its relations ready');
    }
    if (held.size !== before) continue;
    ready = ops.filter(o => !held.has(keyOf(o)));
    result = applyWrites(graph, ready.map(({ claims: _c, ...o }) => o), 'goodmind-data');
    if (result.ok) break;
    let moved = false;
    for (const err of result.errors as string[]) {
      const m = err.match(/^#(\d+) (.*)$/);
      let target = m ? ready[Number(m[1]) - 1] : undefined;
      if (!m) target = ready.find(o => o.op === 'createNode' && err.startsWith(`${o.node.name}：`));   // record missing its required relations
      if (target && !held.has(keyOf(target))) { hold(target, `write gate: ${m ? m[2] : err}`, 'fix the record'); moved = true; }
    }
    if (!moved) { console.error('write gate refused the batch for reasons not tied to one record:', result.errors); process.exit(1); }
  }
  // evidence that no ready record uses stays out
  const cited = new Set(ready.flatMap(o => (attrsOf(o).evidence_ids ?? []) as string[]));
  for (const o of ready) if (o.op === 'createNode' && o.node.type === 'Evidence' && !cited.has(o.node.id)) hold(o, 'no ready record cites it', 'ready once a record that cites it is ready');
  ready = ready.filter(o => !held.has(keyOf(o)));
  result = applyWrites(graph, ready.map(({ claims: _c, ...o }) => o), 'goodmind-data');
  if (!result.ok) { console.error(result.errors); process.exit(1); }

  // 5. outputs
  const touched = new Set(ready.filter(o => o.op !== 'createEdge').map(o => (o.op === 'createNode' ? o.node.id : o.id)));
  const allGaps = validateData(result.graph).issues.filter((i: any) => touched.has(i.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
  // records that only gain relations are not new or updated, but their remaining gaps still matter
  // one ownership step further too: the company behind a linked offering, and that company's other offerings
  const near = new Set<string>([...touched, ...ready.filter(o => o.op === 'createEdge').flatMap(o => [o.edge.from, o.edge.to])]);
  const owns = result.graph.edges.filter((e: any) => ['SELLS', 'BRANDS', 'OFFERS_SERVICE', 'MANUFACTURES', 'DESIGNS', 'DISTRIBUTES', 'OPERATES_BUSINESS_LINE'].includes(e.predicate));   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const e of owns) if (near.has(e.to)) near.add(e.from);
  const companies = new Set([...near]);
  for (const e of owns) if (companies.has(e.from)) near.add(e.to);
  const endpoints = new Set<string>([...near].filter(id => !touched.has(id)));
  const otherGaps = validateData(result.graph).issues.filter((i: any) => endpoints.has(i.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const otherGapNodes = new Set<string>(otherGaps.map((i: any) => i.id)).size;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const evidenceIds = new Set<string>(ready.filter(o => o.op === 'createNode' && o.node.type === 'Evidence').map(o => o.node.id));
  const gaps = allGaps.filter((i: any) => !evidenceIds.has(i.id)), sourceNotes = allGaps.filter((i: any) => evidenceIds.has(i.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const gapIds = new Set<string>(gaps.map((i: any) => i.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
  const records = ready.filter(o => !(o.op === 'createNode' && o.node.type === 'Evidence'));
  const withGaps = records.filter(o => o.op !== 'createEdge' && gapIds.has(o.op === 'createNode' ? o.node.id : o.id)).length;
  const all = result.graph.edges, nameOf = new Map<string, any>([...anyNode, ...result.graph.nodes.map((n: any) => [n.id, n] as [string, any])]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  const OWNS = ['SELLS', 'BRANDS', 'OFFERS_SERVICE', 'MANUFACTURES', 'DESIGNS', 'DISTRIBUTES', 'OPERATES_BUSINESS_LINE'];
  const next = (id: string, preds: string[]) => all.filter((e: any) => e.from === id && preds.includes(e.predicate)).map((e: any) => e.to as string);   // eslint-disable-line @typescript-eslint/no-explicit-any
  const hasChain = (c: string) => next(c, OWNS).some(o => [...next(o, ['TARGETS_SEGMENT', 'BUSINESS_LINE_IN_SEGMENT']), ...next(o, ['IN_CATEGORY']).flatMap(k => next(k, ['CATEGORY_IN_SEGMENT']))].some(s => next(s, ['SEGMENT_OF_INDUSTRY']).length > 0));
  // companies this draft is about, held or not: those it updates, creates, or connects (including owners of offerings it classifies)
  const mentioned = new Set<string>(ops.flatMap(o => o.op === 'createEdge' ? [o.edge.from, o.edge.to] : [o.op === 'createNode' ? o.node.id : o.id]));
  for (const e of [...graph.edges, ...ops.filter(o => o.op === 'createEdge').map(o => o.edge)]) if (OWNS.includes(e.predicate) && mentioned.has(e.to)) mentioned.add(e.from);
  const chains = [...mentioned].filter(id => nameOf.get(id)?.type === 'Company').sort().map(id => ({ id, name: String(nameOf.get(id).name), complete: hasChain(id) }));
  fs.mkdirSync(R('out'), { recursive: true });
  writeJson(R('out/verify-queue.json'), pending);
  writeJson(R('out/verify-all.json'), queue);
  const draftTitle = readJson<{ title?: string }>(R('draft.json')).title;
  const title = draftTitle?.trim() || path.basename(path.resolve(run));
  const opsText = JSON.stringify({ source_folder: title, ops: ready.map(({ claims: _c, ...o }) => o) }, null, 1) + '\n';
  fs.writeFileSync(R('out/ops.json'), opsText);
  writeJson(R('out/held.json'), [...held].map(([key, h]) => ({ key, reasons: h.reasons, unblock: h.unblock, operation: h.op })));
  const why = new Map<string, number>();
  for (const h of held.values()) for (const k of new Set(h.reasons.map(r => r.replace(/claim \S+: /, '').replace(/(possible duplicate|depends on held or missing|verifier failed it|write gate|category not on the approved list|date not stated in a cited quote).*/, '$1')))) why.set(k, (why.get(k) ?? 0) + 1);
  const counts = { ready: records.length - withGaps, ready_with_gaps: withGaps, evidence: ready.length - records.length, held: held.size, merged: merged.size, existing_with_gaps: otherGapNodes, awaiting_verification: pending.length, companies: chains.length, companies_without_chain: chains.filter(c => !c.complete).length };
  const inputs = Object.fromEntries(['inventory.json', 'sources.json', 'claims.json', 'draft.json', 'decisions.json', 'verdicts.json', 'matches.json'].filter(f => fs.existsSync(R(f))).map(f => [f, sha(fs.readFileSync(R(f)))]));
  writeJson(R('out/manifest.json'), { created_at: new Date().toISOString(), ontology_version: ontology.ONTOLOGY_VERSION, schema_hash: ontology.schemaHash(), checked_against: { file: loaded.file, sha256: sha(fs.readFileSync(loaded.file)) }, counts, merged: Object.fromEntries(merged), inputs, ops_sha256: sha(opsText) });
  fs.writeFileSync(R('out/report.md'), [`# Refinement report: ${title}`, '',
    `Ready ${counts.ready} · Ready with gaps ${counts.ready_with_gaps} · Held ${counts.held} · Evidence ${counts.evidence} · Merged duplicates ${counts.merged}`, '',
    '## Company chains (company → offering or business line → segment → industry, after this batch)', '', ...(chains.length ? chains.map(c => `- ${c.complete ? 'complete' : 'INCOMPLETE'}: ${c.name} (${c.id})`) : ['- no companies in this draft']), '',
    '## Why records are held (records per reason; one record can have several)', '', ...(why.size ? [...why].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${n} × ${r}`) : ['- none']), '',
    '## Ready with gaps', '', ...(gaps.length ? gaps.map((i: any) => `- ${i.id}: ${i.message}`) : ['- none']), '',   // eslint-disable-line @typescript-eslint/no-explicit-any
    '## Related existing nodes that still have gaps (linked by this batch, their owners, and those owners\' other offerings)', '', ...(otherGaps.length ? otherGaps.map((i: any) => `- ${i.id}: ${i.message}`) : ['- none']), '',   // eslint-disable-line @typescript-eslint/no-explicit-any
    '## Notes on sources (not counted as records)', '', ...(sourceNotes.length ? sourceNotes.map((i: any) => `- ${i.id}: ${i.message}`) : ['- none']), '',   // eslint-disable-line @typescript-eslint/no-explicit-any
    `${pending.length} records are waiting for verification (out/verify-queue.json).${held.size ? ' See held.json for what to do about held records.' : ''}`, ''].join('\n'));
  console.log(`companies without a chain ${counts.companies_without_chain} of ${counts.companies} · ready ${counts.ready} · with gaps ${counts.ready_with_gaps} · existing nodes with gaps ${counts.existing_with_gaps} · to verify ${counts.awaiting_verification} · evidence ${counts.evidence} · held ${counts.held} · merged ${counts.merged} → ${R('out')}`);
})();
