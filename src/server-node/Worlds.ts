/**
 * Hosted worlds: a registry of every world on the hub (who owns it, who may
 * see and join it, its join code) and the running GameServer instances,
 * started when the first player joins and saved and unloaded once empty.
 *
 * While a world runs, its LevelData is authoritative for access settings
 * (in-game /op, /ban, /role, /pvp change it); the registry copy is synced
 * from it periodically and when the world stops.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { GameServer } from '../server/GameServer';
import { installGameplay } from '../server/gameplay';
import type { Connection } from '../server/net/Connection';
import type { LevelData } from '../server/world/LevelData';
import type { C2S } from '../common/net/protocol';
import { GAME_MODES, DIFFICULTIES, normalizeGodHearts, type GameMode, type Difficulty } from '../common/game/gamemode';
import { joinCodeFromBytes, normalizeJoinCode, type WorldDetails, type WorldRole, type WorldSummary, type WorldVisibility, type AccountInfo } from '../common/net/multiplayer';
import { JsonStore } from './JsonStore';
import { FileStorage } from './FileStorage';
import type { Accounts } from './Accounts';
import type { Friends } from './Friends';
import type { ChatFilter } from '../server/moderation/ChatFilter';

export interface WorldEntry {
  id: string;
  name: string;
  owner: string;
  visibility: WorldVisibility;
  joinCode: string | null;
  allowlist: string[];
  banned: string[];
  operators: string[];
  roles: Record<string, 'builder' | 'visitor'>;
  defaultRole: 'builder' | 'visitor';
  pvp: boolean;
  mode: GameMode;
  maxPlayers: number;
  createdAt: number;
}

interface Registry {
  worlds: Record<string, WorldEntry>;
}

interface Running {
  server: GameServer;
  storage: FileStorage;
  emptySince: number | null;
}

export class WorldError extends Error {}

const MAX_WORLDS_PER_USER = 10;
const IDLE_STOP_MS = 60_000;

export interface WorldsDeps {
  dataDir: string;
  accounts: Accounts;
  friends: Friends;
  filter: ChatFilter;
  log: (m: string) => void;
  maxPlayers?: number;
  /** Faster world ticking for tests. */
  serverOptions?: { genBudgetMs?: number; chunksPerTick?: number };
}

