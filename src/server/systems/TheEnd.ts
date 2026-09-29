/**
 * The End progression: Eyes of Ender (thrown towards strongholds and
 * slotted into portal frames), travel through end portals and gateways,
 * the arrival platform, breath clouds, End Crystals and the Ender Dragon
 * fight with its boss bar, phases and death sequence.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Entity } from '../entity/Entity';
import type { HurtInfo } from '../entity/Living';
import type { ItemStack } from '../../common/game/itemstack';
import { stackOf, markAdmin } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { S, getProp, withProp, blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { Random } from '../../common/math/rng';
import { EnderEye, EndCrystal } from '../entity/EndEntities';
import { Mob, approachAngle, isPlayer } from '../entity/Mob';
import { END_SPAWN, EndGenerator, buildExitPortal, endPillars, exitPortalY } from '../../common/gen/end';
import { rollLoot } from '../../common/game/loot';

interface BreathCloud {
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  radius: number;
  ticks: number;
  owner: Entity | null;
}

type Phase = 'hold' | 'strafe' | 'approach' | 'perch' | 'takeoff' | 'charge' | 'dying';

const HOLD_RADIUS = 58;
const NODES = 12;
const FIRST_KILL_XP = 12000;
const REPEAT_KILL_XP = 500;
/** Ticks the dragon spends perched on the portal before taking off again. */
const PERCH_TICKS = 300;
/** Damage taken while perched that sends it back into the air early. */
const PERCH_DAMAGE_LIMIT = 40;

interface PendingGateway {
  x: number;
  z: number;
  /** Where a return gateway leads (above a main-island gateway); empty for ring gateways. */
  back: number[];
  /** Ring gateways around the main island hang at a fixed height. */
  ringY?: number;
}

export class EndSystem {
  private readonly clouds: BreathCloud[] = [];
  private readonly arriving = new Set<ServerPlayer>();
  private readonly rng = new Random();
  readonly fight: DragonFight;

