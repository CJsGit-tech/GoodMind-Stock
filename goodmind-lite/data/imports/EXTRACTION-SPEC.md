# GoodMind V4 — research extraction spec

Goal: turn one research folder into a batch of write operations that the GoodMind write gate accepts.
Output: `data/imports/<slug>.json` = `{ "source_folder": "...", "ops": [ ...operations... ] }`.
Check it with `npx tsx scripts/check-ops.ts data/imports/<slug>.json` (run from goodmind-lite/) and fix until it prints OK.
The checker uses the real rules; it never saves anything.

## Operation shapes
- `{ "op": "createNode", "node": { "id": "company:evergreen", "type": "Company", "name": "長榮", "attributes": { ... } } }`
- `{ "op": "createEdge", "edge": { "predicate": "SELLS", "from": "company:evergreen", "to": "service:evergreen-container-shipping", "attributes": { "verification_status": "verified", "evidence_ids": ["evidence:evergreen-2025-annual-report"] } } }`
Nodes must be created before the edges that use them (order in the array matters). Edges may also point at EXISTING nodes (see EXISTING-NODES.md).

## Hard rules
1. `name` is Traditional Chinese (common short name, e.g. 長榮, 台積電). English/original name goes in `attributes.name_en`. Other spellings and tickers go in `attributes.aliases`. If a company truly has no Chinese name, keep the original and set `name_zh_missing: true`. Model numbers / source titles may stay as written.
2. ids: `company:<english-slug>`, `product:<slug>`, `service:<slug>`, `segment:<slug>`, `industry:<slug>`, `technology:<slug>`, `application:<slug>`, `business_line:<company>-<segment>`, `competition:<slug>`, `supply:<slug>`, `collaboration:<slug>`, `evidence:<slug>`. Lowercase, `-` separated, unique.
3. Do not invent facts. Every node/edge must be supported by something in the folder's research files. Use only companies, numbers and relationships the research states. If the research hedges, use `verification_status: "reported"` or `"inferred"`, never `"verified"`.
4. Reuse existing nodes from EXISTING-NODES.md instead of creating duplicates (e.g. TSMC is `company:tsmc`). The checker refuses a Company whose name/alias/ticker matches an existing one.
5. Keep it focused: about 20–45 nodes per folder. Prefer the companies the research is actually about (5–10), their main products/services, 1–3 market segments, 1 industry, 1–4 relationship records, and the evidence sources that support them (5–10).

## Node types you will mostly use (type key → required attributes)
- `Company` → `country` (ISO code, e.g. TW, US, JP). Recommended: `name_en`, `ticker` (e.g. "2603"), `exchange` ("TWSE" or "TPEx" only if stated), `aliases`, `evidence_ids`, `verification_status`.
- `Product` → `kind` (one of: system, module, component, material, software, vehicle, foundry, testing, packaging, assembly_and_test, design, integration, other). Physical/software goods.
- `Service` → `kind` (same list; use `other` for e.g. banking, shipping, food service). Services a company sells (container shipping, deposits/loans, restaurant meals, construction).
- `BusinessLine` → none. Use when the research names an activity but no specific product/service.
- `Industry` → none (`name_en` recommended). Create a new one only if none of the existing industries fits (e.g. 航運, 金融, 餐飲, 生技醫藥, 鋼鐵). Then also create at least one `MarketSegment` under it.
- `MarketSegment` → must get an edge `SEGMENT_OF_INDUSTRY` → an Industry. Recommended `buyer_type`, `region`.
- `CompetitionAssessment` → `competition_type` (DIRECT|INDIRECT), `overlap_scope` (market|product_category|application), `basis` (string array of reasons), `verification_status`, `evidence_ids` (≥1). Edges: `OFFERING_A`, `OFFERING_B` (→ Product/Service, must differ), `COMPETES_IN_SEGMENT` (→ MarketSegment, exactly 1).
- `SupplyRelationship` → `stage` (prospect|qualified|sampling|design_win|mass_production|ended|unspecified), `verification_status`, `evidence_ids`. Edges: `HAS_SUPPLIER` (→ Company, exactly 1), `HAS_BUYER` (→ Company, exactly 1), `FOR_SUPPLIED_PRODUCT` / `FOR_SUPPLIED_SERVICE`.
- `Collaboration` → `collaboration_type` (joint_venture|mou|technical_integration|joint_development|strategic_partnership|investment|other), `stage` (rumoured|announced|mou_signed|in_development|launched|ended|unspecified), `verification_status`, `evidence_ids`. Edges: `HAS_PARTICIPANT` (→ Company, at least 2).
- `Evidence` → `url` (http/https), `publisher`, `published_at` (YYYY-MM-DD). Use the URLs listed in the research (source registry / evidence matrix). If the date is unknown, omit `published_at` and set `needs_review: ["published_at"]`. Name = the source's original title.
- `Technology`, `Application` → none.

`verification_status` values: verified (official filing/announcement), reported (news/analyst), inferred (your reading of the research), suggested, disputed.
`lifecycle_status` (optional): announced, active, completed, expired.

## Relations you will mostly use (predicate: from → to)
- SELLS / BRANDS / MANUFACTURES / DESIGNS / DISTRIBUTES: Company → Product|Service
- OFFERS_SERVICE: Company → Service
- OPERATES_BUSINESS_LINE: Company → BusinessLine (needs evidence_ids)
- BUSINESS_LINE_IN_SEGMENT: BusinessLine → MarketSegment (needs evidence_ids)
- TARGETS_SEGMENT: Product|Service → MarketSegment
- IN_CATEGORY: Product|Service → ProductCategory
- USES_TECHNOLOGY: Product|Service → Technology
- SUPPORTS_APPLICATION: Product|Service → Application
- OPERATES_IN: Company → Industry
- SEGMENT_OF_INDUSTRY: MarketSegment → Industry
- FEEDS_SEGMENT: MarketSegment → MarketSegment (upstream output is downstream input)
- IS_SUBSIDIARY_OF / CONTROLS / OWNS_STAKE_IN (attr percent): Company → Company
- MEMBER_OF_GROUP: Company → CorporateGroup
- HOLDS_CONSTITUENT: ETF → Company (attrs weight_pct, as_of — required)
- the record edges listed above
Do NOT create computed relations (SUPPLIES_TO, COLLABORATES_WITH, DIRECT_COMPETITOR_OF, …) or POSSIBLE_* — the checker refuses them.
Put `verification_status` and `evidence_ids` on edges whenever you can.

All attribute keys are snake_case.
