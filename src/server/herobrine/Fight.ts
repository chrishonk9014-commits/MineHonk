/**
 * V5.5: the two Herobrine fights.
 *
 * The first, in the Overworld, around the computer he came out of: he
 * blinks behind people and strikes, throws bolts, sends a shockwave along
 * the ground and leaves static where people stand. It changes no blocks.
 * Low on health he goes back into the computer: he doesn't die.
 *
 * The second, in his cave inside the computer, plugged into its machines:
 *  - electricity: the tesla coils arc to anyone near them, lightning strikes
 *    where people stand, a beam of current along a line (cover stops it);
 *  - hacking: words across a player's screen, and what they say happens
 *    (PLAYER CONTROL OVERRIDE reverses their movement, ACCESS DENIED weakens
 *    their blows, CONNECTION LOST snaps them back to where they were a
 *    moment ago, SYSTEM BREACH breaks up their screen and slows them);
 *  - the world's blocks: WORLD DATA CORRUPTED opens holes in the floor,
 *    wireframe cages close around people, data blocks rain from the roof;
 *  - forced movement: everyone dragged towards him before a slam, a blast
 *    that throws people back.
 * Three phases (100/66/33%); between them he plugs himself back into the
 * core for a moment and can't be hurt.
 *
 * Every attack is shown before it lands (warning circles and beams, the
 * words on the screen, his pose) for at least 24 ticks (more with company)
 * and resolved here when it lands: whoever moved in time is never hit.
 * Blocks the fight changes are put back (and survive restarts until they
 * are).
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { HurtInfo } from '../entity/Living';
import type { S2C } from '../../common/net/protocol';
import type { HerobrineSystem } from './Herobrine';
import { Mob } from '../entity/Mob';
import { FallingBlock } from '../entity/FallingBlock';
import { Random } from '../../common/math/rng';
import { S, STATE_SOLID } from '../../common/registry/blocks';
import { HACK_MESSAGES } from '../../common/digital/story';

const FIRST_HP = 300;
const FIRST_HP_PER_PLAYER = 150;
const FINAL_HP = 600;
const FINAL_HP_PER_PLAYER = 300;
/** The first fight ends (he goes back in) at this share of his health. */
const RETREAT_AT = 0.25;
const EMERGE_TICKS = 60;
const INTRO_TICKS = 100;
const TRANSITION_TICKS = 80;
const RETREAT_TICKS = 60;
export const DEATH_TICKS = 220;
const RESET_AFTER = 200;
const BAR_RANGE = 96;
/** Eye height (bolts and beams leave from here). */
const EYE = 1.6;

export type FightKind = 'first' | 'final';
type Attack = 'strike' | 'bolts' | 'pulse' | 'static' | 'coils' | 'lightning' | 'chain' | 'hack' | 'pull' | 'push' | 'corrupt' | 'cage' | 'rain';
export type HackKind = 'override' | 'denied' | 'lost' | 'breach';

const HACK_TEXT: Record<HackKind, string> = {
  override: 'PLAYER CONTROL OVERRIDE',
  denied: 'ACCESS DENIED',
  lost: 'CONNECTION LOST',
  breach: 'SYSTEM BREACH',
};

interface Hazard {
  kind: 'strike' | 'bolt' | 'pulse' | 'static' | 'coil' | 'lightning' | 'chain' | 'hack' | 'pull' | 'push' | 'hole' | 'cage' | 'rain';
  id: number;
  /** Tick it lands (or starts). */
  at: number;
  /** Tick it ends. */
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
  trackUntil?: number;
  hit?: Set<ServerPlayer>;
  started?: boolean;
  cells?: [number, number, number][];
  hack?: HackKind;
}

export interface HbFight {
  kind: FightKind;
  dim: Dimension;
  /** The arena's middle (the first fight: in front of the computer; the second: the hall). */
  center: { x: number; y: number; z: number };
  /** Where he goes back to (the computer's screen; the throne in the cave). */
  home: { x: number; y: number; z: number };
  /** Players further than this from the middle have left the fight. */
  leash: number;
  boss: Mob | null;
  state: 'emerge' | 'intro' | 'fight' | 'transition' | 'retreat' | 'dying';
  t: number;
  phase: number;
  cooldown: number;
  attacks: number;
  hazards: Hazard[];
  restore: Map<string, number>;
  bar: Set<ServerPlayer>;
  absent: number;
  cheat: boolean;
  last: Attack | null;
  /** Where each player was over the last couple of seconds (CONNECTION LOST snaps them back). */
  trail: Map<ServerPlayer, [number, number, number][]>;
  /** Ticks each player has spent in the pit under the floor. */
  pit: Map<ServerPlayer, number>;
  meleeAt: number;
  /** Everyone who took part (uuids). */
  party: Set<string>;
  /** Final fight: the tesla coils and the core. */
  coils: { x: number; y: number; z: number }[];
  core: { x: number; y: number; z: number } | null;
  /** Final fight: the hall's radius and floor (holes are only cut in it). */
  floorY: number;
  radius: number;
}

export class HerobrineFights {
  fight: HbFight | null = null;
  /** Randomness (replaceable in tests). */
  rng: { next(): number; int(n: number): number; chance(p: number): boolean } = new Random();
  private nextFx = 8_000_000;

  constructor(private readonly hb: HerobrineSystem) {}

  private get server(): GameServer {
    return this.hb.server;
  }

  // ------------------------------------------------------------------ starting

  private make(kind: FightKind, dim: Dimension, center: HbFight['center'], home: HbFight['home'], cheat: boolean): HbFight {
    return {
      kind,
      dim,
      center,
      home,
      leash: kind === 'first' ? 44 : 40,
      boss: null,
      state: kind === 'first' ? 'emerge' : 'intro',
      t: 0,
      phase: 1,
      cooldown: 50,
      attacks: 0,
      hazards: [],
      restore: new Map(),
      bar: new Set(),
      absent: 0,
      cheat,
      last: null,
      trail: new Map(),
      pit: new Map(),
      meleeAt: 0,
      party: new Set(),
      coils: [],
      core: null,
      floorY: center.y - 1,
      radius: 24,
    };
  }

  /** He comes out of the computer's screen (`home`) and steps out in front of it. */
  startFirst(dim: Dimension, home: HbFight['home'], out: HbFight['center'], yaw: number, cheat: boolean): HbFight {
    if (this.fight) this.reset(this.fight, true);
    const f = this.make('first', dim, out, home, cheat);
    this.fight = f;
    const m = this.spawn(f, home.x, home.y, home.z);
    if (m) {
      m.yaw = yaw;
      m.headYaw = yaw;
      m.data.untouchable = true;
      m.data.hbAnim = 'emerge';
      m.metaDirty = true;
    }
    return f;
  }

