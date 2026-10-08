/**
 * V6 - The End Expansion, phase 5: the Dragon additions
 * (src/common/endExpansion/dragon.ts). New moves layered onto the classic
 * fight in TheEnd.ts, which keeps its 200 health, crystals, perching rhythm,
 * exit portal, respawn and the Voidbound and malware paths untouched:
 *  - VOID BREATH WAVE: it slows, inhales (a violet glow in its throat), the
 *    path is drawn on the ground, then a line of breath lies along it and
 *    fades over four seconds.
 *  - WING GUST: perched, it rears up, then blows everyone near the portal
 *    away from it: never more than six blocks, never past the island's edge.
 *  - ROAR: about once a perch; the screen shakes, a ring of light runs out
 *    and the Endermen nearby turn to look. No damage.
 *  - PILLAR WEAVE: some approaches start with a low weave through the
 *    pillars; the route is drawn first.
 *  - STRAFING DIVE: a shallow pass along a straight line marked by its
 *    shadow; its claws hurt whoever stays on the line.
 *  - CRYSTAL FURY: when a crystal breaks the others flare; for ten seconds
 *    the nearest one may fire at anyone camping its pillar after a charge.
 *  - EDGE STRIKE: a rare slam into the island's outer edge, never near the
 *    pillars, the portals, the Nest's way in or the gateways: a small crater
 *    of loose end stone that crumbles, put back when the fight ends (and
 *    saved until then).
 *  - DRAGON STORM: below a quarter of its health, a storm rolls over the
 *    island. Only weather: it never hurts anyone.
 * Every hit is shown first (24 ticks at least, 32 with company) and resolved
 * here when it lands.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Entity } from '../entity/Entity';
import type { EndCrystal } from '../entity/EndEntities';
import type { DragonFight } from './TheEnd';
import { Mob, approachAngle, isPlayer } from '../entity/Mob';
import { S, blocks, STATE_BLOCK, STATE_SOLID } from '../../common/registry/blocks';
import { Random } from '../../common/math/rng';
import { END_SPAWN, endPillars } from '../../common/gen/end';
import { EXPANSION_PORTAL_SITE } from '../../common/endExpansion/region';
import { DRAGON_X, DRAGON_TESTS, type DragonTest } from '../../common/endExpansion/dragon';

type P3 = [number, number, number];

/** How far one unit of push velocity carries a player (air then ground friction). */
const GUST_GLIDE = 7;
const BANNER: Record<'wave' | 'gust' | 'dive' | 'edge' | 'fury', string> = {
  wave: 'VOID BREATH WAVE',
  gust: 'WING GUST',
  dive: 'STRAFING DIVE',
  edge: 'EDGE STRIKE',
  fury: 'CRYSTAL FURY',
};

interface Wave {
  foe: Entity;
  from: P3;
  to: P3;
  fireAt: number;
  fired: boolean;
  id: number;
}

interface Dive {
  a: P3;
  b: P3;
  dir: [number, number];
  stage: 'position' | 'warn' | 'pass';
  until: number;
  hit: Set<Entity>;
  id: number;
}

interface Edge {
  x: number;
  y: number;
  z: number;
  stage: 'travel' | 'warn';
  slamAt: number;
  id: number;
}

interface Weave {
  route: P3[];
  i: number;
  ids: number[];
}

interface FuryShot {
  crystal: EndCrystal;
  target: ServerPlayer;
  from: P3;
  to: P3;
  at: number;
  id: number;
}

/** A gust's planned push for one player: how far, and where it ends. */
export interface GustPush {
  p: ServerPlayer;
  dist: number;
  to: [number, number];
  dir: [number, number];
}

export class DragonAdditions {
  /** Off: the classic fight exactly as before (the tuning simulation's "before"). */
  enabled = true;
  rng: { next(): number; int(n: number): number; chance(p: number): boolean } = new Random();
  private nextId = 9_600_000;
  private wave: Wave | null = null;
  private dive: Dive | null = null;
  private edge: Edge | null = null;
  private weave: Weave | null = null;
  /** Ticks a pillar weave added before the last perch (taken off the next wait, so perches come as often). */
  private weaveDebt = 0;
  private furyUntil = 0;
  private readonly shots: FuryShot[] = [];
  private readonly shotReady = new Map<ServerPlayer, number>();
  /** This perch's roar and gust. */
  private roarAt = -1;
  private gustAt = -1;
  private rearing = false;
  private roarUntil = 0;
  private readonly gusted = new Map<ServerPlayer, { until: number; safe: [number, number, number] }>();
  private storm = false;
  private readonly stormSent = new Set<ServerPlayer>();
  /** An Admin Panel test waiting for the dragon to land. */
  private pendingTest: DragonTest | null = null;
  /** Craters: what each changed block was (saved in the level until put back). */
  private readonly restore = new Map<string, number>();
  private readonly crumbles: { keys: string[]; at: number }[] = [];
  /** Counters for the tuning simulation (and the docs). */
  readonly stats = { waves: 0, gusts: 0, roars: 0, weaves: 0, dives: 0, furyShots: 0, edges: 0 };

  constructor(
    private readonly server: GameServer,
    private readonly fight: DragonFight,
  ) {
    const saved = (server.level.flags as { dragonRestore?: [string, number][] }).dragonRestore;
    if (Array.isArray(saved)) for (const [k, s] of saved) if (typeof k === 'string' && Number.isFinite(s)) this.restore.set(k, s);
  }

  private get dim(): Dimension {
    return this.server.dim('end');
  }

  private now(): number {
    return this.server.tickNo;
  }

  telegraph(players: ServerPlayer[]): number {
    return players.length > 1 ? 32 : 24;
  }