  constructor(private readonly server: GameServer) {
    this.fight = new DragonFight(server, this);
    // Return gateways still waiting for their island to load (saved with the level)
    const pend = server.level.flags.pendingGateways;
    if (Array.isArray(pend)) {
      for (const g of pend as PendingGateway[]) {
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.z) || !Array.isArray(g.back)) continue;
        if (Number.isFinite(g.ringY)) this.pendingGateways.push({ x: g.x, z: g.z, back: [], ringY: Number(g.ringY) });
        else if (g.back.length === 3) this.pendingGateways.push({ x: g.x, z: g.z, back: g.back.map(Number) });
      }
    }
  }

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  // ------------------------------------------------------------------ eyes of ender

  /** Right click in the air with an Eye of Ender. */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id !== 'ender_eye') return false;
    return this.throwEye(p);
  }

  /** Right click on a block with an item (frames and dragon crystals). */
  useOnBlock(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number): boolean {
    const id = items[stack.id]?.id;
    const dim = p.dim;
    const state = dim.getState(x, y, z);
    const bid = blocks[STATE_BLOCK[state]!]!.id;
    if (id === 'ender_eye') {
      if (bid === 'end_portal_frame') {
        if (getProp(state, 'eye') === 'true') return true;
        dim.setBlock(x, y, z, withProp(state, 'eye', true));
        this.consume(p);
        this.server.playSound(dim, 'block.chime', x + 0.5, y + 1, z + 0.5, 1, 0.6);
        this.server.particles(dim, 'portal', x + 0.5, y + 1, z + 0.5, 16, 0.4);
        this.tryActivate(dim, x, y, z);
        return true;
      }
      return this.throwEye(p);
    }
    if (id === 'end_crystal' && (bid === 'obsidian' || bid === 'bedrock') && dim.getState(x, y + 1, z) === 0 && dim.getState(x, y + 2, z) === 0) {
      const c = this.spawnCrystal(dim, x + 0.5, y + 1, z + 0.5);
      c.showBase = false;
      this.consume(p);
      this.fight.onCrystalPlaced(c);
      return true;
    }
    return false;
  }

  private consume(p: ServerPlayer): void {
    if (p.gamemode === 'creative') return;
    const s = p.inventory.get(p.selectedSlot);
    if (!s) return;
    p.inventory.set(p.selectedSlot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
    this.server.interaction.syncInventory(p);
  }

  private throwEye(p: ServerPlayer): boolean {
    const target = p.dim.generator.locate?.('stronghold', Math.floor(p.x), Math.floor(p.z));
    if (p.dim.id !== 'overworld' || !target) return false;
    const [ex, ey, ez] = this.server.eyePos(p);
    const eye = new EnderEye(ex, ey - 0.1, ez, target, this.rng.next() < 0.8);
    p.dim.addEntity(eye);
    this.consume(p);
    this.server.playSound(p.dim, 'ender_eye.launch', ex, ey, ez, 1, 1);
    return true;
  }

  /** Lights the end portal when all twelve frames around a 3x3 opening hold eyes. */
  tryActivate(dim: Dimension, x: number, y: number, z: number): boolean {
    const frame = (fx: number, fz: number): boolean => {
      const s = dim.getState(fx, y, fz);
      return blocks[STATE_BLOCK[s]!]!.id === 'end_portal_frame' && getProp(s, 'eye') === 'true';
    };
    for (let cx = x - 2; cx <= x + 2; cx++)
      for (let cz = z - 2; cz <= z + 2; cz++) {
        const ring: [number, number][] = [];
        for (let d = -1; d <= 1; d++) ring.push([cx + d, cz - 2], [cx + d, cz + 2], [cx - 2, cz + d], [cx + 2, cz + d]);
        if (!ring.some(([rx, rz]) => rx === x && rz === z)) continue;
        if (!ring.every(([rx, rz]) => frame(rx, rz))) continue;
        const portal = S('end_portal');
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) dim.setBlock(cx + dx, y, cz + dz, portal);
        for (const pl of this.server.players.values()) if (pl.dim === dim) pl.send({ t: 'sound', name: 'end_portal.open', x: pl.x, y: pl.y, z: pl.z, volume: 1, pitch: 1 });
        return true;
      }
    return false;
  }

  // ------------------------------------------------------------------ travel

  enterPortal(p: ServerPlayer, kind: string): void {
    if (kind === 'end_portal') {
      if (p.dim.id === 'end') this.leaveEnd(p);
      else this.toEnd(p);
    } else if (kind === 'end_gateway') this.gateway(p);
  }

  private toEnd(p: ServerPlayer): void {
    // Remember the portal the player came through (the secret ending sends them back to it)
    if (p.dim.id === 'overworld') p.endEntry = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    this.server.changeDimension(p, 'end', END_SPAWN.x + 0.5, END_SPAWN.y, END_SPAWN.z + 0.5, Math.PI / 2);
    p.portalCooldown = 100;
    this.arriving.add(p);
  }

  /** Obsidian arrival platform with room to stand. */
  buildPlatform(dim: Dimension): void {
    const obsidian = S('obsidian');
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        dim.setBlock(END_SPAWN.x + dx, END_SPAWN.y - 1, END_SPAWN.z + dz, obsidian);
        for (let dy = 0; dy < 3; dy++) dim.setBlock(END_SPAWN.x + dx, END_SPAWN.y + dy, END_SPAWN.z + dz, 0);
      }
  }

  private leaveEnd(p: ServerPlayer): void {
    p.addStat('left_the_end');
    this.server.interaction.sendToSpawn(p);
    p.portalCooldown = 100;
    // The ending card waits until the player is home (Ending 1 after a normal kill)
    this.server.endings?.onLeaveEnd(p);
  }

  /** A player pressed into (or glided through) an End Gateway. */
  private gateway(p: ServerPlayer): void {
    const dim = p.dim;
    if (dim.id !== 'end') return;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y + 0.5);
    const bz = Math.floor(p.z);
    for (let dy = -1; dy <= 2; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          if (dim.blockId(bx + dx, by + dy, bz + dz) === 'end_gateway') {
            this.useGateway(p, bx + dx, by + dy, bz + dz);
            return;
          }
  }

  /** An ender pearl flew into a gateway: its thrower goes through. */
  pearlGateway(owner: Entity | null, gx: number, gy: number, gz: number): boolean {
    if (!owner || !isPlayer(owner) || owner.dead || owner.dim.id !== 'end') return false;
    if (owner.portalCooldown > 0) return false;
    this.useGateway(owner, gx, gy, gz);
    return true;
  }

  /** Sends a player through the gateway at (gx, gy, gz). */
  private useGateway(p: ServerPlayer, gx: number, gy: number, gz: number): void {
    const dim = p.dim;
    const be = dim.getBlockEntity(gx, gy, gz);
    let exit = be && Array.isArray(be.exit) ? (be.exit as number[]) : null;
    if (!exit) {
      // Main island gateway: out ~1024 blocks in the gateway's direction, to the outer islands
      const d = Math.hypot(gx, gz) || 1;
      const gen = dim.generator as EndGenerator;
      const land = gen.outerLanding((gx / d) * 1024, (gz / d) * 1024);
      exit = [land.x, land.y, land.z];
      dim.setBlockEntity(gx, gy, gz, { type: 'end_gateway', exit });
      // The way back stands a few steps from the landing spot, towards the main island
      this.pendingGateways.push({ x: Math.round(land.x - (gx / d) * 5), z: Math.round(land.z - (gz / d) * 5), back: [gx, gy + 2, gz] });
      this.savePending();
    }
    this.server.playSound(dim, 'portal.travel', p.x, p.y, p.z, 0.6, 1.4);
    this.server.particles(dim, 'portal', gx + 0.5, gy + 0.5, gz + 0.5, 30, 0.8);
    this.server.teleport(p, exit[0]! + 0.5, exit[1]!, exit[2]! + 0.5);
    (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
    p.portalCooldown = 60;
    this.server.playSound(dim, 'portal.travel', p.x, p.y, p.z, 0.6, 1.4);
  }

  private readonly pendingGateways: PendingGateway[] = [];

  private savePending(): void {
    if (this.pendingGateways.length) this.flags.pendingGateways = this.pendingGateways.map((g) => (g.ringY !== undefined ? { x: g.x, z: g.z, back: [], ringY: g.ringY } : { x: g.x, z: g.z, back: g.back }));
    else delete this.flags.pendingGateways;
  }

  /**
   * Builds a return gateway on an outer island: one block above the ground,
   * so a player standing next to it can step into its side.
   */
  private buildReturnGateway(dim: Dimension, g: PendingGateway): void {
    let y = -1;
    for (let yy = 120; yy > 8; yy--) {
      if (dim.blockId(g.x, yy, g.z) === 'end_stone') {
        y = yy + 2;
        break;
      }
    }
    if (y < 0) y = 75; // no island under it: hang it where islands usually are
    this.buildGateway(dim, g.x, y, g.z, g.back);
  }

  private buildGateway(dim: Dimension, x: number, y: number, z: number, exit: number[] | null): void {
    const bedrock = S('bedrock');
    dim.setBlock(x, y, z, S('end_gateway'));
    if (exit) dim.setBlockEntity(x, y, z, { type: 'end_gateway', exit });
    for (const dy of [-1, 1]) dim.setBlock(x, y + dy, z, bedrock);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      dim.setBlock(x + dx, y - 2, z + dz, bedrock);
      dim.setBlock(x + dx, y + 2, z + dz, bedrock);
    }
  }

  /** Position of the n-th gateway on the ring around the main island. */
  static ringGateway(n: number): { x: number; y: number; z: number } {
    const a = (((n * 7) % 20) / 20) * Math.PI * 2;
    return { x: Math.round(Math.cos(a) * 96), y: 75, z: Math.round(Math.sin(a) * 96) };
  }

  /**
   * A new gateway on the ring around the main island after each dragon
   * kill. The ring lies outside most view distances, so if its chunk isn't
   * loaded yet it is built (and saved as pending) once it is.
   */
  spawnGateway(dim: Dimension): void {
    const n = Number(this.flags.gateways ?? 0);
    if (n >= 20) return;
    const g = EndSystem.ringGateway(n);
    this.flags.gateways = n + 1;
    if (dim.isLoaded(g.x, g.z)) this.buildRingGateway(dim, g.x, g.y, g.z);
    else {
      this.pendingGateways.push({ x: g.x, z: g.z, back: [], ringY: g.y });
      this.savePending();
    }
  }

  private buildRingGateway(dim: Dimension, x: number, y: number, z: number): void {
    this.buildGateway(dim, x, y, z, null);
    this.server.particles(dim, 'portal', x + 0.5, y + 0.5, z + 0.5, 60, 1.5);
    this.server.playSound(dim, 'end_portal.open', x + 0.5, y, z + 0.5, 3, 1.3);
  }

  /** A purple shimmer rising from each ring gateway that has a player nearby. */
  private gatewayBeams(): void {
    const n = Math.min(20, Number(this.flags.gateways ?? 0));
    if (!n) return;
    const dim = this.server.dim('end');
    const players = [...this.server.players.values()].filter((p) => p.dim === dim && !p.dead);
    if (!players.length) return;
    for (let i = 0; i < n; i++) {
      const g = EndSystem.ringGateway(i);
      if (!players.some((p) => p.distanceSq(g.x, g.y, g.z) < 64 * 64)) continue;
      if (dim.blockId(g.x, g.y, g.z) !== 'end_gateway') continue;
      this.server.particles(dim, 'portal', g.x + 0.5, g.y + 0.5, g.z + 0.5, 6, 0.4);
    }
  }

  // ------------------------------------------------------------------ crystals & breath

  spawnCrystal(dim: Dimension, x: number, y: number, z: number): EndCrystal {
    const c = new EndCrystal();
    c.setPos(x, y, z);
    dim.addEntity(c);
    const fire = S('fire');
    if (dim.getState(Math.floor(x), Math.floor(y), Math.floor(z)) === 0) dim.setBlock(Math.floor(x), Math.floor(y), Math.floor(z), fire, { updateNeighbors: false });
    return c;
  }

  restore(dim: Dimension, d: Record<string, unknown>): Entity | null {
    void dim;
    return EndCrystal.load(d);
  }

  onCrystalDestroyed(c: EndCrystal, by: Entity | null): void {
    this.fight.onCrystalDestroyed(c, by);
  }

  breathCloud(dim: Dimension, x: number, y: number, z: number, owner: Entity | null): void {
    this.clouds.push({ dim, x, y, z, radius: 3, ticks: 200, owner });
    this.server.playSound(dim, 'fizz', x, y, z, 1, 0.6);
  }

  /** Glass bottle used inside a breath cloud collects Dragon's Breath. */
  fillBottle(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id !== 'glass_bottle') return false;
    const cloud = this.clouds.find((c) => c.dim === p.dim && (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < (c.radius + 1) ** 2 && Math.abs(c.y - p.y) < 3);
    if (!cloud) return false;
    this.consume(p);
    const rest = p.inventory.add(stackOf('dragon_breath', 1));
    if (rest) this.server.interaction.dropStack(p, rest);
    this.server.interaction.syncInventory(p);
    cloud.radius = Math.max(0.5, cloud.radius - 0.5);
    this.server.playSound(p.dim, 'drink', p.x, p.y + 1, p.z, 0.6, 1.3);
    return true;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    for (const p of this.arriving) {
      if (p.dim.id !== 'end' || p.dead) {
        this.arriving.delete(p);
        continue;
      }
      if (!p.dim.isLoaded(END_SPAWN.x, END_SPAWN.z)) continue;
      this.arriving.delete(p);
      this.buildPlatform(p.dim);
      this.server.teleport(p, END_SPAWN.x + 0.5, END_SPAWN.y, END_SPAWN.z + 0.5, Math.PI / 2);
    }
    for (let i = this.pendingGateways.length - 1; i >= 0; i--) {
      const g = this.pendingGateways[i]!;
      const end = this.server.dim('end');
      if (!end.isLoaded(g.x, g.z)) continue;
      this.pendingGateways.splice(i, 1);
      if (g.ringY !== undefined) this.buildRingGateway(end, g.x, g.ringY, g.z);
      else this.buildReturnGateway(end, g);
      this.savePending();
    }
    // Active gateways glow with a faint beam while someone is near
    if (this.server.tickNo % 10 === 0) this.gatewayBeams();
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]!;
      if (--c.ticks <= 0 || c.radius <= 0.5) {
        this.clouds.splice(i, 1);
        continue;
      }
      if (c.ticks % 4 === 0) this.server.particles(c.dim, 'dragon_breath', c.x, c.y + 0.3, c.z, 6, c.radius * 0.7);
      if (c.ticks % 10 === 0) {
        for (const p of this.server.players.values()) {
          if (p.dim !== c.dim || p.dead) continue;
          if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 <= c.radius * c.radius && p.y >= c.y - 1 && p.y <= c.y + 2) this.server.interaction.survival.damage(p, 3, { source: 'dragon_breath', attacker: c.owner });
        }
      }
    }
    this.fight.tick();
  }
}

