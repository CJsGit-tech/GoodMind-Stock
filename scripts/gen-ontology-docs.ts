// Usage: npm run docs:ontology — writes docs/ONTOLOGY.md from the ontology the app actually enforces.
import fs from 'node:fs';
import { buildOntology, ONTOLOGY_VERSION, RULES } from '../lib/ontology';
import { WRITABLE_STORAGE } from '../lib/types';
import type { EdgeType, PropertyDef } from '../lib/types';

const { entityTypes, edgeTypes } = buildOntology();
const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const prop = (p: PropertyDef) => `\`${p.name}\` (${p.datatype}${p.values ? `: ${p.values.join(' \\| ')}` : ''})`;
// Attributes every node type accepts, listed once instead of under each type.
const shared = entityTypes[0].properties.filter(p => !p.required && entityTypes.every(t => t.name === 'Technology' || t.properties.some(x => x.name === p.name)));
const sharedNames = new Set(shared.map(p => p.name));
const out: string[] = [
  '# 本體論參考 Ontology reference', '',
  `版本 Version **${ONTOLOGY_VERSION}**。本文件由 \`npm run docs:ontology\` 從程式產生，請勿手動修改。`,
  'Generated from the code by `npm run docs:ontology`; do not edit by hand. 定義檔 Source: [`lib/registry.v4.json`](../lib/registry.v4.json), [`lib/ontology.ts`](../lib/ontology.ts)。', '',
  '資料格式與匯入規則見 For the file format and import rules see [DATA-SPEC.md](DATA-SPEC.md) / [DATA-SPEC.en.md](DATA-SPEC.en.md)。', '',
  '## 節點類型 Node types', '',
  '每個節點 Every node: `id`, `type`, `name`, `attributes`。', '',
  `所有類型都可使用的屬性 Attributes accepted by every type: ${shared.map(prop).join(', ')}`, '',
  '| type | 中文 | English | 必填屬性 Required | 其他屬性 Other attributes |', '|---|---|---|---|---|',
  ...entityTypes.map(t => `| \`${t.name}\`${t.abstract ? ' *(abstract)*' : ''} | ${cell(t.label)} | ${cell(t.label_en)} | ${t.properties.filter(p => p.required).map(prop).join('<br>') || '—'} | ${t.properties.filter(p => !p.required && !sharedNames.has(p.name)).map(p => `\`${p.name}\``).join(', ') || '—'} |`), '',
  '### 命名與擷取規則 Naming and extraction rules（中文）', '',
  ...entityTypes.filter(t => !t.abstract).flatMap(t => [`- **\`${t.name}\` ${t.label}** — ${t.definition}`, `  - 命名：${t.naming_rule}`, `  - 擷取：${t.extraction_rule}`]), '',
];
const table = (list: EdgeType[]) => {
  const rows: string[] = [];
  for (const group of [...new Set(list.map(p => p.group))]) {
    rows.push(`### ${group}`, '', '| predicate | 中文 | from → to | 說明 Meaning |', '|---|---|---|---|');
    for (const p of list.filter(x => x.group === group)) rows.push(`| \`${p.predicate}\`${p.evidenceRequired ? ' **\\***' : ''} | ${cell(p.label)} | ${p.from.join(' / ')} → ${p.to.join(' / ')} | ${cell(p.meaning)}${p.meaning_en ? `<br>${cell(p.meaning_en)}` : ''} |`);
    rows.push('');
  }
  return rows;
};
const writable = edgeTypes.filter(p => WRITABLE_STORAGE.has(p.storage)), computed = edgeTypes.filter(p => !WRITABLE_STORAGE.has(p.storage));
out.push('## 可匯入的關係 Relations you can import', '', `共 ${writable.length} 種。**\\*** = 必須附 \`evidence_ids\` evidence required。端點接受子類型 Subtypes are accepted (Product, Service → Offering)。`, '', ...table(writable));
out.push('## 系統算出或建議的關係（不可匯入） Computed or suggested relations (cannot be imported)', '', `共 ${computed.length} 種。`, '', ...table(computed));
out.push('## 規則 Rules（中文）', '', '| id | kind | 說明 |', '|---|---|---|', ...RULES.map(r => `| \`${r.id}\` | ${r.kind} | ${cell(r.description)} |`), '');
fs.writeFileSync('docs/ONTOLOGY.md', out.join('\n'));
console.log(`docs/ONTOLOGY.md: ${entityTypes.length} node types, ${writable.length} importable and ${computed.length} computed or suggested relations, ${RULES.length} rules`);
