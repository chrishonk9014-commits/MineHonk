/**
 * The Warden: the blind guardian of the deep dark.
 *
 * It cannot see. It hears vibrations (up to 16 blocks, unless wool is in the
 * way) and sniffs the air, building anger towards whoever it notices. Anger
 * fades by itself; at 80 it hunts the angriest target. Up close it strikes
 * hard enough to knock shields aside; out of reach it charges a sonic boom
 * that passes through walls and armour. Projectiles that land make it go and
 * investigate where they fell - a way to lure it off. Left alone and calm
 * for long enough it burrows back into the ground.
 *
 * Cues are readable: its heartbeat quickens as it gets angrier, its tendrils
 * twitch when it hears something, it roars when it starts to hunt and its
 * chest swells while a sonic boom charges.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { Entity } from '../entity/Entity';
import { Mob, isPlayer, isAlive } from '../entity/Mob';
import { LivingEntity } from '../entity/Living';
import { STATE_SOLID, STATE_FLUID } from '../../common/registry/blocks';
import { Random } from '../../common/math/rng';
import type { VibrationKind } from './Sculk';

export const EMERGE_TICKS = 134;
export const DIG_TICKS = 100;
const SONIC_CHARGE = 34;
const SONIC_RANGE = 15;
const ANGRY = 80;
const MAX_ANGER = 150;

interface Mind {
  anger: Map<Entity, number>;
  /** Where the last interesting sound came from. */
  investigate: { x: number; y: number; z: number } | null;
  heardAt: number;
  emerge: number;
  dig: number;
  sonic: { target: Entity; ticks: number } | null;
  sonicReadyAt: number;
  sniffAt: number;
  roared: boolean;
  stuckSince: number;
}

export class WardenSystem {
  private readonly rng = new Random();
  private readonly minds = new WeakMap<Mob, Mind>();
  /** Wardens that may be listening (pruned as they die or unload). */
  readonly active = new Set<Mob>();

  constructor(private readonly server: GameServer) {}

  mind(w: Mob): Mind {
    let m = this.minds.get(w);
    if (!m) {
      m = { anger: new Map(), investigate: null, heardAt: this.server.tickNo, emerge: 0, dig: 0, sonic: null, sonicReadyAt: 0, sniffAt: this.server.tickNo + 100, roared: false, stuckSince: -1 };
      this.minds.set(w, m);
    }
    this.active.add(w);
    return m;
  }

  /** Ticks of calm before a Warden digs back down (world rule, in seconds). */
  private calmTicks(): number {
    const secs = Number(this.server.level.rules.wardenCalmSeconds ?? 60);
    return Math.max(10, Number.isFinite(secs) ? secs : 60) * 20;
  }

  // ------------------------------------------------------------------ summoning

  /** Calls a Warden up out of the ground near a shrieker. */
  summon(dim: Dimension, x: number, y: number, z: number, cause: Entity | null, opts: { admin?: boolean } = {}): Mob | null {
    const s = this.server;
    if (s.level.difficulty === 'peaceful' && !opts.admin) return null;
    if (!opts.admin && dim.entitiesNear(x, y, z, 48, (e) => e instanceof Mob && e.type === 'warden' && !e.dead).length) return null;
    const spot = this.findSpot(dim, x, y, z);
    if (!spot) return null;
    const w = s.mobs?.spawn(dim, 'warden', spot[0] + 0.5, spot[1], spot[2] + 0.5, { persistent: true, reason: 'summon' });
    if (!w) return null;
    if (opts.admin) w.admin = true;
    const m = this.mind(w);
    m.emerge = EMERGE_TICKS;
    m.heardAt = s.tickNo;
    w.data.untouchable = true;
    w.data.emerge = 0;
    w.metaDirty = true;
    // It comes up already suspicious of whoever woke it
    if (cause && isPlayer(cause)) m.anger.set(cause, 60);
    s.playSound(dim, 'warden.emerge', w.x, w.y, w.z, 4, 1);
    return w;
  }

