/**
 * A D1-shaped database on Node's built-in SQLite, with the hub's migrations
 * applied: the cloud hub's SQL store runs on it in unit tests.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { SqlDb, SqlStatement } from '../../src/hub/sqlStore';

class Stmt implements SqlStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]): SqlStatement {
    return new Stmt(this.db, this.sql, values);
  }
  private args(): SQLInputValue[] {
    return this.values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : (v as SQLInputValue)));
  }
  async first<T>(): Promise<T | null> {
    return ((this.db.prepare(this.sql).get(...this.args()) as T | undefined) ?? null) as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args()) as T[] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { meta: { changes: Number(r.changes) } };
  }
  runSync(): void {
    this.db.prepare(this.sql).run(...this.args());
  }
}

export function sqliteD1(): SqlDb & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const dir = path.resolve('hub/migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(dir, f), 'utf8'));
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        for (const s of stmts) (s as Stmt).runSync();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}
