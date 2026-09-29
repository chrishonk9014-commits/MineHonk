/**
 * The Error: the Farlands boss (V3).
 *
 * A giant glitched figure that forms when someone steps onto its arena, a
 * platform floating over the void. Every attack is telegraphed on the
 * clients (warning circles, targeting beams, a charging pose) for at least a
 * second and resolved here on the server when it lands, so a player who
 * moves in time is never hit:
 *  - Error Laser: a beam tracks a player, locks, then fires along the line
 *    (cover blocks it);
 *  - falling blocks around players (the slam; the Error kneels afterwards
 *    with its core exposed);
 *  - error zones that burn and slow while you stand in them;
 *  - teleports that leave an afterimage;
 *  - the player glitch: a circle closes on one player; still inside when it
 *    lands, their screen breaks up and they are slowed for a few seconds;
 *  - from phase 2, floor corruption that opens holes to the void (restored);
 *  - from phase 3, a void pulse to jump over and meteors;
 *  - in phase 4, flickering clones that pop in one hit, and an error storm.
 * Four phases at 100/75/50/25% health. Outside its kneel the Error takes a
 * quarter of melee damage and half from projectiles.
 *
 * Health scales with the players who start the fight. When everyone dies or
 * leaves, the fight resets and the arena is restored. The death sequence
 * freezes it, glitches it apart and ends with the Farlands stabilising and
 * the ERROR DEFEATED ending.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { HurtInfo } from '../entity/Living';
import type { S2C } from '../../common/net/protocol';
import { Mob } from '../entity/Mob';
import { FallingBlock } from '../entity/FallingBlock';
import { Random } from '../../common/math/rng';
import { S, STATE_SOLID } from '../../common/registry/blocks';
import { stackOf } from '../../common/game/itemstack';
import { ARENA_R } from '../../common/gen/farlandsArena';

const BASE_HP = 600;
/** Extra health for each player beyond the first who starts the fight. */
const HP_PER_PLAYER = 360;
const INTRO_TICKS = 100;
const EXPOSED_TICKS = 80;
const TRANSITION_TICKS = 60;
const DEATH_TICKS = 220;
/** Players further than this from the arena's centre have left the fight. */
const LEASH = 90;
/** The fight resets after this long with nobody left in it. */
const RESET_AFTER = 200;
/** Eye height of the Error's head (the laser's source). */
const EYE = 16.2;
const BAR_RANGE = 128;

type AttackKind = 'laser' | 'blocks' | 'zone' | 'teleport' | 'glitch' | 'hole' | 'pulse' | 'meteor' | 'clones' | 'storm';

interface Hazard {
  kind: 'laser' | 'block' | 'zone' | 'glitch' | 'pulse' | 'hole' | 'storm';
  id: number;
  /** Tick when it lands (or starts, for zones and holes). */
  at: number;
  /** Tick when it ends (zones, holes, storms, pulses). */
  until: number;
  x: number;
  y: number;
  z: number;
  x1?: number;
  y1?: number;
  z1?: number;
  r: number;
  dmg: number;
  target?: ServerPlayer;
  /** Laser: still following its target until this tick. */
  trackUntil?: number;
  source?: Mob;
  hit?: Set<ServerPlayer>;
  fire?: boolean;
  started?: boolean;
  cells?: [number, number, number][];
}

/** Sets a player alight (the same field Survival burns down). */
function burn(p: ServerPlayer, ticks: number): void {
  const f = p as unknown as { fireTicks?: number; metaDirty: boolean };
  f.fireTicks = Math.max(f.fireTicks ?? 0, ticks);
  f.metaDirty = true;
}

export interface ArenaSpot {
  x: number;
  y: number;
  z: number;
  r: number;
  /** A generated arena (the fight can't wander off it). */
  natural: boolean;
}

export interface ErrorFight {
  dim: Dimension;
  arena: ArenaSpot;
  boss: Mob | null;
  phase: number;
  state: 'intro' | 'fight' | 'exposed' | 'transition' | 'dying';
  t: number;
  cooldown: number;
  attacks: number;
  hazards: Hazard[];
  clones: Mob[];
  /** Blocks the fight changed, to put back (key -> original state). */
  restore: Map<string, number>;
  bar: Set<ServerPlayer>;
  absent: number;
  admin: boolean;
  lastAttack: AttackKind | null;
  /** Ticks until it kneels with its core exposed (0 = not planned). */
  exposeIn: number;
}

export class ErrorBossSystem {
  fight: ErrorFight | null = null;
  /** Randomness (replaceable in tests). */
  rng: { next(): number; int(n: number): number; chance(p: number): boolean } = new Random();
  private nextFx = 7_000_000;

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ lifecycle

  tick(): void {
    const s = this.server;
    if (!this.fight) {
      if (s.tickNo % 20 === 0) {
        this.restoreSaved();
        this.lookForFight();
      }
      return;
    }
    this.step(this.fight);
  }

