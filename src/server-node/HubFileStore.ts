/**
 * The hub's storage for the Node server: the same JSON files as always
 * (accounts.json, friends.json, worlds.json in the data folder), kept in
 * memory and written in the background.
 */
import * as path from 'node:path';
import { JsonStore } from './JsonStore';
import type { HubStore, SessionRecord, UserRecord, WorldEntry } from '../hub/store';

interface AccountData {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
}

interface FriendData {
  friends: Record<string, string[]>;
  requests: { from: string; to: string; at: number }[];
  blocks: Record<string, string[]>;
}

interface Registry {
  worlds: Record<string, WorldEntry>;
}

export class HubFileStore implements HubStore {
  private readonly byName = new Map<string, string>();

  private constructor(
    readonly accountsFile: JsonStore<AccountData>,
    readonly friendsFile: JsonStore<FriendData>,
    readonly worldsFile: JsonStore<Registry>,
  ) {
    for (const u of Object.values(accountsFile.data.users)) this.byName.set(u.name.toLowerCase(), u.uuid);
  }

  static async open(dir: string, log: (m: string) => void): Promise<HubFileStore> {
    const accounts = await JsonStore.open<AccountData>(
      path.join(dir, 'accounts.json'),
      () => ({ users: {}, sessions: {} }),
      (raw) => {
        const r = raw as Partial<AccountData>;
        if (!r || typeof r !== 'object' || !r.users || !r.sessions) return null;
        return { users: r.users, sessions: r.sessions };
      },
      log,
    );
    const friends = await JsonStore.open<FriendData>(
      path.join(dir, 'friends.json'),
      () => ({ friends: {}, requests: [], blocks: {} }),
      (raw) => {
        const r = raw as Partial<FriendData>;
        if (!r || typeof r !== 'object' || !r.friends || !Array.isArray(r.requests)) return null;
        return { friends: r.friends, requests: r.requests, blocks: r.blocks && typeof r.blocks === 'object' ? r.blocks : {} };
      },
      log,
    );
    const worlds = await JsonStore.open<Registry>(
      path.join(dir, 'worlds.json'),
      () => ({ worlds: {} }),
      (raw) => {
        const r = raw as Partial<Registry>;
        return r && typeof r === 'object' && r.worlds && typeof r.worlds === 'object' ? { worlds: r.worlds } : null;
      },
      log,
    );
    return new HubFileStore(accounts, friends, worlds);
  }

  async flush(): Promise<void> {
    await this.accountsFile.flush();
    await this.friendsFile.flush();
    await this.worldsFile.flush();
  }

  // ------------------------------------------------------------------ accounts

  private get users(): Record<string, UserRecord> {
    return this.accountsFile.data.users;
  }

  /** Synchronous lookup (the in-memory copy). */
  userSync(uuid: string): UserRecord | null {
    return this.users[uuid] ?? null;
  }

  async userByUuid(uuid: string): Promise<UserRecord | null> {
    return this.userSync(uuid);
  }

  async userByName(nameLower: string): Promise<UserRecord | null> {
    const uuid = this.byName.get(nameLower);
    return uuid ? (this.users[uuid] ?? null) : null;
  }

  async insertUser(u: UserRecord): Promise<boolean> {
    if (this.byName.has(u.name.toLowerCase())) return false;
    this.users[u.uuid] = { ...u };
    this.byName.set(u.name.toLowerCase(), u.uuid);
    this.accountsFile.changed();
    return true;
  }

  async updateUser(uuid: string, patch: Partial<Pick<UserRecord, 'failures' | 'lockedUntil'>>): Promise<void> {
    const u = this.users[uuid];
    if (!u) return;
    Object.assign(u, patch);
    this.accountsFile.changed();
  }

  async session(tokenHash: string): Promise<SessionRecord | null> {
    return this.accountsFile.data.sessions[tokenHash] ?? null;
  }

  async putSession(tokenHash: string, s: SessionRecord): Promise<void> {
    this.accountsFile.data.sessions[tokenHash] = { ...s };
    this.accountsFile.changed();
  }

