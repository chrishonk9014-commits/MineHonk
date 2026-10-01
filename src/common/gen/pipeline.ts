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
  /**
   * World generator version. Unmodified chunks are regenerated from the seed
   * on every load, so a world keeps the version it was created with:
   * 1 = V1 terrain, 2 = V2 (the Caves Update), 3 = V3 (corrupted caves,
   * glitched portals, powder snow ice caves), 4 = V4 (the World Update),
   * 5 = V4 temples and bunkers (temple trials, the desert pyramid, bunkers
   * with random layouts and biome styles). Defaults to the latest.
   */
  version?: number;
}

/** Newest world generator version (new worlds use this). */
export const LATEST_GENERATOR = 5;

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
  /** Admin locate for cave features (cave biome id, 'mega_cavern', 'ravine'). */
  caveSteps?(kind: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null>;
  /** True when the dimension has the V2 underground (cave biomes, cave spawning). */
  readonly caves?: boolean;
  /** Cave biome at a position (V2 overworld; 0 = none). */
  caveBiomeAt?(x: number, y: number, z: number): number;
  /** Whether a position lies inside a mega-cavern (V2 overworld). */
  inMegaCavern?(x: number, y: number, z: number): boolean;
  /** V4: the Error Biome chunk at chunk (cx, cz), if that chunk is one. */
  errorChunk?(cx: number, cz: number): import('./v4/errorBiome').ErrorChunk | null;
  /** V4: nearest Error Biome chunk. */
  nearestErrorChunk?(x: number, z: number, maxRings?: number): import('./v4/errorBiome').ErrorChunk | null;
  /** Structure type whose bounds contain the position (used for structure mob spawns). */
  structureAt?(x: number, y: number, z: number): string | null;
}

/**
 * Small LRU cache for proto chunks. Lookups are hot (every block a feature
 * reads), so recency is an access stamp rather than re-inserting into the map;
 * the least recently used entry is found only when an insert overflows.
 */
export class ProtoCache {
  private readonly map = new Map<number, { c: Chunk; t: number }>();
  private clock = 0;
  private lastKey = NaN;
  private lastChunk: Chunk | null = null;

  constructor(
    private readonly capacity: number,
    private readonly make: (cx: number, cz: number) => Chunk,
  ) {}

  get(cx: number, cz: number): Chunk {
    const k = chunkIndex(cx, cz);
    if (k === this.lastKey && this.lastChunk) return this.lastChunk;
    let e = this.map.get(k);
    if (e) e.t = ++this.clock;
    else {
      e = { c: this.make(cx, cz), t: ++this.clock };
      this.map.set(k, e);
      if (this.map.size > this.capacity) this.evict();
    }
    this.lastKey = k;
    this.lastChunk = e.c;
    return e.c;
  }

  private evict(): void {
    // Drop the oldest eighth in one pass so overflow scans stay rare
    const n = Math.max(1, this.map.size - this.capacity + (this.capacity >> 3));
    const stamps = [...this.map.values()].map((e) => e.t).sort((a, b) => a - b);
    const cut = stamps[n - 1]!;
    for (const [k, e] of this.map) if (e.t <= cut && e.c !== this.lastChunk) this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
    this.lastKey = NaN;
    this.lastChunk = null;
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
