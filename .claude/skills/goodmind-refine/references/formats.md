# Run folder formats

All files are UTF-8 JSON in `$RUN/`. Paths inside them are relative to `$RUN/`.

## sources.json
A source is something a reader could check.
```json
[ { "id": "s1", "url": "https://example.com/news/1", "publisher": "公司名", "title": "原始標題",
    "published_at": "2026-11-18", "text_file": "sources/s1.txt", "public": true } ]
```
- `fetch_source.py` writes entries for public sources. Write private ones yourself.
- `published_at`: omit when the source shows none. Never use today's date or a file date. On the Evidence node, add
  `needs_review: ["published_at"]` in that case, or the write gate refuses it.
- `public: false` (or no `url`): user-provided or private material. It can guide research, but records resting only on
  it are held, because the published graph must not invent a link or expose private text.
- `text_file`: the text you read (the page, or the relevant PDF pages), unedited.

## claims.json
```json
[ { "id": "c1", "source": "s1", "quote": "exact words copied from the source",
    "locator": "section or page", "statement": "景碩與輝達簽訂 ABF 載板產能合作" } ]
```
The quote must appear in the source's `text_file` (whitespace differences are ignored) and be at least 8 characters
without whitespace, so quote the whole clause rather than a word or two. Quote enough to carry the fact, including
the hedge: "plans to ship" is not "ships". A record is judged only on the quotes it cites: if it needs three facts
(who, what, which country), cite a quote for each.

## draft.json
Write operations as in `data/imports/EXTRACTION-SPEC.md`, each with the claims that support it.
`title` names the run in `ops.json` and the report; without it the folder name is used.
```json
{ "title": "2026-11-20 零售聯名研究", "ops": [
  { "op": "createNode", "node": { "id": "evidence:x", "type": "Evidence", "name": "原始標題",
      "attributes": { "url": "https://example.com/news/1", "publisher": "公司名", "published_at": "2026-11-18" } } },
  { "op": "createNode", "claims": ["c1"], "node": { "id": "company:x", "type": "Company", "name": "某公司",
      "attributes": { "country": "TW", "verification_status": "reported", "evidence_ids": ["evidence:x"] } } },
  { "op": "createEdge", "claims": ["c1"], "edge": { "predicate": "SELLS", "from": "company:x", "to": "product:y",
      "attributes": { "verification_status": "reported", "evidence_ids": ["evidence:x"] } } },
  { "op": "updateNode", "claims": ["c2"], "id": "company:z", "attributes": { "ticker": "1234" } }
] }
```
- Evidence nodes need no claims. Their `url` must equal a public source's `url`.
- Every other operation needs claims and `evidence_ids`, and the evidence must point at the claims' sources.
  For `updateNode`, include the full new `evidence_ids` list (existing ids plus new ones).
- **Classifications** (a new market segment, which industry it sits in, which segment a product targets) are often
  your judgement rather than a sentence in a source. Mark them `inferred` and cite quotes showing what the product is
  or does. They pass only if the classification follows from those quotes with no further fact.
- **Supply stage changes what readers see.** The app shows `unspecified`, `design_win` and `mass_production` as
  current supply (供應給), and `prospect`, `qualified` and `sampling` as possible supply (可能供應給). Use
  `unspecified` only when sources show supply is already happening and give no stage. For supply that is planned or
  announced but not yet happening, use `prospect` and note in `ontology-proposals.md` that there is no "planned"
  stage. If the sources do not show which side of that line it is on, leave the supply record out and say why.
- Unpublished hearsay stays `reported` in the draft; it is held anyway for lack of a public source.
- An update should add what is missing. Changing an existing value needs a claim that shows the old one is wrong.

## Record keys
`matches.json`, `decisions.json` and `verdicts.json` identify records by key:
node id · `PREDICATE|from|to` · `update:<node id>`

## decisions.json (answers to matches.json)
```json
{ "company:new-id": { "same_as": "company:ase", "reason": "same legal entity" },
  "product:new-id": { "distinct": true, "reason": "existing product is the older grade" } }
```
`same_as` removes the new node and points its relations at the kept one. If the new node carried useful aliases or
attributes, add an `updateNode` for the kept node with its own claims.

## verdicts.json (written by the verifier)
```json
[ { "key": "SELLS|company:x|product:y", "verdict": "pass", "reason": "quote states the company sells it",
    "verifier": "agent name or model", "fingerprint": "copied from verify-queue.json" } ]
```
`package.ts` writes `out/verify-queue.json` with each record that passed the mechanical checks and its fingerprint.
A verdict only counts while the fingerprint matches, so editing a record after verification sends it back.
So the order is: package (builds the queue) → verify → package again.
