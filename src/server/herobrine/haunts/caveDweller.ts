/**
 * The Cave Dweller's part of the Haunting (the Admin Panel only). It stalks:
 *
 *   below     skittering in the walls and heavy breathing (louder underground and at night)
 *   watches   a tall, pale shape at the edge of the light: look at it and it freezes, then
 *             runs off on all fours; doors open by themselves, torches are knocked off the
 *             walls, crawl holes appear in them
 *   stalks    it follows, closer whenever you look away, and lunges out of the dark (a
 *             fright and a shove, never a wound), then runs
 *   whispers  it answers in whispers, with your own words
 *   finale    every light goes out and it hunts everyone: "taken" (it catches you and drags
 *             you down into the dark of its den) or "dawn" (the sun comes up first; it
 *             screeches and goes back underground)
 *
 * It never hurts anyone: its lunges only push, and its hunt ends in a
 * cutscene. Its crawl holes and the torches it knocks down are recorded
 * like any haunting's changes (Stop puts them back).
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { HauntingSystem } from '../Haunting';
import type { Mob } from '../../entity/Mob';
import { dragWay } from '../../world/drag';
import { DWELLER_DAWN_CHANCE, DWELLER_HUNT_TICKS, DWELLER_END } from '../../../common/game/hauntCast';
import type { HauntPart, HauntState, Figure } from './types';
import type { DimensionId } from '../../../common/data/biomes';
import { NATURAL, seenByAnyone, soundAround, openDoor, safeToTake, steady } from './shared';

const BUDGET: Record<string, Record<string, number>> = {
  below: { skitter: 6, breath: 3, drip: 2 },
  watches: { skitter: 5, breath: 3, sight: 4, door: 2, knock: 3, burrow: 1 },
  stalks: { skitter: 4, breath: 4, stalk: 4, lunge: 2, door: 2, knock: 3, burrow: 2 },
  whispers: { skitter: 4, breath: 4, stalk: 4, lunge: 3, door: 2, knock: 3, burrow: 2 },
  finale: {},
};

/** A caught player's drag down into the den (ticks after the catch). */
const DRAG = { grab: 0, drag: 20, dragTicks: 70, black: 95, eyes: 125, done: 225 } as const;

/** Someone it caught, and their drag. */
interface Caught {
  p: ServerPlayer;
  at: number;
  drag: Mob | null;
  dir: [number, number];
  len: number;
  lead: number;
  from: [number, number, number];
}

interface Hunt {
  t: number;
  final: 'taken' | 'dawn';
  caught: Map<string, Caught>;
  dawnAt: number;
}

export class CaveDwellerHaunt implements HauntPart {
  readonly id = 'cave_dweller' as const;
  readonly budget = BUDGET;
  private hunt: Hunt | null = null;

  constructor(private readonly h: HauntingSystem) {}

  private get rng(): { next(): number; int(n: number): number } {
    return this.h.rng;
  }

  holds(p: ServerPlayer): boolean {
    return !!this.hunt?.caught.has(p.uuid);
  }

  silent(): boolean {
    return !!this.hunt;
  }

  reset(why: 'stop' | 'end'): void {
    const hu = this.hunt;
    if (!hu) return;
    this.hunt = null;
    for (const c of hu.caught.values()) {
      if (c.drag && !c.drag.removed) c.drag.remove();
      if (why === 'stop' && this.h.server.players.has(c.p.conn.id)) c.p.send({ t: 'fx', kind: 'scene', text: 'end', ticks: 1 });
    }
  }

  originOf(p: ServerPlayer): { dim: DimensionId; x: number; y: number; z: number; yaw: number } | null {
    const c = this.hunt?.caught.get(p.uuid);
    return c ? { dim: p.dim.id, x: c.from[0], y: c.from[1], z: c.from[2], yaw: p.yaw } : null;
  }

  /** Leaving while it drags them down: saved where it caught them. */
  release(p: ServerPlayer): void {
    const at = this.originOf(p);
    if (!at) return;
    const c = this.hunt!.caught.get(p.uuid)!;
    if (c.drag && !c.drag.removed) c.drag.remove();
    p.leaveAt = at;
    this.hunt!.caught.delete(p.uuid);
  }

