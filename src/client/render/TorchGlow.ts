/**
 * The red glow of lit redstone torches: a soft halo around each flame that
 * shows through the dark (and through the Haunting's fog), and a few specks
 * of red dust drifting up from the ones close by. The world's light has one
 * colour, so the red is drawn on top of it rather than lit into the blocks.
 *
 * Torches are found by scanning chunks as they arrive (a few per frame) and
 * kept up to date from block changes; all halos are one instanced draw.
 */
import * as THREE from 'three';
import type { Chunk } from '../../common/world/chunk';
import type { ClientWorld, ChunkObserver } from '../world/ClientWorld';
import { chunkIndex } from '../../common/world/constants';
import { blocks, STATE_BLOCK, stateCount, getProp } from '../../common/registry/blocks';
import type { Particles } from './Particles';

const MAX_GLOWS = 512;
/** Halos fade out between these distances (blocks). */
const FADE_NEAR = 40;
const FADE_FAR = 72;
/** Chunks scanned per frame. */
const SCANS_PER_FRAME = 6;

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aPhase;
uniform float uTime;
uniform float uSize;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 mv = viewMatrix * vec4(aCenter, 1.0);
  float flick = 0.88 + 0.12 * sin(uTime * 0.31 + aPhase) * sin(uTime * 0.17 + aPhase * 1.7);
  // Drawn a little towards the camera, so the block a torch stands on does not cut the halo in half
  float d = length(mv.xyz);
  mv.xyz += normalize(-mv.xyz) * min(0.9, d * 0.5);
  mv.xy += position.xy * uSize * flick;
  vUv = position.xy;
  vA = flick * (1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, d));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
