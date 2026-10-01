/**
 * The Farlands: the world past the point where terrain maths overflows.
 * Towering layered "overflow walls" cut by holes, plains stretched to a
 * thousand blocks along one axis, shattered floating shards, humming
 * static fields and null forests, over farstone full of glitch and null
 * ores. Decoration replays deterministically like the other dimensions.
 */
import { Chunk } from '../world/chunk';
import { Octave2, Octave3, smoothstep } from '../math/noise';
import { Random, hash3, hashInts } from '../math/rng';
import { S, STATE_SOLID, STATE_FLUID } from '../registry/blocks';
import { biomeNum, biomeOf } from '../registry/biomes';
import { NoiseGrid } from './grid';
import { DecorView } from './decorate/view';
import { vein, trees } from './decorate/features';
import { StructureManager } from './structures/manager';
import { FARLANDS_STRUCTURES } from './structures/farlands';
import { ProtoCache, cloneChunk, addGenEntities, LATEST_GENERATOR, type DimensionGenerator, type GeneratorOptions, type SpawnPoint } from './pipeline';
import { ErrorArenas } from './farlandsArena';

const WATER_LEVEL = 62;
const TOP = 208;

interface FarBiomes {
  walls: number;
  plains: number;
  shattered: number;
  staticFields: number;
  nullForest: number;
}
let FB: FarBiomes | undefined;
function fb(): FarBiomes {
  return (FB ??= {
    walls: biomeNum('overflow_walls'),
    plains: biomeNum('stretched_plains'),
    shattered: biomeNum('shattered_expanse'),
    staticFields: biomeNum('static_fields'),
    nullForest: biomeNum('null_forest'),
  });
}

interface FarPalette {
  farstone: number;
  corrupted: number;
  overflow: number;
  grass: number;
  dirt: number;
  sand: number;
  staticBlock: number;
  water: number;
  bedrock: number;
}
let FP: FarPalette | undefined;
function fp(): FarPalette {
  return (FP ??= {
    farstone: S('farstone'),
    corrupted: S('corrupted_stone'),
    overflow: S('overflow_stone'),
    grass: S('far_grass_block'),
    dirt: S('far_dirt'),
    sand: S('stretched_sand'),
    staticBlock: S('static_block'),
    water: S('water'),
    bedrock: S('bedrock'),
  });
}

export class FarlandsTerrain {
  private readonly cont: Octave2;
  private readonly hills: Octave2;
  private readonly detail: Octave2;
  private readonly biomeA: Octave2;
  private readonly biomeB: Octave2;
  private readonly rare: Octave2;
  private readonly wall: Octave2;
  private readonly stretch: Octave2;
  private readonly over: Octave3;
  private readonly shard: Octave3;
  private readonly cave: Octave3;
  private readonly holes: Octave3;
  private readonly overGrid = new NoiseGrid(4, 8, TOP);
  private readonly overVals = new Float32Array(16 * 16 * TOP);
  private readonly holeGrid = new NoiseGrid(4, 4, TOP);
  private readonly holeVals = new Float32Array(16 * 16 * TOP);
  private readonly caveGrid = new NoiseGrid(4, 4, TOP);
  private readonly caveVals = new Float32Array(16 * 16 * TOP);
  private readonly heights = new Float32Array(256);
  private readonly weights = new Float32Array(256);