  private fx(players: ServerPlayer[], msg: Record<string, unknown>): void {
    for (const p of players) p.send({ t: 'fx', ...msg } as never);
  }

  private banner(players: ServerPlayer[], what: keyof typeof BANNER, ticks: number): void {
    this.fx(players, { kind: 'hack', text: BANNER[what], strength: 0, ticks: Math.max(30, ticks) });
  }

  private endFx(players: ServerPlayer[], id: number): void {
    this.fx(players, { kind: 'warn_end', id });
  }

  private hurt(m: Mob, e: Entity, amount: number, kbx: number, kbz: number, kb: number): void {
    if (isPlayer(e)) {
      if (e.gamemode === 'creative' || e.gamemode === 'spectator' || e.dead) return;
      this.server.interaction.survival.damage(e, amount, { source: 'mob', attacker: m, kbx, kbz, knockback: kb });
    } else if (e instanceof Mob && !e.dead) e.hurt(amount, { source: 'mob', attacker: m, kbx, kbz, knockback: kb });
  }

  /** Who the new attacks can strike: survival players and Voidbound Endermen. */
  private foes(players: ServerPlayer[]): Entity[] {
    return [...players.filter((p) => p.gamemode !== 'creative'), ...this.fight.voidbound()];
  }

  /** Top solid block at (x, z) between y0 + up and y0 - down, or null (void). */
  private ground(x: number, z: number, y0: number, up = 3, down = 8): number | null {
    const dim = this.dim;
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    if (!dim.isLoaded(fx, fz)) return null;
    for (let y = Math.floor(y0) + up; y >= Math.floor(y0) - down; y--) if (STATE_SOLID[dim.getState(fx, y, fz)]) return y;
    return null;
  }

  // ------------------------------------------------------------------ the fight's hooks

  /** Every live tick of the fight, after the classic moves. */
  tick(m: Mob, players: ServerPlayer[]): void {
    if (!this.enabled) return;
    const phase = this.fight.phase;
    // An attack cut short (the fight moved on): clear what it showed
    if (this.wave && phase !== 'wave') this.cancelWave(players);
    if (this.dive && phase !== 'dive') this.cancelDive(players);
    if (this.edge && phase !== 'edge') this.cancelEdge(players);
    if (this.weave && phase !== 'weave') this.endWeave(players);
    if (phase !== 'perch' && this.rearing) {
      this.rearing = false;
      delete m.data.rear;
      m.metaDirty = true;
    }
    this.furyTick(m, players);
    this.gustGuard();
    this.roarGaze();
    this.crumbleTick();
    this.stormTick(m, players);
  }

  /** No live dragon (between fights, or it was put away): craters go back, the storm ends. */
  idle(): void {
    if (this.storm || this.stormSent.size) this.setStorm(false);
    if (this.now() % 20 === 0) this.restoreTick(false);
  }

  /** The fight is over (won, the secret ending, or everyone left): put the island back. */
  end(): void {
    const players = [...this.server.players.values()].filter((p) => p.dim === this.dim);
    this.cancelWave(players);
    this.cancelDive(players);
    this.cancelEdge(players);
    this.endWeave(players);
    for (const s of this.shots) this.endFx(players, s.id);
    this.shots.length = 0;
    this.furyUntil = 0;
    this.pendingTest = null;
    this.setStorm(false);
    this.restoreTick(true);
  }

  /** Whether the classic body contact is off (the dive and the slam resolve their own hits). */
  noContact(): boolean {
    return this.enabled && (this.fight.phase === 'dive' || this.fight.phase === 'edge');
  }

  /** Ticks to take off the next wait between perches (time a weave added to the last one). */
  takeDebt(): number {
    const d = this.weaveDebt;
    this.weaveDebt = 0;
    return d;
  }

  /** An approach has been decided: sometimes it weaves through the pillars first. */
  weaveFirst(m: Mob, players: ServerPlayer[]): boolean {
    if (!this.enabled || !this.rng.chance(DRAGON_X.weaveChance)) return false;
    return this.startWeave(m, players);
  }

  /**
   * In its holding pattern, with a foe and an attack due: maybe one of the
   * new ones instead of a strafe or a charge. Returns false to leave the
   * classic choice as it was.
   */
  pickAttack(m: Mob, foe: Entity, players: ServerPlayer[]): boolean {
    if (!this.enabled) return false;
    const r = this.rng.next();
    if (r < DRAGON_X.waveChance) return this.startWave(m, foe, players);
    if (r < DRAGON_X.waveChance + DRAGON_X.diveChance) return this.startDive(m, foe, players);
    if (r < DRAGON_X.waveChance + DRAGON_X.diveChance + DRAGON_X.edgeChance) return this.startEdge(m, foe, players);
    return false;
  }

  /** Flight in the new phases. */
  fly(m: Mob, players: ServerPlayer[]): void {
    switch (this.fight.phase) {
      case 'wave':
        return this.waveFly(m, players);
      case 'dive':
        return this.diveFly(m, players);
      case 'edge':
        return this.edgeFly(m, players);
      case 'weave':
        return this.weaveFly(m);
      default:
        return;
    }
  }

