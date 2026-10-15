/**
 * Null's part of the Haunting (the Admin Panel only). Null takes things
 * away, and only while nobody is looking:
 *
 *   missing  a torch you placed is gone; a block you placed is gone; where it was, a sign: null
 *   erased   what you built comes apart behind your back; clean square holes in the ground;
 *            a black figure that never moves while it is watched (look away: it is closer)
 *   quiet    the sound drains away, then the colour; words in chat come out as "null"
 *   answers  it answers, in lowercase and as few words as it can
 *   finale   the world is erased around everyone, block by block, and the colour with it;
 *            then the old error: Connection Lost, Disconnected: null
 *
 * Everything it takes is recorded like any haunting's changes and is put
 * back when it ends (and by Stop): Null leaves nothing behind.
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { HauntingSystem } from '../Haunting';
import { NULL_SIGNS, NULL_END, type HauntNotice } from '../../../common/game/hauntCast';
import type { HauntPart, HauntState, Figure } from './types';
import { NATURAL, seenByAnyone, soundAround, safeToTake, steady, type Placed } from './shared';

const BUDGET: Record<string, Record<string, number>> = {
  missing: { take: 4, erase: 2, sign: 2, static: 2 },
  erased: { take: 4, erase: 6, hole: 3, sign: 3, sight: 3, static: 2, drain: 1 },
  quiet: { take: 5, erase: 6, hole: 4, sign: 3, sight: 4, drain: 3, hush: 3 },
  answers: { take: 6, erase: 8, hole: 5, sign: 4, sight: 5, drain: 3, hush: 3 },
  finale: {},
};

/** The end: how long the erasing goes on, then the screen going (ticks). */
const ERASE_TICKS = 240;
const END_TICKS = 340;
/** What it remembers of what players placed. */
const MAX_PLACED = 200;

export class NullHaunt implements HauntPart {
  readonly id = 'null' as const;
  readonly budget = BUDGET;
  /** Blocks players placed lately (what it takes first). */
  private placed: Placed[] = [];
  /** The colour each player was last left with, and who it silenced. */
  private readonly drained = new Map<string, number>();
  private readonly hushed = new Set<string>();
  private end: { t: number } | null = null;

  constructor(private readonly h: HauntingSystem) {}

  private get rng(): { next(): number; int(n: number): number } {
    return this.h.rng;
  }

  holds(): boolean {
    return !!this.end;
  }

  silent(): boolean {
    return !!this.end;
  }

  reset(): void {
    this.end = null;
    this.placed = [];
    if (!this.drained.size && !this.hushed.size) return;
    for (const p of this.h.server.players.values()) {
      if (this.drained.has(p.uuid)) p.send({ t: 'fx', kind: 'drain', strength: 0 });
      if (this.hushed.has(p.uuid)) p.send({ t: 'fx', kind: 'unsilence', ticks: 20 });
    }
    this.drained.clear();
    this.hushed.clear();
  }

  notice(p: ServerPlayer, what: HauntNotice, _st: HauntState, _stage: string, _f: number, at?: [number, number, number]): void {
    if ((what !== 'build' && what !== 'torch') || !at) return;
    this.placed.push({ p: p.uuid, dim: p.dim.id, x: at[0], y: at[1], z: at[2], state: p.dim.getState(...at), at: this.h.server.tickNo });
    if (this.placed.length > MAX_PLACED) this.placed.shift();
  }

  event(kind: string, p: ServerPlayer, _st: HauntState, stage: string): void {
    switch (kind) {
      case 'take':
        this.take(p, stage === 'missing' ? 0.35 : 0.2);
        break;
      case 'erase':
        for (let n = stage === 'missing' ? 1 : 1 + this.rng.int(3); n > 0; n--) if (!this.erase(p)) break;
        break;
      case 'hole':
        this.hole(p);
        break;
      case 'sign':
        this.h.placeSign(p, NULL_SIGNS[this.rng.int(NULL_SIGNS.length)]!, 6, 16);
        break;
      case 'static':
        soundAround(this.h, p, 'null.static', 4, 10, 0.4, 0.9 + this.rng.next() * 0.2);
        break;
      case 'sight':
        this.sight(p);
        break;
      case 'drain':
        this.drainPulse(p, 0.85, 50);
        break;
      case 'hush':
        this.hush(p, 100 + this.rng.int(120));
        break;
    }
  }

