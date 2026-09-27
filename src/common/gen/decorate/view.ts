/**
 * A clipped world view used while decorating one target chunk.
 *
 * Features may originate in any chunk of the 3x3 neighbourhood and can
 * extend across chunk borders. Every feature is replayed while decorating
 * each chunk it touches; it writes only the blocks inside the target chunk.
 * To keep results independent of generation order, placement *decisions*
 * must only use `proto()` / `height()` (pure terrain), while `get()` (which
 * includes earlier decorations of the target) may only be used to decide
 * whether a single block inside the target can be overwritten.
 */
import type { Chunk, BlockEntityData } from '../../world/chunk';
import { WORLD_HEIGHT } from '../../world/constants';

export class DecorView {
  readonly bx: number;
  readonly bz: number;

  constructor(
    readonly target: Chunk,
    private readonly protoAt: (cx: number, cz: number) => Chunk,
  ) {
    this.bx = target.cx << 4;
    this.bz = target.cz << 4;
  }

  inside(x: number, z: number): boolean {
    return x >= this.bx && x < this.bx + 16 && z >= this.bz && z < this.bz + 16;
  }

  /** Pure terrain state (never includes decorations). */
  proto(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.protoAt(x >> 4, z >> 4).get(x & 15, y, z & 15);
  }

  /** Current state: decorated target chunk inside, pure terrain outside. */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    if (this.inside(x, z)) return this.target.get(x & 15, y, z & 15);
    return this.protoAt(x >> 4, z >> 4).get(x & 15, y, z & 15);
  }

  set(x: number, y: number, z: number, state: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || !this.inside(x, z)) return;
    this.target.setRaw(x & 15, y, z & 15, state);
  }

  setBlockEntity(x: number, y: number, z: number, data: BlockEntityData): void {
    if (y < 0 || y >= WORLD_HEIGHT || !this.inside(x, z)) return;
    this.target.setBlockEntity(x & 15, y, z & 15, data);
  }

  /** Terrain height (first air above the highest non-air block) from the proto chunk. */
  height(x: number, z: number): number {
    return this.protoAt(x >> 4, z >> 4).getHeight(x & 15, z & 15);
  }

  biome(x: number, z: number): number {
    return this.protoAt(x >> 4, z >> 4).getBiome(x & 15, z & 15);
  }
}
