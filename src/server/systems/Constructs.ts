/**
 * V6 phase 3: the Guardian Constructs, the Expanded End's structure guards.
 *
 * Neither kind spawns naturally: each is placed by its structure (a
 * structure entity, spawned once when its chunk is generated), so one that
 * is killed never comes back. Both are leashed to their post: they never
 * follow anyone more than CONSTRUCT_LEASH blocks from it, and walk back when
 * there is nobody left to guard against.
 *
 * - Sentinel: patrols a route. Close up, a charged punch (its arm glows for
 *   24 ticks); further off, a crystal bolt (a beam marks the line for 30
 *   ticks, and the bolt follows exactly that line).
 * - Bulwark: stands still, dormant, until a player enters the room it
 *   guards. Its ground pound shows a ring of glowing cracks for 32 ticks and
 *   throws everyone in it away (never towards the void). Now and then it
 *   raises a shield for 24 ticks and takes half damage.
 *
 * With more than one player near, every telegraph lasts at least 32 ticks
 * (EndMobsSystem.telegraph). Goals (src/server/ai/endGoals.ts) decide when;
 * this system resolves everything on the server.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import { Mob, isAlive, isPlayer, type Target } from '../entity/Mob';
import { LivingEntity, type HurtInfo } from '../entity/Living';
import type { ServerPlayer } from '../player/ServerPlayer';
import { canSee } from '../ai/goals';
import { isSurvivalLike } from '../../common/game/gamemode';
import { CONSTRUCT_LEASH, isConstruct } from '../../common/endExpansion/structures';
import { BULWARK_POUND_RADIUS, BULWARK_POUND_TICKS, BULWARK_SHIELD_TICKS, SENTINEL_BOLT_DAMAGE, SENTINEL_BOLT_TICKS, SENTINEL_PUNCH_TICKS } from '../../common/endExpansion/combat';

type P3 = [number, number, number];

const WARN_PUNCH = 0x7ae0ff;
const WARN_BOLT = 0x9af0ff;
const WARN_CRACKS = 0xc8a0ff;

/** How far a Sentinel notices players (and a Bulwark wakes for one close by). */
const SENTINEL_SIGHT = 16;
const BULWARK_NEAR = 6;
/** Ticks without anyone to guard against before a Bulwark goes dormant again. */
const BULWARK_SLEEP = 200;
/** Bolt speed (blocks per tick) and reach. */
const BOLT_SPEED = 1.2;
const BOLT_RANGE = 20;

export class ConstructsSystem {
  constructor(private readonly server: GameServer) {}

  private get now(): number {
    return this.server.tickNo;
  }

  private get endMobs(): import('./EndMobs').EndMobsSystem {
    return this.server.endMobs!;
  }

