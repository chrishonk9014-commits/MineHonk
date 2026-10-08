/**
 * Browser hosting, the worker side: other players join the integrated server
 * through the host's page (WebRTC data channels or the hub relay, see
 * src/client/net/HostSession.ts). Their bytes arrive here as pieces; the
 * first message must be a join ticket signed by the hub, which says who they
 * are and why they may join. After that they are ordinary connections to the
 * same GameServer, with the same protocol as everywhere else.
 */
import { encode, decode } from '@msgpack/msgpack';
import type { GameServer } from '../server/GameServer';
import type { Connection } from '../server/net/Connection';
import type { C2S, S2C } from '../common/net/protocol';
import { PROTOCOL_VERSION } from '../common/net/protocol';
import { registryHash } from '../common/registry/hash';
import { PieceJoiner, toPieces, type HostSettingsPush } from '../common/net/hubProtocol';
import { importVerifyKey, verifyTicket, type TicketClaims } from '../hub/tickets';
import { roleIn } from '../hub/worlds';
import type { WorldEntry } from '../hub/store';
import type { LevelData } from '../server/world/LevelData';

export interface HostConfig {
  hubWorldId: string;
  /** The hub's public key for join tickets. */
  hubKey: JsonWebKey;
  maxPlayers: number;
  /** The host's own (local) player uuid. */
  hostUuid: string;
}

export type HostOut =
  | { type: 'remote_send'; cid: number; pieces: Uint8Array[] }
  | { type: 'remote_kick'; cid: number; reason: string }
  | { type: 'players'; count: number }
  | { type: 'level_settings'; settings: LevelSettings };

/** What the hosting panel changes (only these fields). */
export interface HostOptionsPatch {
  name: string;
  visibility: LevelData['visibility'];
  cheats: boolean;
  pvp: boolean;
  defaultRole: 'builder' | 'visitor';
  maxPlayers: number;
  joinCode: string | null;
}

/** The access settings the host keeps the hub's registry in step with. */
export interface LevelSettings {
  name: string;
  visibility: LevelData['visibility'];
  mode: string;
  cheats: boolean;
  pvp: boolean;
  defaultRole: 'builder' | 'visitor';
  announceAdmin: boolean;
  allowlist: string[];
  banned: string[];
  operators: string[];
  roles: Record<string, 'builder' | 'visitor'>;
}

/** The registry-shaped view of a level's access settings. */
export function levelEntry(l: LevelData, hubId: string, maxPlayers: number): WorldEntry {
  return { id: hubId, name: l.name, owner: l.owner ?? '', visibility: l.visibility, joinCode: l.joinCode, allowlist: l.allowlist, banned: l.banned, operators: l.operators, roles: l.roles, defaultRole: l.defaultRole, pvp: l.pvp, mode: l.mode, maxPlayers, createdAt: l.createdAt, cheats: l.cheats, announceAdmin: l.announceAdmin !== false };
}

class RemoteConn implements Connection {
  readonly id: string;
  readonly remote: string;
  private queue: S2C[] = [];
  private flushing = false;
  bufferedBytes = 0;
  closed = false;

  constructor(
    readonly cid: number,
    remote: string,
    private readonly post: (m: HostOut, transfer?: Transferable[]) => void,
  ) {
    this.id = `r${cid}`;
    this.remote = remote;
  }

  send(msg: S2C): void {
    if (this.closed) return;
    this.queue.push(msg);
    if (!this.flushing) {
      this.flushing = true;
      // Everything one tick sends goes out together (fewer packets, fewer relay messages)
      queueMicrotask(() => this.flush());
    }
  }

  flush(): void {
    this.flushing = false;
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    const pieces = toPieces(encode(batch));
    let n = 0;
    for (const p of pieces) n += p.length;
    this.bufferedBytes += n;
    this.post({ type: 'remote_send', cid: this.cid, pieces }, pieces.map((p) => p.buffer as ArrayBuffer));
  }

  get buffered(): number {
    return this.bufferedBytes;
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.post({ type: 'remote_kick', cid: this.cid, reason: reason ?? 'Disconnected' });
  }
}

interface Remote {
  conn: RemoteConn;
  joiner: PieceJoiner;
  joined: boolean;
  pending: boolean;
}

