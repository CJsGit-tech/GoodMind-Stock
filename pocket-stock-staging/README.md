# 股脈 (PocketStocksV2) · local staging

The knowledge-graph rebuild of PocketStocks: research books, the nodes they mention, and an owner review that decides what enters the graph. This folder replaced the V1 local staging app on 11 November 2026. The V1 source (books, ETF, calendar, institutional research) is in git commit `c4da60a`.

Design and requirements live in LinearBoard (project PocketStocksV2). This build follows the approved visuals v1.4 and draft review v1.5.

## Deployed version

The first version was deployed to AppDeploy on 11 November 2026 as the app **股脈**, id `goodmind-stock-rzzp1j`, at https://goodmind-stock-rzzp1j.v2.appdeploy.ai/. It is a separate app from the earlier PocketStocks apps, which were not touched.

- **What was sent:** `shared/`, `backend/` and `src/` except `src/staging/`, plus AppDeploy's own `tests/tests.json`. `local/` and this folder's `tests/` stay local. `src/App.tsx`, `src/main.tsx` and `src/index.css` match AppDeploy's template; the app itself starts in `src/Root.tsx`.
- **Data:** the app seeds itself on first request with the sample data in `backend/seed.ts` (50 nodes, 15 books, one waiting draft). Sample books are marked 示範 and their text says it is sample text.
- **Secrets:** `MASTER_USER`, `MASTER_PASSWORD` and `AGENT_KEY` were entered by the owner in AppDeploy's secure form and bound to the app on 11 November 2026. Nobody else has seen their values. If one is ever missing, owner sign-in answers that it is not configured and the agent routes refuse every key.
- **Checked on the live site at 1366 × 768 and 1440 × 900:** graph, graph search, node page, library, reading, About, and the refusal of a wrong owner login. A real owner sign-in, the draft review and agent upload have not been exercised there.

## Run

Needs Node.js 22.13 or later (it uses Node's built-in SQLite).

```sh
cd pocket-stock-staging
npm ci
npm run dev        # http://localhost:5173
```

The first start seeds sample data: 50 nodes, 15 books, and one draft waiting for review (Draft #12).

## Local staging tools

A small dashed **Staging** control sits in the bottom-right corner and shows the current test account. It opens a panel with everything that is only for local testing. The site itself looks as it will in production.

- It is loaded only by the dev server: `src/App.tsx` imports `src/staging/` behind `import.meta.env.DEV`, so `npm run build` output contains none of it, and the `/__local/simulate` endpoint it calls exists only in `local/server.ts`.
- **Test account:** Reader or Owner, without typing the password. The real sign-in form is at `#/review`.
- **Agent key:** upload a sample draft, upload it twice, look up names, or try to publish (refused). The local server makes these calls; the key never reaches the browser.
- **Simulate:** a same-name node appears before approval, or the next publish fails once.
- **Reset sample data** restores the seed and signs out.

## Layout and interaction

- **Header:** brand, then 財經心智圖 (the graph route), 書庫 and 關於我們, and sign-in at the far right. There is no search in the header. 登入 opens the owner sign-in at `#/review`; once signed in it becomes the Owner link and 登出. Only the owner has an account; readers do not sign in.
- **About:** a hero (headline, one primary action, counts read from the published graph) beside the live graph, then two open sections: how research enters the graph, and three commitments. It no longer uses disclosures.
- **Width:** every route uses the full window width inside one gutter. The library is a grid that adds columns as the window widens, the node and book pages split into two columns, and the draft review shows its graph preview beside the list from 1100 px. Only running text (book text, draft text, lead paragraphs) keeps a readable line length.
- **Graph look:** node size follows the number of links, hubs get larger white labels, links are gently curved, books are small diamonds whose titles appear when pointed at or when a neighbour is selected, and pointing at a node brings its neighbours forward. The graph route shows a one-line legend at the bottom left.
- **Graphs:** nodes can be dragged. Their links pull the neighbours along and a dropped node stays where it was put. On the graph route the new positions are kept across routes until the page is reloaded, and the reset icon puts them back. The graph route also pans (drag empty space) and zooms with the wheel; there are no zoom buttons. Its tools sit in the top-right corner of the stage: search first (a result is selected in the graph rather than opened), then the reset icon and 篩選; and the filter panel and node peek open just under them. The layout is stretched to the window's shape.
- **Dismissing:** the graph peek and filter panel close with ×, Escape, or a click on empty space; a second click on the selected node also closes the peek. Library filters have 清除篩選. In the draft review, Escape closes the open row, a decision can be undone from its row, a failed publish can be set aside with "Not now", and Discard draft asks first.

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
The test-account switch, agent calls and simulations are described under *Local staging tools* above.

## Routes

`#/graph`, `#/library`, `#/article/<id>`, `#/article/<id>~read`, `#/node/<id>`, `#/about`, `#/review` (sign-in or drafts), `#/review/<draftId>`, `#/review/<draftId>~text`.

Backend: `GET /api/graph`, `/api/library`, `/api/books/:id`, `/api/nodes/:id`, `/api/local/:id?depth=1..3`, `/api/search`; `POST /api/agent/lookup`, `/api/agent/drafts`; `GET /api/owner/session`, `POST /api/owner/login`, `/api/owner/logout`, `GET /api/owner/drafts`, `/api/owner/drafts/:id`, `POST /api/owner/drafts/:id/decisions`, `/approve`, `/discard`.

## Source

- `shared/graph.ts` — types used by both sides.
- `backend/store.ts` — node identity, lookup, drafts, the publish plan and transaction, reader views. `backend/index.ts` — routes and the three guards. `backend/seed.ts` — sample data. `backend/hash.ts` — SHA-256 and token helpers with no Node-only imports.
- `src/` — React app. `Root.tsx` (routes and shell), `Canvas.tsx` (graph page, local graph), `Graph.tsx` (the renderer, kept behind one component), `pages/Public.tsx`, `pages/Owner.tsx`, `model.ts` (layout), `store.tsx` (routing, data loading), `styles.css` (design tokens as CSS variables).
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
- **Not built:** sign-in rate limiting, moving graph nodes with the keyboard, saving dragged positions across reloads, AppDeploy's `tests/tests.json`, and the V1 features (ETF, calendar, institutional research, discussion).
- **Not tested:** on AppDeploy, the owner review, agent upload, secrets and quotas; anywhere, screen readers, reduced motion, measured contrast, real devices.
