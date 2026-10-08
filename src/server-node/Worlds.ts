/**
 * Hosted worlds on the Node server: the registry (the shared worlds core,
 * src/hub/worlds.ts, over the JSON files) and the running GameServer
 * instances, started when the first player joins and saved and unloaded
 * once empty.
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
import type { WorldDetails, WorldSummary, AccountInfo } from '../common/net/multiplayer';
import { WorldsCore, WorldError, roleIn, type NewWorldInput } from '../hub/worlds';
import type { WorldEntry } from '../hub/store';
import { FileStorage } from './FileStorage';
import type { HubFileStore } from './HubFileStore';
import type { Accounts } from './Accounts';
import type { Friends } from './Friends';
import type { ChatFilter } from '../server/moderation/ChatFilter';

export { WorldError, type WorldEntry };

interface Running {
  server: GameServer;
  storage: FileStorage;
  emptySince: number | null;
}

const IDLE_STOP_MS = 60_000;

export interface WorldsDeps {
  dataDir: string;
  store: HubFileStore;
  accounts: Accounts;
  friends: Friends;
  filter: ChatFilter;
  log: (m: string) => void;
  maxPlayers?: number;
  /** Faster world ticking for tests. */
  serverOptions?: { genBudgetMs?: number; chunksPerTick?: number };
}

/** A running world's access settings (they win over the registry while it runs). */
function liveOf(l: LevelData): Partial<WorldEntry> {
  return { name: l.name, visibility: l.visibility, joinCode: l.joinCode, allowlist: [...l.allowlist], banned: [...l.banned], operators: [...l.operators], roles: { ...l.roles }, defaultRole: l.defaultRole, pvp: l.pvp, mode: l.mode, cheats: l.cheats, announceAdmin: l.announceAdmin !== false };
}

export class Worlds {
  private readonly running = new Map<string, Running>();
  private readonly starting = new Map<string, Promise<Running>>();
  /** Account uuid -> world id they are currently playing in. */
  readonly presence = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly core: WorldsCore;

  private constructor(private readonly deps: WorldsDeps) {
    const max = deps.maxPlayers ?? 16;
    this.core = new WorldsCore(
      deps.store,
      deps.accounts,
      deps.friends,
      deps.filter,
      {
        live: (id) => {
          const r = this.running.get(id);
          return r ? liveOf(r.server.level) : null;
        },
        players: (id) => this.running.get(id)?.server.players.size ?? 0,
        changed: (e) => this.applyLive(e),
      },
      { maxPlayers: max, maxPlayersCap: max },
    );
  }

  static async open(deps: WorldsDeps): Promise<Worlds> {
    const w = new Worlds(deps);
    w.timer = setInterval(() => void w.maintain(), 5000);
    return w;
  }

  private dir(id: string): string {
    return path.join(this.deps.dataDir, 'worlds', id);
  }

  // ------------------------------------------------------------------ access rules

  /** Why `uuid` may not join (synchronous: the in-memory registry and friend lists). */
  private joinDeniedSync(e: WorldEntry, uuid: string): string | null {
    if (e.banned.includes(uuid)) return 'You are banned from this world.';
    const s = this.deps.store;
    const blocked = e.owner !== uuid && (s.isBlockedSync(e.owner, uuid) || s.isBlockedSync(uuid, e.owner));
    if (blocked || !roleIn(e, uuid, s.areFriendsSync(e.owner, uuid))) return 'This world is private. Ask the owner for a join code.';
    return null;
  }

  list(viewer: string): Promise<{ mine: WorldSummary[]; friends: WorldSummary[]; public: WorldSummary[] }> {
    return this.core.list(viewer);
  }

  details(id: string, viewer: string): Promise<WorldDetails | null> {
    return this.core.details(id, viewer);
  }

  // ------------------------------------------------------------------ management

