/**
 * Shared pieces of the world generation pipeline used by every dimension
 * generator: the generator interface, a proto-chunk LRU cache, chunk
 * cloning and structure entity hand-off.
 */
import { Chunk } from '../world/chunk';
import type { DimensionId } from '../data/biomes';
import { chunkIndex } from '../world/constants';
import type { Start } from './structures/manager';

export interface GeneratorOptions {
  /** Generate villages, temples and other structures (default true). */
  structures?: boolean;
}

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
  /** Nearest structure of a type (e.g. 'stronghold'), if the dimension has them. */
  locate?(type: string, x: number, z: number): { x: number; y: number; z: number } | null;
  /** Whether a column has ground to stand on (dimensions with open void). */
  landAt?(x: number, z: number): boolean;
  /** Structure types this dimension can generate (admin structure finder). */
  structureTypes?(): string[];
  /** Nearest structure, searched incrementally (yields between steps). */
  locateSteps?(type: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null>;
  /** Structure type whose bounds contain the position (used for structure mob spawns). */
  structureAt?(x: number, y: number, z: number): string | null;
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

/** Copies structure entities that stand in this chunk into its spawn list. */
export function addGenEntities(c: Chunk, s: Start): void {
  if (!s.entities) return;
  const x0 = c.cx << 4;
  const z0 = c.cz << 4;
  for (const e of s.entities) {
    if (e.x >= x0 && e.x < x0 + 16 && e.z >= z0 && e.z < z0 + 16) c.genEntities.push({ ...e });
  }
}
