/**
 * Corrupted Caves (V3): rare underground regions where the world seems to
 * have failed to generate. A blocky cavern of corrupted rock holds floating
 * chunks of misplaced terrain, impossible formations, void pits lined with
 * null blocks and glitched ruins. Where it meets ordinary rock the world
 * breaks into cube-shaped "misloaded" cells. The rarest zones hold a Glitched
 * Portal: a broken frame on a floating island that only a Corrupted Eye can
 * wake.
 *
 * Like the other regional cave features, a zone is a pure function of the
 * seed and its region, so every chunk carves its own part of it on its own
 * and the result never depends on generation order.
 */
import type { Chunk } from '../../world/chunk';
import type { DecorView } from '../decorate/view';
import { SEA_LEVEL } from '../../world/constants';
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_FLUID, STATE_SOLID } from '../../registry/blocks';

/** Side of the square regions that may each hold one corrupted zone. */
export const CORRUPT_REGION = 512;
/** Zones stay this far inside their region, so a chunk only ever sees its own region's zone. */
const MARGIN = 104;
const ZONE_CHANCE = 0.3;
const PORTAL_CHANCE = 0.4;
/** Normalised distances: open cavern < 1 < corrupted shell < SHELL < misloaded band < BAND. */
const SHELL = 1.3;
const BAND = 2.2;
/** Cave biome cells (4 blocks) at or inside this distance are Corrupted Caves. */
export const CORRUPT_BIOME_D = SHELL;
const TAU = Math.PI * 2;
/** Angle between stepping stones around the portal island. */
const STEP_ANGLE = 0.19;

function wrapAngle(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

export interface GlitchedPortal {
  /** Interior bottom-left block; the opening is 3 wide and 4 tall. */
  x: number;
  y: number;
  z: number;
  axis: 'x' | 'z';
}

type PieceKind = 'island' | 'ore' | 'blob' | 'pillar' | 'ring' | 'pyramid' | 'stairs' | 'house' | 'shrine';

interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  z: number;
  /** Shape parameters (meaning depends on the kind). */
  a: number;
  b: number;
  c: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface CorruptZone {
  id: number;
  x: number;
  y: number;
  z: number;
  rh: number;
  rv: number;
  /** Floating island the portal stands on (y = the level you stand at). */
  island: { x: number; y: number; z: number } | null;
  portal: GlitchedPortal | null;
  fissure: { x: number; z: number; r: number } | null;
  pits: { x: number; z: number; r: number }[];
  pieces: Piece[];
  /** Chests placed with the late pass (block entities do not survive the proto chunk). */
  chests: { x: number; y: number; z: number; facing: string }[];
}

let T: ReturnType<typeof makeStates> | undefined;
function makeStates() {
  return {
    caveAir: S('cave_air'),
    corrupted: S('corrupted_stone'),
    farstone: S('farstone'),
    bricks: S('farstone_bricks'),
    stat: S('static_block'),
    nul: S('null_block'),
    missing: S('missing_block'),
    glitch: S('glitch_block'),
    overflow: S('overflow_stone'),
    stretched: S('stretched_sand'),
    farDirt: S('far_dirt'),
    farGrass: S('far_grass_block'),
    glitchOre: S('glitch_ore'),
    crystal: S('data_crystal'),
    bedrock: S('bedrock'),
    stone: S('stone'),
    deepslate: S('deepslate'),
    dirt: S('dirt'),
    grass: S('grass_block'),
    log: stateOf('oak_log', { axis: 'y' }),
    leaves: stateOf('oak_leaves', { persistent: true }),
    planks: S('oak_planks'),
    cobble: S('cobblestone'),
    glass: S('glass'),
    bookshelf: S('bookshelf'),
    table: S('crafting_table'),
    glowstone: S('glowstone'),
    ores: ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'glitch_ore'].map((id) => S(id)),
    frame: stateOf('glitched_portal_frame', { part: 'frame' }),
    cracked: stateOf('glitched_portal_frame', { part: 'cracked' }),
    socket: stateOf('glitched_portal_frame', { part: 'socket' }),
  };
}
function states(): ReturnType<typeof makeStates> {
  return (T ??= makeStates());
}

/** Per-mille roll for a position and purpose. */
function roll(id: number, x: number, y: number, z: number, salt: number): number {
  return hashInts(id ^ salt, x, y, z) % 1000;
}

export class CorruptedCaves {
  private readonly cache = new Map<number, CorruptZone | null>();
  private readonly tops = new Int16Array(256);

