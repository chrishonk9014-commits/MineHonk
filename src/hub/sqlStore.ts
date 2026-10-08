/**
 * The hub's storage in SQL, written against the part of Cloudflare D1's API
 * it uses (prepare / bind / first / all / run / batch). The cloud hub runs it
 * on D1; tests run it on Node's built-in SQLite through a small adapter.
 * The schema is in hub/migrations.
 */
import type { HubStore, SessionRecord, UserRecord, WorldEntry } from './store';

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

interface UserRow {
  uuid: string;
  name: string;
  salt: string;
  hash: string;
  created_at: number;
  failures: number;
  locked_until: number;
}

const toUser = (r: UserRow | null): UserRecord | null =>
  r ? { uuid: r.uuid, name: r.name, salt: r.salt, hash: r.hash, createdAt: Number(r.created_at), failures: Number(r.failures), lockedUntil: Number(r.locked_until) } : null;

function parseWorld(data: string): WorldEntry | null {
  try {
    return JSON.parse(data) as WorldEntry;
  } catch {
    return null;
  }
}

export class SqlHubStore implements HubStore {
  /** Sessions are pruned now and then rather than on every sign-in (each deletion is a write). */
  private pruneEvery = 25;
  private sincePrune = 0;

  constructor(readonly db: SqlDb) {}

  // ------------------------------------------------------------------ accounts

  async userByUuid(uuid: string): Promise<UserRecord | null> {
    return toUser(await this.db.prepare('SELECT * FROM users WHERE uuid = ?').bind(uuid).first<UserRow>());
  }

  async userByName(nameLower: string): Promise<UserRecord | null> {
    return toUser(await this.db.prepare('SELECT * FROM users WHERE name_lower = ?').bind(nameLower).first<UserRow>());
  }

  async insertUser(u: UserRecord): Promise<boolean> {
    const r = await this.db
      .prepare('INSERT INTO users (uuid, name, name_lower, salt, hash, created_at, failures, locked_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(u.uuid, u.name, u.name.toLowerCase(), u.salt, u.hash, u.createdAt, u.failures, u.lockedUntil)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async updateUser(uuid: string, patch: Partial<Pick<UserRecord, 'failures' | 'lockedUntil'>>): Promise<void> {
    if (patch.failures !== undefined && patch.lockedUntil !== undefined) await this.db.prepare('UPDATE users SET failures = ?, locked_until = ? WHERE uuid = ?').bind(patch.failures, patch.lockedUntil, uuid).run();
    else if (patch.failures !== undefined) await this.db.prepare('UPDATE users SET failures = ? WHERE uuid = ?').bind(patch.failures, uuid).run();
    else if (patch.lockedUntil !== undefined) await this.db.prepare('UPDATE users SET locked_until = ? WHERE uuid = ?').bind(patch.lockedUntil, uuid).run();
  }

  async session(tokenHash: string): Promise<SessionRecord | null> {
    const r = await this.db.prepare('SELECT uuid, expires FROM sessions WHERE token_hash = ?').bind(tokenHash).first<{ uuid: string; expires: number }>();
    return r ? { uuid: r.uuid, expires: Number(r.expires) } : null;
  }

  async putSession(tokenHash: string, s: SessionRecord): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO sessions (token_hash, uuid, expires) VALUES (?, ?, ?)').bind(tokenHash, s.uuid, s.expires).run();
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async pruneSessions(now: number): Promise<void> {
    if (++this.sincePrune < this.pruneEvery) return;
    this.sincePrune = 0;
    await this.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now).run();
  }

  // ------------------------------------------------------------------ friends

  async friendsOf(uuid: string): Promise<string[]> {
    return (await this.db.prepare('SELECT b FROM friends WHERE a = ? ORDER BY rowid').bind(uuid).all<{ b: string }>()).results.map((r) => r.b);
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    return !!(await this.db.prepare('SELECT 1 AS x FROM friends WHERE a = ? AND b = ?').bind(a, b).first());
  }

  async incoming(uuid: string): Promise<string[]> {
    return (await this.db.prepare('SELECT from_uuid FROM friend_requests WHERE to_uuid = ? ORDER BY at').bind(uuid).all<{ from_uuid: string }>()).results.map((r) => r.from_uuid);
  }

  async outgoing(uuid: string): Promise<string[]> {
    return (await this.db.prepare('SELECT to_uuid FROM friend_requests WHERE from_uuid = ? ORDER BY at').bind(uuid).all<{ to_uuid: string }>()).results.map((r) => r.to_uuid);
  }

  async hasRequest(from: string, to: string): Promise<boolean> {
    return !!(await this.db.prepare('SELECT 1 AS x FROM friend_requests WHERE from_uuid = ? AND to_uuid = ?').bind(from, to).first());
  }

