"""Builds the AppDeploy bundle for app good-mind-mxn7j5 (Next.js static template + SDK backend)
from the Vite source in goodmind-lite/. Output: ../deploy-goodmind/
The public build has no free-text chat (no AI provider is called); guided browsing, company search,
the data guide and the admin workspace (sign-in with the MASTER_USERNAME / MASTER_PASSWORD app secrets) are included.
Usage: python3 deploy/build_appdeploy.py"""
import json, os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), 'deploy-goodmind')

def w(rel, text):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(text if text.endswith('\n') else text + '\n')
def rd(rel): return open(os.path.join(ROOT, rel)).read()
def fix(t): return t.replace("'../../lib/", "'../core/")

for d in ['gm', 'galaxy', 'pages', 'styles', 'backend', 'tests', 'shared']:
    shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)

# ---- shared logic (pure TypeScript: runs in the browser)
for f in ['types', 'hash', 'derive', 'groups', 'query', 'ontology', 'validate', 'write', 'suggest', 'gqc', 'sample']:
    w(f'gm/core/{f}.ts', rd(f'lib/{f}.ts'))
reg = json.load(open(os.path.join(ROOT, 'lib/registry.v4.json')))
slim_reg = {
    'version': reg['version'],
    'node_types': [{k: n[k] for k in ['id', 'name', 'parent', 'status', 'abstract', 'why', 'required_keys', 'suggested_keys']} | {'naming_rule': '', 'extraction_rule': ''} | {'attributes': {'name_en': n['attributes']['name_en']}} for n in reg['node_types']],
    'relation_types': [{k: r[k] for k in ['id', 'name', 'inverse_name', 'group', 'from_types', 'to_types', 'cardinality', 'kind', 'status', 'description']} | {'attributes': {'name_en': r['attributes']['name_en'], 'inverse_en': r['attributes'].get('inverse_en')}} for r in reg['relation_types']],
}
reg_lines = ['{', ' "version": %s,' % json.dumps(reg['version']),
             ' "node_types": [', ',\n'.join('  ' + json.dumps(n, ensure_ascii=False, separators=(',', ':')) for n in slim_reg['node_types']), ' ],',
             ' "relation_types": [', ',\n'.join('  ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in slim_reg['relation_types']), ' ]', '}']
w('gm/core/registry.v4.json', '\n'.join(reg_lines))

# ---- data: nodes and edges only (types and rules come from the registry). Migration and link-check bookkeeping is
# removed, and edges are packed as [relation, from, to, reliability, sources, other attributes] with node positions
# instead of ids; gm/data/decode.ts restores the full shape.
seed = json.load(open(os.path.join(ROOT, 'data/seed.json')))
DROP = {'legacy_ids', 'verification_legacy', 'curation', 'recorded_at', 'link_checked_at', 'link_status', 'publisher_method', 'date_method', 'reverified_for_package', 'split_from'}
def slim(x): return {k: v for k, v in x['attributes'].items() if k not in DROP and v not in ([], None, '')}
nodes = [{'id': n['id'], 'type': n['type'], 'name': n['name'], 'attributes': slim(n)} for n in seed['nodes']]
pos = {n['id']: i for i, n in enumerate(nodes)}
rels = sorted({e['predicate'] for e in seed['edges']})
STATUS = {'verified': 'v', 'reported': 'r', 'inferred': 'i', 'suggested': 's', 'disputed': 'd'}
edges = []
for e in seed['edges']:
    a = slim(e)
    row = [rels.index(e['predicate']), pos[e['from']], pos[e['to']], STATUS[a.pop('verification_status', 'reported')], [pos[x] for x in a.pop('evidence_ids', [])]]
    if a: row.append(a)
    edges.append(row)
data = {'as_of': seed['as_of'], 'dataset_id': seed['dataset_id'], 'disclaimer': seed['disclaimer'], 'relations': rels, 'nodes': nodes, 'edges': edges}
def rows_file(rel, key, rows):
    w(rel, '{\n "%s": [\n' % key + ',\n'.join('  ' + json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in rows) + '\n ]\n}')
    json.loads(open(os.path.join(OUT, rel)).read())
