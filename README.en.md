# GoodMind (股脈)

[繁體中文](README.md) ｜ **English**

GoodMind is an industry knowledge graph. It organizes companies, offerings and markets, the supply, collaboration and competition links between them, and their sources into a graph you can query. This repository provides the research method, the ontology spec, and a local version you can load with your own data on your own computer. **It contains no research data**, only a fictional example. The interface and several data labels are in Traditional Chinese.

| Link | URL |
|---|---|
| Production site | https://good-mind-mxn7j5.v2.appdeploy.ai/ |
| Data guide and methodology (Chinese) | https://good-mind-mxn7j5.v2.appdeploy.ai/#/docs |

## Methodology

Ontology version **4.0**: 26 usable node types (plus 1 abstract "offering" type) and 81 relation types, of which 71 can be imported and 10 are computed or only suggested.

| Layer | Main node types | Question answered |
|---|---|---|
| Actors and offerings | Company, Corporate Group, Organization Unit, Product, Service, Business Line | Who does business, and what do they sell? |
| Classification | Industry, Market Segment, Product Category, Technology, Application | Which market is it in, and what technology does it use? |
| Relationship records | Supply Relationship, Customer Opportunity, Collaboration, Competition Assessment | What happened between companies? |
| Sources | Evidence, Claim | Who says so? |
| Extensions | Value Chain Stage, Capability, Facility, End Market, Topic, Event, Topic Mention, ETF | Value-chain position, trends and holdings |

The usual research chain: **company → product or service → market segment → industry**.

**Principles**

1. **Chinese first.** Names are in Traditional Chinese; English names and aliases go in attributes. Without a reliable Chinese name, keep the original; never translate one yourself.
2. **Facts need sources.** Supply, collaboration, competition and similar records must cite evidence; citing it for other facts is recommended.
3. **Reliability and stage are separate.** An announced MOU can be verified without implying any revenue.
4. **Facts, computed links and suggestions are separate.** Supply, collaboration and competition are stored as records, and company-to-company links are computed from them. A shared market or technology only produces a suggestion, not a fact.
5. **One write gate.** Each batch is checked against the ontology and saved only if all of it passes.
6. **Smaller and right.** What cannot be sourced is held or left as a gap, not guessed.

**Research pipeline:** save sources → extract claims with verbatim quotes → draft to the ontology → match duplicates → fill gaps → mechanical checks and independent verification → package → import.

**Querying:** find companies by combining conditions with all / any / not. Queries follow only registered paths, so the same conditions on the same data give the same results. Missing data is reported as "unknown".

## Run locally

You need [Node.js](https://nodejs.org/) 22.12 or later, and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3100. The graph is empty on first run. The API server accepts connections from your computer only.

## Import your own data

Try the fictional example first:

```bash
npm run check -- examples/example-ops.json
```

```bash
npm run import -- examples/example-ops.json
```

Reload the page to see the example nodes. Clear them before loading your own:

```bash
npm run reset
```

Then prepare a JSON file following the [data format and import spec](docs/DATA-SPEC.en.md); run `check`, then `import`. Your data lives in `data/db.json` on your computer and is not tracked by git.

## Clean and extract data with the skill

The repository includes the [`goodmind-data`](.claude/skills/goodmind-data/SKILL.md) skill. Open the repository in [Claude Code](https://claude.com/claude-code) and describe what you want, for example:

> Use goodmind-data to turn the `~/my-research` folder into graph data, and import what passes into my local server.

It saves sources, extracts claims with quotes, drafts to the ontology, matches duplicates, has a separate agent verify, and packages only the records that pass. **It reports to you and asks before importing.**

- Needs Python 3; reading PDFs needs `pdftotext`.
- You approve new industries and market segments first (the list is [`taxonomy.json`](.claude/skills/goodmind-data/taxonomy.json) and starts empty).
- With an AI tool, the material you give it is handled under that tool's terms. Verification can still be wrong, so review important data yourself.

## Documentation

| Document | Contents |
|---|---|
| [Data format and import spec](docs/DATA-SPEC.en.md) | File format, naming, relationship records, import checks |
| [Ontology reference](docs/ONTOLOGY.md) | All node types, attributes, relations and rules |
| [`lib/registry.v4.json`](lib/registry.v4.json) | Ontology registry |

## Project structure

| Path | Description |
|---|---|
| `src/` | Front-end interface and graph views (React, Vite) |
| `server/` | Local read-only API (Express) |
| `lib/` | Ontology, write gate, query and derivation rules |
| `scripts/` | Check, import, reset, doc generation and tests |
| `examples/` | Fictional example data |

```bash
npm run typecheck
npm test
```

## Notice

The graph is for research only and is not investment advice. Check the original sources before relying on any data.
