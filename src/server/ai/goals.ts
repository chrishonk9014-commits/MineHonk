/**
 * AI goals. A mob runs, every other tick, the highest priority goals whose
 * flags don't conflict. Target goals choose `mob.target`; behaviour goals
 * move, look and attack.
 */
import type { Mob, Target } from '../entity/Mob';
import { isAlive, isPlayer } from '../entity/Mob';
import type { Entity } from '../entity/Entity';
import { items } from '../../common/registry/items';
import { STATE_FLUID, S, STATE_BLOCK, blocks } from '../../common/registry/blocks';
import { raycastBlocks } from '../../common/physics/raycast';

export type GoalFlag = 'move' | 'look' | 'target' | 'jump';

export interface Goal {
  flags: GoalFlag[];
  canUse(m: Mob): boolean;
  canContinue(m: Mob): boolean;
  start?(m: Mob): void;
  tick?(m: Mob): void;
  stop?(m: Mob): void;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function canSee(m: Mob, t: Entity): boolean {
  const [ex, ey, ez] = m.eyePos();
  const th = (t as { eyeHeight?: number }).eyeHeight ?? 1.5;
  const dx = t.x - ex;
  const dy = t.y + th - ey;
  const dz = t.z - ez;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const hit = raycastBlocks(m.dim, ex, ey, ez, dx, dy, dz, d, { useCollision: true });
  return !hit;
}

export function distSq(a: Entity, b: Entity): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function holding(p: Entity, ids: string[]): boolean {
  if (!isPlayer(p)) return false;
  const s = p.inventory.get(p.selectedSlot);
  if (s && ids.includes(items[s.id]!.id)) return true;
  const o = p.inventory.get(40);
  return !!o && ids.includes(items[o.id]!.id);
}

function players(m: Mob, range: number): Target[] {
  const out: Target[] = [];
  for (const p of m.dim.server.players.values()) {
    if (p.dim !== m.dim || !isAlive(p)) continue;
    if (distSq(m, p) <= range * range) out.push(p);
  }
  return out;
}

function nearest<T extends Entity>(m: Mob, list: T[]): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const e of list) {
    const d = distSq(m, e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// movement goals
// ---------------------------------------------------------------------------
export class FloatGoal implements Goal {
  flags: GoalFlag[] = ['jump'];
  canUse(m: Mob): boolean {
    return m.body.inWater && !m.def.aquatic && m.body.eyesInWater;
  }
  canContinue(m: Mob): boolean {
    return this.canUse(m);
  }
  tick(m: Mob): void {
    m.jumpRequested = true;
    if (m.body.vy < 0.04) m.body.vy += 0.04;
  }
}

export class WanderGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  constructor(
    private readonly speed = 1,
    private readonly chance = 1 / 60,
    private readonly radius = 10,
  ) {}
  canUse(m: Mob): boolean {
    if (m.sitting) return false;
    if (m.rng.next() > this.chance) return false;
    const t = m.pathfinder.randomTarget(m.x, m.y, m.z, this.radius, 4, m.pathOptions(), () => m.rng.next());
    return !!t && m.navigateTo(t.x + 0.5, t.y, t.z + 0.5, this.speed);
  }
  canContinue(m: Mob): boolean {
    return m.navigating;
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class LookAtPlayerGoal implements Goal {
  flags: GoalFlag[] = ['look'];
  private t: Target | null = null;
  private ticks = 0;
  constructor(private readonly range = 8) {}
  canUse(m: Mob): boolean {
    if (m.rng.next() > 0.02) return false;
    this.t = nearest(m, players(m, this.range));
    return !!this.t;
  }
  canContinue(m: Mob): boolean {
    return !!this.t && isAlive(this.t) && this.ticks > 0 && distSq(m, this.t) < this.range * this.range;
  }
  start(m: Mob): void {
    this.ticks = 40 + m.rng.int(40);
  }
  tick(m: Mob): void {
    this.ticks -= 2;
    const t = this.t!;
    m.lookAt = { x: t.x, y: t.y + 1.5, z: t.z };
  }
}

export class LookRandomGoal implements Goal {
  flags: GoalFlag[] = ['look'];
  private ticks = 0;
  private dir = 0;
  canUse(m: Mob): boolean {
    return m.rng.next() < 0.02;
  }
  canContinue(): boolean {
    return this.ticks > 0;
  }
  start(m: Mob): void {
    this.ticks = 20 + m.rng.int(20);
    this.dir = m.rng.next() * Math.PI * 2;
  }
  tick(m: Mob): void {
    this.ticks -= 2;
    m.lookAt = { x: m.x - Math.sin(this.dir) * 4, y: m.y + m.eyeHeight, z: m.z - Math.cos(this.dir) * 4 };
  }
}

export class PanicGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  constructor(private readonly speed = 1.8) {}
  canUse(m: Mob): boolean {
    // Hurt, burning, or alarmed by a ringing bell
    if (m.dim.server.tickNo - m.lastHurtTick > 100 && m.fireTicks <= 0 && !m.data.alarmTicks) return false;
    const t = m.pathfinder.randomTarget(m.x, m.y, m.z, 6, 3, m.pathOptions(), () => m.rng.next());
    return !!t && m.navigateTo(t.x + 0.5, t.y, t.z + 0.5, this.speed);
  }
  canContinue(m: Mob): boolean {
    return m.navigating;
  }
}

export class TemptGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private p: Target | null = null;
  constructor(
    private readonly itemsList: string[],
    private readonly speed = 1.1,
  ) {}
  canUse(m: Mob): boolean {
    if (!this.itemsList.length) return false;
    this.p = nearest(
      m,
      players(m, 10).filter((p) => holding(p, this.itemsList)),
    );
    return !!this.p;
  }
  canContinue(m: Mob): boolean {
    return !!this.p && isAlive(this.p) && holding(this.p, this.itemsList) && distSq(m, this.p) < 144;
  }
  tick(m: Mob): void {
    const p = this.p!;
    m.lookAt = { x: p.x, y: p.y + 1.5, z: p.z };
    if (distSq(m, p) > 6) m.navigateTo(p.x, p.y, p.z, this.speed);
    else m.stopNavigation();
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class BreedGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private partner: Mob | null = null;
  private ticks = 0;
  canUse(m: Mob): boolean {
    if (m.loveTicks <= 0 || m.baby) return false;
    this.partner = null;
    for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 8)) {
      const o = e as Mob;
      if (o !== m && o.type === m.type && o.loveTicks > 0 && !o.baby && !o.dead) {
        this.partner = o;
        break;
      }
    }
    return !!this.partner;
  }
  canContinue(m: Mob): boolean {
    return !!this.partner && !this.partner.dead && this.partner.loveTicks > 0 && m.loveTicks > 0 && this.ticks < 120;
  }
  start(): void {
    this.ticks = 0;
  }
  tick(m: Mob): void {
    const p = this.partner!;
    this.ticks += 2;
    m.lookAt = { x: p.x, y: p.y + 0.5, z: p.z };
    m.navigateTo(p.x, p.y, p.z, 1);
    if (distSq(m, p) < 4 && this.ticks >= 60) {
      m.dim.server.mobs!.breed(m, p);
    }
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class FollowParentGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  private parent: Mob | null = null;
  canUse(m: Mob): boolean {
    if (!m.baby || m.rng.next() > 0.05) return false;
    let best: Mob | null = null;
    let bd = 64;
    for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 8)) {
      const o = e as Mob;
      if (o.type === m.type && !o.baby && !o.dead) {
        const d = distSq(m, o);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
    }
    this.parent = best;
    return !!best && bd > 9;
  }
  canContinue(m: Mob): boolean {
    return !!this.parent && !this.parent.dead && distSq(m, this.parent) > 9 && distSq(m, this.parent) < 256;
  }
  tick(m: Mob): void {
    const p = this.parent!;
    m.navigateTo(p.x, p.y, p.z, 1.1);
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class AvoidGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  private from: Entity | null = null;
  constructor(
    private readonly pred: (e: Entity) => boolean,
    private readonly dist = 8,
    private readonly speed = 1.4,
  ) {}
  canUse(m: Mob): boolean {
    const near = m.dim.entitiesNear(m.x, m.y, m.z, this.dist, (e) => e !== m && this.pred(e) && isAlive(e));
    const all = near.concat(players(m, this.dist).filter((p) => this.pred(p)));
    this.from = nearest(m, all);
    if (!this.from) return false;
    const dx = m.x - this.from.x;
    const dz = m.z - this.from.z;
    const d = Math.hypot(dx, dz) || 1;
    return m.navigateTo(m.x + (dx / d) * 8, m.y, m.z + (dz / d) * 8, this.speed);
  }
  canContinue(m: Mob): boolean {
    return m.navigating && !!this.from && distSq(m, this.from) < (this.dist + 4) ** 2;
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

/** Undead look for shade while burning in the sun. */
export class FleeSunGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  canUse(m: Mob): boolean {
    if (m.fireTicks <= 0 || !m.isDaytime() || m.target) return false;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(m.x + m.rng.int(20) - 10);
      const z = Math.floor(m.z + m.rng.int(20) - 10);
      const y = Math.floor(m.y + m.rng.int(6) - 3);
      if (y + 1 < m.dim.getHeight(x, z)) return m.navigateTo(x + 0.5, y, z + 0.5, 1.2);
    }
    return false;
  }
  canContinue(m: Mob): boolean {
    return m.navigating;
  }
}

export class FlyWanderGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  constructor(
    private readonly radius = 12,
    private readonly minY = 0,
    private readonly maxAboveGround = 20,
  ) {}
  canUse(m: Mob): boolean {
    return !m.sitting && !m.wantPos && m.rng.next() < 0.1;
  }
  canContinue(m: Mob): boolean {
    return !!m.wantPos && !m.sitting;
  }
  start(m: Mob): void {
    const x = m.x + (m.rng.next() * 2 - 1) * this.radius;
    const z = m.z + (m.rng.next() * 2 - 1) * this.radius;
    const ground = m.dim.getHeight(Math.floor(x), Math.floor(z));
    let y = m.y + (m.rng.next() * 2 - 1) * 6;
    y = Math.max(ground + 2 + this.minY, Math.min(ground + this.maxAboveGround, y));
    if (m.def.id === 'bat') y = Math.min(y, m.y + 3);
    // Parrots flit between the treetops and the ground
    if (m.def.id === 'parrot') y = Math.min(y, ground + 1 + m.rng.next() * 5);
    m.wantPos = { x, y, z, speed: 1 };
  }
}