export class Worlds {
  private readonly running = new Map<string, Running>();
  private readonly starting = new Map<string, Promise<Running>>();
  /** Account uuid -> world id they are currently playing in. */
  readonly presence = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly store: JsonStore<Registry>,
    private readonly deps: WorldsDeps,
  ) {}

  static async open(deps: WorldsDeps): Promise<Worlds> {
    const store = await JsonStore.open<Registry>(
      path.join(deps.dataDir, 'worlds.json'),
      () => ({ worlds: {} }),
      (raw) => {
        const r = raw as Partial<Registry>;
        return r && typeof r === 'object' && r.worlds && typeof r.worlds === 'object' ? { worlds: r.worlds } : null;
      },
      deps.log,
    );
    const w = new Worlds(store, deps);
    w.timer = setInterval(() => void w.maintain(), 5000);
    return w;
  }

  private get worlds(): Record<string, WorldEntry> {
    return this.store.data.worlds;
  }

  private dir(id: string): string {
    return path.join(this.deps.dataDir, 'worlds', id);
  }

  // ------------------------------------------------------------------ access rules

  /** Current access settings (live level while running). */
  private access(id: string): WorldEntry | null {
    const e = this.worlds[id];
    if (!e) return null;
    const r = this.running.get(id);
    if (!r) return e;
    const l = r.server.level;
    return { ...e, name: l.name, visibility: l.visibility, joinCode: l.joinCode, allowlist: l.allowlist, banned: l.banned, operators: l.operators, roles: l.roles, defaultRole: l.defaultRole, pvp: l.pvp, mode: l.mode };
  }

  roleIn(e: WorldEntry, uuid: string): WorldRole | null {
    if (e.banned.includes(uuid)) return null;
    if (e.owner === uuid) return 'owner';
    if (e.operators.includes(uuid)) return 'operator';
    const explicit = e.roles[uuid];
    const invited = e.allowlist.includes(uuid) || explicit !== undefined;
    const friend = e.visibility !== 'private' && this.deps.friends.areFriends(e.owner, uuid);
    if (invited || friend || e.visibility === 'public') return explicit ?? e.defaultRole;
    return null;
  }

  /** Why `uuid` may not join, or null when allowed. */
  private joinDenied(e: WorldEntry, uuid: string): string | null {
    if (e.banned.includes(uuid)) return 'You are banned from this world.';
    if (!this.roleIn(e, uuid)) return 'This world is private. Ask the owner for a join code.';
    return null;
  }

  private summary(e: WorldEntry, viewer: string): WorldSummary {
    const r = this.running.get(e.id);
    return {
      id: e.id,
      name: e.name,
      owner: e.owner,
      ownerName: this.deps.accounts.info(e.owner)?.name ?? 'unknown',
      visibility: e.visibility,
      mode: e.mode,
      players: r ? r.server.players.size : 0,
      maxPlayers: e.maxPlayers,
      role: this.roleIn(e, viewer),
    };
  }

  list(viewer: string): { mine: WorldSummary[]; friends: WorldSummary[]; public: WorldSummary[] } {
    const out = { mine: [] as WorldSummary[], friends: [] as WorldSummary[], public: [] as WorldSummary[] };
    for (const id of Object.keys(this.worlds)) {
      const e = this.access(id)!;
      const role = this.roleIn(e, viewer);
      if (!role) continue;
      const s = this.summary(e, viewer);
      if (e.owner === viewer || e.allowlist.includes(viewer) || e.operators.includes(viewer) || e.roles[viewer]) out.mine.push(s);
      else if (e.visibility !== 'private' && this.deps.friends.areFriends(e.owner, viewer)) out.friends.push(s);
      else if (e.visibility === 'public') out.public.push(s);
    }
    const byPlayers = (a: WorldSummary, b: WorldSummary): number => b.players - a.players || a.name.localeCompare(b.name);
    out.mine.sort(byPlayers);
    out.friends.sort(byPlayers);
    out.public.sort(byPlayers);
    out.public = out.public.slice(0, 50);
    return out;
  }

  details(id: string, viewer: string): WorldDetails | null {
    const e = this.access(id);
    if (!e) return null;
    const role = this.roleIn(e, viewer);
    if (!role) return null;
    const d: WorldDetails = { ...this.summary(e, viewer), pvp: e.pvp, defaultRole: e.defaultRole };
    if (role === 'owner' || role === 'operator') {
      d.joinCode = e.joinCode;
      const ids = new Set([e.owner, ...e.operators, ...e.allowlist, ...Object.keys(e.roles)]);
      d.members = [...ids].map((uuid) => ({ uuid, name: this.deps.accounts.info(uuid)?.name ?? 'unknown', role: this.roleIn(e, uuid) ?? 'visitor' }));
    }
    return d;
  }

  // ------------------------------------------------------------------ management

  private newCode(): string {
    const taken = new Set(Object.values(this.worlds).map((w) => w.joinCode));
    for (;;) {
      const c = joinCodeFromBytes(randomBytes(8));
      if (!taken.has(c)) return c;
    }
  }

  async create(owner: AccountInfo, o: { name?: unknown; seed?: unknown; mode?: unknown; difficulty?: unknown; godHearts?: unknown; visibility?: unknown }): Promise<WorldDetails> {
    if (Object.values(this.worlds).filter((w) => w.owner === owner.uuid).length >= MAX_WORLDS_PER_USER) throw new WorldError(`You can own up to ${MAX_WORLDS_PER_USER} worlds`);
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 48) : '';
    if (!name) throw new WorldError('Give your world a name');
    const masked = this.deps.filter.mask(name);
    if (masked.changed) throw new WorldError('Please choose a different world name');
    const mode = GAME_MODES.includes(o.mode as GameMode) && o.mode !== 'spectator' ? (o.mode as GameMode) : 'survival';
    const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty) ? (o.difficulty as Difficulty) : 'normal';
    const visibility: WorldVisibility = o.visibility === 'public' || o.visibility === 'friends' ? o.visibility : 'private';
    const seed = typeof o.seed === 'string' && o.seed.trim() ? o.seed.trim().slice(0, 64) : randomBytes(6).toString('hex');
    const id = randomBytes(8).toString('hex');
    const entry: WorldEntry = {
      id,
      name,
      owner: owner.uuid,
      visibility,
      joinCode: this.newCode(),
      allowlist: [],
      banned: [],
      operators: [owner.uuid],
      roles: {},
      defaultRole: 'builder',
      pvp: false,
      mode,
      maxPlayers: this.deps.maxPlayers ?? 16,
      createdAt: Date.now(),
    };
    const storage = new FileStorage(this.dir(id), this.deps.log);
    const server = await GameServer.open(storage, { id, name, seed, mode, difficulty, godHearts: normalizeGodHearts(o.godHearts ?? 10), pvp: false, cheats: mode === 'creative', owner: owner.uuid, visibility }, {});
    this.applyEntry(server.level, entry);
    await storage.writeLevel(server.level);
    await storage.close();
    this.worlds[id] = entry;
    this.store.changed();
    this.deps.log(`[hub] ${owner.name} created world "${name}" (${id})`);
    return this.details(id, owner.uuid)!;
  }

  private applyEntry(l: LevelData, e: WorldEntry): void {
    l.name = e.name;
    l.owner = e.owner;
    l.visibility = e.visibility;
    l.joinCode = e.joinCode;
    l.allowlist = [...e.allowlist];
    l.banned = [...e.banned];
    l.operators = [...e.operators];
    l.roles = { ...e.roles };
    l.defaultRole = e.defaultRole;
    l.pvp = e.pvp;
  }

  private syncFromLevel(id: string): void {
    const r = this.running.get(id);
    const e = this.worlds[id];
    if (!r || !e) return;
    const l = r.server.level;
    Object.assign(e, { name: l.name, visibility: l.visibility, joinCode: l.joinCode, allowlist: [...l.allowlist], banned: [...l.banned], operators: [...l.operators], roles: { ...l.roles }, defaultRole: l.defaultRole, pvp: l.pvp, mode: l.mode });
    this.store.changed();
  }

  private requireManager(id: string, viewer: string, ownerOnly = false): WorldEntry {
    const e = this.access(id);
    if (!e) throw new WorldError('World not found');
    const role = this.roleIn(e, viewer);
    if (role !== 'owner' && (ownerOnly || role !== 'operator')) throw new WorldError('Only the owner or operators can do that');
    return e;
  }

  /** Applies a change to the registry entry and to the live world. */
  private mutate(id: string, fn: (e: WorldEntry) => void): void {
    const e = this.worlds[id]!;
    this.syncFromLevel(id);
    fn(e);
    const r = this.running.get(id);
    if (r) {
      this.applyEntry(r.server.level, e);
      for (const p of r.server.players.values()) p.send({ t: 'world_info', world: r.server.worldInfo(p) });
    }
    this.store.changed();
  }

  update(id: string, viewer: string, patch: { name?: unknown; visibility?: unknown; pvp?: unknown; defaultRole?: unknown }): WorldDetails {
    this.requireManager(id, viewer);
    this.mutate(id, (e) => {
      if (typeof patch.name === 'string' && patch.name.trim()) {
        const n = patch.name.trim().slice(0, 48);
        if (this.deps.filter.mask(n).changed) throw new WorldError('Please choose a different world name');
        e.name = n;
      }
      if (patch.visibility === 'private' || patch.visibility === 'friends' || patch.visibility === 'public') e.visibility = patch.visibility;
      if (typeof patch.pvp === 'boolean') e.pvp = patch.pvp;
      if (patch.defaultRole === 'builder' || patch.defaultRole === 'visitor') e.defaultRole = patch.defaultRole;
    });
    return this.details(id, viewer)!;
  }

  regenerateCode(id: string, viewer: string, enabled = true): WorldDetails {
    this.requireManager(id, viewer);
    this.mutate(id, (e) => {
      e.joinCode = enabled ? this.newCode() : null;
    });
    return this.details(id, viewer)!;
  }

  setRole(id: string, viewer: string, target: string, role: unknown): WorldDetails {
    const e = this.requireManager(id, viewer);
    if (!this.deps.accounts.info(target)) throw new WorldError('Player not found');
    if (target === e.owner) throw new WorldError("The owner's role cannot change");
    if (role === 'operator' && e.owner !== viewer) throw new WorldError('Only the owner can make operators');
    if (e.operators.includes(target) && e.owner !== viewer) throw new WorldError('Only the owner can change an operator');
    this.mutate(id, (w) => {
      w.operators = w.operators.filter((u) => u !== target);
      if (role === 'operator') w.operators.push(target);
      else if (role === 'builder' || role === 'visitor') w.roles[target] = role;
      else if (role === 'remove') {
        delete w.roles[target];
        w.allowlist = w.allowlist.filter((u) => u !== target);
      } else throw new WorldError('Unknown role');
      if (role !== 'remove' && !w.allowlist.includes(target)) w.allowlist.push(target);
    });
    return this.details(id, viewer)!;
  }

  ban(id: string, viewer: string, target: string, banned: boolean): WorldDetails {
    const e = this.requireManager(id, viewer);
    if (target === e.owner) throw new WorldError('The owner cannot be banned');
    if (e.operators.includes(target) && e.owner !== viewer) throw new WorldError('Only the owner can ban an operator');
    this.mutate(id, (w) => {
      w.banned = w.banned.filter((u) => u !== target);
      if (banned) {
        w.banned.push(target);
        w.operators = w.operators.filter((u) => u !== target);
      }
    });
    if (banned) {
      const r = this.running.get(id);
      for (const p of r ? [...r.server.players.values()] : []) if (p.uuid === target) r!.server.kick(p, 'You have been banned from this world');
    }
    return this.details(id, viewer)!;
  }

  async remove(id: string, viewer: string): Promise<void> {
    this.requireManager(id, viewer, true);
    const r = this.running.get(id);
    if (r) {
      for (const p of [...r.server.players.values()]) r.server.kick(p, 'This world was deleted');
      await r.server.stop();
      this.running.delete(id);
    }
    delete this.worlds[id];
    this.store.changed();
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }

  /** Redeems a join code: the player is invited to the world. */
  redeem(code: unknown, viewer: string): WorldSummary {
    const c = normalizeJoinCode(String(code ?? ''));
    if (!c) throw new WorldError('Join codes look like ABC7-92KD');
    const id = Object.keys(this.worlds).find((w) => this.access(w)!.joinCode === c);
    if (!id) throw new WorldError('No world has that code');
    const e = this.access(id)!;
    if (e.banned.includes(viewer)) throw new WorldError('You are banned from this world');
    if (!this.roleIn(e, viewer))
      this.mutate(id, (w) => {
        if (!w.allowlist.includes(viewer)) w.allowlist.push(viewer);
      });
    return this.summary(this.access(id)!, viewer);
  }

  // ------------------------------------------------------------------ hosting

  private async ensureRunning(id: string): Promise<Running> {
    const r = this.running.get(id);
    if (r) return r;
    let p = this.starting.get(id);
    if (!p) {
      p = (async () => {
        const e = this.worlds[id]!;
        const storage = new FileStorage(this.dir(id), this.deps.log);
        const server = await GameServer.open(storage, null, {
          log: (m) => this.deps.log(`[${e.name}] ${m}`),
          maxPlayers: e.maxPlayers,
          canJoin: (identity, level) => this.joinDenied({ ...e, visibility: level.visibility, allowlist: level.allowlist, banned: level.banned, operators: level.operators, roles: level.roles, defaultRole: level.defaultRole }, identity.uuid),
          filterChat: (text, player) => {
            const res = this.deps.filter.check(text, player.uuid);
            if (res.reason) player.send({ t: 'chat', text: res.reason, kind: 'error' });
            return res.text;
          },
          ...this.deps.serverOptions,
        });
        this.applyEntry(server.level, e);
        installGameplay(server);
        const run: Running = { server, storage, emptySince: Date.now() };
        server.onPlayerLeft = (pl) => {
          if (this.presence.get(pl.uuid) === id) this.presence.delete(pl.uuid);
        };
        server.onEmpty = () => {
          run.emptySince = Date.now();
        };
        server.onReport = (from, target, reason) => this.deps.log(`[report] world ${id}: ${from.name} -> ${target.name}: ${reason}`);
        server.start();
        this.running.set(id, run);
        this.starting.delete(id);
        this.deps.log(`[hub] started world "${e.name}" (${id})`);
        return run;
      })();
      this.starting.set(id, p);
      p.catch(() => this.starting.delete(id));
    }
    return p;
  }

  /** Connects an authenticated player to a world. */
  async connect(conn: Connection, account: AccountInfo, hello: C2S & { t: 'hello' }, id: string): Promise<GameServer | null> {
    const e = this.access(id);
    const deny = e ? this.joinDenied(e, account.uuid) : 'World not found';
    if (deny) {
      conn.send({ t: 'kick', reason: deny });
      conn.close(deny);
      return null;
    }
    const r = await this.ensureRunning(id);
    const p = await r.server.connect(conn, { uuid: account.uuid, name: account.name }, hello);
    if (!p) return null;
    r.emptySince = null;
    this.presence.set(account.uuid, id);
    return r.server;
  }

  /** Periodic upkeep: sync settings and unload idle worlds. */
  private async maintain(): Promise<void> {
    for (const [id, r] of [...this.running]) {
      this.syncFromLevel(id);
      if (r.server.players.size === 0 && r.emptySince !== null && Date.now() - r.emptySince > IDLE_STOP_MS) {
        this.running.delete(id);
        await r.server.stop().catch((err) => this.deps.log(`[hub] failed to stop ${id}: ${err}`));
        this.deps.log(`[hub] unloaded idle world ${id}`);
      }
    }
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const [id, r] of this.running) {
      this.syncFromLevel(id);
      await r.server.stop().catch(() => {});
    }
    this.running.clear();
    await this.store.flush();
  }
}
