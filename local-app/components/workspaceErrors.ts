import { translations } from './locale-core';

type Translator = (source: string, values?: Record<string, string | number>) => string;
const patterns: { pattern: string; source: string; keys: string[] }[] = [
  {
    'pattern': '^(.+):\\ non\\-empty\\ IDs/names\\ up\\ to\\ 180\\ characters\\ required\\.$',
    'source': '{id}: non-empty IDs/names up to 180 characters required.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ duplicate\\ IDs/names\\.$',
    'source': '{id}: duplicate IDs/names.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ definition\\ is\\ required\\.$',
    'source': '{id}: definition is required.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ endpoint\\ classes\\ must\\ exist\\.$',
    'source': '{id}: endpoint classes must exist.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ invalid\\ storage\\ policy\\.$',
    'source': '{id}: invalid storage policy.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ group\\ and\\ meaning\\ required\\.$',
    'source': '{id}: group and meaning required.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ canonical\\ derived\\ predicate\\ cannot\\ be\\ stored\\.$',
    'source': '{id}: canonical derived predicate cannot be stored.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ invalid\\ verification\\ status\\.$',
    'source': '{id}: invalid verification status.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ evidence_ids\\ must\\ refer\\ to\\ Evidence\\ nodes\\.$',
    'source': '{id}: evidence_ids must refer to Evidence nodes.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ (.+)\\ must\\ use\\ HTTP\\(S\\)\\.$',
    'source': '{id}: {key} must use HTTP(S).',
    'keys': [
      'id',
      'key'
    ]
  },
  {
    'pattern': '^(.+):\\ invalid\\ date\\ for\\ (.+)\\.$',
    'source': '{id}: invalid date for {key}.',
    'keys': [
      'id',
      'key'
    ]
  },
  {
    'pattern': '^(.+):\\ valid_to\\ precedes\\ valid_from\\.$',
    'source': '{id}: valid_to precedes valid_from.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ unknown\\ entity\\ class\\.$',
    'source': '{id}: unknown entity class.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ name\\ is\\ required\\.$',
    'source': '{id}: name is required.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ unknown\\ predicate\\.$',
    'source': '{id}: unknown predicate.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ derived\\ predicates\\ cannot\\ be\\ saved\\ as\\ base\\ edges\\.$',
    'source': '{id}: derived predicates cannot be saved as base edges.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ endpoints\\ must\\ be\\ (.+)\\ →\\ (.+)\\.$',
    'source': '{id}: endpoints must be {from} → {to}.',
    'keys': [
      'id',
      'from',
      'to'
    ]
  },
  {
    'pattern': '^(.+):\\ self\\-links\\ are\\ not\\ supported\\.$',
    'source': '{id}: self-links are not supported.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ incomplete\\ relationship\\ record;\\ treated\\ as\\ draft,\\ excluded\\ from\\ projections\\.$',
    'source': '{id}: incomplete relationship record; treated as draft, excluded from projections.',
    'keys': [
      'id'
    ]
  },
  {
    'pattern': '^(.+):\\ no\\ verification\\ status;\\ not\\ a\\ confirmed\\ claim\\.$',
    'source': '{id}: no verification status; not a confirmed claim.',
    'keys': [
      'id'
    ]
  }
];

/** Match only our known validator templates; never translate arbitrary identifiers. */
export function localizeWorkspaceDiagnostic(message: string, t: Translator): string {
  return message.split('\n').map(line => {
    if (!line) return line;
    if (translations[line]) return t(line);
    for (const entry of patterns) {
      const match = new RegExp(entry.pattern).exec(line);
      if (match) {
        return t(entry.source, Object.fromEntries(entry.keys.map((key, i) => [key, match[i + 1]])));
      }
    }
    return t('操作未完成。以下為原始診斷，請保留內容並重試。') + '\n' + line;
  }).join('\n');
}
