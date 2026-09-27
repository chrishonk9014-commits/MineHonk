/**
 * Persistence abstraction. Implementations: MemoryStorage (tests),
 * IndexedDBStorage (browser integrated server) and FileStorage (Node).
 *
 * Chunk payloads are opaque compressed byte arrays produced by the world code.
 */
import type { DimensionId } from '../../common/data/biomes';

export interface WorldStorage {
  readLevel(): Promise<unknown | null>;
  writeLevel(data: unknown): Promise<void>;
  readChunk(dim: DimensionId, cx: number, cz: number): Promise<Uint8Array | null>;
  writeChunks(dim: DimensionId, entries: { cx: number; cz: number; data: Uint8Array }[]): Promise<void>;
  readPlayer(uuid: string): Promise<unknown | null>;
  writePlayer(uuid: string, data: unknown): Promise<void>;
  /** Arbitrary named blobs (dimension state, structures index, stats...). */
  readMeta(key: string): Promise<unknown | null>;
  writeMeta(key: string, data: unknown): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStorage implements WorldStorage {
  level: unknown | null = null;
  readonly chunks = new Map<string, Uint8Array>();
  readonly players = new Map<string, unknown>();
  readonly meta = new Map<string, unknown>();

  async readLevel(): Promise<unknown | null> {
    return this.level ? JSON.parse(JSON.stringify(this.level)) : null;
  }
  async writeLevel(data: unknown): Promise<void> {
    this.level = JSON.parse(JSON.stringify(data));
  }
  async readChunk(dim: DimensionId, cx: number, cz: number): Promise<Uint8Array | null> {
    return this.chunks.get(`${dim}:${cx}:${cz}`) ?? null;
  }
  async writeChunks(dim: DimensionId, entries: { cx: number; cz: number; data: Uint8Array }[]): Promise<void> {
    for (const e of entries) this.chunks.set(`${dim}:${e.cx}:${e.cz}`, e.data.slice());
  }
  async readPlayer(uuid: string): Promise<unknown | null> {
    const p = this.players.get(uuid);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }
  async writePlayer(uuid: string, data: unknown): Promise<void> {
    this.players.set(uuid, JSON.parse(JSON.stringify(data)));
  }
  async readMeta(key: string): Promise<unknown | null> {
    const v = this.meta.get(key);
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }
  async writeMeta(key: string, data: unknown): Promise<void> {
    this.meta.set(key, JSON.parse(JSON.stringify(data)));
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
