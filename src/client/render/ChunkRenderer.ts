/**
 * Chunk rendering. Sections (16^3) are meshed in a worker pool, nearest
 * first, and packed into render regions (4x4 chunks by 8 sections) that each
 * hold one vertex buffer per render layer. Every frame the renderer decides
 * which sections are visible, using the camera frustum and a section
 * visibility graph (sections hidden behind solid terrain are skipped, like
 * caves seen from the surface), and draws all visible sections of a region
 * with a single multi-draw call.
 */
import * as THREE from 'three';
import type { ClientWorld, ChunkListener } from '../world/ClientWorld';
import type { Chunk } from '../../common/world/chunk';
import { FACE_GROUPS, PAD, padIndex, SOLID_UNKNOWN, U16_PER_VERTEX, U8_PER_VERTEX, VIS_ALL, visConnected, type LayerMesh } from './mesher';
import { CHUNK_FRAG, CHUNK_VERT } from './shaders';
import type { AtlasMeta } from './atlasInfo';
import { biomeOf } from '../../common/registry/biomes';
import { STATE_OPAQUE } from '../../common/registry/blocks';
import { chunkIndex, FACE_OPPOSITE, SECTIONS_PER_CHUNK } from '../../common/world/constants';

export interface ChunkRenderSettings {
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

const LAYER_NAMES = ['invisible', 'opaque', 'cutout', 'translucent'];
/** Region size: chunks per side and sections per region height. */
const REGION_CHUNKS = 4;
const REGION_SECTIONS = 8;
const QUAD_U16 = 4 * U16_PER_VERTEX;
const QUAD_U8 = 4 * U8_PER_VERTEX;
const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

interface Slot {
  start: number;
  quads: number;
  /** Quads per facing group, in buffer order (see LayerMesh.groups). */
  groups?: number[];
}

/**
 * Most ranges a section can need once back-facing groups are skipped: at most
 * one of each opposite pair is dropped, leaving at most four separate runs.
 */
const MAX_RANGES_PER_SECTION = 4;
/** Blocks of slack when deciding that a whole facing group points away. */
const FACING_MARGIN = 1;

interface SectionEntry {
  cx: number;
  sy: number;
  cz: number;
  key: number;
  region: Region;
  slots: (Slot | null)[];
  version: number;
  building: number;
  dirty: boolean;
  firstSeen: number;
  /** Face connectivity from the last mesh (VIS_ALL until meshed). */
  vis: number;
  /** Set by the visibility search. */
  reachable: boolean;
  /** Distance to the camera (squared blocks), for translucent ordering. */
  dist: number;
}

/** A Mesh drawn with WEBGL_multi_draw through three.js' batched path. */
class RegionMesh extends THREE.Mesh {
  readonly isBatchedMesh = true;
  _multiDrawStarts = new Int32Array(64);
  _multiDrawCounts = new Int32Array(64);
  _multiDrawCount = 0;
  _multiDrawInstances = null;
  _colorsTexture = null;
  _matricesTexture = null;
  _indirectTexture = null;
}

class RegionLayer {
  mesh: RegionMesh | null = null;
  capacity = 0;
  used = 0;
  u16 = new Uint16Array(0);
  u8 = new Uint8Array(0);
  private b16: THREE.InterleavedBuffer | null = null;
  private b8: THREE.InterleavedBuffer | null = null;
  /** Free ranges (sorted by start). */
  private free: Slot[] = [];
  readonly sections = new Set<SectionEntry>();

  constructor(
    readonly owner: ChunkRenderer,
    readonly region: Region,
    readonly layer: number,
  ) {}