  constructor(
    readonly seed: number,
    /** Rough surface height (climate estimate), used to keep zones under dry land. */
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  // ------------------------------------------------------------------ zones

  zone(rx: number, rz: number): CorruptZone | null {
    const key = hashInts(rx, rz);
    let z = this.cache.get(key);
    if (z === undefined && !this.cache.has(key)) {
      z = this.makeZone(rx, rz);
      if (this.cache.size > 4096) this.cache.clear();
      this.cache.set(key, z);
    }
    return z ?? null;
  }

  /** The zone whose region contains a column (zones never leave their region). */
  zoneAt(x: number, z: number): CorruptZone | null {
    return this.zone(Math.floor(x / CORRUPT_REGION), Math.floor(z / CORRUPT_REGION));
  }

  private makeZone(rx: number, rz: number): CorruptZone | null {
    const rng = new Random(hashInts(this.seed, rx, rz, 0xc0ffa));
    if (!rng.chance(ZONE_CHANCE)) return null;
    const span = CORRUPT_REGION - 2 * MARGIN;
    const x = rx * CORRUPT_REGION + MARGIN + rng.int(span);
    const z = rz * CORRUPT_REGION + MARGIN + rng.int(span);
    const ground = this.groundAt(x, z);
    if (ground < SEA_LEVEL + 4) return null;
    const rh = 28 + rng.int(13);
    const rv = 13 + rng.int(6);
    const y = Math.min(24 + rng.int(14), ground - rv - 14);
    if (y < 18) return null;
    const zone: CorruptZone = { id: hashInts(this.seed, rx, rz, 0xbad), x, y, z, rh, rv, island: null, portal: null, fissure: null, pits: [], pieces: [], chests: [] };
    const floorAt = (px: number, pz: number): number => Math.floor(y - (rv * Math.sqrt(Math.max(0, 1 - ((px - x) ** 2 + (pz - z) ** 2) / (rh * rh)))) / 1.4);
    const ceilAt = (px: number, pz: number): number => Math.floor(y + rv * Math.sqrt(Math.max(0, 1 - ((px - x) ** 2 + (pz - z) ** 2) / (rh * rh))));
    const polar = (r0: number, r1: number): [number, number] => {
      const a = rng.next() * Math.PI * 2;
      const r = rh * (r0 + rng.next() * (r1 - r0));
      return [Math.round(x + Math.cos(a) * r), Math.round(z + Math.sin(a) * r)];
    };

    // The glitched portal on its floating island
    if (rng.chance(PORTAL_CHANCE)) {
      const [ix, iz] = polar(0, 0.22);
      const iy = Math.round(y - rv * 0.3);
      zone.island = { x: ix, y: iy, z: iz };
      const axis = rng.chance(0.5) ? 'x' : 'z';
      zone.portal = { x: ix - (axis === 'x' ? 1 : 0), y: iy, z: iz - (axis === 'z' ? 1 : 0), axis };
    }
    const clear = (px: number, pz: number, r: number): boolean => !zone.island || Math.hypot(px - zone.island.x, pz - zone.island.z) > r;

    if (rng.chance(0.55)) {
      const [fx, fz] = polar(0.25, 0.5);
      if (clear(fx, fz, 14)) zone.fissure = { x: fx, z: fz, r: 2 + rng.next() * 1.2 };
    }
    const pits = 2 + rng.int(3);
    for (let i = 0, tries = 0; i < pits && tries < 12; tries++) {
      const [px, pz] = polar(0.12, 0.55);
      if (!clear(px, pz, 14)) continue;
      zone.pits.push({ x: px + 0.5, z: pz + 0.5, r: 2 + rng.next() * 1.6 });
      i++;
    }

    const add = (kind: PieceKind, px: number, py: number, pz: number, a: number, b: number, c: number, ext: [number, number, number, number, number, number]): Piece => {
      const p: Piece = { kind, x: px, y: py, z: pz, a, b, c, x0: px + ext[0], x1: px + ext[1], y0: py + ext[2], y1: py + ext[3], z0: pz + ext[4], z1: pz + ext[5] };
      zone.pieces.push(p);
      return p;
    };
    /** A spot in the open air, `lo` above the floor and `hi` below the ceiling. */
    const airSpot = (r0: number, r1: number, lo: number, hi: number): [number, number, number] | null => {
      for (let t = 0; t < 6; t++) {
        const [px, pz] = polar(r0, r1);
        if (!clear(px, pz, 11)) continue;
        const f = floorAt(px, pz) + lo;
        const c = ceilAt(px, pz) - hi;
        if (c <= f) continue;
        return [px, f + rng.int(c - f + 1), pz];
      }
      return null;
    };

    // Floating chunks of misplaced terrain, ore and corruption
    const floaters: [PieceKind, number][] = [
      ['island', 3 + rng.int(3)],
      ['ore', 2 + rng.int(2)],
      ['blob', 3 + rng.int(3)],
    ];
    for (const [kind, n] of floaters)
      for (let i = 0; i < n; i++) {
        const s = airSpot(0, 0.72, 5, 4);
        if (!s) continue;
        if (kind === 'island') {
          const r = 2 + rng.int(2);
          const h = 3 + rng.int(2);
          const tree = rng.chance(0.4) ? 1 : 0;
          add('island', s[0], s[1], s[2], r, h, tree, [-r, r, -h, tree ? 6 : 0, -r, r]);
        } else if (kind === 'ore') add('ore', s[0], s[1], s[2], 1, 0, 0, [-1, 1, -1, 1, -1, 1]);
        else {
          const r = 1.5 + rng.next();
          const e = Math.ceil(r);
          add('blob', s[0], s[1], s[2], r, 0, 0, [-e, e, -e, e, -e, e]);
        }
      }

    // Impossible formations and a glitched ruin
    const formations: PieceKind[] = ['pillar', 'ring', 'pyramid', 'stairs', 'house'];
    for (let i = formations.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [formations[i], formations[j]] = [formations[j]!, formations[i]!];
    }
    const kinds = formations.slice(0, 3);
    if (rng.chance(0.6)) kinds.push('shrine');
    for (const kind of kinds) {
      if (kind === 'pillar') {
        for (let t = 0; t < 4; t++) {
          const [px, pz] = polar(0.1, 0.6);
          if (!clear(px, pz, 10)) continue;
          const top = ceilAt(px, pz) + 3;
          const len = 6 + rng.int(6);
          add('pillar', px, top, pz, len, 0, 0, [0, 1, -len, 0, 0, 1]);
          break;
        }
      } else if (kind === 'ring') {
        const s = airSpot(0.1, 0.55, 7, 7);
        if (s) add('ring', s[0], s[1], s[2], 4, rng.int(2), 0, [-5, 5, -5, 5, -5, 5]);
      } else if (kind === 'pyramid') {
        const s = airSpot(0.1, 0.55, 8, 3);
        if (s) add('pyramid', s[0], s[1], s[2], 4, 0, 0, [-4, 4, -4, 0, -4, 4]);
      } else if (kind === 'stairs') {
        for (let t = 0; t < 4; t++) {
          const [px, pz] = polar(0.2, 0.6);
          if (!clear(px, pz, 14)) continue;
          const dir = rng.int(4);
          const n = 9 + rng.int(4);
          const dx = [1, 0, -1, 0][dir]!;
          const dz = [0, 1, 0, -1][dir]!;
          const ex = [Math.min(0, dx * n) - 1, Math.max(0, dx * n) + 1, -3, n, Math.min(0, dz * n) - 1, Math.max(0, dz * n) + 1] as [number, number, number, number, number, number];
          add('stairs', px, floorAt(px, pz), pz, n, dir, 0, ex);
          break;
        }
      } else if (kind === 'house') {
        const s = airSpot(0.35, 0.62, 4, 6);
        if (s) {
          const p = add('house', s[0], s[1], s[2], 0, rng.int(2), 0, [0, 4, 0, 4, 0, 4]);
          const c = housePos(p, 1, 1, 3);
          zone.chests.push({ x: c[0], y: c[1], z: c[2], facing: 'north' });
        }
      } else if (kind === 'shrine') {
        for (let t = 0; t < 4; t++) {
          const [px, pz] = polar(0.2, 0.5);
          if (!clear(px, pz, 14)) continue;
          const fy = floorAt(px, pz) + 1;
          add('shrine', px, fy, pz, 0, 0, 0, [0, 8, -4, 7, 0, 5]);
          zone.chests.push({ x: px + 2, y: fy + 1, z: pz + 3, facing: 'north' });
          break;
        }
      }
    }
    return zone;
  }

  // ------------------------------------------------------------------ queries

  /** Normalised distance from a zone's centre (1 = the cavern's edge). */
  static dist(z: CorruptZone, x: number, y: number, zz: number): number {
    const dx = (x - z.x) / z.rh;
    const dz = (zz - z.z) / z.rh;
    let dy = (y - z.y) / z.rv;
    if (dy < 0) dy *= 1.4;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Whether a position lies in the Corrupted Caves biome. */
  inside(x: number, y: number, z: number): boolean {
    const zone = this.zoneAt(x, z);
    return !!zone && CorruptedCaves.dist(zone, x, y, z) < CORRUPT_BIOME_D;
  }

  /** Whether any part of a zone reaches into the chunk at (bx, bz). */
  private touches(z: CorruptZone, bx: number, bz: number): boolean {
    const r = z.rh * Math.sqrt(BAND) + 2;
    return z.x + r >= bx && z.x - r < bx + 16 && z.z + r >= bz && z.z - r < bz + 16;
  }

  /** Nearest zone (optionally only those with a portal), searching regions outwards. */
  nearest(x: number, z: number, withPortal = false, maxRegions = 24): CorruptZone | null {
    const rx0 = Math.floor(x / CORRUPT_REGION);
    const rz0 = Math.floor(z / CORRUPT_REGION);
    let best: CorruptZone | null = null;
    let bd = Infinity;
    for (let r = 0; r <= maxRegions; r++) {
      for (let rz = rz0 - r; rz <= rz0 + r; rz++)
        for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== r) continue;
          const zone = this.zone(rx, rz);
          if (!zone || (withPortal && !zone.portal)) continue;
          const d = (zone.x - x) ** 2 + (zone.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = zone;
          }
        }
      if (best && r * CORRUPT_REGION > Math.sqrt(bd)) break;
    }
    return best;
  }