  /** The post it guards (where it was placed, or first stood). */
  home(m: Mob): P3 {
    let h = m.data.home as P3 | undefined;
    if (!Array.isArray(h) || h.length !== 3) {
      h = [Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)];
      m.data.home = h;
    }
    return h;
  }

  leash(m: Mob): number {
    const l = Number(m.data.leash);
    return Number.isFinite(l) && l > 0 ? l : CONSTRUCT_LEASH;
  }

  /** Horizontal distance from its post. */
  fromHome(m: Mob, x = m.x, z = m.z): number {
    const h = this.home(m);
    return Math.hypot(x + 0.5 - (h[0] + 0.5), z + 0.5 - (h[2] + 0.5));
  }

  /** The room a Bulwark guards (or a box round its post). */
  private room(m: Mob): [number, number, number, number, number, number] {
    const r = m.data.room as number[] | undefined;
    if (Array.isArray(r) && r.length === 6) return r as [number, number, number, number, number, number];
    const h = this.home(m);
    return [h[0] - 8, h[1] - 3, h[2] - 8, h[0] + 8, h[1] + 6, h[2] + 8];
  }

  private guardable(p: ServerPlayer): boolean {
    return !p.dead && isSurvivalLike(p.gamemode) && p.gamemode !== 'spectator';
  }

  /** Who the construct turns on: a Sentinel, a player it can see near its post; a Bulwark, a player in its room. */
  pickTarget(m: Mob): ServerPlayer | null {
    if (this.server.level.difficulty === 'peaceful') return null;
    let best: ServerPlayer | null = null;
    let bd = Infinity;
    for (const p of this.server.players.values()) {
      if (p.dim !== m.dim || !this.guardable(p)) continue;
      const d = p.distanceSq(m.x, m.y, m.z);
      if (this.fromHome(m, p.x, p.z) > this.leash(m) + 2) continue;
      if (m.type === 'guardian_bulwark') {
        const r = this.room(m);
        const inRoom = p.x >= r[0] && p.x <= r[3] + 1 && p.y >= r[1] - 1 && p.y <= r[4] + 1 && p.z >= r[2] && p.z <= r[5] + 1;
        if (!inRoom && d > BULWARK_NEAR * BULWARK_NEAR) continue;
      } else if (d > SENTINEL_SIGHT * SENTINEL_SIGHT || !canSee(m, p)) continue;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Whether a construct may keep after a target (within its leash). */
  keepTarget(m: Mob, t: Target): boolean {
    if (!isAlive(t) || t.dim !== m.dim) return false;
    if (isPlayer(t) && !this.guardable(t)) return false;
    return this.fromHome(m, t.x, t.z) <= this.leash(m) + 4;
  }

  /** How long an attack winds up: its own length, or the crowd telegraph if that is longer. */
  windup(m: Mob, base: number): number {
    return Math.max(base, this.endMobs.telegraph(m));
  }

  private setTele(m: Mob, kind: string | null): void {
    if (kind) m.data.tele = kind;
    else delete m.data.tele;
    m.metaDirty = true;
  }

  // ------------------------------------------------------------------ the Sentinel

  /** Starts the punch: the arm glows. Returns the windup's length. */
  warnPunch(m: Mob): number {
    const n = this.windup(m, SENTINEL_PUNCH_TICKS);
    this.setTele(m, 'punch');
    this.endMobs.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_circle', x: m.x, y: Math.floor(m.y), z: m.z, r: 2.6, ticks: n, color: WARN_PUNCH });
    this.server.playSound(m.dim, 'mob.guardian_sentinel.windup', m.x, m.y + 1.5, m.z, 1, 1);
    return n;
  }

  /** The punch lands on whoever is still in reach. */
  punch(m: Mob, t: Target | null): void {
    this.setTele(m, null);
    this.server.playSound(m.dim, 'mob.guardian_sentinel.punch', m.x, m.y + 1.2, m.z, 1.2, 1);
    if (t && isAlive(t) && this.endMobs.inReach(m, t, 1.2)) this.endMobs.strike(m, t, m.def.damage ?? 8, 0.7);
  }

  /** Marks the bolt's line from the Sentinel's eye towards the target. Returns the line and the windup's length. */
  warnBolt(m: Mob, t: Target): { line: [number, number, number, number, number, number]; ticks: number } {
    const n = this.windup(m, SENTINEL_BOLT_TICKS);
    const ex = m.x;
    const ey = m.y + (m.def.eye ?? 2);
    const ez = m.z;
    const dx = t.x - ex;
    const dy = t.y + 1.1 - ey;
    const dz = t.z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const line: [number, number, number, number, number, number] = [ex, ey, ez, ex + (dx / d) * BOLT_RANGE, ey + (dy / d) * BOLT_RANGE, ez + (dz / d) * BOLT_RANGE];
    this.setTele(m, 'bolt');
    this.endMobs.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_beam', x: line[0], y: line[1], z: line[2], x1: line[3], y1: line[4], z1: line[5], ticks: n, color: WARN_BOLT });
    this.server.playSound(m.dim, 'mob.guardian_sentinel.charge', m.x, m.y + 2, m.z, 1.2, 1);
    return { line, ticks: n };
  }

  /** Fires the bolt along the line it showed: it hits the first thing in its way. */
  bolt(m: Mob, line: [number, number, number, number, number, number]): void {
    this.setTele(m, null);
    const s = this.server;
    const [x0, y0, z0, x1, y1, z1] = line;
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
    const pr = s.mobs!.projectile(m.dim, 'crystal_bolt', x0, y0, z0, m);
    pr.vx = ((x1 - x0) / len) * BOLT_SPEED;
    pr.vy = ((y1 - y0) / len) * BOLT_SPEED;
    pr.vz = ((z1 - z0) / len) * BOLT_SPEED;
    pr.life = Math.ceil(BOLT_RANGE / BOLT_SPEED) + 1;
    pr.onHit = (p, hit) => {
      const e = hit.entity;
      if (e && e !== m && !isConstruct(e.type) && (isPlayer(e) || e instanceof LivingEntity) && isAlive(e as Target)) this.endMobs.strike(m, e as Target, SENTINEL_BOLT_DAMAGE, 0.3);
      s.particles(p.dim as Dimension, 'end_rod', hit.x, hit.y, hit.z, 10, 0.3);
      s.playSound(p.dim as Dimension, 'mob.guardian_sentinel.hit', hit.x, hit.y, hit.z, 0.8, 1.2);
      return true;
    };
    s.playSound(m.dim, 'mob.guardian_sentinel.bolt', x0, y0, z0, 1.2, 1);
  }

  // ------------------------------------------------------------------ the Bulwark

  /** Wakes a dormant Bulwark (a player came into its room, or hurt it). */
  wake(m: Mob): void {
    if (m.data.awake) {
      m.data.awakeSeen = this.now;
      return;
    }
    m.data.awake = true;
    m.data.awakeSeen = this.now;
    m.metaDirty = true;
    this.server.playSound(m.dim, 'mob.guardian_bulwark.wake', m.x, m.y + 1.5, m.z, 1.5, 1);
    this.server.particles(m.dim, 'end_rod', m.x, m.y + 1.5, m.z, 16, 0.8);
  }

  /** Starts the pound: a ring of glowing cracks. Returns the windup's length. */
  warnPound(m: Mob): number {
    const n = this.windup(m, BULWARK_POUND_TICKS);
    this.setTele(m, 'pound');
    this.endMobs.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_cracks', x: m.x, y: Math.floor(m.y), z: m.z, r: BULWARK_POUND_RADIUS, ticks: n, color: WARN_CRACKS });
    this.server.playSound(m.dim, 'mob.guardian_bulwark.windup', m.x, m.y + 2, m.z, 1.4, 1);
    return n;
  }

  /** The pound lands: everyone in the ring is hit and thrown away from it, never towards the void. */
  pound(m: Mob): void {
    this.setTele(m, null);
    const s = this.server;
    s.playSound(m.dim, 'mob.guardian_bulwark.pound', m.x, m.y, m.z, 2, 1);
    s.particles(m.dim, 'explosion_smoke', m.x, m.y + 0.2, m.z, 20, BULWARK_POUND_RADIUS * 0.6);
    for (const p of s.players.values()) {
      if (p.dim !== m.dim || !isAlive(p)) continue;
      if (Math.hypot(p.x - m.x, p.z - m.z) > BULWARK_POUND_RADIUS + p.body.width / 2 || Math.abs(p.y - m.y) > 2.5) continue;
      this.endMobs.strike(m, p, m.def.damage ?? 14, 1.1, true);
    }
  }

  /** Raises the shield: half damage for its length. */
  shield(m: Mob): void {
    m.data.shieldUntil = this.now + BULWARK_SHIELD_TICKS;
    m.data.shield = true;
    m.metaDirty = true;
    this.server.playSound(m.dim, 'mob.guardian_bulwark.shield', m.x, m.y + 1.5, m.z, 1.2, 1);
  }

  shielded(m: Mob): boolean {
    return Number(m.data.shieldUntil ?? 0) > this.now;
  }

  // ------------------------------------------------------------------ hooks

  /** Damage a construct takes: halved behind a raised shield. */
  scaleDamage(m: Mob, amount: number, info: HurtInfo): number {
    if (m.type === 'guardian_bulwark') {
      const a = info.attacker;
      if (a && isPlayer(a) && !m.data.awake) this.wake(m);
      if (this.shielded(m) && info.source !== 'void' && info.source !== 'kill') {
        this.server.particles(m.dim, 'end_rod', m.x, m.y + 1.5, m.z, 6, 0.6);
        return amount * 0.5;
      }
    }
    return amount;
  }

  /** Every tick: the leash, the shield's end, the Bulwark going dormant. */
  mobTick(m: Mob): void {
    if (m.dead) return;
    // V6 phase 4: the Silent Bell holds it still (no thinking, no moving, no attack wound up)
    const silenced = Number(m.data.silenced ?? 0);
    if (silenced) {
      if (silenced > this.now) {
        m.noAi = true;
        m.target = null;
        m.stopNavigation();
        m.body.vx = m.body.vz = 0;
        if (m.data.tele) this.setTele(m, null);
        if (!m.data.stun) {
          m.data.stun = true;
          m.metaDirty = true;
        }
        if (this.now % 10 === 0) this.server.particles(m.dim, 'end_rod', m.x, m.y + m.def.height, m.z, 2, 0.3);
        return;
      }
      delete m.data.silenced;
      delete m.data.stun;
      m.noAi = false;
      m.metaDirty = true;
    }
    const h = this.home(m);
    // Never far from its post: drop whoever it was after and walk back
    if (this.fromHome(m) > this.leash(m)) {
      if (m.target) {
        m.target = null;
        m.metaDirty = true;
      }
      if (!m.navigating || this.now % 20 === 0) m.navigateTo(h[0] + 0.5, h[1], h[2] + 0.5, 1.1);
    }
    if (m.data.shield && !this.shielded(m)) {
      delete m.data.shield;
      delete m.data.shieldUntil;
      m.metaDirty = true;
    }
    if (m.type === 'guardian_bulwark' && m.data.awake) {
      if (m.target) m.data.awakeSeen = this.now;
      else if (this.now - Number(m.data.awakeSeen ?? 0) > BULWARK_SLEEP && this.fromHome(m) < 1.5) {
        delete m.data.awake;
        m.metaDirty = true;
        this.server.playSound(m.dim, 'mob.guardian_bulwark.sleep', m.x, m.y + 1, m.z, 1, 1);
      }
    }
  }

  /** A construct read back from a saved chunk forgets any attack it was winding up. */
  onRestore(m: Mob): void {
    delete m.data.tele;
    delete m.data.shield;
    delete m.data.shieldUntil;
  }

  onDeath(m: Mob, killer: ServerPlayer | null): void {
    this.server.particles(m.dim, 'end_rod', m.x, m.y + 1.2, m.z, 24, 0.8);
    if (killer && !m.admin && m.type === 'guardian_bulwark') this.server.interaction.grant(killer, 'kill_bulwark');
  }
}