/**
 * Drives the Ender Dragon: holding pattern around the pillars, strafing
 * runs with breath fireballs, perching on the exit portal to breathe
 * flames, charges, crystal healing, boss bar and the death sequence.
 */
export class DragonFight {
  dragon: Mob | null = null;
  phase: Phase = 'hold';
  private phaseTicks = 0;
  private node = 0;
  private dir = 1;
  /** Strafe/charge target: a player or a Voidbound Enderman. */
  private target: Entity | null = null;
  /** The dragon was killed by a Voidbound Enderman with every crystal broken. */
  secretRun = false;
  private healer: EndCrystal | null = null;
  private readonly barPlayers = new Set<ServerPlayer>();
  private barId = -1;
  private readonly hitCooldown = new Map<ServerPlayer, number>();
  private damageWhilePerched = 0;
  private lastHealth = 0;
  /** Ticks since the dragon last left the portal, and when it wants to come down again. */
  private sincePerch = 0;
  private perchDue = 0;
  private readonly rng = new Random();

  constructor(
    private readonly server: GameServer,
    private readonly end: EndSystem,
  ) {}

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  private get dim(): Dimension {
    return this.server.dim('end');
  }

  private portalY(): number {
    return exitPortalY((this.dim.generator as EndGenerator).terrain);
  }