export class SwimWanderGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  canUse(m: Mob): boolean {
    return m.body.inWater && !m.wantPos && m.rng.next() < 0.1;
  }
  canContinue(m: Mob): boolean {
    return !!m.wantPos && m.body.inWater;
  }
  start(m: Mob): void {
    for (let i = 0; i < 8; i++) {
      const x = m.x + (m.rng.next() * 2 - 1) * 8;
      const y = m.y + (m.rng.next() * 2 - 1) * 3;
      const z = m.z + (m.rng.next() * 2 - 1) * 8;
      if (STATE_FLUID[m.dim.getState(Math.floor(x), Math.floor(y), Math.floor(z))] === 1) {
        m.wantPos = { x, y, z, speed: 1 };
        return;
      }
    }
  }
}

export class EatGrassGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private ticks = 0;
  canUse(m: Mob): boolean {
    if (m.rng.next() > (m.baby ? 1 / 50 : 1 / 500)) return false;
    const below = m.dim.getState(Math.floor(m.x), Math.floor(m.y - 0.5), Math.floor(m.z));
    const at = m.dim.getState(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z));
    const id = blocks[STATE_BLOCK[at]!]!.id;
    return below === S('grass_block') || id === 'short_grass';
  }
  canContinue(): boolean {
    return this.ticks > 0;
  }
  start(m: Mob): void {
    this.ticks = 40;
    m.stopNavigation();
    m.dim.server.broadcastNear(m.dim, m.x, m.y, m.z, 32, { t: 'anim', id: m.id, anim: 'eat' });
  }
  tick(m: Mob): void {
    this.ticks -= 2;
    if (this.ticks !== 4) return;
    const x = Math.floor(m.x);
    const z = Math.floor(m.z);
    const y = Math.floor(m.y);
    const at = m.dim.getState(x, y, z);
    if (blocks[STATE_BLOCK[at]!]!.id === 'short_grass') m.dim.setBlock(x, y, z, 0);
    else if (m.dim.getState(x, y - 1, z) === S('grass_block') && m.dim.server.level.rules.mobGriefing) m.dim.setBlock(x, y - 1, z, S('dirt'));
    else return;
    if (m.data.sheared) {
      m.data.sheared = undefined;
      m.metaDirty = true;
    }
    if (m.baby) m.growTicks += 1200;
  }
}