  alloc(quads: number): Slot {
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i]!;
      if (f.quads < quads) continue;
      const s = { start: f.start, quads };
      f.start += quads;
      f.quads -= quads;
      if (f.quads === 0) this.free.splice(i, 1);
      this.used += quads;
      return s;
    }
    // Grow: keep existing offsets, append space at the end
    const old = this.capacity;
    const tailFree = this.free.length && this.free[this.free.length - 1]!.start + this.free[this.free.length - 1]!.quads === old ? this.free.pop()! : null;
    const tailStart = tailFree ? tailFree.start : old;
    const need = tailStart + quads;
    const cap = Math.max(need, Math.ceil(old * 1.5), 2048);
    this.resize(cap);
    if (cap > need) this.free.push({ start: need, quads: cap - need });
    this.used += quads;
    return { start: tailStart, quads };
  }

  release(s: Slot): void {
    this.used -= s.quads;
    // insert sorted and merge neighbours
    let i = 0;
    while (i < this.free.length && this.free[i]!.start < s.start) i++;
    this.free.splice(i, 0, { start: s.start, quads: s.quads });
    const prev = this.free[i - 1];
    const cur = this.free[i]!;
    const next = this.free[i + 1];
    if (next && cur.start + cur.quads === next.start) {
      cur.quads += next.quads;
      this.free.splice(i + 1, 1);
    }
    if (prev && prev.start + prev.quads === cur.start) {
      prev.quads += cur.quads;
      this.free.splice(i, 1);
    }
  }

  private resize(cap: number): void {
    const u16 = new Uint16Array(cap * QUAD_U16);
    const u8 = new Uint8Array(cap * QUAD_U8);
    u16.set(this.u16.subarray(0, Math.min(this.u16.length, u16.length)));
    u8.set(this.u8.subarray(0, Math.min(this.u8.length, u8.length)));
    this.u16 = u16;
    this.u8 = u8;
    this.capacity = cap;
    this.owner.ensureIndex(cap);
    const g = new THREE.BufferGeometry();
    this.b16 = new THREE.InterleavedBuffer(u16, U16_PER_VERTEX).setUsage(THREE.DynamicDrawUsage);
    this.b8 = new THREE.InterleavedBuffer(u8, U8_PER_VERTEX).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.b16, 4, 0, false));
    g.setAttribute('aLocal', new THREE.InterleavedBufferAttribute(this.b16, 2, 4, false));
    g.setAttribute('aTile', new THREE.InterleavedBufferAttribute(this.b16, 2, 6, true));
    g.setAttribute('aCol', new THREE.InterleavedBufferAttribute(this.b8, 4, 0, true));
    g.setAttribute('aLight', new THREE.InterleavedBufferAttribute(this.b8, 4, 4, false));
    g.setIndex(this.owner.index);
    const r = this.region;
    const w = REGION_CHUNKS * 16;
    const h = REGION_SECTIONS * 16;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, h, w));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(w / 2, h / 2, w / 2), Math.hypot(w, h, w) / 2);
    if (this.mesh) {
      const old = this.mesh.geometry;
      old.setIndex(null); // the index is shared: keep it alive
      old.dispose();
      this.mesh.geometry = g;
    } else {
      const m = new RegionMesh(g, this.owner.materials[this.layer]);
      m.name = LAYER_NAMES[this.layer]!;
      m.position.set(r.rx * w, r.ry * h, r.rz * w);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (this.layer === 3) m.renderOrder = 1;
      this.mesh = m;
      this.owner.group.add(m);
    }
  }

  write(slot: Slot, l: LayerMesh): void {
    this.u16.set(l.u16, slot.start * QUAD_U16);
    this.u8.set(l.u8, slot.start * QUAD_U8);
    this.b16!.addUpdateRange(slot.start * QUAD_U16, l.quads * QUAD_U16);
    this.b8!.addUpdateRange(slot.start * QUAD_U8, l.quads * QUAD_U8);
    this.b16!.needsUpdate = true;
    this.b8!.needsUpdate = true;
  }

  /** Rebinds the (possibly regrown) shared index. */
  setIndex(index: THREE.BufferAttribute): void {
    this.mesh?.geometry.setIndex(index);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.owner.group.remove(this.mesh);
    this.mesh.geometry.setIndex(null);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}

class Region {
  readonly layers: (RegionLayer | null)[] = [null, null, null, null];
  count = 0;
  constructor(
    readonly key: number,
    readonly rx: number,
    readonly ry: number,
    readonly rz: number,
  ) {}
}

