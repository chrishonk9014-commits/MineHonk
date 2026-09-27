/**
 * Manages chunk section meshes: tracks dirty sections, dispatches meshing
 * jobs to a worker pool (nearest first), and uploads results to the GPU.
 */
import * as THREE from 'three';
import type { ClientWorld, ChunkListener } from '../world/ClientWorld';
import type { Chunk } from '../../common/world/chunk';
import { PAD, padIndex, type LayerMesh } from './mesher';
import { CHUNK_FRAG, CHUNK_VERT } from './shaders';
import type { AtlasMeta } from './atlasInfo';
import { biomeOf } from '../../common/registry/biomes';
import { chunkIndex, SECTIONS_PER_CHUNK } from '../../common/world/constants';

interface SectionEntry {
  cx: number;
  sy: number;
  cz: number;
  meshes: (THREE.Mesh | null)[];
  version: number;
  building: number;
  dirty: boolean;
  firstSeen: number;
}

export interface ChunkRenderSettings {
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

const LAYER_NAMES = ['invisible', 'opaque', 'cutout', 'translucent'];

export class ChunkRenderer implements ChunkListener {
  readonly group = new THREE.Group();
  readonly materials: THREE.ShaderMaterial[];
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly sections = new Map<string, SectionEntry>();
  private readonly dirty = new Set<string>();
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private nextJob = 1;
  private readonly jobs = new Map<number, { key: string; version: number; worker: number }>();
  private index: THREE.BufferAttribute;
  private readonly tintCache = new Map<number, { stamp: number; data: Uint8Array }>();
  meshedLastSecond = 0;
  private meshCounter = 0;
  private counterReset = performance.now();
  totalQuads = 0;
  lastMeshMs = 0;
  ready = false;
  private readyCount = 0;

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
      uTileU: { value: atlasMeta.tile / atlasMeta.width },
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
      const u = { ...this.uniforms, uAlphaMode: { value: mode } };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: CHUNK_VERT,
        fragmentShader: CHUNK_FRAG,
        glslVersion: THREE.GLSL3,
        transparent: mode === 2,
        depthWrite: mode !== 2,
        side: mode === 1 && false ? THREE.FrontSide : mode === 2 ? THREE.DoubleSide : THREE.FrontSide,
      });
      return m;
    };
    this.materials = [mk(0), mk(0), mk(1), mk(2)];
    // Cutout (plants) need both sides visible
    this.materials[2]!.side = THREE.DoubleSide;
    this.materials[3]!.side = THREE.FrontSide;
    this.index = this.makeIndex(65536);
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
    return new THREE.BufferAttribute(idx, 1);
  }

  /** Keeps uniforms that are shared by value in sync across the three materials. */
  syncUniforms(): void {
    for (const m of this.materials) {
      for (const [k, u] of Object.entries(this.uniforms)) {
        if (k === 'uAlphaMode') continue;
        m.uniforms[k]!.value = u.value;
      }
    }
  }

  private key(cx: number, sy: number, cz: number): string {
    return cx + ',' + sy + ',' + cz;
  }

  private markDirty(cx: number, sy: number, cz: number): void {
    if (sy < 0 || sy >= SECTIONS_PER_CHUNK) return;
    if (!this.world.getChunk(cx, cz)) return;
    const k = this.key(cx, sy, cz);
    let e = this.sections.get(k);
    if (!e) {
      e = { cx, sy, cz, meshes: [null, null, null, null], version: 0, building: 0, dirty: true, firstSeen: performance.now() };
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
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = this.world.getChunk(c.cx + dx, c.cz + dz);
      if (!n) continue;
      const nt = Math.min(SECTIONS_PER_CHUNK - 1, Math.max(n.topSection(), c.topSection()));
      for (let sy = 0; sy <= nt; sy++) this.markDirty(n.cx, sy, n.cz);
    }
    this.tintCache.delete(chunkIndex(c.cx, c.cz));
  }

  onChunkUnloaded(cx: number, cz: number): void {
    for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
      const k = this.key(cx, sy, cz);
      const e = this.sections.get(k);
      if (!e) continue;
      this.disposeSection(e);
      this.sections.delete(k);
      this.dirty.delete(k);
    }
    this.tintCache.delete(chunkIndex(cx, cz));
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
    // Changing block above the current top section of a chunk may create new sections
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
    for (let i = 0; i < e.meshes.length; i++) {
      const m = e.meshes[i];
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      e.meshes[i] = null;
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
    for (let z = 0; z < PAD; z++) {
      for (let x = 0; x < PAD; x++) {
        const acc = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let dz = 0; dz <= 2 * R; dz++) for (let dx = 0; dx <= 2 * R; dx++) {
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
            if (!c || wy > 255) {
              for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) light[padIndex(x + dx * 16, y, z + dz * 16)] = wy > 255 ? skyDefault : c ? 0 : skyDefault;
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

  /** Dispatches meshing jobs nearest to the camera first. */
  update(camera: THREE.Camera, time: number): void {
    this.uniforms.uTime!.value = time;
    this.syncUniforms();
    const now = performance.now();
    if (now - this.counterReset > 1000) {
      this.meshedLastSecond = this.meshCounter;
      this.meshCounter = 0;
      this.counterReset = now;
    }
    if (this.readyCount < this.workers.length || this.dirty.size === 0) return;
    const maxInFlight = this.workers.length * 3;
    let inFlight = this.jobs.size;
    if (inFlight >= maxInFlight) return;
    const cp = camera.position;
    const ccx = Math.floor(cp.x) >> 4;
    const ccz = Math.floor(cp.z) >> 4;
    const ccy = Math.floor(cp.y) >> 4;
    const list: [string, number][] = [];
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
      if (!this.neighboursLoaded(e.cx, e.cz)) {
        if (now - e.firstSeen < 600) continue;
        d += 50;
      }
      list.push([k, d]);
    }
    list.sort((a, b) => a[1] - b[1]);
    for (const [k] of list) {
      if (inFlight >= maxInFlight) break;
      const e = this.sections.get(k)!;
      const chunk = this.world.getChunk(e.cx, e.cz);
      if (!chunk) {
        this.dirty.delete(k);
        continue;
      }
      // Empty section with empty neighbours above/below: just clear
      if (!chunk.sections[e.sy] && !(e.sy > 0 && chunk.sections[e.sy - 1]) && !(e.sy < 15 && chunk.sections[e.sy + 1])) {
        let neighbourData = false;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) if (this.world.getChunk(e.cx + dx, e.cz + dz)?.sections[e.sy]) neighbourData = true;
        if (!neighbourData) {
          this.disposeSection(e);
          e.dirty = false;
          this.dirty.delete(k);
          continue;
        }
      }
      let wi = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.busy[i]! < this.busy[wi]!) wi = i;
      const input = this.buildInput(e.cx, e.sy, e.cz);
      const id = this.nextJob++;
      this.jobs.set(id, { key: k, version: e.version, worker: wi });
      this.busy[wi]!++;
      e.building++;
      e.dirty = false;
      this.dirty.delete(k);
      this.workers[wi]!.postMessage(
        { type: 'mesh', id, key: k, blocks: input.blocks, light: input.light, tints: input.tints.slice(), fancyLeaves: this.settings.fancyLeaves, smoothLighting: this.settings.smoothLighting },
        [input.blocks.buffer, input.light.buffer],
      );
      inFlight++;
    }
  }

  private onWorkerMessage(wi: number, m: { type: string; id: number; key: string; layers: LayerMesh[]; ms: number }): void {
    if (m.type === 'ready') {
      this.readyCount++;
      this.ready = this.readyCount >= this.workers.length;
      return;
    }
    const job = this.jobs.get(m.id);
    this.jobs.delete(m.id);
    this.busy[wi] = Math.max(0, this.busy[wi]! - 1);
    if (!job) return;
    const e = this.sections.get(job.key);
    if (!e) return;
    e.building = Math.max(0, e.building - 1);
    this.lastMeshMs = m.ms;
    this.meshCounter++;
    // stale result (section changed since) - it will be rebuilt anyway, but show it to avoid holes
    this.applyMesh(e, m.layers);
  }

  private applyMesh(e: SectionEntry, layers: LayerMesh[]): void {
    for (let li = 1; li < 4; li++) {
      const l = layers[li]!;
      let mesh = e.meshes[li];
      if (l.quads === 0) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          e.meshes[li] = null;
        }
        continue;
      }
      if (l.quads * 6 > this.index.count) this.index = this.makeIndex(Math.max(l.quads, this.index.count / 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute('aPos', new THREE.BufferAttribute(l.pos, 3, false));
      g.setAttribute('aUv', new THREE.BufferAttribute(l.uv, 2, true));
      g.setAttribute('aCol', new THREE.BufferAttribute(l.col, 4, true));
      g.setAttribute('aLight', new THREE.BufferAttribute(l.light, 4, false));
      g.setIndex(this.index);
      g.setDrawRange(0, l.quads * 6);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16));
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = g;
      } else {
        mesh = new THREE.Mesh(g, this.materials[li]);
        mesh.name = LAYER_NAMES[li]!;
        mesh.position.set(e.cx * 16, e.sy * 16, e.cz * 16);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.frustumCulled = true;
        if (li === 3) mesh.renderOrder = 1;
        e.meshes[li] = mesh;
        this.group.add(mesh);
      }
    }
  }

  /** Marks every loaded section for rebuild (settings changes). */
  rebuildAll(): void {
    for (const c of this.world.chunks.values()) this.onChunkLoaded(c);
  }

  stats(): { sections: number; dirty: number; jobs: number; meshes: number } {
    let meshes = 0;
    for (const e of this.sections.values()) for (const m of e.meshes) if (m) meshes++;
    return { sections: this.sections.size, dirty: this.dirty.size, jobs: this.jobs.size, meshes };
  }

  dispose(): void {
    for (const e of this.sections.values()) this.disposeSection(e);
    this.sections.clear();
    this.dirty.clear();
    for (const w of this.workers) w.terminate();
    for (const m of this.materials) m.dispose();
  }
}
