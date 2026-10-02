/**
 * V6 phase 2: goals of the Expanded End's mobs.
 *
 * Every attack is telegraphed for at least 24 ticks (32 when more than one
 * player is near, see EndMobsSystem.telegraph) and resolved on the server at
 * the moment of impact, against where everyone is then. Windups are timed in
 * server ticks, so the goal's own tick rate never shortens them. The shared
 * work (strikes that never knock anyone into the void, safe ground, the
 * void slip, the swarm, the dive) lives in src/server/systems/EndMobs.ts.
 */
import type { Mob } from '../entity/Mob';
import { isAlive, isPlayer } from '../entity/Mob';
import { canSee, distSq, type Goal, type GoalFlag } from './goals';

function now(m: Mob): number {
  return m.dim.server.tickNo;
}

function sys(m: Mob): import('../systems/EndMobs').EndMobsSystem {
  return m.dim.server.endMobs!;
}

function setTele(m: Mob, kind: string | null): void {
  if (kind) m.data.tele = kind;
  else delete m.data.tele;
  m.metaDirty = true;
}

function hdist(m: Mob, x: number, z: number): number {
  return Math.hypot(m.x - x, m.z - z);
}

// ---------------------------------------------------------------------------
// Void Stalker
// ---------------------------------------------------------------------------

/** Chases its target and lunges: a crouch with flaring eyes, then a leap. One hit per leap, standard knockback. */
export class StalkerLungeGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private windupEnd = 0;
  private leapEnd = 0;
  private ready = 0;
  private repath = 0;
  canUse(m: Mob): boolean {
    return !!m.target && isAlive(m.target) && !m.data.slip && !m.data.slipping;
  }
  canContinue(m: Mob): boolean {
    if (m.data.slip || m.data.slipping) return false;
    return this.windupEnd > 0 || this.leapEnd > 0 || (this.canUse(m) && distSq(m, m.target!) < 36 * 36);
  }
  tick(m: Mob): void {
    const t = m.target;
    const tick = now(m);
    if (this.windupEnd) {
      m.stopNavigation();
      if (t) m.lookAt = { x: t.x, y: t.y + 1, z: t.z };
      if (tick < this.windupEnd) return;
      this.windupEnd = 0;
      setTele(m, null);
      // Leap at where the target is now (if that is still over safe ground)
      if (!t || !isAlive(t) || !sys(m).leapSafe(m, t.x, t.z)) {
        this.ready = tick + 20;
        return;
      }
      // The hit is checked every tick of the leap (EndMobsSystem.stalkerTick)
      sys(m).leap(m, t.x, t.z);
      this.leapEnd = tick + 18;
      return;
    }
    if (this.leapEnd) {
      if (tick >= this.leapEnd || (m.body.onGround && tick > this.leapEnd - 10)) {
        this.leapEnd = 0;
        this.ready = tick + 30;
      }
      return;
    }
    if (!t) return;
    m.lookAt = { x: t.x, y: t.y + 1, z: t.z };
    const d2 = distSq(m, t);
    if (tick >= this.ready && d2 <= 7.5 * 7.5 && Math.abs(t.y - m.y) < 3 && m.body.onGround && canSee(m, t) && sys(m).leapSafe(m, t.x, t.z)) {
      // Crouch: eyes flare, a low rising growl
      this.windupEnd = tick + sys(m).telegraph(m);
      m.stopNavigation();
      setTele(m, 'lunge');
      m.dim.server.playSound(m.dim, 'mob.void_stalker.windup', m.x, m.y + 1.5, m.z, 1, 1);
      return;
    }
    if (--this.repath <= 0 || !m.navigating) {
      this.repath = d2 > 256 ? 8 : 4;
      m.navigateTo(t.x, t.y, t.z, 1.35);
    }
  }
  stop(m: Mob): void {
    this.windupEnd = 0;
    this.leapEnd = 0;
    setTele(m, null);
    m.stopNavigation();
  }
}

/**
 * The void slip: below half health (once), or when a player has looked
 * straight at it for three seconds, it runs for the nearest island edge and
 * drops into the void. EndMobsSystem takes it from there (it climbs back
 * behind the nearest player, or is gone for good when it cannot).
 */