  /** A player stepping onto an arena wakes The Error (until it has been defeated); stray bosses get a fight. */
  private lookForFight(): void {
    const s = this.server;
    // Bosses spawned some other way (the Admin Panel, a spawn egg, a reload)
    for (const dim of s.dims.values())
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || e.type !== 'the_error' || e.dead || e.removed) continue;
        if (e.data.clone) {
          e.remove();
          continue;
        }
        this.adopt(e);
        return;
      }
    if (s.endings?.state.errorDefeated) return;
    const far = s.dims.get('farlands');
    if (!far) return;
    for (const p of s.players.values()) {
      if (p.dim !== far || p.dead || p.gamemode === 'spectator') continue;
      const a = far.generator.locate?.('error_arena', Math.floor(p.x), Math.floor(p.z));
      if (!a) continue;
      if (Math.hypot(p.x - a.x, p.z - a.z) < ARENA_R - 1 && Math.abs(p.y - a.y) < 6) {
        this.begin(far, { x: a.x, y: a.y, z: a.z, r: ARENA_R, natural: true });
        return;
      }
    }
  }

  /** Starts a natural fight: the Error forms in the middle of its arena. */
  begin(dim: Dimension, arena: ArenaSpot): ErrorFight {
    this.restoreSaved(dim);
    const f: ErrorFight = { dim, arena, boss: null, phase: 1, state: 'intro', t: 0, cooldown: 60, attacks: 0, hazards: [], clones: [], restore: new Map(), bar: new Set(), absent: 0, admin: false, lastAttack: null, exposeIn: 0 };
    this.fight = f;
    return f;
  }

  /** Gives a boss that appeared some other way a fight around where it stands. */
  adopt(m: Mob): ErrorFight {
    const dim = m.dim;
    this.restoreSaved(dim);
    const a = dim.id === 'farlands' ? dim.generator.locate?.('error_arena', Math.floor(m.x), Math.floor(m.z)) : null;
    const arena: ArenaSpot = a && Math.hypot(a.x - m.x, a.z - m.z) < ARENA_R + 20 ? { x: a.x, y: a.y, z: a.z, r: ARENA_R, natural: true } : { x: Math.floor(m.x), y: Math.floor(m.y), z: Math.floor(m.z), r: 22, natural: false };
    const f: ErrorFight = { dim, arena, boss: m, phase: 1, state: 'fight', t: 0, cooldown: 60, attacks: 0, hazards: [], clones: [], restore: new Map(), bar: new Set(), absent: 0, admin: !!m.admin, lastAttack: null, exposeIn: 0 };
    this.setup(m, this.participants(f).length);
    this.fight = f;
    return f;
  }

  private setup(m: Mob, players: number): void {
    m.noAi = true;
    m.deathDuration = DEATH_TICKS + 40;
    const hp = BASE_HP + HP_PER_PLAYER * Math.max(0, players - 1);
    if (!m.data.scaled) {
      m.maxHealth = hp;
      m.health = hp;
      m.data.scaled = true;
    }
    m.data.errorPhase = this.phaseOf(m);
    m.metaDirty = true;
  }

  private phaseOf(m: Mob): number {
    const f = m.health / m.maxHealth;
    return f > 0.75 ? 1 : f > 0.5 ? 2 : f > 0.25 ? 3 : 4;
  }

  /** Players in the fight: alive, playing and near the arena. */
  participants(f: ErrorFight): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const p of this.server.players.values()) {
      if (p.dim !== f.dim || p.dead || p.gamemode === 'spectator' || p.gamemode === 'creative') continue;
      if (Math.hypot(p.x - f.arena.x, p.z - f.arena.z) > LEASH || p.y < f.arena.y - 60) continue;
      out.push(p);
    }
    return out;
  }

  private send(f: ErrorFight, msg: S2C, range = LEASH + 40): void {
    for (const p of this.server.players.values()) if (p.dim === f.dim && Math.hypot(p.x - f.arena.x, p.z - f.arena.z) < range) p.send(msg);
  }

  private fx(f: ErrorFight, msg: Omit<Extract<S2C, { t: 'fx' }>, 't'>): void {
    this.send(f, { t: 'fx', ...msg } as S2C);
  }

  /** Everyone gone (or dead): the Error unravels and the arena is put back. */
  reset(f: ErrorFight): void {
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = [];
    for (const c of f.clones) if (!c.removed) c.remove();
    f.clones = [];
    if (f.boss && !f.boss.removed) {
      this.server.particles(f.dim, 'void_burst', f.boss.x, f.boss.y + 8, f.boss.z, 60, 3);
      f.boss.remove();
    }
    this.restoreAll(f);
    for (const p of f.bar) p.send({ t: 'boss', id: f.boss?.id ?? -1, action: 'remove' });
    f.bar.clear();
    this.fight = null;
  }

  // ------------------------------------------------------------------ the fight

  private step(f: ErrorFight): void {
    const s = this.server;
    const m = f.boss;
    if (m && m.removed && f.state !== 'dying') {
      this.reset(f);
      return;
    }
    f.t++;
    const players = this.participants(f);
    if (f.state !== 'dying') {
      if (players.length === 0) {
        if (++f.absent > RESET_AFTER) {
          this.reset(f);
          return;
        }
      } else f.absent = 0;
    }
    this.updateBar(f);
    this.runHazards(f, players);
    f.clones = f.clones.filter((c) => !c.removed && !c.dead);

    switch (f.state) {
      case 'intro':
        this.intro(f, players);
        return;
      case 'dying':
        this.dying(f);
        return;
    }
    if (!m) return;
    this.face(m, players);
    // Phases
    const ph = this.phaseOf(m);
    if (ph > f.phase && f.state !== 'transition') {
      f.phase = ph;
      m.data.errorPhase = ph;
      this.enter(f, 'transition');
      m.data.untouchable = true;
      m.data.errorAnim = 'roar';
      m.metaDirty = true;
      s.playSound(f.dim, 'error.phase', m.x, m.y + 10, m.z, 4, 0.8);
      this.fx(f, { kind: 'glitch', strength: 0.55, ticks: 30 });
      this.server.particles(f.dim, 'void_burst', m.x, m.y + 9, m.z, 80, 4);
      return;
    }
    if (f.state === 'transition') {
      if (f.t >= TRANSITION_TICKS) {
        delete m.data.untouchable;
        this.enter(f, 'fight');
        f.cooldown = 20;
      }
      return;
    }
    if (f.state === 'exposed') {
      if (f.t === 1) {
        m.data.errorAnim = 'kneel';
        m.metaDirty = true;
        s.playSound(f.dim, 'error.charge', m.x, m.y + 4, m.z, 2, 0.5);
      }
      if (f.t % 8 === 0) s.particles(f.dim, 'void_aura', m.x, m.y + 6, m.z, 6, 1);
      if (f.t >= EXPOSED_TICKS) {
        this.enter(f, 'fight');
        m.data.errorAnim = 'idle';
        m.metaDirty = true;
        f.cooldown = 30;
      }
      return;
    }
    // Fighting. After a slam (and every few attacks) it kneels, core exposed
    if (f.exposeIn > 0 && --f.exposeIn === 0) {
      this.enter(f, 'exposed');
      return;
    }
    if (players.length === 0) return;
    if (--f.cooldown > 0) return;
    const kind = this.pick(f);
    f.lastAttack = kind;
    f.attacks++;
    const tele = this.telegraph(players.length);
    this.attack(f, kind, players, tele);
    f.cooldown = Math.max(30, 80 - f.phase * 10) + tele + (players.length > 1 ? 10 : 0);
    if (kind === 'blocks' || kind === 'meteor' || f.attacks % 5 === 0) {
      f.exposeIn = tele + 20;
      f.cooldown = f.exposeIn + EXPOSED_TICKS + 20;
    }
  }

  private enter(f: ErrorFight, state: ErrorFight['state']): void {
    f.state = state;
    f.t = 0;
  }

  /** Warning time before an attack lands: never under a second, more with company. */
  telegraph(players: number): number {
    return 24 + (players > 1 ? 8 : 0);
  }

  private intro(f: ErrorFight, players: ServerPlayer[]): void {
    const s = this.server;
    const a = f.arena;
    if (f.t % 10 === 0) this.fx(f, { kind: 'glitch', strength: Math.min(0.8, 0.15 + f.t / 150), ticks: 12 });
    if (f.t % 4 === 0) s.particles(f.dim, 'glitch', a.x + 0.5, a.y + 2 + this.rng.next() * 14, a.z + 0.5, 12, 2.5);
    if (f.t === 1) s.playSound(f.dim, 'glitch.hum', a.x, a.y + 8, a.z, 4, 0.5);
    if (f.t === 40) {
      const m = this.server.mobs?.spawn(f.dim, 'the_error', a.x + 0.5, a.y, a.z + 0.5, { reason: 'boss' });
      if (!m) {
        this.reset(f);
        return;
      }
      f.boss = m;
      this.setup(m, Math.max(1, players.length));
      m.data.untouchable = true;
      m.data.errorAnim = 'form';
      m.metaDirty = true;
    }
    if (f.t === 70 && f.boss) {
      s.playSound(f.dim, 'error.roar', a.x, a.y + 12, a.z, 6, 0.7);
      this.fx(f, { kind: 'pulse', x: a.x + 0.5, y: a.y + 0.2, z: a.z + 0.5, r: a.r, ticks: 30 });
    }
    if (f.t >= INTRO_TICKS && f.boss) {
      delete f.boss.data.untouchable;
      f.boss.data.errorAnim = 'idle';
      f.boss.metaDirty = true;
      this.enter(f, 'fight');
    }
  }

  private face(m: Mob, players: ServerPlayer[]): void {
    let best: ServerPlayer | null = null;
    let bd = Infinity;
    for (const p of players) {
      const d = (p.x - m.x) ** 2 + (p.z - m.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    const yaw = Math.atan2(-(best.x - m.x), -(best.z - m.z));
    m.yaw = yaw;
    m.headYaw = yaw;
  }

  private pick(f: ErrorFight): AttackKind {
    const w: [AttackKind, number][] = [
      ['laser', 3],
      ['blocks', 3],
      ['zone', 2],
      ['teleport', f.phase >= 2 ? 2 : 1],
      ['glitch', 2],
    ];
    if (f.phase >= 2) w.push(['hole', 2]);
    if (f.phase >= 3) w.push(['pulse', 3], ['meteor', 2]);
    if (f.phase >= 4) {
      if (f.clones.length === 0) w.push(['clones', 3]);
      w.push(['storm', 2]);
    }
    const options = w.filter(([k]) => k !== f.lastAttack);
    let total = 0;
    for (const [, n] of options) total += n;
    let r = this.rng.next() * total;
    for (const [k, n] of options) if ((r -= n) < 0) return k;
    return 'laser';
  }

  // ------------------------------------------------------------------ attacks

  attack(f: ErrorFight, kind: AttackKind, players: ServerPlayer[], tele: number): void {
    const m = f.boss!;
    const s = this.server;
    const now = s.tickNo;
    const target = players[this.rng.int(players.length)]!;
    const anim = (a: string): void => {
      m.data.errorAnim = a;
      m.metaDirty = true;
    };
    switch (kind) {
      case 'laser': {
        anim('laser');
        s.playSound(f.dim, 'error.charge', m.x, m.y + EYE, m.z, 3, 1);
        this.laser(f, m, target, now, tele, 9 + f.phase * 2);
        for (const c of f.clones) this.laser(f, c, players[this.rng.int(players.length)]!, now, tele, 5);
        break;
      }
      case 'blocks': {
        anim('slam');
        s.playSound(f.dim, 'error.roar', m.x, m.y + 12, m.z, 3, 1.1);
        const n = 3 + f.phase;
        for (let i = 0; i < n; i++) {
          const p = players[i % players.length]!;
          const spot = i < players.length ? this.near(p, 0.8) : this.near(p, 4);
          this.block(f, spot, now + tele + 6, 1.6, 7 + f.phase, false);
        }
        break;
      }
      case 'meteor': {
        anim('cast');
        s.playSound(f.dim, 'error.meteor', m.x, m.y + 14, m.z, 4, 0.8);
        for (const p of players.slice(0, 3)) this.block(f, this.near(p, 1), now + tele + 12, 3, 10 + f.phase, true);
        break;
      }
      case 'zone': {
        anim('cast');
        s.playSound(f.dim, 'error.zone', m.x, m.y + 8, m.z, 3, 1);
        const n = Math.min(3, players.length + 1);
        for (let i = 0; i < n; i++) {
          const spot = this.near(players[i % players.length]!, i < players.length ? 0.5 : 5);
          const h: Hazard = { kind: 'zone', id: this.nextFx++, at: now + tele, until: now + tele + 160, ...spot, r: 3, dmg: 2 };
          this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: tele });
          f.hazards.push(h);
        }
        break;
      }
      case 'teleport':
        this.teleport(f, m, players);
        break;
      case 'glitch': {
        anim('cast');
        const h: Hazard = { kind: 'glitch', id: this.nextFx++, at: now + tele + 10, until: now + tele + 10, x: target.x, y: Math.floor(target.y), z: target.z, r: 2.5, dmg: 3, target };
        this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: tele + 10 });
        target.send({ t: 'fx', kind: 'glitch', strength: 0.2, ticks: tele });
        s.playSound(f.dim, 'glitch.warn', target.x, target.y + 1, target.z, 1.5, 1);
        f.hazards.push(h);
        break;
      }
      case 'hole': {
        anim('cast');
        for (const p of players.slice(0, 3)) {
          const spot = this.near(p, 1);
          if (Math.hypot(spot.x - m.x, spot.z - m.z) < 7) continue;
          this.hole(f, spot, now + tele + 20);
        }
        break;
      }
      case 'pulse': {
        anim('charge');
        s.playSound(f.dim, 'error.charge', m.x, m.y + 4, m.z, 4, 0.6);
        // The whole floor the shockwave will sweep lights up: jump when it reaches you
        this.fx(f, { kind: 'warn_circle', id: this.nextFx++, x: m.x, y: Math.floor(m.y), z: m.z, r: f.arena.r - 2, ticks: tele });
        f.hazards.push({ kind: 'pulse', id: this.nextFx++, at: now + tele, until: now + tele + 30, x: m.x, y: Math.floor(m.y), z: m.z, r: f.arena.r - 2, dmg: 6 + f.phase, hit: new Set() });
        break;
      }
      case 'clones': {
        anim('cast');
        for (let i = 0; i < 2; i++) {
          const spot = this.arenaSpot(f, 8, f.arena.r - 9);
          const c = s.mobs?.spawn(f.dim, 'the_error', spot.x, spot.y, spot.z, { reason: 'boss', data: { clone: true } });
          if (!c) continue;
          c.noAi = true;
          c.maxHealth = 1;
          c.health = 1;
          c.data.clone = true;
          c.data.cloneUntil = now + 400;
          c.metaDirty = true;
          if (m.admin) c.admin = true;
          f.clones.push(c);
          this.fx(f, { kind: 'afterimage', id: m.id, ticks: 20 });
        }
        s.playSound(f.dim, 'error.teleport', m.x, m.y + 8, m.z, 3, 0.7);
        break;
      }
      case 'storm': {
        anim('roar');
        s.playSound(f.dim, 'error.roar', m.x, m.y + 12, m.z, 5, 0.6);
        this.fx(f, { kind: 'glitch', strength: 0.4, ticks: 20 });
        f.hazards.push({ kind: 'storm', id: this.nextFx++, at: now, until: now + 120, x: f.arena.x, y: f.arena.y, z: f.arena.z, r: f.arena.r, dmg: 0 });
        break;
      }
    }
  }

  private laser(f: ErrorFight, src: Mob, target: ServerPlayer, now: number, tele: number, dmg: number): void {
    const h: Hazard = { kind: 'laser', id: this.nextFx++, at: now + 16 + tele, until: now + 16 + tele + 10, x: src.x, y: src.y + EYE, z: src.z, x1: target.x, y1: target.y + 1, z1: target.z, r: 1.3, dmg, target, trackUntil: now + 16, source: src };
    this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: 16 + tele });
    f.hazards.push(h);
  }

  private block(f: ErrorFight, spot: { x: number; y: number; z: number }, at: number, r: number, dmg: number, meteor: boolean): void {
    const now = this.server.tickNo;
    const h: Hazard = { kind: 'block', id: this.nextFx++, at, until: at, ...spot, r, dmg, fire: meteor };
    this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r, ticks: at - now });
    // The block itself: dropped from a height that lands it about on time
    const ticks = at - now;
    const fall = Math.min(40, 0.017 * ticks * ticks);
    const fb = new FallingBlock(meteor ? S('magma_block') : this.rng.chance(0.5) ? S('corrupted_stone') : S('missing_block'));
    fb.shatter = true;
    fb.setPos(spot.x, spot.y + fall, spot.z);
    f.dim.addEntity(fb);
    f.hazards.push(h);
  }

  private hole(f: ErrorFight, spot: { x: number; y: number; z: number }, at: number): void {
    const cells: [number, number, number][] = [];
    const missing = S('missing_block');
    const fy = spot.y - 1;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 5) continue;
        const x = Math.floor(spot.x) + dx;
        const z = Math.floor(spot.z) + dz;
        const st = f.dim.getState(x, fy, z);
        if (!STATE_SOLID[st]) continue;
        this.remember(f, x, fy, z, st);
        f.dim.setBlock(x, fy, z, missing);
        cells.push([x, fy, z]);
      }
    if (!cells.length) return;
    const h: Hazard = { kind: 'hole', id: this.nextFx++, at, until: at + 140, ...spot, r: 2.2, dmg: 0, cells };
    this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: at - this.server.tickNo });
    f.hazards.push(h);
  }

  private teleport(f: ErrorFight, m: Mob, players: ServerPlayer[]): void {
    const s = this.server;
    this.fx(f, { kind: 'afterimage', id: m.id, ticks: 30 });
    s.playSound(f.dim, 'error.teleport', m.x, m.y + 8, m.z, 4, 1);
    s.particles(f.dim, 'glitch', m.x, m.y + 8, m.z, 60, 3);
    // Somewhere on the arena away from the players
    // (clear of the broken pillars around the edge)
    let best = this.arenaSpot(f, 6, f.arena.r - 9);
    let bd = -1;
    for (let i = 0; i < 6; i++) {
      const c = this.arenaSpot(f, 6, f.arena.r - 9);
      let d = Infinity;
      for (const p of players) d = Math.min(d, Math.hypot(p.x - c.x, p.z - c.z));
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    m.setPos(best.x, best.y, best.z);
    m.data.errorAnim = 'idle';
    m.metaDirty = true;
    this.fx(f, { kind: 'glitch', strength: 0.3, ticks: 10 });
    s.playSound(f.dim, 'error.teleport', best.x, best.y + 8, best.z, 4, 0.8);
  }

  /** A point near a player (on their floor). */
  private near(p: ServerPlayer, spread: number): { x: number; y: number; z: number } {
    const a = this.rng.next() * Math.PI * 2;
    const r = this.rng.next() * spread;
    return { x: p.x + Math.cos(a) * r, y: Math.floor(p.y + 0.01), z: p.z + Math.sin(a) * r };
  }

  private arenaSpot(f: ErrorFight, r0: number, r1: number): { x: number; y: number; z: number } {
    const a = this.rng.next() * Math.PI * 2;
    const r = r0 + this.rng.next() * Math.max(0, r1 - r0);
    return { x: f.arena.x + 0.5 + Math.cos(a) * r, y: f.arena.y, z: f.arena.z + 0.5 + Math.sin(a) * r };
  }

  // ------------------------------------------------------------------ hazards (resolved at impact)

  private runHazards(f: ErrorFight, players: ServerPlayer[]): void {
    const now = this.server.tickNo;
    const keep: Hazard[] = [];
    for (const h of f.hazards) {
      if (this.runHazard(f, h, players, now)) keep.push(h);
      else this.endHazard(f, h);
    }
    // Hazards added while running (the storm) are already in f.hazards past the old length
    f.hazards = keep.concat(f.hazards.filter((h) => !keep.includes(h) && h.at > now));
  }

  /** Returns false once the hazard is over. */
  private runHazard(f: ErrorFight, h: Hazard, players: ServerPlayer[], now: number): boolean {
    const s = this.server;
    const hurt = (p: ServerPlayer, dmg: number, kx: number, kz: number, kb = 0.6): void => {
      const d = Math.hypot(kx, kz) || 1;
      s.interaction.survival.damage(p, dmg, { source: 'mob', attacker: f.boss ?? undefined, kbx: kx / d, kbz: kz / d, knockback: kb });
    };
    switch (h.kind) {
      case 'laser': {
        if (h.source && (h.source.removed || h.source.dead)) return false;
        if (now < h.trackUntil! && h.target && !h.target.dead) {
          // The targeting beam follows its player, then locks
          h.x1 = h.target.x;
          h.y1 = h.target.y + 1;
          h.z1 = h.target.z;
          if ((h.trackUntil! - now) % 4 === 0) this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: h.at - now });
          return true;
        }
        if (now < h.at) return true;
        if (now === h.at) {
          const [ex, ey, ez] = this.extend(h, 56);
          this.fx(f, { kind: 'laser', id: h.id, x: h.x, y: h.y, z: h.z, x1: ex, y1: ey, z1: ez, ticks: 10 });
          s.playSound(f.dim, 'error.laser', h.x, h.y, h.z, 5, 1);
          for (const p of players) {
            if (this.segDist(p.x, p.y + 0.9, p.z, h.x, h.y, h.z, ex, ey, ez) > h.r) continue;
            if (!this.clearLine(f.dim, h.x, h.y, h.z, p.x, p.y + 0.9, p.z, h.source!)) continue;
            hurt(p, h.dmg, p.x - h.x, p.z - h.z, 0.8);
            burn(p, 60);
          }
        }
        return now < h.until;
      }
      case 'block': {
        if (now < h.at) return true;
        for (const p of players) {
          if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 3) continue;
          hurt(p, h.dmg, p.x - h.x, p.z - h.z, 0.5);
          if (h.fire) burn(p, 80);
        }
        s.particles(f.dim, h.fire ? 'explosion' : 'glitch', h.x, h.y + 0.5, h.z, h.fire ? 3 : 16, h.r * 0.6);
        s.playSound(f.dim, h.fire ? 'error.meteor' : 'glitch.zap', h.x, h.y, h.z, 1.5, 0.7);
        return false;
      }
      case 'zone': {
        if (now < h.at) return true;
        if (!h.started) {
          h.started = true;
          this.fx(f, { kind: 'zone', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.until - now });
          s.playSound(f.dim, 'error.zone', h.x, h.y, h.z, 1.5, 1);
        }
        if ((now - h.at) % 10 === 0)
          for (const p of players) {
            if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 2.5) continue;
            s.interaction.survival.damage(p, h.dmg, { source: 'magic', attacker: f.boss ?? undefined });
            s.interaction.survival.addEffect(p, 'slowness', 1, 30);
          }
        return now < h.until;
      }
      case 'glitch': {
        if (now < h.at) return true;
        const p = h.target;
        if (p && !p.dead && players.includes(p) && Math.hypot(p.x - h.x, p.z - h.z) <= h.r && Math.abs(p.y - h.y) < 3) {
          p.send({ t: 'fx', kind: 'player_glitch', ticks: 60 });
          s.interaction.survival.damage(p, h.dmg, { source: 'magic', attacker: f.boss ?? undefined });
          s.interaction.survival.addEffect(p, 'slowness', 2, 60);
          s.interaction.survival.addEffect(p, 'nausea', 0, 80);
        }
        s.particles(f.dim, 'glitch', h.x, h.y + 1, h.z, 30, h.r * 0.5);
        return false;
      }
      case 'pulse': {
        if (now < h.at) return true;
        const k = (now - h.at) / (h.until - h.at);
        if (now === h.at) {
          this.fx(f, { kind: 'pulse', x: h.x, y: h.y + 0.2, z: h.z, r: h.r, ticks: h.until - h.at });
          s.playSound(f.dim, 'error.pulse', h.x, h.y, h.z, 5, 0.8);
        }
        const R = h.r * k;
        for (const p of players) {
          if (h.hit!.has(p)) continue;
          const d = Math.hypot(p.x - h.x, p.z - h.z);
          // A ring along the floor: jump over it
          if (Math.abs(d - R) > 1.2 || Math.abs(p.y - h.y) > 1.5 || !p.body.onGround) continue;
          h.hit!.add(p);
          hurt(p, h.dmg, p.x - h.x, p.z - h.z, 1.2);
        }
        return now < h.until;
      }
      case 'hole': {
        if (now < h.at) return true;
        if (!h.started) {
          h.started = true;
          for (const [x, y, z] of h.cells!) f.dim.setBlock(x, y, z, 0);
          s.playSound(f.dim, 'glitch.static', h.x, h.y, h.z, 2, 0.6);
        }
        return now < h.until;
      }
      case 'storm': {
        if ((now - h.at) % 12 === 0 && players.length) {
          const tele = this.telegraph(players.length);
          for (let i = 0; i < 2; i++) {
            const p = players[this.rng.int(players.length)]!;
            this.block(f, this.near(p, 5), now + tele, 1.6, 6 + f.phase, false);
          }
        }
        return now < h.until;
      }
    }
    return false;
  }

  private endHazard(f: ErrorFight, h: Hazard): void {
    if (h.kind === 'zone' || h.kind === 'hole' || h.kind === 'glitch' || h.kind === 'block') this.fx(f, { kind: h.kind === 'zone' ? 'zone_end' : 'warn_end', id: h.id });
    if (h.kind === 'hole' && h.cells) for (const [x, y, z] of h.cells) this.putBack(f, x, y, z);
  }

  private extend(h: Hazard, len: number): [number, number, number] {
    const dx = h.x1! - h.x;
    const dy = h.y1! - h.y;
    const dz = h.z1! - h.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return [h.x + (dx / d) * len, h.y + (dy / d) * len, h.z + (dz / d) * len];
  }

  private segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2));
    return Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz);
  }

  /** No solid block between the beam's source and a point (the Error's own body aside). */
  private clearLine(dim: Dimension, ax: number, ay: number, az: number, bx: number, by: number, bz: number, src: Mob): boolean {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.ceil(d * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      if (Math.abs(x - src.x) < 2.5 && Math.abs(z - src.z) < 2.5 && y > src.y) continue;
      if (STATE_SOLID[dim.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ arena restoration

  private remember(f: ErrorFight, x: number, y: number, z: number, state: number): void {
    const key = `${x},${y},${z}`;
    if (!f.restore.has(key)) f.restore.set(key, state);
    this.save(f);
  }

  private putBack(f: ErrorFight, x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const st = f.restore.get(key);
    if (st === undefined || !f.dim.isLoaded(x, z)) return;
    f.dim.setBlock(x, y, z, st);
    f.restore.delete(key);
    this.save(f);
  }

  /** Puts everything back; blocks in unloaded chunks wait (saved) until their chunk is back. */
  private restoreAll(f: ErrorFight): void {
    for (const [key, st] of f.restore) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      if (f.dim.isLoaded(x, z)) {
        f.dim.setBlock(x, y, z, st);
        f.restore.delete(key);
      }
    }
    this.save(f);
  }

  /** The blocks to put back survive unloading and restarts. */
  private save(f: ErrorFight): void {
    const flags = this.server.level.flags as Record<string, unknown>;
    if (!f.restore.size) delete flags.errorRestore;
    else flags.errorRestore = { dim: f.dim.id, blocks: [...f.restore].map(([k, v]) => [k, v]) };
  }

  /** Applies saved restorations whose chunks are loaded (all of them at a fight's start). */
  private restoreSaved(dim?: Dimension): void {
    const flags = this.server.level.flags as Record<string, unknown>;
    const saved = flags.errorRestore as { dim: string; blocks: [string, number][] } | undefined;
    if (!saved || !Array.isArray(saved.blocks)) return;
    const d = dim ?? this.server.dims.get(saved.dim as never);
    if (!d || d.id !== saved.dim) return;
    const left: [string, number][] = [];
    for (const [key, st] of saved.blocks) {
      const [x, y, z] = String(key).split(',').map(Number) as [number, number, number];
      if (!Number.isFinite(x) || !Number.isFinite(st)) continue;
      if (d.isLoaded(x, z)) d.setBlock(x, y, z, st);
      else left.push([key, st]);
    }
    if (left.length) flags.errorRestore = { dim: saved.dim, blocks: left };
    else delete flags.errorRestore;
  }

  // ------------------------------------------------------------------ damage, bar, death

  /** How much of a hit The Error takes (called from Mob.hurt). */
  scaleDamage(m: Mob, amount: number, info: HurtInfo): number {
    if (m.data.clone) return amount;
    const f = this.fight;
    if (!f || f.boss !== m) return amount;
    if (info.source === 'kill' || info.source === 'void') return amount;
    if (f.state === 'intro' || f.state === 'transition' || f.state === 'dying') return 0;
    if (f.state === 'exposed') return amount;
    const ranged = info.source === 'arrow';
    return amount * (ranged ? 0.5 : 0.25);
  }

  private updateBar(f: ErrorFight): void {
    const m = f.boss;
    if (!m || m.removed) return;
    const s = this.server;
    const progress = Math.max(0, m.health / m.maxHealth);
    for (const p of s.players.values()) {
      const near = p.dim === f.dim && Math.hypot(p.x - f.arena.x, p.z - f.arena.z) < BAR_RANGE;
      if (near && !f.bar.has(p)) {
        f.bar.add(p);
        p.send({ t: 'boss', id: m.id, action: 'add', title: 'THE ERROR', progress, color: 'glitch' });
      } else if (near && m.metaDirty) p.send({ t: 'boss', id: m.id, action: 'update', progress });
      else if (!near && f.bar.has(p)) {
        f.bar.delete(p);
        p.send({ t: 'boss', id: m.id, action: 'remove' });
      }
    }
  }

  onDeath(m: Mob, killer: ServerPlayer | null, info: HurtInfo): void {
    void killer;
    void info;
    if (m.data.clone) {
      // A clone pops like a bubble
      this.server.particles(m.dim, 'glitch', m.x, m.y + 8, m.z, 40, 2.5);
      this.server.playSound(m.dim, 'glitch.zap', m.x, m.y + 8, m.z, 2, 1.4);
      m.remove();
      return;
    }
    let f = this.fight;
    if (!f || f.boss !== m) f = this.adopt(m);
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = [];
    for (const c of f.clones) if (!c.removed) c.remove();
    f.clones = [];
    this.enter(f, 'dying');
    m.deathDuration = DEATH_TICKS + 40;
    m.data.errorAnim = 'death';
    m.metaDirty = true;
    this.fx(f, { kind: 'silence', ticks: 150 });
    this.fx(f, { kind: 'glitch', strength: 1, ticks: 20 });
    this.server.playSound(m.dim, 'error.roar', m.x, m.y + 12, m.z, 6, 0.45);
  }

  private dying(f: ErrorFight): void {
    const s = this.server;
    const m = f.boss!;
    const t = f.t;
    // Frozen, then shaking itself apart
    if (t > 20 && t < 150 && t % 10 === 0) {
      this.fx(f, { kind: 'glitch', strength: Math.min(0.9, 0.3 + t / 200), ticks: 10 });
      s.particles(f.dim, 'glitch', m.x + (this.rng.next() - 0.5) * 4, m.y + this.rng.next() * 17, m.z + (this.rng.next() - 0.5) * 4, 30, 1.5);
      s.playSound(f.dim, 'glitch.static', m.x, m.y + 8, m.z, 3, 0.6 + t / 300);
    }
    if (t === 100) {
      m.data.errorAnim = 'detach';
      m.metaDirty = true;
    }
    if (t === 150) {
      this.fx(f, { kind: 'boss_death', ticks: 70 });
      s.playSound(f.dim, 'error.death', m.x, m.y + 8, m.z, 8, 1);
      s.particles(f.dim, 'void_burst', m.x, m.y + 8, m.z, 250, 6);
      s.particles(f.dim, 'explosion', m.x, m.y + 8, m.z, 12, 5);
    }
    if (t === DEATH_TICKS) this.finish(f);
  }

  private finish(f: ErrorFight): void {
    const s = this.server;
    const m = f.boss!;
    const cheat = !!m.admin;
    // The Farlands settle down
    this.restoreAll(f);
    for (const p of s.players.values()) if (p.dim === f.dim) p.send({ t: 'fx', kind: 'stabilize', ticks: 60 });
    for (const p of f.bar) p.send({ t: 'boss', id: m.id, action: 'remove' });
    f.bar.clear();
    // What it leaves behind
    const drops = [stackOf('glitch_core', 2), stackOf('glitched_ingot', 2 + this.rng.int(2)), stackOf('data_fragment', 6)];
    for (const st of drops) s.mining.dropItem(f.dim, m.x, m.y + 1, m.z, st);
    s.mining.dropXp(f.dim, m.x, m.y + 1, m.z, 1200, cheat);
    // ERROR DEFEATED, for everyone who saw it through
    const endings = s.endings;
    const winners = this.participants(f);
    for (const p of s.players.values()) if (p.dim === f.dim && p.gamemode === 'creative' && Math.hypot(p.x - f.arena.x, p.z - f.arena.z) < LEASH) winners.push(p);
    for (const p of winners) {
      if (!cheat) s.interaction.grant(p, 'defeat_error');
      if (endings) s.later(60, () => endings.reach(p, 'error_defeated', { cheat, show: 'now' }));
    }
    if (endings && !cheat) endings.state.errorDefeated = true;
    m.remove();
    this.fight = null;
  }

  /** Admin: where the fight stands (for the panel). */
  status(): { state: string; phase: number; health: number; maxHealth: number; x: number; y: number; z: number } | null {
    const f = this.fight;
    if (!f) return null;
    return { state: f.state, phase: f.phase, health: f.boss?.health ?? 0, maxHealth: f.boss?.maxHealth ?? 0, x: f.arena.x, y: f.arena.y, z: f.arena.z };
  }
}