  async create(owner: AccountInfo, o: NewWorldInput & { seed?: unknown; difficulty?: unknown; godHearts?: unknown }): Promise<WorldDetails> {
    const entry = await this.core.newEntry(owner, o, GAME_MODES);
    const mode = entry.mode as GameMode;
    const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty) ? (o.difficulty as Difficulty) : 'normal';
    const seed = typeof o.seed === 'string' && o.seed.trim() ? o.seed.trim().slice(0, 64) : randomBytes(6).toString('hex');
    const storage = new FileStorage(this.dir(entry.id), this.deps.log);
    const server = await GameServer.open(storage, { id: entry.id, name: entry.name, seed, mode, difficulty, godHearts: normalizeGodHearts(o.godHearts ?? 10), pvp: entry.pvp, cheats: entry.cheats, owner: owner.uuid, visibility: entry.visibility }, {});
    this.applyEntry(server.level, entry);
    await storage.writeLevel(server.level);
    await storage.close();
    await this.core.insert(entry);
    this.deps.log(`[hub] ${owner.name} created world "${entry.name}" (${entry.id})`);
    return (await this.details(entry.id, owner.uuid))!;
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
    if (typeof e.cheats === 'boolean') l.cheats = e.cheats;
    if (typeof e.announceAdmin === 'boolean') l.announceAdmin = e.announceAdmin;
  }

  /** A registry change reaches the running world and its players. */
  private applyLive(e: WorldEntry): void {
    const r = this.running.get(e.id);
    if (!r) return;
    this.applyEntry(r.server.level, e);
    for (const p of r.server.players.values()) p.send({ t: 'world_info', world: r.server.worldInfo(p) });
  }

  /** Copies a running world's settings into the registry. */
  private syncFromLevel(id: string): void {
    const r = this.running.get(id);
    const e = this.deps.store.worlds[id];
    if (!r || !e) return;
    Object.assign(e, liveOf(r.server.level));
    this.deps.store.worldsFile.changed();
  }

  update(id: string, viewer: string, patch: Record<string, unknown>): Promise<WorldDetails> {
    return this.core.update(id, viewer, patch);
  }

  regenerateCode(id: string, viewer: string, enabled = true): Promise<WorldDetails> {
    return this.core.regenerateCode(id, viewer, enabled);
  }

  setRole(id: string, viewer: string, target: string, role: unknown): Promise<WorldDetails> {
    return this.core.setRole(id, viewer, target, role);
  }

  async ban(id: string, viewer: string, target: string, banned: boolean): Promise<WorldDetails> {
    const d = await this.core.ban(id, viewer, target, banned);
    if (banned) {
      const r = this.running.get(id);
      for (const p of r ? [...r.server.players.values()] : []) if (p.uuid === target) r!.server.kick(p, 'You have been banned from this world');
    }
    return d;
  }

  async remove(id: string, viewer: string): Promise<void> {
    await this.core.requireManager(id, viewer, true);
    const r = this.running.get(id);
    if (r) {
      for (const p of [...r.server.players.values()]) r.server.kick(p, 'This world was deleted');
      await r.server.stop();
      this.running.delete(id);
    }
    await this.deps.store.deleteWorld(id);
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }

  /** Redeems a join code: the player is invited to the world. */
  async redeem(code: unknown, viewer: string): Promise<WorldSummary> {
    return (await this.core.redeem(code, viewer)).summary;
  }

  // ------------------------------------------------------------------ hosting

  private async ensureRunning(id: string): Promise<Running> {
    const r = this.running.get(id);
    if (r) return r;
    let p = this.starting.get(id);
    if (!p) {
      p = (async () => {
        const e = this.deps.store.worlds[id]!;
        const storage = new FileStorage(this.dir(id), this.deps.log);
        const server = await GameServer.open(storage, null, {
          log: (m) => this.deps.log(`[${e.name}] ${m}`),
          maxPlayers: e.maxPlayers,
          canJoin: (identity, level) => {
            const cur = this.deps.store.worlds[id] ?? e;
            return this.joinDeniedSync({ ...cur, visibility: level.visibility, allowlist: level.allowlist, banned: level.banned, operators: level.operators, roles: level.roles, defaultRole: level.defaultRole }, identity.uuid);
          },
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
    const e = await this.core.access(id);
    const deny = e ? await this.core.denied(e, account.uuid) : 'World not found';
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
    await this.deps.store.worldsFile.flush();
  }
}
