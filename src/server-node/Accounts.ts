/**
 * Player accounts for the hub: unique names, scrypt password hashes and
 * server-issued session tokens (only their SHA-256 is stored). Repeated
 * wrong passwords lock the account briefly.
 */
import { randomBytes, randomUUID, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { JsonStore } from './JsonStore';
import { validateUsername, validatePassword, type AccountInfo } from '../common/net/multiplayer';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILURES = 8;
const LOCK_MS = 10 * 60 * 1000;

interface User {
  uuid: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
  failures: number;
  lockedUntil: number;
}

interface AccountData {
  users: Record<string, User>;
  sessions: Record<string, { uuid: string; expires: number }>;
}

export class AccountError extends Error {}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class Accounts {
  private byName = new Map<string, string>();

  private constructor(private readonly store: JsonStore<AccountData>) {
    for (const u of Object.values(store.data.users)) this.byName.set(u.name.toLowerCase(), u.uuid);
  }

  static async open(dir: string, log: (m: string) => void): Promise<Accounts> {
    const store = await JsonStore.open<AccountData>(
      path.join(dir, 'accounts.json'),
      () => ({ users: {}, sessions: {} }),
      (raw) => {
        const r = raw as Partial<AccountData>;
        if (!r || typeof r !== 'object' || !r.users || !r.sessions) return null;
        return { users: r.users, sessions: r.sessions };
      },
      log,
    );
    return new Accounts(store);
  }

  info(uuid: string): AccountInfo | null {
    const u = this.store.data.users[uuid];
    return u ? { uuid: u.uuid, name: u.name } : null;
  }

  findByName(name: string): AccountInfo | null {
    const uuid = this.byName.get(String(name).toLowerCase());
    return uuid ? this.info(uuid) : null;
  }

  private async hashPassword(pw: string, salt: Buffer): Promise<Buffer> {
    return scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT);
  }

  async register(name: string, password: string, nameFilter?: (n: string) => boolean): Promise<{ token: string; account: AccountInfo }> {
    const nameErr = validateUsername(name);
    if (nameErr) throw new AccountError(nameErr);
    const pwErr = validatePassword(password);
    if (pwErr) throw new AccountError(pwErr);
    if (nameFilter && !nameFilter(name)) throw new AccountError('Please choose a different name');
    if (this.byName.has(name.toLowerCase())) throw new AccountError('That name is taken');
    const salt = randomBytes(16);
    const hash = await this.hashPassword(password, salt);
    // Re-check after the async hash (two sign-ups racing for one name)
    if (this.byName.has(name.toLowerCase())) throw new AccountError('That name is taken');
    const uuid = randomUUID();
    this.store.data.users[uuid] = { uuid, name, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: Date.now(), failures: 0, lockedUntil: 0 };
    this.byName.set(name.toLowerCase(), uuid);
    this.store.changed();
    return { token: this.newSession(uuid), account: { uuid, name } };
  }

  async login(name: string, password: string): Promise<{ token: string; account: AccountInfo }> {
    const uuid = this.byName.get(String(name).toLowerCase());
    const u = uuid ? this.store.data.users[uuid] : undefined;
    // Hash anyway so timing does not reveal whether the name exists
    const hash = await this.hashPassword(String(password), u ? Buffer.from(u.salt, 'hex') : Buffer.alloc(16));
    if (!u) throw new AccountError('Wrong name or password');
    if (u.lockedUntil > Date.now()) throw new AccountError('Too many attempts. Try again in a few minutes.');
    const ok = timingSafeEqual(hash, Buffer.from(u.hash, 'hex'));
    if (!ok) {
      u.failures++;
      if (u.failures >= MAX_FAILURES) {
        u.failures = 0;
        u.lockedUntil = Date.now() + LOCK_MS;
      }
      this.store.changed();
      throw new AccountError('Wrong name or password');
    }
    u.failures = 0;
    this.store.changed();
    return { token: this.newSession(u.uuid), account: { uuid: u.uuid, name: u.name } };
  }

  private newSession(uuid: string): string {
    const token = randomBytes(32).toString('base64url');
    this.store.data.sessions[tokenHash(token)] = { uuid, expires: Date.now() + SESSION_MS };
    this.pruneSessions();
    this.store.changed();
    return token;
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.store.data.sessions)) if (s.expires < now) delete this.store.data.sessions[k];
  }

  /** Account for a session token, or null. */
  verify(token: string | null | undefined): AccountInfo | null {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const s = this.store.data.sessions[tokenHash(token)];
    if (!s || s.expires < Date.now()) return null;
    return this.info(s.uuid);
  }

  logout(token: string): void {
    delete this.store.data.sessions[tokenHash(token)];
    this.store.changed();
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