  async addRequest(from: string, to: string, at: number): Promise<void> {
    await this.db.prepare('INSERT OR IGNORE INTO friend_requests (from_uuid, to_uuid, at) VALUES (?, ?, ?)').bind(from, to, at).run();
  }

  async deleteRequest(from: string, to: string): Promise<void> {
    await this.db.prepare('DELETE FROM friend_requests WHERE from_uuid = ? AND to_uuid = ?').bind(from, to).run();
  }

  async addFriends(a: string, b: string): Promise<void> {
    await this.db.batch([this.db.prepare('INSERT OR IGNORE INTO friends (a, b) VALUES (?, ?)').bind(a, b), this.db.prepare('INSERT OR IGNORE INTO friends (a, b) VALUES (?, ?)').bind(b, a)]);
  }

  async removeFriends(a: string, b: string): Promise<void> {
    await this.db.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').bind(a, b, b, a).run();
  }

  async blocked(uuid: string): Promise<string[]> {
    return (await this.db.prepare('SELECT who FROM blocks WHERE by_uuid = ?').bind(uuid).all<{ who: string }>()).results.map((r) => r.who);
  }

  async isBlocked(by: string, who: string): Promise<boolean> {
    return !!(await this.db.prepare('SELECT 1 AS x FROM blocks WHERE by_uuid = ? AND who = ?').bind(by, who).first());
  }

  async setBlocked(by: string, who: string, on: boolean): Promise<void> {
    if (on) await this.db.prepare('INSERT OR IGNORE INTO blocks (by_uuid, who) VALUES (?, ?)').bind(by, who).run();
    else await this.db.prepare('DELETE FROM blocks WHERE by_uuid = ? AND who = ?').bind(by, who).run();
  }

  // ------------------------------------------------------------------ worlds

  async world(id: string): Promise<WorldEntry | null> {
    const r = await this.db.prepare('SELECT data FROM worlds WHERE id = ?').bind(id).first<{ data: string }>();
    return r ? parseWorld(r.data) : null;
  }

  async worldByCode(code: string): Promise<WorldEntry | null> {
    const r = await this.db.prepare('SELECT data FROM worlds WHERE join_code = ?').bind(code).first<{ data: string }>();
    return r ? parseWorld(r.data) : null;
  }

  async countOwned(owner: string): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM worlds WHERE owner = ?').bind(owner).first<{ n: number }>();
    return Number(r?.n ?? 0);
  }

  async candidates(viewer: string): Promise<WorldEntry[]> {
    const rows = await this.db
      .prepare(
        `SELECT data FROM worlds WHERE owner = ?1
           OR id IN (SELECT world_id FROM world_members WHERE uuid = ?1)
           OR visibility = 'public'
           OR (visibility = 'friends' AND owner IN (SELECT b FROM friends WHERE a = ?1))
         LIMIT 500`,
      )
      .bind(viewer)
      .all<{ data: string }>();
    return rows.results.map((r) => parseWorld(r.data)).filter((e): e is WorldEntry => !!e);
  }

  async putWorld(e: WorldEntry): Promise<void> {
    const members = new Set([...e.allowlist, ...e.operators, ...Object.keys(e.roles)]);
    members.delete(e.owner);
    const old = await this.db.prepare('SELECT data FROM worlds WHERE id = ?').bind(e.id).first<{ data: string }>();
    const prev = old ? parseWorld(old.data) : null;
    const prevMembers = prev ? new Set([...prev.allowlist, ...prev.operators, ...Object.keys(prev.roles)].filter((u) => u !== prev.owner)) : new Set<string>();
    const stmts: SqlStatement[] = [
      this.db.prepare('INSERT OR REPLACE INTO worlds (id, owner, visibility, join_code, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(e.id, e.owner, e.visibility, e.joinCode, JSON.stringify(e), e.createdAt),
    ];
    // Only the membership rows that changed (each row written counts)
    for (const u of members) if (!prevMembers.has(u)) stmts.push(this.db.prepare('INSERT OR IGNORE INTO world_members (world_id, uuid) VALUES (?, ?)').bind(e.id, u));
    for (const u of prevMembers) if (!members.has(u)) stmts.push(this.db.prepare('DELETE FROM world_members WHERE world_id = ? AND uuid = ?').bind(e.id, u));
    await this.db.batch(stmts);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.db.batch([this.db.prepare('DELETE FROM worlds WHERE id = ?').bind(id), this.db.prepare('DELETE FROM world_members WHERE world_id = ?').bind(id)]);
  }

  async codeTaken(code: string): Promise<boolean> {
    return !!(await this.db.prepare('SELECT 1 AS x FROM worlds WHERE join_code = ?').bind(code).first());
  }
}
