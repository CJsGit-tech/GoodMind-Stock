# GoodMind (股脈) — local copy + exports

Source: AppDeploy app `good-mind-mxn7j5` (https://good-mind-mxn7j5.v2.appdeploy.ai/good-mind/)

## Layout
- `local-app/` — runnable Next.js 15 copy (same pages/components/styles as the deployed app)
  - `shared/seed.json`, `shared/model.ts` — graph data + validation (the ontology lives here)
  - `backend/localApi.ts` + `pages/api/[...path].ts` — local replacement for the AppDeploy backend
    (`backend/index.ts`), JSON-file store in `.data/`
- `export/ontology/` — node ontology: entity classes, and node instances by type
- `export/relations/` — relation ontology: predicates (by group) and edge instances (by predicate)

## Run
    cd local-app && npm install && npm run dev      # http://localhost:3000/good-mind

## Simulated placeholders (no real accounts needed)
- Admin sign-in (workspace): `admin` / `goodmind-local` (see `.env.local`)
- OpenAI question parser and AI Playground: deterministic local simulation, no API key
- AppDeploy DB/secrets: replaced by `.data/store.json`
