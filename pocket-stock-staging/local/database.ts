import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type Row = Record<string, unknown>;
type Update = { id: string; record: Row; if?: Row };
type Operation = { kind: 'add' | 'update' | 'delete'; table: string; items: any[]; patch?: boolean };
export interface DbOperation<T> extends PromiseLike<T> {
  catch: Promise<T>['catch'];
  finally: Promise<T>['finally'];
}
export class LocalDatabaseError extends Error {
  readonly statusCode = 503;
  readonly details = {};
  constructor(readonly code: string) { super(code); }
}
export const isAppDatabaseError = (value: unknown): value is LocalDatabaseError =>
  value instanceof LocalDatabaseError;
const fail = (code: string): never => { throw new LocalDatabaseError(code); };

// One SQLite connection serializes commits; composed operations use a real transaction.
export function createDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sql = new DatabaseSync(filename);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(bucket,id))');
  const read = sql.prepare('SELECT data FROM records WHERE bucket=? AND id=?');
  const put = sql.prepare('INSERT INTO records(bucket,id,data) VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET data=excluded.data');
  const remove = sql.prepare('DELETE FROM records WHERE bucket=? AND id=?');
  const get = (table: string, id: string): Row | null => {
    const row = read.get(table, id);
    return row ? JSON.parse(row.data as string) : null;
  };
  function save(table: string, id: string, record: Row) {
    const data = JSON.stringify(record);
    if (Buffer.byteLength(data) > 256 * 1024) fail('AppDatabaseItemTooLarge');
    put.run(table, id, data);
  }
  function execute(ops: Operation[], composed: boolean) {
    if (composed && (ops.reduce((n, op) => n + op.items.length, 0) > 100 || Buffer.byteLength(JSON.stringify(ops)) > 4 * 1024 * 1024)) fail('AppDatabaseTransactionTooLarge');
    const seen = new Set<string>();
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = ops.map(op => op.items.map(item => {
        const id = typeof item === 'string' ? item : item.id;
        const target = JSON.stringify([op.table, id]);
        if (composed && seen.has(target)) fail('AppDatabaseInvalidInput');
        seen.add(target);
        const old = get(op.table, id);
        if (op.kind === 'add') {
          if (old) { if (composed) fail('AppDatabaseDuplicateId'); return null; }
          save(op.table, id, item);
          return id;
        }
        if (op.kind === 'delete') return remove.run(op.table, id).changes > 0;
        if (op.patch && !old || item.if && Object.entries(item.if).some(([key, value]) => !isDeepStrictEqual(old?.[key], value))) {
          if (composed) fail('AppDatabaseConditionFailed');
          return false;
        }
        if (op.patch && !Object.keys(item.record).length) fail('AppDatabaseInvalidInput');
        save(op.table, id, op.patch ? { ...old, ...item.record } : item.record);
        return true;
      }));
      sql.exec('COMMIT');
      return results;
    } catch (caught) { sql.exec('ROLLBACK'); throw caught; }
  }
  const handles = new WeakMap<object, { operation: Operation; consumed: boolean }>();
  function lazy<T>(operation: Operation): DbOperation<T> {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(operation.table) || operation.table.includes('__')) fail('AppDatabaseInvalidInput');
    operation = structuredClone(operation);
    const state = { operation, consumed: false };
    let promise: Promise<T> | undefined;
    const run = () => {
      if (!promise) {
        if (state.consumed) return Promise.reject(new LocalDatabaseError('AppDatabaseCapabilityInvalid'));
        state.consumed = true;
        promise = Promise.resolve().then(() => execute([operation], false)[0] as T);
      }
      return promise;
    };
    const handle: DbOperation<T> = {
      then: (resolve, reject) => run().then(resolve, reject),
      catch: reject => run().catch(reject),
      finally: action => run().finally(action),
    };
    handles.set(handle, state);
    return handle;
  }
  const api = {
    tx: {
      add: (table: string, rows: Row[]) => lazy<(string | null)[]>({ kind: 'add', table, items: rows.map(row => ({ ...row, id: typeof row.id === 'string' && row.id ? row.id : randomUUID() })) }),
      update: (table: string, items: Update[], options?: { patch?: boolean }) => lazy<boolean[]>({ kind: 'update', table, items, patch: options?.patch }),
      delete: (table: string, items: string[]) => lazy<boolean[]>({ kind: 'delete', table, items }),
    },
    async transact<const T extends readonly DbOperation<unknown>[]>(operations: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
      const states = operations.map(op => handles.get(op));
      if (new Set(operations).size !== operations.length || states.some(state => !state || state.consumed)) fail('AppDatabaseCapabilityInvalid');
      states.forEach(state => { state!.consumed = true; });
      return execute(states.map(state => state!.operation), true) as any;
    },
    async add(table: string, rows: Row[]) {
      // Legacy adds generate a physical ID independently of any payload id.
      return rows.map(row => { const id = randomUUID(); save(table, id, row); return id; });
    },
    async update(table: string, items: Update[]) {
      return items.map(({ id, record }) => { if (!get(table, id)) return false; save(table, id, record); return true; });
    },
    async delete(table: string, ids: string[]) { return ids.map(id => remove.run(table, id).changes > 0); },
    async get<T = Row>(table: string, ids: string[], _options?: { consistent?: boolean }): Promise<(T | null)[]> {
      if (ids.length > 500 || Buffer.byteLength(JSON.stringify(ids)) > 1024 * 1024) fail('AppDatabaseRequestTooLarge');
      return ids.map(id => get(table, id) as T | null);
    },
    async list<T = Row>(table: string, options: { limit?: number; nextToken?: string; filter?: Row } = {}) {
      const limit = Math.max(1, Math.min(options.limit ?? 20, 500));
      let after = 0;
      if (options.nextToken) {
        try {
          const token = JSON.parse(Buffer.from(options.nextToken, 'base64url').toString());
          if (token.table !== table || !Number.isSafeInteger(token.after) || token.after < 0) throw Error();
          after = token.after;
        } catch { fail('AppDatabaseInvalidInput'); }
      }
      const rows = sql.prepare('SELECT rowid,data,id FROM records WHERE bucket=? AND rowid>? ORDER BY rowid LIMIT ?').all(table, after, limit + 1);
      const page = rows.slice(0, limit);
      const items = page.map(row => ({ ...JSON.parse(row.data as string), id: row.id }))
        .filter(row => !options.filter || Object.entries(options.filter).every(([key, value]) => isDeepStrictEqual(row[key], value)));
      return { items: items as (Omit<T, 'id'> & { id: string })[], nextToken: rows.length > limit ? Buffer.from(JSON.stringify({ table, after: Number(page.at(-1)!.rowid) })).toString('base64url') : undefined };
    },
  };
  return { ...api, close: () => sql.close() };
}
