/**
 * Generation pipeline entry point.
 *
 * Chunks are produced in two stages:
 *  1. terrain: a pure function of (seed, cx, cz) producing a proto chunk;
 *  2. decoration: features (trees, ores, structures...) whose origins lie in
 *     the 3x3 neighbourhood are replayed in a fixed global order, each only
 *     writing blocks that fall inside the target chunk. Decisions read only
 *     proto data, so the result is deterministic regardless of load order.
 */
import { Chunk } from '../world/chunk';
import type { DimensionId } from '../data/biomes';
import { OverworldTerrain } from './overworld';
import { DecorView } from './decorate/view';
import * as F from './decorate/features';
import { StructureManager } from './structures/manager';
import { ProtoCache, cloneChunk, addGenEntities, type DimensionGenerator, type GeneratorOptions, type SpawnPoint } from './pipeline';
import { VILLAGE } from './structures/village';
import { SURFACE_STRUCTURES } from './structures/misc';
import { MINESHAFT, STRONGHOLD } from './structures/underground';
import { biomeOf } from '../registry/biomes';
import { STATE_FLUID } from '../registry/blocks';
import { NetherGenerator } from './nether';

export { ProtoCache, cloneChunk, type DimensionGenerator, type GeneratorOptions, type SpawnPoint };

type Stage = (v: DecorView, seed: number, ocx: number, ocz: number) => void;

/** Stages replayed over the 3x3 neighbourhood, in this global order. */
const NEIGHBOUR_STAGES: Stage[] = [F.lakes, F.geodes, F.ores, F.dungeons, F.springs, F.disks, F.iceFeatures, F.boulders, F.trees];

export class OverworldGenerator implements DimensionGenerator {
  readonly dimension = 'overworld' as const;
  readonly terrain: OverworldTerrain;
  readonly structures: StructureManager;
  private readonly protos: ProtoCache;

  constructor(
    readonly seed: number,
    opts: GeneratorOptions = {},
  ) {
    this.terrain = new OverworldTerrain(seed);
    this.protos = new ProtoCache(600, (cx, cz) => this.terrain.generate(cx, cz));
    const ground = (x: number, z: number): { y: number; water: boolean } => {
      const c = this.protos.get(x >> 4, z >> 4);
      let y = c.getHeight(x & 15, z & 15) - 1;
      let water = false;
      while (y > 0) {
        const s = c.get(x & 15, y, z & 15);
        if (s !== 0 && !STATE_FLUID[s]) break;
        if (STATE_FLUID[s]) water = true;
        y--;
      }
      return { y, water };
    };
    this.structures = new StructureManager(
      seed,
      [VILLAGE, ...SURFACE_STRUCTURES, MINESHAFT, STRONGHOLD],
      {
        seed,
        groundY: (x, z) => ground(x, z).y,
        isWater: (x, z) => ground(x, z).water,
        biome: (x, z) => biomeOf(this.protos.get(x >> 4, z >> 4).getBiome(x & 15, z & 15)),
        estimateHeight: (x, z) => this.terrain.estimateHeight(x, z),
        estimateBiome: (x, z) => biomeOf(this.terrain.estimateBiome(x, z)),
      },
      () => opts.structures !== false,
    );
  }

  generate(cx: number, cz: number): Chunk {
    const proto = this.protos.get(cx, cz);
    const c = cloneChunk(proto);
    const v = new DecorView(c, (x, z) => this.protos.get(x, z));
    const seed = this.seed;
    for (const stage of NEIGHBOUR_STAGES) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) stage(v, seed, cx + dx, cz + dz);
    }
    F.caveDecor(v, seed, cx, cz, (x, z) => {
      const cl = this.terrain.climate.sample(x, z, this.climateScratch);
      return { humidity: cl.h, continentalness: cl.c, weirdness: cl.w };
    });
    const starts = this.structures.build(v);
    F.vegetation(v, seed, cx, cz);
    F.freeze(v);
    c.recount();
    c.recomputeHeightmap();
    // Structure entities (villagers, witches ...) that stand in this chunk
    for (const s of starts) addGenEntities(c, s);
    return c;
  }

  private readonly climateScratch = newClimateScratch();

  findSpawn(): SpawnPoint {
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 32));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const h = this.terrain.estimateHeight(x, z);
        if (h > 64 && h < 100) {
          const biome = biomeOf(this.terrain.estimateBiome(x, z));
          // Prefer friendly biomes to start in
          if (r < 1200 && (biome.category === 'ocean' || biome.category === 'mountain' || biome.id === 'mushroom_fields')) continue;
          return { x, y: h + 1, z };
        }
      }
    }
    return { x: 0, y: 100, z: 0 };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.estimateBiome(x, z);
  }

  structureAt(x: number, y: number, z: number): string | null {
    return this.structures.structureAt(x, y, z);
  }

  locate(type: string, x: number, z: number): { x: number; y: number; z: number } | null {
    const s = this.structures.nearest(type, x, z, type === 'stronghold' ? 0 : 12);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }
}

function newClimateScratch(): import('./climate').Climate {
  return { c: 0, e: 0, w: 0, pv: 0, t: 0, h: 0, v: 0, river: 0, mountain: 0, swamp: 0, plateau: 0, land: 0, height: 0, amp: 0 };
}

export function createGenerator(dim: DimensionId, seed: number, opts: GeneratorOptions = {}): DimensionGenerator {
  switch (dim) {
    case 'nether':
      return new NetherGenerator(seed, opts);
    case 'overworld':
    default:
      return new OverworldGenerator(seed, opts);
  }
}
