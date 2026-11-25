# GoodMind: extract research data and publish it to AppDeploy

This guide covers the whole path: research folder → graph data (V4 schema) → checked import → local review → AppDeploy.
It is the procedure used on 2026-11-25 to add five research folders (pharma, shipping, banking, food, steel) and grow the
graph from 303 to 443 nodes.

| | |
|---|---|
| App folder | `GoodMind/goodmind-lite/` (all commands below run from here unless noted) |
| AppDeploy build folder | `GoodMind/deploy-goodmind/` (generated; do not edit by hand) |
| Live app | https://good-mind-mxn7j5.v2.appdeploy.ai/ · app id `good-mind-mxn7j5` |
| Research folders | `StockAnalysis/manga-layout-templates/<date>-<topic>/research/` |

```
research/*.md ──(1 extract)──▶ data/imports/<slug>.json ──(2 check)──▶ write gate OK
      ──(3 import)──▶ data/db.json + data/seed.json ──(4 review locally)──▶ npm run dev
      ──(5 build)──▶ ../deploy-goodmind ──(6 upload)──▶ AppDeploy ──(7 verify)──▶ live site
```

---

## 0. Before you start

- Node 20+, `npm install` done in `goodmind-lite/`, Python 3.
- Claude Code with the AppDeploy connector signed in (for step 6).
- Back up the data you are about to change:

```bash
cp data/db.json data/db.backup-$(date +%Y%m%d-%H%M).json
```

```bash
cp data/seed.json data/seed.backup-$(date +%Y%m%d-%H%M).json
```

- Refresh the list of nodes that extractions must reuse (industries, segments, companies, technologies, applications, ETFs):

```bash
npx tsx scripts/existing-nodes.ts
```

---

## 1. Extract: one research folder → one batch file

### What a batch is

A batch is `data/imports/<slug>.json`, a list of write operations for the single write gate (`lib/write.ts`):

```json
{
  "source_folder": "2026-11-02-steel-construction-mix",
  "ops": [
    { "op": "createNode", "node": { "id": "evidence:tung-ho-2024-tsmc-supplier-award", "type": "Evidence",
      "name": "東鋼鋼結構獲台積電供應商獎",
      "attributes": { "url": "https://www.tunghosteel.com/about/newsdetail/2323", "publisher": "東和鋼鐵", "published_at": "2024-12-02" } } },
    { "op": "createNode", "node": { "id": "company:tung-ho-steel-structure", "type": "Company", "name": "東鋼構",
      "attributes": { "country": "TW", "name_en": "Tung Ho Steel Structure", "verification_status": "verified",
                      "evidence_ids": ["evidence:tung-ho-2024-tsmc-supplier-award"] } } },
    { "op": "createEdge", "edge": { "predicate": "HAS_SUPPLIER", "from": "supply:tung-ho-steel-structure-to-tsmc",
      "to": "company:tung-ho-steel-structure", "attributes": { "verification_status": "verified",
      "evidence_ids": ["evidence:tung-ho-2024-tsmc-supplier-award"] } } }
  ]
}
```

(An excerpt: the `supply:` record node that the last edge starts from is created elsewhere in the same batch.)

The full rules are in **`data/imports/EXTRACTION-SPEC.md`** (op shapes, id conventions, required attributes per type,
allowed relations). The short version:

1. **Names are Chinese.** English or original names go in `attributes.name_en`, other spellings in `attributes.aliases`.
   If the research gives no Chinese name, keep the original and set `"name_zh_missing": true`.
2. **Reuse existing nodes.** Look up every company, industry and segment in `data/imports/EXISTING-NODES.md` and use
   its id. Never create a second node for the same company.
3. **Facts come only from the research**, and every fact points at an `Evidence` node with a real URL.
   Every id used in `evidence_ids` must be created as an `Evidence` node in the same batch (or already exist).
4. **Mark how sure the fact is**: `verification_status` = verified · reported · inferred. Hedged or news-only claims are
   `reported`; the analyst's judgement (for example "may compete") is `inferred`. Unknown fields are listed in
   `needs_review`, never guessed.
5. **Relations between companies are recorded as records**: a `SupplyRelationship`, `Collaboration` or
   `CompetitionAssessment` node with `HAS_SUPPLIER` / `HAS_BUYER`, `HAS_PARTICIPANT`, `OFFERING_A` / `OFFERING_B`
   edges. The company-to-company lines (`SUPPLIES_TO`, `COLLABORATES_WITH`, `DIRECT_COMPETITOR_OF` …) are computed
   from these records; do not write them directly (the write gate refuses them).
