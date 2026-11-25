# GoodMind Galaxy — Knowledge Graph Research Center (local dev)

React 19 + Vite frontend, small Express API, OpenAI Agents SDK chat retrieval.

```
npm install
cp .env.local.example .env.local   # optional: OPENAI_API_KEY, OPENAI_MODEL (default gpt-4.1-mini)
npm run dev                        # web http://localhost:3100  (API on :3101, proxied at /api)
```
Without `OPENAI_API_KEY` the chat runs in **simulated** mode (local heuristics over the same query layer).

## Structure
| Path | What |
|---|---|
| `src/components/GalaxyGraph.tsx` | 3D galaxy: `react-force-graph-3d` (three.js) + `UnrealBloomPass` glow, procedural starfield & nebula sprites, glowing "star" nodes (octahedra for assessment/collaboration records), particle flow on active links, camera fly-to |
| `src/components/ResearchConsole.tsx` | Chat; each answer shows its retrieval steps and a "✦ N stars" chip that lights up the answer subset |
| `src/components/FilterPanel.tsx` | Manual filtering without chat: text, node types ("constellations"), relations by group ("orbits"), verification status, hide unconnected |
| `src/components/Dossier.tsx` | Selected node: attributes, relations, evidence, "Focus orbit" (1–2 hop neighbourhood), "Ask about this" |
| `src/pages/Workspace.tsx` | Ontology workspace — only allowed node types & relations |
| `server/index.ts`, `server/ontology.ts` | Express API: `GET /api/graph`, `POST /api/chat`, `POST /api/ontology` |
| `lib/agent.ts`, `lib/query.ts`, `lib/db.ts` | Agents SDK agent + read-only graph tools, query layer, JSON DB (`data/db.json` from `data/seed.json`) |

## Research features
- **Trust on the map**: link colour = confidence (teal disclosed/corroborated, amber reported/inferred, red disputed, grey unverified, violet computed). Click any link for a relation dossier (confidence weight, evidence freshness, source records for computed links).
- **Citations**: answers carry `[n]` markers; clicking one flies to the supporting relation.
- **Live retrieval**: `POST /api/chat/stream` (server-sent events) pushes each agent tool call; stars light up as they are found, then the final answer arrives.
- **Follow-up chips** after each answer.
- **Computed links** (`lib/derive.ts`, toggle in filters): `DIRECT/INDIRECT_COMPETITOR_OF`, `DIRECTLY/INDIRECTLY_COMPETES_WITH`, `COLLABORATES_WITH`, `SUPPLIES_TO`, projected from assessment / collaboration / supply records, never stored.
- **Path finder** (node dossier → "Find a connection", agent tool `find_paths`): all paths ≤ 3 hops ranked by the product of per-status confidence weights (`STATUS_WEIGHT` in `lib/query.ts`, a heuristic).

Answer subset view: **Isolate** (only those nodes) or **In context** (whole filtered galaxy, answer lit up).
`_next-old/` holds the previous Next.js version for reference and can be deleted.

