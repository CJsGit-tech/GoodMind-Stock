// Local read-only API (Express). Vite proxies /api here in dev; in production it also serves dist/.
// Data is written only from the command line (scripts/import-ops.ts), through the same write gate.
import express from 'express';
import path from 'node:path';
import { readDb } from '../lib/db';
import { computeSuggestions } from '../lib/suggest';
import { validateData } from '../lib/validate';
import { resolve } from '../lib/write';
import { gqcRegistry, runGqc } from '../lib/gqc';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/graph', (_req, res) => {
  const { nodes, edges, entityTypes, edgeTypes, ...meta } = readDb();
  res.json({ nodes, edges, entityTypes, edgeTypes, meta });
});

// Data quality against the ontology's declared properties and rules.
app.get('/api/quality', (_req, res) => { res.json(validateData(readDb())); });

// Suggested links: computed from shared groups, never stored as facts.
app.get('/api/suggestions', (_req, res) => { res.json(computeSuggestions(readDb())); });

// GQC: one deterministic query contract for the filter UI and the API (lib/gqc.ts).
app.get('/api/query/registry', (_req, res) => { res.json(gqcRegistry()); });
app.post('/api/query', (req, res) => {
  const r = runGqc(readDb(), req.body);
  if ('errors' in r) return void res.status(400).json(r);
  res.json(r);
});

// Identity resolution: Chinese / English name, alias, ticker or old id → canonical node ids.
app.get('/api/resolve', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200), type = req.query.type ? String(req.query.type) : undefined;
  if (!q) return void res.status(400).json({ error: 'q is required' });
  res.json({ query: q, matches: resolve(readDb(), q, type).map(n => ({ id: n.id, type: n.type, name: n.name, name_en: n.attributes.name_en ?? null })) });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev the web server (Vite) owns 3100 and proxies /api to API_PORT (3101). Listens on this computer only.
const port = Number(process.env.NODE_ENV === 'production' ? process.env.PORT || 3100 : process.env.API_PORT || 3101);
app.listen(port, '127.0.0.1', () => console.log(`GoodMind API on http://localhost:${port}`));
