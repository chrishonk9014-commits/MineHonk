/**
 * The Nether: a sealed cavern world between bedrock floor and roof, with a
 * lava sea at y 31, five regular biomes plus the rare Ember Wastes, and
 * decoration (ores, glowstone, fungi forests, basalt deltas, vegetation)
 * replayed deterministically like the overworld pipeline.
 */
import { Chunk } from '../world/chunk';
import { Octave2, Octave3 } from '../math/noise';
import { Random, hash3, hashInts } from '../math/rng';
import { S, STATE_FLUID, STATE_SOLID } from '../registry/blocks';
import { biomeNum, biomeOf } from '../registry/biomes';
import { NoiseGrid } from './grid';
import { DecorView } from './decorate/view';
import { vein, weighted } from './decorate/features';
import { placeTree } from './features/trees';
import type { TreeKind } from '../data/biomes';
import { StructureManager } from './structures/manager';
import { NETHER_STRUCTURES } from './structures/nether';
import { ProtoCache, cloneChunk, addGenEntities, LATEST_GENERATOR, type DimensionGenerator, type GeneratorOptions, type SpawnPoint } from './pipeline';
import { connectChunk } from '../game/connections';

/** Top of the Nether (bedrock roof). */
export const NETHER_ROOF = 127;
export const NETHER_LAVA_LEVEL = 31;
const HEIGHT = 128;

interface NetherPalette {
  netherrack: number;
  bedrock: number;
  lava: number;
  soulSand: number;
  soulSoil: number;
  gravel: number;
  basalt: number;
  blackstone: number;
  magma: number;
  crimsonNylium: number;
  warpedNylium: number;
  smoldering: number;
}
let PAL: NetherPalette | undefined;
function pal(): NetherPalette {
  return (PAL ??= {
    netherrack: S('netherrack'),
    bedrock: S('bedrock'),
    lava: S('lava'),
    soulSand: S('soul_sand'),
    soulSoil: S('soul_soil'),
    gravel: S('gravel'),
    basalt: S('basalt'),
    blackstone: S('blackstone'),
    magma: S('magma_block'),
    crimsonNylium: S('crimson_nylium'),
    warpedNylium: S('warped_nylium'),
    smoldering: S('smoldering_netherrack'),
  });
}

interface BiomeIds {
  wastes: number;
  crimson: number;
  warped: number;
  soul: number;
  deltas: number;
  ember: number;
}
let BIDS: BiomeIds | undefined;
function bids(): BiomeIds {
  return (BIDS ??= {
    wastes: biomeNum('nether_wastes'),
    crimson: biomeNum('crimson_forest'),
    warped: biomeNum('warped_forest'),
    soul: biomeNum('soul_sand_valley'),
    deltas: biomeNum('basalt_deltas'),
    ember: biomeNum('ember_wastes'),
  });
}

export class NetherTerrain {
  private readonly main: Octave3;
  private readonly detail: Octave3;
  private readonly shelf: Octave2;
  private readonly biomeA: Octave2;
  private readonly biomeB: Octave2;
  private readonly rare: Octave2;
  private readonly beach: Octave2;
  private readonly grid = new NoiseGrid(4, 8, HEIGHT);
  private readonly vals = new Float32Array(16 * 16 * HEIGHT);