export class VoidSlipGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private edge: { x: number; y: number; z: number; dx: number; dz: number } | null = null;
  private until = 0;
  canUse(m: Mob): boolean {
    if (m.data.slip || !m.data.wantSlip) return false;
    this.edge = sys(m).findEdge(m);
    if (!this.edge) {
      delete m.data.wantSlip;
      return false;
    }
    return true;
  }
  canContinue(m: Mob): boolean {
    return !!this.edge && !m.data.slip;
  }
  start(m: Mob): void {
    delete m.data.wantSlip;
    m.data.slipping = true;
    this.until = now(m) + 100;
    setTele(m, null);
    m.dim.server.playSound(m.dim, 'mob.void_stalker.slip', m.x, m.y + 1.5, m.z, 1, 1);
  }
  tick(m: Mob): void {
    const e = this.edge!;
    m.lookAt = { x: e.x + e.dx * 4, y: e.y, z: e.z + e.dz * 4 };
    const d = hdist(m, e.x, e.z);
    if (d < 1.2 || now(m) > this.until) {
      // Over the edge
      m.stopNavigation();
      m.body.vx = e.dx * 0.35;
      m.body.vz = e.dz * 0.35;
      m.body.vy = 0.25;
      m.data.slip = 'fall';
      m.data.slipFrom = Math.floor(m.y);
      m.data.slipAt = now(m);
      m.metaDirty = true;
      this.edge = null;
      return;
    }
    if (!m.navigating) {
      if (!m.navigateTo(e.x, e.y, e.z, 1.8)) m.wantPos = { x: e.x, y: e.y, z: e.z, speed: 1.8 };
    }
  }
  stop(m: Mob): void {
    if (m.data.slip !== 'fall') delete m.data.slipping;
    m.stopNavigation();
  }
}

// ---------------------------------------------------------------------------
// Chorus Beast
// ---------------------------------------------------------------------------

/** Neutral: only goes after players it is angry with (they hit it, or broke chorus near it). */
export class BeastTargetGoal implements Goal {
  flags: GoalFlag[] = ['target'];
  canUse(m: Mob): boolean {
    const t = sys(m).angryTarget(m);
    if (!t) return false;
    m.target = t;
    m.metaDirty = true;
    return true;
  }
  canContinue(m: Mob): boolean {
    const t = m.target;
    return !!t && isAlive(t) && isPlayer(t) && sys(m).isAngryAt(m, t) && distSq(m, t) < 28 * 28;
  }
  stop(m: Mob): void {
    m.target = null;
    m.metaDirty = true;
  }
}

/** Ground slam (rears up, then hits everyone close) and chorus throw (a wind-up with the arc shown, then a lob). */
export class BeastAttackGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private act: { kind: 'slam' | 'throw'; end: number; tx: number; ty: number; tz: number; flight: number } | null = null;
  private slamReady = 0;
  private throwReady = 0;
  private repath = 0;
  canUse(m: Mob): boolean {
    return !!m.target && isAlive(m.target);
  }
  canContinue(m: Mob): boolean {
    return !!this.act || this.canUse(m);
  }
  tick(m: Mob): void {
    const t = m.target;
    const tick = now(m);
    const s = sys(m);
    if (this.act) {
      m.stopNavigation();
      if (this.act.kind === 'throw') m.lookAt = { x: this.act.tx, y: this.act.ty + 1, z: this.act.tz };
      if (tick < this.act.end) return;
      const a = this.act;
      this.act = null;
      setTele(m, null);
      if (a.kind === 'slam') {
        s.slam(m);
        this.slamReady = tick + 60;
      } else {
        s.throwChorus(m, a.tx, a.ty, a.tz, a.flight);
        this.throwReady = tick + 80;
      }
      return;
    }
    if (!t) return;
    m.lookAt = { x: t.x, y: t.y + 1, z: t.z };
    const d = hdist(m, t.x, t.z);
    if (tick >= this.slamReady && d <= 4.2 && Math.abs(t.y - m.y) < 2.5) {
      // Rears up for (at least) 28 ticks
      const ticks = Math.max(28, s.telegraph(m));
      this.act = { kind: 'slam', end: tick + ticks, tx: m.x, ty: m.y, tz: m.z, flight: 0 };
      setTele(m, 'slam');
      s.warnSlam(m, ticks);
      return;
    }
    if (tick >= this.throwReady && d >= 6 && d <= 18 && canSee(m, t)) {
      const ticks = s.telegraph(m);
      const flight = Math.max(12, Math.min(26, Math.round(d * 1.2)));
      this.act = { kind: 'throw', end: tick + ticks, tx: t.x, ty: t.y, tz: t.z, flight };
      setTele(m, 'throw');
      s.warnThrow(m, t.x, t.y, t.z, flight, ticks);
      return;
    }
    if (--this.repath <= 0 || !m.navigating) {
      this.repath = 6;
      m.navigateTo(t.x, t.y, t.z, 1.1);
    }
  }
  stop(m: Mob): void {
    this.act = null;
    setTele(m, null);
    m.stopNavigation();
  }
}

// ---------------------------------------------------------------------------
// End Crystal Mite
// ---------------------------------------------------------------------------