// ---------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------
export class MeleeAttackGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private repath = 0;
  constructor(
    private readonly speed = 1.2,
    private readonly reachExtra = 0,
  ) {}
  canUse(m: Mob): boolean {
    return !!m.target && isAlive(m.target);
  }
  canContinue(m: Mob): boolean {
    return !!m.target && isAlive(m.target) && distSq(m, m.target) < (m.def.followRange ?? 32) ** 2;
  }
  start(): void {
    this.repath = 0;
  }
  tick(m: Mob): void {
    const t = m.target!;
    m.lookAt = { x: t.x, y: t.y + 1, z: t.z };
    const d2 = distSq(m, t);
    if (--this.repath <= 0 || !m.navigating) {
      this.repath = d2 > 256 ? 8 : 3;
      if (!m.navigateTo(t.x, t.y, t.z, this.speed) && d2 < 9) m.wantPos = { x: t.x, y: t.y, z: t.z, speed: this.speed };
    }
    const reach = m.def.width * 2 * 0.5 + 0.6 + (t as Entity & { body: { width: number } }).body.width * 0.5 + 0.4 + this.reachExtra;
    if (d2 <= reach * reach && Math.abs(t.y - m.y) < 2.5 && m.attackCooldown <= 0) {
      m.attackCooldown = 20;
      m.dim.server.mobs!.meleeAttack(m, t);
    }
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export type RangedKind = 'arrow' | 'crossbow' | 'fireball' | 'small_fireball' | 'potion' | 'shulker_bullet' | 'rift_bolt' | 'llama_spit';

export class RangedAttackGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private seen = 0;
  private cooldown = 0;
  private strafe = 0;
  constructor(
    private readonly kind: RangedKind,
    private readonly interval = 40,
    private readonly range = 15,
    private readonly speed = 1,
  ) {}
  canUse(m: Mob): boolean {
    return !!m.target && isAlive(m.target);
  }
  canContinue(m: Mob): boolean {
    return this.canUse(m) && distSq(m, m.target!) < (m.def.followRange ?? 40) ** 2;
  }
  start(): void {
    this.cooldown = this.interval / 2;
  }
  tick(m: Mob): void {
    const t = m.target!;
    const d2 = distSq(m, t);
    const sees = canSee(m, t);
    this.seen = sees ? this.seen + 2 : 0;
    m.lookAt = { x: t.x, y: t.y + 1.2, z: t.z };
    if (m.def.flying) {
      // hover at a distance around the target
      if (!m.wantPos || m.rng.next() < 0.05) {
        const ang = m.rng.next() * Math.PI * 2;
        const r = Math.min(this.range * 0.7, 10);
        m.wantPos = { x: t.x + Math.cos(ang) * r, y: t.y + 3 + m.rng.next() * 4, z: t.z + Math.sin(ang) * r, speed: 1 };
      }
    } else if (m.def.speed > 0) {
      if (d2 > this.range * this.range * 0.6 || !sees) m.navigateTo(t.x, t.y, t.z, this.speed);
      else {
        m.stopNavigation();
        // strafe a little like archers do
        if (--this.strafe <= 0) this.strafe = 20 + m.rng.int(30);
        const side = this.strafe > 25 ? 1 : -1;
        const ang = Math.atan2(t.x - m.x, t.z - m.z) + (Math.PI / 2) * side;
        if (d2 < 16) m.wantPos = { x: m.x - (t.x - m.x) * 0.5, y: m.y, z: m.z - (t.z - m.z) * 0.5, speed: this.speed };
        else if (m.rng.next() < 0.3) m.wantPos = { x: m.x + Math.sin(ang) * 1.5, y: m.y, z: m.z + Math.cos(ang) * 1.5, speed: 0.6 };
      }
    }
    if (--this.cooldown <= 0 && this.seen >= 10 && d2 <= this.range * this.range) {
      this.cooldown = this.interval + m.rng.int(Math.ceil(this.interval / 2));
      m.dim.server.mobs!.rangedAttack(m, t, this.kind);
    }
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class CreeperSwellGoal implements Goal {
  flags: GoalFlag[] = ['move'];
  canUse(m: Mob): boolean {
    return (!!m.target && isAlive(m.target) && distSq(m, m.target) < 9) || m.fuse > 0;
  }
  canContinue(m: Mob): boolean {
    return m.fuse >= 0;
  }
  start(m: Mob): void {
    m.stopNavigation();
    m.fuse = 0;
    m.dim.server.playSound(m.dim, 'fizz', m.x, m.y + 1, m.z, 1, 0.5);
  }
  tick(m: Mob): void {
    const t = m.target;
    if (!t || !isAlive(t) || distSq(m, t) > 49 || !canSee(m, t)) {
      m.fuse = Math.max(-1, m.fuse - 2);
      if (m.fuse < 0) m.fuse = -1;
      m.metaDirty = true;
      return;
    }
    m.fuse += 2;
    m.metaDirty = true;
    if (m.fuse >= 30) {
      m.fuse = -1;
      m.dim.server.mobs!.creeperExplode(m);
    }
  }
  stop(m: Mob): void {
    if (!m.dead) {
      m.fuse = -1;
      m.metaDirty = true;
    }
  }
}

/** Short-range blink teleports (endermen when hurt, rift walkers towards prey). */
export class TeleportGoal implements Goal {
  flags: GoalFlag[] = [];
  constructor(private readonly behindTarget: boolean) {}
  canUse(m: Mob): boolean {
    if (this.behindTarget) return !!m.target && isAlive(m.target) && m.rng.next() < 0.02 && distSq(m, m.target) > 16;
    const wet = m.body.inWater || (m.dim.server.interaction.weather.raining && m.dim.rules.hasSky && m.y >= m.dim.getHeight(Math.floor(m.x), Math.floor(m.z)));
    return wet || (m.dim.server.tickNo - m.lastHurtTick < 4 && m.rng.next() < 0.5) || m.rng.next() < 0.002;
  }
  canContinue(): boolean {
    return false;
  }
  start(m: Mob): void {
    m.dim.server.mobs!.teleportMob(m, this.behindTarget ? m.target : null);
  }
}

/** Hands every decision to the Warden system (it hears and smells rather than sees). */
export class WardenGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look', 'target'];
  canUse(): boolean {
    return true;
  }
  canContinue(): boolean {
    return true;
  }
  tick(m: Mob): void {
    m.dim.server.warden?.think(m);
  }
}

export class FollowOwnerGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private owner: Target | null = null;
  canUse(m: Mob): boolean {
    if (!m.owner || m.sitting) return false;
    for (const p of m.dim.server.players.values()) if (p.uuid === m.owner && p.dim === m.dim && !p.dead) this.owner = p;
    return !!this.owner && distSq(m, this.owner) > 100;
  }
  canContinue(m: Mob): boolean {
    return !!this.owner && !m.sitting && distSq(m, this.owner) > 9;
  }
  tick(m: Mob): void {
    const o = this.owner!;
    if (distSq(m, o) > 144) {
      // Too far: teleport next to the owner
      m.setPos(o.x + m.rng.next() * 2 - 1, o.y, o.z + m.rng.next() * 2 - 1);
      m.stopNavigation();
      return;
    }
    m.navigateTo(o.x, o.y, o.z, 1.3);
  }
  stop(m: Mob): void {
    m.stopNavigation();
  }
}

