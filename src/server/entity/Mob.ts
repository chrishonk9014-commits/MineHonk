/**
 * Server-side mob: a living entity driven by a goal-based brain. Movement
 * uses the shared player physics with synthetic input (ground mobs), or a
 * simple velocity model for flyers and swimmers.
 */
import { ECLIPSE } from '../../common/endExpansion/events';
import { LivingEntity, type HurtInfo } from './Living';
import type { Entity } from './Entity';
import type { MobDef } from '../../common/data/mobs';
import { mobDef } from '../../common/data/mobs';
import { stepMovement, updateEnvironment, moveBody, bodyObstructed } from '../../common/physics/movement';
import { STATE_FLUID, STATE_OPAQUE, STATE_BLOCK, blocks } from '../../common/registry/blocks';
import { Random } from '../../common/math/rng';
import { type ItemStack, stackOf } from '../../common/game/itemstack';
import { itemById, items } from '../../common/registry/items';
import type { EntitySpawn } from '../../common/net/protocol';
import { Pathfinder, type PathNode, type PathOptions } from '../ai/Pathfinder';
import type { Goal } from '../ai/goals';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { collisionShape } from '../../common/physics/shapes';
import { isConstruct } from '../../common/endExpansion/structures';
import { isExpansionMob } from '../../common/endExpansion/mobs';

export type Target = LivingEntity | ServerPlayer;

export function isPlayer(e: Entity | null | undefined): e is ServerPlayer {
  return !!e && e.type === 'player';
}

export function isAlive(e: Entity | null | undefined): boolean {
  if (!e || e.removed) return false;
  if (isPlayer(e)) return !e.dead && e.gamemode !== 'spectator' && e.gamemode !== 'creative';
  return !(e as LivingEntity).dead;
}

export class Mob extends LivingEntity {
  readonly type: string;
  readonly def: MobDef;
  readonly rng = new Random();
  goals: { priority: number; goal: Goal; running: boolean }[] = [];
  targetGoals: { priority: number; goal: Goal; running: boolean }[] = [];
  target: Target | null = null;
  /** Mob that last hurt us (for retaliation). */
  revengeTarget: Target | null = null;
  revengeTicks = 0;

  // Navigation
  path: PathNode[] | null = null;
  pathIndex = 0;
  pathTarget: { x: number; y: number; z: number } | null = null;
  pathAge = 0;
  moveSpeed = 1;
  /** Direct movement request (bypasses pathing), used by flyers and short hops. */
  wantPos: { x: number; y: number; z: number; speed: number } | null = null;
  lookAt: { x: number; y: number; z: number } | null = null;
  jumpRequested = false;
  stuckTicks = 0;

  // State
  held: ItemStack | null = null;
  baby = false;
  growTicks = 0;
  loveTicks = 0;
  breedCooldown = 0;
  owner: string | null = null;
  sitting = false;
  angryAt: string | null = null;
  angerTicks = 0;
  attackCooldown = 0;
  fuse = -1;
  data: Record<string, unknown> = {};
  noAi = false;
  /** Movement and environment are driven externally (the Ender Dragon's fight controller). */
  controlled = false;
  /** Player riding this mob, and whether their client steers it (AI and physics pause). */
  rider: Entity | null = null;
  riderControl = false;
  /** Entity id of the player holding this mob's lead (for clients drawing it). */
  metaHolder = 0;
  /** Ticks the corpse stays before removal. */
  deathDuration = 20;
  persistenceRequired = false;
  despawnTicks = 0;
  airTicks = 300;
  lastHurtTick = -100;
  invulnerableTicks = 0;
  idleTimer = 0;
  private prevY = 0;

  static pathfinders = new WeakMap<object, Pathfinder>();

