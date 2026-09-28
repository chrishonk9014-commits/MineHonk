/**
 * The sculk ecosystem: vibrations, sculk sensors, shriekers and catalysts,
 * the Warden's warning levels, and the Darkness effect.
 *
 * Vibrations are events at a position (footsteps, landing, breaking and
 * placing blocks, opening things, eating, projectiles landing, hits,
 * explosions). Sensors within 8 blocks hear them unless wool is in the way.
 * A sensor that hears a player relays to shriekers near it; a shriek raises
 * that player's warning level, and the fourth warning summons the Warden.
 *
 * Sensors, shriekers and catalysts are kept in a spatial index (per chunk
 * section) filled when chunks load and kept current on block changes, so a
 * vibration only looks at the few cells around it.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { Entity } from '../entity/Entity';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob, isPlayer } from '../entity/Mob';
import { blocks, STATE_BLOCK, STATE_SOLID, STATE_OPAQUE, getProp, withProp, S, stateOf } from '../../common/registry/blocks';
import type { Chunk } from '../../common/world/chunk';
import { Random } from '../../common/math/rng';
import { items } from '../../common/registry/items';

export type VibrationKind = 'step' | 'land' | 'block_break' | 'block_place' | 'block_use' | 'container' | 'eat' | 'projectile' | 'hit' | 'explosion' | 'splash' | 'item';

/** Hearing ranges. */
export const SENSOR_RANGE = 8;
export const SHRIEKER_RANGE = 8;
export const WARDEN_HEARING = 16;
/** Shrieks a player can set off before the Warden comes. */
export const WARNINGS_TO_SUMMON = 4;
/** Warning levels fade one step per this many ticks (10 minutes). */
const WARNING_DECAY = 12000;
/** A player can only set off shriekers once per this many ticks. */
const SHRIEK_COOLDOWN = 200;

type Kind = 1 | 2 | 3; // sensor, shrieker, catalyst

interface SensorTimer {
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  /** Tick the sensor went active; it cools down after 40 ticks and resets after 50. */
  at: number;
  power: number;
}

export class Sculk {
  private readonly rng = new Random();
  /** dim -> section key -> packed positions -> kind */
  private readonly index = new Map<Dimension, Map<string, Map<string, Kind>>>();
  private readonly sensors = new Map<string, SensorTimer>();
  private readonly shrieking = new Map<string, { dim: Dimension; x: number; y: number; z: number; until: number }>();
  private readonly blooms = new Map<string, { dim: Dimension; x: number; y: number; z: number; until: number }>();
  private kindOf: Uint8Array | null = null;
  private woolOf: Uint8Array | null = null;
  private readonly states = {
    sensor: 0,
    shrieker: 0,
    catalyst: 0,
  };

  constructor(private readonly server: GameServer) {}

  private init(): void {
    if (this.kindOf) return;
    const kind = new Uint8Array(65536);
    const wool = new Uint8Array(65536);
    for (const b of blocks) {
      const k = b.id === 'sculk_sensor' ? 1 : b.id === 'sculk_shrieker' ? 2 : b.id === 'sculk_catalyst' ? 3 : 0;
      const w = b.id.endsWith('_wool') || b.id.endsWith('_carpet') ? 1 : 0;
      for (let s = b.baseState; s < b.baseState + b.stateCount; s++) {
        kind[s] = k;
        wool[s] = w;
      }
    }
    this.kindOf = kind;
    this.woolOf = wool;
    this.states.sensor = S('sculk_sensor');
    this.states.shrieker = S('sculk_shrieker');
    this.states.catalyst = S('sculk_catalyst');
  }

  // ------------------------------------------------------------------ spatial index

  private cellKey(x: number, y: number, z: number): string {
    return `${x >> 4},${y >> 4},${z >> 4}`;
  }

  private cells(dim: Dimension): Map<string, Map<string, Kind>> {
    let m = this.index.get(dim);
    if (!m) {
      m = new Map();
      this.index.set(dim, m);
    }
    return m;
  }

