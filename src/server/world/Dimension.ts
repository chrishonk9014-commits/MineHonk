/**
 * One dimension of a world: chunk streaming (load/generate/unload/save),
 * lighting, authoritative block access and entity bookkeeping.
 */
import { Chunk, encodeChunk, decodeChunk, encodeLightSection } from '../../common/world/chunk';
import { chunkIndex, chunkIndexX, chunkIndexZ, WORLD_HEIGHT, WORLD_BORDER } from '../../common/world/constants';
import { LightEngine } from '../../common/world/light';
import { createGenerator, type DimensionGenerator } from '../../common/gen/generator';
import type { DimensionId } from '../../common/data/biomes';
import type { BlockAccess } from '../../common/physics/movement';
import { STATE_BLOCK, blocks } from '../../common/registry/blocks';
import { deflateSync, inflateSync } from 'fflate';
import { ByteReader, ByteWriter } from '../../common/util/bytes';
import type { Entity } from '../entity/Entity';
import type { GameServer } from '../GameServer';
import type { BlockEntityData } from '../../common/world/chunk';
import { currentHashValue, V1_HASH } from '../../common/registry/palette';

export interface DimensionRules {
  hasSky: boolean;
  hasCeiling: boolean;
  /** Coordinate scale relative to the overworld (nether = 8). */
  scale: number;
  ambientLight: number;
  fixedTime: number | null;
  bedWorks: boolean;
  waterEvaporates: boolean;
  respawnAnchorWorks: boolean;
  lavaSpreadFast: boolean;
}

export const DIMENSION_RULES: Record<DimensionId, DimensionRules> = {
  overworld: { hasSky: true, hasCeiling: false, scale: 1, ambientLight: 0, fixedTime: null, bedWorks: true, waterEvaporates: false, respawnAnchorWorks: false, lavaSpreadFast: false },
  nether: { hasSky: false, hasCeiling: true, scale: 8, ambientLight: 0.1, fixedTime: 18000, bedWorks: false, waterEvaporates: true, respawnAnchorWorks: true, lavaSpreadFast: true },
  end: { hasSky: false, hasCeiling: false, scale: 1, ambientLight: 0.2, fixedTime: 6000, bedWorks: false, waterEvaporates: false, respawnAnchorWorks: false, lavaSpreadFast: false },
  farlands: { hasSky: true, hasCeiling: false, scale: 1, ambientLight: 0.05, fixedTime: null, bedWorks: false, waterEvaporates: false, respawnAnchorWorks: false, lavaSpreadFast: false },
};

type LoadState = 'reading' | 'queued';

/** 1: V1 (no registry tag, V1 block ids). 2: tagged with the block registry hash. */
export const CHUNK_SAVE_VERSION = 2;

export class Dimension implements BlockAccess {
  readonly chunks = new Map<number, Chunk>();
  private readonly loading = new Map<number, LoadState>();
  /** Chunks waiting for generation, keyed by chunk index -> priority (lower first). */
  private readonly genQueue = new Map<number, number>();
  readonly generator: DimensionGenerator;
  readonly light: LightEngine;
  readonly rules: DimensionRules;
  readonly entities = new Map<number, Entity>();
  /** Chunk index -> entities in that chunk column. */
  readonly buckets = new Map<number, Set<Entity>>();
  /** Chunks referenced by players (index -> last tick wanted). */
  private readonly wanted = new Map<number, number>();
  /** Light sections changed this tick: key "cx,cz,sy". */
  readonly dirtyLight = new Set<string>();
  /** Persisted entity data waiting for its chunk to load. */
  private readonly pendingEntities = new Map<number, Record<string, unknown>[]>();
  private tickCount = 0;
  genMsTotal = 0;
  genCount = 0;

  constructor(
    readonly server: GameServer,
    readonly id: DimensionId,
    seed: number,
  ) {
    this.rules = DIMENSION_RULES[id];
    this.generator = createGenerator(id, seed, { structures: server.level.generateStructures !== false, version: server.level.generatorVersion });
    this.light = new LightEngine(
      {
        getChunk: (cx, cz) => this.chunks.get(chunkIndex(cx, cz)),
        markLightDirty: (cx, sy, cz) => {
          this.dirtyLight.add(cx + ',' + cz + ',' + sy);
        },
      },
      this.rules.hasSky,
    );
  }

