/**
 * The authoritative game server for one world. Runs the fixed-rate tick loop,
 * owns all dimensions and players, validates every client action and
 * replicates state to clients.
 *
 * It is platform agnostic: the same class runs inside a Web Worker for
 * single player (integrated server) and inside Node for hosted worlds.
 */
import { Dimension } from './world/Dimension';
import type { WorldStorage } from './storage/Storage';
import { type LevelData, createLevelData, sanitizeLevelData, type NewWorldOptions } from './world/LevelData';
import type { Connection, Identity } from './net/Connection';
import { ServerPlayer, PLAYER_EYE } from './player/ServerPlayer';
import { validateC2S } from '../common/net/validate';
import { PROTOCOL_VERSION, type C2S, type S2C, type WorldInfo, LIMITS, type ChatKind } from '../common/net/protocol';
import { chunkIndex, chunkIndexX, chunkIndexZ, TICK_MS, WORLD_HEIGHT, DAY_LENGTH } from '../common/world/constants';
import { encodeChunk, type Chunk } from '../common/world/chunk';
import type { WorldRole } from '../common/net/multiplayer';
import type { DimensionId } from '../common/data/biomes';
import type { Entity } from './entity/Entity';
import { BlockUpdates } from './systems/BlockUpdates';
import { registryHash } from '../common/registry/hash';
import { maxHealthFor } from '../common/game/gamemode';
import { STATE_SOLID, STATE_FLUID } from '../common/registry/blocks';
import { bodyObstructed } from '../common/physics/movement';
import { Mining } from './systems/Mining';
import { Interaction } from './systems/Interaction';
import { Commands } from './commands/Commands';
import { PlayerData } from './player/PlayerData';
import { AdminService } from './admin/AdminService';
import { RegistryHistory } from './world/RegistryHistory';

export interface ServerOptions {
  /** Max chunks sent per player per tick. */
  chunksPerTick?: number;
  /** Chunk generation time budget per tick (ms). */
  genBudgetMs?: number;
  maxViewDistance?: number;
  /** Autosave interval (ticks). */
  autosaveTicks?: number;
  log?: (msg: string) => void;
  /** Called for chat moderation; return null to block the message. */
  filterChat?: (text: string, player: ServerPlayer) => string | null;
  /** Whether a given identity may join (multiplayer permission hook). */
  canJoin?: (id: Identity, level: LevelData) => string | null;
  maxPlayers?: number;
}

export class GameServer {
  readonly dims = new Map<DimensionId, Dimension>();
  readonly players = new Map<string, ServerPlayer>();
  readonly blockUpdates: BlockUpdates;
  readonly mining: Mining;
  /** Mob, combat and explosion system (installed by gameplay). */
  mobs: import('./systems/Mobs').MobSystem | null = null;
  /** Enchanting, anvils, brewing and potions (installed by gameplay). */
  workstations: import('./systems/Workstations').Workstations | null = null;
  portals: import('./systems/Portals').Portals | null = null;
  theEnd: import('./systems/TheEnd').EndSystem | null = null;
  farlands: import('./systems/Farlands').FarlandsSystem | null = null;
  /** Fireworks, fishing, compasses, jukeboxes, beacons (installed by gameplay). */
  gadgets: import('./systems/Gadgets').Gadgets | null = null;
  /** Riding and leads (installed by gameplay). */
  mounts: import('./systems/Mounts').Mounts | null = null;
  /** Redstone power (installed by gameplay). */
  power: import('./systems/Power').Power | null = null;
  sculk: import('./systems/Sculk').Sculk | null = null;
  warden: import('./systems/Warden').WardenSystem | null = null;
  /** Hook for the hosting layer to forward player reports (e.g. to platform moderation). */
  onReport?: (from: ServerPlayer, target: ServerPlayer, reason: string) => void;
  readonly interaction: Interaction;
  readonly commands: Commands;
  readonly playerData: PlayerData;
  readonly admin: AdminService;
  /** Block registries the world's saved chunks were written with. */
  readonly registries: RegistryHistory;
  tickNo = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;
  running = false;
  private saving: Promise<void> | null = null;
  readonly opts: Required<Omit<ServerOptions, 'filterChat' | 'canJoin'>> & Pick<ServerOptions, 'filterChat' | 'canJoin'>;
  lastTickMs = 0;
  avgTickMs = 0;
  readonly regHash = registryHash();
  /** Listeners for hub integration. */
  onPlayerJoined?: (p: ServerPlayer) => void;
  onPlayerLeft?: (p: ServerPlayer) => void;
  onEmpty?: () => void;

