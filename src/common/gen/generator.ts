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
import { chunkIndex } from '../world/constants';

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

export interface DimensionGenerator {
  readonly dimension: DimensionId;
  readonly seed: number;
  generate(cx: number, cz: number): Chunk;
  findSpawn(): SpawnPoint;
  biomeAt(x: number, z: number): number;
}

/** Small LRU cache for proto chunks. */
export class ProtoCache {
  private readonly map = new Map<number, Chunk>();

  constructor(
    private readonly capacity: number,
    private readonly make: (cx: number, cz: number) => Chunk,
  ) {}

  get(cx: number, cz: number): Chunk {
    const k = chunkIndex(cx, cz);
    let c = this.map.get(k);
    if (c) {
      this.map.delete(k);
      this.map.set(k, c);
      return c;
    }
    c = this.make(cx, cz);
    this.map.set(k, c);
    if (this.map.size > this.capacity) {
      const first = this.map.keys().next().value as number;
      this.map.delete(first);
    }
    return c;
  }

  clear(): void {
    this.map.clear();
  }
}

export function cloneChunk(src: Chunk): Chunk {
  const c = new Chunk(src.cx, src.cz, src.hasSky);
  for (let i = 0; i < src.sections.length; i++) {
    const s = src.sections[i];
    if (s) c.sections[i] = s.slice();
  }
  c.counts.set(src.counts);
  c.heightmap.set(src.heightmap);
  c.biomes.set(src.biomes);
  return c;
}

export class OverworldGenerator implements DimensionGenerator {
  readonly dimension = 'overworld' as const;
  readonly terrain: OverworldTerrain;
  private readonly protos: ProtoCache;

  constructor(readonly seed: number) {
    this.terrain = new OverworldTerrain(seed);
    this.protos = new ProtoCache(400, (cx, cz) => this.terrain.generate(cx, cz));
  }

  generate(cx: number, cz: number): Chunk {
    const proto = this.protos.get(cx, cz);
    const c = cloneChunk(proto);
    c.recomputeHeightmap();
    return c;
  }

  findSpawn(): SpawnPoint {
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 32));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const h = this.terrain.estimateHeight(x, z);
        if (h > 64 && h < 100) {
          const b = this.terrain.estimateBiome(x, z);
          void b;
          return { x, y: h + 1, z };
        }
      }
    }
    return { x: 0, y: 100, z: 0 };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.estimateBiome(x, z);
  }
}

export function createGenerator(dim: DimensionId, seed: number): DimensionGenerator {
  switch (dim) {
    case 'overworld':
      return new OverworldGenerator(seed);
    default:
      return new OverworldGenerator(seed);
  }
}