## Public deployment (AppDeploy app `good-mind-mxn7j5`)
Live: https://good-mind-mxn7j5.v2.appdeploy.ai/ · v4 app deployed 2026-11-25 (snapshot `1795538425166`). Free-text chat is **off** (no AI provider is called).
- Pages: `/` explore with the research assistant (guided options, company search), `/docs/` data guide, `/workspace/` admin (sign-in with the `MASTER_USERNAME` / `MASTER_PASSWORD` app secrets).
- The AppDeploy app is a Next.js static template; the UI runs as a client-only bundle under `gm/` (HashRouter). Query, data-quality and the write gate run in the browser from the shared `lib/` code (`gm/core/`); `gm/lib/http.ts` (from `deploy/src/http.ts`) replaces `src/lib/http.ts`.
- Backend (`deploy/src/backend.ts`): `GET /api/graph` (admin-published graph, table `graph_v4`, or null → bundled dataset), admin login / session / publish / reset. Every change needs a signed admin token (8 h).
- Data ships packed in `gm/data/` (nodes1-3.json, edges.json; `decode.ts` restores it and logs an error if counts or the checksum differ).
- Build and check: `python3 deploy/build_appdeploy.py` → `../deploy-goodmind/`, then `npx next build` there. Upload with `deploy_app` in batches (leaf files first so every intermediate snapshot builds; the routes, CSS and backend go last).
- Roll back with AppDeploy version history; the last pre-v4 snapshot is `1795280902097`.
- 2026-11-25: research import (303 → 443 nodes), seeded opening sample (≤ 100 nodes, 「換一組」), industry clusters and the rebuilt assistant deployed (snapshot `1795578957519`). Node data now ships in fixed chunks of 101 (`nodes1-N.json`) so later imports only upload the changed chunks.
- 2026-11-25: 2D graph fallback deployed (snapshot `1795580931092`); fixes the whole-page crash when WebGL can't start. `n.remove is not a function` in the live 3D camera code: caused by AppDeploy installing `three-render-objects` 1.46.0 with `@tweenjs/tween.js` 23.1.3; fixed by pinning 1.45.0 with `overrides` in both `package.json` files (the build script sets it for the deploy bundle). Deployed 2026-11-25 (snapshot `1795582523943`) and verified live.
- 2026-11-25: 2D is the default graph view, with a remembered 2D／3D switch in settings. Deployed (snapshot `1795593993524`) and checked live in both views.
- Step-by-step guide for extracting research data and publishing it: [docs/DATA-IMPORT-AND-APPDEPLOY.md](docs/DATA-IMPORT-AND-APPDEPLOY.md) (scripts `check-ops`, `import-ops`, `existing-nodes`, `sample-depth`).

## Ontology v1.1 (local)
- `lib/ontology.ts` — declared **property schemas** per class (datatype, required, enum values), relation **traits**
  (symmetric, inverse, computed-by, edge properties), **rules** as data (cardinality, distinctness, evidence,
  derivations, answer mappings) and the three **competency questions**. New: `Service`, `HOLDS_CONSTITUENT` (ETF→Company),
  `COMPETES_IN_CATEGORY`, `COMPETES_ON_APPLICATION`, `FOR_SUPPLIED_SERVICE`, `OFFERS_SERVICE`, computed `MAY_SUPPLY_TO`;
  new fields `overlap_scope`, supply/collaboration `stage`, `offering_kind`, `announced_at`, `scope`, participant `role`, company `aliases`.
- `scripts/migrate-v1_1.ts` — idempotent migration (backups `data/*.v1_0.json`); never invents facts: unknowns become
  `unspecified`. `readDb()` auto-migrates older data.
- `lib/validate.ts` + `GET /api/quality` — validation driven by the declared schema and rules (0 errors, 104 curation warnings on the live data).
- `lib/questions.ts` — query templates `competitorsOf`, `supplyChainOf`, `collaborationsOf`; exposed to the agent as tools
  `competitors_of`, `supply_chain_of`, `collaborations_of` (the simulated chat uses them too).
- Not deployed: the public AppDeploy site is still v1.0 (read-only, chatbot off).

## Curation (v1.1 data)
- `scripts/fetch_evidence_dates.py` → `data/curation/evidence_dates.json`: fetches each evidence URL; date from page
  metadata > URL > page text > a dated note on the citing record (method stored as `date_method`; fiscal year-ends
  stored as `period_end`, not publication). Also records `link_checked_at` / `link_status`.
- `data/curation/v1_1-curation.json`: 37 reviewed decisions (supply `stage`/`offering_kind`, collaboration
  type/stage/`announced_at`/`scope`, competition `overlap_scope`), 2 scope links, 12 participant roles — each with a
  rationale and confidence, derived only from the record's own notes/basis or evidence page. Curated records carry a
  `curation` stamp.