  constructor(type: string) {
    const def = mobDef(type);
    if (!def) throw new Error(`Unknown mob ${type}`);
    super(def.width, def.height, def.health);
    this.type = type;
    this.def = def;
    this.armor = def.armor ?? 0;
    this.persistent = true;
    this.body.stepHeight = def.flying || def.aquatic ? 0 : 0.6;
    this.idleTimer = this.rng.int(def.idleInterval ?? 120);
  }

  get eyeHeight(): number {
    return (this.def.eye ?? this.def.height * 0.85) * (this.baby ? 0.5 : 1);
  }

  get pathfinder(): Pathfinder {
    let pf = Mob.pathfinders.get(this.dim);
    if (!pf) {
      pf = new Pathfinder(this.dim);
      Mob.pathfinders.set(this.dim, pf);
    }
    return pf;
  }

  pathOptions(): PathOptions {
    return { height: this.def.height * (this.baby ? 0.5 : 1), maxFall: this.def.id === 'cat' ? 6 : 3, canSwim: true, aquatic: this.def.aquatic && this.def.brain !== 'zombie', avoidWater: this.def.burnsInDay === false, canOpenDoors: this.def.brain === 'villager' };
  }

  // ------------------------------------------------------------------ goals
  addGoal(priority: number, goal: Goal): void {
    this.goals.push({ priority, goal, running: false });
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  addTargetGoal(priority: number, goal: Goal): void {
    this.targetGoals.push({ priority, goal, running: false });
    this.targetGoals.sort((a, b) => a.priority - b.priority);
  }

  private runGoals(list: { priority: number; goal: Goal; running: boolean }[]): void {
    // Lower priority numbers pre-empt higher ones that share a flag
    const busy = new Set<string>();
    for (const g of list) {
      const flags = g.goal.flags;
      const blocked = flags.some((f) => busy.has(f));
      if (g.running) {
        if (blocked || !g.goal.canContinue(this)) {
          g.goal.stop?.(this);
          g.running = false;
        }
      }
      if (!g.running && !blocked && g.goal.canUse(this)) {
        g.running = true;
        g.goal.start?.(this);
      }
      if (g.running) {
        for (const f of flags) busy.add(f);
        g.goal.tick?.(this);
      }
    }
  }

  // ------------------------------------------------------------------ navigation
  navigateTo(x: number, y: number, z: number, speed = 1): boolean {
    const bx = Math.floor(this.x);
    const by = Math.floor(this.y + 0.01);
    const bz = Math.floor(this.z);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const tz = Math.floor(z);
    this.moveSpeed = speed;
    this.wantPos = null;
    if (this.pathTarget && this.path && Math.abs(this.pathTarget.x - tx) + Math.abs(this.pathTarget.y - ty) + Math.abs(this.pathTarget.z - tz) < 2 && this.pathAge < 40) return true;
    const p = this.pathfinder.find(bx, by, bz, tx, ty, tz, this.pathOptions(), 1.2);
    this.path = p;
    this.pathIndex = 0;
    this.pathAge = 0;
    this.pathTarget = { x: tx, y: ty, z: tz };
    return !!p && p.length > 0;
  }

  stopNavigation(): void {
    this.path = null;
    this.pathTarget = null;
    this.wantPos = null;
  }

  /** No target and no player within AI range (refreshed once a second). */
  private far = false;

  private playerWithin(r: number): boolean {
    for (const p of this.dim.server.players.values()) if (p.dim === this.dim && (p.x - this.x) ** 2 + (p.z - this.z) ** 2 < r * r) return true;
    return false;
  }

  /** Standing still on the ground with nothing to do: physics can wait. */
  private resting(): boolean {
    const b = this.body;
    return b.onGround && !b.inWater && !b.inLava && !this.navigating && !this.target && Math.abs(b.vx) + Math.abs(b.vz) < 0.003 && Math.abs(b.vy) < 0.1 && this.hurtTime === 0;
  }

  get navigating(): boolean {
    return (!!this.path && this.pathIndex < this.path.length) || !!this.wantPos;
  }

  // ------------------------------------------------------------------ tick
  override tick(): void {
    super.tick();
    const b = this.body;
    this.prevY = b.y;
    if (this.dead) {
      this.deathTime++;
      if (this.deathTime >= this.deathDuration) this.remove();
      return;
    }
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTicks > 0) this.invulnerableTicks--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.revengeTicks > 0 && --this.revengeTicks === 0) this.revengeTarget = null;
    if (this.angerTicks > 0 && --this.angerTicks === 0) this.angryAt = null;
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (this.loveTicks % 10 === 0) this.dim.server.particles(this.dim, 'heart', this.x, this.y + this.def.height, this.z, 1, 0.3);
    }
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.baby && ++this.growTicks >= 24000) {
      this.baby = false;
      this.metaDirty = true;
      // A turtle sheds its scute as it grows up
      if (this.type === 'turtle') this.dim.server.mining.dropItem(this.dim, this.x, this.y + 0.3, this.z, stackOf('scute', 1));
    }
    if (!this.controlled) this.environment();
    if (this.dead || this.removed) return;
    // Mobs far from every player think less often and skip physics while idle
    if (this.age % 20 === 0 || this.age < 2) this.far = !this.target && this.def.category !== 'boss' && !this.playerWithin(Math.max(AI_NEAR, (this.def.followRange ?? 16) + 16));
    if (!this.noAi && !this.riderControl && this.age % (this.far ? 8 : 2) === 0) {
      this.runGoals(this.targetGoals);
      this.runGoals(this.goals);
    }
    if (!this.controlled && !this.riderControl && (!this.far || !this.resting() || this.age % 10 === 0)) this.move();
    this.idleSound();
  }

  private idleSound(): void {
    const iv = this.def.idleInterval ?? 120;
    if (--this.idleTimer > 0) return;
    this.idleTimer = iv + this.rng.int(iv);
    if (this.def.category === 'boss') return;
    this.dim.server.playSound(this.dim, `mob.${this.soundKey()}.idle`, this.x, this.y + this.def.height * 0.8, this.z, this.def.category === 'monster' ? 1 : 0.6, this.baby ? 1.5 : 0.9 + this.rng.next() * 0.2);
  }

  soundKey(): string {
    if (this.type === 'glitched_cow') return 'cow';
    if (this.type === 'glitched_sheep') return 'sheep';
    if (this.type === 'glitch_zombie') return 'zombie';
    if (this.type === 'glitch_skeleton') return 'skeleton';
    return this.type;
  }

  /** Fire, drowning, sunlight, lava, suffocation, void and fall damage. */
  private environment(): void {
    const b = this.body;
    updateEnvironment(this.dim, b, this.eyeHeight);
    const server = this.dim.server;
    if (b.y < -64) {
      this.hurt(1000, { source: 'void', attacker: null });
      return;
    }
    // Fire
    if (b.inLava && !this.def.fireImmune) {
      this.fireTicks = Math.max(this.fireTicks, 300);
      if (this.age % 10 === 0) this.hurt(4, { source: 'lava', attacker: null });
    }
    if (b.inWater) this.fireTicks = 0;
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.def.fireImmune) this.fireTicks = 0;
      else if (this.fireTicks % 20 === 0) this.hurt(1, { source: 'fire', attacker: null });
      if (this.fireTicks === 0 || this.fireTicks % 20 === 19) this.metaDirty = true;
    }
    // Sunlight burning for undead
    if (this.def.burnsInDay && this.age % 20 === 0 && !this.baby && this.dim.rules.hasSky && this.isDaytime() && !b.inWater) {
      const bx = Math.floor(this.x);
      const by = Math.floor(this.y + this.eyeHeight);
      const bz = Math.floor(this.z);
      if (by >= this.dim.getHeight(bx, bz) && (this.dim.getLight(bx, by, bz) >> 4) >= 15 && !server.interaction.weather.raining) this.fireTicks = Math.max(this.fireTicks, 160);
    }
    // Breathing
    if (this.def.aquatic && this.def.brain !== 'zombie') {
      if (!b.inWater) {
        if (--this.airTicks < -20) {
          this.airTicks = 0;
          this.hurt(2, { source: 'drown', attacker: null });
        }
      } else this.airTicks = 300;
    } else if (b.eyesInWater && this.def.brain !== 'zombie' && !this.def.undead && !this.def.amphibious) {
      if (--this.airTicks < -20) {
        this.airTicks = 0;
        this.hurt(2, { source: 'drown', attacker: null });
      }
    } else this.airTicks = 300;
    // Suffocation
    if (this.age % 10 === 0 && !this.def.flying) {
      const s = this.dim.getState(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z));
      if (STATE_OPAQUE[s] && bodyObstructed(this.dim, b, 0.1)) this.hurt(1, { source: 'suffocate', attacker: null });
    }
    // Damaging blocks underfoot / inside
    if (this.age % 10 === 0) {
      const inside = this.dim.getState(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
      const id = blocks[STATE_BLOCK[inside]!]!.id;
      if ((id === 'fire' || id === 'soul_fire') && !this.def.fireImmune) this.fireTicks = Math.max(this.fireTicks, 160);
      if (id === 'sweet_berry_bush' && this.def.category !== 'creature') this.hurt(1, { source: 'berry_bush', attacker: null });
      const under = this.dim.getState(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
      if (blocks[STATE_BLOCK[under]!]!.id === 'magma_block' && !this.def.fireImmune) this.hurt(1, { source: 'magma', attacker: null });
    }
  }

  isDaytime(): boolean {
    const t = this.dim.server.level.dayTime % 24000;
    return t < 12300 || t > 23850;
  }

  private move(): void {
    const b = this.body;
    const def = this.def;
    if (def.speed === 0) {
      // Stationary (shulker): gravity only
      moveBody(this.dim, b, 0, Math.min(0, b.vy), 0);
      return;
    }
    // Waypoint following
    let tx: number | null = null;
    let tz = 0;
    let ty = 0;
    let speed = this.moveSpeed;
    if (this.wantPos) {
      tx = this.wantPos.x;
      ty = this.wantPos.y;
      tz = this.wantPos.z;
      speed = this.wantPos.speed;
      if ((tx - this.x) ** 2 + (tz - this.z) ** 2 + (def.flying || def.aquatic || (def.amphibious && b.inWater) ? (ty - this.y) ** 2 : 0) < 0.3) this.wantPos = null;
    } else if (this.path && this.pathIndex < this.path.length) {
      this.pathAge++;
      const n = this.path[this.pathIndex]!;
      tx = n.x + 0.5;
      ty = n.y;
      tz = n.z + 0.5;
      const dh = (tx - this.x) ** 2 + (tz - this.z) ** 2;
      if (dh < (def.width > 1 ? 0.6 : 0.25) && Math.abs(this.y - ty) < 1.2) {
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) this.path = null;
      }
    }
    if (def.flying || ((def.aquatic || def.amphibious) && b.inWater && def.brain !== 'zombie')) {
      this.flyMove(tx, ty, tz, speed);
      return;
    }
    let forward = 0;
    let jump = this.jumpRequested;
    this.jumpRequested = false;
    if (tx !== null) {
      const dx = tx - this.x;
      const dz = tz - this.z;
      const want = Math.atan2(-dx, -dz);
      this.yaw = approachAngle(this.yaw, want, 0.6);
      this.headYaw = this.yaw;
      forward = Math.min(1, Math.hypot(dx, dz) * 2);
      if (b.collidedH && b.onGround) jump = true;
      if (ty > this.y + 0.5 && b.onGround && Math.hypot(dx, dz) < 1.5) jump = true;
      if (b.inWater && ty >= this.y - 0.2) jump = true;
      // Stuck detection: give up the path after a while
      if (Math.hypot(b.vx, b.vz) < 0.005 && forward > 0) {
        if (++this.stuckTicks > 60) {
          this.stopNavigation();
          this.stuckTicks = 0;
        }
      } else this.stuckTicks = 0;
    }
    if (this.lookAt) {
      const dx = this.lookAt.x - this.x;
      const dz = this.lookAt.z - this.z;
      const dy = this.lookAt.y - (this.y + this.eyeHeight);
      this.headYaw = Math.atan2(-dx, -dz);
      this.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      if (tx === null) this.yaw = approachAngle(this.yaw, this.headYaw, 0.3);
      this.lookAt = null;
    }
    // V6: mobs that treat void edges as walls stop short of them, on the ground and in their own jumps
    // (not when thrown by a hit, nor going over on purpose: a void slip or a leap that was checked);
    // a path that keeps pushing at the edge is given up like any stuck path
    const guard = !!def.edgeGuard && (b.onGround || this.dim.server.tickNo - this.lastHurtTick > 20) && !this.data.slipping && this.data.leapUntil === undefined;
    if (guard && this.edgeAhead(forward)) forward = 0;
    const fromX = b.x;
    const fromY = b.y;
    const fromZ = b.z;
    const fromGround = b.onGround;
    const fromFall = b.fallDistance;
    const supported = guard && !this.footprintOverVoid();
    const slow = this.effectSlow();
    const res = stepMovement(this.dim, b, { forward, strafe: 0, jump, sneak: false, sprint: false, yaw: this.yaw }, { flying: false, noClip: false, walkSpeed: def.speed * speed * (this.baby && def.brain === 'zombie' ? 1.5 : 1) * slow, flySpeed: 0 }, this.eyeHeight);
    void res;
    // ...and never takes a step that leaves nothing at all under its feet
    if (supported && this.footprintOverVoid()) {
      const dy = b.y - fromY;
      this.setPos(fromX, fromY, fromZ);
      b.onGround = fromGround;
      b.fallDistance = fromFall;
      b.vx = 0;
      b.vz = 0;
      if (fromGround) b.vy = 0;
      else {
        // In the air: only the sideways part is undone. It keeps falling where it was, over ground,
        // rather than hanging at the edge while its fall adds up
        moveBody(this.dim, b, 0, dy, 0);
        if (!b.onGround && b.y < fromY) b.fallDistance += fromY - b.y;
      }
    }
    // Spider climbing
    if (def.brain === 'spider' && b.collidedH) b.vy = 0.2;
    // Fall damage
    if (b.onGround) {
      if (b.fallDistance > 3 && !def.flying && def.brain !== 'cat') this.hurt(Math.ceil(b.fallDistance - 3), { source: 'fall', attacker: null });
      b.fallDistance = 0;
    }
    if (def.brain === 'chicken' && !b.onGround && b.vy < 0) {
      b.vy *= 0.6;
      b.fallDistance = 0;
    }
  }

  /**
   * Whether walking on (or the way it is already sliding) would take the mob
   * over a void edge: a column with no ground within a few blocks below its
   * feet. Stops the slide as well.
   */
  private edgeAhead(forward: number): boolean {
    const b = this.body;
    const reach = this.def.width / 2 + 0.45;
    if (forward > 0 && overVoid(this.dim, this.x - Math.sin(this.yaw) * reach, this.y, this.z - Math.cos(this.yaw) * reach)) return true;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01 && overVoid(this.dim, this.x + (b.vx / sp) * reach, this.y, this.z + (b.vz / sp) * reach)) {
      b.vx = 0;
      b.vz = 0;
    }
    return false;
  }

  /** True when every column under the mob's footprint (a hair inside its edges) is open void. */
  private footprintOverVoid(): boolean {
    const h = Math.max(0.05, this.body.width / 2 - 0.05);
    for (const [dx, dz] of [
      [0, 0],
      [-h, -h],
      [h, -h],
      [-h, h],
      [h, h],
    ] as const)
      if (!overVoid(this.dim, this.body.x + dx, this.body.y, this.body.z + dz)) return false;
    return true;
  }

  private effectSlow(): number {
    return (this.data.slowTicks as number | undefined) ? 0.6 : 1;
  }

  private flyMove(tx: number | null, ty: number, tz: number, speed: number): void {
    const b = this.body;
    const def = this.def;
    const accel = def.speed * 0.25 * speed;
    if (tx !== null) {
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dz = tz - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      b.vx += (dx / d) * accel;
      b.vy += (dy / d) * accel;
      b.vz += (dz / d) * accel;
      this.yaw = approachAngle(this.yaw, Math.atan2(-dx, -dz), 0.3);
      this.headYaw = this.yaw;
    } else if (!def.aquatic && !def.amphibious) {
      // gentle hover
      b.vy += Math.sin(this.age * 0.1) * 0.002;
    }
    // A sitting flyer (a parrot told to stay) settles down
    if (this.sitting && def.flying && !b.onGround) b.vy -= 0.04;
    if (def.aquatic && !b.inWater) b.vy -= 0.08;
    moveBody(this.dim, b, b.vx, b.vy, b.vz);
    const drag = def.aquatic || def.amphibious ? 0.9 : 0.91;
    b.vx *= drag;
    b.vy *= drag;
    b.vz *= drag;
    b.fallDistance = 0;
    if (this.lookAt) {
      const dx = this.lookAt.x - this.x;
      const dz = this.lookAt.z - this.z;
      this.headYaw = Math.atan2(-dx, -dz);
      if (tx === null) this.yaw = approachAngle(this.yaw, this.headYaw, 0.3);
      this.lookAt = null;
    }
  }

  // ------------------------------------------------------------------ damage
  override hurt(amount: number, info: HurtInfo): number {
    if (this.dead || this.removed) return 0;
    const src = info.source;
    if (this.def.fireImmune && (src === 'fire' || src === 'lava' || src === 'in_fire' || src === 'magma')) return 0;
    // Emerging or burrowing Wardens (and other scripted moments) can't be hurt
    if (this.data.untouchable && src !== 'void' && src !== 'kill') return 0;
    // The Error shrugs off most of a hit unless its core is exposed
    if (this.type === 'the_error') {
      amount = this.dim.server.errorBoss?.scaleDamage(this, amount, info) ?? amount;
      if (amount <= 0) return 0;
    }
    // V6 phase 3: a Bulwark behind its shield takes half (and any hit wakes it)
    if (isConstruct(this.type)) amount = this.dim.server.constructs?.scaleDamage(this, amount, info) ?? amount;
    // V6 phase 5: the End Guardian (its shield, its exposed core, its untouchable moments); eclipsed Void Stalkers
    if (this.type === 'end_guardian') {
      amount = this.dim.server.guardian?.scaleDamage(this, amount, info) ?? amount;
      if (amount <= 0) return 0;
    }
    if (this.data.eclipsed && this.type === 'void_stalker') amount *= ECLIPSE.stalkerDamageTaken;
    // V6 phase 4: vehicles break into their item (no death, no loot)
    if (this.def.vehicle) return this.dim.server.endTransport?.vehicleHurt(this, amount, info) ?? 0;
    // Herobrine: can't be hurt between moments of his fights, and never dies the first time
    if (this.type === 'herobrine') {
      amount = this.dim.server.herobrine?.scaleDamage(this, amount, info) ?? amount;
      if (amount <= 0) return 0;
    }
    if (this.invulnerableTicks > 10 && src !== 'void' && src !== 'kill') {
      const last = (this.data.lastHurtAmount as number) ?? 0;
      if (amount <= last) return 0;
      const diff = amount - last;
      this.data.lastHurtAmount = amount;
      amount = diff;
    } else {
      this.data.lastHurtAmount = amount;
      this.invulnerableTicks = 20;
    }
    const bypass = src === 'fall' || src === 'drown' || src === 'void' || src === 'suffocate' || src === 'fire' || src === 'magic' || src === 'kill' || src === 'starve';
    const armor = Math.max(0, this.armor - (info.armorPierce ?? 0));
    if (!bypass && armor > 0) amount *= 1 - Math.min(20, Math.max(armor / 5, armor - amount / 2)) / 25;
    if (amount <= 0) return 0;
    const server = this.dim.server;
    this.hurtTime = 10;
    this.lastHurtTick = server.tickNo;
    server.broadcastNear(this.dim, this.x, this.y, this.z, 64, { t: 'anim', id: this.id, anim: 'hurt' });
    // Knockback
    if (info.knockback && info.kbx !== undefined && info.kbz !== undefined) {
      const k = info.knockback * (1 - (this.def.knockbackRes ?? 0));
      if (k > 0) {
        this.body.vx = this.body.vx / 2 + info.kbx * k;
        this.body.vz = this.body.vz / 2 + info.kbz * k;
        if (this.body.onGround) this.body.vy = Math.min(0.4, this.body.vy / 2 + 0.4 * Math.min(1, k * 2));
      }
    }
    const attacker = info.attacker;
    if (attacker && attacker !== this && (isPlayer(attacker) || attacker instanceof LivingEntity)) {
      this.revengeTarget = attacker as Target;
      this.revengeTicks = 200;
      this.lastAttacker = attacker;
      if (isPlayer(attacker)) this.lastHurtByPlayerTick = server.tickNo;
      if (this.type === 'warden') server.warden?.hurtBy(this, attacker);
      if (this.type === 'sporeling' || this.type === 'crystal_mite') server.mobs?.onCaveMobHurt(this, attacker);
      this.persistenceRequired ||= this.def.category !== 'monster';
    }
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    server.playSound(this.dim, `mob.${this.soundKey()}.hurt`, this.x, this.y + this.def.height * 0.8, this.z, 1, this.baby ? 1.5 : 0.9 + this.rng.next() * 0.2);
    if (this.type !== 'warden') server.sculk?.vibrate(this.dim, this.x, this.y + 1, this.z, this, 'hit');
    this.metaDirty = this.metaDirty || this.def.category === 'boss';
    if (this.health <= 0) this.die(info);
    // V6: the Expanded End's mobs react to hits (Endlings blink away, mites call the swarm...)
    else if (isExpansionMob(this.type)) server.endMobs?.onHurt(this, info);
    return before - this.health;
  }

  die(info: HurtInfo): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.stopNavigation();
    const server = this.dim.server;
    server.broadcastNear(this.dim, this.x, this.y, this.z, 64, { t: 'anim', id: this.id, anim: 'death' });
    server.playSound(this.dim, `mob.${this.soundKey()}.death`, this.x, this.y + this.def.height * 0.8, this.z, 1, this.baby ? 1.5 : 1);
    server.mobs?.onMobDeath(this, info);
  }

  // ------------------------------------------------------------------ network & persistence
  override meta(): Record<string, unknown> {
    const m: Record<string, unknown> = {};
    if (this.customName) m.name = this.customName;
    if (this.baby) m.baby = true;
    if (this.held) m.held = this.held.id;
    if (this.fireTicks > 0 && !this.def.fireImmune) m.fire = true;
    if (this.sitting) m.sit = true;
    if (this.owner) m.tame = true;
    if (this.fuse >= 0) m.fuse = this.fuse;
    if (this.angryAt || this.target) m.angry = true;
    for (const k of ['tele', 'slip', 'stun', 'shield', 'awake', 'color', 'sheared', 'size', 'profession', 'variant', 'charged', 'carried', 'phase', 'open', 'saddle', 'leashPos', 'puff', 'dancing', 'playDead', 'rolling', 'eating', 'trusting', 'tongue', 'emerge', 'dig', 'angerLevel', 'sonic', 'listen', 'sniff', 'voidbound', 'errorPhase', 'errorAnim', 'clone', 'malware', 'hbAnim', 'hbKind', 'apparition', 'lit', 'eclipsed', 'state', 'attack', 'inhale', 'rear']) if (this.data[k] !== undefined) m[k] = this.data[k];
    if (this.data.glowTicks) m.glowing = true;
    if (this.data.leash && this.metaHolder) m.leash = this.metaHolder;
    if (this.rider) m.rider = this.rider.id;
    if (this.def.category === 'boss') {
      m.hp = this.health;
      m.maxHp = this.maxHealth;
    }
    return m;
  }

  override spawnPacket(): EntitySpawn {
    return { ...super.spawnPacket(), meta: this.meta() };
  }

  override trackingRange(): number {
    return this.def.category === 'boss' ? 256 : this.def.width > 3 ? 128 : 80;
  }

  override save(): Record<string, unknown> | null {
    if (this.dead) return null;
    return {
      kind: 'mob',
      type: this.type,
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      health: this.health,
      maxHealth: this.maxHealth,
      baby: this.baby || undefined,
      growTicks: this.growTicks || undefined,
      owner: this.owner ?? undefined,
      sitting: this.sitting || undefined,
      held: this.held ? items[this.held.id]!.id : undefined,
      name: this.customName ?? undefined,
      persist: this.persistenceRequired || undefined,
      admin: this.admin || undefined,
      data: Object.keys(this.data).length ? this.data : undefined,
    };
  }

  static restore(data: Record<string, unknown>): Mob | null {
    const type = String(data.type ?? '');
    if (!mobDef(type)) return null;
    const m = new Mob(type);
    m.setPos(Number(data.x) || 0, Number(data.y) || 0, Number(data.z) || 0);
    m.yaw = Number(data.yaw) || 0;
    if (typeof data.maxHealth === 'number' && data.maxHealth > 0) m.maxHealth = data.maxHealth;
    if (typeof data.health === 'number') m.health = Math.min(m.maxHealth, Math.max(1, data.health));
    m.baby = !!data.baby;
    m.growTicks = Number(data.growTicks) || 0;
    m.owner = typeof data.owner === 'string' ? data.owner : null;
    m.sitting = !!data.sitting;
    if (typeof data.held === 'string' && itemById.has(data.held)) m.held = { id: itemById.get(data.held)!.num, count: 1 };
    if (typeof data.name === 'string') m.customName = data.name.slice(0, 32);
    m.persistenceRequired = !!data.persist;
    m.admin = data.admin === true;
    if (data.data && typeof data.data === 'object') m.data = { ...(data.data as Record<string, unknown>) };
    delete m.data.lastHurtAmount;
    return m;
  }

  /** Point in front of the mob's eyes (for projectiles). */
  eyePos(): [number, number, number] {
    return [this.x, this.y + this.eyeHeight, this.z];
  }

  isFluidAtFeet(): boolean {
    return STATE_FLUID[this.dim.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] !== 0;
  }

  override isUndead(): boolean {
    return !!this.def.undead;
  }

  override isArthropod(): boolean {
    return !!this.def.arthropod;
  }

  override isFarlands(): boolean {
    return !!this.def.farlands;
  }
}

/**
 * True when a column offers nothing to stand on within a few blocks below
 * `y` (open void, or a chunk that is not loaded): a wall for mobs with an edge guard.
 */
export function overVoid(dim: Dimension, x: number, y: number, z: number): boolean {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  if (!dim.isLoaded(bx, bz)) return true;
  const top = Math.floor(y + 0.5);
  for (let yy = top; yy >= top - 6; yy--) if (collisionShape(dim.getState(bx, yy, bz)).length) return false;
  return true;
}

/** Horizontal distance within which mobs get full-rate AI. */
export const AI_NEAR = 48;

export function approachAngle(cur: number, target: number, max: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-max, Math.min(max, d));
}