  async deleteSession(tokenHash: string): Promise<void> {
    delete this.accountsFile.data.sessions[tokenHash];
    this.accountsFile.changed();
  }

  async pruneSessions(now: number): Promise<void> {
    const sessions = this.accountsFile.data.sessions;
    for (const [k, s] of Object.entries(sessions)) if (s.expires < now) delete sessions[k];
    this.accountsFile.changed();
  }

  // ------------------------------------------------------------------ friends

  private get fd(): FriendData {
    return this.friendsFile.data;
  }

  areFriendsSync(a: string, b: string): boolean {
    return (this.fd.friends[a] ?? []).includes(b);
  }

  isBlockedSync(by: string, who: string): boolean {
    return (this.fd.blocks[by] ?? []).includes(who);
  }

  async friendsOf(uuid: string): Promise<string[]> {
    return [...(this.fd.friends[uuid] ?? [])];
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    return this.areFriendsSync(a, b);
  }

  async incoming(uuid: string): Promise<string[]> {
    return this.fd.requests.filter((r) => r.to === uuid).map((r) => r.from);
  }

  async outgoing(uuid: string): Promise<string[]> {
    return this.fd.requests.filter((r) => r.from === uuid).map((r) => r.to);
  }

  async hasRequest(from: string, to: string): Promise<boolean> {
    return this.fd.requests.some((r) => r.from === from && r.to === to);
  }

  async addRequest(from: string, to: string, at: number): Promise<void> {
    this.fd.requests.push({ from, to, at });
    this.friendsFile.changed();
  }

  async deleteRequest(from: string, to: string): Promise<void> {
    const before = this.fd.requests.length;
    this.fd.requests = this.fd.requests.filter((r) => !(r.from === from && r.to === to));
    if (this.fd.requests.length !== before) this.friendsFile.changed();
  }

  async addFriends(a: string, b: string): Promise<void> {
    const f = this.fd.friends;
    if (!(f[a] ??= []).includes(b)) f[a].push(b);
    if (!(f[b] ??= []).includes(a)) f[b].push(a);
    this.friendsFile.changed();
  }

  async removeFriends(a: string, b: string): Promise<void> {
    const f = this.fd.friends;
    f[a] = (f[a] ?? []).filter((u) => u !== b);
    f[b] = (f[b] ?? []).filter((u) => u !== a);
    this.friendsFile.changed();
  }

  async blocked(uuid: string): Promise<string[]> {
    return [...(this.fd.blocks[uuid] ?? [])];
  }

  async isBlocked(by: string, who: string): Promise<boolean> {
    return this.isBlockedSync(by, who);
  }

  async setBlocked(by: string, who: string, on: boolean): Promise<void> {
    const list = (this.fd.blocks[by] ??= []).filter((u) => u !== who);
    if (on) list.push(who);
    this.fd.blocks[by] = list;
    this.friendsFile.changed();
  }

  // ------------------------------------------------------------------ worlds

  get worlds(): Record<string, WorldEntry> {
    return this.worldsFile.data.worlds;
  }

  async world(id: string): Promise<WorldEntry | null> {
    const e = this.worlds[id];
    return e ? structuredClone(e) : null;
  }

  async worldByCode(code: string): Promise<WorldEntry | null> {
    const e = Object.values(this.worlds).find((w) => w.joinCode === code);
    return e ? structuredClone(e) : null;
  }

  async countOwned(owner: string): Promise<number> {
    return Object.values(this.worlds).filter((w) => w.owner === owner).length;
  }

  async candidates(): Promise<WorldEntry[]> {
    return Object.values(this.worlds).map((e) => structuredClone(e));
  }

  async putWorld(e: WorldEntry): Promise<void> {
    this.worlds[e.id] = structuredClone(e);
    this.worldsFile.changed();
  }

  async deleteWorld(id: string): Promise<void> {
    delete this.worlds[id];
    this.worldsFile.changed();
  }

  async codeTaken(code: string): Promise<boolean> {
    return Object.values(this.worlds).some((w) => w.joinCode === code);
  }
}