  /** Where to stand in front of the nearest glitched portal. */
  nearestPortal(x: number, z: number): { x: number; y: number; z: number } | null {
    const zone = this.nearest(x, z, true);
    const p = zone?.portal;
    if (!p) return null;
    return { x: p.x + (p.axis === 'x' ? 1 : 3), y: p.y, z: p.z + (p.axis === 'z' ? 1 : 3) };
  }

  // ------------------------------------------------------------------ carving (proto chunk)

  /**
   * Carves the part of a zone inside this proto chunk. Runs after the
   * ordinary caves, deepslate and ore veins, so its blocks are final.
   * Returns false when no zone reaches the chunk.
   */
  apply(chunk: Chunk, bx: number, bz: number): boolean {
    const zone = this.zoneAt(bx + 8, bz + 8);
    if (!zone || !this.touches(zone, bx, bz)) return false;
    const t = states();
    const tops = this.tops;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let top = 250;
        while (top > 4) {
          const s = chunk.get(x, top, z);
          if (s !== 0 && !STATE_FLUID[s]) break;
          top--;
        }
        tops[(z << 4) | x] = top;
      }
    const put = (wx: number, y: number, wz: number, s: number): void => {
      const lx = wx - bx;
      const lz = wz - bz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y > 254) return;
      chunk.setRaw(lx, y, lz, s);
    };
    const get = (wx: number, y: number, wz: number): number => chunk.get(wx - bx, y, wz - bz);
    const id = zone.id;
    const yLo = Math.max(5, Math.floor(zone.y - (zone.rv * Math.sqrt(BAND)) / 1.4) - 1);
    const yHi = Math.min(250, Math.ceil(zone.y + zone.rv * Math.sqrt(BAND)) + 1);
    const shell = [t.corrupted, t.corrupted, t.corrupted, t.corrupted, t.corrupted, t.farstone, t.farstone, t.stat, t.nul, t.missing, t.overflow, t.glitch];
    const misload = [t.farstone, t.corrupted, t.stretched, t.farDirt];

    // 1. The cavern, its corrupted shell and the misloaded band around it
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const hx = (wx - zone.x) / zone.rh;
        const hz = (wz - zone.z) / zone.rh;
        if (hx * hx + hz * hz > BAND + 0.2) continue;
        const top = tops[(lz << 4) | lx]!;
        const qx = (wx & ~1) + 1;
        const qz = (wz & ~1) + 1;
        for (let y = yLo; y <= Math.min(yHi, top); y++) {
          const s = chunk.get(lx, y, lz);
          const d = CorruptedCaves.dist(zone, qx, (y & ~1) + 1, qz) + ((hashInts(id, wx >> 2, y >> 2, wz >> 2) & 1023) / 1023 - 0.5) * 0.32;
          if (d < 1) {
            if (y <= top - 6) chunk.setRaw(lx, y, lz, t.caveAir);
            else if (STATE_FLUID[s]) chunk.setRaw(lx, y, lz, t.corrupted);
            continue;
          }
          if (d < SHELL) {
            if (s !== 0 && s !== t.caveAir) chunk.setRaw(lx, y, lz, shell[roll(id, wx, y, wz, 0x5e11) % shell.length]!);
            continue;
          }
          if (d >= BAND) continue;
          if (STATE_FLUID[s]) {
            // No water walls hanging at the edge of the corruption
            chunk.setRaw(lx, y, lz, t.corrupted);
            continue;
          }
          if (y > top - 8) continue;
          // Misloaded 8x8x8 cells: whole cubes of the wrong world
          const cx8 = wx >> 3;
          const cy8 = y >> 3;
          const cz8 = wz >> 3;
          const dc = CorruptedCaves.dist(zone, (cx8 << 3) + 4, (cy8 << 3) + 4, (cz8 << 3) + 4);
          if (dc < 1.15 || dc > BAND - 0.1) continue;
          const h = hashInts(id ^ 0xce11, cx8, cy8, cz8);
          if (h % 1000 >= (400 * (BAND - 0.1 - dc)) / (BAND - 1.25)) continue;
          const kind = (h >>> 12) % 10;
          const solid = s !== 0 && s !== t.caveAir;
          if (kind <= 3) {
            if (solid) chunk.setRaw(lx, y, lz, misload[kind]!);
          } else if (kind <= 5) {
            if (dc < 1.6) chunk.setRaw(lx, y, lz, t.caveAir);
            else if (solid) chunk.setRaw(lx, y, lz, t.overflow);
          } else if (kind <= 7) {
            if (solid) chunk.setRaw(lx, y, lz, t.stat);
          } else if (kind === 8) {
            if (solid) chunk.setRaw(lx, y, lz, t.nul);
          } else chunk.setRaw(lx, y, lz, roll(id, wx, y, wz, 0x0e) < 150 ? t.glitchOre : t.missing);
        }
      }

    // 2. Void pits down to the bottom of the world, lined with null blocks
    for (const p of zone.pits) {
      if (p.x + p.r + 2 < bx || p.x - p.r - 2 > bx + 16 || p.z + p.r + 2 < bz || p.z - p.r - 2 > bz + 16) continue;
      for (let lz = 0; lz < 16; lz++)
        for (let lx = 0; lx < 16; lx++) {
          const wx = bx + lx;
          const wz = bz + lz;
          const dd = Math.hypot(wx + 0.5 - p.x, wz + 0.5 - p.z);
          if (dd >= p.r + 1.3) continue;
          if (dd < p.r) {
            for (let y = 1; y < 5; y++) chunk.setRaw(lx, y, lz, t.nul);
            for (let y = 5; y <= zone.y; y++) chunk.setRaw(lx, y, lz, t.caveAir);
          } else {
            for (let y = 1; y <= zone.y; y++) {
              const s = chunk.get(lx, y, lz);
              if (s !== 0 && s !== t.caveAir) chunk.setRaw(lx, y, lz, t.nul);
              else if (y < zone.y - zone.rv * 0.5) chunk.setRaw(lx, y, lz, t.nul);
            }
          }
        }
    }

    // 3. A fissure up to the surface, where the corruption bleeds out
    const f = zone.fissure;
    if (f && f.x + 12 >= bx && f.x - 12 < bx + 16 && f.z + 12 >= bz && f.z - 12 < bz + 16) {
      for (let lz = 0; lz < 16; lz++)
        for (let lx = 0; lx < 16; lx++) {
          const wx = bx + lx;
          const wz = bz + lz;
          const ci = (lz << 4) | lx;
          const top = tops[ci]!;
          const wet = STATE_FLUID[chunk.get(lx, top + 1, lz)] !== 0;
          const flat = Math.hypot(wx + 0.5 - f.x, wz + 0.5 - f.z);
          if (flat < 10 && !wet) {
            // Corrupted ground around the opening, and a few pixels hanging above it
            const r = roll(id, wx, 0, wz, 0xf155);
            if (r < 700 - flat * 55) chunk.setRaw(lx, top, lz, r < 120 ? t.stat : r < 380 ? t.corrupted : t.farGrass);
            if (r > 985) chunk.setRaw(lx, top + 3 + (r % 5), lz, t.glitch);
          }
          for (let y = zone.y; y <= top + 1 && !wet; y++) {
            const cx = f.x + Math.sin(y * 0.21 + id) * 1.4;
            const cz = f.z + Math.cos(y * 0.17 + id) * 1.4;
            const dd = Math.hypot(wx + 0.5 - cx, wz + 0.5 - cz);
            const s = chunk.get(lx, y, lz);
            if (dd < f.r) chunk.setRaw(lx, y, lz, y > top - 2 ? 0 : t.caveAir);
            else if (dd < f.r + 1.5 && s !== 0 && s !== t.caveAir && !STATE_FLUID[s]) chunk.setRaw(lx, y, lz, roll(id, wx, y, wz, 0xf1) < 250 ? t.stat : t.corrupted);
          }
        }
    }

    // 4. Floating terrain, impossible formations, glitched ruins
    for (const p of zone.pieces) {
      if (p.x1 < bx || p.x0 >= bx + 16 || p.z1 < bz || p.z0 >= bz + 16) continue;
      const x0 = Math.max(p.x0, bx);
      const x1 = Math.min(p.x1, bx + 15);
      const z0 = Math.max(p.z0, bz);
      const z1 = Math.min(p.z1, bz + 15);
      for (let y = Math.max(1, p.y0); y <= Math.min(254, p.y1); y++)
        for (let wz = z0; wz <= z1; wz++)
          for (let wx = x0; wx <= x1; wx++) {
            const s = pieceBlock(p, id, wx - p.x, y - p.y, wz - p.z, get(wx, y, wz));
            if (s >= 0) put(wx, y, wz, s);
          }
    }

    // 5. The portal island
    const isl = zone.island;
    if (isl && isl.x + 10 >= bx && isl.x - 10 < bx + 16 && isl.z + 10 >= bz && isl.z - 10 < bz + 16) {
      for (let lz = 0; lz < 16; lz++)
        for (let lx = 0; lx < 16; lx++) {
          const wx = bx + lx;
          const wz = bz + lz;
          const dd = Math.hypot(wx - isl.x, wz - isl.z);
          if (dd < 7.6) for (let y = isl.y; y <= isl.y + 9; y++) chunk.setRaw(lx, y, lz, t.caveAir);
          if (dd < 6.6) {
            const r = roll(id, wx, isl.y, wz, 0x1515);
            chunk.setRaw(lx, isl.y - 1, lz, dd > 5.6 ? t.corrupted : r < 60 ? t.glitch : t.bricks);
            for (let k = 1; k <= 5; k++) if (dd < 6.6 - k * 1.25) chunk.setRaw(lx, isl.y - 1 - k, lz, roll(id, wx, isl.y - k, wz, 0x15) < 300 ? t.stat : t.corrupted);
            if (dd > 4 && dd < 5.2 && r > 960) chunk.setRaw(lx, isl.y, lz, t.crystal);
          }
          // Floating stepping stones spiralling down from the island to the floor
          if (dd >= 7 && dd < 9) {
            const ang = Math.atan2(wz + 0.5 - isl.z, wx + 0.5 - isl.x);
            const a0 = (id % 628) / 100;
            const floor = Math.floor(zone.y - (zone.rv * Math.sqrt(Math.max(0, 1 - ((wx - zone.x) ** 2 + (wz - zone.z) ** 2) / (zone.rh * zone.rh)))) / 1.4);
            const steps = isl.y - 1 - floor;
            const k = Math.round((((ang - a0) % TAU) + TAU) % TAU / STEP_ANGLE);
            if (steps > 0 && k <= steps && Math.abs(wrapAngle(ang - a0 - k * STEP_ANGLE)) < 0.1) {
              const sy = isl.y - 1 - k;
              chunk.setRaw(lx, sy, lz, roll(id, wx, sy, wz, 0x57e9) < 200 ? t.corrupted : t.bricks);
              for (let y = sy + 1; y <= sy + 3; y++) if (y > floor + 1) chunk.setRaw(lx, y, lz, t.caveAir);
            }
          }
        }
      if (zone.portal) stampPortal(zone, put);
    }

    // 6. Floors, ceilings and air: data crystals, glitch light, static drips
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const hx = (wx - zone.x) / zone.rh;
        const hz = (wz - zone.z) / zone.rh;
        if (hx * hx + hz * hz > 1.1) continue;
        for (let y = yLo + 1; y < yHi; y++) {
          if (chunk.get(lx, y, lz) !== t.caveAir) continue;
          const below = chunk.get(lx, y - 1, lz);
          const above = chunk.get(lx, y + 1, lz);
          const r = roll(id, wx, y, wz, 0xa1a);
          if (STATE_SOLID[below] && below !== t.caveAir && below !== t.crystal) {
            if (r < 10) chunk.setRaw(lx, y, lz, t.crystal);
            else if (r < 40 && below !== t.nul) chunk.setRaw(lx, y - 1, lz, t.glitch);
            else if (r < 80 && below !== t.nul) chunk.setRaw(lx, y - 1, lz, t.stat);
          } else if (STATE_SOLID[above] && above !== t.caveAir) {
            if (r < 30) chunk.setRaw(lx, y + 1, lz, t.stat);
          } else if (r === 0 && hashInts(id, wx, y, wz, 0x9) % 6 === 0) chunk.setRaw(lx, y, lz, t.glitch);
        }
      }

    // 7. Cave biome cells
    const g = chunk.caveBiomes;
    if (g)
      for (let cy = 1; cy < g.length / 16; cy++)
        for (let cz = 0; cz < 4; cz++)
          for (let cx = 0; cx < 4; cx++) {
            const i = (cy * 4 + cz) * 4 + cx;
            if (!g[i]) continue;
            if (CorruptedCaves.dist(zone, bx + cx * 4 + 2, cy * 4 + 2, bz + cz * 4 + 2) < CORRUPT_BIOME_D) g[i] = CORRUPTED_BIOME;
          }
    return true;
  }

  // ------------------------------------------------------------------ late pass (decorated chunk)

  /**
   * Re-stamps the portal (nothing decorated over it) and fills the ruins'
   * chests, which need block entities. Runs after structures.
   */
  late(v: DecorView, cx: number, cz: number, lootTable: string): void {
    const bx = cx << 4;
    const bz = cz << 4;
    const zone = this.zoneAt(bx + 8, bz + 8);
    if (!zone || !this.touches(zone, bx, bz)) return;
    // Lava lakes and springs from the decoration stages don't belong here:
    // pools in the cavern become void-black, anything in the walls is sealed
    const t = states();
    const yLo = Math.max(5, Math.floor(zone.y - (zone.rv * Math.sqrt(BAND)) / 1.4) - 1);
    const yHi = Math.min(250, Math.ceil(zone.y + zone.rv * Math.sqrt(BAND)) + 1);
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const hx = (bx + lx - zone.x) / zone.rh;
        const hz = (bz + lz - zone.z) / zone.rh;
        if (hx * hx + hz * hz > BAND) continue;
        for (let y = yLo; y <= yHi; y++) {
          if (!STATE_FLUID[v.target.get(lx, y, lz)]) continue;
          const d = CorruptedCaves.dist(zone, bx + lx, y, bz + lz);
          if (d < 1.05) v.target.setRaw(lx, y, lz, t.nul);
          else if (d < BAND) v.target.setRaw(lx, y, lz, t.corrupted);
        }
      }
    if (zone.portal) stampPortal(zone, (x, y, z, s) => v.set(x, y, z, s));
    for (const c of zone.chests) {
      if (!v.inside(c.x, c.z)) continue;
      v.set(c.x, c.y, c.z, stateOf('chest', { facing: c.facing }));
      v.setBlockEntity(c.x, c.y, c.z, { type: 'chest', loot: lootTable, lootSeed: hashInts(zone.id, c.x, c.y, c.z) });
    }
  }
}