  /** The cave: he is plugged in at his throne; someone walked into the hall. */
  startFinal(dim: Dimension, hall: { x: number; y: number; z: number; r: number }, throne: HbFight['home'], coils: HbFight['coils'], core: HbFight['core'], cheat: boolean): HbFight {
    if (this.fight) this.reset(this.fight, true);
    const f = this.make('final', dim, { x: hall.x + 0.5, y: hall.y, z: hall.z + 0.5 }, { x: throne.x + 0.5, y: throne.y, z: throne.z + 0.5 }, cheat);
    f.leash = hall.r + 14;
    f.radius = hall.r;
    f.floorY = hall.y - 1;
    f.coils = coils;
    f.core = core;
    this.restoreSaved(dim);
    this.fight = f;
    return f;
  }

  private spawn(f: HbFight, x: number, y: number, z: number): Mob | null {
    const m = this.server.mobs?.spawn(f.dim, 'herobrine', x, y, z, { reason: 'boss' });
    if (!m) return null;
    m.noAi = true;
    m.persistent = false;
    m.persistenceRequired = true;
    m.admin = f.cheat;
    m.deathDuration = DEATH_TICKS + 40;
    const n = Math.max(1, this.participants(f).length);
    const hp = f.kind === 'first' ? FIRST_HP + FIRST_HP_PER_PLAYER * (n - 1) : FINAL_HP + FINAL_HP_PER_PLAYER * (n - 1);
    m.maxHealth = hp;
    m.health = hp;
    m.data.hbKind = f.kind;
    m.data.hbAnim = 'idle';
    m.metaDirty = true;
    f.boss = m;
    return m;
  }

  /** A Herobrine that appeared some other way (a spawn egg, the Admin Panel's mob spawner): it fights where it stands. */
  adopt(m: Mob): HbFight {
    if (this.fight && this.fight.boss !== m) this.reset(this.fight, true);
    const center = { x: m.x, y: Math.floor(m.y), z: m.z };
    const f = this.make(m.dim.id === 'computer' ? 'final' : 'first', m.dim, center, { ...center }, true);
    f.state = 'fight';
    f.boss = m;
    m.noAi = true;
    m.persistent = false;
    m.admin = true;
    m.deathDuration = DEATH_TICKS + 40;
    m.data.hbKind = f.kind;
    m.data.hbAnim = 'idle';
    m.metaDirty = true;
    f.radius = 18;
    this.fight = f;
    return f;
  }