  constructor(readonly seed: number) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0x4e7e));
    this.main = new Octave3(r(1), 3, 56, 30);
    this.detail = new Octave3(r(2), 2, 24, 16);
    this.shelf = new Octave2(r(3), 2, 90);
    this.biomeA = new Octave2(r(4), 2, 220);
    this.biomeB = new Octave2(r(5), 2, 220);
    this.rare = new Octave2(r(6), 2, 300);
    this.beach = new Octave2(r(7), 2, 30);
  }

  biomeAt(x: number, z: number): number {
    const b = bids();
    if (this.rare.sample(x, z) > 0.52) return b.ember;
    const a = this.biomeA.sample(x, z);
    const c = this.biomeB.sample(x, z);
    // Voronoi in noise space; the wastes centre gets a head start
    const pts: [number, number, number, number][] = [
      [0, 0, b.wastes, -0.02],
      [0.28, 0.2, b.crimson, 0],
      [-0.28, 0.2, b.warped, 0],
      [0.24, -0.26, b.soul, 0],
      [-0.24, -0.26, b.deltas, 0],
    ];
    let best = b.wastes;
    let bestD = Infinity;
    for (const [px, pz, id, bonus] of pts) {
      const d = (a - px) ** 2 + (c - pz) ** 2 + bonus;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private density(x: number, y: number, z: number): number {
    let d = this.main.sample(x, y, z) * 1.3 + this.detail.sample(x, y, z) * 0.35 - 0.12;
    const shelf = this.shelf.sample(x, z);
    // Solid ground rising out of the lava sea, and a roof above ~y 100
    if (y < 50) d += ((50 - y) / 50) * (0.8 + shelf * 0.7);
    if (y > 100) d += ((y - 100) / 27) ** 2 * 2.2;
    return d;
  }

  generate(cx: number, cz: number): Chunk {
    const P = pal();
    const B = bids();
    const chunk = new Chunk(cx, cz, false);
    const bx = cx << 4;
    const bz = cz << 4;
    this.grid.fill(bx, bz, 0, HEIGHT, (x, y, z) => this.density(x, y, z), 1);
    this.grid.expand(this.vals);
    const v = this.vals;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = bx + x;
        const wz = bz + z;
        const biome = this.biomeAt(wx, wz);
        chunk.biomes[(z << 4) | x] = biome;
        for (let y = 0; y <= NETHER_ROOF; y++) {
          let st = 0;
          if (y === 0 || y === NETHER_ROOF) st = P.bedrock;
          else if (y < 5 && hash3(this.seed, wx, y, wz) % 5 >= y) st = P.bedrock;
          else if (y > NETHER_ROOF - 5 && hash3(this.seed ^ 0x55, wx, y, wz) % 5 >= NETHER_ROOF - y) st = P.bedrock;
          else if (v[(y * 16 + z) * 16 + x]! > 0) st = P.netherrack;
          else if (y <= NETHER_LAVA_LEVEL) st = P.lava;
          if (st) chunk.setRaw(x, y, z, st);
        }
        this.surface(chunk, x, z, wx, wz, biome, P, B);
      }
    }
    chunk.recomputeHeightmap();
    return chunk;
  }

  /** Surface rules: biome floor blocks, lava beaches and delta stone. */
  private surface(c: Chunk, x: number, z: number, wx: number, wz: number, biome: number, P: NetherPalette, B: BiomeIds): void {
    const beach = this.beach.sample(wx, wz);
    let depth = -1;
    for (let y = NETHER_ROOF - 5; y > 4; y--) {
      const s = c.get(x, y, z);
      if (s !== P.netherrack) {
        depth = -1;
        continue;
      }
      const above = c.get(x, y + 1, z);
      if (above === 0 || above === P.lava) depth = 0;
      else if (depth >= 0) depth++;
      const h = hash3(this.seed, wx, y, wz);
      if (biome === B.deltas) {
        // Deltas: basalt everywhere with blackstone veins
        c.setRaw(x, y, z, (h & 7) < 2 || beach > 0.3 ? P.blackstone : P.basalt);
        continue;
      }
      if (depth < 0 || depth > 3) continue;
      if (above === 0 && y >= NETHER_LAVA_LEVEL - 1 && y <= NETHER_LAVA_LEVEL + 3 && biome === B.wastes && Math.abs(beach) > 0.28) {
        c.setRaw(x, y, z, beach > 0 ? P.gravel : P.soulSand);
        continue;
      }
      if (biome === B.crimson && depth === 0 && above === 0) c.setRaw(x, y, z, P.crimsonNylium);
      else if (biome === B.warped && depth === 0 && above === 0) c.setRaw(x, y, z, P.warpedNylium);
      else if (biome === B.soul) c.setRaw(x, y, z, (h & 3) === 0 || beach > 0.2 ? P.soulSoil : P.soulSand);
      else if (biome === B.ember && depth <= 1 && above === 0) c.setRaw(x, y, z, (h & 3) === 0 ? P.magma : P.smoldering);
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------
interface NetherOre {
  block: string;
  size: number;
  count: number;
  minY: number;
  maxY: number;
  /** Never exposed to air (ancient debris). */
  hidden?: boolean;
}
const NETHER_ORES: NetherOre[] = [
  { block: 'gravel', size: 33, count: 2, minY: 5, maxY: 41 },
  { block: 'blackstone', size: 33, count: 2, minY: 5, maxY: 31 },
  { block: 'magma_block', size: 33, count: 2, minY: 27, maxY: 36 },
  { block: 'nether_quartz_ore', size: 14, count: 16, minY: 10, maxY: 117 },
  { block: 'nether_gold_ore', size: 10, count: 10, minY: 10, maxY: 117 },
  { block: 'cinder_ore', size: 6, count: 3, minY: 20, maxY: 100 },
  { block: 'ancient_debris', size: 3, count: 1, minY: 8, maxY: 22, hidden: true },
  { block: 'ancient_debris', size: 2, count: 1, minY: 8, maxY: 119, hidden: true },
];

let HOST: Uint8Array | undefined;
function hostTable(): Uint8Array {
  if (HOST) return HOST;
  HOST = new Uint8Array(65536);
  HOST[S('netherrack')] = 1;
  HOST[S('basalt')] = 2;
  HOST[S('blackstone')] = 2;
  return HOST;
}

function isOpen(s: number): boolean {
  return s === 0 || STATE_FLUID[s] === 1;
}

function netherOres(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  if (bx - 8 >= v.bx + 16 || bx + 24 <= v.bx || bz - 8 >= v.bz + 16 || bz + 24 <= v.bz) return;
  const host = hostTable();
  NETHER_ORES.forEach((rule, ri) => {
    const rng = new Random(hashInts(seed, ocx, ocz, 0x4e0 + ri));
    const st = S(rule.block);
    for (let n = 0; n < rule.count; n++) {
      const x = bx + rng.int(16);
      const z = bz + rng.int(16);
      const y = rule.minY + rng.int(rule.maxY - rule.minY);
      vein(v, rng, x, y, z, rule.size, (px, py, pz) => {
        const h = host[v.get(px, py, pz)]!;
        if (h === 0 || (h === 2 && !rule.hidden)) return;
        if (rule.hidden) {
          if (isOpen(v.proto(px + 1, py, pz)) || isOpen(v.proto(px - 1, py, pz)) || isOpen(v.proto(px, py + 1, pz)) || isOpen(v.proto(px, py - 1, pz)) || isOpen(v.proto(px, py, pz + 1)) || isOpen(v.proto(px, py, pz - 1))) return;
        }
        v.set(px, py, pz, st);
      });
    }
  });
}

/** Glowstone clusters hanging from cavern ceilings. */
function glowstone(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  if (bx - 8 >= v.bx + 16 || bx + 24 <= v.bx || bz - 8 >= v.bz + 16 || bz + 24 <= v.bz) return;
  const rng = new Random(hashInts(seed, ocx, ocz, 0x6105));
  const gs = S('glowstone');
  const tries = 6 + rng.int(6);
  for (let n = 0; n < tries; n++) {
    const x = bx + rng.int(16);
    const z = bz + rng.int(16);
    let y = 40 + rng.int(80);
    // climb to a ceiling
    let found = false;
    for (let k = 0; k < 24 && y < NETHER_ROOF - 2; k++, y++) {
      if (v.proto(x, y, z) === 0 && STATE_SOLID[v.proto(x, y + 1, z)]) {
        found = true;
        break;
      }
    }
    const strands = 8 + rng.int(18);
    for (let i = 0; i < strands; i++) {
      const dx = rng.int(7) - 3;
      const dz = rng.int(7) - 3;
      const len = 1 + rng.int(Math.max(1, 5 - Math.max(Math.abs(dx), Math.abs(dz))));
      if (!found) continue;
      // each strand hangs from the ceiling above its column
      let top = y;
      while (top < NETHER_ROOF - 1 && v.proto(x + dx, top + 1, z + dz) === 0) top++;
      if (top - y > 4) continue;
      for (let l = 0; l < len; l++) {
        const yy = top - l;
        if (v.proto(x + dx, yy, z + dz) !== 0) break;
        v.set(x + dx, yy, z + dz, gs);
      }
    }
  }
}

/** Finds a floor (solid with 2 air above) scanning down from `y`; -1 if none within range. */
function floorBelow(v: DecorView, x: number, y: number, z: number, range: number): number {
  for (let k = 0; k < range && y > NETHER_LAVA_LEVEL; k++, y--) {
    const s = v.proto(x, y, z);
    if (STATE_SOLID[s] && !STATE_FLUID[s] && v.proto(x, y + 1, z) === 0 && v.proto(x, y + 2, z) === 0) return y;
  }
  return -1;
}

/** Huge fungi in crimson and warped forests. */
function fungi(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  const biome = biomeOf(v.biome(bx + 8, bz + 8));
  if (!biome.trees?.length) return;
  const rng = new Random(hashInts(seed, ocx, ocz, 0xf0f1));
  const count = Math.floor(biome.treeDensity ?? 0);
  const P = pal();
  for (let i = 0; i < count; i++) {
    const x = bx + rng.int(16);
    const z = bz + rng.int(16);
    const startY = 36 + rng.int(84);
    const kind = weighted(biome.trees, rng).kind as TreeKind;
    if (x + 4 < v.bx || x - 4 >= v.bx + 16 || z + 4 < v.bz || z - 4 >= v.bz + 16) continue;
    const y = floorBelow(v, x, startY, z, 40);
    if (y < 0) continue;
    const ground = v.proto(x, y, z);
    if (ground !== P.crimsonNylium && ground !== P.warpedNylium && ground !== P.netherrack) continue;
    placeTree(
      { getState: (a, b, c) => v.proto(a, b, c), current: (a, b, c) => v.get(a, b, c) },
      (a, b, c, s) => v.set(a, b, c, s),
      new Random(hashInts(seed, x, y, z, 0xf7)),
      kind,
      x,
      y + 1,
      z,
    );
  }
}

/** Basalt deltas: lava pools rimmed by magma and basalt columns. */
function deltas(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  if (v.biome(bx + 8, bz + 8) !== bids().deltas) return;
  if (bx - 8 >= v.bx + 16 || bx + 24 <= v.bx || bz - 8 >= v.bz + 16 || bz + 24 <= v.bz) return;
  const rng = new Random(hashInts(seed, ocx, ocz, 0xde17));
  const P = pal();
  // Pools
  for (let n = 0; n < 3; n++) {
    const x = bx + rng.int(16);
    const z = bz + rng.int(16);
    const y = floorBelow(v, x, 40 + rng.int(60), z, 40);
    const r = 2 + rng.int(4);
    if (y < 0) continue;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r + 0.5) continue;
        const px = x + dx;
        const pz = z + dz;
        if (!STATE_SOLID[v.proto(px, y, pz)] || v.proto(px, y + 1, pz) !== 0) continue;
        const enclosed = STATE_SOLID[v.proto(px + 1, y, pz)] && STATE_SOLID[v.proto(px - 1, y, pz)] && STATE_SOLID[v.proto(px, y, pz + 1)] && STATE_SOLID[v.proto(px, y, pz - 1)] && STATE_SOLID[v.proto(px, y - 1, pz)];
        if (d < r - 0.5 && enclosed) v.set(px, y, pz, P.lava);
        else v.set(px, y, pz, P.magma);
      }
  }
  // Columns
  for (let n = 0; n < 4; n++) {
    const x = bx + rng.int(16);
    const z = bz + rng.int(16);
    const y = floorBelow(v, x, 40 + rng.int(70), z, 40);
    const h = 1 + rng.int(rng.chance(0.2) ? 12 : 5);
    const w = rng.int(2);
    if (y < 0) continue;
    for (let dx = 0; dx <= w; dx++)
      for (let dz = 0; dz <= w; dz++)
        for (let i = 1; i <= h; i++) {
          if (v.proto(x + dx, y + i, z + dz) !== 0) break;
          v.set(x + dx, y + i, z + dz, P.basalt);
        }
  }
}