/** Cave biome number of the Corrupted Caves (see CaveBiome). */
export const CORRUPTED_BIOME = 10;

/** The broken frame: corners missing, a socket for the Eye on top, interior clear. */
function stampPortal(zone: CorruptZone, put: (x: number, y: number, z: number, s: number) => void): void {
  const t = states();
  const p = zone.portal!;
  const at = (i: number, j: number, s: number): void => put(p.x + (p.axis === 'x' ? i : 0), p.y + j, p.z + (p.axis === 'z' ? i : 0), s);
  const part = (i: number, j: number): number => (roll(zone.id, i, j, 0, 0xf4a) < 300 ? t.cracked : t.frame);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) at(i, j, t.caveAir);
  for (let j = 0; j < 4; j++) {
    at(-1, j, part(-1, j));
    at(3, j, part(3, j));
  }
  for (let i = 0; i < 3; i++) {
    at(i, -1, part(i, -1));
    at(i, 4, i === 1 ? t.socket : part(i, 4));
  }
  // The missing corners drift above the frame, with more pieces around it
  at(-2, 6, t.cracked);
  at(4, 7, t.cracked);
  const perp = (i: number, k: number, j: number, s: number): void => put(p.x + (p.axis === 'x' ? i : k), p.y + j, p.z + (p.axis === 'z' ? i : k), s);
  for (let n = 0; n < 5; n++) {
    const r = roll(zone.id, n, 0, 0, 0xf1f);
    const i = -3 + (r % 9);
    const k = ((r >> 3) % 2 ? 1 : -1) * (2 + ((r >> 4) % 3));
    perp(i, k, 2 + ((r >> 6) % 6), t.cracked);
  }
}