- `scripts/apply-curation.ts`: applies both files idempotently, converts the subcontracting "product" to a `Service`,
  and adds `HOLDS_CONSTITUENT` edges from weights listed in ETF notes (ticker match to existing companies only).
- Result: 0 errors, 17 warnings (10 unreachable evidence links — mostly sites returning 403 to automated requests —
  and 7 evidence items with no date anywhere).

## Ontology v2.0: things, groups, facts (local)

Three layers:

1. **Things.** `Company` and `Offering`. `Product` and `Service` are subclasses of the abstract `Offering`, so relations like `SELLS`, `OFFERING_A/B` and `TARGETS_SEGMENT` accept both, and a service can compete. Every company has at least one offering. When no named product is sourced, a *business line* stands in (`kind: business_line`, e.g. 雲達科技・AI 伺服器與 HPC 系統業務).
2. **Groups.** `Industry › MarketSegment › ProductCategory` (`SEGMENT_OF_INDUSTRY`, `CATEGORY_IN_SEGMENT`), plus the `Technology` and `Application` tags. `FEEDS_SEGMENT` records the value chain (e.g. IC 載板 → AI 晶片). `ACTIVE_IN_SEGMENT` is computed from a company's offerings.
3. **Facts.** Competition, supply, opportunity and collaboration records, as in v1.1.

**Suggested links** (`lib/suggest.ts`, rules `S-*`) turn shared groups into proposals. They are drawn as dotted lines and are never stored as facts:

| Rule | Example | Strength |
|---|---|---|
| S-same-category | BOXER-8741AI and AIE510-ONX are both *Industrial Edge AI Computer* | 80% |
| S-same-offering | two companies sell the same offering | 75% |
| S-same-segment | both sold in *工業邊緣 AI 電腦* | 60% |
| S-technology-provider | Advantech's AFE-R750 is built on Jetson Orin, which NVIDIA provides | 60% |
| S-shared-technology | both built on Jetson Thor (the provider itself is excluded) | 40% |
| S-value-chain | a company in an upstream segment may supply one downstream | 35% |

The engine never proposes a pair in the same corporate family, a pair already covered by a record, or a suggestion that was already decided. **Accept** creates a real record marked `analyst_inferred` (a CompetitionAssessment, or a SupplyRelationship at stage `prospect`) that cites the evidence on both sides. **Reject** is remembered in `suggestionDecisions`.

Where to find it:
- **Explore:** the *Groups* picker shows one industry, segment or category. The *Suggested links* switch has Strong, Likely and All levels. A company's dossier lists its group breadcrumbs and suggestions with Accept and Reject.
- **Workspace:** the group tree with value-chain arrows, the *Links to review* queue, and coverage rules (`G-*`) in data quality.
- **Chat:** `competitors_of` and `supply_chain_of` return a separate `possible` list, which is reported as "possible, not verified".

Data: `data/curation/v2-groups.json` (reviewable; every placement has a rationale and confidence) is applied with `npx tsx scripts/apply-v2.ts` to `seed.json`, `db.json` and `seed.sample.json`. The v1.1 data is backed up in `data/backup/`. Export the group tree and suggestions with `npx tsx scripts/export-groups.ts`, which writes to `../export/groups/`.

## Ontology v4.0 (local, from GoodMind-V4-Package)

