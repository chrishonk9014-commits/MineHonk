/**
 * Chunk column storage: 16x256x16 blocks split into 16 vertical sections.
 *
 * - Sections that are entirely air are stored as null.
 * - Light is stored per section as one byte per block (sky << 4 | block).
 *   A null light array means "uniform": full skylight (15) when the dimension
 *   has a sky, otherwise darkness.
 */
import { SECTIONS_PER_CHUNK, SECTION_VOLUME, WORLD_HEIGHT } from './constants';
import { STATE_OPACITY, STATE_SOLID, STATE_FLUID, stateCount } from '../registry/blocks';
import { ByteReader, ByteWriter } from '../util/bytes';

export type BlockEntityData = { type: string; [k: string]: unknown };

export class Chunk {
  readonly sections: (Uint16Array | null)[] = new Array(SECTIONS_PER_CHUNK).fill(null);
  readonly light: (Uint8Array | null)[] = new Array(SECTIONS_PER_CHUNK).fill(null);
  /** Highest y (+1) with a light-blocking or solid block per column; 0 when empty. */
  readonly heightmap = new Int16Array(256);
  /** Biome id per column. */
  readonly biomes = new Uint8Array(256);
  readonly blockEntities = new Map<number, BlockEntityData>();
  /** Entities placed by world generation, spawned once when the chunk is first generated (not serialised). */
  readonly genEntities: { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }[] = [];
  /** Non-air counts per section to free sections that become empty. */
  readonly counts = new Uint16Array(SECTIONS_PER_CHUNK);

  /** Modified since last save. */
  dirty = false;
  /** Has been modified relative to pure generation (must be persisted). */
  modified = false;
  lightReady = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly hasSky: boolean,
  ) {}

  static localIndex(x: number, y: number, z: number): number {
    return (y << 8) | (z << 4) | x;
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const s = this.sections[y >> 4];
    if (!s) return 0;
    return s[((y & 15) << 8) | (z << 4) | x]!;
  }

  /** Raw set without heightmap maintenance (used by world generation). */
  setRaw(x: number, y: number, z: number, state: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const si = y >> 4;
    let s = this.sections[si];
    if (!s) {
      if (state === 0) return;
      s = this.sections[si] = new Uint16Array(SECTION_VOLUME);
    }
    const i = ((y & 15) << 8) | (z << 4) | x;
    const old = s[i]!;
    if (old === state) return;
    s[i] = state;
    if (old === 0) this.counts[si]!++;
    else if (state === 0) this.counts[si]!--;
  }

  /** Sets a block and maintains the heightmap. Returns previous state. */
  set(x: number, y: number, z: number, state: number): number {
    const old = this.get(x, y, z);
    if (old === state) return old;
    this.setRaw(x, y, z, state);
    const si = y >> 4;
    if (this.counts[si] === 0 && this.sections[si]) this.sections[si] = null;
    const hi = (z << 4) | x;
    const h = this.heightmap[hi]!;
    if (blocksHeight(state)) {
      if (y + 1 > h) this.heightmap[hi] = y + 1;
    } else if (y + 1 === h) {
      let ny = y - 1;
      while (ny >= 0 && !blocksHeight(this.get(x, ny, z))) ny--;
      this.heightmap[hi] = ny + 1;
    }
    this.dirty = true;
    this.modified = true;
    return old;
  }

  recomputeHeightmap(): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let y = WORLD_HEIGHT - 1;
        while (y >= 0 && !blocksHeight(this.get(x, y, z))) y--;
        this.heightmap[(z << 4) | x] = y + 1;
      }
    }
  }

  recount(): void {
    for (let si = 0; si < SECTIONS_PER_CHUNK; si++) {
      const s = this.sections[si];
      if (!s) {
        this.counts[si] = 0;
        continue;
      }
      let c = 0;
      for (let i = 0; i < SECTION_VOLUME; i++) if (s[i] !== 0) c++;
      this.counts[si] = c;
      if (c === 0) this.sections[si] = null;
    }
  }

  getHeight(x: number, z: number): number {
    return this.heightmap[(z << 4) | x]!;
  }

  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return this.hasSky ? 0xf0 : 0;
    if (y < 0) return 0;
    const l = this.light[y >> 4];
    if (!l) return this.hasSky ? 0xf0 : 0;
    return l[((y & 15) << 8) | (z << 4) | x]!;
  }

  getSky(x: number, y: number, z: number): number {
    return this.getLight(x, y, z) >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.getLight(x, y, z) & 15;
  }

  /** Ensures a light array exists for a section (materialising uniform light). */
  lightArray(si: number): Uint8Array {
    let l = this.light[si];
    if (!l) {
      l = this.light[si] = new Uint8Array(SECTION_VOLUME);
      if (this.hasSky) l.fill(0xf0);
    }
    return l;
  }

  setLightRaw(x: number, y: number, z: number, v: number): void {
    this.lightArray(y >> 4)[((y & 15) << 8) | (z << 4) | x] = v;
  }

  getBiome(x: number, z: number): number {
    return this.biomes[(z << 4) | x]!;
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
    return this.blockEntities.get(Chunk.localIndex(x, y, z));
  }

  setBlockEntity(x: number, y: number, z: number, data: BlockEntityData | undefined): void {
    const k = Chunk.localIndex(x, y, z);
    if (data) this.blockEntities.set(k, data);
    else this.blockEntities.delete(k);
    this.dirty = true;
    this.modified = true;
  }

  /** Top section index containing blocks (+1); 0 when empty. */
  topSection(): number {
    for (let i = SECTIONS_PER_CHUNK - 1; i >= 0; i--) if (this.sections[i]) return i + 1;
    return 0;
  }
}

