/**
 * Client-side mirror of the world near the player. The server is
 * authoritative; this holds decoded chunks for rendering, physics prediction
 * and targeting.
 */
import { Chunk, decodeChunk, decodeLightSection } from '../../common/world/chunk';
import { chunkIndex, WORLD_HEIGHT } from '../../common/world/constants';
import type { BlockAccess } from '../../common/physics/movement';
import { biomeOf } from '../../common/registry/biomes';
import type { DimensionId } from '../../common/data/biomes';

export interface ChunkListener {
  onChunkLoaded(c: Chunk): void;
  onChunkUnloaded(cx: number, cz: number): void;
  onBlockChanged(x: number, y: number, z: number, old: number, state: number): void;
  /** `faces`: which boundary planes changed (bit per face: -Y, +Y, -Z, +Z, -X, +X). */
  onLightChanged(cx: number, sy: number, cz: number, faces: number): void;
}

export class ClientWorld implements BlockAccess {
  readonly chunks = new Map<number, Chunk>();
  dimension: DimensionId = 'overworld';
  hasSky = true;
  listener: ChunkListener | null = null;
  private lastChunk: Chunk | undefined;
  private lastKey = NaN;

  private chunkAt(x: number, z: number): Chunk | undefined {
    const k = chunkIndex(x >> 4, z >> 4);
    if (k === this.lastKey) return this.lastChunk;
    const c = this.chunks.get(k);
    this.lastKey = k;
    this.lastChunk = c;
    return c;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkIndex(cx, cz));
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkIndex(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }

  getState(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.get(x & 15, y, z & 15) : 0;
  }

  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return this.hasSky ? 0xf0 : 0;
    const c = this.chunkAt(x, z);
    return c ? c.getLight(x & 15, y, z & 15) : this.hasSky ? 0xf0 : 0;
  }

  biomeAt(x: number, z: number): ReturnType<typeof biomeOf> {
    const c = this.chunkAt(Math.floor(x), Math.floor(z));
    return biomeOf(c ? c.getBiome(Math.floor(x) & 15, Math.floor(z) & 15) : 0);
  }

  heightAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.getHeight(x & 15, z & 15) : 0;
  }

  loadChunk(data: Uint8Array): Chunk {
    const c = decodeChunk(data);
    (c as { hasSky: boolean }).hasSky = this.hasSky;
    this.chunks.set(chunkIndex(c.cx, c.cz), c);
    this.lastKey = NaN;
    this.listener?.onChunkLoaded(c);
    return c;
  }

  unloadChunk(cx: number, cz: number): void {
    if (this.chunks.delete(chunkIndex(cx, cz))) {
      this.lastKey = NaN;
      this.listener?.onChunkUnloaded(cx, cz);
    }
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const old = c.get(x & 15, y, z & 15);
    if (old === state) return;
    c.set(x & 15, y, z & 15, state);
    this.listener?.onBlockChanged(x, y, z, old, state);
  }

  setLightSection(cx: number, cz: number, sy: number, data: Uint8Array): void {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    const old = c.light[sy] ?? null;
    const next = decodeLightSection(data);
    c.light[sy] = next;
    // Unchanged light needs no rebuild; neighbours only care about the shared boundary
    const faces = lightChange(old, next, this.hasSky ? 0xf0 : 0);
    if (faces >= 0) this.listener?.onLightChanged(cx, sy, cz, faces);
  }

  clear(): void {
    for (const c of [...this.chunks.values()]) this.unloadChunk(c.cx, c.cz);
    this.chunks.clear();
    this.lastKey = NaN;
  }
}

/**
 * Compares two light sections (null = every cell at `fallback`). Returns -1
 * when they are identical, otherwise a bit per boundary plane that differs
 * (-Y, +Y, -Z, +Z, -X, +X), 0 when only the interior changed.
 */
export function lightChange(a: Uint8Array | null, b: Uint8Array | null, fallback: number): number {
  if (a === b) return -1;
  let faces = 0;
  let any = false;
  for (let i = 0; i < 4096; i++) {
    if ((a ? a[i]! : fallback) === (b ? b[i]! : fallback)) continue;
    any = true;
    const x = i & 15;
    const z = (i >> 4) & 15;
    const y = i >> 8;
    if (y === 0) faces |= 1;
    else if (y === 15) faces |= 2;
    if (z === 0) faces |= 4;
    else if (z === 15) faces |= 8;
    if (x === 0) faces |= 16;
    else if (x === 15) faces |= 32;
    if (faces === 63) break;
  }
  return any ? faces : -1;
}