/** Column-local ground cover: roots, sprouts, fungi, fire and vines. */
function netherVegetation(v: DecorView, seed: number, cx: number, cz: number): void {
  const B = bids();
  const P = pal();
  const st = {
    crimsonRoots: S('crimson_roots'),
    warpedRoots: S('warped_roots'),
    sprouts: S('nether_sprouts'),
    crimsonFungus: S('crimson_fungus'),
    warpedFungus: S('warped_fungus'),
    fire: S('fire'),
    soulFire: S('soul_fire'),
    brown: S('brown_mushroom'),
    red: S('red_mushroom'),
    twisting: S('twisting_vines'),
    weeping: S('weeping_vines'),
  };
  const bx = cx << 4;
  const bz = cz << 4;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const wx = bx + x;
      const wz = bz + z;
      const biome = v.biome(wx, wz);
      for (let y = NETHER_LAVA_LEVEL; y < NETHER_ROOF - 5; y++) {
        const s = v.get(wx, y, wz);
        const above = v.get(wx, y + 1, wz);
        const h = hash3(seed ^ 0x7e9, wx, y, wz);
        const r = (h & 0xffff) / 65536;
        if (above === 0 && STATE_SOLID[s]) {
          if (biome === B.crimson && s === P.crimsonNylium) {
            if (r < 0.1) v.set(wx, y + 1, wz, st.crimsonRoots);
            else if (r < 0.125) v.set(wx, y + 1, wz, st.crimsonFungus);
            else if (r < 0.13) v.set(wx, y + 1, wz, st.warpedFungus);
          } else if (biome === B.warped && s === P.warpedNylium) {
            if (r < 0.08) v.set(wx, y + 1, wz, st.warpedRoots);
            else if (r < 0.14) v.set(wx, y + 1, wz, st.sprouts);
            else if (r < 0.16) v.set(wx, y + 1, wz, st.warpedFungus);
            else if (r < 0.17) {
              const len = 1 + ((h >>> 16) % 8);
              for (let i = 1; i <= len && v.get(wx, y + i, wz) === 0; i++) v.set(wx, y + i, wz, st.twisting);
            }
          } else if (biome === B.wastes && s === P.netherrack) {
            if (r < 0.004) v.set(wx, y + 1, wz, st.fire);
            else if (r < 0.007) v.set(wx, y + 1, wz, (h >>> 20) & 1 ? st.brown : st.red);
          } else if (biome === B.soul && s === P.soulSoil) {
            if (r < 0.006) v.set(wx, y + 1, wz, st.soulFire);
          } else if (biome === B.ember && (s === P.smoldering || s === P.netherrack)) {
            if (r < 0.02) v.set(wx, y + 1, wz, st.fire);
          }
        }
        // Weeping vines from crimson ceilings
        if (biome === B.crimson && s === 0 && STATE_SOLID[above] && (above === P.netherrack || above === S('nether_wart_block')) && r < 0.03) {
          const len = 1 + ((h >>> 16) % 6);
          for (let i = 0; i < len && v.get(wx, y - i, wz) === 0; i++) v.set(wx, y - i, wz, st.weeping);
        }
      }
    }
}