  private track(dim: Dimension, x: number, y: number, z: number, kind: Kind | 0): void {
    const cells = this.cells(dim);
    const ck = this.cellKey(x, y, z);
    const pk = `${x},${y},${z}`;
    let cell = cells.get(ck);
    if (!kind) {
      if (cell?.delete(pk) && cell.size === 0) cells.delete(ck);
      return;
    }
    if (!cell) {
      cell = new Map();
      cells.set(ck, cell);
    }
    cell.set(pk, kind);
  }

  /** Indexes the sculk blocks of a newly loaded chunk (sections below y 128 only). */
  onChunk(dim: Dimension, c: Chunk): void {
    this.init();
    const kind = this.kindOf!;
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    for (let si = 0; si < 8; si++) {
      const sec = c.sections[si];
      if (!sec) continue;
      for (let i = 0; i < 4096; i++) {
        const k = kind[sec[i]!]!;
        if (k) this.track(dim, bx + (i & 15), (si << 4) + (i >> 8), bz + ((i >> 4) & 15), k as Kind);
      }
    }
  }

  onChunkUnload(dim: Dimension, cx: number, cz: number): void {
    const cells = this.index.get(dim);
    if (!cells) return;
    for (let sy = 0; sy < 16; sy++) cells.delete(`${cx},${sy},${cz}`);
  }

  onBlockChanged(dim: Dimension, x: number, y: number, z: number, old: number, state: number): void {
    this.init();
    const ko = this.kindOf![old]!;
    const kn = this.kindOf![state]!;
    if (ko !== kn || kn) this.track(dim, x, y, z, kn as Kind);
  }

