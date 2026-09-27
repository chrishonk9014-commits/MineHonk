/**
 * World storage on disk for the dedicated server.
 *
 *   level.json (+ .bak)          world settings and state
 *   players/<uuid>.json          per-player data
 *   meta/<key>.json              named blobs
 *   <dimension>/r.<rx>.<rz>.mhr  region files holding 32x32 chunks
 *
 * Region files are rewritten atomically when flushed, so a crash mid-save
 * never leaves a half-written region behind. A damaged region is set aside
 * (renamed *.corrupt) and its chunks regenerate.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { WorldStorage } from '../server/storage/Storage';
import type { DimensionId } from '../common/data/biomes';
import { readIfExists, readJson, writeAtomic, writeJson } from './fsutil';

const MAGIC = 0x3152484d; // 'MHR1'
const REGION_SHIFT = 5;

interface Region {
  chunks: Map<number, Uint8Array>;
  dirty: boolean;
  lastUse: number;
}

const DIMS: readonly DimensionId[] = ['overworld', 'nether', 'end', 'farlands'];

function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export class FileStorage implements WorldStorage {
  private readonly regions = new Map<string, Region>();
  private readonly loading = new Map<string, Promise<Region>>();

  constructor(
    readonly dir: string,
    private readonly log: (m: string) => void = () => {},
    private readonly maxRegions = 64,
  ) {}

  // ------------------------------------------------------------------ level, players, meta

  readLevel(): Promise<unknown | null> {
    return readJson(path.join(this.dir, 'level.json'), this.log);
  }

  writeLevel(data: unknown): Promise<void> {
    return writeJson(path.join(this.dir, 'level.json'), data);
  }

  readPlayer(uuid: string): Promise<unknown | null> {
    return readJson(path.join(this.dir, 'players', `${safeKey(uuid)}.json`), this.log);
  }

  writePlayer(uuid: string, data: unknown): Promise<void> {
    return writeJson(path.join(this.dir, 'players', `${safeKey(uuid)}.json`), data);
  }

  readMeta(key: string): Promise<unknown | null> {
    return readJson(path.join(this.dir, 'meta', `${safeKey(key)}.json`), this.log);
  }

  writeMeta(key: string, data: unknown): Promise<void> {
    return writeJson(path.join(this.dir, 'meta', `${safeKey(key)}.json`), data);
  }

  // ------------------------------------------------------------------ chunks

  private regionFile(dim: DimensionId, rx: number, rz: number): string {
    return path.join(this.dir, dim, `r.${rx}.${rz}.mhr`);
  }

  private async region(dim: DimensionId, rx: number, rz: number): Promise<Region> {
    if (!DIMS.includes(dim)) throw new Error(`bad dimension ${dim}`);
    const key = `${dim}:${rx}:${rz}`;
    const r = this.regions.get(key);
    if (r) {
      r.lastUse = Date.now();
      return r;
    }
    let p = this.loading.get(key);
    if (!p) {
      p = this.loadRegion(dim, rx, rz).then((reg) => {
        this.regions.set(key, reg);
        this.loading.delete(key);
        return reg;
      });
      this.loading.set(key, p);
    }
    return p;
  }

  private async loadRegion(dim: DimensionId, rx: number, rz: number): Promise<Region> {
    const file = this.regionFile(dim, rx, rz);
    const reg: Region = { chunks: new Map(), dirty: false, lastUse: Date.now() };
    const buf = await readIfExists(file);
    if (!buf) return reg;
    try {
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      if (view.getUint32(0, true) !== MAGIC) throw new Error('bad magic');
      const n = view.getUint32(4, true);
      let o = 8;
      for (let i = 0; i < n; i++) {
        const lx = view.getUint8(o);
        const lz = view.getUint8(o + 1);
        const len = view.getUint32(o + 2, true);
        o += 6;
        if (o + len > buf.byteLength || lx > 31 || lz > 31) throw new Error('truncated');
        reg.chunks.set((lz << REGION_SHIFT) | lx, new Uint8Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + len)));
        o += len;
      }
    } catch (e) {
      this.log(`[storage] region ${dim} ${rx},${rz} is damaged (${(e as Error).message}); setting it aside`);
      await fs.rename(file, `${file}.${Date.now()}.corrupt`).catch(() => {});
      reg.chunks.clear();
    }
    return reg;
  }

  async readChunk(dim: DimensionId, cx: number, cz: number): Promise<Uint8Array | null> {
    const r = await this.region(dim, cx >> REGION_SHIFT, cz >> REGION_SHIFT);
    return r.chunks.get(((cz & 31) << REGION_SHIFT) | (cx & 31)) ?? null;
  }

  async writeChunks(dim: DimensionId, entries: { cx: number; cz: number; data: Uint8Array }[]): Promise<void> {
    for (const e of entries) {
      const r = await this.region(dim, e.cx >> REGION_SHIFT, e.cz >> REGION_SHIFT);
      r.chunks.set(((e.cz & 31) << REGION_SHIFT) | (e.cx & 31), e.data.slice());
      r.dirty = true;
    }
    if (this.regions.size > this.maxRegions) await this.evict();
  }

  private encodeRegion(r: Region): Uint8Array {
    let size = 8;
    for (const d of r.chunks.values()) size += 6 + d.byteLength;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, r.chunks.size, true);
    let o = 8;
    for (const [k, d] of r.chunks) {
      view.setUint8(o, k & 31);
      view.setUint8(o + 1, k >> REGION_SHIFT);
      view.setUint32(o + 2, d.byteLength, true);
      out.set(d, o + 6);
      o += 6 + d.byteLength;
    }
    return out;
  }

  private async writeRegion(key: string, r: Region): Promise<void> {
    const [dim, rx, rz] = key.split(':') as [DimensionId, string, string];
    r.dirty = false;
    await writeAtomic(this.regionFile(dim, Number(rx), Number(rz)), this.encodeRegion(r));
  }

  /** Writes and forgets the least recently used clean-able regions. */
  private async evict(): Promise<void> {
    const list = [...this.regions.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse);
    while (this.regions.size > this.maxRegions * 0.75 && list.length) {
      const [key, r] = list.shift()!;
      if (r.dirty) await this.writeRegion(key, r);
      this.regions.delete(key);
    }
  }

  async flush(): Promise<void> {
    for (const [key, r] of this.regions) if (r.dirty) await this.writeRegion(key, r);
  }

  async close(): Promise<void> {
    await this.flush();
    this.regions.clear();
  }
}