export function blocksHeight(state: number): boolean {
  return state !== 0 && (STATE_OPACITY[state]! > 0 || STATE_SOLID[state]! === 1 || STATE_FLUID[state]! !== 0);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Encodes one section of states using a local palette + bit packing. */
export function writeSection(w: ByteWriter, s: Uint16Array): void {
  const palette: number[] = [];
  const map = new Map<number, number>();
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const v = s[i]!;
    if (!map.has(v)) {
      map.set(v, palette.length);
      palette.push(v);
    }
  }
  w.varint(palette.length);
  for (const p of palette) w.varint(p);
  if (palette.length === 1) return;
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  w.u8(bits);
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < SECTION_VOLUME; i++) {
    acc |= map.get(s[i]!)! << accBits;
    accBits += bits;
    while (accBits >= 8) {
      w.u8(acc & 0xff);
      acc >>>= 8;
      accBits -= 8;
    }
  }
  if (accBits > 0) w.u8(acc & 0xff);
}

export function readSection(r: ByteReader, maxState = stateCount()): Uint16Array {
  const n = r.varint();
  if (n < 1 || n > SECTION_VOLUME) throw new Error('bad palette size');
  const palette = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    palette[i] = v < maxState ? v : 0;
  }
  const out = new Uint16Array(SECTION_VOLUME);
  if (n === 1) {
    out.fill(palette[0]!);
    return out;
  }
  const bits = r.u8();
  if (bits < 1 || bits > 12) throw new Error('bad bit width');
  const mask = (1 << bits) - 1;
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < SECTION_VOLUME; i++) {
    while (accBits < bits) {
      acc |= r.u8() << accBits;
      accBits += 8;
    }
    const idx = acc & mask;
    acc >>>= bits;
    accBits -= bits;
    out[i] = idx < n ? palette[idx]! : 0;
  }
  return out;
}

export interface ChunkEncodeOptions {
  light: boolean;
  blockEntities: boolean;
}

/**
 * Serialises a chunk column. Layout:
 *  i32 cx, i32 cz, u8 flags, u16 sectionMask, u16 lightMask,
 *  [sections], [light arrays], 256 biomes, 256 heights, blockEntities(json)
 */
export function encodeChunk(c: Chunk, opts: ChunkEncodeOptions): Uint8Array {
  const w = new ByteWriter(16384);
  w.i32(c.cx);
  w.i32(c.cz);
  w.u8((c.hasSky ? 1 : 0) | (opts.light ? 2 : 0) | (opts.blockEntities ? 4 : 0));
  let mask = 0;
  for (let i = 0; i < SECTIONS_PER_CHUNK; i++) if (c.sections[i]) mask |= 1 << i;
  w.u16(mask);
  let lmask = 0;
  if (opts.light) for (let i = 0; i < SECTIONS_PER_CHUNK; i++) if (c.light[i]) lmask |= 1 << i;
  w.u16(lmask);
  for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
    const s = c.sections[i];
    if (s) writeSection(w, s);
  }
  if (opts.light) {
    for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
      const l = c.light[i];
      if (l) writeLight(w, l);
    }
  }
  w.bytes(c.biomes);
  for (let i = 0; i < 256; i++) w.u16(c.heightmap[i]!);
  if (opts.blockEntities) {
    const list: [number, BlockEntityData][] = [...c.blockEntities.entries()];
    w.string(JSON.stringify(list));
  }
  return w.finish();
}

/** Run-length encodes a light section (light is highly repetitive). */
function writeLight(w: ByteWriter, l: Uint8Array): void {
  let i = 0;
  while (i < SECTION_VOLUME) {
    const v = l[i]!;
    let run = 1;
    while (i + run < SECTION_VOLUME && l[i + run] === v && run < 4096) run++;
    w.u8(v);
    w.varint(run);
    i += run;
  }
}

function readLight(r: ByteReader): Uint8Array {
  const out = new Uint8Array(SECTION_VOLUME);
  let i = 0;
  while (i < SECTION_VOLUME) {
    const v = r.u8();
    const run = r.varint();
    if (run < 1 || i + run > SECTION_VOLUME) throw new Error('bad light run');
    out.fill(v, i, i + run);
    i += run;
  }
  return out;
}

export function decodeChunk(data: Uint8Array): Chunk {
  const r = new ByteReader(data);
  const cx = r.i32();
  const cz = r.i32();
  const flags = r.u8();
  const c = new Chunk(cx, cz, (flags & 1) !== 0);
  const mask = r.u16();
  const lmask = r.u16();
  for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
    if (mask & (1 << i)) c.sections[i] = readSection(r);
  }
  if (flags & 2) {
    for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
      if (lmask & (1 << i)) c.light[i] = readLight(r);
    }
    c.lightReady = true;
  }
  c.biomes.set(r.bytes(256));
  for (let i = 0; i < 256; i++) c.heightmap[i] = r.u16();
  if (flags & 4) {
    const list = JSON.parse(r.string()) as [number, BlockEntityData][];
    for (const [k, v] of list) c.blockEntities.set(k, v);
  }
  c.recount();
  return c;
}

/** Encodes a single section's light (for incremental light updates). */
export function encodeLightSection(l: Uint8Array | null): Uint8Array {
  const w = new ByteWriter(512);
  if (!l) {
    w.u8(0);
  } else {
    w.u8(1);
    writeLight(w, l);
  }
  return w.finish();
}

export function decodeLightSection(data: Uint8Array): Uint8Array | null {
  const r = new ByteReader(data);
  if (r.u8() === 0) return null;
  return readLight(r);
}