/** Local position of a sideways house block (room coords: i across, j up, k deep). */
function housePos(p: Piece, i: number, j: number, k: number): [number, number, number] {
  // The room lies on its side: its floor is a wall and "up" runs sideways
  return p.b ? [p.x + j, p.y + i, p.z + k] : [p.x + k, p.y + i, p.z + j];
}

/** The block a piece puts at a local offset, or -1 to leave it. */
function pieceBlock(p: Piece, id: number, lx: number, ly: number, lz: number, cur: number): number {
  const t = states();
  const r = roll(id, p.x + lx, p.y + ly, p.z + lz, 0x9ece);
  switch (p.kind) {
    case 'island': {
      if (p.c && ly >= 1) {
        // A small tree still growing on its chunk of misplaced ground
        if (lx === 0 && lz === 0 && ly <= 4) return t.log;
        if (ly >= 3 && lx * lx + lz * lz + (ly - 4) ** 2 <= 5 && r < 880) return t.leaves;
        return -1;
      }
      if (ly > 0) return -1;
      const rad = p.a - Math.max(0, -ly - 1) * (p.a / p.b);
      if (lx * lx + lz * lz > rad * rad + 0.5) return -1;
      if (ly === 0) return t.grass;
      if (ly >= -2) return t.dirt;
      return r < 120 ? t.ores[r % 3]! : t.stone;
    }
    case 'ore':
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(lz) > 2) return -1;
      if (r < 350) return t.ores[r < 20 ? 6 : r < 40 ? 7 : r % 6]!;
      return p.y < 24 ? t.deepslate : t.stone;
    case 'blob':
      if (lx * lx + ly * ly + lz * lz > p.a * p.a || r < 180) return -1;
      return [t.glitch, t.stat, t.missing, t.nul, t.corrupted][r % 5]!;
    case 'pillar':
      if (ly === -p.a) return t.glitch;
      if (ly === -p.a + 1) return t.stat;
      return r < 250 ? t.corrupted : t.bricks;
    case 'ring': {
      const u = p.b ? lx : lz;
      const w = p.b ? lz : lx;
      if (w !== 0) return -1;
      const dd = Math.hypot(u, ly);
      if (Math.abs(dd - p.a) > 0.55) return -1;
      return (u === 0 || ly === 0) && r < 800 ? t.glitch : t.bricks;
    }
    case 'pyramid': {
      const half = p.a + ly;
      if (Math.abs(lx) > half || Math.abs(lz) > half) return -1;
      return ly === 0 ? t.bricks : (ly & 1) === 0 ? t.corrupted : t.farstone;
    }
    case 'stairs': {
      const dx = [1, 0, -1, 0][p.b]!;
      const dz = [0, 1, 0, -1][p.b]!;
      if (ly < 0) {
        // Foundation under the first steps only (the floor is not flat)
        const k = lx * dx + lz * dz;
        if (k >= 0 && k <= 1 && (dx ? Math.abs(lz) <= 0 : Math.abs(lx) <= 0) && cur === t.caveAir) return t.bricks;
        return -1;
      }
      const k = ly;
      if (k > p.a) return -1;
      if (lx * dx + lz * dz !== k) return -1;
      if (dx ? lz !== 0 : lx !== 0) return -1;
      return k === p.a ? t.glitch : t.bricks;
    }
    case 'house': {
      // Map back into room coordinates
      const [i, j, k] = p.b ? [ly, lx, lz] : [ly, lz, lx];
      if (i < 0 || i > 4 || j < 0 || j > 3 || k < 0 || k > 4) return -1;
      const wall = i === 0 || i === 4 || k === 0 || k === 4;
      if (j === 0) return r < 120 ? -1 : t.cobble;
      if (j === 3) return i === 2 && k === 2 ? t.glowstone : r < 150 ? -1 : t.planks;
      if (wall) {
        if (k === 0 && i === 2) return t.caveAir; // the door
        if (i === 0 && k === 2 && j === 2) return t.glass;
        return r < 150 ? -1 : t.planks;
      }
      if (j === 1 && i === 1 && k === 1) return t.table;
      if (j === 1 && i === 3 && k === 1) return t.bookshelf;
      return t.caveAir;
    }
    case 'shrine': {
      // A little tower sheared sideways, layer by layer
      if (ly < 0) return cur === t.caveAir || cur === 0 ? t.bricks : -1;
      const sx = lx - (ly >> 1);
      const sz = lz - (ly % 3 === 2 ? 1 : 0);
      if (sx < 0 || sx > 4 || sz < 0 || sz > 4) return -1;
      if (ly === 0) return t.bricks;
      if (ly >= 6) return ly === 6 ? (r < 300 ? t.stat : t.corrupted) : -1;
      const wall = sx === 0 || sx === 4 || sz === 0 || sz === 4;
      if (wall) {
        if (sz === 0 && sx === 2 && ly <= 2) return t.caveAir;
        if (ly === 3 && (sx === 2 || sz === 2)) return t.glitch;
        return r < 90 ? t.missing : t.bricks;
      }
      if (ly === 1 && sx === 1 && sz === 1) return t.crystal;
      return t.caveAir;
    }
  }
  return -1;
}