  oneOffs(_st: HauntState, _f: number, players: ServerPlayer[], once: (key: string, at: number) => boolean): void {
    // The first thing anyone notices: a torch gone, and a sign where it was
    if (once('first', 0.03)) this.take(players[this.rng.int(players.length)]!, 1);
  }

  /** From "It goes quiet" on, the colour drains out of everything. */
  atmosphere(_st: HauntState, f: number, players: ServerPlayer[]): void {
    const level = Math.max(0, Math.min(1, (f - 0.5) / (0.94 - 0.5))) * 0.7;
    for (const p of players) this.sendDrain(p, level);
  }

  /** From "It goes quiet" on, words in chat come out as null. */
  chatText(_p: ServerPlayer, text: string): string | null {
    const st = this.h.state;
    if (!st || st.t / st.total < 0.5 || this.end) return null;
    let n = 0;
    const out = text.replace(/[A-Za-z]{3,}/g, (w) => (n < 3 && this.rng.next() < 0.25 ? (n++, 'null') : w));
    return n ? out : null;
  }

  // ------------------------------------------------------------------ taking

  /** A torch near the player gone, one they placed if there is one (with `sign`: a sign where it stood). */
  private take(p: ServerPlayer, sign: number): boolean {
    const dim = p.dim;
    const torch = (id: string): boolean => id === 'torch' || id === 'wall_torch' || id === 'soul_torch' || id === 'soul_wall_torch' || id === 'lantern';
    const theirs = this.placed.filter((b) => b.dim === dim.id && dim.getState(b.x, b.y, b.z) === b.state && torch(this.h.idAt(dim, b.x, b.y, b.z)));
    const spots: [number, number, number][] = theirs.map((b) => [b.x, b.y, b.z]);
    if (!spots.length)
      for (let tries = 0; tries < 300 && spots.length < 4; tries++) {
        const x = Math.floor(p.x) + this.rng.int(29) - 14;
        const y = Math.floor(p.y) + this.rng.int(11) - 5;
        const z = Math.floor(p.z) + this.rng.int(29) - 14;
        if (torch(this.h.idAt(dim, x, y, z))) spots.push([x, y, z]);
      }
    for (const [x, y, z] of spots.sort(() => this.rng.next() - 0.5)) {
      if (seenByAnyone(this.h, dim, x + 0.5, y + 0.5, z + 0.5, 0.45)) continue;
      const standing = this.h.idAt(dim, x, y, z) === 'torch';
      if (!this.h.set(dim, x, y, z, 0)) continue;
      if (standing && this.rng.next() < sign) this.h.signAt(p, x, y, z, ['', 'null', '', '']);
      return true;
    }
    return false;
  }