6. **Size**: about 20–45 nodes per folder. One industry, one to three market segments, the companies the research
   is about, their main products and services, the records the research supports, and the sources.

### Running the extraction with Claude

Ask Claude Code (one agent per folder; several folders can run in parallel). The prompt used for the 2026-11-25
import, with the folder filled in:

> You are extracting a small, accurate knowledge-graph batch from one research folder for the GoodMind app.
>
> Research folder (read-only, do not modify anything there): `…/manga-layout-templates/<FOLDER>/research/`
> Topic: `<TOPIC>`
>
> App folder: `…/GoodMind/goodmind-lite/`
> 1. Read the rules first: `data/imports/EXTRACTION-SPEC.md`, and the nodes that already exist: `data/imports/EXISTING-NODES.md`.
> 2. Read the research. Start with research-summary.md, company-selection.md, products-customers.md,
>    supply-chain-map.md (if present), industry-competition-finance.md, fundamentals.md, and the source list
>    (source-registry.md / evidence-matrix.md / *-sources.md) for URLs. Skim others only if needed. Ignore files about
>    manga/script production.
> 3. Write `data/imports/<SLUG>.json` as specified (about 20–45 nodes): the companies this research is about, their main
>    products/services, 1–3 market segments under one industry (reuse an existing industry if one fits; otherwise
>    create one), relationship records the research supports (competition, supply, collaboration), and Evidence nodes
>    with real URLs from the research. Every fact must come from the research; mark hedged facts reported/inferred.
> 4. Run from the app folder: `npx tsx scripts/check-ops.ts data/imports/<SLUG>.json` — fix the JSON until it prints
>    OK. Do not edit any other file, do not touch data/db.json or data/seed.json, and do not change the checker or the spec.
>
> Final answer (short): the OK line from the checker, the companies you created (Chinese name + English), the
> industry/segments used, and any facts you left out because the research was unclear.

Read each agent's "left out" list: those are the places where the research was not firm enough to record.

---

## 2. Check each batch (nothing is saved)

```bash
npx tsx scripts/check-ops.ts data/imports/steel.json
```

`OK: 69 operations would be accepted (Evidence 8, Industry 1, …)` means the batch passes. Otherwise every refusal is
listed. Common ones:

| Message (abridged) | Fix |
|---|---|
| `evidence_ids → evidence:… 不是證據節點` | Add the missing `Evidence` node (with its URL) to the batch. |
| name is not Chinese | Use the Chinese name, or keep the original and set `name_zh_missing: true`. |
| duplicate company / alias / ticker | Use the existing company id from `EXISTING-NODES.md` instead of creating it. |
| relation not allowed between these types | Check the relation's from → to types in the 資料說明 page or the spec. |
| computed relation | Write the record (`SupplyRelationship` …) instead of the company-to-company line. |

When several batches are ready, make sure two batches do not create the same node:

```bash
python3 -c "import json,glob,collections;c=collections.defaultdict(list);[c[o['node']['id']].append(f) for f in glob.glob('data/imports/*.json') for o in json.load(open(f))['ops'] if o['op']=='createNode'];print({k:v for k,v in c.items() if len(v)>1} or 'no duplicates')"
```

---

## 3. Import through the write gate

```bash
npx tsx scripts/import-ops.ts data/imports/pharma.json data/imports/shipping.json data/imports/banking.json data/imports/food.json data/imports/steel.json --seed
```

- Batches are applied in order; each one is all-or-nothing, and the script stops at the first refused batch
  (re-check it with step 2).
- `--seed` also copies the result to `data/seed.json`, which is the baseline the AppDeploy build ships and the
  "還原成初始版本" reset returns to.
- Then refresh the reuse list for the next round:

```bash
npx tsx scripts/existing-nodes.ts
```

---

## 4. Review locally

```bash
npm run dev
```

Open http://localhost:3100.

- Browse the new industries (assistant → 產業) and open a few new companies; check their relations and sources.
- `/workspace` (admin sign-in) → 資料品質 lists missing fields (`needs_review`) still to fill in.
- Check that the opening sample stays under the node limit with the new data:

```bash
npx tsx scripts/sample-depth.ts 500
```

It runs 500 seeded samples (3 industries × 5 companies, depth 1–3) and prints the median, p90 and maximum node count.
After the 2026-11-25 import: depth 2 median 66, max 92, never cut by the 100 limit.

---

## 5. Build the AppDeploy bundle