  /** Perched: the roar and the wing gust (the classic perch attacks run as before). */
  perch(m: Mob, players: ServerPlayer[], pt: number, py: number): void {
    if (!this.enabled) return;
    if (pt === 1) {
      // This perch's roar (about once a perch) and its gust
      this.roarAt = this.rng.chance(0.85) ? 15 + this.rng.int(40) : -1;
      this.gustAt = 104;
      if (this.pendingTest === 'roar') this.roarAt = 6;
      if (this.pendingTest === 'wing_gust') this.gustAt = 6;
      this.pendingTest = null;
    }
    if (pt === this.roarAt) this.roar(m, players, py);
    if (pt === this.gustAt) {
      // It rears up: the gust comes when it beats its wings down
      const tele = Math.max(DRAGON_X.gustRear, this.telegraph(players));
      this.rearing = true;
      m.data.rear = true;
      m.metaDirty = true;
      this.banner(players, 'gust', tele);
      this.fx(players, { kind: 'warn_circle', id: this.nextId++, x: 0.5, y: py + 0.1, z: 0.5, r: DRAGON_X.gustRadius, ticks: tele, color: 0xd8c8ff });
      this.server.playSound(m.dim, 'dragon.wings', m.x, m.y, m.z, 4, 0.5);
      this.gustAt = -pt - tele;
    }
    if (this.gustAt < 0 && pt === -this.gustAt) {
      this.gustAt = -1;
      this.rearing = false;
      delete m.data.rear;
      m.metaDirty = true;
      this.gust(m, players, py);
    }
  }

  /** A crystal broke: the others flare, and for a while they guard their pillars. */
  onCrystalDestroyed(): void {
    if (!this.enabled) return;
    const m = this.fight.dragon;
    if (!m || m.dead) return;
    this.startFury();
  }

  // ------------------------------------------------------------------ Void Breath Wave