varying float vA;
void main() {
  float r = length(vUv) * 2.0;
  float halo = pow(max(0.0, 1.0 - r), 2.0);
  float core = pow(max(0.0, 1.0 - r * 4.0), 2.0);
  float a = (halo * 0.95 + core * 0.6) * vA * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(1.0, 0.08, 0.04), vec3(1.0, 0.55, 0.45), core), a);
}`;

export class TorchGlow implements ChunkObserver {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly centers = new Float32Array(MAX_GLOWS * 3);
  private readonly phases = new Float32Array(MAX_GLOWS);
  /** Lit redstone torch states, by state id. */
  private glow: Uint8Array | null = null;
  /** Flame positions per chunk (x, y, z triples), for the chunks scanned so far. */
  private readonly found = new Map<number, Map<number, [number, number, number]>>();
  private readonly pending = new Set<number>();
  private dirty = true;
  private frame = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private near: [number, number, number][] = [];

  constructor(private readonly world: ClientWorld) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.phases, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uSize: { value: 3.2 }, uIntensity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'torch-glow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    world.observers.push(this);
    for (const c of world.chunks.values()) this.onChunkLoaded(c);
  }

  private isGlow(state: number): boolean {
    if (!this.glow) {
      this.glow = new Uint8Array(stateCount());
      for (let s = 0; s < this.glow.length; s++) {
        const id = blocks[STATE_BLOCK[s]!]?.id;
        if ((id === 'redstone_torch' || id === 'redstone_wall_torch') && getProp(s, 'lit') !== 'false') this.glow[s] = 1;
      }
    }
    return this.glow[state] === 1;
  }

  /** Where the flame of a lit redstone torch at (x, y, z) burns. */
  private flame(state: number, x: number, y: number, z: number): [number, number, number] {
    if (blocks[STATE_BLOCK[state]!]!.id !== 'redstone_wall_torch') return [x + 0.5, y + 0.62, z + 0.5];
    // The wall torch model leans its top 0.2 away from the wall (authored facing north, turned clockwise)
    let px = 0;
    let pz = 0.195;
    const turns = { east: 1, south: 2, west: 3 }[getProp(state, 'facing') ?? 'north'] ?? 0;
    for (let k = 0; k < turns; k++) [px, pz] = [-pz, px];
    return [x + 0.5 + px, y + 0.84, z + 0.5 + pz];
  }

  onChunkLoaded(c: Chunk): void {
    const k = chunkIndex(c.cx, c.cz);
    this.found.delete(k);
    this.pending.add(k);
  }

  onChunkUnloaded(cx: number, cz: number): void {
    const k = chunkIndex(cx, cz);
    this.pending.delete(k);
    if (this.found.delete(k)) this.dirty = true;
  }

  onBlockChanged(x: number, y: number, z: number, old: number, state: number): void {
    if (!this.isGlow(old) && !this.isGlow(state)) return;
    const list = this.found.get(chunkIndex(x >> 4, z >> 4));
    // Not scanned yet: the scan will find it
    if (!list) return;
    const key = (y << 8) | ((z & 15) << 4) | (x & 15);
    if (this.isGlow(state)) list.set(key, this.flame(state, x, y, z));
    else list.delete(key);
    this.dirty = true;
  }

  private scan(k: number): void {
    const c = this.world.chunks.get(k);
    if (!c) return;
    const list = new Map<number, [number, number, number]>();
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    for (let sy = 0; sy < c.sections.length; sy++) {
      const s = c.sections[sy];
      if (!s) continue;
      for (let i = 0; i < s.length; i++) {
        const st = s[i]!;
        if (st === 0 || !this.isGlow(st)) continue;
        const y = (sy << 4) | (i >> 8);
        list.set((y << 8) | (i & 255), this.flame(st, bx + (i & 15), y, bz + ((i >> 4) & 15)));
      }
    }
    this.found.set(k, list);
    if (list.size) this.dirty = true;
  }

  /**
   * Once a frame. `ambient` 0..1: how lit the view is (a halo is faint in
   * daylight and strong in the dark); `particles`: for the drifting dust.
   */
  update(camX: number, camY: number, camZ: number, time: number, ambient: number, particles: Particles | null, dt: number): void {
    let n = 0;
    for (const k of this.pending) {
      this.pending.delete(k);
      this.scan(k);
      if (++n >= SCANS_PER_FRAME) break;
    }
    // The nearest torches, re-picked when something changed or the camera moved on
    if (this.dirty || this.frame++ % 30 === 0 || Math.hypot(camX - this.lastX, camZ - this.lastZ) > 8) {
      this.dirty = false;
      this.lastX = camX;
      this.lastZ = camZ;
      const all: [number, number, number, number][] = [];
      for (const list of this.found.values())
        for (const p of list.values()) {
          const d = (p[0] - camX) ** 2 + (p[1] - camY) ** 2 + (p[2] - camZ) ** 2;
          if (d < FADE_FAR * FADE_FAR) all.push([p[0], p[1], p[2], d]);
        }
      all.sort((a, b) => a[3] - b[3]);
      const count = Math.min(MAX_GLOWS, all.length);
      for (let i = 0; i < count; i++) {
        const p = all[i]!;
        this.centers.set([p[0], p[1], p[2]], i * 3);
        this.phases[i] = (Math.floor(p[0]) * 7.13 + Math.floor(p[1]) * 3.7 + Math.floor(p[2]) * 5.31) % 6.283;
      }
      this.geometry.instanceCount = count;
      (this.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
      this.near = all.slice(0, 48).filter((p) => p[3] < 16 * 16).map((p) => [p[0], p[1], p[2]]);
    }
    this.mesh.visible = this.geometry.instanceCount > 0;
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uIntensity!.value = 1 - 0.6 * Math.max(0, Math.min(1, ambient));
    // A speck of red dust now and then from the torches close by
    if (particles) for (const [x, y, z] of this.near) if (Math.random() < dt * 1.2) particles.spawn('redstone_dust', x, y + 0.05, z, 1, 0.12);
  }

  dispose(): void {
    const i = this.world.observers.indexOf(this);
    if (i >= 0) this.world.observers.splice(i, 1);
    this.geometry.dispose();
    this.material.dispose();
  }
}