```bash
python3 deploy/build_appdeploy.py
```

```bash
cd ../deploy-goodmind && npx next build
```

The build script copies the UI and shared logic into `../deploy-goodmind/gm/` and packs `data/seed.json` into
`gm/data/`:

- `nodes1.json … nodesN.json` — nodes in **fixed chunks of 101, in data order**. Adding nodes only changes the
  last chunk or adds new ones, so the earlier chunk files stay byte-identical and do not need to be uploaded again.
- `edges.json` — edges packed as `[relation index, from, to, reliability, sources, other]` using node positions.
- `decode.ts` — restores the full graph and checks node count, edge count and a checksum; a mismatch logs
  `GoodMind dataset is incomplete` in the browser console.

Running `npm install` inside `deploy-goodmind/` removes the local stand-ins for `@appdeploy/client` and
`@appdeploy/sdk` in its `node_modules`; recreate them before `npx next build` there.

Optional local preview of the exact static build: start the `deploy-preview` server (port 3200) from
`.claude/launch.json` and open http://localhost:3200.

---

## 6. Upload to AppDeploy

AppDeploy receives source files as text through the AppDeploy connector (`deploy_app` with
`app_id: "good-mind-mxn7j5"`); the platform builds it. Binary "resources" uploads do not accept source or JSON data.

### Which files to send

| Changed | Send |
|---|---|
| New data only | the new or changed `gm/data/nodesN.json` chunks, `gm/data/edges.json`, `gm/data/decode.ts` |
| A new relation type appears in the data | the same three; every relation index shifts, so `edges.json` changes completely |
| A new library | `package.json` too, in the same call as the code that imports it |
| UI or logic | the changed files under `gm/components/`, `gm/pages/`, `gm/lib/`, `gm/core/`, and `styles/galaxy.css` |

Compare with what is live before sending: `src_read` / `src_grep` on the app show the stored files, and
`md5 -q gm/data/nodes1.json` locally tells you whether an unchanged chunk really is identical.

### Order (each upload triggers a build, so every intermediate state must build)

1. New standalone modules first (for example a new file in `gm/core/`).
2. Data: the new node chunks + `edges.json` + `decode.ts` together in one call.
3. UI components, pages and styles last, together in one call.

Tips that keep the uploads small and safe:

- `.json` files can be sent as JSON objects instead of escaped strings.
- Append-only changes (for example new CSS at the end of `styles/galaxy.css`) can be sent as a diff whose
  `from` is the current last line and whose `to` is that line plus the new text.
- After each call, poll `get_app_status` until `ready`, and read `qa_snapshot.frontend_errors` before sending the next
  batch. Stop and fix if anything fails.

The simplest way is to ask Claude Code: *"Build and deploy the current version to AppDeploy app good-mind-mxn7j5;
upload only the files that changed."*

### Data edited in the live workspace

The live site shows the **admin-published graph** when one exists (table `graph_v4`, written whenever someone saves
in `/workspace` or accepts or rejects a suggestion), and the bundled dataset otherwise. If the workspace has been used
on the live site, a new bundled dataset will not appear until either:

- `/workspace` → **還原成初始版本** (drops the published graph and its edits, and shows the new bundle), or
- the workspace edits are first written into `data/seed.json` locally (re-enter them as an import batch), then
  rebuild, upload and reset.

---

## 7. Verify the live site

- Open https://good-mind-mxn7j5.v2.appdeploy.ai/ and the browser console: there must be no
  `GoodMind dataset is incomplete` error.
- The assistant's 產業 list shows the new industries with the expected company counts.
- Open one new company and check a relation and its source link.
- The same `?s=<seed>` link shows the same sample locally and live (for example `?s=a0zh1q` → 72 nodes · 153 relations).

### Rolling back

- Live: AppDeploy keeps every version (`get_app_versions`, then restore one).
- Local data: the `data/*.backup-*.json` files from step 0 (`data/*.pre-research-20261125.json` for the
  2026-11-25 import).

---

## Checklist

- [ ] Backups made; `EXISTING-NODES.md` refreshed
- [ ] One batch per research folder in `data/imports/`, each `check-ops` OK
- [ ] No node created twice across batches
- [ ] `import-ops … --seed` done; `existing-nodes.ts` re-run
- [ ] Reviewed locally; `sample-depth.ts` max ≤ 100
- [ ] `build_appdeploy.py` + `npx next build` pass
- [ ] Uploaded in order (modules → data → UI), each batch `ready` with no frontend errors
- [ ] Live check done; workspace-published graph reset if needed