/** Scuttles up, rears for the telegraph, then bites; with nothing to fight after a cluster is mined, burrows into another. */
export class MiteGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private biteAt = 0;
  private ready = 0;
  private repath = 0;
  canUse(m: Mob): boolean {
    return (!!m.target && isAlive(m.target)) || !!m.data.burrow;
  }
  canContinue(m: Mob): boolean {
    return this.biteAt > 0 || this.canUse(m);
  }
  tick(m: Mob): void {
    const t = m.target && isAlive(m.target) ? m.target : null;
    const tick = now(m);
    if (this.biteAt) {
      m.stopNavigation();
      if (t) m.lookAt = { x: t.x, y: t.y + 0.5, z: t.z };
      if (tick < this.biteAt) return;
      this.biteAt = 0;
      setTele(m, null);
      if (t && sys(m).inReach(m, t, 0.7)) sys(m).strike(m, t, m.def.damage ?? 2, 0.2);
      this.ready = tick + 16;
      return;
    }
    if (!t) {
      // Burrow back into the nearest cluster
      const c = sys(m).nearestCluster(m, 16);
      if (!c) {
        delete m.data.burrow;
        return;
      }
      if (Math.hypot(m.x - (c.x + 0.5), m.y - c.y, m.z - (c.z + 0.5)) < 1.6) {
        sys(m).burrow(m, c.x, c.y, c.z);
        return;
      }
      if (!m.navigating) m.navigateTo(c.x + 0.5, c.y, c.z + 0.5, 1.2);
      return;
    }
    m.lookAt = { x: t.x, y: t.y + 0.5, z: t.z };
    if (tick >= this.ready && sys(m).inReach(m, t, 0.5)) {
      this.biteAt = tick + sys(m).telegraph(m);
      setTele(m, 'bite');
      m.dim.server.playSound(m.dim, 'mob.end_crystal_mite.windup', m.x, m.y + 0.2, m.z, 0.6, 1);
      return;
    }
    if (--this.repath <= 0 || !m.navigating) {
      this.repath = 4;
      m.navigateTo(t.x, t.y, t.z, 1.3);
    }
  }
  stop(m: Mob): void {
    this.biteAt = 0;
    setTele(m, null);
    m.stopNavigation();
  }
}

// ---------------------------------------------------------------------------
// End Phantom
// ---------------------------------------------------------------------------

/**
 * Circles high overhead; with a target it hangs still, screeches with its
 * wings flaring white while the line of its dive shows, dives along that
 * line, and climbs away. Hit while diving, it is stunned for two seconds.
 */
export class PhantomGoal implements Goal {
  flags: GoalFlag[] = ['move', 'look'];
  private angle = 0;
  private diveAt = 0;
  private ready = 0;
  private line: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null = null;
  canUse(): boolean {
    return true;
  }
  canContinue(): boolean {
    return true;
  }
  tick(m: Mob): void {
    const tick = now(m);
    const s = sys(m);
    if (Number(m.data.stunUntil ?? 0) > tick || m.data.diving) {
      m.wantPos = null;
      return;
    }
    const t = m.target && isAlive(m.target) ? m.target : null;
    if (this.diveAt) {
      // Hanging in the air while the warning shows
      m.wantPos = null;
      m.body.vx *= 0.5;
      m.body.vy *= 0.5;
      m.body.vz *= 0.5;
      if (this.line) m.lookAt = { x: this.line.x1, y: this.line.y1, z: this.line.z1 };
      if (tick < this.diveAt) return;
      this.diveAt = 0;
      setTele(m, null);
      if (this.line) s.dive(m, this.line);
      this.line = null;
      this.ready = tick + 120;
      return;
    }
    // Circle: around the target high above it, or around its home
    const cx = t ? t.x : Number(m.data.homeX ?? m.x);
    const cz = t ? t.z : Number(m.data.homeZ ?? m.z);
    const cy = t ? t.y + 16 : Number(m.data.homeY ?? m.y);
    const r = t ? 10 : 14;
    if (!m.wantPos || hdist(m, m.wantPos.x, m.wantPos.z) < 2) {
      this.angle += 0.5;
      m.wantPos = { x: cx + Math.cos(this.angle) * r, y: cy + Math.sin(this.angle * 0.7) * 2, z: cz + Math.sin(this.angle) * r, speed: 1.2 };
    }
    if (t && tick >= this.ready && m.y > t.y + 6 && canSee(m, t)) {
      // Screech: wings flare white for (at least) 30 ticks while the dive line shows
      const ticks = Math.max(30, s.telegraph(m));
      this.line = s.diveLine(m, t);
      this.diveAt = tick + ticks;
      setTele(m, 'dive');
      s.warnDive(m, this.line, ticks);
    }
  }
  stop(m: Mob): void {
    this.diveAt = 0;
    setTele(m, null);
  }
}