  // ---------------------------------------------------------------- blocks

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkIndex(cx, cz));
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkIndex(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }

  getState(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    return c ? c.get(x & 15, y, z & 15) : 0;
  }

  getLight(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    return c ? c.getLight(x & 15, y, z & 15) : 0;
  }

  getBiome(x: number, z: number): number {
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    return c ? c.getBiome(x & 15, z & 15) : this.generator.biomeAt(x, z);
  }

  /** Highest block y+1 at column (0 if none / unloaded). */
  getHeight(x: number, z: number): number {
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    return c ? c.getHeight(x & 15, z & 15) : 0;
  }

  /**
   * Authoritative block change. Updates lighting, notifies clients and
   * schedules neighbour updates. Returns the previous state, or -1 if the
   * chunk is not loaded.
   */
  setBlock(x: number, y: number, z: number, state: number, opts: { notify?: boolean; updateNeighbors?: boolean; keepBlockEntity?: boolean } = {}): number {
    if (y < 0 || y >= WORLD_HEIGHT) return -1;
    if (Math.abs(x) > WORLD_BORDER || Math.abs(z) > WORLD_BORDER) return -1;
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    if (!c) return -1;
    const old = c.set(x & 15, y, z & 15, state);
    if (old === state) return old;
    if (!opts.keepBlockEntity && STATE_BLOCK[old] !== STATE_BLOCK[state] && c.getBlockEntity(x & 15, y, z & 15)) {
      c.setBlockEntity(x & 15, y, z & 15, undefined);
    }
    this.light.onBlockChanged(x, y, z, old, state);
    if (opts.notify !== false) this.server.onBlockChanged(this, x, y, z, state);
    if (opts.updateNeighbors !== false) this.server.blockUpdates.onChanged(this, x, y, z, old, state);
    return old;
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    return c?.getBlockEntity(x & 15, y, z & 15);
  }

  setBlockEntity(x: number, y: number, z: number, data: BlockEntityData | undefined): void {
    const c = this.chunks.get(chunkIndex(x >> 4, z >> 4));
    if (!c) return;
    c.setBlockEntity(x & 15, y, z & 15, data);
  }

  blockId(x: number, y: number, z: number): string {
    return blocks[STATE_BLOCK[this.getState(x, y, z)]!]!.id;
  }

  // ---------------------------------------------------------------- chunk streaming

  /** Marks chunks within radius of a block position as wanted this tick. */
  want(cx: number, cz: number, radius: number, now: number): void {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const k = chunkIndex(cx + dx, cz + dz);
        this.wanted.set(k, now);
        if (!this.chunks.has(k)) this.requestLoad(cx + dx, cz + dz, dx * dx + dz * dz);
      }
    }
  }

  private requestLoad(cx: number, cz: number, priority: number): void {
    const k = chunkIndex(cx, cz);
    const state = this.loading.get(k);
    if (state === 'queued') {
      const cur = this.genQueue.get(k);
      if (cur === undefined || priority < cur) this.genQueue.set(k, priority);
      return;
    }
    if (state === 'reading' || this.chunks.has(k)) return;
    if (Math.abs(cx * 16) > WORLD_BORDER || Math.abs(cz * 16) > WORLD_BORDER) return;
    this.loading.set(k, 'reading');
    this.server.storage
      .readChunk(this.id, cx, cz)
      .then((data) => {
        if (this.loading.get(k) !== 'reading') return;
        if (data) {
          try {
            const { chunk, entities } = decodeSavedChunk(data, this.rules.hasSky, (h) => this.server.registries.remapFor(h));
            if (chunk.cx !== cx || chunk.cz !== cz) throw new Error('chunk coordinate mismatch');
            this.loading.delete(k);
            this.addChunk(chunk);
            if (entities.length) this.pendingEntities.set(k, entities);
            this.server.onChunkLoaded(this, chunk, entities);
            return;
          } catch (e) {
            this.server.log(`[${this.id}] corrupt chunk ${cx},${cz} – regenerating: ${(e as Error).message}`);
          }
        }
        this.loading.set(k, 'queued');
        this.genQueue.set(k, priority);
      })
      .catch((e) => {
        this.server.log(`[${this.id}] failed to read chunk ${cx},${cz}: ${(e as Error).message}`);
        this.loading.set(k, 'queued');
        this.genQueue.set(k, priority);
      });
  }

  private addChunk(c: Chunk): void {
    const k = chunkIndex(c.cx, c.cz);
    this.chunks.set(k, c);
    this.light.invalidateCache();
    this.light.initChunk(c);
  }

  /** Generates queued chunks within a time budget. */
  processGeneration(budgetMs: number): number {
    if (this.genQueue.size === 0) return 0;
    const start = performance.now();
    // pick lowest priority values first
    const order = [...this.genQueue.entries()].sort((a, b) => a[1] - b[1]);
    let n = 0;
    for (const [k] of order) {
      if (performance.now() - start > budgetMs && n > 0) break;
      this.genQueue.delete(k);
      if (this.loading.get(k) !== 'queued') continue;
      this.loading.delete(k);
      if (!this.wanted.has(k)) continue;
      const t0 = performance.now();
      const c = this.generator.generate(chunkIndexX(k), chunkIndexZ(k));
      c.dirty = false;
      c.modified = false;
      this.addChunk(c);
      this.genMsTotal += performance.now() - t0;
      this.genCount++;
      this.server.onChunkGenerated(this, c);
      n++;
    }
    return n;
  }

  get pendingGeneration(): number {
    return this.genQueue.size;
  }

  /** Unloads chunks nobody wanted for a while; saves modified ones. */
  async unloadUnused(now: number, graceTicks: number): Promise<void> {
    const toSave: Chunk[] = [];
    for (const [k, c] of this.chunks) {
      const last = this.wanted.get(k);
      if (last !== undefined && now - last < graceTicks) continue;
      if (this.server.isChunkForceLoaded(this, c.cx, c.cz)) continue;
      if (c.dirty || this.chunkHasPersistentEntities(k) || this.server.blockUpdates.hasTicks(this, c)) toSave.push(c);
      this.chunks.delete(k);
      this.wanted.delete(k);
      this.server.onChunkUnloaded(this, c);
    }
    this.light.invalidateCache();
    if (toSave.length) await this.saveChunks(toSave);
    // Drop stale wants for chunks that never loaded
    for (const [k, t] of this.wanted) if (now - t >= graceTicks && !this.chunks.has(k)) this.wanted.delete(k);
    for (const k of this.loading.keys()) {
      if (!this.wanted.has(k) && this.loading.get(k) === 'queued') {
        this.loading.delete(k);
        this.genQueue.delete(k);
      }
    }
  }

  private chunkHasPersistentEntities(k: number): boolean {
    const b = this.buckets.get(k);
    if (!b) return false;
    for (const e of b) if (e.persistent) return true;
    return false;
  }

  /** Serialises and writes chunks (with their persistent entities). */
  async saveChunks(list: Chunk[]): Promise<void> {
    const entries: { cx: number; cz: number; data: Uint8Array }[] = [];
    for (const c of list) {
      const k = chunkIndex(c.cx, c.cz);
      const ents: Record<string, unknown>[] = [];
      const b = this.buckets.get(k);
      if (b) {
        for (const e of b) {
          if (!e.persistent || e.removed) continue;
          const s = e.save();
          if (s) ents.push(s);
        }
      }
      // V4: pending block ticks (flowing fluids...) travel with the chunk
      ents.push(...this.server.blockUpdates.savedTicks(this, c));
      if (!c.modified && ents.length === 0) {
        c.dirty = false;
        continue;
      }
      entries.push({ cx: c.cx, cz: c.cz, data: encodeSavedChunk(c, ents) });
      c.dirty = false;
    }
    if (entries.length) await this.server.storage.writeChunks(this.id, entries);
  }

  async saveAll(): Promise<void> {
    const list: Chunk[] = [];
    for (const [k, c] of this.chunks) if (c.dirty || this.chunkHasPersistentEntities(k) || this.server.blockUpdates.hasTicks(this, c)) list.push(c);
    await this.saveChunks(list);
  }

  takePendingEntities(cx: number, cz: number): Record<string, unknown>[] | undefined {
    const k = chunkIndex(cx, cz);
    const v = this.pendingEntities.get(k);
    this.pendingEntities.delete(k);
    return v;
  }

  // ---------------------------------------------------------------- entities

  addEntity(e: Entity): void {
    e.dim = this;
    this.entities.set(e.id, e);
    this.updateBucket(e);
    this.server.onEntityAdded(this, e);
  }

  removeEntity(e: Entity): void {
    this.entities.delete(e.id);
    const b = this.buckets.get(e.bucketKey);
    if (b) {
      b.delete(e);
      if (b.size === 0) this.buckets.delete(e.bucketKey);
    }
    e.bucketKey = NaN;
    this.server.onEntityRemoved(this, e);
  }

  updateBucket(e: Entity): void {
    const k = chunkIndex(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
    if (k === e.bucketKey) return;
    const old = this.buckets.get(e.bucketKey);
    if (old) {
      old.delete(e);
      if (old.size === 0) this.buckets.delete(e.bucketKey);
    }
    let b = this.buckets.get(k);
    if (!b) {
      b = new Set();
      this.buckets.set(k, b);
    }
    b.add(e);
    e.bucketKey = k;
  }

  /** Entities whose position lies within `r` blocks of a point (cheap chunk-bucket query). */
  entitiesNear(x: number, y: number, z: number, r: number, filter?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    const cx0 = Math.floor(x - r) >> 4;
    const cx1 = Math.floor(x + r) >> 4;
    const cz0 = Math.floor(z - r) >> 4;
    const cz1 = Math.floor(z + r) >> 4;
    const r2 = r * r;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const b = this.buckets.get(chunkIndex(cx, cz));
        if (!b) continue;
        for (const e of b) {
          if (e.removed) continue;
          if (e.distanceSq(x, y, z) <= r2 && (!filter || filter(e))) out.push(e);
        }
      }
    }
    return out;
  }

  tickEntities(): void {
    for (const e of this.entities.values()) {
      if (e.removed) continue;
      // Only tick entities in loaded chunks
      if (!this.isLoaded(e.x, e.z)) continue;
      e.tick();
      if (e.removed) continue;
      this.updateBucket(e);
    }
    for (const e of [...this.entities.values()]) if (e.removed) this.removeEntity(e);
  }

  /** Collects light sections that changed for chunks sent to clients. */
  drainLightUpdates(): { cx: number; cz: number; sy: number; data: Uint8Array }[] {
    const out: { cx: number; cz: number; sy: number; data: Uint8Array }[] = [];
    for (const key of this.dirtyLight) {
      const [cx, cz, sy] = key.split(',').map(Number) as [number, number, number];
      const c = this.chunks.get(chunkIndex(cx, cz));
      if (!c) continue;
      out.push({ cx, cz, sy, data: encodeLightSection(c.light[sy] ?? null) });
    }
    this.dirtyLight.clear();
    return out;
  }

  tick(): void {
    this.tickCount++;
  }
}