  private findSpot(dim: Dimension, x: number, y: number, z: number): [number, number, number] | null {
    for (let i = 0; i < 40; i++) {
      const sx = x + this.rng.int(11) - 5;
      const sz = z + this.rng.int(11) - 5;
      for (let dy = 4; dy >= -6; dy--) {
        const sy = y + dy;
        const floor = dim.getState(sx, sy - 1, sz);
        if (!STATE_SOLID[floor] || STATE_FLUID[floor]) continue;
        let clear = true;
        for (let h = 0; h < 3; h++) {
          const st = dim.getState(sx, sy + h, sz);
          if (STATE_SOLID[st] || STATE_FLUID[st]) clear = false;
        }
        if (clear) return [sx, sy, sz];
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ senses

  private addAnger(w: Mob, m: Mind, e: Entity, amount: number): void {
    if (isPlayer(e) && (e.gamemode === 'creative' || e.gamemode === 'spectator')) return;
    if (e instanceof Mob && e.type === 'warden') return;
    const before = m.anger.get(e) ?? 0;
    const after = Math.min(MAX_ANGER, before + amount);
    m.anger.set(e, after);
    if (before < ANGRY && after >= ANGRY && !m.roared) {
      m.roared = true;
      this.server.playSound(w.dim, 'warden.roar', w.x, w.y + 2, w.z, 4, 1);
      this.server.broadcastNear(w.dim, w.x, w.y, w.z, 64, { t: 'anim', id: w.id, anim: 'roar' });
    }
  }

  /** A vibration reached the Warden. */
  hear(w: Mob, x: number, y: number, z: number, source: Entity | null, kind: VibrationKind): void {
    const m = this.mind(w);
    if (m.emerge > 0 || m.dig > 0) return;
    const s = this.server;
    m.heardAt = s.tickNo;
    m.investigate = { x, y, z };
    // A landed projectile draws it to the spot, not to the shooter
    if (source && kind !== 'projectile') this.addAnger(w, m, source, isPlayer(source) ? 35 : 10);
    w.data.listen = s.tickNo;
    w.metaDirty = true;
    s.playSound(w.dim, 'warden.listen', w.x, w.y + 2.5, w.z, 1.5, 0.9 + this.rng.next() * 0.2);
  }

  /** Hitting a Warden is the fastest way to make it furious. */
  hurtBy(w: Mob, attacker: Entity | null): void {
    if (!attacker) return;
    const m = this.mind(w);
    m.heardAt = this.server.tickNo;
    this.addAnger(w, m, attacker, 100);
  }

  /** The entity it is hunting, if any. */
  target(w: Mob): Entity | null {
    const m = this.mind(w);
    let best: Entity | null = null;
    let bestA = ANGRY - 1;
    for (const [e, a] of m.anger) {
      if (a <= bestA || !isAlive(e as never) || e.dim !== w.dim) continue;
      if ((e.x - w.x) ** 2 + (e.z - w.z) ** 2 > 48 * 48) continue;
      best = e;
      bestA = a;
    }
    return best;
  }

  private angerLevel(w: Mob): number {
    const m = this.mind(w);
    let top = 0;
    for (const a of m.anger.values()) top = Math.max(top, a);
    return top >= ANGRY ? 2 : top >= 40 ? 1 : 0;
  }

  // ------------------------------------------------------------------ thinking (every other tick)

  think(w: Mob): void {
    const s = this.server;
    const m = this.mind(w);
    const now = s.tickNo;
    if (m.emerge > 0 || m.dig > 0) {
      w.stopNavigation();
      return;
    }
    const t = this.target(w);
    w.target = null;
    if (t) {
      m.investigate = null;
      w.lookAt = { x: t.x, y: t.y + 1.5, z: t.z };
      if (m.sonic) return;
      const dx = t.x - w.x;
      const dz = t.z - w.z;
      const dy = t.y - w.y;
      const d = Math.hypot(dx, dz);
      if (d < 2.6 && Math.abs(dy) < 3) {
        w.stopNavigation();
        if (w.attackCooldown <= 0) this.strike(w, t);
        return;
      }
      // Stuck or out of reach: a sonic boom through whatever is in the way
      const moving = w.navigating;
      if (!moving) {
        if (m.stuckSince < 0) m.stuckSince = now;
      } else m.stuckSince = -1;
      const stuck = m.stuckSince >= 0 && now - m.stuckSince > 40;
      if (now >= m.sonicReadyAt && d <= SONIC_RANGE && Math.abs(dy) < 20 && (stuck || (d > 5 && this.rng.chance(0.04)))) {
        m.sonic = { target: t, ticks: SONIC_CHARGE };
        w.data.sonic = 1;
        w.metaDirty = true;
        w.stopNavigation();
        s.playSound(w.dim, 'warden.sonic_charge', w.x, w.y + 1.5, w.z, 3, 1);
        return;
      }
      if (!w.navigating || now % 10 === 0) w.navigateTo(t.x, t.y, t.z, 1.7);
      return;
    }
    m.roared = false;
    if (m.investigate) {
      const iv = m.investigate;
      if ((iv.x - w.x) ** 2 + (iv.z - w.z) ** 2 < 4) {
        m.investigate = null;
        w.stopNavigation();
        m.sniffAt = Math.min(m.sniffAt, now + 20);
      } else if (!w.navigating || now % 20 === 0) {
        if (!w.navigateTo(iv.x, iv.y, iv.z, 1.1)) m.investigate = null;
      }
      return;
    }
    // Sniffing: it smells the nearest player within 24 blocks
    if (now >= m.sniffAt) {
      m.sniffAt = now + 120 + this.rng.int(100);
      w.data.sniff = now;
      w.metaDirty = true;
      s.playSound(w.dim, 'warden.sniff', w.x, w.y + 2.5, w.z, 1.5, 1);
      let near: Entity | null = null;
      let nd = 24 * 24;
      for (const p of s.players.values()) {
        if (p.dim !== w.dim || p.dead || p.gamemode === 'creative' || p.gamemode === 'spectator') continue;
        const dd = p.distanceSq(w.x, w.y, w.z);
        if (dd < nd) {
          nd = dd;
          near = p;
        }
      }
      if (near) {
        this.addAnger(w, m, near, 35);
        m.investigate = { x: near.x, y: near.y, z: near.z };
      }
      return;
    }
    // Calm for long enough: burrow away
    if (m.anger.size === 0 && now - m.heardAt > this.calmTicks()) {
      m.dig = DIG_TICKS;
      w.data.untouchable = true;
      w.data.dig = 0;
      w.metaDirty = true;
      w.stopNavigation();
      s.playSound(w.dim, 'warden.dig', w.x, w.y, w.z, 3, 1);
      return;
    }
    if (!w.navigating && this.rng.chance(0.02)) {
      const a = this.rng.next() * Math.PI * 2;
      w.navigateTo(w.x + Math.cos(a) * 6, w.y, w.z + Math.sin(a) * 6, 0.6);
    }
  }

  private strike(w: Mob, t: Entity): void {
    const s = this.server;
    w.attackCooldown = 36;
    s.broadcastNear(w.dim, w.x, w.y, w.z, 64, { t: 'anim', id: w.id, anim: 'swing' });
    s.playSound(w.dim, 'warden.attack', w.x, w.y + 1.5, w.z, 2, 1);
    const dmg = s.level.difficulty === 'easy' ? 16 : s.level.difficulty === 'hard' ? 45 : 30;
    const dx = t.x - w.x;
    const dz = t.z - w.z;
    const d = Math.hypot(dx, dz) || 1;
    s.mobs?.damage(t, dmg, { source: 'mob', attacker: w, kbx: dx / d, kbz: dz / d, knockback: 1.2, disableShield: 100 });
  }

  private sonicBoom(w: Mob, t: Entity): void {
    const s = this.server;
    const m = this.mind(w);
    m.sonicReadyAt = s.tickNo + 60;
    const ex = w.x;
    const ey = w.y + 1.6;
    const ez = w.z;
    const tx = t.x;
    const ty = t.y + 1;
    const tz = t.z;
    s.playSound(w.dim, 'warden.sonic_boom', ex, ey, ez, 4, 1);
    s.broadcastNear(w.dim, ex, ey, ez, 64, { t: 'trail', kind: 'sonic_boom', x0: ex, y0: ey, z0: ez, x1: tx, y1: ty, z1: tz, ticks: 6 });
    if (!isAlive(t as never) || t.dim !== w.dim) return;
    if ((tx - ex) ** 2 + (tz - ez) ** 2 > (SONIC_RANGE + 5) ** 2) return;
    // Straight through walls, armour and shields
    const dx = tx - ex;
    const dz = tz - ez;
    const d = Math.hypot(dx, dz) || 1;
    s.mobs?.damage(t, 10, { source: 'sonic_boom', attacker: w, kbx: dx / d, kbz: dz / d, knockback: 2.5 });
    if (isPlayer(t)) t.send({ t: 'velocity', id: t.id, vx: (dx / d) * 2.5, vy: 0.5, vz: (dz / d) * 2.5 });
    else if (t instanceof LivingEntity) {
      t.body.vx += (dx / d) * 2.5;
      t.body.vy += 0.5;
      t.body.vz += (dz / d) * 2.5;
    }
  }

  // ------------------------------------------------------------------ every tick

  tick(w: Mob): void {
    const s = this.server;
    const m = this.mind(w);
    const now = s.tickNo;
    if (m.emerge > 0) {
      m.emerge--;
      if (m.emerge % 10 === 0) {
        w.data.emerge = Math.round((1 - m.emerge / EMERGE_TICKS) * 100) / 100;
        w.metaDirty = true;
      }
      if (m.emerge % 4 === 0) {
        const below = w.dim.getState(Math.floor(w.x), Math.floor(w.y - 0.5), Math.floor(w.z));
        s.particles(w.dim, 'block', w.x, w.y + 0.2, w.z, 12, 0.8, below);
      }
      if (m.emerge === 0) {
        delete w.data.untouchable;
        delete w.data.emerge;
        w.metaDirty = true;
        s.playSound(w.dim, 'warden.roar', w.x, w.y + 2, w.z, 4, 0.9);
      }
      return;
    }
    if (m.dig > 0) {
      m.dig--;
      if (m.dig % 10 === 0) {
        w.data.dig = Math.round((1 - m.dig / DIG_TICKS) * 100) / 100;
        w.metaDirty = true;
      }
      if (m.dig % 4 === 0) {
        const below = w.dim.getState(Math.floor(w.x), Math.floor(w.y - 0.5), Math.floor(w.z));
        s.particles(w.dim, 'block', w.x, w.y + 0.2, w.z, 12, 0.8, below);
      }
      if (m.dig === 0) w.remove();
      return;
    }
    // Sonic boom charging
    if (m.sonic) {
      const t = m.sonic.target;
      w.lookAt = { x: t.x, y: t.y + 1.5, z: t.z };
      if (--m.sonic.ticks <= 0) {
        this.sonicBoom(w, t);
        m.sonic = null;
        delete w.data.sonic;
        w.metaDirty = true;
      }
    }
    // Anger fades by itself; forget the dead and the departed
    if (now % 20 === 0) {
      for (const [e, a] of m.anger) {
        const gone = !isAlive(e as never) || e.dim !== w.dim || (isPlayer(e) && (e.gamemode === 'creative' || e.gamemode === 'spectator'));
        if (gone || a <= 1) m.anger.delete(e);
        else m.anger.set(e, a - 1);
      }
      const lvl = this.angerLevel(w);
      if (w.data.angerLevel !== lvl) {
        w.data.angerLevel = lvl;
        w.metaDirty = true;
      }
    }
    // The heartbeat quickens with anger
    const lvl = (w.data.angerLevel as number | undefined) ?? 0;
    const beat = lvl === 2 ? 18 : lvl === 1 ? 28 : 44;
    if (now % beat === 0) s.playSound(w.dim, 'warden.heartbeat', w.x, w.y + 1.5, w.z, 1.2, 1);
    // Darkness pulses around it
    if (now % 120 === 0) {
      for (const p of s.players.values()) {
        if (p.dim !== w.dim || p.dead || p.distanceSq(w.x, w.y, w.z) > 20 * 20) continue;
        s.interaction.survival.addEffect(p, 'darkness', 0, 260);
      }
    }
  }
}
