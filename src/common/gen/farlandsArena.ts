/**
 * The Error's arena (V3 Farlands): a round platform floating in a chasm cut
 * clean through the world to the void. Two bridges lead out to the rim;
 * broken pillars stand around the edge and debris hangs in the air.
 *
 * One arena per region, a pure function of the seed, carved into the proto
 * chunk like the Overworld's regional cave features.
 */
import type { Chunk } from '../world/chunk';
import { Random, hashInts } from '../math/rng';
import { S, STATE_FLUID } from '../registry/blocks';

export const ARENA_REGION = 1536;
/** Radius of the platform (blocks). */
export const ARENA_R = 30;
/** Radius of the chasm around it. */
const CHASM_R = 58;
const MARGIN = 220;
const BRIDGE_END = CHASM_R + 6;

export interface ErrorArena {
  id: number;
  x: number;
  /** Floor level: where you stand on the platform. */
  y: number;
  z: number;
  /** Bridge headings (radians) and the ground height at their far ends. */
  bridges: { a: number; endY: number }[];
  /** Broken pillars around the edge: position, bottom, height and a gap (floating top). */
  pillars: { x: number; z: number; h: number; gap: number }[];
  debris: { x: number; y: number; z: number; r: number }[];
}

let T: ReturnType<typeof makeStates> | undefined;
function makeStates() {
  return {
    bricks: S('farstone_bricks'),
    farstone: S('farstone'),
    corrupted: S('corrupted_stone'),
    nul: S('null_block'),
    stat: S('static_block'),
    glitch: S('glitch_block'),
    missing: S('missing_block'),
    crystal: S('data_crystal'),
    lamp: S('echo_lamp'),
  };
}
const st = (): ReturnType<typeof makeStates> => (T ??= makeStates());

export class ErrorArenas {
  private readonly cache = new Map<number, ErrorArena | null>();

