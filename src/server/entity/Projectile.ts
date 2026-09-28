/**
 * Projectiles (arrows, snowballs, eggs, pearls, fireballs, potions, shulker
 * bullets, rift bolts) and primed TNT. Collision against blocks uses a
 * raycast along the motion; against entities a swept AABB test.
 */
import { Entity } from './Entity';
import { raycastBlocks } from '../../common/physics/raycast';
import { AABB } from '../../common/physics/aabb';
import { moveBody } from '../../common/physics/movement';
import type { EntitySpawn } from '../../common/net/protocol';
import { entityInfo } from '../../common/data/entities';
import type { ItemStack } from '../../common/game/itemstack';

export type ProjectileKind = 'arrow' | 'snowball' | 'egg' | 'ender_pearl' | 'small_fireball' | 'fireball' | 'dragon_fireball' | 'potion' | 'shulker_bullet' | 'rift_bolt' | 'experience_bottle' | 'trident';

const GRAVITY: Record<ProjectileKind, number> = {
  arrow: 0.05,
  trident: 0.05,
  snowball: 0.03,
  egg: 0.03,
  ender_pearl: 0.03,
  potion: 0.05,
  experience_bottle: 0.07,
  small_fireball: 0,
  fireball: 0,
  dragon_fireball: 0,
  shulker_bullet: 0,
  rift_bolt: 0,
};

export interface ProjectileHit {
  entity?: Entity;
  block?: { x: number; y: number; z: number; face: number };
  x: number;
  y: number;
  z: number;
}

export class Projectile extends Entity {
  readonly type: string;
  vx = 0;
  vy = 0;
  vz = 0;
  owner: Entity | null = null;
  ownerUuid: string | null = null;
  damage = 2;
  crit = false;
  knockback = 0;
  fire = false;
  pierce = 0;
  /** Arrows stuck in a block. */
  stuck = false;
  stuckTicks = 0;
  pickup = false;
  potion: ItemStack | null = null;
  /** Homing target (shulker bullets). */
  homing: Entity | null = null;
  life = 1200;
  onHit: ((p: Projectile, hit: ProjectileHit) => boolean) | null = null;

  constructor(readonly kind: ProjectileKind) {
    const size = kind === 'fireball' || kind === 'dragon_fireball' ? 1 : kind === 'arrow' || kind === 'trident' ? 0.5 : 0.25;
    super(size, size);
    this.type = kind;
    this.persistent = false;
  }

  shoot(dx: number, dy: number, dz: number, speed: number, inaccuracy: number, rnd: () => number): void {
    const d = Math.hypot(dx, dy, dz) || 1;
    this.vx = (dx / d + (rnd() - 0.5) * 0.015 * inaccuracy) * speed;
    this.vy = (dy / d + (rnd() - 0.5) * 0.015 * inaccuracy) * speed;
    this.vz = (dz / d + (rnd() - 0.5) * 0.015 * inaccuracy) * speed;
    this.yaw = Math.atan2(-this.vx, -this.vz);
    this.pitch = -Math.atan2(this.vy, Math.hypot(this.vx, this.vz));
  }