/** Saved chunk payload: deflate( u8 version, u32 registry hash, varint len, chunk bytes, json entities ). */
export function encodeSavedChunk(c: Chunk, entities: Record<string, unknown>[]): Uint8Array {
  const body = encodeChunk(c, { light: false, blockEntities: true });
  const w = new ByteWriter(body.length + 256);
  w.u8(CHUNK_SAVE_VERSION);
  w.u32(currentHashValue());
  w.varint(body.length);
  w.bytes(body);
  w.string(JSON.stringify(entities));
  return deflateSync(w.finish(), { level: 6 });
}

/**
 * Reads a saved chunk. `remapFor` translates block ids written by another
 * registry (V1 chunks carry no tag and always use the V1 registry).
 */
export function decodeSavedChunk(data: Uint8Array, hasSky: boolean, remapFor: (hash: number) => Uint16Array | null = () => null): { chunk: Chunk; entities: Record<string, unknown>[] } {
  const raw = inflateSync(data);
  const r = new ByteReader(raw);
  const version = r.u8();
  if (version !== 1 && version !== CHUNK_SAVE_VERSION) throw new Error(`unsupported chunk version ${version}`);
  const hash = version === 1 ? V1_HASH : r.u32();
  const len = r.varint();
  const chunk = decodeChunk(r.bytes(len), remapFor(hash));
  (chunk as { hasSky: boolean }).hasSky = hasSky;
  chunk.modified = true;
  chunk.dirty = false;
  let entities: Record<string, unknown>[] = [];
  if (r.remaining > 0) {
    const parsed = JSON.parse(r.string());
    if (Array.isArray(parsed)) entities = parsed.filter((e) => e && typeof e === 'object');
  }
  return { chunk, entities };
}
