/**
 * Overworld terrain (proto-chunk) generation: density fill, surface rules,
 * bedrock/deepslate layering and noise caves. Decoration (ores, trees,
 * structures...) happens later in the generation pipeline.
 */
import { Chunk } from '../world/chunk';
import { SEA_LEVEL, WORLD_HEIGHT } from '../world/constants';
import { Octave2, Octave3, smoothstep } from '../math/noise';
import { Random, hash3, hashInts } from '../math/rng';
import { S, stateOf } from '../registry/blocks';
import { biomeOf } from '../registry/biomes';
import { NoiseGrid } from './grid';
import { B, OverworldClimate, newClimate, type Climate } from './climate';
import { CaveBiomeSource } from './caves/caveBiomes';
import { CaveCarver } from './caves/carver';

interface Palette {
  stone: number;
  water: number;
  lava: number;
  air: number;
  caveAir: number;
  bedrock: number;
  deepslate: number;
  dirt: number;
  grass: number;
  grassSnowy: number;
  sand: number;
  sandstone: number;
  redSand: number;
  gravel: number;
  clay: number;
  snowBlock: number;
  packedIce: number;
  terracotta: number;
  bands: number[];
}

let P: Palette | undefined;
function palette(): Palette {
  if (P) return P;
  const bandColors = ['orange', 'terracotta', 'yellow', 'brown', 'terracotta', 'red', 'white', 'terracotta', 'light_gray', 'orange', 'terracotta', 'red', 'brown', 'terracotta', 'yellow', 'terracotta'];
  P = {
    stone: S('stone'),
    water: S('water'),
    lava: S('lava'),
    air: 0,
    caveAir: S('cave_air'),
    bedrock: S('bedrock'),
    deepslate: S('deepslate'),
    dirt: S('dirt'),
    grass: S('grass_block'),
    grassSnowy: stateOf('grass_block', { snowy: true }),
    sand: S('sand'),
    sandstone: S('sandstone'),
    redSand: S('red_sand'),
    gravel: S('gravel'),
    clay: S('clay'),
    snowBlock: S('snow_block'),
    packedIce: S('packed_ice'),
    terracotta: S('terracotta'),
    bands: bandColors.map((c) => S(c === 'terracotta' ? 'terracotta' : c + '_terracotta')),
  };
  return P;
}

export interface ProtoColumn {
  climate: Climate;
  surface: number;
}

export class OverworldTerrain {
  readonly climate: OverworldClimate;
  private readonly overhang: Octave3;
  private readonly cheese: Octave3;
  private readonly spagA: Octave3;
  private readonly spagB: Octave3;
  private readonly spagWidth: Octave3;
  private readonly entrance: Octave2;
  private readonly clayN: Octave2;
  private readonly bandOffset: Octave2;
  private readonly surfaceN: Octave2;

  // scratch buffers
  private readonly climates: Climate[] = [];
  private readonly heights = new Float32Array(18 * 18);
  private readonly amps = new Float32Array(256);
  private readonly overGrid = new NoiseGrid(4, 8, WORLD_HEIGHT);
  private readonly overVals = new Float32Array(16 * 16 * WORLD_HEIGHT);
  private readonly caveGrids = [new NoiseGrid(4, 4, 136), new NoiseGrid(4, 4, 136), new NoiseGrid(4, 4, 136), new NoiseGrid(4, 4, 136)];
  private readonly caveVals = [new Float32Array(16 * 16 * 136), new Float32Array(16 * 16 * 136), new Float32Array(16 * 16 * 136), new Float32Array(16 * 16 * 136)];

  /** V2 underground (null for worlds made with the V1 generator). */
  readonly caveBiomes: CaveBiomeSource | null;
  readonly carver: CaveCarver | null;
  private readonly temps = new Float32Array(256);

