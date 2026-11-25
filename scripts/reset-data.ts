// Usage: npm run reset — empties your local graph (back to data/seed.json). The old data is kept as data/db.backup.json.
import fs from 'node:fs';
import { resetDb } from '../lib/db';

if (fs.existsSync('data/db.json')) fs.copyFileSync('data/db.json', 'data/db.backup.json');
const g = resetDb();
console.log(`local graph reset: ${g.nodes.length} nodes, ${g.edges.length} edges`);