  /** Tracked sculk blocks of a kind within `r` of a point. */
  private near(dim: Dimension, x: number, y: number, z: number, r: number, want: Kind): [number, number, number][] {
    const cells = this.index.get(dim);
    if (!cells || cells.size === 0) return [];
    const out: [number, number, number][] = [];
    const r2 = r * r;
    for (let cx = (Math.floor(x - r) >> 4); cx <= Math.floor(x + r) >> 4; cx++)
      for (let cy = Math.max(0, Math.floor(y - r) >> 4); cy <= Math.min(15, Math.floor(y + r) >> 4); cy++)
        for (let cz = Math.floor(z - r) >> 4; cz <= Math.floor(z + r) >> 4; cz++) {
          const cell = cells.get(`${cx},${cy},${cz}`);
          if (!cell) continue;
          for (const [pk, k] of cell) {
            if (k !== want) continue;
            const [px, py, pz] = pk.split(',').map(Number) as [number, number, number];
            if ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 + (pz + 0.5 - z) ** 2 <= r2) out.push([px, py, pz]);
          }
        }
    return out;
  }

  // ------------------------------------------------------------------ vibrations

  /** Wool (and carpets) between two points soak up a vibration. */
  occluded(dim: Dimension, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    this.init();
    const wool = this.woolOf!;
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const steps = Math.ceil(d * 2);
    const sx = Math.floor(x0);
    const sy = Math.floor(y0);
    const sz = Math.floor(z0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    const ez = Math.floor(z1);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const bx = Math.floor(x0 + (x1 - x0) * t);
      const by = Math.floor(y0 + (y1 - y0) * t);
      const bz = Math.floor(z0 + (z1 - z0) * t);
      if ((bx === sx && by === sy && bz === sz) || (bx === ex && by === ey && bz === ez)) continue;
      if (wool[dim.getState(bx, by, bz)]) return true;
    }
    return false;
  }

  /** Whether a player's sounds are muffled (a Resonance Charm on them halves how far they carry). */
  private quiet(p: ServerPlayer): boolean {
    for (let i = 0; i < 41; i++) {
      const s = p.inventory.get(i);
      if (s && items[s.id]?.id === 'resonance_charm') return true;
    }
    return false;
  }

  /**
   * Something made a vibration at (x, y, z). `source` is who caused it (the
   * shooter for a landed projectile), `kind` what happened.
   */
  vibrate(dim: Dimension, x: number, y: number, z: number, source: Entity | null, kind: VibrationKind): void {
    this.init();
    if (source && isPlayer(source) && (source.gamemode === 'spectator' || source.dead)) return;
    // Wardens never trigger sculk themselves
    if (source instanceof Mob && source.type === 'warden') return;
    const damp = source && isPlayer(source) && this.quiet(source) ? 0.5 : 1;
    const now = this.server.tickNo;
    const range = SENSOR_RANGE * damp;
    for (const [sx, sy, sz] of this.near(dim, x, y, z, range, 1)) {
      const key = `${dim.id}|${sx},${sy},${sz}`;
      const st = this.sensors.get(key);
      if (st && now - st.at < 50) continue;
      const cur = dim.getState(sx, sy, sz);
      if (blocks[STATE_BLOCK[cur]!]!.id !== 'sculk_sensor' || getProp(cur, 'phase') !== 'inactive') continue;
      if (this.occluded(dim, x, y, z, sx + 0.5, sy + 0.5, sz + 0.5)) continue;
      const dist = Math.hypot(sx + 0.5 - x, sy + 0.5 - y, sz + 0.5 - z);
      this.activateSensor(dim, sx, sy, sz, cur, Math.max(1, 15 - Math.floor(dist)), x, y, z);
      // A sensor that hears a player wakes the shriekers around it
      if (source && isPlayer(source)) for (const [hx, hy, hz] of this.near(dim, sx + 0.5, sy + 0.5, sz + 0.5, SHRIEKER_RANGE, 2)) this.shriek(dim, hx, hy, hz, source);
    }
    // Wardens listen further than sensors
    const wardens = this.server.warden?.active;
    if (wardens?.size) {
      const r2 = (WARDEN_HEARING * damp) ** 2;
      for (const w of wardens) {
        if (w.dead || w.removed) {
          wardens.delete(w);
          continue;
        }
        if (w.dim !== dim || (w.x - x) ** 2 + (w.y - y) ** 2 + (w.z - z) ** 2 > r2) continue;
        if (this.occluded(dim, x, y, z, w.x, w.y + 2, w.z)) continue;
        this.server.warden?.hear(w, x, y, z, source, kind);
      }
    }
  }

  private activateSensor(dim: Dimension, x: number, y: number, z: number, state: number, power: number, fx: number, fy: number, fz: number): void {
    // Registered before the block changes: redstone reads the power while it updates
    this.sensors.set(`${dim.id}|${x},${y},${z}`, { dim, x, y, z, at: this.server.tickNo, power });
    dim.setBlock(x, y, z, withProp(state, 'phase', 'active'));
    this.server.playSound(dim, 'sculk.click', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.9 + this.rng.next() * 0.2);
    this.server.broadcastNear(dim, x, y, z, 48, { t: 'trail', kind: 'vibration', x0: fx, y0: fy, z0: fz, x1: x + 0.5, y1: y + 0.6, z1: z + 0.5, ticks: Math.max(4, Math.round(Math.hypot(x + 0.5 - fx, y + 0.5 - fy, z + 0.5 - fz) * 1.5)) });
  }

  /** Redstone out of an active sensor (0 when idle). */
  sensorPower(dim: Dimension, x: number, y: number, z: number): number {
    const st = this.sensors.get(`${dim.id}|${x},${y},${z}`);
    if (!st) return 0;
    return this.server.tickNo - st.at < 40 ? st.power : 0;
  }

  // ------------------------------------------------------------------ shriekers & warnings

  /** A shrieker cries out because of `p`: warns them, darkens the area, maybe calls the Warden. */
  shriek(dim: Dimension, x: number, y: number, z: number, p: ServerPlayer): boolean {
    const s = this.server;
    const now = s.tickNo;
    const key = `${dim.id}|${x},${y},${z}`;
    if (this.shrieking.has(key)) return false;
    if (p.gamemode === 'creative' || p.gamemode === 'spectator') return false;
    if (now < p.shriekCooldownUntil) return false;
    const st = dim.getState(x, y, z);
    if (blocks[STATE_BLOCK[st]!]!.id !== 'sculk_shrieker') return false;
    p.shriekCooldownUntil = now + SHRIEK_COOLDOWN;
    this.shrieking.set(key, { dim, x, y, z, until: now + 90 });
    dim.setBlock(x, y, z, withProp(st, 'shrieking', true));
    s.playSound(dim, 'shrieker.shriek', x + 0.5, y + 0.8, z + 0.5, 3, 0.9 + this.rng.next() * 0.2);
    s.particles(dim, 'shriek', x + 0.5, y + 1, z + 0.5, 12, 0.3);
    if (getProp(st, 'can_summon') !== 'true') return true;
    // Warning levels are per player and grow with every shriek
    this.decayWarning(p);
    p.wardenWarning = Math.min(WARNINGS_TO_SUMMON, p.wardenWarning + 1);
    p.wardenWarningAt = now;
    for (const pl of s.players.values()) {
      if (pl.dim !== dim || pl.dead || pl.distanceSq(x + 0.5, y + 0.5, z + 0.5) > 40 * 40) continue;
      s.interaction.survival.addEffect(pl, 'darkness', 0, 260);
    }
    // Readable cues: each level sounds closer and worse
    const cue = ['', 'warden.warning1', 'warden.warning2', 'warden.warning3', 'warden.emerge'][p.wardenWarning]!;
    if (cue) s.playSound(dim, cue, x + 0.5, y, z + 0.5, 2.5, 1);
    if (p.wardenWarning >= WARNINGS_TO_SUMMON) {
      if (s.warden?.summon(dim, x, y, z, p)) p.wardenWarning = 2;
    }
    return true;
  }

  private decayWarning(p: ServerPlayer): void {
    const steps = Math.floor((this.server.tickNo - p.wardenWarningAt) / WARNING_DECAY);
    if (steps > 0 && p.wardenWarning > 0) {
      p.wardenWarning = Math.max(0, p.wardenWarning - steps);
      p.wardenWarningAt = this.server.tickNo;
    }
  }

  // ------------------------------------------------------------------ catalysts

  /**
   * A creature died: a catalyst within 8 blocks blooms and spreads sculk
   * around the body, feeding on its experience. Returns true when the
   * experience was consumed.
   */
  onDeath(dim: Dimension, x: number, y: number, z: number, xp: number): boolean {
    this.init();
    const cats = this.near(dim, x, y, z, 8, 3);
    if (!cats.length) return false;
    const [cx, cy, cz] = cats[0]!;
    const s = this.server;
    const st = dim.getState(cx, cy, cz);
    dim.setBlock(cx, cy, cz, withProp(st, 'bloom', true));
    this.blooms.set(`${dim.id}|${cx},${cy},${cz}`, { dim, x: cx, y: cy, z: cz, until: s.tickNo + 16 });
    s.playSound(dim, 'catalyst.bloom', cx + 0.5, cy + 1, cz + 0.5, 1.5, 1);
    s.particles(dim, 'sculk_soul', cx + 0.5, cy + 1.2, cz + 0.5, 6, 0.3);
    this.spread(dim, Math.floor(x), Math.floor(y), Math.floor(z), Math.max(4, xp * 3));
    return true;
  }

  /** Spreads sculk over the ground around a point, spending `charge`. */
  private spread(dim: Dimension, x: number, y: number, z: number, charge: number): void {
    const sculk = S('sculk');
    const vein = stateOf('sculk_vein', { down: true });
    let left = charge;
    for (let tries = 0; tries < charge * 4 && left > 0; tries++) {
      const px = x + this.rng.int(9) - 4;
      const pz = z + this.rng.int(9) - 4;
      for (let py = y + 2; py >= y - 3; py--) {
        const g = dim.getState(px, py, pz);
        const above = dim.getState(px, py + 1, pz);
        if (!STATE_SOLID[g] || !STATE_OPAQUE[g] || STATE_SOLID[above]) continue;
        const id = blocks[STATE_BLOCK[g]!]!.id;
        if (id === 'sculk' || id.startsWith('sculk_') || id === 'bedrock' || id.includes('ore') || id === 'reinforced_deepslate' || id.includes('chest')) break;
        dim.setBlock(px, py, pz, sculk);
        left--;
        const r = this.rng.next();
        // Rarely a new sensor or a shrieker that cannot call the Warden
        if (r < 0.02 && above === 0) dim.setBlock(px, py + 1, pz, stateOf('sculk_shrieker', { can_summon: false }));
        else if (r < 0.06 && above === 0) dim.setBlock(px, py + 1, pz, S('sculk_sensor'));
        else if (r < 0.35 && above === 0) dim.setBlock(px, py + 1, pz, vein);
        break;
      }
    }
    this.server.particles(dim, 'sculk_charge', x + 0.5, y + 0.5, z + 0.5, 10, 2);
  }

  // ------------------------------------------------------------------ players moving

  /** Per player movement: footsteps, landing and stepping on shriekers. */
  onPlayerMove(p: ServerPlayer, dx: number, dz: number, wasOnGround: boolean, onGround: boolean, fell: number): void {
    if (p.gamemode === 'spectator' || p.abilities.flying) return;
    const under = p.dim.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const id = blocks[STATE_BLOCK[under]!]!.id;
    if (onGround && id === 'sculk_shrieker') this.shriek(p.dim, Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z), p);
    this.init();
    // Soft footing (wool, carpets) makes no sound; neither does sneaking
    const soft = this.woolOf![under] === 1 || this.woolOf![p.dim.getState(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === 1;
    if (!wasOnGround && onGround && fell > 1 && !soft) {
      this.vibrate(p.dim, p.x, p.y, p.z, p, 'land');
      return;
    }
    if (!onGround || p.sneaking || soft) return;
    p.stepDistance += Math.hypot(dx, dz);
    if (p.stepDistance >= 1.6) {
      p.stepDistance = 0;
      this.vibrate(p.dim, p.x, p.y, p.z, p, 'step');
    }
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const now = s.tickNo;
    for (const [k, t] of this.sensors) {
      const age = now - t.at;
      if (age === 40 || age === 50 || age > 50) {
        if (!t.dim.isLoaded(t.x, t.z)) {
          this.sensors.delete(k);
          continue;
        }
        const st = t.dim.getState(t.x, t.y, t.z);
        if (blocks[STATE_BLOCK[st]!]!.id !== 'sculk_sensor') {
          this.sensors.delete(k);
          continue;
        }
        if (age === 40) t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'phase', 'cooldown'));
        else {
          t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'phase', 'inactive'));
          this.sensors.delete(k);
        }
      }
    }
    for (const [k, t] of this.shrieking) {
      if (now < t.until) continue;
      this.shrieking.delete(k);
      if (!t.dim.isLoaded(t.x, t.z)) continue;
      const st = t.dim.getState(t.x, t.y, t.z);
      if (blocks[STATE_BLOCK[st]!]!.id === 'sculk_shrieker') t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'shrieking', false));
    }
    for (const [k, t] of this.blooms) {
      if (now < t.until) continue;
      this.blooms.delete(k);
      if (!t.dim.isLoaded(t.x, t.z)) continue;
      const st = t.dim.getState(t.x, t.y, t.z);
      if (blocks[STATE_BLOCK[st]!]!.id === 'sculk_catalyst') t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'bloom', false));
    }
    // Moving mobs make vibrations too (checked twice a second)
    if (now % 10 === 0) {
      for (const dim of s.dims.values()) {
        const cells = this.index.get(dim);
        const listening = (cells && cells.size > 0) || [...(s.warden?.active ?? [])].some((w) => w.dim === dim);
        if (!listening) continue;
        for (const e of dim.entities.values()) {
          if (!(e instanceof Mob) || e.dead || e.type === 'warden' || !e.body.onGround) continue;
          if (Math.abs(e.body.vx) + Math.abs(e.body.vz) < 0.02) continue;
          this.vibrate(dim, e.x, e.y, e.z, e, 'step');
        }
      }
    }
  }
}
