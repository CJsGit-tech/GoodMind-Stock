# 口袋股 PocketStocksV2 · local staging

The knowledge-graph rebuild of PocketStocks: research books, the nodes they mention, and an owner review that decides what enters the graph. This folder replaced the V1 local staging app on 11 November 2026. The V1 source (books, ETF, calendar, institutional research) is in git commit `c4da60a`.

Design and requirements live in LinearBoard (project PocketStocksV2). This build follows the approved visuals v1.4 and draft review v1.5.

## Run

Needs Node.js 22.13 or later (it uses Node's built-in SQLite).

```sh
cd pocket-stock-staging
npm ci
npm run dev        # http://localhost:5173
```

The first start seeds sample data: 25 nodes, 7 books, and one draft waiting for review (Draft #12). The page shows a **本機 STAGING** bar at the top; that bar is a local test tool and is not part of the site.

## Checks

```sh
npm test           # type check + backend tests
npm run test:ui    # operates the running app in headless Chrome; needs `npm run dev` and Google Chrome
```

`npm run test:ui` resets the sample data and writes JPG captures and `results.txt` to `.local/evidence/`.

## Who can do what

| Caller | How it is identified | Can do |
| --- | --- | --- |
| Reader | nobody signed in | Graph, library, book, node, about, search. Only published content. |
| Owner | signs in with `MASTER_USER` and `MASTER_PASSWORD` | Lists drafts, decides each detection, approves and publishes, discards. |
| Agent | `x-agent-key` header equal to `AGENT_KEY` | Looks up names and uploads draft packages. Never publishes; owner routes refuse it. |

## What is simulated locally

These belong to AppDeploy or to an outside caller and are stood in for here. None of it has been checked on AppDeploy.

- **Secrets.** `MASTER_USER`, `MASTER_PASSWORD` and `AGENT_KEY` are random values written to the ignored `.env` file on first start. The server reads them from that file only, never from the parent shell, so real credentials in your environment are not picked up. Values are not logged.
- **Database, storage and routing.** `local/sdk.ts` and `local/database.ts` stand in for `@appdeploy/sdk` (SQLite file and a folder under `.local/`); `local/client.ts` stands in for `@appdeploy/client`. They mirror the documented limits (256 KiB per record, 100 actions per transaction, lookups by ID).
- **Account switching.** *Reader* and *Owner* in the staging bar sign out or sign in as the owner without typing the password. The real sign-in form is at `#/review`.
- **The agent.** *Upload a draft*, *Upload twice*, *Look up names* and *Try to publish* make the local server call the agent routes with the key. The key never reaches the browser.
- **Other publications and failures.** *Same-name node appears* publishes a node named 外資買超 outside the draft, so approval has to ask again. *Next publish fails* makes one approval fail.
- **Reset data** restores the sample data and signs out.

## Routes

`#/graph`, `#/library`, `#/article/<id>`, `#/article/<id>~read`, `#/node/<id>`, `#/about`, `#/review` (sign-in or drafts), `#/review/<draftId>`, `#/review/<draftId>~text`.

Backend: `GET /api/graph`, `/api/library`, `/api/books/:id`, `/api/nodes/:id`, `/api/local/:id?depth=1..3`, `/api/search`; `POST /api/agent/lookup`, `/api/agent/drafts`; `GET /api/owner/session`, `POST /api/owner/login`, `/api/owner/logout`, `GET /api/owner/drafts`, `/api/owner/drafts/:id`, `POST /api/owner/drafts/:id/decisions`, `/approve`, `/discard`.

## Source

- `shared/graph.ts` — types used by both sides.
- `backend/store.ts` — node identity, lookup, drafts, the publish plan and transaction, reader views. `backend/index.ts` — routes and the three guards. `backend/seed.ts` — sample data.
- `src/` — React app. `Canvas.tsx` (graph page, local graph), `Graph.tsx` (the renderer, kept behind one component), `pages/Public.tsx`, `pages/Owner.tsx`, `model.ts` (layout), `store.tsx` (routing, data loading), `styles.css` (design tokens as CSS variables).
- `local/` — the AppDeploy stand-ins and `simulate.ts`.
- `tests/backend.test.ts`, `tests/ui-flow.mjs`.

## How it works, briefly

- A node's ID is derived from its official name, so one name is one node. Aliases are separate records that point to a node.
- The agent uploads a package; the backend classifies every detection against the live graph (existing, alias, close match, new). A retry with the same `requestId` returns the first receipt.
- Nothing from a draft is public. Readers are served only from a versioned snapshot that is written at publish time.
- Approval rechecks proposed new names against the live graph, then writes the book, nodes, aliases, attributes and links in one transaction that also moves the snapshot version. If it fails, the version does not move and nothing appears.
- An attribute value equal to a node's official name is saved as a link; an alias or any other text stays text. A text attribute becomes a link when a node with that name is published later.

## Known gaps and differences from the plan

- **Graph renderer:** an SVG component, not Sigma.js. Fine for the sample graph; not measured on a large one.
- **Search:** plain substring matching in the browser over published names, aliases and text. MiniSearch and `Intl.Segmenter` are not used.
- **Styling:** CSS variables from the approved prototype. Tailwind was removed.
- **Reading:** a book uploaded as a draft reads as text with node links. The V1 page-by-page image reader, covers and favorites were not carried over; seeded books have no pages and covers are drawn placeholders.
- **Recheck at approval:** the approved visual offers "Create a new node anyway". Because one official name is one node, this build offers "Rename it instead".
- **Owner sign-in form:** built from existing styles; it has no approved visual.
- **Public wording:** the graph tools and search are in Traditional Chinese; the approved captures showed some of them in English.
- **Not built:** sign-in rate limiting, undoing a decision in the UI, a confirmation before discard, AppDeploy's `tests/tests.json`, and the V1 features (ETF, calendar, institutional research, discussion).
- **Not tested:** anything on AppDeploy (secrets, quotas, storage URLs, deployment), screen readers, reduced motion, measured contrast, real devices.