  constructor(readonly seed: number) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0xfa41));
    this.cont = new Octave2(r(1), 3, 420);
    this.hills = new Octave2(r(2), 3, 90);
    this.detail = new Octave2(r(3), 2, 22);
    this.biomeA = new Octave2(r(4), 2, 320);
    this.biomeB = new Octave2(r(5), 2, 320);
    this.rare = new Octave2(r(6), 2, 520);
    this.wall = new Octave2(r(7), 2, 280);
    this.stretch = new Octave2(r(8), 2, 40);
    this.over = new Octave3(r(9), 2, 60, 18);
    this.shard = new Octave3(r(10), 2, 36, 22);
    this.cave = new Octave3(r(11), 2, 64, 32);
    this.holes = new Octave3(r(12), 2, 28, 14);
  }

  /** 0..1: how strongly the overflow walls take over the column. */
  wallWeight(x: number, z: number): number {
    return smoothstep(0.18, 0.34, this.wall.sample(x, z));
  }

  biomeAt(x: number, z: number): number {
    const b = fb();
    if (this.wallWeight(x, z) > 0.5) return b.walls;
    if (this.rare.sample(x, z) > 0.5) return b.staticFields;
    if (this.biomeA.sample(x, z) > 0.18) return b.nullForest;
    if (this.biomeB.sample(x, z) > 0.12) return b.shattered;
    return b.plains;
  }

  heightAt(x: number, z: number, biome: number): number {
    const b = fb();
    const c = this.cont.sample(x, z);
    if (biome === b.plains) return 66 + c * 6 + this.stretch.sample(x / 8, z * 3) * 6;
    if (biome === b.staticFields) return 67 + c * 3;
    if (biome === b.shattered) return 58 + c * 10 + this.hills.sample(x, z) * 6;
    return 68 + c * 18 + this.hills.sample(x, z) * (biome === b.nullForest ? 12 : 8) + this.detail.sample(x, z) * 2;
  }

  /** Cheap surface estimate (no 3D noise) for structure planning and spawn search. */
  estimateHeight(x: number, z: number): number {
    return Math.round(this.heightAt(x, z, this.biomeAt(x, z)));
  }

  generate(cx: number, cz: number): Chunk {
    const P = fp();
    const B = fb();
    const c = new Chunk(cx, cz, true);
    const bx = cx << 4;
    const bz = cz << 4;
    let anyWall = false;
    let maxH = WATER_LEVEL;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const i = (z << 4) | x;
        const biome = this.biomeAt(bx + x, bz + z);
        c.biomes[i] = biome;
        this.heights[i] = this.heightAt(bx + x, bz + z, biome);
        this.weights[i] = this.wallWeight(bx + x, bz + z);
        if (this.weights[i]! >= 0.5) anyWall = true;
        maxH = Math.max(maxH, Math.ceil(this.heights[i]!));
      }
    // Overflow walls: slabs stretched along z, layered with height and holed through
    if (anyWall) {
      this.overGrid.fill(bx, bz, 0, TOP, (x, y, z) => this.over.sample(x * 2.4, y * 0.6, z * 0.22), 0);
      this.overGrid.expand(this.overVals);
      this.holeGrid.fill(bx, bz, 0, TOP, (x, y, z) => this.holes.sample(x, y, z), 0);
      this.holeGrid.expand(this.holeVals);
    }
    this.caveGrid.fill(bx, bz, 0, maxH, (x, y, z) => this.cave.sample(x, y, z), 1);
    this.caveGrid.expand(this.caveVals);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const i = (z << 4) | x;
        const wx = bx + x;
        const wz = bz + z;
        const h = Math.floor(this.heights[i]!);
        const wall = this.weights[i]! >= 0.5;
        const biome = c.biomes[i]!;
        const wallTop = 150 + Math.floor(this.detail.sample(wx, wz) * 24 + this.weights[i]! * 30);
        const maxY = wall ? Math.min(TOP - 1, wallTop) : Math.max(h, WATER_LEVEL);
        for (let y = 0; y <= maxY; y++) {
          const k = (y * 16 + z) * 16 + x;
          let solid = y <= h;
          if (wall && y > h - 12) {
            const band = (((this.overVals[k]! * 1.7 + y / 72) % 1) + 1) % 1;
            solid = (y <= wallTop && band < 0.5 && this.holeVals[k]! < 0.32) || y <= h - 12;
          }
          if (solid && y > 5 && y < h - 3 && Math.abs(this.caveVals[k]!) < 0.05) solid = false;
          let st = 0;
          if (y === 0 || (y < 4 && hash3(this.seed ^ 0xbed, wx, y, wz) % 4 >= y)) st = P.bedrock;
          else if (solid) st = wall && y > h - 12 && y % 16 === 7 ? P.overflow : P.farstone;
          else if (y <= WATER_LEVEL && y > h) st = P.water;
          if (st) c.setRaw(x, y, z, st);
        }
        // Floating shards over the shattered expanse
        if (biome === B.shattered) {
          for (let y = 84; y < 150; y++) if (this.shard.sample(wx, y, wz) > 0.42 + ((y - 115) / 35) ** 2 * 0.3) c.setRaw(x, y, z, P.corrupted);
        }
        this.surface(c, x, z, wx, wz, biome, wall, P, B);
      }
    c.recomputeHeightmap();
    return c;
  }

  private surface(c: Chunk, x: number, z: number, wx: number, wz: number, biome: number, wall: boolean, P: FarPalette, B: FarBiomes): void {
    const def = biomeOf(biome);
    const top = S(def.surface?.top ?? 'far_grass_block');
    const filler = S(def.surface?.filler ?? 'far_dirt');
    const depthMax = def.surface?.depth ?? 3;
    let depth = -1;
    for (let y = TOP - 1; y > 0; y--) {
      const s = c.get(x, y, z);
      if (s !== P.farstone && s !== P.overflow) {
        depth = -1;
        continue;
      }
      const above = c.get(x, y + 1, z);
      if (above === 0 || above === P.water) depth = 0;
      else if (depth >= 0) depth++;
      if (depth < 0 || depth >= depthMax) continue;
      // Walls keep bare stone except their very top
      if (wall && y < c.getHeight(x, z) - 1 && y > this.heights[(z << 4) | x]! + 2) continue;
      const underwater = above === P.water || y < WATER_LEVEL;
      if (underwater) {
        if (depth === 0) c.setRaw(x, y, z, biome === B.plains ? P.sand : P.dirt);
        continue;
      }
      // Sand streaks along the stretched plains
      if (biome === B.plains && y <= WATER_LEVEL + 2 && this.stretch.sample(wx * 0.5, wz * 4) > 0.3) {
        c.setRaw(x, y, z, P.sand);
        continue;
      }
      c.setRaw(x, y, z, depth === 0 ? top : filler);
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------
const FAR_ORES: { block: string; size: number; count: number; minY: number; maxY: number }[] = [
  { block: 'far_dirt', size: 30, count: 6, minY: 10, maxY: 140 },
  { block: 'corrupted_stone', size: 40, count: 4, minY: 5, maxY: 120 },
  { block: 'coal_ore', size: 17, count: 14, minY: 20, maxY: 180 },
  { block: 'iron_ore', size: 9, count: 12, minY: 5, maxY: 110 },
  { block: 'gold_ore', size: 9, count: 3, minY: 5, maxY: 50 },
  { block: 'diamond_ore', size: 7, count: 3, minY: 5, maxY: 24 },
  { block: 'glitch_ore', size: 5, count: 4, minY: 5, maxY: 64 },
  { block: 'null_ore', size: 4, count: 2, minY: 5, maxY: 36 },
];

function farOres(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  if (bx - 8 >= v.bx + 16 || bx + 24 <= v.bx || bz - 8 >= v.bz + 16 || bz + 24 <= v.bz) return;
  const P = fp();
  FAR_ORES.forEach((rule, ri) => {
    const rng = new Random(hashInts(seed, ocx, ocz, 0xfa0 + ri));
    const st = S(rule.block);
    for (let n = 0; n < rule.count; n++) {
      const x = bx + rng.int(16);
      const z = bz + rng.int(16);
      const y = rule.minY + rng.int(rule.maxY - rule.minY);
      vein(v, rng, x, y, z, rule.size, (px, py, pz) => {
        const s = v.get(px, py, pz);
        if (s === P.farstone || s === P.overflow) v.set(px, py, pz, st);
      });
    }
  });
}

/** Column-local: glitch grass, data crystals, static pillars, fractal glass. */
function farVegetation(v: DecorView, seed: number, cx: number, cz: number): void {
  const B = fb();
  const P = fp();
  const st = {
    tall: S('far_tall_grass'),
    crystal: S('data_crystal'),
    glitch: S('glitch_block'),
    fractal: S('fractal_glass'),
    missing: S('missing_block'),
  };
  const bx = cx << 4;
  const bz = cz << 4;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const wx = bx + x;
      const wz = bz + z;
      const y = v.height(wx, wz) - 1;
      if (y < 1 || y > TOP) continue;
      const s = v.get(wx, y, wz);
      if (v.get(wx, y + 1, wz) !== 0 || STATE_FLUID[s] || !STATE_SOLID[s]) continue;
      const biome = v.biome(wx, wz);
      const h = hash3(seed ^ 0xfae, wx, y, wz);
      const r = (h & 0xffff) / 65536;
      const density = biomeOf(biome).grassDensity ?? 0.12;
      if (s === P.grass && r < density) v.set(wx, y + 1, wz, st.tall);
      else if (r > 0.9985) v.set(wx, y + 1, wz, st.crystal);
      else if (biome === B.staticFields && r > 0.994) {
        const len = 2 + ((h >>> 16) % 7);
        for (let i = 1; i <= len; i++) v.set(wx, y + i, wz, i === len ? st.glitch : P.staticBlock);
      } else if (biome === B.shattered && r > 0.992) v.set(wx, y + 1, wz, st.fractal);
      else if (r > 0.9995) v.set(wx, y + 1, wz, st.missing);
    }
}

type Stage = (v: DecorView, seed: number, ocx: number, ocz: number) => void;
const FAR_STAGES: Stage[] = [farOres, trees];

export class FarlandsGenerator implements DimensionGenerator {
  readonly dimension = 'farlands' as const;
  readonly terrain: FarlandsTerrain;
  readonly structures: StructureManager;
  /** V3: The Error's arenas (null in worlds made before V3). */
  readonly arenas: ErrorArenas | null;
  private readonly protos: ProtoCache;

  constructor(
    readonly seed: number,
    opts: GeneratorOptions = {},
  ) {
    this.terrain = new FarlandsTerrain(seed);
    this.arenas = (opts.version ?? LATEST_GENERATOR) >= 3 ? new ErrorArenas(seed, (x, z) => this.terrain.estimateHeight(x, z)) : null;
    this.protos = new ProtoCache(400, (cx, cz) => {
      const c = this.terrain.generate(cx, cz);
      if (this.arenas) {
        this.arenas.apply(c, cx << 4, cz << 4);
        c.recomputeHeightmap();
      }
      return c;
    });
    const ground = (x: number, z: number): number => {
      // Nothing gets built in an arena's chasm
      if (this.arenas?.inChasm(x, z)) return -999;
      const c = this.protos.get(x >> 4, z >> 4);
      let y = c.getHeight(x & 15, z & 15) - 1;
      while (y > 0 && (c.get(x & 15, y, z & 15) === 0 || STATE_FLUID[c.get(x & 15, y, z & 15)])) y--;
      return y;
    };
    this.structures = new StructureManager(
      seed,
      FARLANDS_STRUCTURES,
      {
        seed,
        groundY: ground,
        isWater: (x, z) => {
          const c = this.protos.get(x >> 4, z >> 4);
          const top = c.getHeight(x & 15, z & 15) - 1;
          return STATE_FLUID[c.get(x & 15, top, z & 15)] === 1;
        },
        biome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
        estimateHeight: (x, z) => this.terrain.estimateHeight(x, z),
        estimateBiome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
      },
      () => opts.structures !== false,
    );
  }

  generate(cx: number, cz: number): Chunk {
    const c = cloneChunk(this.protos.get(cx, cz));
    const v = new DecorView(c, (x, z) => this.protos.get(x, z));
    for (const stage of FAR_STAGES) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) stage(v, this.seed, cx + dx, cz + dz);
    const starts = this.structures.build(v);
    farVegetation(v, this.seed, cx, cz);
    c.recount();
    c.recomputeHeightmap();
    for (const s of starts) addGenEntities(c, s);
    return c;
  }

  findSpawn(): SpawnPoint {
    for (let r = 0; r < 2000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 8) * Math.PI * 2) * r);
        if (this.terrain.wallWeight(x, z) > 0.05) continue;
        const h = this.terrain.estimateHeight(x, z);
        if (h > WATER_LEVEL + 1) return { x, y: h + 1, z };
      }
    }
    return { x: 0, y: 90, z: 0 };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.biomeAt(x, z);
  }

  structureAt(x: number, y: number, z: number): string | null {
    return this.structures.structureAt(x, y, z);
  }

  structureTypes(): string[] {
    return [...this.structures.typeIds(), ...(this.arenas ? ['error_arena'] : [])];
  }

  *locateSteps(type: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null> {
    if (type === 'error_arena') return this.locate(type, x, z);
    const s = yield* this.structures.nearestSteps(type, x, z);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  locate(type: string, x: number, z: number): { x: number; y: number; z: number } | null {
    if (type === 'error_arena') {
      const a = this.arenas?.nearest(x, z);
      return a ? { x: a.x, y: a.y, z: a.z } : null;
    }
    const s = this.structures.nearest(type, x, z, 10);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }
}