  private players(): ServerPlayer[] {
    return [...this.server.players.values()].filter((p) => p.dim === this.dim && !p.dead && p.gamemode !== 'spectator');
  }

  /** Spawns the dragon (first visit, or when respawned with crystals). */
  spawnDragon(): Mob | null {
    const m = this.server.mobs?.create('ender_dragon');
    if (!m) return null;
    m.controlled = true;
    m.deathDuration = 200;
    m.persistent = false;
    const hp = Number(this.flags.dragonHealth);
    if (Number.isFinite(hp) && hp > 0) m.health = Math.min(m.maxHealth, hp);
    // A dragon summoned by a cheat stays cheat-made across reloads
    m.admin = this.flags.dragonAdmin === true || this.server.admin.active;
    if (m.admin) this.flags.dragonAdmin = true;
    m.setPos(0, 110, 0);
    this.dim.addEntity(m);
    this.dragon = m;
    this.phase = 'hold';
    this.phaseTicks = 0;
    this.lastHealth = m.health;
    this.flags.dragonAlive = true;
    // The first dive to the portal comes a little sooner than the rest
    this.schedulePerch(0.7);
    this.server.playSound(this.dim, 'dragon.growl', 0, 100, 0, 4, 1);
    return m;
  }

  tick(): void {
    const dim = this.dim;
    const players = this.players();
    const d = this.dragon;
    if (d && (d.removed || d.dim !== dim)) {
      this.dragon = null;
      this.clearBars();
    }
    if (!this.dragon) {
      // Spawn when someone is in the End and the dragon has not been beaten
      if (players.length && !this.flags.dragonKilled && dim.isLoaded(0, 0)) this.spawnDragon();
      return;
    }
    const m = this.dragon;
    if (!players.length) {
      if (m.dead) {
        // Everyone left during the death sequence: finish it now so the kill still counts
        if (this.secretRun) this.server.endgame?.finishSecretNow();
        else this.finish(m, !this.flags.dragonKilledOnce, !this.flags.dragonKilledOnce ? FIRST_KILL_XP : REPEAT_KILL_XP);
        return;
      }
      // Nobody left: put the dragon away, remembering its health
      this.flags.dragonHealth = m.health;
      m.remove();
      this.dragon = null;
      this.clearBars();
      return;
    }
    if (m.dead) {
      this.dying(m);
      this.updateBars(m, players);
      return;
    }
    this.phaseTicks++;
    if (this.phase !== 'approach' && this.phase !== 'perch') this.sincePerch++;
    this.heal(m);
    this.fly(m, players);
    this.contact(m);
    if (m.health < this.lastHealth && this.phase === 'perch') this.damageWhilePerched += this.lastHealth - m.health;
    this.lastHealth = m.health;
    if (this.server.tickNo % 20 === 0) this.flags.dragonHealth = m.health;
    if (this.server.tickNo % 50 === 0 && this.rng.chance(0.4)) this.server.playSound(dim, 'dragon.wings', m.x, m.y, m.z, 3, 0.8 + this.rng.next() * 0.3);
    this.updateBars(m, players);
  }

  // ------------------------------------------------------------------ flight

  private nodePos(i: number): { x: number; y: number; z: number } {
    const a = (i / NODES) * Math.PI * 2;
    return { x: Math.cos(a) * HOLD_RADIUS, y: 78 + ((i * 7) % 5) * 5, z: Math.sin(a) * HOLD_RADIUS };
  }