  /** How loud it is where a player is: underground loudest, then at night. */
  private loud(p: ServerPlayer): number {
    const below = p.dim.getHeight(Math.floor(p.x), Math.floor(p.z)) > p.y + 5;
    const t = this.h.server.level.dayTime;
    const night = p.dim.id !== 'overworld' || (t > 13000 && t < 23000);
    return below ? 1 : night ? 0.75 : 0.45;
  }

  event(kind: string, p: ServerPlayer): void {
    const v = this.loud(p);
    switch (kind) {
      case 'skitter':
        // In the walls: close, from anywhere around
        soundAround(this.h, p, 'dweller.skitter', 2, 7, 0.55 * v, 0.9 + this.rng.next() * 0.3, this.rng.next() < 0.6);
        break;
      case 'breath':
        soundAround(this.h, p, 'dweller.breath', 2, 5, 0.6 * v, 0.85 + this.rng.next() * 0.15);
        break;
      case 'drip':
        soundAround(this.h, p, 'cave.drip', 3, 9, 0.5, 0.8, false);
        break;
      case 'sight':
        // Out where the light ends (only by day when it is underground or in the shade of night)
        if (v > 0.5 || this.rng.next() < 0.3) this.sight(p);
        break;
      case 'stalk':
        this.stalk(p);
        break;
      case 'lunge':
        this.lunge(p);
        break;
      case 'door':
        openDoor(this.h, p, 12);
        break;
      case 'knock':
        this.knock(p);
        break;
      case 'burrow':
        this.burrow(p);
        break;
    }
  }

  oneOffs(): void {}

  /** From "It stalks" on, the edges of the screen darken a little. */
  atmosphere(_st: HauntState, f: number, players: ServerPlayer[]): void {
    const dark = Math.max(0, Math.min(1, (f - 0.5) / (0.94 - 0.5))) * 0.4;
    for (const p of players) this.h.sendDark(p, dark);
  }

  // ------------------------------------------------------------------ what it does

  /** A wall torch near the player knocked down (only the sound and a puff of smoke: nobody sees it go). */
  private knock(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 300; tries++) {
      const x = Math.floor(p.x) + this.rng.int(21) - 10;
      const y = Math.floor(p.y) + this.rng.int(9) - 4;
      const z = Math.floor(p.z) + this.rng.int(21) - 10;
      const id = this.h.idAt(dim, x, y, z);
      if (id !== 'wall_torch' && id !== 'soul_wall_torch') continue;
      if (seenByAnyone(this.h, dim, x + 0.5, y + 0.5, z + 0.5, 0.45)) continue;
      if (!this.h.set(dim, x, y, z, 0)) continue;
      const s = this.h.server;
      s.playSound(dim, 'fire.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.7);
      s.playSound(dim, 'dweller.skitter', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.1);
      s.particles(dim, 'smoke', x + 0.5, y + 0.4, z + 0.5, 6, 0.2);
      return;
    }
  }