  constructor(
    readonly seed: number,
    readonly version = 2,
  ) {
    this.caveBiomes = version >= 2 ? new CaveBiomeSource(seed) : null;
    this.carver = this.caveBiomes ? new CaveCarver(seed, this.caveBiomes) : null;
    this.climate = new OverworldClimate(seed);
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0x7e44a1));
    this.overhang = new Octave3(r(1), 3, 90, 64);
    this.cheese = new Octave3(r(2), 2, 80, 44);
    this.spagA = new Octave3(r(3), 2, 56, 36);
    this.spagB = new Octave3(r(4), 2, 56, 36);
    this.spagWidth = new Octave3(r(5), 1, 120, 80);
    this.entrance = new Octave2(r(6), 2, 180);
    this.clayN = new Octave2(r(7), 2, 24);
    this.bandOffset = new Octave2(r(8), 2, 90);
    this.surfaceN = new Octave2(r(9), 2, 16);
    for (let i = 0; i < 256; i++) this.climates.push(newClimate());
  }

  /** Cheap estimate of surface height (no 3D noise), used for spawn search and structures. */
  estimateHeight(x: number, z: number): number {
    const cl = newClimate();
    this.climate.sample(x, z, cl);
    return Math.round(cl.height);
  }

  estimateBiome(x: number, z: number): number {
    const cl = newClimate();
    this.climate.sample(x, z, cl);
    return this.climate.biomeAt(cl, Math.round(cl.height), 0);
  }

  generate(cx: number, cz: number): Chunk {
    const pal = palette();
    const chunk = new Chunk(cx, cz, true);
    const bx = cx << 4;
    const bz = cz << 4;
    const scratch = newClimate();

    // 1. Climate + 2D heights (with one column border for slopes).
    let maxTop = SEA_LEVEL;
    for (let z = -1; z <= 16; z++) {
      for (let x = -1; x <= 16; x++) {
        const inside = x >= 0 && x < 16 && z >= 0 && z < 16;
        const cl = inside ? this.climates[(z << 4) | x]! : scratch;
        this.climate.sample(bx + x, bz + z, cl);
        this.heights[(z + 1) * 18 + (x + 1)] = cl.height;
        if (inside) {
          this.amps[(z << 4) | x] = cl.amp;
          const top = cl.height + cl.amp * 0.5 + 4;
          if (top > maxTop) maxTop = top;
        }
      }
    }
    maxTop = Math.min(WORLD_HEIGHT - 2, Math.ceil(maxTop));

    // 2. 3D overhang noise
    this.overGrid.fill(bx, bz, 0, maxTop, (x, y, z) => this.overhang.sample(x, y, z), 0);
    this.overGrid.expand(this.overVals);

    // 3. Fill stone / water
    const ov = this.overVals;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const ci = (z << 4) | x;
        const h = this.heights[(z + 1) * 18 + (x + 1)]!;
        const amp = this.amps[ci]!;
        for (let y = 0; y <= maxTop; y++) {
          let state: number;
          const d = h - y + ov[(y * 16 + z) * 16 + x]! * amp * 2.2;
          if (d > 0) state = pal.stone;
          else if (y <= SEA_LEVEL) state = pal.water;
          else continue;
          chunk.setRaw(x, y, z, state);
        }
      }
    }

    // 4. Surface rules & biomes
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        this.surfaceColumn(chunk, x, z, bx, bz, pal, maxTop);
      }
    }

    // 5. Caves
    if (this.carver) {
      for (let i = 0; i < 256; i++) this.temps[i] = this.climates[i]!.t;
      this.carver.carve(chunk, bx, bz, this.temps, this.carveStates(pal));
    } else this.carveCaves(chunk, bx, bz, pal);

    // 6. Bedrock & deepslate
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = bx + x;
        const wz = bz + z;
        chunk.setRaw(x, 0, z, pal.bedrock);
        for (let y = 1; y < 5; y++) {
          if (hash3(this.seed ^ 0xbed, wx, y, wz) % 5 >= y) chunk.setRaw(x, y, z, pal.bedrock);
        }
        if (this.carver) {
          // V2: a thicker deepslate layer fading out between y 20 and 30
          for (let y = 1; y < 30; y++) {
            const s = chunk.get(x, y, z);
            if (s !== pal.stone) continue;
            if (y < 20 || hash3(this.seed ^ 0xdee9, wx, y, wz) % 10 < 30 - y) chunk.setRaw(x, y, z, pal.deepslate);
          }
        } else
          for (let y = 1; y < 18; y++) {
            const s = chunk.get(x, y, z);
            if (s !== pal.stone) continue;
            if (y < 8 || hash3(this.seed ^ 0xdee9, wx, y, wz) % 10 < 18 - y) chunk.setRaw(x, y, z, pal.deepslate);
          }
      }
    }

    chunk.recomputeHeightmap();
    return chunk;
  }

  private carveStatesCache: import('./caves/carver').CarveStates | undefined;
  private carveStates(pal: Palette): import('./caves/carver').CarveStates {
    return (this.carveStatesCache ??= { water: pal.water, lava: pal.lava, caveAir: pal.caveAir, solid: (s) => isSolidTerrain(s, pal) });
  }

  /** Cave biome at a position (V2 worlds), None above the ground or in V1 worlds. */
  caveBiomeAt(x: number, y: number, z: number): number {
    if (!this.caveBiomes) return 0;
    const cl = newClimate();
    this.climate.sample(x, z, cl);
    if (y > cl.height - 6) return 0;
    return this.caveBiomes.at(x, y, z, cl.t);
  }

  private surfaceColumn(chunk: Chunk, x: number, z: number, bx: number, bz: number, pal: Palette, maxTop: number): void {
    const ci = (z << 4) | x;
    const cl = this.climates[ci]!;
    const hIdx = (z + 1) * 18 + (x + 1);
    const hc = this.heights[hIdx]!;
    const slope = Math.max(
      Math.abs(this.heights[hIdx - 1]! - hc),
      Math.abs(this.heights[hIdx + 1]! - hc),
      Math.abs(this.heights[hIdx - 18]! - hc),
      Math.abs(this.heights[hIdx + 18]! - hc),
    );
    // Find the actual top solid block
    let top = maxTop;
    while (top > 0 && chunk.get(x, top, z) !== pal.stone) top--;
    const biomeId = this.climate.biomeAt(cl, top, slope);
    chunk.biomes[ci] = biomeId;
    const biome = biomeOf(biomeId);
    const wx = bx + x;
    const wz = bz + z;
    const sn = this.surfaceN.sample(wx, wz);
    const depthBase = biome.surface.depth ?? 3;
    const depth = Math.max(1, Math.round(depthBase + sn * 3));

    const isMesa = biomeId === B.badlands || biomeId === B.wooded_badlands || biomeId === B.eroded_badlands;
    const bandOff = isMesa ? Math.round(this.bandOffset.sample(wx, wz) * 6) : 0;
    const steep = slope >= 4 && top > 90;
    const snowLine = 158 + sn * 10;

    let topState = resolveTop(biome.surface.top, pal);
    let fillState = resolveTop(biome.surface.filler, pal);
    const underwater = resolveTop(biome.surface.underwater ?? biome.surface.filler, pal);
    if (steep && !isMesa) {
      topState = top > snowLine ? pal.snowBlock : pal.stone;
      fillState = pal.stone;
    } else if (top > snowLine + 12 && biome.category === 'mountain') {
      topState = pal.snowBlock;
    }

    let run = -1; // -1: in air above surface; >=0: solid depth counter
    let aboveWater = false;
    for (let y = top; y > 4; y--) {
      const s = chunk.get(x, y, z);
      if (s !== pal.stone) {
        run = -1;
        aboveWater = s === pal.water;
        continue;
      }
      run++;
      if (isMesa && y > SEA_LEVEL - 2) {
        if (run === 0 && !steep && y < top + 1 && biome.surface.top !== 'terracotta') {
          chunk.setRaw(x, y, z, biomeId === B.wooded_badlands && y > 90 ? S('coarse_dirt') : pal.redSand);
        } else if (run < 18) {
          chunk.setRaw(x, y, z, pal.bands[((y + bandOff) >> 1) & 15]!);
        }
        continue;
      }
      if (run === 0) {
        if (aboveWater || y < SEA_LEVEL - 1) {
          let st = underwater;
          if (st === pal.dirt || st === pal.sand) {
            const cn = this.clayN.sample(wx, wz);
            if (cn > 0.45 && y > SEA_LEVEL - 8) st = pal.clay;
            else if (cn < -0.5) st = pal.gravel;
          }
          chunk.setRaw(x, y, z, st);
        } else {
          chunk.setRaw(x, y, z, topState);
        }
      } else if (run < depth) {
        chunk.setRaw(x, y, z, aboveWater || y < SEA_LEVEL - 1 ? (underwater === pal.sand ? pal.sand : fillState === pal.snowBlock ? pal.dirt : fillState) : fillState);
      } else if (run < depth + 3 && (fillState === pal.sand || topState === pal.sand)) {
        chunk.setRaw(x, y, z, pal.sandstone);
      } else if (run > depth + 4) {
        // Deep enough: skip the remainder of this solid run quickly.
        let yy = y - 1;
        while (yy > 4 && chunk.get(x, yy, z) === pal.stone) yy--;
        y = yy + 1;
        run = 99;
      }
    }
  }

  private carveCaves(chunk: Chunk, bx: number, bz: number, pal: Palette): void {
    const H = 136;
    const [gc, ga, gb, gw] = this.caveGrids as [NoiseGrid, NoiseGrid, NoiseGrid, NoiseGrid];
    gc.fill(bx, bz, 4, H - 4, (x, y, z) => this.cheese.sample(x, y, z), -1);
    ga.fill(bx, bz, 4, H - 4, (x, y, z) => this.spagA.sample(x, y, z), 1);
    gb.fill(bx, bz, 4, H - 4, (x, y, z) => this.spagB.sample(x, y, z), 1);
    gw.fill(bx, bz, 4, H - 4, (x, y, z) => this.spagWidth.sample(x, y, z), 0);
    const [vc, va, vb, vw] = this.caveVals as [Float32Array, Float32Array, Float32Array, Float32Array];
    gc.expand(vc);
    ga.expand(va);
    gb.expand(vb);
    gw.expand(vw);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const surf = chunk.heightmap[(z << 4) | x]!;
        // heightmap not yet computed; find top solid
        let top = H - 1;
        while (top > 5 && !isSolidTerrain(chunk.get(x, top, z), pal)) top--;
        void surf;
        const ent = this.entrance.sample(bx + x, bz + z);
        const allowSurface = ent > 0.22;
        const limit = Math.min(H - 5, allowSurface ? top : top - 8);
        const oceanCol = chunk.get(x, top + 1, z) === pal.water;
        for (let y = 5; y <= limit; y++) {
          const s = chunk.get(x, y, z);
          if (!isSolidTerrain(s, pal)) continue;
          const i = (y * 16 + z) * 16 + x;
          const nearTop = smoothstep(top - 20, top, y);
          // Cheese caverns: large blobs, mostly deep
          const cheeseT = 0.2 + 0.22 * smoothstep(30, 62, y) + 0.3 * nearTop;
          let carve = vc[i]! > cheeseT;
          if (!carve) {
            // Spaghetti tunnels: intersection of two noise iso-surfaces
            const a = va[i]!;
            const b = vb[i]!;
            const width = 0.0035 + 0.0035 * (vw[i]! + 0.5);
            carve = a * a + b * b < width * (1 - 0.6 * nearTop * (allowSurface ? 0 : 1));
          }
          if (!carve) continue;
          if (oceanCol && y > top - 6) continue;
          const above = chunk.get(x, y + 1, z);
          if (above === pal.water || above === pal.lava) continue;
          chunk.setRaw(x, y, z, y <= 10 ? pal.lava : pal.caveAir);
        }
      }
    }
  }
}

function resolveTop(id: string, pal: Palette): number {
  switch (id) {
    case 'grass_block':
      return pal.grass;
    case 'dirt':
      return pal.dirt;
    case 'sand':
      return pal.sand;
    case 'gravel':
      return pal.gravel;
    case 'stone':
      return pal.stone;
    default:
      return S(id);
  }
}

let SOLID_TERRAIN: Set<number> | undefined;
function isSolidTerrain(s: number, pal: Palette): boolean {
  if (!SOLID_TERRAIN) {
    SOLID_TERRAIN = new Set(
      [pal.stone, pal.dirt, pal.grass, pal.grassSnowy, pal.sand, pal.sandstone, pal.redSand, pal.gravel, pal.clay, pal.snowBlock, pal.terracotta, pal.deepslate, pal.packedIce, ...pal.bands, S('coarse_dirt'), S('podzol'), S('mycelium'), S('mud')],
    );
  }
  return SOLID_TERRAIN.has(s);
}