type Stage = (v: DecorView, seed: number, ocx: number, ocz: number) => void;
const NETHER_STAGES: Stage[] = [netherOres, deltas, glowstone, fungi];

export class NetherGenerator implements DimensionGenerator {
  readonly dimension = 'nether' as const;
  readonly terrain: NetherTerrain;
  readonly structures: StructureManager;
  private readonly protos: ProtoCache;

  /** World generator version. */
  readonly version: number;

  constructor(
    readonly seed: number,
    opts: GeneratorOptions = {},
  ) {
    this.version = opts.version ?? LATEST_GENERATOR;
    this.terrain = new NetherTerrain(seed);
    this.protos = new ProtoCache(400, (cx, cz) => this.terrain.generate(cx, cz));
    this.structures = new StructureManager(
      seed,
      NETHER_STRUCTURES,
      {
        seed,
        groundY: (x, z) => this.floorNear(x, 64, z),
        isWater: () => false,
        biome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
        estimateHeight: () => 64,
        estimateBiome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
      },
      () => opts.structures !== false,
    );
  }

  /** Nearest floor to `y` at a column in pure terrain (-1 if none). */
  floorNear(x: number, y: number, z: number): number {
    const c = this.protos.get(x >> 4, z >> 4);
    const lx = x & 15;
    const lz = z & 15;
    for (let d = 0; d < 90; d++) {
      for (const yy of [y - d, y + d]) {
        if (yy <= NETHER_LAVA_LEVEL || yy >= NETHER_ROOF - 3) continue;
        const s = c.get(lx, yy, lz);
        if (STATE_SOLID[s] && !STATE_FLUID[s] && c.get(lx, yy + 1, lz) === 0 && c.get(lx, yy + 2, lz) === 0) return yy;
      }
    }
    return -1;
  }