  /** A crawl hole in a wall: one wide, two high, straight in, through plain stone or dirt. */
  private burrow(p: ServerPlayer): void {
    const dim = p.dim;
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let tries = 0; tries < 16; tries++) {
      const [sx, sz] = this.h.around(p, 4, 12);
      const g = this.h.floorNear(dim, sx, sz, Math.floor(p.y), 6);
      if (g === null) continue;
      const [dx, dz] = dirs[this.rng.int(4)]!;
      // A wall right there: plain ground two high
      const wx = sx + dx;
      const wz = sz + dz;
      if (!NATURAL.test(this.h.idAt(dim, wx, g, wz)) || !NATURAL.test(this.h.idAt(dim, wx, g + 1, wz))) continue;
      if (seenByAnyone(this.h, dim, wx + 0.5, g + 1, wz + 0.5, 0.5)) continue;
      const len = 5 + this.rng.int(4);
      let dug = 0;
      for (let i = 0; i < len; i++) {
        const x = wx + dx * i;
        const z = wz + dz * i;
        if (!NATURAL.test(this.h.idAt(dim, x, g, z)) || !NATURAL.test(this.h.idAt(dim, x, g + 1, z))) break;
        if (dim.getBlockEntity(x, g, z) || dim.getBlockEntity(x, g + 1, z)) break;
        // Nothing to fall or run in once it is dug (steady rock overhead and to the sides)
        if (!steady(dim, x, g, z) || !steady(dim, x, g + 1, z) || !safeToTake(dim, x, g + 1, z) || !safeToTake(dim, x, g, z)) break;
        this.h.set(dim, x, g, z, 0);
        this.h.set(dim, x, g + 1, z, 0);
        dug++;
      }
      if (dug >= 3) {
        this.h.server.playSound(dim, 'dweller.skitter', wx + 0.5, g + 1, wz + 0.5, 0.7, 0.8);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ the figure

  /** Tall and pale, out where the light ends; it freezes when looked at, then runs. */
  private sight(p: ServerPlayer): void {
    if (this.h.figures.some((f) => f.p === p)) return;
    const at = this.h.spotNear(p, 18, 28, true);
    if (at) this.h.spawnFigure(p, 'watch', ...at, 'stare', {}, {}, 'cave_dweller');
  }

  /** It follows from behind, closer whenever you look away. */
  private stalk(p: ServerPlayer): void {
    if (this.h.figures.some((f) => f.p === p)) return;
    for (let tries = 0; tries < 8; tries++) {
      const at = this.h.spotNear(p, 13, 18, false, false, false);
      if (!at || seenByAnyone(this.h, p.dim, at[0], at[1] + 1.5, at[2], 0.5)) continue;
      this.h.spawnFigure(p, 'stalk', ...at, 'crawl', {}, {}, 'cave_dweller');
      return;
    }
  }

  /** Out of the dark right behind you: a screech, a shove, and it is gone. */
  private lunge(p: ServerPlayer): void {
    if (this.h.figures.some((f) => f.p === p)) return;
    const at = this.h.spotNear(p, 2.5, 3.5, false, true);
    if (at) this.h.spawnFigure(p, 'lunge', ...at, 'lunge', {}, {}, 'cave_dweller');
  }

  appear(p: ServerPlayer): boolean {
    const at = this.h.spotNear(p, 12, 18, true);
    return !!at && !!this.h.spawnFigure(p, 'test', ...at, 'stare', {}, {}, 'cave_dweller');
  }

  /** It runs off on all fours, away from the player. */
  private flee(fg: Figure, speed: number): void {
    const { m, p } = fg;
    if (fg.data.fled === undefined) {
      fg.data.fled = 0;
      m.data.hbAnim = 'crawl';
      this.h.server.playSound(m.dim, 'dweller.run', m.x, m.y + 1, m.z, 0.8, 1);
    }
    fg.data.fled = (fg.data.fled as number) + 1;
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    const n = Math.hypot(dx, dz) || 1;
    const nx = m.x + (dx / n) * speed;
    const nz = m.z + (dz / n) * speed;
    m.setPos(nx, this.h.floorNear(m.dim, Math.floor(nx), Math.floor(nz), Math.floor(m.y), 3) ?? m.y, nz);
    // Facing the way it runs
    m.yaw = Math.atan2(-dx, -dz);
    m.headYaw = m.yaw;
    m.metaDirty = true;
  }

  stepFigure(fg: Figure, age: number, d: number): boolean {
    const { m, p } = fg;
    const s = this.h.server;
    if (fg.data.fled !== undefined) {
      this.flee(fg, 0.5);
      return (fg.data.fled as number) < 30;
    }
    m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    m.headYaw = m.yaw;
    const watched = this.h.lookingAt(p, m.x, m.y + 2.2, m.z, 0.9) && this.h.clearLine(p, m.x, m.y + 2.2, m.z);
    if (watched) fg.seen++;
    switch (fg.kind) {
      case 'watch':
        // Frozen while you look; it bolts once you have looked a moment, or come close
        if (fg.seen >= 8 || d < 10) {
          s.playSound(m.dim, 'dweller.screech', m.x, m.y + 2, m.z, 0.5, 1.2);
          this.flee(fg, 0.5);
          return true;
        }
        return age < 400;
      case 'stalk': {
        if (watched) {
          // Caught moving: it stops dead, then goes
          if (m.data.hbAnim !== 'stare') {
            m.data.hbAnim = 'stare';
            m.metaDirty = true;
          }
          if (fg.seen >= 14) this.flee(fg, 0.5);
          return true;
        }
        if (m.data.hbAnim !== 'crawl') {
          m.data.hbAnim = 'crawl';
          m.metaDirty = true;
        }
        if (d > 3.5) this.h.moveTowards(m, p, 0.14);
        else {
          // Close enough: out of the dark at them
          fg.kind = 'lunge';
          fg.since = s.tickNo;
          m.data.hbAnim = 'lunge';
          m.metaDirty = true;
        }
        if (age % 50 === 0) p.send({ t: 'sound', name: 'dweller.breath', x: m.x, y: m.y + 2, z: m.z, volume: 0.5, pitch: 0.9 });
        return age < 900;
      }
      case 'lunge': {
        const k = s.tickNo - fg.since;
        if (k === 1) s.playSound(m.dim, 'dweller.screech', m.x, m.y + 2, m.z, 1.2, 1);
        if (k <= 6) this.h.moveTowards(m, p, 0.35);
        if (k === 6) {
          // A shove, never a wound
          const dx = p.x - m.x;
          const dz = p.z - m.z;
          const n = Math.hypot(dx, dz) || 1;
          p.send({ t: 'velocity', id: p.id, vx: (dx / n) * 0.9, vy: 0.35, vz: (dz / n) * 0.9 });
          p.send({ t: 'fx', kind: 'shake', strength: 0.8, ticks: 14 });
        }
        if (k >= 10) this.flee(fg, 0.55);
        return true;
      }
      case 'test':
        if (fg.seen >= 50) {
          this.flee(fg, 0.5);
          return true;
        }
        return age < 240;
      case 'hunt':
        return true;
      default:
        return age < 400;
    }
  }

  vanish(fg: Figure, gone: boolean): void {
    const { m, p } = fg;
    if (!gone) p.send({ t: 'sound', name: 'dweller.skitter', x: m.x, y: m.y + 1, z: m.z, volume: 0.6, pitch: 0.8 });
    this.h.server.particles(m.dim, 'smoke', m.x, m.y + 1, m.z, 8, 0.4);
  }

  // ------------------------------------------------------------------ the hunt

  finale(st: HauntState, _f: number, players: ServerPlayer[]): void {
    const s = this.h.server;
    if (!this.hunt) {
      st.final ??= (st.ending ?? 'random') === 'random' ? (this.rng.next() < DWELLER_DAWN_CHANCE ? 'dawn' : 'taken') : st.ending;
      this.hunt = { t: -1, final: st.final === 'dawn' ? 'dawn' : 'taken', caught: new Map(), dawnAt: -1 };
      this.h.clearFigures();
      this.h.clearMobs();
    }
    const hu = this.hunt;
    hu.t++;
    const t = hu.t;
    if (t === 0) {
      // Every light goes out; midnight
      this.h.rememberSky(st);
      if (players.some((p) => p.dim.id === 'overworld')) {
        s.level.dayTime = 18000;
        s.sendTime();
      }
      for (const p of players) {
        this.h.torchesOut(p, 40, 16);
        p.send({ t: 'fx', kind: 'haunt', strength: 0.9 * 0.85 });
        this.h.dark.set(p.uuid, 0.9);
        p.send({ t: 'sound', name: 'dweller.screech', x: p.x, y: p.y + 2, z: p.z - 20, volume: 1, pitch: 0.8 });
      }
    }
    // It comes for anyone it has not got yet (someone who joined in the middle too)
    if (t >= 20 && hu.dawnAt < 0)
      for (const p of players) {
        if (hu.caught.has(p.uuid) || p.dead || this.h.figures.some((f) => f.p === p && f.kind === 'hunt')) continue;
        const at = this.h.spotNear(p, 22, 28, false, false, false);
        if (at) {
          const m = this.h.spawnFigure(p, 'hunt', ...at, 'crawl', {}, {}, 'cave_dweller');
          if (m) s.playSound(p.dim, 'dweller.run', at[0], at[1] + 1, at[2], 1, 0.9);
        }
      }
    for (const fg of [...this.h.figures]) {
      if (fg.kind !== 'hunt' || fg.m.removed) continue;
      const { m, p } = fg;
      if (hu.dawnAt >= 0) continue;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      this.h.moveTowards(m, p, 0.3);
      m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
      m.headYaw = m.yaw;
      if (t % 30 === 0) p.send({ t: 'sound', name: 'dweller.breath', x: m.x, y: m.y + 1.5, z: m.z, volume: 0.9, pitch: 0.8 });
      if (d < 1.6) {
        if (hu.final === 'taken') this.take(hu, fg);
        else {
          // Dawn is coming: it only knocks them down and backs off
          p.send({ t: 'velocity', id: p.id, vx: (p.x - m.x) * 0.8, vy: 0.35, vz: (p.z - m.z) * 0.8 });
          p.send({ t: 'fx', kind: 'shake', strength: 0.7, ticks: 12 });
          s.playSound(m.dim, 'dweller.screech', m.x, m.y + 2, m.z, 1.2, 1);
          const back = this.h.spotNear(p, 14, 20, false, false, false);
          if (back) m.setPos(...back);
        }
      }
    }
    if (t === DWELLER_HUNT_TICKS) {
      if (hu.final === 'taken') {
        // Nobody gets away
        for (const fg of [...this.h.figures]) if (fg.kind === 'hunt' && !fg.m.removed) this.take(hu, fg);
        for (const p of players) if (!hu.caught.has(p.uuid)) this.takeNow(hu, p);
      } else {
        // The sun comes up: it screeches and goes back underground
        hu.dawnAt = t;
        if (s.level.dayTime !== 23200) {
          s.level.dayTime = 23200;
          s.sendTime();
        }
        for (const fg of [...this.h.figures]) {
          if (fg.kind !== 'hunt' || fg.m.removed) continue;
          s.playSound(fg.m.dim, 'dweller.screech', fg.m.x, fg.m.y + 2, fg.m.z, 1.5, 0.7);
          s.particles(fg.m.dim, 'block', fg.m.x, fg.m.y + 0.3, fg.m.z, 30, 0.6, fg.m.dim.getState(Math.floor(fg.m.x), Math.floor(fg.m.y) - 1, Math.floor(fg.m.z)));
          fg.m.remove();
        }
        for (const p of players) {
          p.send({ t: 'fx', kind: 'haunt', strength: 0 });
          this.h.dark.set(p.uuid, 0);
        }
      }
    }
    // The drags down into the den
    for (const c of hu.caught.values()) this.stepDrag(c, t);
    const doneTaken = hu.final === 'taken' && t > DWELLER_HUNT_TICKS && [...hu.caught.values()].every((c) => t - c.at >= DRAG.done);
    const doneDawn = hu.dawnAt >= 0 && t - hu.dawnAt >= 120;
    if (doneDawn && t - hu.dawnAt === 80) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'black', ticks: 40 });
    if (doneTaken || doneDawn) this.h.finish(st, { kind: 'screen', screen: { style: 'cave_dweller', ...DWELLER_END[hu.final] } });
  }

