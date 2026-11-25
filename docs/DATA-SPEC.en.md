# Data format and import spec

[繁體中文](DATA-SPEC.md) ｜ **English**

For every node type and relation see [ONTOLOGY.md](ONTOLOGY.md). For a complete example see [`examples/example-ops.json`](../examples/example-ops.json) (all of it is fictional).

## File format

An import file is JSON: `{ "ops": [ … ] }` (a bare array also works). Operations apply in order, so **anything referenced must come first**: evidence, then nodes, then relations.

```json
{ "ops": [
  { "op": "createNode", "node": { "id": "evidence:example", "type": "Evidence", "name": "Original source title",
      "attributes": { "url": "https://example.com/page", "publisher": "Publisher", "published_at": "2025-03-15" } } },
  { "op": "createNode", "node": { "id": "company:example", "type": "Company", "name": "範例公司",
      "attributes": { "country": "TW", "name_en": "Example Co.", "verification_status": "reported", "evidence_ids": ["evidence:example"] } } },
  { "op": "createNode", "node": { "id": "industry:example", "type": "Industry", "name": "範例產業" } },
  { "op": "createEdge", "edge": { "predicate": "OPERATES_IN", "from": "company:example", "to": "industry:example",
      "attributes": { "verification_status": "reported", "evidence_ids": ["evidence:example"] } } }
] }
```

| Operation | Fields |
|---|---|
| `createNode` | `node.type`, `node.name` (required); `node.id`, `node.attributes` (recommended) |
| `createEdge` | `edge.predicate`, `edge.from`, `edge.to` (required); `edge.attributes` |
| `updateNode` | `id` (required); `name`, `attributes`. Set an attribute to `null` to delete it |

## Ids and names

- Write ids as `prefix:lowercase-slug`; they must be unique. Common prefixes: `company:`, `product:`, `service:`, `business_line:`, `industry:`, `segment:`, `category:`, `technology:`, `application:`, `supply:`, `competition:`, `collaboration:`, `evidence:`. The importer generates one if you leave it out.
- `name` is Traditional Chinese. English or original names go in `attributes.name_en`, other spellings in `attributes.aliases`.
- `Evidence`, `Product`, `Service`, `Claim` and `TopicMention` may keep original text (model numbers, source titles). For other types without a Chinese name, add `name_zh_missing: true`; if the original spelling is the usual Chinese usage, add `name_is_zh_usage: true`. **Never translate or invent a Chinese name.**
- Attribute keys are `snake_case`. You may add your own key-value pairs beyond the declared fields.

## Reliability and stage

- `verification_status`: `verified` (first-party filing or announcement), `reported` (second-hand or hedged), `inferred` (analysis), `suggested`, `disputed`
- `lifecycle_status`: `announced`, `active`, `completed`, `expired`

A plan, sample or MOU is not mass production or a sale. Add a date only when a source states it.

## Sources (Evidence)

`url`, `publisher` and `published_at` are required. If the source shows no date, omit `published_at` and add `"needs_review": ["published_at"]`. Nodes and relations cite evidence nodes through `evidence_ids`.

These types **need at least one piece of evidence**: `SupplyRelationship`, `CompetitionAssessment`, `CustomerOpportunity`, `Collaboration`, `Event`. Some relations require it too; they are marked `*` in [ONTOLOGY.md](ONTOLOGY.md). Citing a source for every fact is recommended.

## Relationship records

Supply, collaboration and competition between companies are created as **a record node first**, then linked to the parties. "Supplies to", "collaborates with" and "competitor of" are computed and cannot be imported.

| Record | Required attributes | Required relations |
|---|---|---|
| `SupplyRelationship` | `stage`, `verification_status` | exactly 1 `HAS_SUPPLIER`, exactly 1 `HAS_BUYER`; items through `FOR_SUPPLIED_PRODUCT` / `FOR_SUPPLIED_SERVICE` |
| `Collaboration` | `collaboration_type`, `stage`, `verification_status` | at least 2 `HAS_PARTICIPANT` |
| `CompetitionAssessment` | `competition_type`, `overlap_scope`, `basis`, `verification_status` | exactly 1 each of `OFFERING_A`, `OFFERING_B` (two different offerings), `COMPETES_IN_SEGMENT` |
| `CustomerOpportunity` | `stage`, `verification_status` | exactly 1 `PROSPECTIVE_SELLER`, at least 1 `TARGET_CUSTOMER` |

Allowed values are in [ONTOLOGY.md](ONTOLOGY.md). Supply stages `unspecified`, `design_win` and `mass_production` show as current supply; `prospect`, `qualified` and `sampling` show as possible supply.

The smallest useful research chain: company → product or service (`SELLS` and similar) → market segment (`TARGETS_SEGMENT`) → industry (`SEGMENT_OF_INDUSTRY`). A company can also link straight to an industry with `OPERATES_IN`.

## Checks at import

A batch is written only if all of it passes. If anything fails, nothing is written and the reasons are listed (in Chinese):

- unknown node type or relation, or an abstract type
- missing required attribute, wrong datatype, or an attribute key that is not `snake_case`
- a name that breaks the Chinese name rule
- a duplicate id; or a company, industry, segment, technology and the like whose name, alias or ticker matches an existing node of the same type
- wrong relation direction or endpoint type, missing endpoint, self-link, or duplicate relation
- computed or suggested relations
- too many or too few relations on a relationship record
- missing required evidence, or `evidence_ids` pointing at something that is not evidence

The importer does **not** check that a source actually supports a fact. Use the [`goodmind-data` skill](../.claude/skills/goodmind-data/SKILL.md) or review by hand.

## Commands

```bash
npm run check -- my-data.json
npm run import -- my-data.json
npm run reset
```

- `check` validates without saving.
- `import` writes to your local `data/db.json`; the data from before the run is kept in `data/db.backup.json` (one copy only). With several files, they run in order; a refused file stops the run, and files imported before it stay.
- `reset` empties your local graph.

Nothing in `data/` is tracked by git except the empty starter file `seed.json`.