  /** A block the player placed gone, while nobody is looking at it. */
  private erase(p: ServerPlayer): boolean {
    const dim = p.dim;
    const list = this.placed.filter((b) => b.p === p.uuid && b.dim === dim.id && dim.getState(b.x, b.y, b.z) === b.state && Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z) > 2.5);
    for (let tries = 0; tries < 6 && list.length; tries++) {
      const i = this.rng.int(list.length);
      const b = list[i]!;
      list.splice(i, 1);
      if (seenByAnyone(this.h, dim, b.x + 0.5, b.y + 0.5, b.z + 0.5, 0.4)) continue;
      // Never what someone is standing on
      if ([...this.h.server.players.values()].some((o) => o.dim === dim && Math.abs(o.x - (b.x + 0.5)) < 1.3 && Math.abs(o.z - (b.z + 0.5)) < 1.3 && o.y >= b.y && o.y - b.y < 2.5)) continue;
      if (!safeToTake(dim, b.x, b.y, b.z)) continue;
      if (this.h.set(dim, b.x, b.y, b.z, 0)) {
        p.send({ t: 'sound', name: 'null.erase', x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5, volume: 0.25, pitch: 0.8 });
        return true;
      }
    }
    return false;
  }

  /** A clean square hole in the ground, out of sight: 3x3, straight down. */
  private hole(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 10; tries++) {
      const [x, z] = this.h.around(p, 9, 24);
      const g = this.h.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (g === null || seenByAnyone(this.h, dim, x + 0.5, g, z + 0.5, 0.35)) continue;
      const deep = 4 + this.rng.int(4);
      let ok = true;
      // Plain, steady ground all the way down and round it (no sand to fall in, no water to run in)
      for (let dx = -2; dx <= 2 && ok; dx++)
        for (let dz = -2; dz <= 2 && ok; dz++)
          for (let d = 1; d <= deep + 1 && ok; d++) {
            const inside = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && d <= deep;
            if (inside ? !NATURAL.test(this.h.idAt(dim, x + dx, g - d, z + dz)) || !steady(dim, x + dx, g - d, z + dz) || dim.getBlockEntity(x + dx, g - d, z + dz) : !steady(dim, x + dx, g - d, z + dz)) ok = false;
          }
      for (let dx = -1; dx <= 1 && ok; dx++) for (let dz = -1; dz <= 1 && ok; dz++) if (dim.getState(x + dx, g, z + dz) !== 0) ok = false;
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let d = 1; d <= deep; d++) this.h.set(dim, x + dx, g - d, z + dz, 0);
      return;
    }
  }

  // ------------------------------------------------------------------ the quiet, the colour

  private sendDrain(p: ServerPlayer, level: number): void {
    const last = this.drained.get(p.uuid) ?? 0;
    if (Math.abs(last - level) < 0.02 && !(level > 0 && this.h.server.tickNo % 200 === 0)) return;
    this.drained.set(p.uuid, level);
    p.send({ t: 'fx', kind: 'drain', strength: level });
  }

  /** The colour gone for a moment. */
  private drainPulse(p: ServerPlayer, strength: number, ticks: number): void {
    if (!this.drained.has(p.uuid)) this.drained.set(p.uuid, 0);
    p.send({ t: 'fx', kind: 'drain', strength, ticks });
    p.send({ t: 'sound', name: 'null.static', x: p.x, y: p.y + 1, z: p.z, volume: 0.35, pitch: 0.7 });
  }

  /** Every sound gone for a while. */
  private hush(p: ServerPlayer, ticks: number): void {
    if (this.hushed.has(p.uuid)) return;
    this.hushed.add(p.uuid);
    p.send({ t: 'fx', kind: 'silence', ticks });
    this.h.server.later(ticks, () => {
      if (!this.hushed.delete(p.uuid) || !this.h.server.players.has(p.conn.id) || this.end) return;
      p.send({ t: 'fx', kind: 'unsilence', ticks: 40 });
    });
  }

  // ------------------------------------------------------------------ the figure

  /** It stands somewhere you are not looking. */
  private sight(p: ServerPlayer): void {
    if (this.h.figures.some((f) => f.p === p)) return;
    for (let tries = 0; tries < 8; tries++) {
      const at = this.h.spotNear(p, 12, 20, false, false, false);
      if (!at || seenByAnyone(this.h, p.dim, at[0], at[1] + 1.4, at[2], 0.5)) continue;
      this.h.spawnFigure(p, 'angel', ...at, 'stare', {}, {}, 'null');
      return;
    }
  }

  appear(p: ServerPlayer): boolean {
    const at = this.h.spotNear(p, 10, 16, true);
    return !!at && !!this.h.spawnFigure(p, 'test', ...at, 'stare', {}, {}, 'null');
  }

  stepFigure(fg: Figure, age: number, d: number): boolean {
    const { m, p } = fg;
    m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    m.headYaw = m.yaw;
    m.metaDirty = true;
    const watched = seenByAnyone(this.h, m.dim, m.x, m.y + 1.4, m.z, 0.6);
    if (watched) fg.seen++;
    switch (fg.kind) {
      case 'test':
        return fg.seen < 60 && age < 240;
      case 'final':
        return true;
      default: {
        // It never moves while it is watched; look away and it is closer
        if (watched) return fg.seen < 100 && age < 1200;
        const n = ((fg.data.unseen as number) ?? 0) + 1;
        fg.data.unseen = n;
        if (d > 2.5) {
          if (n % 5 === 0) this.h.moveTowards(m, p, 1.3);
          return age < 1200;
        }
        // Right behind them: the colour goes, and so does it
        this.drainPulse(p, 1, 40);
        p.send({ t: 'fx', kind: 'shake', strength: 0.5, ticks: 10 });
        return false;
      }
    }
  }

  vanish(fg: Figure, gone: boolean): void {
    const { m, p } = fg;
    if (!gone) {
      p.send({ t: 'fx', kind: 'afterimage', id: m.id, ticks: 18 });
      p.send({ t: 'sound', name: 'null.static', x: m.x, y: m.y + 1, z: m.z, volume: 0.5, pitch: 0.6 });
    }
    this.h.server.particles(m.dim, 'static', m.x, m.y + 1, m.z, 10, 0.4);
  }

  // ------------------------------------------------------------------ the end

  finale(st: HauntState, _f: number, players: ServerPlayer[]): void {
    if (!this.end) {
      this.end = { t: -1 };
      this.h.clearFigures();
      this.h.clearMobs();
      for (const p of players) {
        this.hushed.add(p.uuid);
        p.send({ t: 'fx', kind: 'silence', ticks: END_TICKS });
      }
    }
    const e = this.end;
    e.t++;
    const t = e.t;
    if (t < ERASE_TICKS) {
      for (const p of players) {
        // The colour, then the world around them: nearest first, never what they stand on
        this.sendDrain(p, Math.min(1, 0.7 + (t / ERASE_TICKS) * 0.3));
        if (t % 2 === 0) this.eraseAround(p, 2 + t / 20);
      }
    }
    // It stands in front of everyone, close, and does not move
    if (t === 60)
      for (const p of players) {
        const a = p.yaw;
        const x = Math.floor(p.x - Math.sin(a) * 6);
        const z = Math.floor(p.z - Math.cos(a) * 6);
        const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), 6);
        if (y !== null) this.h.spawnFigure(p, 'final', x + 0.5, y, z + 0.5, 'stare', {}, {}, 'null');
      }
    if (t === ERASE_TICKS) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'erase', ticks: END_TICKS - ERASE_TICKS });
    if (t >= END_TICKS) this.h.finish(st, { kind: 'screen', screen: { style: 'null', title: NULL_END.title, reason: NULL_END.reason, note: NULL_END.note } });
  }

  /** A few blocks around a player gone (up to `r` away). */
  private eraseAround(p: ServerPlayer, r: number): void {
    const dim = p.dim;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    let n = 0;
    for (let tries = 0; tries < 24 && n < 3; tries++) {
      const dx = Math.round((this.rng.next() * 2 - 1) * r);
      const dy = Math.round((this.rng.next() * 2 - 1) * Math.min(r, 6));
      const dz = Math.round((this.rng.next() * 2 - 1) * r);
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      // What they stand on stays (a little island in the nothing)
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && dy < 0) continue;
      const x = px + dx;
      const y = py + dy;
      const z = pz + dz;
      if (dim.getState(x, y, z) === 0 || !safeToTake(dim, x, y, z)) continue;
      if (this.h.set(dim, x, y, z, 0)) n++;
    }
    if (n && this.rng.next() < 0.3) p.send({ t: 'sound', name: 'null.erase', x: p.x + (this.rng.next() - 0.5) * r, y: p.y, z: p.z + (this.rng.next() - 0.5) * r, volume: 0.2, pitch: 0.6 + this.rng.next() * 0.3 });
  }
}

