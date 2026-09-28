/**
 * V2 cave carver (the Caves Update). Runs on the proto chunk after the
 * surface rules. Every decision is a pure function of world coordinates and
 * the seed, so caves continue seamlessly across chunk borders and generate
 * identically in any order.
 *
 * Cave kinds, from small to huge:
 *  - noodles: thin winding tunnels;
 *  - spaghetti: long tunnels where two noise surfaces intersect;
 *  - cheese caverns: large chambers that grow with depth, with stone pillars;
 *  - vertical shafts, some opening to the surface;
 *  - ravines: curved canyons cut down from the surface;
 *  - mega-caverns: rare regional chambers 90-140 blocks across with columns
 *    and floor lakes.
 *
 * Fluids: a lava sea at the very bottom, aquifer regions flooded to a flat
 * water level (separated from dry caves by stone barriers so no water walls
 * hang in the air), underground rivers at one shared level, and lava lakes in
 * lava caves.
 */
import type { Chunk } from '../../world/chunk';
import { Octave2, Octave3, smoothstep } from '../../math/noise';
import { Random, hashInts } from '../../math/rng';
import { NoiseGrid } from '../grid';
import { CaveBiome, type CaveBiomeSource } from './caveBiomes';
import { S } from '../../registry/blocks';

/** Everything at or below this height that is carved becomes lava. */
export const LAVA_SEA = 7;
/** Water level shared by all underground rivers. */
export const RIVER_LEVEL = 24;
/** Lava caves flood their lowest chambers up to here. */
export const LAVA_LAKE = 13;
/** Carving happens below this height. */
const H = 136;
/** Cave biome cells: 4x4 per chunk horizontally, 4 blocks tall. */
export const BIOME_CELLS_Y = H / 4;

export interface CarveStates {
  water: number;
  lava: number;
  caveAir: number;
  solid(s: number): boolean;
}

interface Mega {
  x: number;
  y: number;
  z: number;
  rh: number;
  rv: number;
  /** Floor lake: water (or lava in lava caves). */
  lake: boolean;
}

interface Shaft {
  x: number;
  z: number;
  r: number;
  y0: number;
  open: boolean;
  phase: number;
}

interface Ravine {
  /** Centre line sampled every few blocks: x0, z0, x1, z1, ... */
  pts: Float32Array;
  floor: number;
  width: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

let VEIN_STATES: Record<string, number> | undefined;

const MEGA_REGION = 288;
/** Noodle tunnels stay below this height. */
const NOODLE_TOP = 72;
/** Large ore veins stay below this height. */
const VEIN_TOP = 60;
const SHAFT_CELL = 44;
const RAVINE_REGION = 112;
const AQUIFER_REGION = 72;

export class CaveCarver {
  private readonly cheese: Octave3;
  private readonly spagA: Octave3;
  private readonly spagB: Octave3;
  private readonly spagWidth: Octave3;
  private readonly noodleA: Octave3;
  private readonly noodleB: Octave3;
  private readonly entrance: Octave2;
  private readonly pillar: Octave2;
  private readonly bigPillar: Octave2;
  private readonly river: Octave2;
  private readonly riverMask: Octave2;
  private readonly riverRoof: Octave2;
  private readonly warpX: Octave2;
  private readonly warpZ: Octave2;
  private readonly veinToggle: Octave3;
  private readonly veinA: Octave3;
  private readonly veinB: Octave3;
  private readonly veinGrids = [new NoiseGrid(4, 4, VEIN_TOP), new NoiseGrid(4, 4, VEIN_TOP), new NoiseGrid(4, 4, VEIN_TOP)];
  private readonly veinVals = [new Float32Array(16 * 16 * VEIN_TOP), new Float32Array(16 * 16 * VEIN_TOP), new Float32Array(16 * 16 * VEIN_TOP)];

  private readonly grids = [0, 1, 2, 3, 4, 5].map((i) => new NoiseGrid(4, 4, i < 4 ? H : NOODLE_TOP));
  private readonly vals = [0, 1, 2, 3, 4, 5].map((i) => new Float32Array(16 * 16 * (i < 4 ? H : NOODLE_TOP)));
  private readonly tops = new Int16Array(256);

  private readonly megaCache = new Map<number, Mega | null>();
  private readonly shaftCache = new Map<number, Shaft | null>();
  private readonly ravineCache = new Map<number, Ravine | null>();
  private readonly aquiferCache = new Map<number, number>();