  /** It caught a player: its figure becomes the one dragging them. */
  private take(hu: Hunt, fg: Figure): void {
    const { p, m } = fg;
    if (hu.caught.has(p.uuid)) return;
    const i = this.h.figures.indexOf(fg);
    if (i >= 0) this.h.figures.splice(i, 1);
    this.takeNow(hu, p, m);
  }

  private takeNow(hu: Hunt, p: ServerPlayer, m: Mob | null = null): void {
    if (hu.caught.has(p.uuid) || !this.h.server.players.has(p.conn.id)) return;
    const [dir, clear] = dragWay(p);
    const len = Math.max(0, Math.min(7, clear - 2.5));
    const lead = Math.max(1, Math.min(1.7, clear - len - 0.3));
    const fx = p.x + dir[0] * lead;
    const fz = p.z + dir[1] * lead;
    const fy = this.h.floorNear(p.dim, Math.floor(fx), Math.floor(fz), Math.floor(p.y), 1) ?? p.y;
    const drag = m ?? this.h.apparition(p.dim, 'cave_dweller', fx, fy, fz, 0, 'crawl');
    if (drag) {
      drag.setPos(fx, fy, fz);
      drag.data.hbAnim = 'drag';
      drag.yaw = Math.atan2(-(p.x - fx), -(p.z - fz));
      drag.headYaw = drag.yaw;
      drag.metaDirty = true;
    }
    hu.caught.set(p.uuid, { p, at: hu.t, drag, dir, len, lead, from: [p.x, p.y, p.z] });
    p.send({ t: 'fx', kind: 'scene', text: 'grab', ticks: DRAG.drag - DRAG.grab, x: p.x, y: p.y, z: p.z, x1: fx, y1: fy + 2.2, z1: fz });
    p.send({ t: 'fx', kind: 'shake', strength: 0.9, ticks: 14 });
    this.h.server.playSound(p.dim, 'dweller.screech', p.x, p.y + 2, p.z, 1.4, 1.1);
  }