  private constructor(
    readonly storage: WorldStorage,
    public level: LevelData,
    opts: ServerOptions,
  ) {
    this.opts = {
      chunksPerTick: opts.chunksPerTick ?? 10,
      genBudgetMs: opts.genBudgetMs ?? 25,
      maxViewDistance: opts.maxViewDistance ?? 16,
      autosaveTicks: opts.autosaveTicks ?? 20 * 60 * 2,
      log: opts.log ?? ((m) => console.log(m)),
      maxPlayers: opts.maxPlayers ?? 16,
      filterChat: opts.filterChat,
      canJoin: opts.canJoin,
    };
    this.registries = new RegistryHistory(storage, (m) => this.log(m));
    this.blockUpdates = new BlockUpdates(this);
    this.mining = new Mining(this);
    this.interaction = new Interaction(this);
    this.commands = new Commands(this);
    this.playerData = new PlayerData(this);
    this.admin = new AdminService(this);
    for (const id of ['overworld', 'nether', 'end', 'farlands'] as DimensionId[]) {
      this.dims.set(id, new Dimension(this, id, level.seedNum));
    }
  }

  /** Opens an existing world or creates a new one. */
  static async open(storage: WorldStorage, create: NewWorldOptions | null, opts: ServerOptions = {}): Promise<GameServer> {
    const raw = await storage.readLevel().catch(() => null);
    let level = raw ? sanitizeLevelData(raw, create?.id ?? 'world') : null;
    if (!level && !create) {
      // The main copy is damaged: fall back to the backup written by the last good save
      const bak = await storage.readMeta('level_backup').catch(() => null);
      level = bak ? sanitizeLevelData(bak, 'world') : null;
      if (level) {
        opts.log?.('[server] level data was damaged; restored from the last backup');
        await storage.writeLevel(level);
      }
    }
    if (!level) {
      if (!create) throw new Error('World data missing or corrupted');
      level = createLevelData(create);
      await storage.writeLevel(level);
    }
    const server = new GameServer(storage, level, opts);
    await server.registries.load();
    return server;
  }

  log(msg: string): void {
    this.opts.log(msg);
  }

  get overworld(): Dimension {
    return this.dims.get('overworld')!;
  }

  dim(id: DimensionId): Dimension {
    return this.dims.get(id)!;
  }

  // ------------------------------------------------------------------ lifecycle