  /**
   * Players in the fight: alive, not spectating and near. Creative players
   * count (their part in it is a cheat), so a fight with only them in it
   * doesn't keep resetting.
   */
  participants(f: HbFight): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const p of this.server.players.values()) {
      if (p.dim !== f.dim || p.dead || p.gamemode === 'spectator') continue;
      if (Math.hypot(p.x - f.center.x, p.z - f.center.z) > f.leash || Math.abs(p.y - f.center.y) > 40) continue;
      out.push(p);
    }
    return out;
  }

  private send(f: HbFight, msg: S2C): void {
    for (const p of this.server.players.values()) if (p.dim === f.dim && Math.hypot(p.x - f.center.x, p.z - f.center.z) < f.leash + 40) p.send(msg);
  }

  private fx(f: HbFight, msg: Omit<Extract<S2C, { t: 'fx' }>, 't'>): void {
    this.send(f, { t: 'fx', ...msg } as S2C);
  }

  /** Ends a fight without a winner: he goes back where he came from, the blocks are put back. */
  reset(f: HbFight, quiet = false): void {
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = [];
    const m = f.boss;
    if (m && !m.removed) {
      if (!quiet) {
        this.fx(f, { kind: 'afterimage', id: m.id, ticks: 20 });
        this.server.particles(f.dim, 'glitch', m.x, m.y + 1, m.z, 40, 0.6);
      }
      m.remove();
    }
    this.restoreAll(f);
    for (const p of f.bar) p.send({ t: 'boss', id: m?.id ?? -1, action: 'remove' });
    f.bar.clear();
    if (this.fight === f) this.fight = null;
  }

  // ------------------------------------------------------------------ the fight

  tick(): void {
    const f = this.fight;
    if (!f) {
      if (this.server.tickNo % 40 === 0) this.restoreSaved();
      return;
    }
    const s = this.server;
    const m = f.boss;
    if (m && m.removed && f.state !== 'dying') {
      this.hb.onFightLost(f);
      this.reset(f, true);
      return;
    }
    f.t++;
    const players = this.participants(f);
    for (const p of players) f.party.add(p.uuid);
    if (f.state !== 'dying') {
      if (!players.length) {
        if (++f.absent > RESET_AFTER) {
          this.hb.onFightLost(f);
          this.reset(f);
          return;
        }
      } else f.absent = 0;
    }
    if (s.tickNo % 5 === 0) this.recordTrails(f, players);
    if (f.kind === 'final') this.rescueFromPit(f, players);
    this.updateBar(f);
    this.runHazards(f, players);
    if (m) m.body.fallDistance = 0;

    switch (f.state) {
      case 'emerge':
        this.emerge(f);
        return;
      case 'intro':
        this.intro(f, players);
        return;
      case 'retreat':
        this.retreat(f);
        return;
      case 'dying':
        this.hb.dying(f, f.t);
        return;
    }
    if (!m) return;
    // Phases (the cave) and going back in (the first fight)
    const frac = m.health / m.maxHealth;
    if (f.kind === 'first' && frac <= RETREAT_AT) {
      this.beginRetreat(f);
      return;
    }
    if (f.kind === 'final') {
      const ph = frac > 2 / 3 ? 1 : frac > 1 / 3 ? 2 : 3;
      if (ph > f.phase && f.state !== 'transition') {
        f.phase = ph;
        this.beginTransition(f, players);
        return;
      }
    }
    if (f.state === 'transition') {
      this.transition(f);
      return;
    }
    this.moveAndMelee(f, m, players);
    if (!players.length || --f.cooldown > 0) return;
    const kind = this.pick(f);
    f.last = kind;
    f.attacks++;
    const tele = this.telegraph(players.length);
    this.attack(f, kind, players, tele);
    const base = f.kind === 'first' ? 70 : Math.max(34, 74 - f.phase * 12);
    f.cooldown = base + tele + (players.length > 1 ? 8 : 0);
  }

  /** Warning time before an attack lands: never under 24 ticks, more with company. */
  telegraph(players: number): number {
    return 24 + (players > 1 ? 8 : 0);
  }

  private emerge(f: HbFight): void {
    const m = f.boss;
    const s = this.server;
    if (!m) {
      this.reset(f, true);
      return;
    }
    // Out of the screen and a step forward, flickering
    const k = Math.min(1, f.t / EMERGE_TICKS);
    m.setPos(f.home.x + (f.center.x - f.home.x) * k, f.center.y, f.home.z + (f.center.z - f.home.z) * k);
    m.body.vx = m.body.vy = m.body.vz = 0;
    if (f.t % 4 === 0) s.particles(f.dim, 'glitch', m.x, m.y + 1, m.z, 10, 0.4);
    if (f.t === 1) {
      s.playSound(f.dim, 'herobrine.emerge', m.x, m.y + 1, m.z, 3, 1);
      this.fx(f, { kind: 'glitch', strength: 0.5, ticks: 20 });
    }
    if (f.t >= EMERGE_TICKS) {
      delete m.data.untouchable;
      m.data.hbAnim = 'idle';
      m.metaDirty = true;
      f.state = 'fight';
      f.t = 0;
      f.cooldown = 40;
      this.hb.onFirstBegins(f);
    }
  }

  private intro(f: HbFight, players: ServerPlayer[]): void {
    const s = this.server;
    if (f.t === 1) {
      this.fx(f, { kind: 'hack', text: 'HER0BRINE.EXE', strength: 1, ticks: 40 });
      s.playSound(f.dim, 'herobrine.presence', f.home.x, f.home.y + 1, f.home.z, 4, 0.8);
    }
    if (f.t % 10 === 0) this.fx(f, { kind: 'glitch', strength: Math.min(0.6, 0.1 + f.t / 200), ticks: 10 });
    if (f.t === 30) {
      const m = this.spawn(f, f.home.x, f.home.y, f.home.z);
      if (!m) {
        this.reset(f, true);
        return;
      }
      m.data.untouchable = true;
      m.data.hbAnim = 'plugged';
      m.yaw = Math.atan2(-(f.center.x - m.x), -(f.center.z - m.z));
      m.headYaw = m.yaw;
      m.metaDirty = true;
    }
    if (f.t > 30 && f.t < 90 && f.t % 15 === 0 && f.core) {
      // Current runs out of the core and into him
      for (const c of f.coils.slice(0, 4)) this.fx(f, { kind: 'arc', id: this.nextFx++, x: c.x + 0.5, y: c.y + 2.2, z: c.z + 0.5, x1: f.core.x + 0.5, y1: f.core.y + 3, z1: f.core.z + 0.5, ticks: 10 });
      s.playSound(f.dim, 'tesla.zap', f.core.x, f.core.y + 2, f.core.z, 3, 0.8 + this.rng.next() * 0.3);
    }
    if (f.t === 80 && f.boss) {
      s.playSound(f.dim, 'herobrine.unplug', f.boss.x, f.boss.y + 1, f.boss.z, 4, 1);
      this.fx(f, { kind: 'pulse', x: f.boss.x, y: f.floorY + 1.2, z: f.boss.z, r: 10, ticks: 24 });
    }
    if (f.t >= INTRO_TICKS && f.boss) {
      delete f.boss.data.untouchable;
      f.boss.data.hbAnim = 'idle';
      f.boss.metaDirty = true;
      f.state = 'fight';
      f.t = 0;
      f.cooldown = 30;
      this.hb.onFinalBegins(f, players);
    }
  }

  private beginRetreat(f: HbFight): void {
    const m = f.boss!;
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = [];
    m.stopNavigation();
    m.data.untouchable = true;
    m.metaDirty = true;
    f.state = 'retreat';
    f.t = 0;
    this.fx(f, { kind: 'afterimage', id: m.id, ticks: 24 });
    this.server.playSound(f.dim, 'herobrine.teleport', m.x, m.y + 1, m.z, 3, 0.7);
  }

  /** Back into the computer: in front of the screen, then into it. */
  private retreat(f: HbFight): void {
    const m = f.boss;
    const s = this.server;
    if (!m) return;
    if (f.t === 2) {
      m.setPos(f.center.x, f.center.y, f.center.z);
      m.yaw = Math.atan2(-(f.home.x - f.center.x), -(f.home.z - f.center.z)) + Math.PI;
      m.headYaw = m.yaw;
      m.data.hbAnim = 'retreat';
      m.metaDirty = true;
      s.playSound(f.dim, 'herobrine.retreat', m.x, m.y + 1, m.z, 3, 1);
    }
    if (f.t > 10) {
      const k = Math.min(1, (f.t - 10) / (RETREAT_TICKS - 20));
      m.setPos(f.center.x + (f.home.x - f.center.x) * k, f.center.y, f.center.z + (f.home.z - f.center.z) * k);
      m.body.vx = m.body.vy = m.body.vz = 0;
      if (f.t % 3 === 0) s.particles(f.dim, 'glitch', m.x, m.y + 1, m.z, 8, 0.4);
    }
    if (f.t >= RETREAT_TICKS) {
      for (const p of f.bar) p.send({ t: 'boss', id: m.id, action: 'remove' });
      f.bar.clear();
      m.remove();
      f.boss = null;
      this.fight = null;
      this.hb.onFirstRetreat(f);
    }
  }

  private beginTransition(f: HbFight, players: ServerPlayer[]): void {
    const m = f.boss!;
    const s = this.server;
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = f.hazards.filter((h) => h.kind === 'hole' || h.kind === 'cage');
    this.fx(f, { kind: 'afterimage', id: m.id, ticks: 24 });
    m.stopNavigation();
    m.setPos(f.home.x, f.home.y, f.home.z);
    m.data.untouchable = true;
    m.data.hbAnim = 'plugged';
    m.metaDirty = true;
    f.state = 'transition';
    f.t = 0;
    this.fx(f, { kind: 'hack', text: 'SYSTEM BREACH', strength: 1, ticks: 40 });
    this.fx(f, { kind: 'glitch', strength: 0.45, ticks: 24 });
    s.playSound(f.dim, 'herobrine.phase', m.x, m.y + 1, m.z, 5, 0.8);
    void players;
  }

  private transition(f: HbFight): void {
    const m = f.boss!;
    const s = this.server;
    if (f.t % 12 === 0 && f.core) {
      for (const c of f.coils) if (this.rng.chance(0.5)) this.fx(f, { kind: 'arc', id: this.nextFx++, x: c.x + 0.5, y: c.y + 2.2, z: c.z + 0.5, x1: f.core.x + 0.5, y1: f.core.y + 3, z1: f.core.z + 0.5, ticks: 8 });
      s.playSound(f.dim, 'tesla.zap', f.core.x, f.core.y + 2, f.core.z, 3, 0.7 + f.t / 200);
    }
    if (f.t >= TRANSITION_TICKS) {
      delete m.data.untouchable;
      m.data.hbAnim = 'idle';
      m.metaDirty = true;
      f.state = 'fight';
      f.t = 0;
      f.cooldown = 20;
    }
  }

  /** Between attacks he closes in (he walks; he doesn't run) and lashes out at anyone beside him. */
  private moveAndMelee(f: HbFight, m: Mob, players: ServerPlayer[]): void {
    const s = this.server;
    let best: ServerPlayer | null = null;
    let bd = Infinity;
    for (const p of players) {
      const d = p.distanceSq(m.x, m.y, m.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) {
      m.stopNavigation();
      return;
    }
    const d = Math.sqrt(bd);
    m.lookAt = { x: best.x, y: best.y + 1.6, z: best.z };
    // Stay in the arena
    const outside = Math.hypot(m.x - f.center.x, m.z - f.center.z) > (f.kind === 'final' ? f.radius - 3 : f.leash - 8);
    if (outside) m.navigateTo(f.center.x, f.center.y, f.center.z, 1.2);
    else if (d > 3 && s.tickNo % 10 === 0) m.navigateTo(best.x, best.y, best.z, 1);
    else if (d <= 3) m.stopNavigation();
    // A swing, wound up for a moment first
    if (f.meleeAt === 0 && d < 2.6 && s.tickNo % 4 === 0) {
      f.meleeAt = s.tickNo + 8;
      m.data.hbAnim = 'windup';
      m.metaDirty = true;
    }
    if (f.meleeAt && s.tickNo >= f.meleeAt) {
      f.meleeAt = 0;
      m.data.hbAnim = 'idle';
      m.metaDirty = true;
      s.broadcastNear(f.dim, m.x, m.y, m.z, 64, { t: 'anim', id: m.id, anim: 'swing' });
      for (const p of players) {
        if (p.distanceSq(m.x, m.y, m.z) > 3.1 * 3.1) continue;
        this.hurt(f, p, 5 + f.phase, p.x - m.x, p.z - m.z, 0.6);
      }
      f.cooldown = Math.max(f.cooldown, 12);
    }
  }

  private pick(f: HbFight): Attack {
    const w: [Attack, number][] = [];
    if (f.kind === 'first') w.push(['strike', 3], ['bolts', 3], ['pulse', 2], ['static', 2]);
    else {
      w.push(['coils', 3], ['lightning', 3], ['chain', 2], ['strike', 2], ['hack', 2], ['bolts', 1]);
      if (f.phase >= 2) w.push(['pull', 2], ['cage', 2], ['push', 1], ['hack', 1]);
      if (f.phase >= 3) w.push(['corrupt', 3], ['rain', 2]);
      if (!f.coils.length) for (const e of w) if (e[0] === 'coils') e[1] = 0;
    }
    const options = w.filter(([k, n]) => k !== f.last && n > 0);
    let total = 0;
    for (const [, n] of options) total += n;
    let r = this.rng.next() * total;
    for (const [k, n] of options) if ((r -= n) < 0) return k;
    return 'strike';
  }

  // ------------------------------------------------------------------ attacks

  private attack(f: HbFight, kind: Attack, players: ServerPlayer[], tele: number): void {
    const m = f.boss!;
    const s = this.server;
    const now = s.tickNo;
    const target = players[this.rng.int(players.length)]!;
    const anim = (a: string): void => {
      m.data.hbAnim = a;
      m.metaDirty = true;
    };
    switch (kind) {
      case 'strike': {
        // He'll be standing right behind them
        anim('vanish');
        const bx = target.x + Math.sin(target.yaw) * 1.1;
        const bz = target.z + Math.cos(target.yaw) * 1.1;
        const h: Hazard = { kind: 'strike', id: this.nextFx++, at: now + tele + 6, until: now + tele + 6, x: bx, y: Math.floor(target.y + 0.01), z: bz, r: 2, dmg: 7 + f.phase, target };
        this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.at - now });
        if (f.kind === 'final') target.send({ t: 'fx', kind: 'hack', text: 'HER0BRINE.EXE', strength: 0, ticks: h.at - now });
        s.playSound(f.dim, 'herobrine.whisper', target.x, target.y + 1, target.z, 1.2, 1);
        f.hazards.push(h);
        break;
      }
      case 'bolts': {
        anim('cast');
        const n = f.kind === 'first' ? 3 : 2 + f.phase;
        for (let i = 0; i < n; i++) {
          const t = players[i % players.length]!;
          const h: Hazard = { kind: 'bolt', id: this.nextFx++, at: now + 14 + tele + i * 10, until: now + 14 + tele + i * 10, x: m.x, y: m.y + EYE, z: m.z, x1: t.x, y1: t.y + 1, z1: t.z, r: 0, dmg: 5 + f.phase, target: t, trackUntil: now + 14 + i * 10 };
          this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: h.at - now });
          f.hazards.push(h);
        }
        s.playSound(f.dim, 'herobrine.charge', m.x, m.y + 1, m.z, 2, 1);
        break;
      }
      case 'pulse': {
        anim('slam');
        const r = f.kind === 'first' ? 11 : 15;
        this.fx(f, { kind: 'warn_circle', id: this.nextFx++, x: m.x, y: Math.floor(m.y), z: m.z, r, ticks: tele });
        f.hazards.push({ kind: 'pulse', id: this.nextFx++, at: now + tele, until: now + tele + 26, x: m.x, y: Math.floor(m.y), z: m.z, r, dmg: 6 + f.phase, hit: new Set() });
        s.playSound(f.dim, 'herobrine.charge', m.x, m.y + 1, m.z, 3, 0.6);
        break;
      }
      case 'static': {
        anim('cast');
        const n = Math.min(3, players.length + 1);
        for (let i = 0; i < n; i++) {
          const spot = this.near(players[i % players.length]!, i < players.length ? 0.4 : 5);
          const h: Hazard = { kind: 'static', id: this.nextFx++, at: now + tele, until: now + tele + 140, ...spot, r: 2.6, dmg: 2 };
          this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: tele });
          f.hazards.push(h);
        }
        s.playSound(f.dim, 'glitch.static', m.x, m.y + 1, m.z, 2, 0.8);
        break;
      }
      case 'coils': {
        anim('cast');
        // The coils nearest people charge up
        const ranked = f.coils.map((c) => ({ c, d: Math.min(...players.map((p) => Math.hypot(p.x - c.x - 0.5, p.z - c.z - 0.5))) })).sort((a, b) => a.d - b.d);
        const n = Math.min(ranked.length, 1 + f.phase);
        for (let i = 0; i < n; i++) {
          const c = ranked[i]!.c;
          const h: Hazard = { kind: 'coil', id: this.nextFx++, at: now + tele + 10, until: now + tele + 10, x: c.x + 0.5, y: c.y, z: c.z + 0.5, r: 4.5, dmg: 6 + f.phase };
          this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.at - now });
          if (f.core) this.fx(f, { kind: 'arc', id: this.nextFx++, x: f.core.x + 0.5, y: f.core.y + 3, z: f.core.z + 0.5, x1: h.x, y1: h.y + 2.2, z1: h.z, ticks: h.at - now });
          f.hazards.push(h);
        }
        s.playSound(f.dim, 'tesla.charge', m.x, m.y + 2, m.z, 4, 1);
        break;
      }
      case 'lightning': {
        anim('cast');
        const n = 2 + f.phase + Math.min(3, players.length - 1);
        for (let i = 0; i < n; i++) {
          const p = players[i % players.length]!;
          const spot = this.near(p, i < players.length ? 0.6 : 4.5);
          const h: Hazard = { kind: 'lightning', id: this.nextFx++, at: now + tele + 4 + i * 3, until: now + tele + 4 + i * 3, ...spot, r: 1.9, dmg: 7 + f.phase };
          this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.at - now });
          f.hazards.push(h);
        }
        s.playSound(f.dim, 'tesla.charge', m.x, m.y + 2, m.z, 4, 1.3);
        break;
      }
      case 'chain': {
        anim('cast');
        const h: Hazard = { kind: 'chain', id: this.nextFx++, at: now + 16 + tele, until: now + 16 + tele + 8, x: m.x, y: m.y + 1.3, z: m.z, x1: target.x, y1: target.y + 1, z1: target.z, r: 1.3, dmg: 9 + f.phase, target, trackUntil: now + 16 };
        this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: h.at - now });
        f.hazards.push(h);
        s.playSound(f.dim, 'tesla.charge', m.x, m.y + 1, m.z, 3, 0.8);
        break;
      }
      case 'hack': {
        anim('cast');
        const kinds: HackKind[] = ['override', 'denied', 'lost', 'breach'];
        const n = players.length > 1 ? 2 : 1;
        const picked = [...players].sort(() => this.rng.next() - 0.5).slice(0, n);
        for (const p of picked) {
          const hk = kinds[this.rng.int(kinds.length)]!;
          const h: Hazard = { kind: 'hack', id: this.nextFx++, at: now + tele + 16, until: now + tele + 16, x: p.x, y: p.y, z: p.z, r: 0, dmg: 0, target: p, hack: hk };
          // The warning: what is coming, and when
          p.send({ t: 'fx', kind: 'hack', text: HACK_TEXT[hk], strength: 0, ticks: h.at - now });
          s.playSound(f.dim, 'computer.alert', p.x, p.y + 1, p.z, 1, 0.6);
          f.hazards.push(h);
        }
        break;
      }
      case 'pull': {
        anim('pull');
        const at = now + tele + 16;
        this.fx(f, { kind: 'hack', text: HACK_TEXT.override, strength: 0, ticks: at - now });
        this.fx(f, { kind: 'warn_circle', id: this.nextFx++, x: m.x, y: Math.floor(m.y), z: m.z, r: 4, ticks: at - now + 18 });
        m.stopNavigation();
        f.hazards.push({ kind: 'pull', id: this.nextFx++, at, until: at + 18, x: m.x, y: Math.floor(m.y), z: m.z, r: 4, dmg: 8 + f.phase, hit: new Set() });
        s.playSound(f.dim, 'herobrine.charge', m.x, m.y + 1, m.z, 4, 0.5);
        f.cooldown += 18;
        break;
      }
      case 'push': {
        anim('slam');
        const h: Hazard = { kind: 'push', id: this.nextFx++, at: now + tele, until: now + tele, x: m.x, y: Math.floor(m.y), z: m.z, r: 7, dmg: 5 + f.phase };
        this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: tele });
        m.stopNavigation();
        f.hazards.push(h);
        s.playSound(f.dim, 'herobrine.charge', m.x, m.y + 1, m.z, 3, 0.7);
        break;
      }
      case 'corrupt': {
        anim('cast');
        this.fx(f, { kind: 'hack', text: 'WORLD DATA CORRUPTED', strength: 0, ticks: tele + 20 });
        for (const p of players.slice(0, 3)) {
          const spot = this.near(p, 1);
          if (Math.hypot(spot.x - m.x, spot.z - m.z) < 5) continue;
          this.hole(f, spot, now + tele + 20);
        }
        break;
      }
      case 'cage': {
        anim('cast');
        const p = target;
        const h: Hazard = { kind: 'cage', id: this.nextFx++, at: now + tele + 6, until: now + tele + 6 + 70, x: Math.floor(p.x) + 0.5, y: Math.floor(p.y + 0.01), z: Math.floor(p.z) + 0.5, r: 1.5, dmg: 0, target: p };
        this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.at - now });
        s.playSound(f.dim, 'glitch.warn', p.x, p.y + 1, p.z, 1.5, 1);
        f.hazards.push(h);
        break;
      }
      case 'rain': {
        anim('cast');
        const n = 3 + f.phase;
        for (let i = 0; i < n; i++) {
          const p = players[i % players.length]!;
          const spot = i < players.length ? this.near(p, 0.8) : this.near(p, 4);
          this.rainBlock(f, spot, now + tele + 8, 7 + f.phase);
        }
        s.playSound(f.dim, 'glitch.static', m.x, m.y + 4, m.z, 3, 0.6);
        break;
      }
    }
    // The screen glitches with every attack in the cave, never enough to hide the warnings
    if (f.kind === 'final' && this.rng.chance(0.35)) for (const p of players) p.send({ t: 'fx', kind: 'glitch', strength: 0.12, ticks: 6 });
    if (f.kind === 'final' && this.rng.chance(0.2)) {
      const p = players[this.rng.int(players.length)]!;
      p.send({ t: 'fx', kind: 'hack', text: HACK_MESSAGES[this.rng.int(HACK_MESSAGES.length)]!, strength: 2, ticks: 14 });
    }
  }

  private rainBlock(f: HbFight, spot: { x: number; y: number; z: number }, at: number, dmg: number): void {
    const now = this.server.tickNo;
    const h: Hazard = { kind: 'rain', id: this.nextFx++, at, until: at, ...spot, r: 1.6, dmg };
    this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: at - now });
    const ticks = at - now;
    const fall = Math.min(12, 0.017 * ticks * ticks);
    const fb = new FallingBlock(this.rng.chance(0.5) ? S('data_block') : S('wireframe_block'));
    fb.shatter = true;
    fb.setPos(spot.x, spot.y + fall, spot.z);
    f.dim.addEntity(fb);
    f.hazards.push(h);
  }

  /** WORLD DATA CORRUPTED: the floor under someone flickers, then isn't there. */
  private hole(f: HbFight, spot: { x: number; y: number; z: number }, at: number): void {
    const cells: [number, number, number][] = [];
    const missing = S('missing_block');
    const fy = f.floorY;
    if (Math.abs(spot.y - 1 - fy) > 1) return;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 5) continue;
        const x = Math.floor(spot.x) + dx;
        const z = Math.floor(spot.z) + dz;
        if (Math.hypot(x - f.center.x, z - f.center.z) > f.radius - 4) continue;
        const st = f.dim.getState(x, fy, z);
        if (!STATE_SOLID[st] || f.dim.blockId(x, fy, z) === 'herobrine_core') continue;
        this.remember(f, x, fy, z, st);
        f.dim.setBlock(x, fy, z, missing);
        cells.push([x, fy, z]);
      }
    if (!cells.length) return;
    const h: Hazard = { kind: 'hole', id: this.nextFx++, at, until: at + 120, ...spot, r: 2.2, dmg: 0, cells };
    this.fx(f, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: at - this.server.tickNo });
    f.hazards.push(h);
  }

  private near(p: ServerPlayer, spread: number): { x: number; y: number; z: number } {
    const a = this.rng.next() * Math.PI * 2;
    const r = this.rng.next() * spread;
    return { x: p.x + Math.cos(a) * r, y: Math.floor(p.y + 0.01), z: p.z + Math.sin(a) * r };
  }

  private hurt(f: HbFight, p: ServerPlayer, dmg: number, kx: number, kz: number, kb = 0.6): void {
    const d = Math.hypot(kx, kz) || 1;
    this.server.interaction.survival.damage(p, dmg, { source: 'mob', attacker: f.boss ?? undefined, kbx: kx / d, kbz: kz / d, knockback: kb });
  }

  // ------------------------------------------------------------------ hazards (resolved when they land)

  private runHazards(f: HbFight, players: ServerPlayer[]): void {
    const now = this.server.tickNo;
    const keep: Hazard[] = [];
    const before = f.hazards;
    f.hazards = [];
    for (const h of before) {
      if (this.runHazard(f, h, players, now)) keep.push(h);
      else this.endHazard(f, h);
    }
    f.hazards = keep.concat(f.hazards);
  }

  /** Returns false once the hazard is over. */
  private runHazard(f: HbFight, h: Hazard, players: ServerPlayer[], now: number): boolean {
    const s = this.server;
    const m = f.boss;
    switch (h.kind) {
      case 'strike': {
        if (now < h.at) return true;
        if (!m || m.removed || m.dead) return false;
        // HER0BRINE.EXE: he is there
        this.fx(f, { kind: 'afterimage', id: m.id, ticks: 16 });
        const bx = Math.floor(h.x);
        const bz = Math.floor(h.z);
        const free = !STATE_SOLID[f.dim.getState(bx, h.y, bz)] && !STATE_SOLID[f.dim.getState(bx, h.y + 1, bz)];
        if (free) m.setPos(h.x, h.y, h.z);
        m.body.vx = m.body.vy = m.body.vz = 0;
        m.data.hbAnim = 'idle';
        m.metaDirty = true;
        s.broadcastNear(f.dim, m.x, m.y, m.z, 64, { t: 'anim', id: m.id, anim: 'swing' });
        s.playSound(f.dim, 'herobrine.strike', h.x, h.y + 1, h.z, 2, 1);
        s.particles(f.dim, 'glitch', h.x, h.y + 1, h.z, 20, 0.5);
        for (const p of players) {
          if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 2.5) continue;
          this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 0.9);
        }
        return false;
      }
      case 'bolt': {
        if (!m || m.removed || m.dead) return false;
        h.x = m.x;
        h.y = m.y + EYE;
        h.z = m.z;
        if (now < h.trackUntil! && h.target && !h.target.dead) {
          h.x1 = h.target.x;
          h.y1 = h.target.y + 1;
          h.z1 = h.target.z;
          if ((h.trackUntil! - now) % 4 === 0) this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: h.at - now });
          return true;
        }
        if (now < h.at) return true;
        const pr = s.mobs?.projectile(f.dim, 'herobrine_bolt', h.x, h.y, h.z, m);
        if (pr) {
          pr.data = { dmg: h.dmg };
          pr.admin = f.cheat;
          pr.shoot(h.x1! - h.x, h.y1! - h.y, h.z1! - h.z, 1.5, 0, () => this.rng.next());
        }
        s.playSound(f.dim, 'herobrine.bolt', h.x, h.y, h.z, 2, 1);
        return false;
      }
      case 'pulse': {
        if (now < h.at) return true;
        if (now === h.at) {
          this.fx(f, { kind: 'pulse', x: h.x, y: h.y + 0.2, z: h.z, r: h.r, ticks: h.until - h.at });
          s.playSound(f.dim, 'herobrine.slam', h.x, h.y, h.z, 4, 0.8);
        }
        const R = h.r * ((now - h.at) / (h.until - h.at));
        for (const p of players) {
          if (h.hit!.has(p)) continue;
          const d = Math.hypot(p.x - h.x, p.z - h.z);
          // A ring along the ground: jump over it
          if (Math.abs(d - R) > 1.2 || Math.abs(p.y - h.y) > 1.5 || !p.body.onGround) continue;
          h.hit!.add(p);
          this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 1.1);
        }
        return now < h.until;
      }
      case 'static': {
        if (now < h.at) return true;
        if (!h.started) {
          h.started = true;
          this.fx(f, { kind: 'zone', id: h.id, x: h.x, y: h.y, z: h.z, r: h.r, ticks: h.until - now, text: 'static' });
        }
        if ((now - h.at) % 10 === 0)
          for (const p of players) {
            if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 2.5) continue;
            s.interaction.survival.damage(p, h.dmg, { source: 'magic', attacker: m ?? undefined });
            s.interaction.survival.addEffect(p, 'slowness', 1, 30);
          }
        return now < h.until;
      }
      case 'coil': {
        if (now < h.at) return true;
        let any = false;
        for (const p of players) {
          if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || p.y > h.y + 6 || p.y < h.y - 3) continue;
          any = true;
          this.fx(f, { kind: 'arc', id: this.nextFx++, x: h.x, y: h.y + 2.2, z: h.z, x1: p.x, y1: p.y + 1, z1: p.z, ticks: 8 });
          this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 0.5);
        }
        if (!any)
          for (let i = 0; i < 2; i++) {
            const a = this.rng.next() * Math.PI * 2;
            this.fx(f, { kind: 'arc', id: this.nextFx++, x: h.x, y: h.y + 2.2, z: h.z, x1: h.x + Math.cos(a) * 3, y1: h.y, z1: h.z + Math.sin(a) * 3, ticks: 8 });
          }
        s.playSound(f.dim, 'tesla.zap', h.x, h.y + 2, h.z, 3, 0.9 + this.rng.next() * 0.2);
        s.particles(f.dim, 'electric', h.x, h.y + 2.2, h.z, 16, 0.6);
        return false;
      }
      case 'lightning': {
        if (now < h.at) return true;
        this.fx(f, { kind: 'bolt', x: h.x, y: h.y, z: h.z, ticks: 8 });
        s.playSound(f.dim, 'tesla.zap', h.x, h.y + 1, h.z, 3, 0.6);
        s.particles(f.dim, 'electric', h.x, h.y + 0.5, h.z, 14, 0.6);
        for (const p of players) {
          if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 3) continue;
          this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 0.4);
        }
        return false;
      }
      case 'chain': {
        if (!m || m.removed || m.dead) return false;
        if (now < h.trackUntil! && h.target && !h.target.dead) {
          h.x = m.x;
          h.y = m.y + 1.3;
          h.z = m.z;
          h.x1 = h.target.x;
          h.y1 = h.target.y + 1;
          h.z1 = h.target.z;
          if ((h.trackUntil! - now) % 4 === 0) this.fx(f, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: h.at - now });
          return true;
        }
        if (now < h.at) return true;
        if (now === h.at) {
          const [ex, ey, ez] = extend(h, 40);
          this.fx(f, { kind: 'arc', id: h.id, x: h.x, y: h.y, z: h.z, x1: ex, y1: ey, z1: ez, ticks: 10, strength: 1 });
          s.playSound(f.dim, 'tesla.zap', h.x, h.y, h.z, 4, 0.5);
          for (const p of players) {
            if (segDist(p.x, p.y + 0.9, p.z, h.x, h.y, h.z, ex, ey, ez) > h.r) continue;
            if (!clearLine(f.dim, h.x, h.y, h.z, p.x, p.y + 0.9, p.z, m)) continue;
            this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 0.8);
          }
        }
        return now < h.until;
      }
      case 'hack': {
        if (now < h.at) return true;
        const p = h.target;
        if (!p || p.dead || !players.includes(p)) return false;
        p.send({ t: 'fx', kind: 'hack', text: HACK_TEXT[h.hack!], strength: 1, ticks: 30 });
        switch (h.hack) {
          case 'override':
            p.send({ t: 'fx', kind: 'controls_reversed', ticks: 80 });
            break;
          case 'denied':
            s.interaction.survival.addEffect(p, 'weakness', 1, 100);
            break;
          case 'lost': {
            // Back to where they were a moment ago (if it's still somewhere to stand)
            const tr = f.trail.get(p);
            const back = tr && tr.length >= 8 ? tr[tr.length - 8]! : null;
            p.send({ t: 'fx', kind: 'hack', text: 'CONNECTION LOST', strength: 3, ticks: 16 });
            if (back) {
              const [x, y, z] = back;
              if (!STATE_SOLID[f.dim.getState(Math.floor(x), Math.floor(y), Math.floor(z))] && !STATE_SOLID[f.dim.getState(Math.floor(x), Math.floor(y) + 1, Math.floor(z))]) s.teleport(p, x, y, z);
            }
            break;
          }
          case 'breach':
            p.send({ t: 'fx', kind: 'player_glitch', ticks: 50 });
            s.interaction.survival.addEffect(p, 'slowness', 1, 60);
            break;
        }
        s.playSound(f.dim, 'computer.glitch', p.x, p.y + 1, p.z, 1.2, 0.8);
        return false;
      }
      case 'pull': {
        if (now < h.at) return true;
        if (!m || m.removed || m.dead) return false;
        if (now < h.until) {
          // Dragged towards him: run against it
          if ((now - h.at) % 4 === 0)
            for (const p of players) {
              const dx = m.x - p.x;
              const dz = m.z - p.z;
              const d = Math.hypot(dx, dz);
              if (d < 1.5 || d > 26) continue;
              p.send({ t: 'velocity', id: p.id, vx: (dx / d) * 0.55, vy: 0.08, vz: (dz / d) * 0.55 });
            }
          if ((now - h.at) % 6 === 0) s.particles(f.dim, 'glitch', m.x, m.y + 1, m.z, 12, 2);
          return true;
        }
        // The slam
        s.playSound(f.dim, 'herobrine.slam', m.x, m.y, m.z, 4, 0.7);
        s.particles(f.dim, 'explosion_smoke', m.x, m.y + 0.5, m.z, 20, 2);
        for (const p of players) {
          if (Math.hypot(p.x - m.x, p.z - m.z) > h.r || Math.abs(p.y - m.y) > 2.5) continue;
          this.hurt(f, p, h.dmg, p.x - m.x, p.z - m.z, 1.4);
        }
        return false;
      }
      case 'push': {
        if (now < h.at) return true;
        s.playSound(f.dim, 'herobrine.slam', h.x, h.y, h.z, 4, 1);
        this.fx(f, { kind: 'pulse', x: h.x, y: h.y + 0.2, z: h.z, r: h.r, ticks: 12 });
        for (const p of players) {
          const dx = p.x - h.x;
          const dz = p.z - h.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > h.r || Math.abs(p.y - h.y) > 3) continue;
          s.interaction.survival.damage(p, h.dmg, { source: 'mob', attacker: m ?? undefined });
          p.send({ t: 'velocity', id: p.id, vx: (dx / d) * 1.5, vy: 0.55, vz: (dz / d) * 1.5 });
        }
        return false;
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
      case 'cage': {
        if (now < h.at) return true;
        if (!h.started) {
          h.started = true;
          const p = h.target;
          // Only if they didn't step out of the circle
          if (!p || p.dead || Math.hypot(p.x - h.x, p.z - h.z) > h.r + 0.3) return false;
          const cells: [number, number, number][] = [];
          const cx = Math.floor(h.x);
          const cz = Math.floor(h.z);
          const wire = S('wireframe_block');
          for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
              for (let dy = 0; dy <= 2; dy++) {
                const inner = dx === 0 && dz === 0 && dy < 2;
                const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
                if (inner || (!edge && dy < 2)) continue;
                const x = cx + dx;
                const y = h.y + dy;
                const z = cz + dz;
                const st = f.dim.getState(x, y, z);
                if (st !== 0) continue;
                // Never inside anyone
                if (players.some((q) => q !== p && Math.floor(q.x) === x && Math.floor(q.z) === z && Math.abs(Math.floor(q.y) - y) <= 1)) continue;
                this.remember(f, x, y, z, st);
                f.dim.setBlock(x, y, z, wire);
                cells.push([x, y, z]);
              }
          h.cells = cells;
          s.playSound(f.dim, 'glitch.zap', h.x, h.y + 1, h.z, 1.5, 0.6);
        }
        return now < h.until;
      }
      case 'rain': {
        if (now < h.at) return true;
        for (const p of players) {
          if (Math.hypot(p.x - h.x, p.z - h.z) > h.r || Math.abs(p.y - h.y) > 3) continue;
          this.hurt(f, p, h.dmg, p.x - h.x, p.z - h.z, 0.4);
        }
        s.particles(f.dim, 'glitch', h.x, h.y + 0.5, h.z, 16, h.r * 0.6);
        s.playSound(f.dim, 'glitch.zap', h.x, h.y, h.z, 1.5, 0.7);
        return false;
      }
    }
    return false;
  }

  private endHazard(f: HbFight, h: Hazard): void {
    if (h.kind === 'static') this.fx(f, { kind: 'zone_end', id: h.id });
    else if (h.kind === 'strike' || h.kind === 'coil' || h.kind === 'lightning' || h.kind === 'hole' || h.kind === 'cage' || h.kind === 'rain' || h.kind === 'push' || h.kind === 'bolt' || h.kind === 'chain') this.fx(f, { kind: 'warn_end', id: h.id });
    if ((h.kind === 'hole' || h.kind === 'cage') && h.cells) for (const [x, y, z] of h.cells) this.putBack(f, x, y, z);
  }

  // ------------------------------------------------------------------ helpers

  private recordTrails(f: HbFight, players: ServerPlayer[]): void {
    for (const p of players) {
      let t = f.trail.get(p);
      if (!t) f.trail.set(p, (t = []));
      if (p.body.onGround) t.push([p.x, p.y, p.z]);
      if (t.length > 12) t.shift();
    }
    for (const p of [...f.trail.keys()]) if (!players.includes(p)) f.trail.delete(p);
  }

  /** Fallen through the floor of the hall: the static at the bottom puts them back on it. */
  private rescueFromPit(f: HbFight, players: ServerPlayer[]): void {
    for (const p of players) {
      const inHall = Math.hypot(p.x - f.center.x, p.z - f.center.z) < f.radius;
      if (!inHall || p.y >= f.floorY - 0.6) {
        f.pit.delete(p);
        continue;
      }
      const n = (f.pit.get(p) ?? 0) + 1;
      f.pit.set(p, n);
      if (n < 12) continue;
      f.pit.delete(p);
      const spot = this.floorSpot(f);
      if (!spot) continue;
      this.server.teleport(p, spot.x, spot.y, spot.z);
      p.send({ t: 'fx', kind: 'glitch', strength: 0.5, ticks: 12 });
      this.server.interaction.survival.damage(p, 2, { source: 'magic' });
      this.server.playSound(f.dim, 'glitch.zap', spot.x, spot.y + 1, spot.z, 1, 0.8);
    }
  }

  private floorSpot(f: HbFight): { x: number; y: number; z: number } | null {
    for (let i = 0; i < 24; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = 4 + this.rng.next() * (f.radius - 9);
      const x = Math.floor(f.center.x + Math.cos(a) * r);
      const z = Math.floor(f.center.z + Math.sin(a) * r);
      const y = f.floorY + 1;
      if (STATE_SOLID[f.dim.getState(x, f.floorY, z)] && !STATE_SOLID[f.dim.getState(x, y, z)] && !STATE_SOLID[f.dim.getState(x, y + 1, z)]) return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
  }

  private remember(f: HbFight, x: number, y: number, z: number, state: number): void {
    const key = `${x},${y},${z}`;
    if (!f.restore.has(key)) f.restore.set(key, state);
    this.save(f);
  }

  private putBack(f: HbFight, x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const st = f.restore.get(key);
    if (st === undefined || !f.dim.isLoaded(x, z)) return;
    // Someone standing in the cell of a cage: leave it open
    f.dim.setBlock(x, y, z, st);
    f.restore.delete(key);
    this.save(f);
  }

  private restoreAll(f: HbFight): void {
    for (const [key, st] of f.restore) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      if (f.dim.isLoaded(x, z)) {
        f.dim.setBlock(x, y, z, st);
        f.restore.delete(key);
      }
    }
    this.save(f);
  }

  private save(f: HbFight): void {
    const flags = this.server.level.flags as Record<string, unknown>;
    if (!f.restore.size) delete flags.herobrineRestore;
    else flags.herobrineRestore = { dim: f.dim.id, blocks: [...f.restore] };
  }

  /** Blocks a fight changed before a restart (or while their chunk was away) go back. */
  restoreSaved(dim?: Dimension): void {
    const flags = this.server.level.flags as Record<string, unknown>;
    const saved = flags.herobrineRestore as { dim: string; blocks: [string, number][] } | undefined;
    if (!saved || !Array.isArray(saved.blocks)) return;
    if (this.fight?.restore.size) return;
    const d = dim ?? this.server.dims.get(saved.dim as never);
    if (!d || d.id !== saved.dim) return;
    const left: [string, number][] = [];
    for (const [key, st] of saved.blocks) {
      const [x, y, z] = String(key).split(',').map(Number) as [number, number, number];
      if (!Number.isFinite(x) || !Number.isFinite(st)) continue;
      if (d.isLoaded(x, z)) d.setBlock(x, y, z, st);
      else left.push([key, st]);
    }
    if (left.length) flags.herobrineRestore = { dim: saved.dim, blocks: left };
    else delete flags.herobrineRestore;
  }

  // ------------------------------------------------------------------ damage, bar, death

  /** How much of a hit Herobrine takes (called from Mob.hurt). */
  scaleDamage(m: Mob, amount: number, info: HurtInfo): number {
    if (m.data.apparition) return info.source === 'kill' ? amount : 0;
    const f = this.fight;
    if (!f || f.boss !== m) return amount;
    if (info.source === 'kill' || info.source === 'void') return f.kind === 'first' && info.source === 'void' ? 0 : amount;
    if (f.state !== 'fight') return 0;
    // The first time he never dies: he goes back into the computer
    if (f.kind === 'first') return Math.min(amount, Math.max(0, m.health - 1));
    return amount;
  }

  private updateBar(f: HbFight): void {
    const m = f.boss;
    if (!m || m.removed) return;
    const progress = Math.max(0, m.health / m.maxHealth);
    const title = f.kind === 'first' ? 'Herobrine' : 'HER0BRINE.EXE';
    for (const p of this.server.players.values()) {
      const near = p.dim === f.dim && Math.hypot(p.x - f.center.x, p.z - f.center.z) < BAR_RANGE;
      if (near && !f.bar.has(p)) {
        f.bar.add(p);
        p.send({ t: 'boss', id: m.id, action: 'add', title, progress, color: 'herobrine' });
      } else if (near && m.metaDirty) p.send({ t: 'boss', id: m.id, action: 'update', progress });
      else if (!near && f.bar.has(p)) {
        f.bar.delete(p);
        p.send({ t: 'boss', id: m.id, action: 'remove' });
      }
    }
  }

  /** Herobrine's health ran out (only ever in the cave, or a stray one). */
  onDeath(m: Mob, killer: ServerPlayer | null, info: HurtInfo): void {
    void killer;
    void info;
    if (m.data.apparition) {
      m.remove();
      return;
    }
    let f = this.fight;
    if (!f || f.boss !== m) f = this.adopt(m);
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards = [];
    this.restoreAll(f);
    f.state = 'dying';
    f.t = 0;
    m.stopNavigation();
    m.data.hbAnim = 'death';
    m.metaDirty = true;
    this.hb.onFinalDefeated(f);
  }

  /** The death sequence is over: the boss goes. */
  finish(f: HbFight): void {
    const m = f.boss;
    for (const p of f.bar) p.send({ t: 'boss', id: m?.id ?? -1, action: 'remove' });
    f.bar.clear();
    if (m && !m.removed) m.remove();
    if (this.fight === f) this.fight = null;
  }

  status(): Record<string, unknown> | null {
    const f = this.fight;
    if (!f) return null;
    return { kind: f.kind, state: f.state, phase: f.phase, health: f.boss?.health ?? 0, maxHealth: f.boss?.maxHealth ?? 0, players: this.participants(f).length };
  }
}

// ---------------------------------------------------------------------------

function extend(h: { x: number; y: number; z: number; x1?: number; y1?: number; z1?: number }, len: number): [number, number, number] {
  const dx = h.x1! - h.x;
  const dy = h.y1! - h.y;
  const dz = h.z1! - h.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  return [h.x + (dx / d) * len, h.y + (dy / d) * len, h.z + (dz / d) * len];
}

function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz);
}

/** No solid block between a beam's source and a point. */
function clearLine(dim: Dimension, ax: number, ay: number, az: number, bx: number, by: number, bz: number, src: Mob): boolean {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.ceil(d * 2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if (Math.abs(x - src.x) < 0.8 && Math.abs(z - src.z) < 0.8) continue;
    if (STATE_SOLID[dim.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) return false;
  }
  return true;
}