  /** Along the ground behind it, into the black; then eyes opening in the dark. */
  private stepDrag(c: Caught, t: number): void {
    const s = this.h.server;
    const p = c.p;
    if (!s.players.has(p.conn.id)) return;
    const k = t - c.at;
    if (k === DRAG.drag) {
      const ex = c.from[0] + c.dir[0] * c.len;
      const ez = c.from[2] + c.dir[1] * c.len;
      const ey = this.h.floorNear(p.dim, Math.floor(ex), Math.floor(ez), Math.floor(p.y), 6) ?? p.y;
      p.send({ t: 'fx', kind: 'scene', text: 'drag', ticks: DRAG.dragTicks, x: c.from[0], y: c.from[1], z: c.from[2], x1: ex, y1: ey, z1: ez, strength: c.len > 0.5 ? 1 : 0 });
    }
    if (k > DRAG.drag && k < DRAG.black && c.drag && !c.drag.removed) {
      const e = Math.min(1, (k - DRAG.drag) / DRAG.dragTicks);
      const e2 = e * e * (3 - 2 * e);
      const x = c.from[0] + c.dir[0] * (c.lead + c.len * e2);
      const z = c.from[2] + c.dir[1] * (c.lead + c.len * e2);
      const y = this.h.floorNear(c.drag.dim, Math.floor(x), Math.floor(z), Math.floor(c.drag.y), 1) ?? c.drag.y;
      c.drag.setPos(x, y, z);
      c.drag.yaw = Math.atan2(c.dir[0], c.dir[1]);
      c.drag.headYaw = c.drag.yaw;
      c.drag.metaDirty = true;
      if ((k - DRAG.drag) % 16 === 0) s.playSound(p.dim, 'dweller.breath', x, y + 1, z, 0.8, 0.8);
    }
    if (k === DRAG.black) {
      p.send({ t: 'fx', kind: 'scene', text: 'black', ticks: DRAG.eyes - DRAG.black });
      if (c.drag && !c.drag.removed) c.drag.remove();
      c.drag = null;
    }
    if (k === DRAG.eyes) {
      p.send({ t: 'fx', kind: 'scene', text: 'eyes', ticks: DRAG.done - DRAG.eyes });
      p.send({ t: 'sound', name: 'dweller.skitter', x: p.x, y: p.y + 1, z: p.z, volume: 1, pitch: 0.7 });
    }
  }
}