  constructor(
    readonly seed: number,
    readonly biomes: CaveBiomeSource,
  ) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0xca4e2));
    this.cheese = new Octave3(r(1), 2, 72, 36);
    this.spagA = new Octave3(r(2), 2, 60, 34);
    this.spagB = new Octave3(r(3), 2, 60, 34);
    this.spagWidth = new Octave3(r(4), 1, 120, 80);
    this.noodleA = new Octave3(r(5), 1, 26, 18);
    this.noodleB = new Octave3(r(6), 1, 26, 18);
    this.entrance = new Octave2(r(7), 2, 170);
    this.pillar = new Octave2(r(8), 1, 9);
    this.bigPillar = new Octave2(r(9), 2, 22);
    this.river = new Octave2(r(10), 2, 340);
    this.riverMask = new Octave2(r(11), 1, 500);
    this.riverRoof = new Octave2(r(12), 1, 30);
    this.warpX = new Octave2(r(13), 1, 60);
    this.warpZ = new Octave2(r(14), 1, 60);
    this.veinToggle = new Octave3(r(15), 1, 90, 70);
    this.veinA = new Octave3(r(16), 1, 30, 22);
    this.veinB = new Octave3(r(17), 1, 30, 22);
  }

  // ------------------------------------------------------------------ regional features

  private cached<T>(map: Map<number, T>, key: number, make: () => T): T {
    let v = map.get(key);
    if (v === undefined && !map.has(key)) {
      v = make();
      if (map.size > 8192) map.clear();
      map.set(key, v);
    }
    return v as T;
  }

  /** The mega-cavern of a region, if it has one. */
  mega(rx: number, rz: number): Mega | null {
    return this.cached(this.megaCache, hashInts(rx, rz), () => {
      const rng = new Random(hashInts(this.seed, rx, rz, 0x3e6a));
      if (!rng.chance(0.3)) return null;
      const m = 80;
      return {
        x: rx * MEGA_REGION + m + rng.int(MEGA_REGION - 2 * m),
        z: rz * MEGA_REGION + m + rng.int(MEGA_REGION - 2 * m),
        y: 22 + rng.int(9),
        rh: 46 + rng.int(26),
        rv: 15 + rng.int(6),
        lake: rng.chance(0.6),
      };
    });
  }

  private shaft(sx: number, sz: number): Shaft | null {
    return this.cached(this.shaftCache, hashInts(sx, sz), () => {
      const rng = new Random(hashInts(this.seed, sx, sz, 0x5af7));
      if (!rng.chance(0.16)) return null;
      return {
        x: sx * SHAFT_CELL + 6 + rng.int(SHAFT_CELL - 12),
        z: sz * SHAFT_CELL + 6 + rng.int(SHAFT_CELL - 12),
        r: 1.6 + rng.next() * 1.9,
        y0: 12 + rng.int(20),
        open: rng.chance(0.4),
        phase: rng.next() * Math.PI * 2,
      };
    });
  }

  ravine(rx: number, rz: number): Ravine | null {
    return this.cached(this.ravineCache, hashInts(rx, rz), () => {
      const rng = new Random(hashInts(this.seed, rx, rz, 0x7a1e));
      if (!rng.chance(0.28)) return null;
      let x = rx * RAVINE_REGION + rng.int(RAVINE_REGION);
      let z = rz * RAVINE_REGION + rng.int(RAVINE_REGION);
      let heading = rng.next() * Math.PI * 2;
      const len = 60 + rng.int(70);
      const bend = (rng.next() - 0.5) * 0.03;
      const step = 4;
      const n = Math.floor(len / step) + 1;
      const pts = new Float32Array(n * 2);
      let minX = x;
      let maxX = x;
      let minZ = z;
      let maxZ = z;
      for (let i = 0; i < n; i++) {
        pts[i * 2] = x;
        pts[i * 2 + 1] = z;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        heading += bend * step + (rng.next() - 0.5) * 0.12;
        x += Math.cos(heading) * step;
        z += Math.sin(heading) * step;
      }
      const width = 2.8 + rng.next() * 3.2;
      return { pts, floor: 18 + rng.int(15), width, minX: minX - width - 2, maxX: maxX + width + 2, minZ: minZ - width - 2, maxZ: maxZ + width + 2 };
    });
  }

  /** Flood level of an aquifer region (-1 when dry). */
  private aquiferLevel(rx: number, rz: number): number {
    return this.cached(this.aquiferCache, hashInts(rx, rz), () => {
      const h = hashInts(this.seed, rx, rz, 0xa9f1);
      if ((h & 1023) >= 200) return -1;
      return 11 + ((h >>> 10) % 20);
    });
  }

  /**
   * Water level at a position and whether it sits in the stone barrier between
   * two regions with different levels (barriers are never carved below the
   * higher of the two levels).
   */
  private aquifer(wx: number, wz: number, out: { level: number; barrier: number }): void {
    const ux = wx + this.warpX.sample(wx, wz) * 18;
    const uz = wz + this.warpZ.sample(wx, wz) * 18;
    const rx = Math.floor(ux / AQUIFER_REGION);
    const rz = Math.floor(uz / AQUIFER_REGION);
    const level = this.aquiferLevel(rx, rz);
    out.level = level;
    out.barrier = -1;
    const fx = ux - rx * AQUIFER_REGION;
    const fz = uz - rz * AQUIFER_REGION;
    const edge = 2;
    const check = (nx: number, nz: number): void => {
      const l2 = this.aquiferLevel(nx, nz);
      if (l2 !== level) out.barrier = Math.max(out.barrier, level, l2);
    };
    if (fx < edge) check(rx - 1, rz);
    else if (fx > AQUIFER_REGION - edge) check(rx + 1, rz);
    if (fz < edge) check(rx, rz - 1);
    else if (fz > AQUIFER_REGION - edge) check(rx, rz + 1);
  }

  // ------------------------------------------------------------------ biome grid

  /** Samples cave biomes per 4x4x4 cell (cells above the column's surface are None). */
  fillBiomes(chunk: Chunk, bx: number, bz: number, temps: Float32Array, tops: Int16Array): Uint8Array {
    const out = new Uint8Array(16 * BIOME_CELLS_Y);
    for (let cz = 0; cz < 4; cz++)
      for (let cx = 0; cx < 4; cx++) {
        const lx = cx * 4 + 2;
        const lz = cz * 4 + 2;
        const top = tops[(lz << 4) | lx]!;
        const t = temps[(lz << 4) | lx]!;
        for (let cy = 1; cy < BIOME_CELLS_Y; cy++) {
          const y = cy * 4 + 2;
          if (y > top - 6) break;
          out[(cy * 4 + cz) * 4 + cx] = this.biomes.at(bx + lx, y, bz + lz, t);
        }
      }
    void chunk;
    return out;
  }

  // ------------------------------------------------------------------ carving

  carve(chunk: Chunk, bx: number, bz: number, temps: Float32Array, st: CarveStates): void {
    const tops = this.tops;
    let maxTop = 0;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let top = H - 1;
        while (top > 5 && !st.solid(chunk.get(x, top, z))) top--;
        tops[(z << 4) | x] = top;
        if (top > maxTop) maxTop = top;
      }
    const yMax = Math.min(H - 4, maxTop + 2);
    const [gc, ga, gb, gw, gna, gnb] = this.grids as [NoiseGrid, NoiseGrid, NoiseGrid, NoiseGrid, NoiseGrid, NoiseGrid];
    gc.fill(bx, bz, 4, yMax, (x, y, z) => this.cheese.sample(x, y, z), -1);
    ga.fill(bx, bz, 4, yMax, (x, y, z) => this.spagA.sample(x, y, z), 1);
    gb.fill(bx, bz, 4, yMax, (x, y, z) => this.spagB.sample(x, y, z), 1);
    gw.fill(bx, bz, 4, yMax, (x, y, z) => this.spagWidth.sample(x, y, z), 0);
    gna.fill(bx, bz, 4, Math.min(yMax, NOODLE_TOP - 4), (x, y, z) => this.noodleA.sample(x, y, z), 1);
    gnb.fill(bx, bz, 4, Math.min(yMax, NOODLE_TOP - 4), (x, y, z) => this.noodleB.sample(x, y, z), 1);
    const [vc, va, vb, vw, vna, vnb] = this.vals as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    gc.expand(vc, yMax);
    ga.expand(va, yMax);
    gb.expand(vb, yMax);
    gw.expand(vw, yMax);
    gna.expand(vna, yMax);
    gnb.expand(vnb, yMax);

    const biomes = this.fillBiomes(chunk, bx, bz, temps, tops);
    chunk.caveBiomes = biomes;

    // Regional features touching this chunk
    const megas: Mega[] = [];
    for (let rz = Math.floor((bz - 80) / MEGA_REGION); rz <= Math.floor((bz + 96) / MEGA_REGION); rz++)
      for (let rx = Math.floor((bx - 80) / MEGA_REGION); rx <= Math.floor((bx + 96) / MEGA_REGION); rx++) {
        const m = this.mega(rx, rz);
        if (m && m.x + m.rh + 8 > bx && m.x - m.rh - 8 < bx + 16 && m.z + m.rh + 8 > bz && m.z - m.rh - 8 < bz + 16) megas.push(m);
      }
    const shafts: Shaft[] = [];
    for (let sz = Math.floor((bz - 8) / SHAFT_CELL); sz <= Math.floor((bz + 24) / SHAFT_CELL); sz++)
      for (let sx = Math.floor((bx - 8) / SHAFT_CELL); sx <= Math.floor((bx + 24) / SHAFT_CELL); sx++) {
        const s = this.shaft(sx, sz);
        if (s && Math.abs(s.x - (bx + 8)) < 16 && Math.abs(s.z - (bz + 8)) < 16) shafts.push(s);
      }
    const ravines: Ravine[] = [];
    for (let rz = Math.floor((bz - 140) / RAVINE_REGION); rz <= Math.floor((bz + 156) / RAVINE_REGION); rz++)
      for (let rx = Math.floor((bx - 140) / RAVINE_REGION); rx <= Math.floor((bx + 156) / RAVINE_REGION); rx++) {
        const r = this.ravine(rx, rz);
        if (r && r.maxX >= bx && r.minX < bx + 16 && r.maxZ >= bz && r.minZ < bz + 16) ravines.push(r);
      }

    const aq = { level: -1, barrier: -1 };
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const ci = (z << 4) | x;
        const wx = bx + x;
        const wz = bz + z;
        const top = tops[ci]!;
        const above = chunk.get(x, top + 1, z);
        const wet = above === st.water || above === st.lava;
        const allowSurface = this.entrance.sample(wx, wz) > 0.2;
        // Sampled on first need: most columns never carve a pillar or a fluid
        let pillar = NaN;
        const bigPillar = megas.length ? this.bigPillar.sample(wx, wz) : 1;
        let aqReady = false;

        // Ravine: distance from this column to the nearest centre line
        let rvFloor = 999;
        let rvHalf = 0;
        for (const r of ravines) {
          if (wx < r.minX || wx > r.maxX || wz < r.minZ || wz > r.maxZ) continue;
          const p = r.pts;
          const n = p.length / 2;
          let best = 1e9;
          let bestT = 0;
          for (let i = 0; i + 1 < n; i++) {
            const x0 = p[i * 2]!;
            const z0 = p[i * 2 + 1]!;
            const dx = p[i * 2 + 2]! - x0;
            const dz = p[i * 2 + 3]! - z0;
            const l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((wx + 0.5 - x0) * dx + (wz + 0.5 - z0) * dz) / l2));
            const ex = x0 + dx * t - wx - 0.5;
            const ez = z0 + dz * t - wz - 0.5;
            const d2 = ex * ex + ez * ez;
            if (d2 < best) {
              best = d2;
              bestT = (i + t) / (n - 1);
            }
          }
          const half = r.width * Math.pow(Math.sin(Math.PI * bestT), 0.5);
          const d = Math.sqrt(best);
          if (d < half) {
            rvFloor = Math.min(rvFloor, r.floor + Math.round((d / half) * 4));
            rvHalf = Math.max(rvHalf, half - d);
          }
        }

        // Underground river channel
        const riverW = 0.03;
        const rv = top > RIVER_LEVEL + 12 && !wet ? Math.abs(this.river.sample(wx, wz)) : 1;
        const isRiver = rv < riverW && this.riverMask.sample(wx, wz) > -0.15;
        let riverFloor = 999;
        let riverRoof = -1;
        if (isRiver) {
          const t = rv / riverW;
          riverFloor = RIVER_LEVEL - 3 + Math.round(t * 2);
          riverRoof = RIVER_LEVEL + 2 + Math.round((1 - t) * 4 + (this.riverRoof.sample(wx, wz) + 0.5) * 2);
          if (riverRoof > top - 10) {
            riverFloor = 999;
            riverRoof = -1;
          }
        }

        const limit = Math.min(H - 5, allowSurface ? top : top - 8);
        const yTop = Math.max(limit, (rvFloor < 999 || shafts.length > 0) && !wet ? top + 1 : 0, riverRoof);
        for (let y = 5; y <= yTop; y++) {
          const s = chunk.get(x, y, z);
          if (!st.solid(s)) continue;
          const i = (y * 16 + z) * 16 + x;
          let carve = false;
          let river = false;
          if (y >= riverFloor && y <= riverRoof) {
            carve = true;
            river = true;
          } else if (y >= rvFloor && !wet) {
            // Ravine: narrower towards its floor
            const h = (y - rvFloor) / Math.max(8, top - rvFloor);
            carve = rvHalf > 0.5 + (1 - Math.min(1, h * 3)) * 1.2;
          }
          if (!carve && y <= limit) {
            const nearTop = smoothstep(top - 20, top, y);
            // Cheese caverns grow with depth; stone pillars stand in the bigger ones
            const cheeseT = 0.05 + 0.22 * smoothstep(14, 64, y) + 0.32 * nearTop;
            if (vc[i]! > cheeseT) {
              if (pillar !== pillar) pillar = this.pillar.sample(wx, wz);
              carve = pillar < 0.7;
            }
            if (!carve) {
              const a = va[i]!;
              const b = vb[i]!;
              const width = 0.005 + 0.005 * (vw[i]! + 0.5);
              carve = a * a + b * b < width * (1 - 0.6 * nearTop * (allowSurface ? 0 : 1));
            }
            if (!carve && y < NOODLE_TOP - 4 && y < top - 12) {
              const a = vna[i]!;
              const b = vnb[i]!;
              carve = a * a + b * b < 0.0014;
            }
            if (!carve) {
              for (const m of megas) {
                const dx = (wx - m.x) / m.rh;
                const dz = (wz - m.z) / m.rh;
                let dy = (y - m.y) / m.rv;
                if (dy < 0) dy *= 1.5; // flatter floor
                const d = dx * dx + dy * dy + dz * dz;
                if (d < 1 + vc[i]! * 0.35 && y < top - 12 && bigPillar < 0.56) {
                  carve = true;
                  break;
                }
              }
            }
          }
          if (!carve) {
            for (const sh of shafts) {
              if (y < sh.y0 || (!sh.open && y > top - 10) || (sh.open && wet)) continue;
              const dx = wx + 0.5 - (sh.x + Math.sin(y * 0.13 + sh.phase) * 2);
              const dz = wz + 0.5 - (sh.z + Math.cos(y * 0.11 + sh.phase) * 2);
              if (dx * dx + dz * dz < sh.r * sh.r) {
                carve = true;
                break;
              }
            }
          }
          if (!carve) continue;
          // Never undercut the sea or a lake
          if (wet && y > top - 6) continue;
          const up = chunk.get(x, y + 1, z);
          if ((up === st.water || up === st.lava) && !river) continue;
          // Fluids
          let fill = st.caveAir;
          if (y <= LAVA_SEA) fill = st.lava;
          else if (river) fill = y <= RIVER_LEVEL ? st.water : st.caveAir;
          else {
            if (!aqReady) {
              this.aquifer(wx, wz, aq);
              aqReady = true;
            }
            if (aq.barrier >= 0 && y <= aq.barrier) continue;
            const cb = biomes[((y >> 2) * 4 + (z >> 2)) * 4 + (x >> 2)]!;
            if (cb === CaveBiome.Lava && y <= LAVA_LAKE) fill = st.lava;
            else if (aq.level >= 0 && y <= aq.level && y < top - 10) fill = cb === CaveBiome.Lava ? st.lava : cb === CaveBiome.Frozen && y === aq.level ? st.caveAir : st.water;
            else {
              for (const m of megas) {
                if (!m.lake) continue;
                const floorY = Math.round(m.y - m.rv / 1.5) + 3;
                if (y <= floorY && (wx - m.x) ** 2 + (wz - m.z) ** 2 < (m.rh * 0.8) ** 2) {
                  fill = cb === CaveBiome.Lava || cb === CaveBiome.DeepDark ? st.lava : st.water;
                  break;
                }
              }
            }
          }
          chunk.setRaw(x, y, z, fill);
        }
      }
    }
  }

  /**
   * Large ore veins: long ribbons where two ridged noises cross. Copper veins
   * run through granite higher up, iron veins through tuff deep down; both
   * are studded with ore and the odd raw ore block.
   */
  veins(chunk: Chunk, bx: number, bz: number): void {
    const [gt, ga, gb] = this.veinGrids as [NoiseGrid, NoiseGrid, NoiseGrid];
    const [vt, va, vb] = this.veinVals as [Float32Array, Float32Array, Float32Array];
    gt.fill(bx, bz, 5, VEIN_TOP - 4, (x, y, z) => this.veinToggle.sample(x, y, z), 0);
    ga.fill(bx, bz, 5, VEIN_TOP - 4, (x, y, z) => this.veinA.sample(x, y, z), 1);
    gb.fill(bx, bz, 5, VEIN_TOP - 4, (x, y, z) => this.veinB.sample(x, y, z), 1);
    gt.expand(vt);
    ga.expand(va);
    gb.expand(vb);
    const st = (VEIN_STATES ??= {
      stone: S('stone'),
      deepslate: S('deepslate'),
      granite: S('granite'),
      tuff: S('tuff'),
      copper: S('copper_ore'),
      deepCopper: S('deepslate_copper_ore'),
      iron: S('iron_ore'),
      deepIron: S('deepslate_iron_ore'),
      rawCopper: S('raw_copper_block'),
      rawIron: S('raw_iron_block'),
    });
    for (let y = 5; y < VEIN_TOP - 4; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + z) * 16 + x;
          const t = vt[i]!;
          const copper = t > 0;
          const strength = Math.abs(t);
          if (strength < 0.3) continue;
          if (copper ? y < 12 : y > 26) continue;
          if (Math.max(Math.abs(va[i]!), Math.abs(vb[i]!)) > 0.09) continue;
          const s = chunk.get(x, y, z);
          if (s !== st.stone && s !== st.deepslate) continue;
          const h = (hashInts(this.seed, bx + x, y, bz + z) >>> 0) % 1000;
          const deep = s === st.deepslate || y < 24;
          const oreChance = 120 + Math.min(250, (strength - 0.3) * 900);
          let out: number;
          if (h < 12) out = copper ? st.rawCopper : st.rawIron;
          else if (h < oreChance) out = copper ? (deep ? st.deepCopper : st.copper) : deep ? st.deepIron : st.iron;
          else out = copper ? st.granite : st.tuff;
          chunk.setRaw(x, y, z, out);
        }
  }

  /** The mega-cavern whose inner part contains a position, if any. */
  megaAt(x: number, y: number, z: number): Mega | null {
    const m = this.mega(Math.floor(x / MEGA_REGION), Math.floor(z / MEGA_REGION));
    if (!m) return null;
    const dx = (x - m.x) / m.rh;
    const dz = (z - m.z) / m.rh;
    const dy = (y - m.y) / m.rv;
    return dx * dx + dy * dy + dz * dz < 0.6 ? m : null;
  }

  /** Nearest mega-cavern centre (admin locate). */
  nearestMega(x: number, z: number, maxRegions = 12): { x: number; y: number; z: number } | null {
    const rx0 = Math.floor(x / MEGA_REGION);
    const rz0 = Math.floor(z / MEGA_REGION);
    let best: Mega | null = null;
    let bd = Infinity;
    for (let r = 0; r <= maxRegions; r++) {
      for (let rz = rz0 - r; rz <= rz0 + r; rz++)
        for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== r) continue;
          const m = this.mega(rx, rz);
          if (!m) continue;
          const d = (m.x - x) ** 2 + (m.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = m;
          }
        }
      if (best && (r + 1) * MEGA_REGION > Math.sqrt(bd)) break;
    }
    const found = best as Mega | null;
    return found ? { x: found.x, y: found.y, z: found.z } : null;
  }

  /** Nearest ravine centre (admin locate). */
  nearestRavine(x: number, z: number, maxRegions = 16): { x: number; z: number; floor: number } | null {
    const rx0 = Math.floor(x / RAVINE_REGION);
    const rz0 = Math.floor(z / RAVINE_REGION);
    let best: { x: number; z: number; floor: number } | null = null;
    let bd = Infinity;
    for (let r = 0; r <= maxRegions; r++) {
      for (let rz = rz0 - r; rz <= rz0 + r; rz++)
        for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== r) continue;
          const rv = this.ravine(rx, rz);
          if (!rv) continue;
          const mid = Math.floor(rv.pts.length / 4) * 2;
          const cx = rv.pts[mid]!;
          const cz = rv.pts[mid + 1]!;
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: Math.round(cx), z: Math.round(cz), floor: rv.floor };
          }
        }
      if (best && (r + 1) * RAVINE_REGION > Math.sqrt(bd)) break;
    }
    return best;
  }
}