export class SlimeHopGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private delay = 0;
  canUse(): boolean {
    return true;
  }
  canContinue(): boolean {
    return true;
  }
  tick(m: Mob): void {
    const t = m.target && isAlive(m.target) ? m.target : null;
    if (t) m.lookAt = { x: t.x, y: t.y, z: t.z };
    if (!m.body.onGround) return;
    if (--this.delay > 0) return;
    this.delay = t ? 5 + m.rng.int(10) : 10 + m.rng.int(30);
    const ang = t ? Math.atan2(-(t.x - m.x), -(t.z - m.z)) : m.rng.next() * Math.PI * 2;
    m.yaw = ang;
    const size = Number(m.data.size ?? 2);
    const v = 0.1 + size * 0.03;
    m.body.vx = -Math.sin(ang) * v * (t ? 1.4 : 1);
    m.body.vz = -Math.cos(ang) * v * (t ? 1.4 : 1);
    m.body.vy = 0.42;
    m.dim.server.playSound(m.dim, 'mob.slime.idle', m.x, m.y, m.z, 0.4, 1.4 - size * 0.15);
    if (t && distSq(m, t) < (size * 0.6 + 1) ** 2 && m.attackCooldown <= 0 && size > 1) {
      m.attackCooldown = 20;
      m.dim.server.mobs!.meleeAttack(m, t);
    }
  }
}