export class BrowserHost {
  private config: HostConfig | null = null;
  private key: CryptoKey | null = null;
  private readonly remotes = new Map<number, Remote>();
  /** Why each joiner may join (from their ticket), by account. */
  private readonly via = new Map<string, TicketClaims['via']>();
  private lastSettings = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly server: () => GameServer | null,
    private readonly post: (m: HostOut, transfer?: Transferable[]) => void,
  ) {}

  get hosting(): boolean {
    return !!this.config;
  }

  async start(config: HostConfig): Promise<void> {
    const s = this.server();
    if (!s) throw new Error('No world is running');
    this.config = config;
    this.key = await importVerifyKey(config.hubKey);
    const l = s.level;
    // A world going online needs an owner (single player worlds may have none: everyone owned them)
    if (!l.owner) l.owner = config.hostUuid;
    if (!l.operators.includes(l.owner)) l.operators.push(l.owner);
    l.hosting = { hubId: config.hubWorldId, maxPlayers: config.maxPlayers };
    (s.opts as { maxPlayers: number }).maxPlayers = config.maxPlayers;
    s.opts.canJoin = (identity, level) => this.canJoin(identity.uuid, level);
    s.paused = false;
    s.onPlayerJoined = () => this.post({ type: 'players', count: s.players.size });
    s.onPlayerLeft = () => this.post({ type: 'players', count: s.players.size });
    this.timer = setInterval(() => this.syncSettings(), 3000);
    this.syncSettings(true);
  }

  stop(reason = 'The host stopped hosting'): void {
    for (const r of [...this.remotes.values()]) this.kick(r, reason);
    this.remotes.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const s = this.server();
    if (s) {
      s.opts.canJoin = undefined;
      (s.opts as { maxPlayers: number }).maxPlayers = 1;
    }
    this.config = null;
  }

  /** The hub's say, the world's own rules: may this account join? */
  private canJoin(uuid: string, level: LevelData): string | null {
    const c = this.config;
    if (!c) return 'This world is not online.';
    if (uuid === c.hostUuid) return null;
    const via = this.via.get(uuid);
    if (!via) return 'Your join ticket expired. Try again.';
    const e = levelEntry(level, c.hubWorldId, c.maxPlayers);
    if (e.banned.includes(uuid)) return 'You are banned from this world.';
    // The hub vouched for code joins and invitations: they are on the list from now on
    if ((via === 'code' || via === 'member') && !e.allowlist.includes(uuid) && !e.operators.includes(uuid) && e.roles[uuid] === undefined) level.allowlist.push(uuid);
    if (!roleIn(levelEntry(level, c.hubWorldId, c.maxPlayers), uuid, via === 'friend')) return 'This world is private. Ask the owner for a join code.';
    return null;
  }

  // ------------------------------------------------------------------ transports

  open(cid: number, remote: string): void {
    if (!this.config) return;
    const conn = new RemoteConn(cid, remote, this.post);
    this.remotes.set(cid, { conn, joiner: new PieceJoiner(), joined: false, pending: false });
  }

  buffered(cid: number, bytes: number): void {
    const r = this.remotes.get(cid);
    if (r) r.conn.bufferedBytes = bytes;
  }

  data(cid: number, piece: Uint8Array): void {
    const r = this.remotes.get(cid);
    if (!r) return;
    let payload: Uint8Array | null;
    try {
      payload = r.joiner.push(piece);
    } catch {
      return this.kick(r, 'Message too large');
    }
    if (!payload) return;
    let msg: unknown;
    try {
      msg = decode(payload);
    } catch {
      return this.kick(r, 'Bad packet');
    }
    const s = this.server();
    if (!s) return;
    if (r.joined) {
      if (Array.isArray(msg)) for (const m of msg.slice(0, 600)) s.handle(r.conn, m);
      return;
    }
    if (r.pending) return;
    r.pending = true;
    void this.join(r, msg).finally(() => (r.pending = false));
  }

  private async join(r: Remote, msg: unknown): Promise<void> {
    const s = this.server();
    const c = this.config;
    const j = msg as { t?: string; ticket?: unknown; hello?: C2S & { t: 'hello' } };
    if (!s || !c || !this.key || j?.t !== 'join' || !j.hello || j.hello.t !== 'hello') return this.kick(r, 'Expected a join ticket');
    // Different game versions cannot play together
    if (j.hello.version !== PROTOCOL_VERSION || j.hello.registryHash !== registryHash()) return this.kick(r, 'Version mismatch — refresh the page');
    const claims = await verifyTicket(j.ticket, this.key);
    if (!claims || claims.world !== c.hubWorldId) return this.kick(r, 'Your join ticket expired. Try again.');
    this.via.set(claims.uuid, claims.via);
    const p = await s.connect(r.conn, { uuid: claims.uuid, name: claims.name }, j.hello);
    if (!p) {
      r.conn.closed = true;
      this.remotes.delete(r.conn.cid);
      return;
    }
    r.joined = true;
  }

  close(cid: number): void {
    const r = this.remotes.get(cid);
    if (!r) return;
    this.remotes.delete(cid);
    r.conn.closed = true;
    void this.server()?.disconnect(r.conn);
  }

  private kick(r: Remote, reason: string): void {
    if (!r.conn.closed) {
      r.conn.send({ t: 'kick', reason });
      r.conn.close(reason);
    }
    this.remotes.delete(r.conn.cid);
    if (r.joined) void this.server()?.disconnect(r.conn);
  }

  // ------------------------------------------------------------------ settings

  /** Sends the level's access settings to the page (and on to the hub) when they change. */
  syncSettings(force = false): void {
    const s = this.server();
    const c = this.config;
    if (!s || !c) return;
    const l = s.level;
    const settings: LevelSettings = {
      name: l.name,
      visibility: l.visibility,
      mode: l.mode,
      cheats: l.cheats,
      pvp: l.pvp,
      defaultRole: l.defaultRole,
      announceAdmin: l.announceAdmin !== false,
      allowlist: [...l.allowlist],
      banned: [...l.banned],
      // The host's own local id is no hub account
      operators: l.operators.filter((u) => u !== c.hostUuid),
      roles: { ...l.roles },
    };
    const key = JSON.stringify(settings);
    if (!force && key === this.lastSettings) return;
    this.lastSettings = key;
    this.post({ type: 'level_settings', settings });
  }

  /** The owner changed the hosting settings in the panel. */
  applyOptions(o: HostOptionsPatch): void {
    const s = this.server();
    const c = this.config;
    if (!s || !c) return;
    const l = s.level;
    l.name = o.name;
    l.visibility = o.visibility;
    l.cheats = o.cheats;
    l.pvp = o.pvp;
    l.defaultRole = o.defaultRole;
    l.joinCode = o.joinCode;
    c.maxPlayers = o.maxPlayers;
    (s.opts as { maxPlayers: number }).maxPlayers = o.maxPlayers;
    if (l.hosting) l.hosting.maxPlayers = o.maxPlayers;
    for (const pl of s.players.values()) pl.send({ t: 'world_info', world: s.worldInfo(pl) });
    this.syncSettings();
  }

  /** Settings changed through the hub (by the owner elsewhere, an operator, an invitation). */
  applySettings(p: HostSettingsPush): void {
    const s = this.server();
    const c = this.config;
    if (!s || !c) return;
    const l = s.level;
    l.name = p.name;
    l.visibility = p.visibility;
    l.allowlist = [...new Set([...l.allowlist, ...p.allowlist])];
    l.banned = [...p.banned];
    l.operators = [...new Set([...(l.owner ? [l.owner] : []), ...p.operators])].filter((u) => !l.banned.includes(u));
    l.roles = { ...p.roles };
    l.defaultRole = p.defaultRole;
    l.pvp = p.pvp;
    l.cheats = p.cheats;
    l.announceAdmin = p.announceAdmin;
    l.joinCode = p.joinCode;
    c.maxPlayers = p.maxPlayers;
    (s.opts as { maxPlayers: number }).maxPlayers = p.maxPlayers;
    if (l.hosting) l.hosting.maxPlayers = p.maxPlayers;
    for (const pl of [...s.players.values()]) {
      if (l.banned.includes(pl.uuid)) s.kick(pl, 'You have been banned from this world');
      else pl.send({ t: 'world_info', world: s.worldInfo(pl) });
    }
    this.lastSettings = '';
    this.syncSettings();
  }
}