- **Registry**: `lib/registry.v4.json` (27 node types, 81 relations) → `lib/ontology.ts#buildOntology`. Type/relation keys (`Company`, `SELLS`) are stable codes; the Chinese `label` is what people see.
- **Data shape**: every node is `{ id, type, name, attributes }` and every edge `{ id, predicate, from, to, attributes }`. `name` is Chinese; English/original names go in `attributes.name_en`, other spellings in `attributes.aliases`. Attributes are free JSON (snake_case keys).
- **Single write entry**: `POST /api/write` (`lib/write.ts`) — createNode / createEdge / updateNode batches, all-or-nothing, `?dryRun=1` to check only. Rejects wrong direction/types, computed or AI-suggested relations, duplicates, self-loops, cardinality overflows, missing required attributes, non-Chinese names, missing evidence, and duplicate companies (alias/ticker). Suggestion "Accept" uses the same gate. UI: Ontology page → 建立關係.
- **Identity**: `GET /api/resolve?q=Advantech` → `company:advantech` (also tickers, aliases and pre-v4 ids).
- **Verification ≠ lifecycle**: `verification_status` ∈ verified · reported · inferred · suggested · disputed (old label kept in `verification_legacy`); `lifecycle_status` ∈ announced · active · completed · expired.
- **Migration**: `npx tsx scripts/migrate-v4.ts` (v2 backups in `data/*.v2_0.json`, id map and change log in `data/migration-v4/`). 25 business-line pseudo-products → `BusinessLine`; 11 foundry/test/packaging products → `Service`; canonical ids with `legacy_ids`; unknown facts are listed in `attributes.needs_review`, never guessed.
- **GQC query** (`lib/gqc.ts`): `POST /api/query` with the V4 JSON contract (`version`, `result_type`, `universe`, `filters.all/any/not`, `expand`, `policy`); `GET /api/query/registry` lists the allowed fields, operators and semantic path rules. Each company appears once with every matching path (rule id, node ids, fact ids, evidence ids); `expand` never changes the matches; missing data is reported as `unknown` (never excluded by `not`); verification / `as_of` / `max_hops` apply to every fact; stable order and a cursor bound to the data snapshot. UI: **Query** page. The chat agent has a `gqc_query` tool.
- Tests: `npm run test:gqc` — V4 acceptance cases Q01–Q12 and invariants on a synthetic fixture (25 tests).
- Not yet: real Topic / Event / TopicMention data (the schema and query paths exist; the dataset has none), and a natural-language → GQC parser outside the chat agent.

## UI: language, design and licences

- **Language**: Traditional Chinese by default; switch under ⚙ 進階選項 → 語言. i18n uses `i18next` + `react-i18next` (`src/i18n/`). The Chinese text is the key (`t('篩選')`); add wording overrides to `locales/zh-TW.json`, translations to `locales/en.json`, or a new locale file listed in `LOCALES`. Attribute and value names use `attr.<key>` / `enum.<value>`.
- **Explore layout**: research assistant on the left, details on the right, full-bleed 3D graph that never rotates by itself. The assistant offers click-through options (用條件找公司、依產業瀏覽、只看競爭／供應／合作) that filter the graph immediately; applied filters show as removable chips at the top of the chat. The ⚙ button in the assistant opens advanced settings: GQC conditions (AND / OR / NOT), reliability, as-of date, listed-only, graph display options and language. The former 條件查詢 page now redirects here.
- **Graph view**: 2D by default (`Graph2D`, `react-force-graph-2d`, MIT). 3D is a choice under ⚙ → 圖譜顯示 (remembered in the browser as `gm.graph`); if WebGL 2 is missing or 3D fails to start, `GraphView` stays in 2D and says so. `?graph=3d` or `?graph=2d` in the address overrides the saved choice. Each view's code is downloaded only when shown.
- **Licences**: every runtime and build dependency is MIT (TypeScript: Apache-2.0); fonts (Inter, Noto Sans TC, JetBrains Mono, Space Grotesk) are SIL OFL. All allow commercial use. Check with `npm ls --all` before adding a package.

## Public guide and admin workspace

- `/docs` (資料說明, in the navigation): read-only reference — node type schema, available relations, search structure and methodology.
- `/workspace` (not linked in the navigation): admin workspace behind a sign-in — create relations, review suggested links, data quality, reset.
- Sign-in: set `ADMIN_PASSWORD` (8+ characters) in `.env.local` locally, or as a server secret in deployment. A correct password sets an HttpOnly, SameSite=Strict session cookie (8 hours, in memory; 5 wrong tries lock sign-in for a minute). `POST /api/write`, `/api/suggestions/decide` and `/api/ontology` return 401 without a session; Accept / Reject in Explore only shows for a signed-in admin.