// ---------------------------------------------------------------------------
// targeting
// ---------------------------------------------------------------------------
export class HurtByTargetGoal implements Goal {
  flags: GoalFlag[] = ['target'];
  constructor(private readonly alertSameType = false) {}
  canUse(m: Mob): boolean {
    const r = m.revengeTarget;
    if (!r || !isAlive(r) || r === m.target) return false;
    if (isPlayer(r) && m.owner === r.uuid) return false;
    return true;
  }
  canContinue(m: Mob): boolean {
    return !!m.target && isAlive(m.target) && distSq(m, m.target) < 48 * 48;
  }
  start(m: Mob): void {
    m.target = m.revengeTarget;
    m.metaDirty = true;
    if (this.alertSameType) {
      for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 16)) {
        const o = e as Mob;
        if (o !== m && o.type === m.type && !o.dead) {
          o.revengeTarget = m.revengeTarget;
          o.revengeTicks = 200;
        }
      }
    }
  }
  stop(m: Mob): void {
    m.target = null;
    m.metaDirty = true;
  }
}

export class NearestTargetGoal implements Goal {
  flags: GoalFlag[] = ['target'];
  constructor(
    private readonly pick: (m: Mob) => Target | null,
    private readonly mustSee = true,
    private readonly chance = 0.1,
  ) {}
  canUse(m: Mob): boolean {
    if (m.rng.next() > this.chance) return false;
    if (m.dim.server.level.difficulty === 'peaceful' && m.def.category === 'monster') return false;
    const t = this.pick(m);
    if (!t || (this.mustSee && !canSee(m, t))) return false;
    m.target = t;
    m.metaDirty = true;
    return true;
  }
  canContinue(m: Mob): boolean {
    const t = m.target;
    if (!t || !isAlive(t)) return false;
    if (m.dim.server.level.difficulty === 'peaceful' && m.def.category === 'monster') return false;
    return distSq(m, t) < ((m.def.followRange ?? 32) + 4) ** 2;
  }
  stop(m: Mob): void {
    m.target = null;
    m.metaDirty = true;
  }
}