  private nearest(m: Mob, players: ServerPlayer[]): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bd = Infinity;
    for (const p of players) {
      const dd = p.distanceSq(m.x, m.y, m.z);
      if (dd < bd && p.gamemode !== 'creative') {
        bd = dd;
        best = p;
      }
    }
    return best;
  }

  /** Endermen turned against the dragon by the mysterious potion. */
  voidbound(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.dim.entities.values()) if (e instanceof Mob && e.type === 'enderman' && e.data.voidbound && !e.dead && !e.removed) out.push(e);
    return out;
  }

  /** What the dragon turns on: the nearest survival player or Voidbound Enderman. */
  private focus(m: Mob, players: ServerPlayer[]): Entity | null {
    let best: Entity | null = this.nearest(m, players);
    let bd = best ? best.distanceSq(m.x, m.y, m.z) : Infinity;
    for (const e of this.voidbound()) {
      const dd = e.distanceSq(m.x, m.y, m.z);
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    return best;
  }

  /** Picks when the dragon next dives to the portal: sooner as its crystals fall. */
  private schedulePerch(scale = 1): void {
    this.sincePerch = 0;
    this.perchDue = Math.round((620 + this.crystalsAlive() * 60 + this.rng.int(240)) * scale);
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTicks = 0;
    const m = this.dragon!;
    if (p === 'perch') {
      m.data.phase = 'perch';
      this.damageWhilePerched = 0;
    } else delete m.data.phase;
    if (p === 'takeoff') this.schedulePerch();
    m.metaDirty = true;
  }

  private steer(m: Mob, tx: number, ty: number, tz: number, speed: number, turn = 0.08): number {
    const b = m.body;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const dz = tz - b.z;
    const dist = Math.hypot(dx, dy, dz);
    const want = Math.atan2(-dx, -dz);
    m.yaw = approachAngle(m.yaw, want, turn);
    m.headYaw = m.yaw;
    const vy = Math.max(-0.6, Math.min(0.6, dy * 0.06));
    b.vx += (-Math.sin(m.yaw) * speed - b.vx) * 0.25;
    b.vz += (-Math.cos(m.yaw) * speed - b.vz) * 0.25;
    b.vy += (vy - b.vy) * 0.25;
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
    m.pitch = -Math.atan2(b.vy, Math.hypot(b.vx, b.vz)) * 0.6;
    return dist;
  }

  private fly(m: Mob, players: ServerPlayer[]): void {
    const py = this.portalY();
    switch (this.phase) {
      case 'hold': {
        const n = this.nodePos(this.node);
        if (this.steer(m, n.x, n.y, n.z, 0.55) < 6) {
          this.node = (this.node + this.dir + NODES) % NODES;
          if (this.rng.chance(0.08)) this.dir = -this.dir;
          const foe = this.focus(m, players);
          const r = this.rng.next();
          // Every so often it dives to the portal to fight from the centre
          if (foe && (this.sincePerch >= this.perchDue || r < 1 / (this.crystalsAlive() + 4))) this.setPhase('approach');
          else if (foe && r < 0.45) {
            this.target = foe;
            this.setPhase(this.rng.chance(0.25) ? 'charge' : 'strafe');
          }
        }
        break;
      }
      case 'strafe': {
        const t = this.target;
        if (!t || t.removed || (t as { dead?: boolean }).dead || t.dim !== m.dim || this.phaseTicks > 200) {
          this.setPhase('hold');
          break;
        }
        const dist = this.steer(m, t.x, t.y + 14, t.z, 0.65);
        if (dist < 48 && this.phaseTicks % 30 === 15) {
          const mobs = this.server.mobs!;
          const hx = m.x - Math.sin(m.yaw) * 6;
          const hz = m.z - Math.cos(m.yaw) * 6;
          const fb = mobs.projectile(m.dim, 'dragon_fireball', hx, m.y + 2, hz, m);
          fb.shoot(t.x - hx, t.y + 0.5 - (m.y + 2), t.z - hz, 1.1, 1, () => this.rng.next());
          this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 3, 1.2);
        }
        if (dist < 16) this.setPhase('hold');
        break;
      }
      case 'charge': {
        const t = this.target;
        if (!t || t.removed || (t as { dead?: boolean }).dead || t.dim !== m.dim || this.phaseTicks > 80) {
          this.setPhase('hold');
          break;
        }
        if (this.steer(m, t.x, t.y + 1, t.z, 1.0, 0.16) < 4) this.setPhase('hold');
        break;
      }
      case 'approach': {
        const high = this.phaseTicks < 60;
        const ty = py + (high ? 20 : 4);
        const b = m.body;
        const dx = -b.x;
        const dy = ty - b.y;
        const dz = -b.z;
        const dist = Math.hypot(dx, dy, dz);
        if (!high && (dist < 16 || this.phaseTicks > 260)) {
          // Final glide straight down onto the portal pillar (no circling)
          const step = Math.min(dist, this.phaseTicks > 260 ? 0.8 : 0.5);
          b.vx = (dx / (dist || 1)) * step;
          b.vy = (dy / (dist || 1)) * step;
          b.vz = (dz / (dist || 1)) * step;
          b.x += b.vx;
          b.y += b.vy;
          b.z += b.vz;
          const foe = this.focus(m, players);
          if (foe) m.yaw = approachAngle(m.yaw, Math.atan2(-(foe.x - b.x), -(foe.z - b.z)), 0.08);
          m.headYaw = m.yaw;
          m.pitch *= 0.8;
          if (dist < 0.7) {
            b.vx = b.vy = b.vz = 0;
            m.setPos(0, py + 4, 0);
            this.setPhase('perch');
            this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 4, 0.8);
            this.server.particles(m.dim, 'explosion_smoke', 0.5, py + 1, 0.5, 30, 3);
          }
        } else this.steer(m, 0, ty, 0, high ? 0.6 : 0.45, 0.12);
        break;
      }
      case 'perch':
        this.perchAttacks(m, players, py);
        if (this.phaseTicks > PERCH_TICKS || this.damageWhilePerched >= PERCH_DAMAGE_LIMIT) this.setPhase('takeoff');
        break;
      case 'takeoff':
        if (this.steer(m, this.nodePos(this.node).x, py + 30, this.nodePos(this.node).z, 0.5, 0.1) < 10 || this.phaseTicks > 100) this.setPhase('hold');
        break;
      case 'dying':
        break;
    }
  }

  /**
   * Perched on the portal the dragon fights from the centre: it breathes
   * flames across the ground, snaps at anyone near its head, beats its
   * wings to throw attackers back and spits fireballs at distant targets.
   * It can be struck freely the whole time.
   */
  private perchAttacks(m: Mob, players: ServerPlayer[], py: number): void {
    m.body.vx = m.body.vy = m.body.vz = 0;
    const t = this.focus(m, players);
    if (t) m.yaw = approachAngle(m.yaw, Math.atan2(-(t.x - m.x), -(t.z - m.z)), 0.1);
    m.headYaw = m.yaw;
    if (!t) return;
    const pt = this.phaseTicks;
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    const dd = Math.hypot(dx, dz) || 1;
    const survival = this.server.interaction.survival;
    const hurt = (e: Entity, amount: number, kb: number): void => {
      const ex = e.x - m.x;
      const ez = e.z - m.z;
      const el = Math.hypot(ex, ez) || 1;
      if (isPlayer(e)) survival.damage(e, amount, { source: 'mob', attacker: m, kbx: ex / el, kbz: ez / el, knockback: kb });
      else if (e instanceof Mob) e.hurt(amount, { source: 'mob', attacker: m, kbx: ex / el, kbz: ez / el, knockback: kb });
    };
    const foes = (): Entity[] => [...players.filter((p) => p.gamemode !== 'creative'), ...this.voidbound()];
    // Flame breath sweeping the ground towards its target
    if (pt % 80 === 40) {
      const reach = Math.min(dd, 9);
      const base = Math.atan2(dz, dx);
      for (const off of [0, -0.45, 0.45]) {
        const r = off === 0 ? reach : reach * 0.75;
        this.end.breathCloud(m.dim, m.x + Math.cos(base + off) * r, py, m.z + Math.sin(base + off) * r, m);
      }
      this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 4, 0.6);
    }
    // Fireballs at anyone keeping their distance
    if (pt % 60 === 20 && dd > 16) {
      const hx = m.x - Math.sin(m.yaw) * 6;
      const hz = m.z - Math.cos(m.yaw) * 6;
      const fb = this.server.mobs!.projectile(m.dim, 'dragon_fireball', hx, m.y + 3, hz, m);
      fb.shoot(t.x - hx, t.y + 0.5 - (m.y + 3), t.z - hz, 1.1, 1, () => this.rng.next());
      this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 3, 1.2);
    }
    // A snap of the jaws at whatever stands at its head
    if (pt % 25 === 12) {
      const hx = m.x - Math.sin(m.yaw) * 7;
      const hz = m.z - Math.cos(m.yaw) * 7;
      for (const e of foes()) {
        if (Math.hypot(e.x - hx, e.z - hz) < 3.5 && e.y > py - 2 && e.y < py + 8) hurt(e, 6, 0.8);
      }
    }
    // Wing buffet throws back everyone crowding the portal
    if (pt % 100 === 70) {
      let any = false;
      for (const e of foes()) {
        if (Math.hypot(e.x - m.x, e.z - m.z) < 9 && e.y > py - 3 && e.y < py + 10) {
          hurt(e, 4, 2.2);
          any = true;
        }
      }
      this.server.playSound(m.dim, 'dragon.wings', m.x, m.y, m.z, 4, 0.6);
      if (any) this.server.particles(m.dim, 'explosion_smoke', m.x, py + 1, m.z, 24, 4);
    }
  }

  /** Wings and body knock players away and hurt them while flying. */
  private contact(m: Mob): void {
    if (this.phase === 'perch') return;
    const hw = 4;
    for (const p of this.players()) {
      const cd = this.hitCooldown.get(p) ?? 0;
      if (cd > this.server.tickNo) continue;
      if (Math.abs(p.x - m.x) > hw || Math.abs(p.z - m.z) > hw || p.y < m.y - 1 || p.y > m.y + 4) continue;
      const dx = p.x - m.x;
      const dz = p.z - m.z;
      const d = Math.hypot(dx, dz) || 1;
      this.server.interaction.survival.damage(p, this.phase === 'charge' ? 10 : 5, { source: 'mob', attacker: m, kbx: dx / d, kbz: dz / d, knockback: 1.6 });
      this.hitCooldown.set(p, this.server.tickNo + 20);
    }
    // ... and a Voidbound Enderman caught in its path
    if (this.server.tickNo % 20 === 0) {
      for (const e of this.voidbound()) {
        if (Math.abs(e.x - m.x) > hw || Math.abs(e.z - m.z) > hw || e.y < m.y - 1 || e.y > m.y + 4) continue;
        const dx = e.x - m.x;
        const dz = e.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        e.hurt(this.phase === 'charge' ? 10 : 5, { source: 'mob', attacker: m, kbx: dx / d, kbz: dz / d, knockback: 1.6 });
      }
    }
  }

  /** A Voidbound Enderman's blow: it doesn't count towards knocking the dragon off its perch. */
  noteVoidHit(amount: number): void {
    if (this.phase === 'perch') this.damageWhilePerched -= amount;
  }

  // ------------------------------------------------------------------ crystals

  crystals(): EndCrystal[] {
    const out: EndCrystal[] = [];
    for (const e of this.dim.entities.values()) if (e instanceof EndCrystal && !e.removed) out.push(e);
    return out;
  }

  /** Index of the pillar a crystal stands on, or -1 (placed on the portal, say). */
  private pillarOf(c: { x: number; y: number; z: number }): number {
    const pillars = endPillars(this.server.level.seedNum);
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i]!;
      if (Math.abs(c.x - (p.x + 0.5)) < 2 && Math.abs(c.z - (p.z + 0.5)) < 2 && Math.abs(c.y - (p.height + 2)) < 3) return i;
    }
    return -1;
  }

  /**
   * Which pillars still carry their crystal. Kept in the level data so an
   * unloaded pillar never counts as destroyed; read off the loaded pillars
   * the first time it is needed (older saves), or null while some pillar
   * has never been loaded.
   */
  pillarCrystals(): boolean[] | null {
    const st = this.flags.pillarCrystals;
    const pillars = endPillars(this.server.level.seedNum);
    if (Array.isArray(st) && st.length === pillars.length) return st as boolean[];
    if (!pillars.every((p) => this.dim.isLoaded(p.x, p.z))) return null;
    const alive = pillars.map(() => false);
    for (const c of this.crystals()) {
      const i = this.pillarOf(c);
      if (i >= 0) alive[i] = true;
    }
    this.flags.pillarCrystals = alive;
    return alive;
  }

  /** Pillar crystals still standing (all of them while unknown). */
  crystalsAlive(): number {
    const st = this.pillarCrystals();
    return st ? st.filter(Boolean).length : endPillars(this.server.level.seedNum).length;
  }

  /** True only when every pillar's crystal is known to be destroyed. */
  allCrystalsDestroyed(): boolean {
    const st = this.pillarCrystals();
    return !!st && st.every((a) => !a);
  }

  private heal(m: Mob): void {
    if (this.healer && (this.healer.removed || this.healer.distanceSq(m.x, m.y, m.z) > 32 * 32)) {
      this.healer.setBeam(null);
      this.healer = null;
    }
    if (!this.healer && this.server.tickNo % 10 === 0) {
      let best: EndCrystal | null = null;
      let bd = 32 * 32;
      for (const c of this.crystals()) {
        const dd = c.distanceSq(m.x, m.y, m.z);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      }
      if (best) {
        this.healer = best;
        best.setBeam(m.id);
      }
    }
    if (this.healer && this.server.tickNo % 10 === 0 && m.health < m.maxHealth) {
      m.health = Math.min(m.maxHealth, m.health + 1);
      m.metaDirty = true;
    }
  }

  onCrystalDestroyed(c: EndCrystal, by: Entity | null): void {
    const m = this.dragon;
    const owner = by && !isPlayer(by) ? (by as { owner?: Entity | null }).owner : null;
    const player = by && isPlayer(by) ? by : owner && isPlayer(owner) ? owner : null;
    if (m && !m.dead && this.healer === c) {
      this.healer = null;
      m.hurt(10, { source: 'explosion', attacker: player });
    }
    const i = this.pillarOf(c);
    if (i >= 0) {
      const st = this.pillarCrystals();
      if (st) {
        st[i] = false;
        this.flags.pillarCrystals = st;
      }
      if (player && !player.dead) this.server.interaction.grant(player, 'destroy_end_crystal');
    }
    // Four crystals on the exit portal re-summon a defeated dragon
    this.checkRespawn();
  }

  onCrystalPlaced(c: EndCrystal): void {
    void c;
    this.checkRespawn();
  }

  private checkRespawn(): void {
    if (!this.flags.dragonKilled || this.dragon) return;
    const py = this.portalY();
    const onPortal = this.crystals().filter((c) => Math.abs(c.y - py) < 2 && Math.hypot(c.x, c.z) < 5 && Math.hypot(c.x, c.z) > 2);
    if (onPortal.length < 4) return;
    for (const c of onPortal) c.remove();
    this.flags.dragonKilled = false;
    delete this.flags.dragonHealth;
    buildExitPortal((x, y, z, s) => this.dim.setBlock(x, y, z, s), py, false);
    // Rebuild pillar crystals
    const alive = this.pillarCrystals() ?? endPillars(this.server.level.seedNum).map(() => false);
    endPillars(this.server.level.seedNum).forEach((p, i) => {
      if (!this.dim.isLoaded(p.x, p.z)) return;
      if (!alive[i]) this.end.spawnCrystal(this.dim, p.x + 0.5, p.height + 2, p.z + 0.5);
      alive[i] = true;
    });
    this.flags.pillarCrystals = alive;
    this.spawnDragon();
  }

  // ------------------------------------------------------------------ death

  /**
   * Called by the mob system when the dragon's health reaches zero. A kill
   * by a Voidbound Enderman with every pillar crystal destroyed breaks the
   * End (the secret ending); anything else is Ending 1.
   */
  onDeath(m: Mob, killer: ServerPlayer | null, info?: HurtInfo): void {
    // A dragon summoned outside the fight: nothing to finish, nothing to award
    if (m !== this.dragon) return;
    const att = info?.attacker;
    const enderman = att instanceof Mob && att.type === 'enderman' && att.data.voidbound ? att : null;
    this.secretRun = !!enderman && this.allCrystalsDestroyed();
    this.phase = 'dying';
    this.phaseTicks = 0;
    m.data.dying = true;
    m.metaDirty = true;
    this.server.playSound(m.dim, 'dragon.death', m.x, m.y, m.z, 6, 1);
    if (this.healer) {
      this.healer.setBeam(null);
      this.healer = null;
    }
    if (this.secretRun) {
      this.server.endgame?.beginSecretEnding(m, enderman!, m.admin || enderman!.data.voidCheat === true);
      return;
    }
    // A cheat-spawned dragon's defeat is not an advancement for anyone
    if (!m.admin) {
      if (killer) this.server.interaction.grant(killer, 'kill_dragon');
      for (const p of this.players()) if (p !== killer) this.server.interaction.grant(p, 'kill_dragon');
    }
    // Ending 1: shown to everyone who saw it once they walk out through the portal
    const endings = this.server.endings;
    if (endings) {
      endings.state.dragonDeath = m.admin ? 'cheat' : 'player';
      for (const p of this.players()) endings.reach(p, 'dragon', { cheat: m.admin, show: 'on_exit' });
    }
  }

  private dying(m: Mob): void {
    this.phaseTicks++;
    const b = m.body;
    if (this.secretRun) {
      // It rises a little, then hangs there, twitching, while the End breaks around it
      if (this.phaseTicks < 50) {
        b.y += 0.1;
        if (this.phaseTicks % 6 === 0) this.server.particles(m.dim, 'explosion', m.x + (this.rng.next() - 0.5) * 8, m.y + 2, m.z + (this.rng.next() - 0.5) * 8, 1, 0.5);
      } else if (this.phaseTicks % 3 === 0) {
        m.yaw += (this.rng.next() - 0.5) * 0.6;
        m.metaDirty = true;
      }
      return;
    }
    b.y += 0.1;
    if (this.phaseTicks % 5 === 0) this.server.particles(m.dim, 'explosion', m.x + (this.rng.next() - 0.5) * 8, m.y + 2 + (this.rng.next() - 0.5) * 4, m.z + (this.rng.next() - 0.5) * 8, 1, 0.5);
    const first = !this.flags.dragonKilledOnce;
    const total = first ? FIRST_KILL_XP : REPEAT_KILL_XP;
    if (this.phaseTicks > 150 && this.phaseTicks % 5 === 0) {
      const share = Math.floor(total * 0.08);
      this.server.mining.dropXp(m.dim, m.x, m.y, m.z, share, m.admin);
    }
    if (this.phaseTicks === 199) this.finish(m, first, total);
  }

  private finish(m: Mob, first: boolean, total: number): void {
    const dim = this.dim;
    this.server.mining.dropXp(dim, 0.5, this.portalY() + 2, 0.5, Math.floor(total * 0.2), m.admin);
    const py = this.portalY();
    buildExitPortal((x, y, z, s) => dim.setBlock(x, y, z, s), py, true);
    if (first) {
      dim.setBlock(0, py + 4, 0, S('dragon_egg'));
      this.server.admin.setBlockMark(dim, 0, py + 4, 0, m.admin);
    }
    // Loot: dragon scales and breath. (The Corrupted Eye only ever comes from the secret ending.)
    const drops = rollLoot('mob/ender_dragon', { rng: this.rng, looting: 0, killedByPlayer: true, onFire: false, difficulty: this.server.level.difficulty });
    for (const st of drops) this.server.mining.dropItem(dim, 0.5, py + 5, 0.5, m.admin ? markAdmin(st) : st);
    this.end.spawnGateway(dim);
    this.flags.dragonKilled = true;
    this.flags.dragonKilledOnce = true;
    this.flags.dragonAlive = false;
    delete this.flags.dragonAdmin;
    delete this.flags.dragonHealth;
    this.clearBars();
    m.remove();
    this.dragon = null;
    this.server.broadcastChat('The Ender Dragon has been defeated!', 'system');
  }

  /**
   * The secret ending's quiet close: the End is left in its defeated state
   * (lit exit portal, a new gateway, the egg the first time) without the
   * victory sequence, loot or announcement.
   */
  completeSecret(): void {
    const dim = this.dim;
    const m = this.dragon;
    const py = this.portalY();
    buildExitPortal((x, y, z, s) => dim.setBlock(x, y, z, s), py, true);
    if (!this.flags.dragonKilledOnce) {
      dim.setBlock(0, py + 4, 0, S('dragon_egg'));
      this.server.admin.setBlockMark(dim, 0, py + 4, 0, !!m?.admin);
    }
    this.end.spawnGateway(dim);
    this.flags.dragonKilled = true;
    this.flags.dragonKilledOnce = true;
    this.flags.dragonAlive = false;
    delete this.flags.dragonAdmin;
    delete this.flags.dragonHealth;
    this.clearBars();
    m?.remove();
    this.dragon = null;
    this.secretRun = false;
    this.phase = 'hold';
  }

  // ------------------------------------------------------------------ boss bar

  private updateBars(m: Mob, players: ServerPlayer[]): void {
    if (this.server.tickNo % 5 !== 0 && !m.dead) return;
    this.barId = m.id;
    const progress = Math.max(0, m.health / m.maxHealth);
    for (const p of players) {
      const near = p.distanceSq(0, 64, 0) < 192 * 192;
      if (near && !this.barPlayers.has(p)) {
        this.barPlayers.add(p);
        p.send({ t: 'boss', id: m.id, action: 'add', title: 'Ender Dragon', progress, color: 'pink' });
      } else if (near) p.send({ t: 'boss', id: m.id, action: 'update', progress });
      else if (this.barPlayers.has(p)) {
        this.barPlayers.delete(p);
        p.send({ t: 'boss', id: m.id, action: 'remove' });
      }
    }
    for (const p of this.barPlayers) {
      if (!players.includes(p)) {
        this.barPlayers.delete(p);
        p.send({ t: 'boss', id: m.id, action: 'remove' });
      }
    }
  }

  private clearBars(): void {
    for (const p of this.barPlayers) p.send({ t: 'boss', id: this.barId, action: 'remove' });
    this.barPlayers.clear();
  }
}