  private startWave(m: Mob, foe: Entity, players: ServerPlayer[]): boolean {
    const dx = foe.x - m.x;
    const dz = foe.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 4 || d > 90) return false;
    const ux = dx / d;
    const uz = dz / d;
    const back = 8;
    const ahead = DRAGON_X.breathLength - back;
    const y = Math.floor(foe.y) + 0.1;
    const from: P3 = [foe.x - ux * back, y, foe.z - uz * back];
    const to: P3 = [foe.x + ux * ahead, y, foe.z + uz * ahead];
    const tele = Math.max(DRAGON_X.breathInhale, this.telegraph(players));
    this.wave = { foe, from, to, fireAt: this.now() + tele, fired: false, id: this.nextId++ };
    this.fight.setPhase('wave');
    m.data.inhale = true;
    m.metaDirty = true;
    this.banner(players, 'wave', tele);
    this.fx(players, { kind: 'warn_beam', id: this.wave.id, x: from[0], y, z: from[2], x1: to[0], y1: y, z1: to[2], ticks: tele, color: 0xa040ff });
    this.server.playSound(m.dim, 'dragon.inhale', m.x, m.y, m.z, 4, 0.7);
    this.stats.waves++;
    return true;
  }

  private waveFly(m: Mob, players: ServerPlayer[]): void {
    const w = this.wave;
    if (!w) return this.fight.endAttack();
    const b = m.body;
    // It all but stops in the air, facing down its path
    b.vx *= 0.85;
    b.vy *= 0.85;
    b.vz *= 0.85;
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
    const cx = (w.from[0] + w.to[0]) / 2;
    const cz = (w.from[2] + w.to[2]) / 2;
    m.yaw = approachAngle(m.yaw, Math.atan2(-(cx - b.x), -(cz - b.z)), 0.1);
    m.headYaw = m.yaw;
    const t = this.now();
    if (!w.fired && t >= w.fireAt) {
      w.fired = true;
      delete m.data.inhale;
      m.metaDirty = true;
      this.endFx(players, w.id);
      this.server.playSound(m.dim, 'dragon.breath_wave', m.x, m.y, m.z, 5, 0.8);
    }
    if (w.fired) {
      // The breath runs along the marked line, a few blocks a tick, and lies there fading
      const k = t - w.fireAt;
      const steps = Math.ceil(DRAGON_X.breathLength / 2);
      for (const s of [k * 2, k * 2 + 1]) {
        if (s > steps) continue;
        const f = s / steps;
        const x = w.from[0] + (w.to[0] - w.from[0]) * f;
        const z = w.from[2] + (w.to[2] - w.from[2]) * f;
        const gy = this.ground(x, z, w.from[1], 2, 6);
        if (gy === null) continue;
        this.fight.breathCloud(x, gy + 1, z, m, 1.6, DRAGON_X.breathFade);
      }
      if (k * 2 > steps + 4) {
        this.wave = null;
        this.fight.endAttack();
      }
    }
  }

  private cancelWave(players: ServerPlayer[]): void {
    const w = this.wave;
    if (!w) return;
    this.wave = null;
    if (!w.fired) this.endFx(players, w.id);
    const m = this.fight.dragon;
    if (m) {
      delete m.data.inhale;
      m.metaDirty = true;
    }
  }

  // ------------------------------------------------------------------ Wing Gust

  /**
   * Where a gust would push each player near the portal: straight away from
   * it, at most six blocks, and only as far as the island carries on at
   * least three blocks beyond (never off the edge, never towards the void).
   */
  gustPlan(players: ServerPlayer[], py: number): GustPush[] {
    const out: GustPush[] = [];
    for (const p of players) {
      if (p.gamemode === 'creative' || p.dead) continue;
      const dx = p.x - 0.5;
      const dz = p.z - 0.5;
      const d = Math.hypot(dx, dz);
      if (d > DRAGON_X.gustRadius || p.y < py - 3 || p.y > py + 10) continue;
      const ux = d > 0.3 ? dx / d : 1;
      const uz = d > 0.3 ? dz / d : 0;
      let dist = 0;
      for (let s = 0.5; s <= DRAGON_X.gustMax; s += 0.5) {
        let ok = true;
        for (let k = s; k <= s + 3 && ok; k += 0.5) if (this.ground(p.x + ux * k, p.z + uz * k, p.y, 2, 4) === null) ok = false;
        if (!ok) break;
        dist = s;
      }
      out.push({ p, dist, to: [p.x + ux * dist, p.z + uz * dist], dir: [ux, uz] });
    }
    return out;
  }

  private gust(m: Mob, players: ServerPlayer[], py: number): void {
    this.stats.gusts++;
    this.server.playSound(m.dim, 'dragon.gust', m.x, m.y, m.z, 5, 0.7);
    this.server.particles(m.dim, 'explosion_smoke', 0.5, py + 1, 0.5, 40, 6);
    this.fx(players, { kind: 'shockwave', x: 0.5, y: py + 0.2, z: 0.5, r: DRAGON_X.gustRadius, ticks: 12, color: 0xd8c8ff });
    for (const g of this.gustPlan(players, py)) {
      if (g.dist < 1) continue;
      const v = g.dist / GUST_GLIDE;
      g.p.send({ t: 'velocity', id: g.p.id, vx: g.dir[0] * v, vy: 0.3, vz: g.dir[1] * v });
      this.gusted.set(g.p, { until: this.now() + 40, safe: [g.to[0], g.p.y, g.to[1]] });
    }
    // Voidbound Endermen are blown back too (they never fall: they keep their footing at the edge)
    for (const e of this.fight.voidbound()) {
      const dx = e.x - 0.5;
      const dz = e.z - 0.5;
      const d = Math.hypot(dx, dz);
      if (d > DRAGON_X.gustRadius || d < 0.3) continue;
      e.body.vx += (dx / d) * 0.6;
      e.body.vz += (dz / d) * 0.6;
    }
  }

  /** A gusted player who overshoots towards the void is set down where the gust meant to leave them. */
  private gustGuard(): void {
    if (!this.gusted.size) return;
    const t = this.now();
    for (const [p, g] of this.gusted) {
      if (t > g.until || p.dead || p.dim !== this.dim) {
        this.gusted.delete(p);
        continue;
      }
      if (this.ground(p.x, p.z, p.y, 0, 6) === null) {
        this.gusted.delete(p);
        this.server.teleport(p, g.safe[0], g.safe[1], g.safe[2]);
      }
    }
  }

  // ------------------------------------------------------------------ Roar

  private roar(m: Mob, players: ServerPlayer[], py: number): void {
    this.stats.roars++;
    this.server.playSound(m.dim, 'dragon.roar', m.x, m.y, m.z, 8, 0.9);
    for (const p of players) {
      const d = Math.hypot(p.x, p.z);
      if (d < 96) p.send({ t: 'fx', kind: 'shake', strength: Math.max(0.25, 1 - d / 96), ticks: 30 });
    }
    this.fx(players, { kind: 'shockwave', x: 0.5, y: py + 0.3, z: 0.5, r: 36, ticks: 30, color: 0xb070ff });
    this.server.particles(m.dim, 'void_burst', m.x, m.y + 3, m.z, 30, 3);
    this.roarUntil = this.now() + 40;
  }

  /** For a moment after a roar every Enderman within 48 blocks turns to look at the portal. */
  private roarGaze(): void {
    if (this.now() > this.roarUntil) return;
    const py = this.fight.portalY();
    for (const e of this.dim.entitiesNear(0.5, py, 0.5, 48, (x) => x instanceof Mob && x.type === 'enderman')) {
      const mob = e as Mob;
      if (mob.dead || mob.target) continue;
      mob.lookAt = { x: 0.5, y: py + 5, z: 0.5 };
    }
  }

  // ------------------------------------------------------------------ Pillar Weave

  private startWeave(m: Mob, players: ServerPlayer[]): boolean {
    const pillars = endPillars(this.server.level.seedNum);
    const py = this.fight.portalY();
    const a0 = Math.atan2(m.z, m.x);
    // The pillar nearest it, then four more round the ring, passing inside and outside them in turn
    let start = 0;
    let best = Infinity;
    pillars.forEach((p, i) => {
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(p.z, p.x) - a0), Math.cos(Math.atan2(p.z, p.x) - a0)));
      if (da < best) {
        best = da;
        start = i;
      }
    });
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const route: P3[] = [];
    for (let k = 0; k < 5; k++) {
      const p = pillars[(start + dir * k + pillars.length * 5) % pillars.length]!;
      const a = Math.atan2(p.z, p.x);
      const r = 42 + (k % 2 === 0 ? -(p.radius + 8) : p.radius + 8);
      route.push([Math.cos(a) * r, Math.min(p.height - 6, py + 16 + (k % 2) * 4), Math.sin(a) * r]);
    }
    const ids: number[] = [];
    let prev: P3 = [m.x, m.y, m.z];
    for (const w of route) {
      const id = this.nextId++;
      ids.push(id);
      this.fx(players, { kind: 'warn_beam', id, x: prev[0], y: prev[1], z: prev[2], x1: w[0], y1: w[1], z1: w[2], ticks: DRAGON_X.weaveTicks, color: 0x8a6aff });
      prev = w;
    }
    this.weave = { route, i: 0, ids };
    this.fight.setPhase('weave');
    this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 4, 1.1);
    this.stats.weaves++;
    return true;
  }

  private weaveFly(m: Mob): void {
    const w = this.weave;
    if (!w) return this.fight.setPhase('approach');
    const t = w.route[w.i]!;
    if (this.fight.steer(m, t[0], t[1], t[2], 0.75, 0.2) < 5) w.i++;
    const pt = this.fight.ticksInPhase();
    if (w.i >= w.route.length || pt > DRAGON_X.weaveTicks) {
      this.weaveDebt += pt;
      this.endWeave(this.fight.playersInEnd());
      this.fight.setPhase('approach');
    }
  }

  private endWeave(players: ServerPlayer[]): void {
    const w = this.weave;
    if (!w) return;
    this.weave = null;
    for (const id of w.ids) this.endFx(players, id);
  }

  // ------------------------------------------------------------------ Strafing Dive

  /** Whether a straight pass at height y from a to b clears the pillars and the portal's column. */
  private clearLine(a: P3, b: P3, y: number): boolean {
    const py = this.fight.portalY();
    for (const p of endPillars(this.server.level.seedNum)) {
      if (p.height < y - 2) continue;
      if (segDist2(p.x + 0.5, p.z + 0.5, a[0], a[2], b[0], b[2]) < p.radius + 4) return false;
    }
    if (y < py + 6 && segDist2(0.5, 0.5, a[0], a[2], b[0], b[2]) < 2.5) return false;
    return true;
  }

  private startDive(m: Mob, foe: Entity, players: ServerPlayer[]): boolean {
    const base = Math.atan2(foe.z - m.z, foe.x - m.x);
    const y = Math.floor(foe.y) + 2;
    const L = DRAGON_X.diveHalfLength;
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
      const ux = Math.cos(base + off);
      const uz = Math.sin(base + off);
      const a: P3 = [foe.x - ux * L, y, foe.z - uz * L];
      const b: P3 = [foe.x + ux * L, y, foe.z + uz * L];
      if (!this.clearLine(a, b, y)) continue;
      this.dive = { a, b, dir: [ux, uz], stage: 'position', until: this.now() + 160, hit: new Set(), id: this.nextId++ };
      this.fight.setPhase('dive');
      this.stats.dives++;
      void players;
      return true;
    }
    return false;
  }

  private diveFly(m: Mob, players: ServerPlayer[]): void {
    const d = this.dive;
    if (!d) return this.fight.endAttack();
    const t = this.now();
    const b = m.body;
    if (d.stage === 'position') {
      const dist = this.fight.steer(m, d.a[0], d.a[1] + 10, d.a[2], 0.8, 0.15);
      if (t > d.until) {
        this.dive = null;
        return this.fight.endAttack();
      }
      if (dist < 6) {
        const tele = Math.max(DRAGON_X.diveWarn, this.telegraph(players));
        d.stage = 'warn';
        d.until = t + tele;
        this.banner(players, 'dive', tele);
        // Its shadow runs ahead along the line it will take
        const gy = d.a[1] - 1.9;
        this.fx(players, { kind: 'warn_beam', id: d.id, x: d.a[0], y: gy, z: d.a[2], x1: d.b[0], y1: gy, z1: d.b[2], ticks: tele + 60, color: 0x2a1040 });
        this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 5, 0.7);
      }
      return;
    }
    const want = Math.atan2(-d.dir[0], -d.dir[1]);
    m.yaw = approachAngle(m.yaw, want, 0.25);
    m.headYaw = m.yaw;
    if (d.stage === 'warn') {
      // It hangs at the start of the line, dropping to the height of the pass
      const left = Math.max(1, d.until - t);
      b.vx = (d.a[0] - b.x) / left;
      b.vy = (d.a[1] - b.y) / left;
      b.vz = (d.a[2] - b.z) / left;
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
      m.pitch = 0.3;
      if (t >= d.until) d.stage = 'pass';
      return;
    }
    // The pass: straight along the marked line
    const v = DRAGON_X.diveSpeed;
    b.vx = d.dir[0] * v;
    b.vy = 0;
    b.vz = d.dir[1] * v;
    b.x += b.vx;
    b.z += b.vz;
    b.y = d.a[1];
    m.pitch = 0;
    for (const e of this.foes(players)) {
      if (d.hit.has(e)) continue;
      // Only on the marked line, and only where the dragon is now
      if (segDist2(e.x, e.z, d.a[0], d.a[2], d.b[0], d.b[2]) > DRAGON_X.diveWidth) continue;
      if (Math.hypot(e.x - b.x, e.z - b.z) > DRAGON_X.diveWidth + 1.5 || Math.abs(e.y - (d.a[1] - 2)) > 3) continue;
      d.hit.add(e);
      // Thrown sideways off the line (never along it)
      const side = (e.x - b.x) * -d.dir[1] + (e.z - b.z) * d.dir[0] >= 0 ? 1 : -1;
      this.hurt(m, e, DRAGON_X.diveDamage, -d.dir[1] * side, d.dir[0] * side, 1.0);
    }
    if ((b.x - d.a[0]) * d.dir[0] + (b.z - d.a[2]) * d.dir[1] >= DRAGON_X.diveHalfLength * 2) {
      this.endFx(players, d.id);
      this.dive = null;
      this.fight.endAttack();
    }
  }

  private cancelDive(players: ServerPlayer[]): void {
    const d = this.dive;
    if (!d) return;
    this.dive = null;
    if (d.stage !== 'position') this.endFx(players, d.id);
  }

  // ------------------------------------------------------------------ Crystal Fury

  private startFury(): void {
    const players = this.fight.playersInEnd();
    this.furyUntil = this.now() + DRAGON_X.furyTicks;
    for (const c of this.fight.crystals()) {
      if (c.removed) continue;
      this.server.particles(this.dim, 'crystal_glint', c.x, c.y + 1, c.z, 24, 1.2);
      this.fx(players, { kind: 'pulse', x: c.x, y: c.y + 1, z: c.z, r: 6, ticks: 20 });
    }
    if (players.length) this.server.playSound(this.dim, 'crystal.fury', 0.5, this.fight.portalY() + 30, 0.5, 8, 1);
  }

  /** Pillars that still carry a crystal, with that crystal. */
  private crystalPillars(): { c: EndCrystal; x: number; z: number }[] {
    const out: { c: EndCrystal; x: number; z: number }[] = [];
    const pillars = endPillars(this.server.level.seedNum);
    for (const c of this.fight.crystals()) {
      const p = pillars.find((q) => Math.abs(c.x - (q.x + 0.5)) < 2 && Math.abs(c.z - (q.z + 0.5)) < 2);
      if (p) out.push({ c, x: p.x + 0.5, z: p.z + 0.5 });
    }
    return out;
  }

  private furyTick(m: Mob, players: ServerPlayer[]): void {
    const t = this.now();
    // Shots resolve where they were aimed
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (t < s.at) continue;
      this.shots.splice(i, 1);
      this.endFx(players, s.id);
      if (s.crystal.removed) continue;
      this.fx(players, { kind: 'laser', id: this.nextId++, x: s.from[0], y: s.from[1], z: s.from[2], x1: s.to[0], y1: s.to[1], z1: s.to[2], ticks: 8, color: 0xff70e0 });
      this.server.playSound(this.dim, 'crystal.fire', s.from[0], s.from[1], s.from[2], 3, 1);
      const p = s.target;
      if (p.dead || p.dim !== this.dim) continue;
      // Hit only if they are still on the line it charged
      if (dist3Seg(p.x, p.y + 1, p.z, s.from, s.to) <= 1.1) {
        this.stats.furyShots++;
        this.server.interaction.survival.damage(p, DRAGON_X.furyDamage, { source: 'magic', attacker: m });
      }
    }
    if (t >= this.furyUntil || t % 5 !== 0) return;
    const live = this.crystalPillars();
    if (!live.length) return;
    const tele = Math.max(DRAGON_X.furyCharge, this.telegraph(players));
    for (const p of players) {
      if (p.gamemode === 'creative' || p.dead || (this.shotReady.get(p) ?? 0) > t) continue;
      if (this.shots.some((s) => s.target === p)) continue;
      // The crystal nearest them, if they are camping its pillar
      let near: { c: EndCrystal; x: number; z: number } | null = null;
      let nd = Infinity;
      for (const q of live) {
        const dd = Math.hypot(p.x - q.c.x, p.y - q.c.y, p.z - q.c.z);
        if (dd < nd) {
          nd = dd;
          near = q;
        }
      }
      if (!near || Math.hypot(p.x - near.x, p.z - near.z) > DRAGON_X.furyRadius) continue;
      const from: P3 = [near.c.x, near.c.y + 1, near.c.z];
      // Aimed through where they stand, a little past them
      const to0: P3 = [p.x, p.y + 1, p.z];
      const len = Math.hypot(to0[0] - from[0], to0[1] - from[1], to0[2] - from[2]) || 1;
      const to: P3 = [from[0] + ((to0[0] - from[0]) / len) * (len + 3), from[1] + ((to0[1] - from[1]) / len) * (len + 3), from[2] + ((to0[2] - from[2]) / len) * (len + 3)];
      const id = this.nextId++;
      this.shots.push({ crystal: near.c, target: p, from, to, at: t + tele, id });
      this.shotReady.set(p, t + tele + 30);
      this.banner([p], 'fury', tele);
      this.fx(players, { kind: 'warn_beam', id, x: from[0], y: from[1], z: from[2], x1: to[0], y1: to[1], z1: to[2], ticks: tele, color: 0xff70e0 });
      this.server.playSound(this.dim, 'crystal.charge', from[0], from[1], from[2], 3, 1);
    }
  }

  // ------------------------------------------------------------------ Edge Strike

  /** Places a crater may never reach: pillars, the exit portal, the Expansion Portal, the Nest's way in, gateways, the spawn platform. */
  protectedSpots(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const p of endPillars(this.server.level.seedNum)) out.push({ x: p.x + 0.5, z: p.z + 0.5, r: p.radius });
    out.push({ x: 0.5, z: 0.5, r: 16 });
    out.push({ x: EXPANSION_PORTAL_SITE.x + 0.5, z: EXPANSION_PORTAL_SITE.z + 0.5, r: 6 });
    const nest = this.server.endStructures?.nestPlan?.();
    if (nest) out.push({ x: nest.entrance[0] + 0.5, z: nest.entrance[2] + 0.5, r: 4 });
    for (let n = 0; n < 20; n++) {
      const g = this.fight.ringGateway(n);
      out.push({ x: g.x + 0.5, z: g.z + 0.5, r: 3 });
    }
    out.push({ x: END_SPAWN.x + 0.5, z: END_SPAWN.z + 0.5, r: 3 });
    return out;
  }

  /** A spot on the island's outer edge, away from the portal and everything protected, or null. */
  edgeSite(): P3 | null {
    const py = this.fight.portalY();
    const keep = this.protectedSpots();
    for (let tries = 0; tries < 16; tries++) {
      const a = this.rng.next() * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      // Walk out from the portal to where the island ends
      let last: number | null = null;
      let lastY = 0;
      let gap = 0;
      for (let r = 20; r < 140; r++) {
        const gy = this.ground(ux * r, uz * r, py, 12, 20);
        if (gy !== null && blocks[STATE_BLOCK[this.dim.getState(Math.floor(ux * r), gy, Math.floor(uz * r))]!]!.id === 'end_stone') {
          last = r;
          lastY = gy;
          gap = 0;
        } else if (last !== null && ++gap >= 3) break;
        if (!this.dim.isLoaded(Math.floor(ux * r), Math.floor(uz * r))) {
          last = null;
          break;
        }
      }
      if (last === null || last < 26) continue;
      const r = last - 2;
      const x = Math.floor(ux * r);
      const z = Math.floor(uz * r);
      const R = DRAGON_X.edgeRadius + DRAGON_X.edgeKeepOut;
      if (keep.some((k) => Math.hypot(x + 0.5 - k.x, z + 0.5 - k.z) < R + k.r)) continue;
      const y = this.ground(x, z, lastY, 3, 3);
      if (y === null) continue;
      return [x, y, z];
    }
    return null;
  }

  private startEdge(m: Mob, foe: Entity, players: ServerPlayer[]): boolean {
    void foe;
    const site = this.edgeSite();
    if (!site) return false;
    this.edge = { x: site[0], y: site[1], z: site[2], stage: 'travel', slamAt: this.now() + 180, id: this.nextId++ };
    this.fight.setPhase('edge');
    this.stats.edges++;
    void players;
    return true;
  }

  private edgeFly(m: Mob, players: ServerPlayer[]): void {
    const e = this.edge;
    if (!e) return this.fight.endAttack();
    const t = this.now();
    if (e.stage === 'travel') {
      const dist = this.fight.steer(m, e.x + 0.5, e.y + 22, e.z + 0.5, 0.8, 0.15);
      if (t > e.slamAt) {
        this.edge = null;
        return this.fight.endAttack();
      }
      if (dist < 8) {
        const tele = Math.max(DRAGON_X.edgeWarn, this.telegraph(players));
        e.stage = 'warn';
        e.slamAt = t + tele;
        this.banner(players, 'edge', tele);
        this.fx(players, { kind: 'warn_circle', id: e.id, x: e.x + 0.5, y: e.y + 1.05, z: e.z + 0.5, r: DRAGON_X.edgeRadius + 1, ticks: tele, color: 0xff6a6a });
        this.server.playSound(m.dim, 'dragon.growl', m.x, m.y, m.z, 5, 0.6);
      }
      return;
    }
    // Hovering over the mark, then down onto it at the last moment
    const left = e.slamAt - t;
    const b = m.body;
    const ty = left > 10 ? e.y + 22 : e.y + 2;
    const k = left > 10 ? 0.1 : 1 / Math.max(1, left);
    b.vx = (e.x + 0.5 - b.x) * k;
    b.vy = (ty - b.y) * k;
    b.vz = (e.z + 0.5 - b.z) * k;
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
    m.pitch = left > 10 ? 0 : 0.6;
    if (left > 0) return;
    this.edge = null;
    this.endFx(players, e.id);
    this.slam(m, players, e);
    this.fight.endAttack();
  }

  private cancelEdge(players: ServerPlayer[]): void {
    const e = this.edge;
    if (!e) return;
    this.edge = null;
    if (e.stage === 'warn') this.endFx(players, e.id);
  }

  private slam(m: Mob, players: ServerPlayer[], e: Edge): void {
    const dim = this.dim;
    const R = DRAGON_X.edgeRadius;
    const loose = S('loose_end_stone');
    const keys: string[] = [];
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const r = Math.hypot(dx, dz);
        if (r > R + 0.3) continue;
        const x = e.x + dx;
        const z = e.z + dz;
        const top = this.ground(x, z, e.y, 2, 3);
        if (top === null) continue;
        const dig = r <= 1.2 ? 2 : r <= 2.3 ? 1 : 0;
        for (let i = 0; i <= dig; i++) {
          const y = top - i;
          if (blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id !== 'end_stone') break;
          const key = `${x},${y},${z}`;
          if (!this.restore.has(key)) this.restore.set(key, dim.getState(x, y, z));
          if (i < dig) dim.setBlock(x, y, z, 0);
          else {
            dim.setBlock(x, y, z, loose);
            keys.push(key);
          }
        }
      }
    }
    this.saveRestore();
    this.crumbles.push({ keys, at: this.now() + 60 });
    this.server.playSound(dim, 'dragon.edge', e.x + 0.5, e.y + 1, e.z + 0.5, 6, 0.8);
    this.server.particles(dim, 'explosion', e.x + 0.5, e.y + 1, e.z + 0.5, 6, 2);
    this.server.particles(dim, 'block', e.x + 0.5, e.y + 1, e.z + 0.5, 40, 2.5, S('end_stone'));
    for (const p of players) {
      const d = Math.hypot(p.x - (e.x + 0.5), p.z - (e.z + 0.5));
      if (d < 40) p.send({ t: 'fx', kind: 'shake', strength: Math.max(0.2, 0.8 - d / 50), ticks: 16 });
    }
    // The loose stone gives way in three seconds: shown as cracks until it does
    this.fx(players, { kind: 'warn_cracks', id: this.nextId++, x: e.x + 0.5, y: e.y + 0.6, z: e.z + 0.5, r: R + 0.5, ticks: 60, color: 0xc8c08a });
    // Thrown inwards, towards the island's middle (never out over the edge)
    for (const f of this.foes(players)) {
      const d = Math.hypot(f.x - (e.x + 0.5), f.z - (e.z + 0.5));
      if (d > R + 1 || Math.abs(f.y - (e.y + 1)) > 3) continue;
      const l = Math.hypot(f.x, f.z) || 1;
      this.hurt(m, f, DRAGON_X.edgeDamage, -f.x / l, -f.z / l, 1.0);
    }
  }

  private crumbleTick(): void {
    const t = this.now();
    const dim = this.dim;
    const loose = S('loose_end_stone');
    for (let i = this.crumbles.length - 1; i >= 0; i--) {
      const c = this.crumbles[i]!;
      if (t < c.at) continue;
      this.crumbles.splice(i, 1);
      for (const key of c.keys) {
        const [x, y, z] = key.split(',').map(Number) as P3;
        if (!dim.isLoaded(x, z) || blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id !== 'loose_end_stone') continue;
        dim.setBlock(x, y, z, 0);
        this.server.particles(dim, 'block', x + 0.5, y + 0.5, z + 0.5, 6, 0.4, loose);
      }
    }
  }

  /** Puts the craters back (only where nothing else was put since). */
  private restoreTick(all: boolean): void {
    if (!this.restore.size) return;
    const dim = this.dim;
    let changed = false;
    for (const [key, state] of this.restore) {
      const [x, y, z] = key.split(',').map(Number) as P3;
      if (!dim.isLoaded(x, z)) continue;
      const now = dim.getState(x, y, z);
      const id = blocks[STATE_BLOCK[now]!]!.id;
      if (now === 0 || id === 'loose_end_stone') dim.setBlock(x, y, z, state);
      this.restore.delete(key);
      changed = true;
    }
    if (all) this.crumbles.length = 0;
    if (changed) this.saveRestore();
  }

  private saveRestore(): void {
    const f = this.server.level.flags as { dragonRestore?: [string, number][] };
    if (this.restore.size) f.dragonRestore = [...this.restore];
    else delete f.dragonRestore;
  }

  /** Blocks a crater changed that are still waiting to be put back. */
  pendingRestore(): number {
    return this.restore.size;
  }

  // ------------------------------------------------------------------ Dragon Storm

  private stormTick(m: Mob, players: ServerPlayer[]): void {
    const want = this.storm || m.health <= m.maxHealth * DRAGON_X.stormBelow;
    if (want && !this.storm) this.setStorm(true);
    if (!this.storm) return;
    for (const p of players) {
      if (this.stormSent.has(p)) continue;
      this.stormSent.add(p);
      p.send({ t: 'fx', kind: 'dragon_storm', strength: 1 });
    }
    if (this.now() % 60 === 0 && this.rng.chance(0.35)) {
      // Thunder far off over the island (light and sound only)
      const a = this.rng.next() * Math.PI * 2;
      const r = 30 + this.rng.int(50);
      for (const p of players) p.send({ t: 'fx', kind: 'bolt', x: Math.cos(a) * r, y: this.fight.portalY() + 40, z: Math.sin(a) * r, ticks: 8 });
      this.server.playSound(this.dim, 'storm.rumble', Math.cos(a) * r, this.fight.portalY() + 20, Math.sin(a) * r, 10, 0.7);
    }
  }

  private setStorm(on: boolean): void {
    if (on) {
      this.storm = true;
      return;
    }
    this.storm = false;
    for (const p of this.stormSent) p.send({ t: 'fx', kind: 'dragon_storm', strength: 0 });
    this.stormSent.clear();
  }

  get storming(): boolean {
    return this.storm;
  }

  // ------------------------------------------------------------------ Admin Panel

  /** Shows one of the new moves now (the Admin Panel's Dragon tests). */
  test(name: string): { ok: boolean; text: string } {
    if (!(DRAGON_TESTS as readonly string[]).includes(name)) return { ok: false, text: `Unknown Dragon test: ${name}` };
    const m = this.fight.dragon;
    if (!m || m.dead) return { ok: false, text: 'The Ender Dragon is not alive' };
    const players = this.fight.playersInEnd();
    const foe = this.fight.foeOf(m);
    const test = name as DragonTest;
    const phase = this.fight.phase;
    const busy = phase === 'wave' || phase === 'dive' || phase === 'edge' || phase === 'weave';
    switch (test) {
      case 'breath_wave':
      case 'strafing_dive':
      case 'edge_strike': {
        if (!foe) return { ok: false, text: 'Nobody for the Dragon to aim at' };
        if (phase === 'perch' || busy) this.fight.setPhase('hold');
        const ok = test === 'breath_wave' ? this.startWave(m, foe, players) : test === 'strafing_dive' ? this.startDive(m, foe, players) : this.startEdge(m, foe, players);
        return ok ? { ok, text: `Dragon: ${name.replace('_', ' ')}` } : { ok, text: test === 'edge_strike' ? 'No safe edge in view for an Edge Strike' : 'No clear line for that attack here' };
      }
      case 'pillar_weave':
        if (phase === 'perch' || busy) this.fight.setPhase('hold');
        this.startWeave(m, players);
        return { ok: true, text: 'Dragon: pillar weave, then an approach' };
      case 'wing_gust':
      case 'roar':
        if (phase === 'perch' && this.fight.ticksInPhase() < 200) {
          const py = this.fight.portalY();
          if (test === 'roar') this.roar(m, players, py);
          else this.gustAt = this.fight.ticksInPhase() + 1;
          return { ok: true, text: `Dragon: ${name.replace('_', ' ')}` };
        }
        this.pendingTest = test;
        if (phase !== 'approach') this.fight.setPhase('approach');
        return { ok: true, text: `Dragon: ${name.replace('_', ' ')} when it lands on the portal` };
      case 'crystal_fury':
        this.startFury();
        return { ok: true, text: 'Dragon: crystal fury for 10 seconds' };
      case 'dragon_storm':
        this.setStorm(!this.storm);
        if (this.storm) this.stormTick(m, players);
        return { ok: true, text: this.storm ? 'Dragon storm on' : 'Dragon storm off' };
    }
  }
}

/** Horizontal distance from (px, pz) to the segment a-b. */
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** Distance from a point to the segment a-b in 3D. */
function dist3Seg(px: number, py: number, pz: number, a: P3, b: P3): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const vz = b[2] - a[2];
  const l2 = vx * vx + vy * vy + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy + (pz - a[2]) * vz) / l2));
  return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t), pz - (a[2] + vz * t));
}