  /** Integrated single player servers pause while the game menu is open. */
  paused = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.level.spawn) {
      const s = this.overworld.generator.findSpawn();
      this.level.spawn = [s.x, s.y, s.z];
    }
    // Keep spawn area loaded & generate it early
    this.nextTickAt = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      const now = performance.now();
      let ticksRun = 0;
      if (this.paused) this.nextTickAt = now + TICK_MS;
      while (now >= this.nextTickAt && ticksRun < 5) {
        const t0 = performance.now();
        try {
          this.tick();
        } catch (e) {
          this.log(`[server] tick error: ${(e as Error).stack ?? e}`);
        }
        this.lastTickMs = performance.now() - t0;
        this.avgTickMs = this.avgTickMs * 0.95 + this.lastTickMs * 0.05;
        this.nextTickAt += TICK_MS;
        ticksRun++;
      }
      // If we fell far behind, skip ahead instead of spiralling.
      if (performance.now() - this.nextTickAt > 1000) this.nextTickAt = performance.now();
      this.timer = setTimeout(loop, Math.max(1, this.nextTickAt - performance.now()));
    };
    loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    for (const p of [...this.players.values()]) {
      p.send({ t: 'kick', reason: 'Server closed' });
      await this.removePlayer(p, false);
    }
    await this.saveAll();
    await this.storage.flush();
  }

  async saveAll(): Promise<void> {
    if (this.saving) await this.saving;
    this.saving = (async () => {
      this.level.lastPlayed = Date.now();
      for (const p of this.players.values()) await this.playerData.save(p);
      for (const d of this.dims.values()) await d.saveAll();
      this.admin.persist();
      await this.storage.writeLevel(this.level);
      await this.storage.writeMeta('level_backup', this.level);
      await this.storage.flush();
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  // ------------------------------------------------------------------ connections

  async connect(conn: Connection, identity: Identity, hello: C2S & { t: 'hello' }): Promise<ServerPlayer | null> {
    if (hello.version !== PROTOCOL_VERSION) {
      conn.send({ t: 'kick', reason: `Incompatible version (server ${PROTOCOL_VERSION}, client ${hello.version})` });
      conn.close();
      return null;
    }
    if (hello.registryHash !== this.regHash) {
      conn.send({ t: 'kick', reason: 'Game content mismatch – please update your game.' });
      conn.close();
      return null;
    }
    if (this.level.banned.includes(identity.uuid)) {
      conn.send({ t: 'kick', reason: 'You are banned from this world.' });
      conn.close();
      return null;
    }
    const deny = this.opts.canJoin?.(identity, this.level);
    if (deny) {
      conn.send({ t: 'kick', reason: deny });
      conn.close();
      return null;
    }
    if (this.players.size >= this.opts.maxPlayers) {
      conn.send({ t: 'kick', reason: 'World is full.' });
      conn.close();
      return null;
    }
    // Only one session per account: drop the older one.
    for (const other of this.players.values()) {
      if (other.uuid === identity.uuid) {
        other.send({ t: 'kick', reason: 'Logged in from another location.' });
        await this.removePlayer(other, true);
      }
    }
    const p = new ServerPlayer(conn, identity);
    p.viewDistance = Math.max(LIMITS.minViewDistance, Math.min(this.opts.maxViewDistance, hello.viewDistance));
    p.setGamemode(this.level.mode);
    p.maxHealth = maxHealthFor(this.level.mode, this.level.godHearts);
    p.health = Number.isFinite(p.maxHealth) ? p.maxHealth : 20;
    const loaded = await this.playerData.load(p);
    if (!this.running) return null;
    const dim = this.dims.get(loaded.dim) ?? this.overworld;
    if (!loaded.found) {
      const s = this.level.spawn ?? [0, 80, 0];
      p.setPos(s[0] + 0.5, s[1], s[2] + 0.5);
      (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
      this.playerData.giveStarterItems(p);
    }
    p.lastValidX = p.x;
    p.lastValidY = p.y;
    p.lastValidZ = p.z;
    p.spawnProtection = 60;
    this.players.set(conn.id, p);
    dim.addEntity(p);
    p.send({
      t: 'welcome',
      entityId: p.id,
      name: p.name,
      uuid: p.uuid,
      dimension: dim.id,
      gamemode: p.gamemode,
      world: this.worldInfo(p),
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      time: this.level.time,
      dayTime: this.level.dayTime,
      abilities: p.abilitiesMsg(),
      spawn: this.level.spawn ?? [0, 64, 0],
    });
    this.sendTime(p);
    p.send({ t: 'death_pos', pos: p.lastDeath });
    this.interaction.syncInventory(p);
    p.statsDirty = true;
    this.broadcastChat(`${p.name} joined the world`, 'join');
    this.sendPlayerList();
    this.log(`[server] ${p.name} (${p.uuid.slice(0, 8)}) joined from ${conn.remote}`);
    this.onPlayerJoined?.(p);
    return p;
  }

  worldInfo(p: ServerPlayer): WorldInfo {
    return {
      name: this.level.name,
      seed: this.level.seed,
      mode: this.level.mode,
      difficulty: this.level.difficulty,
      pvp: this.level.pvp,
      godHearts: this.level.godHearts,
      hardcore: this.level.hardcore,
      cheats: this.level.cheats,
      joinCode: this.isOperator(p) ? (this.level.joinCode ?? undefined) : undefined,
      isOwner: this.level.owner === null || this.level.owner === p.uuid,
      isHost: this.isOperator(p),
      admin: this.level.cheats && this.isOperator(p),
      role: this.roleOf(p),
    };
  }

  isOperator(p: ServerPlayer): boolean {
    return this.level.owner === null || this.level.owner === p.uuid || this.level.operators.includes(p.uuid);
  }

  /** The player's role in this world (single player hosts own their world). */
  roleOf(p: { uuid: string }): WorldRole {
    const l = this.level;
    if (l.owner === null || l.owner === p.uuid) return 'owner';
    if (l.operators.includes(p.uuid)) return 'operator';
    return l.roles[p.uuid] ?? l.defaultRole;
  }

  isMuted(p: ServerPlayer): boolean {
    const until = this.level.muted[p.uuid];
    if (until === undefined) return false;
    if (until <= Date.now()) {
      delete this.level.muted[p.uuid];
      return false;
    }
    return true;
  }

  /** Called by the transport when a message arrives. */
  handle(conn: Connection, raw: unknown): void {
    const p = this.players.get(conn.id);
    if (!p) return;
    // Basic flood protection: 300 messages per second budget.
    p.msgBudget++;
    if (p.msgBudget > 600) {
      this.kick(p, 'Too many packets');
      return;
    }
    const msg = validateC2S(raw);
    if (!msg) {
      this.log(`[server] invalid packet from ${p.name}: ${JSON.stringify(raw).slice(0, 120)}`);
      return;
    }
    try {
      this.dispatch(p, msg);
    } catch (e) {
      this.log(`[server] error handling ${msg.t} from ${p.name}: ${(e as Error).stack ?? e}`);
    }
  }

  private dispatch(p: ServerPlayer, m: C2S): void {
    if (p.dead && m.t !== 'respawn' && m.t !== 'chat' && m.t !== 'ping' && m.t !== 'settings') return;
    switch (m.t) {
      case 'move':
        this.handleMove(p, m);
        break;
      case 'dig':
        this.mining.handleDig(p, m);
        break;
      case 'use_on':
        this.interaction.handleUseOn(p, m);
        break;
      case 'use':
        this.interaction.handleUse(p, m);
        break;
      case 'hotbar':
        p.selectedSlot = m.slot;
        p.metaDirty = true;
        p.dig = null;
        break;
      case 'click':
        this.interaction.handleClick(p, m);
        break;
      case 'close_window':
        this.interaction.closeWindow(p, m.window);
        break;
      case 'creative_set':
        this.interaction.handleCreativeSet(p, m.slot, m.item);
        break;
      case 'creative_pick':
        this.interaction.handleCreativePick(p, m.item);
        break;
      case 'chat':
        this.handleChat(p, m.text);
        break;
      case 'attack':
        this.interaction.handleAttack(p, m.id);
        break;
      case 'interact':
        this.interaction.handleInteractEntity(p, m.id, m.hand);
        break;
      case 'respawn':
        this.interaction.respawn(p);
        break;
      case 'drop':
        this.interaction.dropHeld(p, m.all);
        break;
      case 'swap_hands':
        this.interaction.swapHands(p);
        break;
      case 'settings':
        p.viewDistance = Math.max(LIMITS.minViewDistance, Math.min(this.opts.maxViewDistance, m.viewDistance));
        p.chunkX = NaN;
        break;
      case 'swing':
        if (this.tickNo - p.lastSwingTick >= 2) {
          p.lastSwingTick = this.tickNo;
          this.broadcastNear(p.dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'swing' }, p);
        }
        break;
      case 'set_flying':
        if (p.abilities.mayFly) p.abilities.flying = m.flying;
        else if (m.flying) p.send({ t: 'abilities', abilities: p.abilitiesMsg() });
        break;
      case 'sign_text':
        this.interaction.handleSignText(p, m);
        break;
      case 'enchant':
      case 'rename':
      case 'trade':
        this.interaction.handleWindowAction(p, m);
        break;
      case 'wake':
        this.interaction.wake(p);
        break;
      case 'ping':
        p.send({ t: 'pong', time: m.time });
        break;
      case 'request_progress':
        p.send({ t: 'progress', achievements: [...p.achievements], stats: { ...p.statistics } });
        break;
      case 'admin':
        this.admin.handle(p, m.req, m.action);
        break;
      case 'vehicle_move':
        this.mounts?.vehicleMove(p, m.x, m.y, m.z, m.yaw);
        break;
      case 'dismount':
        this.mounts?.dismount(p);
        break;
      case 'hello':
        break;
    }
  }

  async disconnect(conn: Connection): Promise<void> {
    const p = this.players.get(conn.id);
    if (!p) return;
    await this.removePlayer(p, true);
  }

  kick(p: ServerPlayer, reason: string): void {
    p.send({ t: 'kick', reason });
    p.conn.close(reason);
    void this.removePlayer(p, true);
  }

  private async removePlayer(p: ServerPlayer, announce: boolean): Promise<void> {
    if (!this.players.has(p.conn.id)) return;
    this.players.delete(p.conn.id);
    this.mounts?.dismount(p, true);
    this.interaction.closeWindow(p, p.windowId, true);
    p.dim.removeEntity(p);
    if (announce) {
      this.broadcastChat(`${p.name} left the world`, 'leave');
      this.sendPlayerList();
    }
    this.log(`[server] ${p.name} left`);
    this.onPlayerLeft?.(p);
    try {
      await this.playerData.save(p);
    } catch (e) {
      this.log(`[server] failed to save ${p.name}: ${(e as Error).message}`);
    }
    if (this.players.size === 0) this.onEmpty?.();
  }

  // ------------------------------------------------------------------ movement

  private handleMove(p: ServerPlayer, m: C2S & { t: 'move' }): void {
    if (p.awaitingTeleport) {
      // Ignore stale moves until the client acknowledges the teleport.
      if (m.seq < p.teleportSeq) return;
      p.awaitingTeleport = false;
    }
    p.movesThisTick++;
    if (p.movesThisTick > 8) return;
    p.yaw = m.yaw;
    p.pitch = m.pitch;
    p.headYaw = m.yaw;
    // Riders sit on their mount: only the look direction comes from the client
    if (p.vehicle) return;
    if (p.sneaking !== m.sneak) {
      p.sneaking = m.sneak;
      p.metaDirty = true;
    }
    p.sprinting = m.sprint;
    if (m.flying && !p.abilities.mayFly) {
      p.send({ t: 'abilities', abilities: p.abilitiesMsg() });
    } else p.abilities.flying = m.flying && p.abilities.mayFly;

    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const dz = m.z - p.z;
    const distSq = dx * dx + dz * dz;
    // Elytra gliding needs a working Elytra and open air
    const glide = !!m.glide && !m.onGround && !p.abilities.flying && this.interaction.canGlide(p);
    if (glide !== p.gliding) {
      p.gliding = glide;
      p.metaDirty = true;
      if (!glide) p.glideSpeed = 0;
    }
    // Movement budget: generous limits (client runs the same physics).
    const maxH = p.abilities.flying ? (p.gamemode === 'spectator' ? 4 : 2.2) : p.gliding ? (this.tickNo < p.boostUntil ? 3.4 : 2.6) : p.body.inWater ? 1.0 : 1.3;
    const effSpeed = p.effects.get('speed');
    const limit = maxH * (1 + (effSpeed ? (effSpeed.amp + 1) * 0.3 : 0)) + (p.body.vy < -1 ? 0.5 : 0);
    const maxV = 5;
    if (distSq > limit * limit * 4 || Math.abs(dy) > maxV) {
      p.speedViolations++;
      this.log(`[anticheat] ${p.name} moved too fast (${Math.sqrt(distSq).toFixed(2)}, dy ${dy.toFixed(2)})`);
      this.teleport(p, p.lastValidX, p.lastValidY, p.lastValidZ);
      return;
    }
    // Chunks must be loaded where the player goes.
    if (!p.dim.isLoaded(m.x, m.z)) {
      this.teleport(p, p.x, p.y, p.z);
      return;
    }
    const ox = p.x;
    const oy = p.y;
    const oz = p.z;
    p.setPos(m.x, m.y, m.z);
    if (!p.abilities.noClip && bodyObstructed(p.dim, p.body, 0.05) && !bodyObstructed(p.dim, { ...p.body, x: ox, y: oy, z: oz }, 0.05)) {
      // Moving into a solid block (noclip attempt or desync).
      p.setPos(ox, oy, oz);
      this.teleport(p, ox, oy, oz);
      return;
    }
    if (p.gliding) this.glideImpact(p, dx, dz);
    // Ground truth for fall damage: check below the feet server-side.
    const groundBelow = this.hasGroundBelow(p);
    const claimedGround = m.onGround && groundBelow;
    const wasOnGround = p.body.onGround;
    const fell = p.body.fallDistance;
    this.interaction.survival.onMove(p, oy, claimedGround);
    this.sculk?.onPlayerMove(p, dx, dz, wasOnGround, claimedGround, fell);
    p.body.onGround = claimedGround;
    p.lastValidX = m.x;
    p.lastValidY = m.y;
    p.lastValidZ = m.z;
    p.dim.updateBucket(p);
    if (p.dig && p.distanceSq(p.dig.x + 0.5, p.dig.y + 0.5, p.dig.z + 0.5) > 64) p.dig = null;
  }

  /** Flying into a wall at speed hurts (like the ground does). */
  private glideImpact(p: ServerPlayer, dx: number, dz: number): void {
    const h = Math.hypot(dx, dz);
    const lost = p.glideSpeed - h;
    if (lost > 0.3 && p.glideSpeed > 0) {
      const probe = { ...p.body, x: p.x + p.glideDirX * 0.4, z: p.z + p.glideDirZ * 0.4 };
      if (bodyObstructed(p.dim, probe, 0.05)) {
        const dmg = lost * 10 - 3;
        if (dmg > 0) this.interaction.survival.damage(p, dmg, { source: 'fly_into_wall' });
      }
    }
    p.glideSpeed = h;
    if (h > 0.01) {
      p.glideDirX = dx / h;
      p.glideDirZ = dz / h;
    }
  }

  private hasGroundBelow(p: ServerPlayer): boolean {
    const b = p.body;
    const hw = b.width / 2 + 0.05;
    const y = Math.floor(b.y - 0.05);
    for (const [ox, oz] of [
      [-hw, -hw],
      [hw, -hw],
      [-hw, hw],
      [hw, hw],
      [0, 0],
    ] as const) {
      const s = p.dim.getState(Math.floor(b.x + ox), y, Math.floor(b.z + oz));
      if (STATE_SOLID[s] || STATE_FLUID[s]) return true;
      // fences etc. extend above their cell
      const s2 = p.dim.getState(Math.floor(b.x + ox), y - 1, Math.floor(b.z + oz));
      if (STATE_SOLID[s2] && (b.y - 0.05) % 1 < 0.55) return true;
    }
    return false;
  }

  teleport(p: ServerPlayer, x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    p.setPos(x, y, z);
    p.lastValidX = x;
    p.lastValidY = y;
    p.lastValidZ = z;
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
    if (yaw !== undefined) p.yaw = yaw;
    if (pitch !== undefined) p.pitch = pitch;
    p.teleportSeq = p.moveSeq + 1000000 + this.tickNo;
    p.awaitingTeleport = true;
    p.dim.updateBucket(p);
    p.send({ t: 'teleport', x, y, z, yaw, pitch, seq: p.teleportSeq });
  }

  /** Finds a safe standing y at column x,z (loaded chunk required). */
  findSafeY(dim: Dimension, x: number, z: number, fromY = WORLD_HEIGHT - 2): number | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    // Below the bedrock roof in dimensions with a ceiling
    if (dim.rules.hasCeiling) fromY = Math.min(fromY, 120);
    for (let y = Math.min(fromY, WORLD_HEIGHT - 2); y > 0; y--) {
      const s = dim.getState(bx, y, bz);
      if ((STATE_SOLID[s] && !STATE_FLUID[s]) || (STATE_FLUID[s] === 1 && dim.id === 'overworld')) {
        const a1 = dim.getState(bx, y + 1, bz);
        const a2 = dim.getState(bx, y + 2, bz);
        if (!STATE_SOLID[a1] && !STATE_SOLID[a2] && STATE_FLUID[a1] !== 2) return y + 1;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ chat

  private handleChat(p: ServerPlayer, text: string): void {
    p.chatBudget += 20;
    if (p.chatBudget > 200) {
      p.send({ t: 'chat', text: 'You are sending messages too quickly.', kind: 'error' });
      return;
    }
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.chatLength);
    if (!clean) return;
    if (clean.startsWith('/')) {
      this.commands.run(p, clean.slice(1));
      return;
    }
    if (this.isMuted(p)) {
      p.send({ t: 'chat', text: 'You are muted in this world.', kind: 'error' });
      return;
    }
    const filtered = this.opts.filterChat ? this.opts.filterChat(clean, p) : clean;
    if (filtered === null) {
      p.send({ t: 'chat', text: 'Your message was blocked by the chat filter.', kind: 'error' });
      return;
    }
    this.log(`<${p.name}> ${filtered}`);
    for (const o of this.players.values()) o.send({ t: 'chat', text: filtered, kind: 'chat', from: p.name });
  }

  broadcastChat(text: string, kind: ChatKind = 'system'): void {
    for (const o of this.players.values()) o.send({ t: 'chat', text, kind });
  }

  sendPlayerList(): void {
    const list = [...this.players.values()].map((p) => ({ name: p.name, uuid: p.uuid, ping: p.ping, mode: p.gamemode }));
    for (const o of this.players.values()) o.send({ t: 'player_list', players: list });
  }

  // ------------------------------------------------------------------ replication helpers

  /** Sends to players that have the chunk containing (x,z) loaded on the client. */
  sendToWatchers(dim: Dimension, x: number, z: number, msg: S2C, except?: ServerPlayer): void {
    const k = chunkIndex(Math.floor(x) >> 4, Math.floor(z) >> 4);
    for (const p of this.players.values()) {
      if (p === except || p.dim !== dim) continue;
      if (p.sentChunks.has(k)) p.send(msg);
    }
  }

  broadcastNear(dim: Dimension, x: number, y: number, z: number, r: number, msg: S2C, except?: ServerPlayer): void {
    const r2 = r * r;
    for (const p of this.players.values()) {
      if (p === except || p.dim !== dim) continue;
      if (p.distanceSq(x, y, z) <= r2) p.send(msg);
    }
  }

  playSound(dim: Dimension, name: string, x: number, y: number, z: number, volume = 1, pitch = 1, except?: ServerPlayer): void {
    this.broadcastNear(dim, x, y, z, 16 * Math.max(1, volume), { t: 'sound', name, x, y, z, volume, pitch }, except);
  }

  particles(dim: Dimension, kind: string, x: number, y: number, z: number, count: number, spread = 0.5, data?: number): void {
    this.broadcastNear(dim, x, y, z, 48, { t: 'particles', kind, x, y, z, count, spread, data });
  }

  onBlockChanged(dim: Dimension, x: number, y: number, z: number, state: number): void {
    this.sendToWatchers(dim, x, z, { t: 'block', x, y, z, state });
  }

  onChunkGenerated(dim: Dimension, c: Chunk): void {
    this.blockUpdates.onChunkReady(dim, c);
    this.mobs?.onChunkGenerated(dim, c);
    this.sculk?.onChunk(dim, c);
  }

  onChunkLoaded(dim: Dimension, c: Chunk, _entities: Record<string, unknown>[]): void {
    this.blockUpdates.onChunkReady(dim, c);
    this.mobs?.onChunkLoaded(dim, c);
    this.workstations?.onChunk(dim, c);
    this.gadgets?.onChunk(dim, c);
    this.sculk?.onChunk(dim, c);
  }

  onChunkUnloaded(dim: Dimension, c: Chunk): void {
    this.mobs?.onChunkUnloaded(dim, c);
    this.sculk?.onChunkUnload(dim, c.cx, c.cz);
    const k = chunkIndex(c.cx, c.cz);
    // Entities in unloaded chunks are removed (persistent ones were saved with the chunk).
    const b = dim.buckets.get(k);
    if (b) for (const e of [...b]) if (e.type !== 'player') dim.removeEntity(e);
    for (const p of this.players.values()) {
      if (p.dim === dim && p.sentChunks.delete(k)) p.send({ t: 'unload_chunk', cx: c.cx, cz: c.cz });
    }
  }

  onEntityAdded(_dim: Dimension, _e: Entity): void {}

  onEntityRemoved(dim: Dimension, e: Entity): void {
    for (const p of this.players.values()) {
      if (p.tracked.delete(e.id)) p.send({ t: 'despawn', ids: [e.id] });
    }
    void dim;
  }

  isChunkForceLoaded(_dim: Dimension, _cx: number, _cz: number): boolean {
    return false;
  }

  sendTime(p?: ServerPlayer): void {
    const msg: S2C = {
      t: 'time',
      time: this.level.time,
      dayTime: this.level.dayTime,
      rain: this.level.raining ? 1 : 0,
      thunder: this.level.thundering ? 1 : 0,
      dayCycle: this.level.rules.doDaylightCycle,
    };
    if (p) p.send(msg);
    else for (const o of this.players.values()) o.send(msg);
  }

  // ------------------------------------------------------------------ tick

  private tick(): void {
    this.tickNo++;
    const level = this.level;
    level.time++;
    if (level.rules.doDaylightCycle) {
      // dayLengthMinutes scales the cycle (20 = default)
      const speed = 20 / Math.max(1, level.rules.dayLengthMinutes);
      this.dayAcc += speed;
      while (this.dayAcc >= 1) {
        this.dayAcc -= 1;
        level.dayTime = (level.dayTime + 1) % DAY_LENGTH;
      }
    }
    this.interaction.weather.tick();
    if (this.tickNo % 100 === 0) this.sendTime();

    for (const p of this.players.values()) {
      p.movesThisTick = 0;
      p.msgBudget = Math.max(0, p.msgBudget - 30);
      p.chatBudget = Math.max(0, p.chatBudget - 1);
      p.interactBudget = Math.max(0, p.interactBudget - 1);
      const cx = Math.floor(p.x) >> 4;
      const cz = Math.floor(p.z) >> 4;
      if (cx !== p.chunkX || cz !== p.chunkZ || this.tickNo % 20 === 0) {
        p.chunkX = cx;
        p.chunkZ = cz;
        p.dim.want(cx, cz, p.viewDistance + 1, this.tickNo);
      }
    }

    // Chunk generation budget shared across dimensions with players.
    const active = [...this.dims.values()].filter((d) => d.chunks.size > 0 || d.pendingGeneration > 0);
    const budget = this.opts.genBudgetMs / Math.max(1, active.length);
    for (const d of active) d.processGeneration(budget);

    for (const d of this.dims.values()) {
      if (d.chunks.size === 0) continue;
      this.blockUpdates.tick(d);
      d.tickEntities();
      d.tick();
    }
    this.mining.tick();
    this.interaction.tick();
    this.admin.tick();

    for (const p of this.players.values()) {
      this.handlePendingSpawn(p);
      this.sendChunks(p);
    }
    this.trackEntities();
    this.flushLight();

    if (this.tickNo % 200 === 0) {
      for (const d of this.dims.values()) void d.unloadUnused(this.tickNo, 200);
    }
    if (this.tickNo % this.opts.autosaveTicks === 0) void this.saveAll().catch((e) => this.saveFailed(e));
  }
  private dayAcc = 0;
  private lastSaveWarning = -Infinity;

  /** Tells players (at most every few minutes) that saving is failing, e.g. because storage is full. */
  saveFailed(e: unknown): void {
    const err = e as { name?: string; message?: string };
    this.log(`[server] save failed: ${err?.message ?? e}`);
    if (this.tickNo - this.lastSaveWarning < 20 * 60 * 5) return;
    this.lastSaveWarning = this.tickNo;
    const full = err?.name === 'QuotaExceededError' || /quota|space|ENOSPC/i.test(String(err?.message ?? ''));
    this.broadcastChat(full ? 'The world could not be saved: storage is full. Free some space or export the world.' : `The world could not be saved (${err?.message ?? 'unknown error'}). Progress since the last save may be lost.`, 'error');
  }

  private handlePendingSpawn(p: ServerPlayer): void {
    const ps = p as { needsSafeSpawn?: boolean };
    if (!ps.needsSafeSpawn) return;
    if (!p.dim.isLoaded(p.x, p.z)) return;
    const y = this.findSafeY(p.dim, p.x, p.z);
    ps.needsSafeSpawn = false;
    if (y !== null) this.teleport(p, Math.floor(p.x) + 0.5, y, Math.floor(p.z) + 0.5);
  }

  /** Streams chunks to a player nearest-first, respecting a per-tick budget. */
  private sendChunks(p: ServerPlayer): void {
    const dim = p.dim;
    const r = p.viewDistance;
    const pcx = Math.floor(p.x) >> 4;
    const pcz = Math.floor(p.z) >> 4;
    // Unload far chunks
    for (const k of p.sentChunks) {
      const cx = chunkIndexX(k);
      const cz = chunkIndexZ(k);
      if (Math.abs(cx - pcx) > r + 1 || Math.abs(cz - pcz) > r + 1) {
        p.sentChunks.delete(k);
        p.send({ t: 'unload_chunk', cx, cz });
      }
    }
    if ((p.conn.buffered ?? 0) > 2_000_000) return;
    let budget = this.opts.chunksPerTick;
    for (const [dx, dz] of spiral(r)) {
      if (budget <= 0) break;
      const cx = pcx + dx;
      const cz = pcz + dz;
      const k = chunkIndex(cx, cz);
      if (p.sentChunks.has(k)) continue;
      const c = dim.chunks.get(k);
      if (!c || !c.lightReady) continue;
      // Require neighbours so light and client meshing are complete.
      if (!dim.chunks.has(chunkIndex(cx + 1, cz)) || !dim.chunks.has(chunkIndex(cx - 1, cz)) || !dim.chunks.has(chunkIndex(cx, cz + 1)) || !dim.chunks.has(chunkIndex(cx, cz - 1))) continue;
      p.send({ t: 'chunk', data: encodeChunk(c, { light: true, blockEntities: true }) });
      p.sentChunks.add(k);
      budget--;
    }
  }

  private flushLight(): void {
    for (const d of this.dims.values()) {
      if (d.dirtyLight.size === 0) continue;
      const ups = d.drainLightUpdates();
      for (const u of ups) {
        const k = chunkIndex(u.cx, u.cz);
        for (const p of this.players.values()) {
          if (p.dim === d && p.sentChunks.has(k)) p.send({ t: 'light', cx: u.cx, cz: u.cz, sy: u.sy, data: u.data });
        }
      }
    }
  }

  /** Entity visibility + movement replication. */
  private trackEntities(): void {
    const movers: Entity[] = [];
    for (const d of this.dims.values()) {
      for (const e of d.entities.values()) {
        const ls = e.lastSent;
        if (ls.x !== e.x || ls.y !== e.y || ls.z !== e.z || ls.yaw !== e.yaw || ls.pitch !== e.pitch || ls.headYaw !== e.headYaw) movers.push(e);
      }
    }
    for (const p of this.players.values()) {
      const dim = p.dim;
      const visible = new Set<number>();
      const near = dim.entitiesNear(p.x, p.y, p.z, Math.min(p.viewDistance * 16, 160));
      for (const e of near) {
        if (e === p) continue;
        if (e.distanceSq(p.x, p.y, p.z) > e.trackingRange() ** 2) continue;
        if (!p.sentChunks.has(chunkIndex(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4))) continue;
        visible.add(e.id);
        if (!p.tracked.has(e.id)) {
          p.tracked.add(e.id);
          p.send({ t: 'spawn', e: e.spawnPacket() });
        }
      }
      const gone: number[] = [];
      for (const id of p.tracked) if (!visible.has(id)) gone.push(id);
      if (gone.length) {
        for (const id of gone) p.tracked.delete(id);
        p.send({ t: 'despawn', ids: gone });
      }
      const list: number[] = [];
      for (const e of movers) {
        if (e === p || !p.tracked.has(e.id)) continue;
        list.push(e.id, round3(e.x), round3(e.y), round3(e.z), round3(e.yaw), round3(e.pitch), round3(e.headYaw));
      }
      if (list.length) p.send({ t: 'moves', list });
      for (const d of this.dims.values()) {
        if (d !== dim) continue;
        for (const e of d.entities.values()) {
          if (e.metaDirty && p.tracked.has(e.id)) p.send({ t: 'meta', id: e.id, meta: e.meta() ?? {} });
        }
      }
      if (p.statsDirty) {
        p.statsDirty = false;
        const s = p.statsPacket();
        const js = JSON.stringify(s);
        if (js !== p.lastStatsJson) {
          p.lastStatsJson = js;
          p.send({ t: 'stats', s });
        }
      }
    }
    for (const e of movers) {
      const ls = e.lastSent;
      ls.x = e.x;
      ls.y = e.y;
      ls.z = e.z;
      ls.yaw = e.yaw;
      ls.pitch = e.pitch;
      ls.headYaw = e.headYaw;
    }
    for (const d of this.dims.values()) for (const e of d.entities.values()) e.metaDirty = false;
  }

  /** Moves a player to another dimension (portal travel etc). */
  /** Moves a player to another dimension. Cheat travel (`admin`) never counts as entering it. */
  changeDimension(p: ServerPlayer, target: DimensionId, x: number, y: number, z: number, yaw = p.yaw, opts: { admin?: boolean } = {}): void {
    const from = p.dim;
    const to = this.dim(target);
    this.mounts?.dismount(p, true);
    this.interaction.closeWindow(p, p.windowId, true);
    from.removeEntity(p);
    for (const id of p.tracked) void id;
    p.tracked.clear();
    p.sentChunks.clear();
    p.chunkX = NaN;
    p.setPos(x, y, z);
    p.yaw = yaw;
    p.lastValidX = x;
    p.lastValidY = y;
    p.lastValidZ = z;
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
    p.dig = null;
    p.portalCooldown = 100;
    p.spawnProtection = 40;
    to.addEntity(p);
    p.teleportSeq = p.moveSeq + 1000000 + this.tickNo;
    p.awaitingTeleport = true;
    p.send({ t: 'dimension', dimension: target, x, y, z, yaw });
    p.send({ t: 'teleport', x, y, z, yaw, seq: p.teleportSeq });
    if (opts.admin || this.admin.active) return;
    this.admin.onNormalDimensionChange(p);
    this.interaction.onDimensionEntered(p, target);
  }

  eyePos(p: ServerPlayer): [number, number, number] {
    return [p.x, p.y + (p.sneaking ? 1.27 : PLAYER_EYE), p.z];
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const spiralCache = new Map<number, [number, number][]>();
/** Offsets within a square radius sorted by distance (cached). */
export function spiral(r: number): [number, number][] {
  let s = spiralCache.get(r);
  if (s) return s;
  s = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r + r) s.push([dx, dz]);
  s.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  spiralCache.set(r, s);
  return s;
}