  constructor(
    readonly seed: number,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  arena(rx: number, rz: number): ErrorArena | null {
    const key = hashInts(rx, rz);
    let a = this.cache.get(key);
    if (a === undefined && !this.cache.has(key)) {
      a = this.make(rx, rz);
      if (this.cache.size > 1024) this.cache.clear();
      this.cache.set(key, a);
    }
    return a ?? null;
  }

  private make(rx: number, rz: number): ErrorArena | null {
    const rng = new Random(hashInts(this.seed, rx, rz, 0xe7707));
    if (!rng.chance(0.85)) return null;
    const span = ARENA_REGION - 2 * MARGIN;
    const x = rx * ARENA_REGION + MARGIN + rng.int(span);
    const z = rz * ARENA_REGION + MARGIN + rng.int(span);
    const a0 = rng.next() * Math.PI * 2;
    const ends = [a0, a0 + Math.PI].map((a) => this.groundAt(Math.round(x + Math.cos(a) * BRIDGE_END), Math.round(z + Math.sin(a) * BRIDGE_END)));
    const y = Math.max(95, Math.min(160, Math.round((ends[0]! + ends[1]!) / 2) + 22));
    const arena: ErrorArena = { id: hashInts(this.seed, rx, rz, 0xa7e), x, y, z, bridges: [], pillars: [], debris: [] };
    for (let i = 0; i < 2; i++) arena.bridges.push({ a: a0 + i * Math.PI, endY: Math.max(ends[i]! + 1, 40) });
    for (let i = 0; i < 8; i++) {
      const a = a0 + Math.PI / 8 + (i * Math.PI) / 4;
      arena.pillars.push({ x: Math.round(x + Math.cos(a) * 25), z: Math.round(z + Math.sin(a) * 25), h: 5 + rng.int(12), gap: rng.chance(0.4) ? 2 + rng.int(3) : 0 });
    }
    for (let i = 0; i < 14; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = ARENA_R + 6 + rng.next() * (CHASM_R - ARENA_R - 12);
      arena.debris.push({ x: Math.round(x + Math.cos(a) * r), y: y - 12 + rng.int(34), z: Math.round(z + Math.sin(a) * r), r: 1 + rng.next() * 1.8 });
    }
    return arena;
  }

  /** The arena of the region containing a column. */
  arenaAt(x: number, z: number): ErrorArena | null {
    return this.arena(Math.floor(x / ARENA_REGION), Math.floor(z / ARENA_REGION));
  }

  /** Whether a column lies in an arena's chasm (nothing should be built there). */
  inChasm(x: number, z: number): boolean {
    const a = this.arenaAt(x, z);
    return !!a && Math.hypot(x + 0.5 - a.x, z + 0.5 - a.z) < CHASM_R + 4;
  }

  nearest(x: number, z: number, maxRegions = 8): ErrorArena | null {
    const rx0 = Math.floor(x / ARENA_REGION);
    const rz0 = Math.floor(z / ARENA_REGION);
    let best: ErrorArena | null = null;
    let bd = Infinity;
    for (let r = 0; r <= maxRegions; r++) {
      for (let rz = rz0 - r; rz <= rz0 + r; rz++)
        for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== r) continue;
          const a = this.arena(rx, rz);
          if (!a) continue;
          const d = (a.x - x) ** 2 + (a.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = a;
          }
        }
      if (best && r * ARENA_REGION > Math.sqrt(bd)) break;
    }
    return best;
  }

  /** Carves the arena's part of a proto chunk. */
  apply(chunk: Chunk, bx: number, bz: number): void {
    const a = this.arenaAt(bx + 8, bz + 8);
    if (!a) return;
    const reach = BRIDGE_END + 2;
    if (a.x + reach < bx || a.x - reach > bx + 16 || a.z + reach < bz || a.z - reach > bz + 16) return;
    const t = st();
    const roll = (x: number, y: number, z: number, salt: number): number => hashInts(a.id ^ salt, x, y, z) % 1000;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const dx = wx + 0.5 - a.x;
        const dz = wz + 0.5 - a.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        const edge = CHASM_R + Math.sin(ang * 5 + (a.id % 7)) * 3 + ((hashInts(a.id, wx >> 2, wz >> 2) & 3) - 1.5);
        if (d < edge) {
          // Cut clean through the world to the void
          for (let y = 0; y < 256; y++) if (chunk.get(lx, y, lz) !== 0) chunk.setRaw(lx, y, lz, 0);
        } else if (d < edge + 2.5) {
          // The cut edge: corrupted, never leaking water into the void
          for (let y = 1; y < 250; y++) {
            const s = chunk.get(lx, y, lz);
            if (s === 0) continue;
            if (STATE_FLUID[s]) chunk.setRaw(lx, y, lz, t.corrupted);
            else if (roll(wx, y, wz, 0xed9e) < 450) chunk.setRaw(lx, y, lz, roll(wx, y, wz, 0xed) < 300 ? t.nul : t.corrupted);
          }
        }
        // The platform and its hanging underside
        if (d < ARENA_R) {
          const ring = Math.floor(d);
          const floor = ring === 12 || ring === 24 ? t.glitch : d < 3 ? t.nul : (ring & 3) === 0 ? t.corrupted : t.bricks;
          chunk.setRaw(lx, a.y - 1, lz, floor);
          chunk.setRaw(lx, a.y - 2, lz, t.farstone);
          chunk.setRaw(lx, a.y - 3, lz, t.farstone);
          const depth = Math.floor((ARENA_R - d) * 0.55);
          for (let k = 0; k < depth; k++) {
            const r = roll(wx, a.y - 4 - k, wz, 0x5b);
            chunk.setRaw(lx, a.y - 4 - k, lz, r < 150 ? t.stat : r < 300 ? t.nul : t.corrupted);
          }
          if (d < 1.2) chunk.setRaw(lx, a.y - 5 - depth, lz, t.crystal);
          // A low broken rail, open where the bridges come in
          if (d >= ARENA_R - 1) {
            const onBridge = a.bridges.some((b) => Math.abs(Math.atan2(Math.sin(ang - b.a), Math.cos(ang - b.a))) < 0.12);
            if (!onBridge && roll(wx, a.y, wz, 0x7a1) < 700) chunk.setRaw(lx, a.y, lz, t.bricks);
          }
        }
        // Bridges out to the rim
        for (const b of a.bridges) {
          const ux = Math.cos(b.a);
          const uz = Math.sin(b.a);
          const along = dx * ux + dz * uz;
          const across = Math.abs(-dx * uz + dz * ux);
          if (along < ARENA_R - 2 || along > BRIDGE_END || across > 1.6) continue;
          const f = (along - (ARENA_R - 2)) / (BRIDGE_END - (ARENA_R - 2));
          const y = Math.round(a.y - 1 + (b.endY - 1 - (a.y - 1)) * f);
          chunk.setRaw(lx, y, lz, roll(wx, y, wz, 0xb1) < 80 ? t.missing : t.bricks);
          if (across > 1.1 && roll(wx, y, wz, 0xb2) < 300) chunk.setRaw(lx, y - 1, lz, t.corrupted);
          for (let k = 1; k <= 4; k++) if (chunk.get(lx, y + k, lz) !== 0) chunk.setRaw(lx, y + k, lz, 0);
        }
        // Broken pillars; some tops hang free above a gap
        for (const p of a.pillars) {
          if (Math.abs(wx - p.x) > 1 || Math.abs(wz - p.z) > 1) continue;
          for (let k = 0; k < p.h; k++) {
            if (p.gap && k >= p.h - 3 - p.gap && k < p.h - 3) continue;
            chunk.setRaw(lx, a.y + k, lz, k === p.h - 1 ? t.glitch : roll(wx, a.y + k, wz, 0x91) < 120 ? t.missing : t.bricks);
          }
          if (wx === p.x && wz === p.z) chunk.setRaw(lx, a.y + p.h, lz, t.crystal);
        }
        // Debris hanging in the chasm
        for (const q of a.debris) {
          const hx = wx - q.x;
          const hz = wz - q.z;
          if (hx * hx + hz * hz > (q.r + 1) ** 2) continue;
          for (let k = -2; k <= 2; k++) if (hx * hx + k * k + hz * hz <= q.r * q.r) chunk.setRaw(lx, q.y + k, lz, roll(wx, q.y + k, wz, 0xde) < 400 ? t.corrupted : roll(wx, q.y + k, wz, 0xdf) < 500 ? t.farstone : t.stat);
        }
      }
  }
}