# Split so no single file is too large to send in one deploy call.
# Fixed-size chunks in data order: adding nodes only appends to the last chunk or adds a new one, so earlier
# chunk files stay byte-identical and an update only has to upload the changed chunks (plus edges and decode).
CHUNK = 101
PARTS = -(-len(nodes) // CHUNK)
for f in os.listdir(os.path.join(OUT, 'gm/data')) if os.path.isdir(os.path.join(OUT, 'gm/data')) else []:
    if f.startswith('nodes') and f.endswith('.json'): os.remove(os.path.join(OUT, 'gm/data', f))
for i in range(PARTS):
    rows_file(f'gm/data/nodes{i + 1}.json', 'nodes', nodes[i * CHUNK:(i + 1) * CHUNK])
rows_file('gm/data/edges.json', 'edges', edges)
check = sum(len(n['id']) + len(n['name']) for n in nodes)
w('gm/data/decode.ts', ("""// Restores the packed dataset (nodes1-N.json, edges.json) to full nodes and edges.
// Edges are stored as [relation, from, to, reliability, sources, other attributes] using node positions.
__IMPORTS__import packedEdges from './edges.json';
import { factId } from '../core/write';
import type { GraphEdge, GraphNode } from '../core/types';

const META = %s;
const RELATIONS: string[] = %s;
const EXPECTED = { nodes: %d, edges: %d, check: %d };
const STATUS: Record<string, string> = { v: 'verified', r: 'reported', i: 'inferred', s: 'suggested', d: 'disputed' };
type Row = [number, number, number, string, number[], Record<string, unknown>?];

export function decodeSeed(): { as_of: string; dataset_id: string; disclaimer: string; nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [__SPREAD__] as unknown as GraphNode[];
  const rows = packedEdges.edges as unknown as Row[];
  const check = nodes.reduce((sum, n) => sum + n.id.length + n.name.length, 0);
  if (nodes.length !== EXPECTED.nodes || rows.length !== EXPECTED.edges || check !== EXPECTED.check) {
    console.error('GoodMind dataset is incomplete', { nodes: nodes.length, edges: rows.length, check });
  }
  const edges = rows.map(([rel, from, to, status, sources, extra]) => {
    const predicate = RELATIONS[rel];
    return {
      id: factId(predicate, nodes[from].id, nodes[to].id), predicate, from: nodes[from].id, to: nodes[to].id,
      attributes: { verification_status: STATUS[status], ...(sources.length ? { evidence_ids: sources.map(i => nodes[i].id) } : {}), ...(extra ?? {}) },
    };
  });
  return { ...META, nodes, edges };
}
""" % (json.dumps({k: data[k] for k in ['as_of', 'dataset_id', 'disclaimer']}, ensure_ascii=False, indent=2).replace('"', "'") if False else json.dumps({k: data[k] for k in ['as_of', 'dataset_id', 'disclaimer']}, ensure_ascii=False, indent=2),
       '[\n  ' + ',\n  '.join("'%s'" % r for r in rels) + ',\n]', len(nodes), len(edges), check)
  ).replace('__IMPORTS__', ''.join(f"import part{i + 1} from './nodes{i + 1}.json';\n" for i in range(PARTS))
  ).replace('__SPREAD__', ', '.join(f'...part{i + 1}.nodes' for i in range(PARTS))))

# ---- UI
for f in ['GalaxyGraph', 'Graph2D', 'GraphView', 'FilterPanel', 'Dossier', 'TopBar', 'ResearchConsole', 'ChatSettings', 'WritePanel', 'Docs']:
    w(f'gm/components/{f}.tsx', fix(rd(f'src/components/{f}.tsx')))
for f in ['Explore', 'Workspace', 'DocsPage']:
    w(f'gm/pages/{f}.tsx', fix(rd(f'src/pages/{f}.tsx')))
w('gm/components/graphShared.ts', fix(rd('src/components/graphShared.ts')))
for f in ['filters.ts', 'theme.ts', 'api.ts']:
    w(f'gm/lib/{f}', fix(rd(f'src/lib/{f}')))
w('gm/lib/http.ts', rd('deploy/src/http.ts'))
w('gm/lib/features.ts', """// Public deployment: free-text chat is off (no AI provider is called); the admin workspace is available after sign-in.
export const CHAT_ENABLED = false;
export const WORKSPACE_EDITABLE = true;
""")
w('gm/lib/chatApi.ts', """// Free-text chat is not available on the public site.
import type { ChatMessage, ChatResult, ToolStep } from '../core/types';

export async function askGraphStream(_question: string, _history: ChatMessage[], _onStep: (s: ToolStep) => void): Promise<ChatResult> {
  throw new Error('Chat is not available.');
}
""")
i18n = rd('src/i18n/index.ts')
i18n = i18n.replace("import en from './locales/en.json';\n", '')
i18n = i18n.replace("export const LOCALES = [{ code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }] as const;", "export const LOCALES: readonly { code: string; label: string }[] = [{ code: 'zh-TW', label: '繁體中文' }];")
i18n = i18n.replace("resources: { 'zh-TW': { translation: zhTW }, en: { translation: en } },", "resources: { 'zh-TW': { translation: zhTW } },")
assert "import en" not in i18n and "en: {" not in i18n
w('gm/i18n/index.ts', i18n)
w('gm/i18n/locales/zh-TW.json', rd('src/i18n/locales/zh-TW.json'))
w('gm/App.tsx', """import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './i18n';
import Explore from './pages/Explore';
import Workspace from './pages/Workspace';
import DocsPage from './pages/DocsPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Explore />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
""")
w('styles/galaxy.css', rd('src/styles.css'))

page = """import dynamic from 'next/dynamic';
import Head from 'next/head';

// three.js needs the browser, so the app renders client-side only.
const App = dynamic(() => import('../gm/App'), { ssr: false, loading: () => <div className="fullscreen-msg"><div className="orb" /><p>載入知識圖譜…</p></div> });

export default function Page() {
  return (
    <>
      <Head><title>股脈 GoodMind · 產業知識圖譜</title></Head>
      <App />
    </>
  );
}
"""
def routed(hash_path):
    return page.replace("export default function Page() {", "export default function Page() {\n  if (typeof window !== 'undefined' && !window.location.hash) window.location.replace('%s');" % hash_path)
w('pages/index.tsx', page)
w('pages/good-mind.tsx', page)
w('pages/workspace.tsx', routed('#/workspace'))
w('pages/docs.tsx', routed('#/docs'))
w('pages/_app.tsx', """import type { AppProps } from 'next/app';
import '../styles/galaxy.css';

export default function GoodMindApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
""")
w('pages/_document.tsx', """import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="zh-TW">
      <Head>
        <meta name="description" content="股脈 GoodMind：有來源的產業知識圖譜，整理公司、產品與它們之間經過查證的關係。" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
""")
w('backend/index.ts', rd('deploy/src/backend.ts'))

tests = [
  {"name": "Find companies by a condition in the research assistant", "sanity": True, "viewport": "desktop",
   "covers": ["graph load via GET /api/graph", "guided browsing in the research assistant", "company search by condition", "applied-filter chips", "3D graph rendering"],
   "description": "Verifies the graph loads and a guided condition search filters it to the matching companies.",
   "steps": ["Open the app", "In the research assistant click 用條件找公司", "Click 技術", "Click NVIDIA Jetson Orin 平台"],
   "expected": "The assistant replies that 4 companies match and shows buttons for 輝達, 凌華, 研華 and 艾訊; a chip reading 技術：NVIDIA Jetson Orin 平台 appears at the top of the assistant."},
  {"name": "Inspect a company found by ticker", "viewport": "desktop",
   "covers": ["search by ticker and alias", "company details panel", "relations grouped by kind", "sources list"],
   "description": "Verifies identity resolution by ticker and the details panel content.",
   "steps": ["Type 2330 in the search box at the top", "Choose 台積電 from the results"],
   "expected": "A details panel titled 台積電 with the English name TSMC shows 股票代號 2330, 國家 台灣, a 關係 section that includes N2 晶圓製程, and a 來源 section."},
  {"name": "Read the data guide", "viewport": "desktop",
   "covers": ["data guide page", "node type schema table", "available relations search", "search structure table", "methodology"],
   "description": "Verifies the public data guide lists the schema, relations, search structure and methodology.",
   "steps": ["Open the app", "Click 資料說明 in the top bar", "In the 可用關係 section type 供應 in the search box"],
   "expected": "The page shows the headings 節點類型, 可用關係, 搜尋結構 and 方法; the node type table includes 公司 with the required field 國家; after typing 供應 the relations table still lists 供應給 and no longer lists 屬於集團."},
  {"name": "Admin workspace rejects a wrong sign-in", "viewport": "mobile",
   "covers": ["admin sign-in via POST /api/admin/login", "admin status via GET /api/admin/status", "wrong-credentials guardrail", "workspace hidden from anonymous visitors"],
   "description": "Verifies the admin workspace asks for a sign-in and refuses wrong credentials without showing maintenance tools.",
   "steps": ["Open the app at the path /workspace", "Type wrong-user in 帳號 and wrong-password-123 in 密碼", "Click 登入"],
   "expected": "The message 帳號或密碼不正確。 is shown, the 管理員登入 form is still visible, and no 建立關係 or 待審核的建議 section appears."},
]
w('tests/tests.json', json.dumps(tests, ensure_ascii=False, indent=2))
json.loads(open(os.path.join(OUT, 'tests/tests.json')).read())

pkg = json.load(open(os.path.join(OUT, 'package.json')))
pkg['dependencies'].update({'react-force-graph-2d': '^1.29.2', 'i18next': '^27.2.7', 'react-i18next': '^18.0.3', 'zod': '^4.3.6'})
pkg['version'] = '0.4.0'
# Pinned: 1.46.0 calls Tween.remove(), which only exists in @tweenjs/tween.js 25; the install resolves 23.1.3, so
# dragging or zooming during a camera move threw "n.remove is not a function".
pkg['overrides'] = {'three-render-objects': '1.45.0'}
open(os.path.join(OUT, 'package.json'), 'w').write(json.dumps(pkg, indent=2) + '\n')
total = 0
for base, _, files in os.walk(OUT):
    if 'node_modules' in base or '/out' in base or '/.next' in base: continue
    for f in files:
        if base.startswith(os.path.join(OUT, 'gm')) or any(base.startswith(os.path.join(OUT, d)) for d in ['pages', 'styles', 'backend', 'tests']):
            total += os.path.getsize(os.path.join(base, f))
print('built', OUT, f'{total/1024:.0f} KB to upload')
