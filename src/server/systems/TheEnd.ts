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
import type { ItemStack } from '../../common/game/itemstack';
import { stackOf } from '../../common/game/itemstack';
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

export class EndSystem {
  private readonly clouds: BreathCloud[] = [];
  private readonly arriving = new Set<ServerPlayer>();
  private readonly rng = new Random();
  readonly fight: DragonFight;

  constructor(private readonly server: GameServer) {
    this.fight = new DragonFight(server, this);
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
    if (this.flags.dragonKilled && !p.statistics.left_the_end) {
      p.send({ t: 'title', text: 'The End?', sub: 'The Far Lands still remain...', ticks: 120 });
    }
    p.addStat('left_the_end');
    this.server.interaction.sendToSpawn(p);
    p.portalCooldown = 100;
  }

  private gateway(p: ServerPlayer): void {
    const dim = p.dim;
    if (dim.id !== 'end') return;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y + 0.5);
    const bz = Math.floor(p.z);
    let gx = bx;
    let gy = by;
    let gz = bz;
    search: for (let dy = -1; dy <= 2; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          if (dim.blockId(bx + dx, by + dy, bz + dz) === 'end_gateway') {
            gx = bx + dx;
            gy = by + dy;
            gz = bz + dz;
            break search;
          }
    const be = dim.getBlockEntity(gx, gy, gz);
    let exit = be && Array.isArray(be.exit) ? (be.exit as number[]) : null;
    if (!exit) {
      // Main island gateway: fly out ~1024 blocks in the gateway's direction
      const d = Math.hypot(gx, gz) || 1;
      const gen = dim.generator as EndGenerator;
      const land = gen.outerLanding((gx / d) * 1024, (gz / d) * 1024);
      exit = [land.x, land.y, land.z];
      dim.setBlockEntity(gx, gy, gz, { type: 'end_gateway', exit });
      this.pendingGateways.push({ x: land.x, y: land.y + 8, z: land.z, back: [gx, gy + 2, gz] });
    }
    this.server.teleport(p, exit[0]! + 0.5, exit[1]!, exit[2]! + 0.5);
    (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
    p.portalCooldown = 60;
    this.server.playSound(dim, 'portal.travel', p.x, p.y, p.z, 0.6, 1.4);
  }

  private readonly pendingGateways: { x: number; y: number; z: number; back: number[] }[] = [];

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

  /** A new gateway on the ring around the main island after each dragon kill. */
  spawnGateway(dim: Dimension): void {
    const n = Number(this.flags.gateways ?? 0);
    if (n >= 20) return;
    const a = ((n * 7) % 20) / 20 * Math.PI * 2;
    const x = Math.round(Math.cos(a) * 96);
    const z = Math.round(Math.sin(a) * 96);
    this.buildGateway(dim, x, 75, z, null);
    this.flags.gateways = n + 1;
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
      this.buildGateway(end, g.x, g.y, g.z, g.back);
    }
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
  private target: ServerPlayer | null = null;
  private healer: EndCrystal | null = null;
  private readonly barPlayers = new Set<ServerPlayer>();
  private barId = -1;
  private readonly hitCooldown = new Map<ServerPlayer, number>();
  private damageWhilePerched = 0;
  private lastHealth = 0;
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
    m.setPos(0, 110, 0);
    this.dim.addEntity(m);
    this.dragon = m;
    this.phase = 'hold';
    this.phaseTicks = 0;
    this.lastHealth = m.health;
    this.flags.dragonAlive = true;
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
      // Nobody left: put the dragon away, remembering its health
      if (!m.dead) this.flags.dragonHealth = m.health;
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

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTicks = 0;
    const m = this.dragon!;
    if (p === 'perch') {
      m.data.phase = 'perch';
      this.damageWhilePerched = 0;
    } else delete m.data.phase;
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
          const crystals = this.crystals().length;
          const t = this.nearest(m, players);
          const r = this.rng.next();
          if (t && r < 1 / (crystals + 3)) this.setPhase('approach');
          else if (t && r < 0.45) {
            this.target = t;
            this.setPhase(this.rng.chance(0.25) ? 'charge' : 'strafe');
          }
        }
        break;
      }
      case 'strafe': {
        const t = this.target;
        if (!t || t.dead || t.dim !== m.dim || this.phaseTicks > 200) {
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
        if (!t || t.dead || t.dim !== m.dim || this.phaseTicks > 80) {
          this.setPhase('hold');
          break;
        }
        if (this.steer(m, t.x, t.y + 1, t.z, 1.0, 0.16) < 4) this.setPhase('hold');
        break;
      }
      case 'approach': {
        const high = this.phaseTicks < 60;
        const dist = this.steer(m, 0, py + (high ? 20 : 4), 0, high ? 0.6 : 0.4, 0.12);
        if (!high && dist < 3) {
          m.body.vx = m.body.vy = m.body.vz = 0;
          m.setPos(0, py + 4, 0);
          this.setPhase('perch');
          this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 4, 0.8);
        }
        if (this.phaseTicks > 400) this.setPhase('takeoff');
        break;
      }
      case 'perch': {
        m.body.vx = m.body.vy = m.body.vz = 0;
        const t = this.nearest(m, players);
        if (t) m.yaw = approachAngle(m.yaw, Math.atan2(-(t.x - m.x), -(t.z - m.z)), 0.1);
        m.headYaw = m.yaw;
        if (t && this.phaseTicks % 80 === 40) {
          // Breathe flames at the ground in front of the dragon, towards the player
          const dx = t.x - m.x;
          const dz = t.z - m.z;
          const dd = Math.hypot(dx, dz) || 1;
          const reach = Math.min(dd, 9);
          this.end.breathCloud(m.dim, m.x + (dx / dd) * reach, py, m.z + (dz / dd) * reach, m);
          this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 4, 0.6);
        }
        if (this.phaseTicks > 260 || this.damageWhilePerched >= 25) this.setPhase('takeoff');
        break;
      }
      case 'takeoff':
        if (this.steer(m, this.nodePos(this.node).x, py + 30, this.nodePos(this.node).z, 0.5, 0.1) < 10 || this.phaseTicks > 100) this.setPhase('hold');
        break;
      case 'dying':
        break;
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
  }

  // ------------------------------------------------------------------ crystals

  crystals(): EndCrystal[] {
    const out: EndCrystal[] = [];
    for (const e of this.dim.entities.values()) if (e instanceof EndCrystal && !e.removed) out.push(e);
    return out;
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
    if (m && !m.dead && this.healer === c) {
      this.healer = null;
      m.hurt(10, { source: 'explosion', attacker: by && isPlayer(by) ? by : null });
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
    for (const p of endPillars(this.server.level.seedNum)) {
      if (this.dim.isLoaded(p.x, p.z)) this.end.spawnCrystal(this.dim, p.x + 0.5, p.height + 2, p.z + 0.5);
    }
    this.spawnDragon();
  }

  // ------------------------------------------------------------------ death

  /** Called by the mob system when the dragon's health reaches zero. */
  onDeath(m: Mob, killer: ServerPlayer | null): void {
    this.phase = 'dying';
    this.phaseTicks = 0;
    m.data.dying = true;
    m.metaDirty = true;
    this.server.playSound(m.dim, 'dragon.death', m.x, m.y, m.z, 6, 1);
    if (killer) this.server.interaction.grant(killer, 'kill_dragon');
    for (const p of this.players()) if (p !== killer) this.server.interaction.grant(p, 'kill_dragon');
    if (this.healer) {
      this.healer.setBeam(null);
      this.healer = null;
    }
  }

  private dying(m: Mob): void {
    this.phaseTicks++;
    const b = m.body;
    b.y += 0.1;
    if (this.phaseTicks % 5 === 0) this.server.particles(m.dim, 'explosion', m.x + (this.rng.next() - 0.5) * 8, m.y + 2 + (this.rng.next() - 0.5) * 4, m.z + (this.rng.next() - 0.5) * 8, 1, 0.5);
    const first = !this.flags.dragonKilledOnce;
    const total = first ? FIRST_KILL_XP : REPEAT_KILL_XP;
    if (this.phaseTicks > 150 && this.phaseTicks % 5 === 0) {
      const share = Math.floor(total * 0.08);
      this.server.mining.dropXp(m.dim, m.x, m.y, m.z, share);
    }
    if (this.phaseTicks === 199) this.finish(m, first, total);
  }

  private finish(m: Mob, first: boolean, total: number): void {
    const dim = this.dim;
    this.server.mining.dropXp(dim, 0.5, this.portalY() + 2, 0.5, Math.floor(total * 0.2));
    const py = this.portalY();
    buildExitPortal((x, y, z, s) => dim.setBlock(x, y, z, s), py, true);
    if (first) dim.setBlock(0, py + 4, 0, S('dragon_egg'));
    // Loot: dragon scales, breath and the corrupted eye that leads to the Far Lands
    const drops = rollLoot('mob/ender_dragon', { rng: this.rng, looting: 0, killedByPlayer: true, onFire: false, difficulty: this.server.level.difficulty });
    drops.push(stackOf('corrupted_eye', 1));
    for (const st of drops) this.server.mining.dropItem(dim, 0.5, py + 5, 0.5, st);
    this.end.spawnGateway(dim);
    this.flags.dragonKilled = true;
    this.flags.dragonKilledOnce = true;
    this.flags.dragonAlive = false;
    delete this.flags.dragonHealth;
    this.clearBars();
    m.remove();
    this.dragon = null;
    this.server.broadcastChat('The Ender Dragon has been defeated!', 'system');
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
