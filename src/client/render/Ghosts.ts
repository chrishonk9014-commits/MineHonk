/**
 * V7 - The Halloween Update: ghosts at night.
 *
 * Now and then on a Halloween night a ghost drifts across the player's view,
 * low over the landscape or high in the air, and fades away. They are only
 * atmosphere: drawn here on the client (one instanced draw, like the redstone
 * torch glow), they touch nothing, hurt nobody and nothing reacts to them.
 * They come only while the world's server says Halloween is on, only under
 * the night sky of the Overworld and the Farlands, and they are rare: one at
 * a time, a minute or two apart. Come close and one fades out at once.
 * Reduce Motion keeps them slow and still (no bobbing, no rippling hem).
 * Fewer and rarer on lower graphics (the Particles setting, which Auto
 * Optimize lowers when the game lags): see ghostBudget.
 *
 * Each ghost is a blocky sheet ghost (two dark eyes, a little round mouth, a
 * rippling hem) drawn in the fragment shader on a 16x16 pixel grid, so it
 * looks like the rest of the game's pixel art.
 */
import * as THREE from 'three';
import type { ClientWorld } from '../world/ClientWorld';
import type { Settings } from '../settings';

const MAX_GHOSTS = 8;
/** Seconds between ghosts on a Halloween night (picked at random between these). */
const GAP_MIN = 55;
const GAP_MAX = 140;
/** The first one of a night comes a little sooner. */
const FIRST_MIN = 20;
const FIRST_MAX = 50;
/** Daylight below this is night enough for ghosts. */
const NIGHT = 0.3;
/** A ghost fades out at once when the camera comes this close (blocks). */
const SHY = 7;

/**
 * V7 phase 5: how many ghosts at once (and over an Abandoned Village), and how
 * much rarer they come, for the graphics settings: Particles All, Decreased or
 * Minimal (Auto Optimize lowers it when the game lags).
 */