  generate(cx: number, cz: number): Chunk {
    const proto = this.protos.get(cx, cz);
    const c = cloneChunk(proto);
    const v = new DecorView(c, (x, z) => this.protos.get(x, z));
    for (const stage of NETHER_STAGES) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) stage(v, this.seed, cx + dx, cz + dz);
    }
    const starts = this.structures.build(v);
    netherVegetation(v, this.seed, cx, cz);
    // V4: fortress fences and other connecting blocks take their proper shapes
    if (this.version >= 4) connectChunk(c, { getState: (x, y, z) => v.get(x, y, z) }, (x, y, z, st) => v.set(x, y, z, st));
    c.recount();
    c.recomputeHeightmap();
    for (const s of starts) addGenEntities(c, s);
    return c;
  }

  findSpawn(): SpawnPoint {
    for (let r = 0; r < 512; r += 8) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 8) * Math.PI * 2) * r);
        const y = this.floorNear(x, 64, z);
        if (y > 0) return { x, y: y + 1, z };
      }
    }
    return { x: 0, y: 64, z: 0 };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.biomeAt(x, z);
  }

  structureAt(x: number, y: number, z: number): string | null {
    return this.structures.structureAt(x, y, z);
  }

  structureTypes(): string[] {
    return [...this.structures.typeIds()];
  }

  *locateSteps(type: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null> {
    const s = yield* this.structures.nearestSteps(type, x, z);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  locate(type: string, x: number, z: number): { x: number; y: number; z: number } | null {
    const s = this.structures.nearest(type, x, z, 10);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }
}