export function nearestPlayerTarget(range: number, pred?: (m: Mob, p: Target) => boolean): (m: Mob) => Target | null {
  return (m) => nearest(m, players(m, range).filter((p) => !pred || pred(m, p)));
}

export function nearestEntityTarget(range: number, pred: (e: Entity) => boolean): (m: Mob) => Target | null {
  return (m) => nearest(m, m.dim.entitiesNear(m.x, m.y, m.z, range, (e) => e !== m && pred(e) && isAlive(e)) as Target[]);
}

/** Endermen become hostile towards players that stare at their head. */
export function staringPlayer(m: Mob): Target | null {
  for (const p of players(m, 48)) {
    if (!isPlayer(p)) continue;
    const helmet = p.inventory.get(39);
    if (helmet && items[helmet.id]!.id === 'carved_pumpkin') continue;
    const ex = p.x;
    const ey = p.y + p.eyeHeight;
    const ez = p.z;
    const cp = Math.cos(p.pitch);
    const lx = -Math.sin(p.yaw) * cp;
    const ly = -Math.sin(p.pitch);
    const lz = -Math.cos(p.yaw) * cp;
    const tx = m.x - ex;
    const ty = m.y + m.eyeHeight - ey;
    const tz = m.z - ez;
    const d = Math.hypot(tx, ty, tz);
    const dot = (lx * tx + ly * ty + lz * tz) / d;
    if (dot > 1 - 0.025 / d && canSee(m, p)) return p;
  }
  return null;
}