  override tick(): void {
    super.tick();
    if (--this.life <= 0) {
      this.remove();
      return;
    }
    if (this.stuck) {
      this.stuckTicks++;
      // Fall if the block was removed
      const s = this.dim.getState(Math.floor(this.x - this.vx * 0.05), Math.floor(this.y - this.vy * 0.05), Math.floor(this.z - this.vz * 0.05));
      if (s === 0 && this.stuckTicks > 2) {
        this.stuck = false;
        this.vx = this.vy = this.vz = 0;
      } else {
        if (this.stuckTicks > 1200) this.remove();
        return;
      }
    }
    if (this.homing && !this.homing.removed) {
      const t = this.homing;
      const dx = t.x - this.x;
      const dy = t.y + 0.8 - this.y;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      this.vx += (dx / d) * 0.05 - this.vx * 0.05;
      this.vy += (dy / d) * 0.05 - this.vy * 0.05;
      this.vz += (dz / d) * 0.05 - this.vz * 0.05;
    }
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const len = Math.hypot(this.vx, this.vy, this.vz);
    // Blocks
    let hit: ProjectileHit | null = null;
    let travel = len;
    if (len > 0) {
      const bh = raycastBlocks(this.dim, x0, y0, z0, this.vx, this.vy, this.vz, len, { useCollision: true });
      if (bh) {
        travel = bh.dist;
        hit = { block: { x: bh.x, y: bh.y, z: bh.z, face: bh.face }, x: bh.px, y: bh.py, z: bh.pz };
      }
    }
    // Entities along the segment
    const ex = x0 + (this.vx / (len || 1)) * travel;
    const ey = y0 + (this.vy / (len || 1)) * travel;
    const ez = z0 + (this.vz / (len || 1)) * travel;
    let best = Infinity;
    const mid = [(x0 + ex) / 2, (y0 + ey) / 2, (z0 + ez) / 2] as const;
    for (const e of this.dim.entitiesNear(mid[0], mid[1], mid[2], travel / 2 + 3)) {
      if (e === this || e.removed || e instanceof Projectile) continue;
      if (e === this.owner && this.age < 5) continue;
      if (e.type === 'item' || e.type === 'xp_orb' || e.type === 'falling_block' || e.type === 'tnt') continue;
      if ((e as { dead?: boolean }).dead) continue;
      if (e.type === 'player' && ((e as { gamemode?: string }).gamemode === 'spectator')) continue;
      const info = entityInfo(e.type);
      const hw = info.width / 2 + 0.3;
      const box = new AABB(e.x - hw, e.y - 0.3, e.z - hw, e.x + hw, e.y + info.height + 0.3, e.z + hw);
      const t = box.raycast(x0, y0, z0, ex - x0, ey - y0, ez - z0);
      if (t && t.t <= 1 && t.t < best) {
        best = t.t;
        hit = { entity: e, x: x0 + (ex - x0) * t.t, y: y0 + (ey - y0) * t.t, z: z0 + (ez - z0) * t.t };
      }
    }
    if (hit) {
      this.setPos(hit.x, hit.y, hit.z);
      const consumed = this.onHit ? this.onHit(this, hit) : true;
      if (consumed) {
        this.remove();
        return;
      }
      if (hit.block && (this.kind === 'arrow' || this.kind === 'trident')) {
        this.stuck = true;
        this.stuckTicks = 0;
        return;
      }
      if (hit.entity) {
        // Pierced or deflected: keep flying
        this.setPos(ex, ey, ez);
      }
    } else this.setPos(ex, ey, ez);
    // Drag & gravity
    const inWater = this.dim.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) !== 0 && this.isInFluid();
    const drag = inWater ? 0.6 : this.kind === 'fireball' || this.kind === 'small_fireball' || this.kind === 'dragon_fireball' || this.kind === 'rift_bolt' ? 1 : 0.99;
    this.vx *= drag;
    this.vy *= drag;
    this.vz *= drag;
    this.vy -= GRAVITY[this.kind];
    if (len > 0.01) {
      this.yaw = Math.atan2(-this.vx, -this.vz);
      this.pitch = -Math.atan2(this.vy, Math.hypot(this.vx, this.vz));
    }
    if ((this.kind === 'fireball' || this.kind === 'small_fireball') && this.age % 2 === 0) this.dim.server.particles(this.dim, 'smoke', this.x, this.y + 0.2, this.z, 1, 0.1);
    if (this.kind === 'dragon_fireball' && this.age % 2 === 0) this.dim.server.particles(this.dim, 'dragon_breath', this.x, this.y + 0.3, this.z, 2, 0.2);
    if (this.kind === 'rift_bolt' && this.age % 2 === 0) this.dim.server.particles(this.dim, 'portal', this.x, this.y, this.z, 2, 0.2);
    if (this.crit && this.age % 2 === 0) this.dim.server.particles(this.dim, 'crit', this.x, this.y, this.z, 1, 0.05);
  }

  private isInFluid(): boolean {
    const s = this.dim.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return s !== 0 && this.dim.blockId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === 'water';
  }

  override meta(): Record<string, unknown> | undefined {
    const m: Record<string, unknown> = {};
    if (this.stuck) m.stuck = true;
    if (this.potion) m.item = this.potion.id;
    if (this.crit) m.crit = true;
    return m;
  }

  override spawnPacket(): EntitySpawn {
    return { ...super.spawnPacket(), vx: this.vx, vy: this.vy, vz: this.vz };
  }

  override trackingRange(): number {
    return 64;
  }
}

/** Lit TNT: counts down then explodes. */
export class PrimedTnt extends Entity {
  readonly type = 'tnt';
  fuse = 80;
  source: Entity | null = null;

  constructor() {
    super(0.98, 0.98);
    this.persistent = false;
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    b.vy -= 0.04;
    moveBody(this.dim, b, b.vx, b.vy, b.vz);
    b.vx *= 0.98;
    b.vy *= 0.98;
    b.vz *= 0.98;
    if (b.onGround) {
      b.vx *= 0.7;
      b.vz *= 0.7;
      b.vy *= -0.5;
    }
    if (--this.fuse <= 0) {
      this.remove();
      this.dim.server.mobs?.explode(this.dim, this.x, this.y + 0.49, this.z, 4, false, this.source, this.admin);
    } else if (this.fuse % 5 === 0) this.dim.server.particles(this.dim, 'smoke', this.x, this.y + 1, this.z, 1, 0.1);
  }

  override meta(): Record<string, unknown> {
    return { fuse: this.fuse };
  }
}