export function ghostBudget(s: Pick<Settings, 'particles'>): { max: number; village: number; gap: number; ambient: number } {
  if (s.particles === 'minimal') return { max: 2, village: 1, gap: 2.5, ambient: 2 };
  if (s.particles === 'decreased') return { max: 4, village: 2, gap: 1.5, ambient: 4 };
  return { max: MAX_GHOSTS, village: 3, gap: 1, ambient: MAX_GHOSTS };
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aLook;
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vPhase;
varying float vFlip;
varying float vFog;
uniform float uFogNear;
uniform float uFogFar;
void main() {
  // aLook: size, alpha, phase, flip (which way it drifts)
  vec4 mv = viewMatrix * vec4(aCenter, 1.0);
  mv.xy += position.xy * aLook.x * vec2(1.0, 1.25);
  vUv = position.xy;
  vA = aLook.y;
  vPhase = aLook.z;
  vFlip = aLook.w;
  float d = length(mv.xyz);
  vFog = 1.0 - smoothstep(uFogNear, uFogFar, d);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uCalm;
varying vec2 vUv;
varying float vA;
varying float vPhase;
varying float vFlip;
varying float vFog;
void main() {
  // A 16x16 pixel grid over the quad (-0.5..0.5)
  vec2 q = (floor((vUv + 0.5) * 16.0) + 0.5) / 16.0 - 0.5;
  q.x *= vFlip;
  float t = uTime * (1.0 - uCalm);
  // The sheet: a round head over a body whose hem ripples
  float head = length((q - vec2(0.0, 0.12)) * vec2(1.0, 1.05)) - 0.34;
  float hem = -0.42 + (0.05 * sin(q.x * 19.0 + t * 3.1 + vPhase) + 0.03 * sin(q.x * 31.0 - t * 2.3)) * (1.0 - uCalm * 0.6);
  float body = max(abs(q.x) - 0.34, max(hem - q.y, q.y - 0.12));
  float shape = min(head, body);
  if (shape > 0.0) discard;
  // Little arms, held out
  float arms = step(abs(q.y + 0.04), 0.035) * step(0.3, abs(q.x)) * step(abs(q.x), 0.42);
  // Two dark eyes and a small round mouth
  float eye = min(length((q - vec2(-0.11, 0.17)) * vec2(1.4, 0.9)), length((q - vec2(0.11, 0.17)) * vec2(1.4, 0.9)));
  float mouth = abs(length((q - vec2(0.0, 0.0)) * vec2(1.3, 1.0)) - 0.045);
  vec3 col = mix(vec3(0.80, 0.88, 1.0), vec3(0.97, 0.99, 1.0), smoothstep(-0.42, 0.4, q.y));
  float a = 0.62;
  // A paler rim, so it reads against both the sky and the ground
  if (shape > -0.04) { col = vec3(1.0); a = 0.72; }
  if (eye < 0.075 || mouth < 0.02) { col = vec3(0.06, 0.07, 0.12); a = 0.85; }
  a *= vA * vFog;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

interface Ghost {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Height over the ground it keeps (low ones follow the landscape); NaN: fixed height. */
  over: number;
  age: number;
  life: number;
  size: number;
  phase: number;
  /** 0..1: a shy ghost fades out quickly. */
  leaving: number;
  alpha: number;
  /** One of an Abandoned Village's own. */
  village?: boolean;
}

export interface GhostView {
  /** Camera position and which way it looks (yaw: forward is -sin, -cos). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Whether ghosts come by themselves here now (Halloween on, under a night sky). */
  haunted: boolean;
  /** 0 (night) .. 1 (day). */
  daylight: number;
  time: number;
  fogNear: number;
  fogFar: number;
}

export class Ghosts {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly centers = new Float32Array(MAX_GHOSTS * 3);
  private readonly looks = new Float32Array(MAX_GHOSTS * 4);
  private readonly list: Ghost[] = [];
  /** Seconds until the next ghost comes by itself (NaN: not counting: no night, no Halloween). */
  private wait = NaN;
  private pendingNow = 0;
  /** Title scenes: keep this many in view all the time. */
  ambient = 0;
  /** Title scenes: where ambient ghosts drift (around the camera if unset), between y + 1 and y + 5. */
  ambientArea: { x: number; y: number; z: number; r: number } | null = null;
  /** Real seconds until the next ambient ghost may come. */
  private ambientWait = 0;
  /**
   * V7 phase 2: the Abandoned Village the player is in (its server says so):
   * ghosts drift over it day and night, a few at a time. Not seasonal.
   */
  village: { x0: number; z0: number; x1: number; z1: number; y: number } | null = null;
  private villageWait = 0;
  private lastAt = 0;

  constructor(
    private readonly world: ClientWorld,
    private readonly settings: Settings,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(this.looks, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uCalm: { value: 0 }, uFogNear: { value: 60 }, uFogFar: { value: 120 } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'ghosts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** How many are drifting now (tests and the title scenes). */
  get count(): number {
    return this.list.length;
  }

  /** A ghost now, in front of the camera (the Admin Panel's "Show a ghost now"). */
  showNow(): void {
    this.pendingNow++;
  }

  private ground(x: number, z: number, fallback: number): number {
    const h = this.world.heightAt(Math.floor(x), Math.floor(z));
    return h > 0 ? h : fallback;
  }

  /** Starts a ghost somewhere in view: `dist` blocks ahead, drifting across. */
  private spawn(v: GhostView, dist: number, spread: number, high: boolean): void {
    if (this.list.length >= ghostBudget(this.settings).max) return;
    const calm = this.settings.reduceMotion;
    const a = v.yaw + (Math.random() - 0.5) * spread;
    const x = v.x - Math.sin(a) * dist;
    const z = v.z - Math.cos(a) * dist;
    // Across the view: sideways to the camera, one way or the other
    const side = Math.random() < 0.5 ? -1 : 1;
    const speed = (calm ? 0.45 : 0.8 + Math.random() * 0.8) * side;
    const vx = -Math.cos(v.yaw) * speed;
    const vz = Math.sin(v.yaw) * speed;
    const g = this.ground(x, z, v.y - 2);
    const over = high ? NaN : 1.6 + Math.random() * 2.6;
    const y = high ? Math.max(g + 7, v.y + 3 + Math.random() * 8) : g + over;
    this.list.push({ x, y, z, vx, vz, over, age: 0, life: (calm ? 12 : 9) + Math.random() * 5, size: 1.3 + Math.random() * 0.6, phase: Math.random() * 6.28, leaving: 0, alpha: 0 });
  }

  /** A title scene's ghost, low over its area (at a fixed height: trees and water don't lift it). */
  private spawnAmbient(v: GhostView): void {
    if (this.list.length >= ghostBudget(this.settings).max) return;
    const area = this.ambientArea;
    if (!area) {
      this.spawn(v, 14 + Math.random() * 20, 1.1, Math.random() < 0.35);
      return;
    }
    const calm = this.settings.reduceMotion;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * area.r;
    const ang = Math.random() * Math.PI * 2;
    const speed = calm ? 0.35 : 0.5 + Math.random() * 0.6;
    const life = 12 + Math.random() * 8;
    this.list.push({
      x: area.x + Math.cos(a) * r,
      y: area.y + 1 + Math.random() * 4,
      z: area.z + Math.sin(a) * r,
      vx: Math.cos(ang) * speed,
      vz: Math.sin(ang) * speed,
      over: NaN,
      // Already on its way, so they don't all fade in and out together
      age: this.list.length ? Math.random() * life * 0.5 : 0,
      life,
      size: 1.3 + Math.random() * 0.7,
      phase: Math.random() * 6.28,
      leaving: 0,
      alpha: 0,
    });
  }

  /** A ghost of an Abandoned Village: somewhere ahead inside it, low over the ruins. */
  private spawnVillage(v: GhostView): void {
    const a = this.village;
    if (!a || this.list.length >= ghostBudget(this.settings).max) return;
    const calm = this.settings.reduceMotion;
    const ang = v.yaw + (Math.random() - 0.5) * 2.4;
    const dist = 8 + Math.random() * 24;
    const x = Math.max(a.x0, Math.min(a.x1, v.x - Math.sin(ang) * dist));
    const z = Math.max(a.z0, Math.min(a.z1, v.z - Math.cos(ang) * dist));
    const drift = Math.random() * Math.PI * 2;
    const speed = calm ? 0.3 : 0.4 + Math.random() * 0.6;
    const over = 1.4 + Math.random() * 3;
    this.list.push({ x, y: this.ground(x, z, a.y) + over, z, vx: Math.cos(drift) * speed, vz: Math.sin(drift) * speed, over, age: 0, life: (calm ? 14 : 10) + Math.random() * 8, size: 1.2 + Math.random() * 0.7, phase: Math.random() * 6.28, leaving: 0, alpha: 0, village: true });
  }

  update(v: GhostView, dt: number): void {
    dt = Math.min(0.1, Math.max(0, dt));
    const calm = this.settings.reduceMotion;
    const budget = ghostBudget(this.settings);
    // An Abandoned Village's ghosts: day or night, up to three at once (fewer on lower graphics), every few seconds
    if (this.village && (v.x >= this.village.x0 - 16 && v.x <= this.village.x1 + 16 && v.z >= this.village.z0 - 16 && v.z <= this.village.z1 + 16)) {
      this.villageWait -= dt;
      if (this.villageWait <= 0) {
        if (this.list.filter((g) => g.village).length < budget.village) this.spawnVillage(v);
        this.villageWait = (5 + Math.random() * 9) * budget.gap;
      }
    } else this.villageWait = Math.min(this.villageWait, 2);
    // Ghosts by themselves: a Halloween night, now and then
    const night = v.haunted && v.daylight < NIGHT;
    if (!night) this.wait = NaN;
    else if (Number.isNaN(this.wait)) this.wait = FIRST_MIN + Math.random() * (FIRST_MAX - FIRST_MIN);
    else if ((this.wait -= dt) <= 0) {
      if (this.list.length === 0) this.spawn(v, 18 + Math.random() * 18, 0.7, Math.random() < 0.4);
      this.wait = (GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)) * budget.gap;
    }
    while (this.pendingNow > 0) {
      this.pendingNow--;
      this.spawn(v, 11 + Math.random() * 3, 0.25, false);
    }
    // Title scenes: always a few in view (real time: a slow software renderer still gets its ghosts)
    const now = performance.now();
    const real = this.lastAt ? Math.min(1, (now - this.lastAt) / 1000) : 0;
    this.lastAt = now;
    if (this.ambient > 0) {
      this.ambientWait -= real;
      const want = Math.min(this.ambient, budget.ambient);
      while (this.list.length < want && this.ambientWait <= 0) {
        this.spawnAmbient(v);
        // The first ones come together (some already part-faded in), then one every few seconds
        this.ambientWait = this.list.length < want ? 0 : 2 + Math.random() * 3;
      }
    }
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i]!;
      g.age += dt;
      g.x += g.vx * dt;
      g.z += g.vz * dt;
      if (!Number.isNaN(g.over)) {
        // Low ones follow the landscape, smoothly
        const want = this.ground(g.x, g.z, g.y - g.over) + g.over;
        g.y += (want - g.y) * Math.min(1, dt * 0.8);
      }
      const d = Math.hypot(g.x - v.x, g.y - v.y, g.z - v.z);
      if (d < SHY) g.leaving = Math.max(g.leaving, 0.001);
      if (g.leaving > 0) g.leaving += dt * 1.6;
      const fadeIn = Math.min(1, g.age / (calm ? 3 : 2));
      const fadeOut = Math.min(1, Math.max(0, (g.life - g.age) / 3));
      g.alpha = Math.min(fadeIn, fadeOut) * (1 - Math.min(1, g.leaving));
      if (g.age >= g.life || g.leaving >= 1) {
        this.list.splice(i, 1);
        continue;
      }
    }
    for (const g of this.list) {
      if (n >= MAX_GHOSTS) break;
      const bob = calm ? 0 : Math.sin(v.time * 0.09 + g.phase) * 0.25;
      this.centers[n * 3] = g.x;
      this.centers[n * 3 + 1] = g.y + bob;
      this.centers[n * 3 + 2] = g.z;
      // Faces the way it drifts: seen from the camera, left or right
      const right = (g.vx * -Math.cos(v.yaw) + g.vz * Math.sin(v.yaw)) >= 0 ? 1 : -1;
      this.looks[n * 4] = g.size;
      this.looks[n * 4 + 1] = g.alpha;
      this.looks[n * 4 + 2] = g.phase;
      this.looks[n * 4 + 3] = right;
      n++;
    }
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) {
      (this.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('aLook') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    const u = this.material.uniforms;
    u.uTime!.value = v.time / 20;
    u.uCalm!.value = calm ? 1 : 0;
    u.uFogNear!.value = v.fogNear;
    u.uFogFar!.value = Math.max(v.fogNear + 1, v.fogFar);
  }

  clear(): void {
    this.list.length = 0;
    this.wait = NaN;
    this.ambientWait = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