export class ChunkRenderer implements ChunkListener {
  readonly group = new THREE.Group();
  readonly materials: THREE.ShaderMaterial[];
  readonly uniforms: Record<string, THREE.IUniform>;
  index: THREE.BufferAttribute;
  private indexQuads = 0;
  private readonly sections = new Map<number, SectionEntry>();
  private readonly regions = new Map<number, Region>();
  private readonly dirty = new Set<number>();
  private queue: SectionEntry[] = [];
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private nextJob = 1;
  private readonly jobs = new Map<number, { key: number; version: number; worker: number }>();
  private readonly tintCache = new Map<number, { stamp: number; data: Uint8Array }>();
  meshedLastSecond = 0;
  private meshCounter = 0;
  private counterReset = performance.now();
  totalQuads = 0;
  lastMeshMs = 0;
  ready = false;
  private readyCount = 0;
  /** Sections drawn in the last frame. */
  drawnSections = 0;
  /** Quads submitted in the last frame. */
  drawnQuads = 0;
  /** Cave culling (section visibility graph); off draws everything in view. */
  occlusion = true;
  /** Skips per-section face groups that point away from the camera. */
  facingCull = true;
  private visDirty = true;
  private lastVisAt = 0;
  private camSection = '';
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  constructor(
    private readonly world: ClientWorld,
    atlasTexture: THREE.Texture,
    private readonly atlasMeta: AtlasMeta,
    private readonly settings: ChunkRenderSettings,
    workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
  ) {
    this.group.name = 'chunks';
    this.uniforms = {
      uAtlas: { value: atlasTexture },
      uTime: { value: 0 },
      uTileSize: { value: new THREE.Vector2(atlasMeta.tile / atlasMeta.width, atlasMeta.tile / atlasMeta.height) },
      uWave: { value: 0 },
      uDaylight: { value: 1 },
      uSkyTint: { value: new THREE.Color(1, 1, 1) },
      uBlockTint: { value: new THREE.Color(1.0, 0.93, 0.8) },
      uBrightness: { value: 0.5 },
      uAmbient: { value: 0.04 },
      uFogColor: { value: new THREE.Color(0xc0d8ff) },
      uFogNear: { value: 100 },
      uFogFar: { value: 150 },
      uAlphaMode: { value: 0 },
      uNightVision: { value: 0 },
      uFlicker: { value: 1 },
    };
    const mk = (mode: number): THREE.ShaderMaterial => {
      // Shared uniform objects: updating this.uniforms updates every material
      const u: Record<string, THREE.IUniform> = { ...this.uniforms, uAlphaMode: { value: mode } };
      return new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: CHUNK_VERT,
        fragmentShader: CHUNK_FRAG,
        transparent: mode === 2,
        depthWrite: mode !== 2,
        side: THREE.FrontSide,
      });
    };
    this.materials = [mk(0), mk(0), mk(1), mk(2)];
    // Cutout (plants) need both sides visible
    this.materials[2]!.side = THREE.DoubleSide;
    this.index = this.makeIndex(1 << 16);
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./mesherWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this.onWorkerMessage(i, ev.data);
      w.postMessage({ type: 'init', atlas: atlasMeta });
      this.workers.push(w);
      this.busy.push(0);
    }
    world.listener = this;
  }

  private makeIndex(quads: number): THREE.BufferAttribute {
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      const i = q * 6;
      idx[i] = v;
      idx[i + 1] = v + 1;
      idx[i + 2] = v + 2;
      idx[i + 3] = v;
      idx[i + 4] = v + 2;
      idx[i + 5] = v + 3;
    }
    this.indexQuads = quads;
    return new THREE.BufferAttribute(idx, 1);
  }

  /** Grows the shared quad index to cover a region layer's capacity. */
  ensureIndex(quads: number): void {
    if (quads <= this.indexQuads) return;
    this.index = this.makeIndex(Math.max(quads, this.indexQuads * 2));
    for (const r of this.regions.values()) for (const l of r.layers) l?.setIndex(this.index);
    // three.js only frees a GPU buffer through the dispose of a geometry it has
    // drawn, so the old index (at least 1.5 MB, needed only by a region layer
    // with more than 65536 quads) stays allocated until the context goes away.
  }

  /** Uniform objects are shared by every material, so nothing to copy. */
  syncUniforms(): void {}

  private key(cx: number, sy: number, cz: number): number {
    return chunkIndex(cx, cz) * 16 + sy;
  }

  private regionFor(cx: number, sy: number, cz: number): Region {
    const rx = Math.floor(cx / REGION_CHUNKS);
    const rz = Math.floor(cz / REGION_CHUNKS);
    const ry = sy >= REGION_SECTIONS ? 1 : 0;
    const k = chunkIndex(rx, rz) * 2 + ry;
    let r = this.regions.get(k);
    if (!r) {
      r = new Region(k, rx, ry, rz);
      this.regions.set(k, r);
    }
    return r;
  }

  private markDirty(cx: number, sy: number, cz: number): void {
    if (sy < 0 || sy >= SECTIONS_PER_CHUNK) return;
    if (!this.world.getChunk(cx, cz)) return;
    const k = this.key(cx, sy, cz);
    let e = this.sections.get(k);
    if (!e) {
      const region = this.regionFor(cx, sy, cz);
      region.count++;
      e = { cx, sy, cz, key: k, region, slots: [null, null, null, null], version: 0, building: 0, dirty: true, firstSeen: performance.now(), vis: VIS_ALL, reachable: true, dist: 0 };
      this.sections.set(k, e);
    }
    e.version++;
    e.dirty = true;
    this.dirty.add(k);
  }

  onChunkLoaded(c: Chunk): void {
    const top = Math.min(SECTIONS_PER_CHUNK - 1, c.topSection());
    for (let sy = 0; sy <= top; sy++) this.markDirty(c.cx, sy, c.cz);
    // neighbours' border faces depend on this chunk
    for (const [dx, dz] of NEIGHBOURS) {
      const n = this.world.getChunk(c.cx + dx, c.cz + dz);
      if (!n) continue;
      const nt = Math.min(SECTIONS_PER_CHUNK - 1, Math.max(n.topSection(), c.topSection()));
      for (let sy = 0; sy <= nt; sy++) this.markDirty(n.cx, sy, n.cz);
    }
    this.tintCache.delete(chunkIndex(c.cx, c.cz));
    this.visDirty = true;
  }

  onChunkUnloaded(cx: number, cz: number): void {
    for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
      const k = this.key(cx, sy, cz);
      const e = this.sections.get(k);
      if (!e) continue;
      this.disposeSection(e);
      this.sections.delete(k);
      this.dirty.delete(k);
      const r = e.region;
      if (--r.count <= 0) {
        for (let li = 0; li < 4; li++) {
          r.layers[li]?.dispose();
          r.layers[li] = null;
        }
        this.regions.delete(r.key);
      }
    }
    this.tintCache.delete(chunkIndex(cx, cz));
    this.visDirty = true;
  }

  onBlockChanged(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const sy = y >> 4;
    this.markDirty(cx, sy, cz);
    const lx = x & 15;
    const ly = y & 15;
    const lz = z & 15;
    if (lx === 0) this.markDirty(cx - 1, sy, cz);
    if (lx === 15) this.markDirty(cx + 1, sy, cz);
    if (lz === 0) this.markDirty(cx, sy, cz - 1);
    if (lz === 15) this.markDirty(cx, sy, cz + 1);
    if (ly === 0) this.markDirty(cx, sy - 1, cz);
    if (ly === 15) this.markDirty(cx, sy + 1, cz);
  }

  onLightChanged(cx: number, sy: number, cz: number): void {
    this.markDirty(cx, sy, cz);
    this.markDirty(cx, sy + 1, cz);
    this.markDirty(cx, sy - 1, cz);
    this.markDirty(cx + 1, sy, cz);
    this.markDirty(cx - 1, sy, cz);
    this.markDirty(cx, sy, cz + 1);
    this.markDirty(cx, sy, cz - 1);
  }

  private disposeSection(e: SectionEntry): void {
    for (let li = 1; li < 4; li++) {
      const s = e.slots[li];
      if (!s) continue;
      const layer = e.region.layers[li]!;
      layer.release(s);
      layer.sections.delete(e);
      this.totalQuads -= s.quads;
      e.slots[li] = null;
    }
  }

  /** Blended biome colours for the padded 18x18 columns around a chunk. */
  private tints(cx: number, cz: number): Uint8Array {
    const k = chunkIndex(cx, cz);
    let stamp = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.world.getChunk(cx + dx, cz + dz)) stamp |= 1 << ((dz + 1) * 3 + dx + 1);
    const cached = this.tintCache.get(k);
    if (cached && cached.stamp === stamp) return cached.data;
    const out = new Uint8Array(PAD * PAD * 9);
    const R = 2;
    const bx = cx << 4;
    const bz = cz << 4;
    // biome colour lookup table for the (18+2R)^2 region
    const W = PAD + 2 * R;
    const cols = new Float32Array(W * W * 9);
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        const wx = bx + x - 1 - R;
        const wz = bz + z - 1 - R;
        const c = this.world.getChunk(wx >> 4, wz >> 4) ?? this.world.getChunk(cx, cz)!;
        const b = biomeOf(c.getBiome(wx & 15, wz & 15));
        const i = (z * W + x) * 9;
        cols[i] = (b.grass >> 16) & 255;
        cols[i + 1] = (b.grass >> 8) & 255;
        cols[i + 2] = b.grass & 255;
        cols[i + 3] = (b.foliage >> 16) & 255;
        cols[i + 4] = (b.foliage >> 8) & 255;
        cols[i + 5] = b.foliage & 255;
        cols[i + 6] = (b.water >> 16) & 255;
        cols[i + 7] = (b.water >> 8) & 255;
        cols[i + 8] = b.water & 255;
      }
    }
    const n = (2 * R + 1) ** 2;
    const acc = new Float32Array(9);
    for (let z = 0; z < PAD; z++) {
      for (let x = 0; x < PAD; x++) {
        acc.fill(0);
        for (let dz = 0; dz <= 2 * R; dz++)
          for (let dx = 0; dx <= 2 * R; dx++) {
            const i = ((z + dz) * W + (x + dx)) * 9;
            for (let c = 0; c < 9; c++) acc[c]! += cols[i + c]!;
          }
        const o = (z * PAD + x) * 9;
        for (let c = 0; c < 9; c++) out[o + c] = Math.round(acc[c]! / n);
      }
    }
    this.tintCache.set(k, { stamp, data: out });
    return out;
  }

  private buildInput(cx: number, sy: number, cz: number): { blocks: Uint16Array; light: Uint8Array; tints: Uint8Array } {
    const blocks = new Uint16Array(PAD * PAD * PAD);
    const light = new Uint8Array(PAD * PAD * PAD);
    const skyDefault = this.world.hasSky ? 0xf0 : 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.world.getChunk(cx + dx, cz + dz);
        const x0 = dx < 0 ? 15 : 0;
        const x1 = dx > 0 ? 0 : 15;
        const z0 = dz < 0 ? 15 : 0;
        const z1 = dz > 0 ? 0 : 15;
        for (let y = -1; y <= 16; y++) {
          const wy = sy * 16 + y;
          if (wy < 0 || wy > 255 || !c) {
            // Unloaded neighbours and the world floor hide faces towards them
            const fill = wy > 255 ? 0 : SOLID_UNKNOWN;
            for (let z = z0; z <= z1; z++)
              for (let x = x0; x <= x1; x++) {
                const pi = padIndex(x + dx * 16, y, z + dz * 16);
                blocks[pi] = fill;
                light[pi] = wy > 255 ? skyDefault : c ? 0 : skyDefault;
              }
            continue;
          }
          const sec = c.sections[wy >> 4];
          const ls = c.light[wy >> 4];
          const ly = (wy & 15) << 8;
          for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
              const pi = padIndex(x + dx * 16, y, z + dz * 16);
              const li = ly | (z << 4) | x;
              blocks[pi] = sec ? sec[li]! : 0;
              light[pi] = ls ? ls[li]! : skyDefault;
            }
          }
        }
      }
    }
    return { blocks, light, tints: this.tints(cx, cz) };
  }

  private neighboursLoaded(cx: number, cz: number): boolean {
    return !!(this.world.getChunk(cx + 1, cz) && this.world.getChunk(cx - 1, cz) && this.world.getChunk(cx, cz + 1) && this.world.getChunk(cx, cz - 1));
  }

  /** Per frame: dispatches meshing jobs and decides which sections to draw. */
  update(camera: THREE.Camera, time: number): void {
    this.uniforms.uTime!.value = time;
    const now = performance.now();
    if (now - this.counterReset > 1000) {
      this.meshedLastSecond = this.meshCounter;
      this.meshCounter = 0;
      this.counterReset = now;
    }
    camera.updateMatrixWorld();
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(this.camDir);
    this.sortQueue(now);
    this.pump();
    this.updateVisibility(now);
    this.buildDrawLists(camera);
  }

  /** Orders dirty sections nearest first (once per frame). */
  private sortQueue(now: number): void {
    if (this.dirty.size === 0) {
      this.queue = [];
      return;
    }
    const cp = this.camPos;
    const ccx = Math.floor(cp.x) >> 4;
    const ccz = Math.floor(cp.z) >> 4;
    const ccy = Math.floor(cp.y) >> 4;
    const dir = this.camDir;
    const list: SectionEntry[] = [];
    for (const k of this.dirty) {
      const e = this.sections.get(k);
      if (!e) {
        this.dirty.delete(k);
        continue;
      }
      if (e.building) continue;
      const dx = e.cx - ccx;
      const dz = e.cz - ccz;
      const dy = (e.sy - ccy) * 0.6;
      let d = dx * dx + dz * dz + dy * dy;
      // What the camera looks at comes first: sections behind it count as further away
      if (d > 2 && dx * dir.x + dy * dir.y + dz * dir.z < -0.3 * Math.sqrt(d)) d = d * 2 + 8;
      if (!this.neighboursLoaded(e.cx, e.cz)) {
        if (now - e.firstSeen < 600) continue;
        d += 50;
      }
      e.dist = d;
      list.push(e);
    }
    list.sort((a, b) => a.dist - b.dist);
    this.queue = list;
  }

  /** Sends queued sections to idle workers (also called as results arrive). */
  private pump(): void {
    if (this.readyCount < this.workers.length || this.queue.length === 0) return;
    // Keep every worker's queue stocked: results are collected between frames, so
    // with slow frames a short queue leaves the workers idle most of the time
    const maxInFlight = this.workers.length * 8;
    let inFlight = this.jobs.size;
    while (inFlight < maxInFlight && this.queue.length) {
      const e = this.queue.shift()!;
      if (!e.dirty || e.building || this.sections.get(e.key) !== e) continue;
      const chunk = this.world.getChunk(e.cx, e.cz);
      if (!chunk) {
        this.dirty.delete(e.key);
        continue;
      }
      // Empty section with empty neighbours: nothing to draw
      if (!chunk.sections[e.sy] && !(e.sy > 0 && chunk.sections[e.sy - 1]) && !(e.sy < 15 && chunk.sections[e.sy + 1])) {
        let neighbourData = false;
        for (const [dx, dz] of NEIGHBOURS) if (this.world.getChunk(e.cx + dx, e.cz + dz)?.sections[e.sy]) neighbourData = true;
        if (!neighbourData) {
          this.disposeSection(e);
          if (e.vis !== VIS_ALL) this.visDirty = true;
          e.vis = VIS_ALL;
          e.dirty = false;
          this.dirty.delete(e.key);
          continue;
        }
      }
      let wi = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.busy[i]! < this.busy[wi]!) wi = i;
      const input = this.buildInput(e.cx, e.sy, e.cz);
      const id = this.nextJob++;
      this.jobs.set(id, { key: e.key, version: e.version, worker: wi });
      this.busy[wi]!++;
      e.building++;
      e.dirty = false;
      this.dirty.delete(e.key);
      const r = e.region;
      this.workers[wi]!.postMessage(
        {
          type: 'mesh',
          id,
          blocks: input.blocks,
          light: input.light,
          tints: input.tints.slice(),
          fancyLeaves: this.settings.fancyLeaves,
          smoothLighting: this.settings.smoothLighting,
          ox: (e.cx - r.rx * REGION_CHUNKS) * 16,
          oy: (e.sy - r.ry * REGION_SECTIONS) * 16,
          oz: (e.cz - r.rz * REGION_CHUNKS) * 16,
        },
        [input.blocks.buffer, input.light.buffer],
      );
      inFlight++;
    }
  }

  private onWorkerMessage(wi: number, m: { type: string; id: number; layers: LayerMesh[]; vis: number; ms: number }): void {
    if (m.type === 'ready') {
      this.readyCount++;
      this.ready = this.readyCount >= this.workers.length;
      return;
    }
    const job = this.jobs.get(m.id);
    this.jobs.delete(m.id);
    this.busy[wi] = Math.max(0, this.busy[wi]! - 1);
    if (job) {
      const e = this.sections.get(job.key);
      if (e) {
        e.building = Math.max(0, e.building - 1);
        this.lastMeshMs = m.ms;
        this.meshCounter++;
        // A stale result (section changed since) is still shown to avoid holes; it is rebuilt anyway.
        this.applyMesh(e, m.layers, m.vis);
      }
    }
    this.pump();
  }

  private applyMesh(e: SectionEntry, layers: LayerMesh[], vis: number): void {
    if (e.vis !== vis) {
      e.vis = vis;
      this.visDirty = true;
    }
    const r = e.region;
    for (let li = 1; li < 4; li++) {
      const l = layers[li]!;
      const old = e.slots[li];
      let layer = r.layers[li];
      if (l.quads === 0) {
        if (old && layer) {
          layer.release(old);
          layer.sections.delete(e);
          this.totalQuads -= old.quads;
          e.slots[li] = null;
        }
        continue;
      }
      if (!layer) layer = r.layers[li] = new RegionLayer(this, r, li);
      let slot = old;
      if (slot && slot.quads !== l.quads) {
        // Reuse the slot when the new mesh fits, returning the unused tail
        if (l.quads < slot.quads) {
          layer.release({ start: slot.start + l.quads, quads: slot.quads - l.quads });
          this.totalQuads -= slot.quads - l.quads;
          slot.quads = l.quads;
        } else {
          layer.release(slot);
          this.totalQuads -= slot.quads;
          slot = null;
        }
      }
      if (!slot) {
        slot = layer.alloc(l.quads);
        this.totalQuads += l.quads;
      }
      slot.groups = l.groups;
      e.slots[li] = slot;
      layer.sections.add(e);
      layer.write(slot, l);
    }
  }

  // ------------------------------------------------------------------ visibility

  /**
   * Breadth-first search over sections from the camera, passing between
   * neighbouring sections only through faces that are connected by open
   * space and never turning back (the classic section visibility graph).
   */
  private updateVisibility(now: number): void {
    const cp = this.camPos;
    const scx = Math.floor(cp.x) >> 4;
    const scy = Math.floor(cp.y) >> 4;
    const scz = Math.floor(cp.z) >> 4;
    const camKey = `${scx},${scy},${scz}`;
    const inWorld = cp.y >= 0 && cp.y < 256 && !!this.world.getChunk(scx, scz);
    const camBlock = inWorld ? this.world.getState(Math.floor(cp.x), Math.floor(cp.y), Math.floor(cp.z)) : 0;
    const enabled = this.occlusion && inWorld && !STATE_OPAQUE[camBlock];
    if (!enabled) {
      for (const e of this.sections.values()) e.reachable = true;
      this.camSection = '';
      return;
    }
    if (camKey === this.camSection && !(this.visDirty && now - this.lastVisAt > 150)) return;
    this.camSection = camKey;
    this.visDirty = false;
    this.lastVisAt = now;
    // Grid around the camera covering every loaded section
    let minX = scx;
    let maxX = scx;
    let minZ = scz;
    let maxZ = scz;
    for (const c of this.world.chunks.values()) {
      if (c.cx < minX) minX = c.cx;
      if (c.cx > maxX) maxX = c.cx;
      if (c.cz < minZ) minZ = c.cz;
      if (c.cz > maxZ) maxZ = c.cz;
    }
    const W = maxX - minX + 1;
    const D = maxZ - minZ + 1;
    const size = W * D * 16;
    const vis = new Int32Array(size).fill(-1);
    for (const c of this.world.chunks.values()) {
      const base = ((c.cz - minZ) * W + (c.cx - minX)) * 16;
      for (let sy = 0; sy < 16; sy++) vis[base + sy] = VIS_ALL;
    }
    const cells: (SectionEntry | undefined)[] = new Array(size);
    for (const e of this.sections.values()) {
      e.reachable = false;
      const i = ((e.cz - minZ) * W + (e.cx - minX)) * 16 + e.sy;
      cells[i] = e;
      vis[i] = e.vis;
    }
    const seen = new Uint8Array(size);
    const qCell = new Int32Array(size);
    const qFrom = new Int8Array(size);
    const qDirs = new Uint8Array(size);
    const start = ((scz - minZ) * W + (scx - minX)) * 16 + scy;
    let head = 0;
    let tail = 0;
    qCell[tail] = start;
    qFrom[tail] = -1;
    qDirs[tail++] = 0;
    seen[start] = 1;
    while (head < tail) {
      const c = qCell[head]!;
      const from = qFrom[head]!;
      const dirs = qDirs[head++]!;
      const e = cells[c];
      if (e) e.reachable = true;
      const v = vis[c]!;
      const sy = c & 15;
      const col = c >> 4;
      const x = col % W;
      const z = (col / W) | 0;
      for (let d = 0; d < 6; d++) {
        if (dirs & (1 << FACE_OPPOSITE[d]!)) continue;
        if (from >= 0 && !visConnected(v, from, d)) continue;
        let n: number;
        if (d === 0) {
          if (sy === 0) continue;
          n = c - 1;
        } else if (d === 1) {
          if (sy === 15) continue;
          n = c + 1;
        } else if (d === 2) {
          if (z === 0) continue;
          n = c - W * 16;
        } else if (d === 3) {
          if (z === D - 1) continue;
          n = c + W * 16;
        } else if (d === 4) {
          if (x === 0) continue;
          n = c - 16;
        } else {
          if (x === W - 1) continue;
          n = c + 16;
        }
        if (seen[n] || vis[n] === -1) continue;
        seen[n] = 1;
        qCell[tail] = n;
        qFrom[tail] = FACE_OPPOSITE[d]!;
        qDirs[tail++] = dirs | (1 << d);
      }
    }
  }

  /** Fills each region layer's multi-draw list with its visible sections. */
  /**
   * Facing groups of a section that can face the camera (bit per group). A
   * face with normal +X lies on a plane x = p inside the section and is only
   * front-facing when the camera is on its +X side, so when the camera is
   * beyond the section's low X edge every +X face is turned away.
   */
  private facingMask(e: SectionEntry): number {
    const cp = this.camPos;
    const x0 = e.cx * 16 - FACING_MARGIN;
    const y0 = e.sy * 16 - FACING_MARGIN;
    const z0 = e.cz * 16 - FACING_MARGIN;
    const x1 = e.cx * 16 + 16 + FACING_MARGIN;
    const y1 = e.sy * 16 + 16 + FACING_MARGIN;
    const z1 = e.cz * 16 + 16 + FACING_MARGIN;
    let m = 0x7f;
    if (cp.y > y1) m &= ~(1 << 0); // -Y faces
    if (cp.y < y0) m &= ~(1 << 1); // +Y
    if (cp.z > z1) m &= ~(1 << 2); // -Z
    if (cp.z < z0) m &= ~(1 << 3); // +Z
    if (cp.x > x1) m &= ~(1 << 4); // -X
    if (cp.x < x0) m &= ~(1 << 5); // +X
    return m;
  }

  private buildDrawLists(camera: THREE.Camera): void {
    this.drawnQuads = 0;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cp = this.camPos;
    let drawn = 0;
    const box = this.box;
    for (const r of this.regions.values()) {
      for (let li = 1; li < 4; li++) {
        const layer = r.layers[li];
        const mesh = layer?.mesh;
        if (!layer || !mesh) continue;
        const list: SectionEntry[] = [];
        for (const e of layer.sections) {
          if (!e.reachable) continue;
          box.min.set(e.cx * 16, e.sy * 16, e.cz * 16);
          box.max.set(e.cx * 16 + 16, e.sy * 16 + 16, e.cz * 16 + 16);
          if (!this.frustum.intersectsBox(box)) continue;
          list.push(e);
        }
        if (li === 3) {
          // Translucent: far to near
          for (const e of list) {
            const dx = e.cx * 16 + 8 - cp.x;
            const dy = e.sy * 16 + 8 - cp.y;
            const dz = e.cz * 16 + 8 - cp.z;
            e.dist = dx * dx + dy * dy + dz * dz;
          }
          list.sort((a, b) => b.dist - a.dist);
        } else list.sort((a, b) => a.slots[li]!.start - b.slots[li]!.start);
        const need = list.length * MAX_RANGES_PER_SECTION;
        if (mesh._multiDrawStarts.length < need) {
          const n = Math.max(need, mesh._multiDrawStarts.length * 2);
          mesh._multiDrawStarts = new Int32Array(n);
          mesh._multiDrawCounts = new Int32Array(n);
        }
        // Single-sided layers skip facing groups that point away from the camera
        const cullFacing = li !== 2 && this.facingCull;
        const starts = mesh._multiDrawStarts;
        const counts = mesh._multiDrawCounts;
        let count = 0;
        let lastEnd = -1;
        let quads = 0;
        for (const e of list) {
          const s = e.slots[li]!;
          const mask = cullFacing && s.groups ? this.facingMask(e) : 0x7f;
          let at = s.start;
          for (let g = 0; g < FACE_GROUPS; g++) {
            const n = s.groups ? s.groups[g]! : g === 0 ? s.quads : 0;
            if (n === 0) continue;
            if (mask & (1 << g)) {
              // Merge runs that are adjacent in the buffer (translucent only within a section, to keep the order)
              if (at === lastEnd && count > 0 && (li !== 3 || at !== s.start)) counts[count - 1]! += n * 6;
              else {
                starts[count] = at * 6 * 4;
                counts[count] = n * 6;
                count++;
              }
              lastEnd = at + n;
              quads += n;
            }
            at += n;
          }
        }
        mesh._multiDrawCount = count;
        this.drawnQuads += quads;
        mesh.visible = count > 0;
        drawn += list.length;
      }
    }
    this.drawnSections = drawn;
  }

  /** Marks every loaded section for rebuild (settings changes). */
  rebuildAll(): void {
    for (const c of this.world.chunks.values()) this.onChunkLoaded(c);
  }

  stats(): { sections: number; dirty: number; jobs: number; meshes: number; regions: number; drawn: number; quads: number; drawnQuads: number } {
    let meshes = 0;
    for (const r of this.regions.values()) for (const l of r.layers) if (l?.mesh) meshes++;
    return { sections: this.sections.size, dirty: this.dirty.size, jobs: this.jobs.size, meshes, regions: this.regions.size, drawn: this.drawnSections, quads: this.totalQuads, drawnQuads: this.drawnQuads };
  }

  dispose(): void {
    for (const r of this.regions.values()) for (const l of r.layers) l?.dispose();
    this.regions.clear();
    this.sections.clear();
    this.dirty.clear();
    this.queue = [];
    for (const w of this.workers) w.terminate();
    for (const m of this.materials) m.dispose();
    const g = new THREE.BufferGeometry();
    g.setIndex(this.index);
    g.dispose();
  }
}
