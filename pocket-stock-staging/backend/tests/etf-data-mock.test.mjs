export const tables = new Map();
export const control = { writeFault: null, readFault: null, standaloneFaultTable: null, actions: 0, commits: 0, listCalls: [], getCalls: [] };
export const clone = value => value === undefined ? undefined : structuredClone(value);
export const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
export const isAppDatabaseError = err => typeof err?.code === 'string' && err.code.startsWith('AppDatabase');
function failure(code) { return Object.assign(new Error(code), { code, statusCode: 503, details: {} }); }
function handle(kind, name, rows, options) {
  let used = false; let promise;
  const op = { kind, name, rows, options, consume: () => { if (used) throw new Error('consumed handle'); used = true; },
    then(resolve, reject) { if (!promise) { used = true; promise = Promise.resolve().then(() => commit([op], false)[0]); } return promise.then(resolve, reject); },
  };
  return op;
}
function commit(operations, composed) {
  if (!composed && control.standaloneFaultTable && operations.some(op => op.kind === 'add' && op.name.startsWith(control.standaloneFaultTable))) {
    control.standaloneFaultTable = null;
    throw failure('AppDatabaseUnknownOutcome');
  }
  const count = operations.reduce((n, op) => n + op.rows.length, 0);
  if (count > 100) throw failure('AppDatabaseTransactionTooLarge');
  if (Buffer.byteLength(JSON.stringify(operations)) > 4 * 1024 * 1024) throw failure('AppDatabaseTransactionTooLarge');
  control.actions = Math.max(control.actions, count);
  if (composed && control.writeFault === 'quota') { control.writeFault = null; throw failure('AppDatabaseQuotaExceeded'); }
  if (composed && control.writeFault === 'unknown-pending') { control.writeFault = null; throw failure('AppDatabaseUnknownOutcome'); }
  if (composed && control.writeFault === 'condition') { control.writeFault = null; throw failure('AppDatabaseConditionFailed'); }
  const copy = clone(tables); const results = [];
  const seen = new Set();
  for (const op of operations) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(op.name) || op.name.includes('__')) throw failure('AppDatabaseInvalidInput');
    if (!copy.has(op.name)) copy.set(op.name, new Map());
    const target = copy.get(op.name); const values = [];
    for (const item of op.rows) {
      const id = typeof item === 'string' ? item : item.id;
      const ref = op.name + ':' + id;
      if (seen.has(ref)) throw new Error('duplicate transaction target');
      seen.add(ref);
      if (Buffer.byteLength(JSON.stringify(item)) > 256 * 1024) throw failure('AppDatabaseItemTooLarge');
      const old = target.get(id);
      if (op.kind === 'add') {
        if (old) { if (composed) throw failure('AppDatabaseDuplicateId'); values.push(null); }
        else { target.set(id, clone(item)); values.push(id); }
      } else if (op.kind === 'update') {
        const matches = !item.if || Object.entries(item.if).every(([k, v]) => JSON.stringify(old?.[k]) === JSON.stringify(v));
        if (!matches || op.options?.patch && !old) { if (composed) throw failure('AppDatabaseConditionFailed'); values.push(false); }
        else {
          target.set(id, clone(op.options?.patch ? { ...old, ...item.record } : { id, ...item.record }));
          values.push(true);
        }
      }
    }
    results.push(values);
  }
  tables.clear(); for (const [name, map] of copy) tables.set(name, map);
  control.commits++;
  if (composed && control.writeFault === 'unknown-committed') { control.writeFault = null; throw failure('AppDatabaseUnknownOutcome'); }
  return results;
}
export const db = {
  tx: { add: (name, rows) => handle('add', name, rows), update: (name, rows, options) => handle('update', name, rows, options) },
  transact: async operations => { operations.forEach(op => op.consume()); return commit(operations, true); },
  get: async (name, ids, options) => {
    control.getCalls.push({ table: name, count: ids.length });
    if (!options?.consistent) throw new Error('non-consistent critical read');
    if (ids.length > 500 || Buffer.byteLength(JSON.stringify(ids)) > 1024 * 1024) throw failure('AppDatabaseRequestTooLarge');
    if (control.readFault) { const code = control.readFault; control.readFault = null; throw failure(code); }
    return ids.map(id => clone(table(name).get(id) ?? null));
  },
  list: async (name, options = {}) => {
    if (options.filter) throw new Error('filtered full-history scan forbidden');
    control.listCalls.push(name);
    const values = [...table(name).values()].map(clone);
    const offset = Number(options.nextToken || 0);
    const items = values.slice(offset, offset + options.limit);
    return { items, nextToken: offset + items.length < values.length ? String(offset + items.length) : undefined };
  },
};
export const json = (data, statusCode = 200) => ({ body: JSON.stringify(data), statusCode, headers: {} });
export const error = (message, statusCode = 500) => json({ error: message }, statusCode);
export const storage = { read: async () => [{ content: 'private fixture raw' }] };
