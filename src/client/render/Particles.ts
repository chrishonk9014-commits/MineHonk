/**
 * CPU particle system rendered as camera-facing quads in one draw call.
 * Supports block-debris particles (sampling the block atlas) and coloured
 * pixel particles (smoke, flames, portal, crit, magic...).
 */
import * as THREE from 'three';
import type { AtlasLookup } from './atlasInfo';
import type { ClientWorld } from '../world/ClientWorld';
import { STATE_SOLID, blocks, STATE_BLOCK } from '../../common/registry/blocks';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  u0: number;
  v0: number;
  du: number;
  dv: number;
  textured: boolean;
  gravity: number;
  drag: number;
  collide: boolean;
  emissive: boolean;
  fade: boolean;
  grow: number;
}

const VERT = /* glsl */ `
in vec3 aCenter;
in vec2 aCorner;
in vec4 aUvRect;
in vec4 aColor;
in vec2 aSizeTex;
out vec2 vUv;
out vec4 vColor;
out float vTex;
out float vFog;
void main() {
  vec4 mv = viewMatrix * vec4(aCenter, 1.0);
  mv.xy += aCorner * aSizeTex.x;
  vUv = aUvRect.xy + vec2(aCorner.x + 0.5, 0.5 - aCorner.y) * aUvRect.zw;
  vColor = aColor;
  vTex = aSizeTex.y;
  vFog = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
in vec2 vUv;
in vec4 vColor;
in float vTex;
in float vFog;
void main() {
  vec4 c = vColor;
  if (vTex > 0.5) {
    vec4 t = texture(uAtlas, vUv);
    if (t.a < 0.5) discard;
    c.rgb *= t.rgb;
  }
  if (c.a < 0.02) discard;
  c.rgb = mix(c.rgb, uFogColor, smoothstep(uFogNear, uFogFar, vFog));
  gl_FragColor = c;
}`;

const MAX = 4000;
const PARTICLE_ATTRIBUTES: [string, number][] = [
  ['aCenter', 3],
  ['aUvRect', 4],
  ['aColor', 4],
  ['aSizeTex', 2],
];

export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly list: Particle[] = [];
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly center: Float32Array;
  private readonly uvRect: Float32Array;
  private readonly color: Float32Array;
  private readonly sizeTex: Float32Array;
  readonly material: THREE.ShaderMaterial;
  density = 1;

  constructor(
    atlasTex: THREE.Texture,
    private readonly atlas: AtlasLookup,
    private readonly world: ClientWorld,
  ) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.center = new Float32Array(MAX * 3);
    this.uvRect = new Float32Array(MAX * 4);
    this.color = new Float32Array(MAX * 4);
    this.sizeTex = new Float32Array(MAX * 2);
    this.geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.center, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(this.uvRect, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSizeTex', new THREE.InstancedBufferAttribute(this.sizeTex, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uAtlas: { value: atlasTex }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 50 }, uFogFar: { value: 100 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  private add(p: Partial<Particle> & { x: number; y: number; z: number }): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 20,
      size: 0.1,
      r: 1,
      g: 1,
      b: 1,
      a: 1,
      u0: 0,
      v0: 0,
      du: 0,
      dv: 0,
      textured: false,
      gravity: 0,
      drag: 0.96,
      collide: false,
      emissive: false,
      fade: false,
      grow: 0,
      ...p,
    });
  }

  /** Debris from a block (breaking / landing / sprinting). */
  blockBreak(state: number, x: number, y: number, z: number, count = 32): void {
    const def = blocks[STATE_BLOCK[state]!]!.def;
    const tex = def.tex.particle ?? def.tex.side ?? def.tex.all ?? def.tex.top;
    if (!tex) return;
    const e = this.atlas.entry(tex);
    const tint = def.tint && def.tint !== 'none' ? (def.tint === 'grass' ? [0.49, 0.74, 0.42] : def.tint === 'water' ? [0.25, 0.46, 0.9] : [0.35, 0.6, 0.2]) : [1, 1, 1];
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const [u, v] = this.atlas.uv(e.i, Math.random() * 0.75, Math.random() * 0.75);
      this.add({
        x: x + (Math.random() - 0.5) * 0.9,
        y: y + (Math.random() - 0.5) * 0.9,
        z: z + (Math.random() - 0.5) * 0.9,
        vx: (Math.random() - 0.5) * 0.15,
        vy: Math.random() * 0.15 + 0.05,
        vz: (Math.random() - 0.5) * 0.15,
        maxLife: 20 + Math.random() * 20,
        size: 0.08 + Math.random() * 0.08,
        u0: u,
        v0: v,
        du: 0.25 / this.atlas.cols,
        dv: 0.25 / this.atlas.rows,
        textured: true,
        gravity: 0.04,
        drag: 0.98,
        collide: true,
        r: tint[0]!,
        g: tint[1]!,
        b: tint[2]!,
      });
    }
  }

  /** Small debris while digging a face. */
  digHit(state: number, x: number, y: number, z: number, face: number): void {
    const off = [
      [0, -0.52, 0],
      [0, 0.52, 0],
      [0, 0, -0.52],
      [0, 0, 0.52],
      [-0.52, 0, 0],
      [0.52, 0, 0],
    ][face] ?? [0, 0, 0];
    this.blockBreak(state, x + 0.5 + off[0]! * 1.9 + (Math.random() - 0.5) * 0.1, y + 0.5 + off[1]! * 1.9, z + 0.5 + off[2]! * 1.9, 2);
  }

  spawn(kind: string, x: number, y: number, z: number, count: number, spread = 0.5, data?: number): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * spread * 2;
      const oy = (Math.random() - 0.5) * spread * 2;
      const oz = (Math.random() - 0.5) * spread * 2;
      switch (kind) {
        case 'block':
          if (data !== undefined) this.blockBreak(data, x, y, z, Math.max(4, Math.round(count / n)));
          return;
        case 'smoke':
        case 'explosion_smoke':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.02 + Math.random() * 0.02, vx: ox * 0.02, vz: oz * 0.02, maxLife: 30 + Math.random() * 30, size: kind === 'explosion_smoke' ? 0.6 : 0.2, r: 0.4, g: 0.4, b: 0.4, a: 0.8, fade: true, grow: 0.01 });
          break;
        case 'explosion':
          this.add({ x: x + ox * 2, y: y + oy * 2, z: z + oz * 2, maxLife: 8 + Math.random() * 6, size: 1.2 + Math.random(), r: 0.95, g: 0.95, b: 0.9, a: 0.9, fade: true, grow: 0.08, emissive: true });
          break;
        case 'flame':
        case 'soul_flame':
          this.add({ x: x + ox * 0.2, y: y + oy * 0.2, z: z + oz * 0.2, vy: 0.01, maxLife: 15 + Math.random() * 10, size: 0.1, r: kind === 'flame' ? 1 : 0.4, g: kind === 'flame' ? 0.6 : 0.9, b: kind === 'flame' ? 0.15 : 1, emissive: true, fade: true });
          break;
        case 'portal':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: -ox * 0.05, vy: -oy * 0.05 + 0.02, vz: -oz * 0.05, maxLife: 40, size: 0.08, r: 0.7, g: 0.3, b: 1, emissive: true, fade: true, drag: 1 });
          break;
        case 'glitch':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.05, vz: (Math.random() - 0.5) * 0.05, maxLife: 20 + Math.random() * 30, size: 0.06 + Math.random() * 0.1, r: Math.random() < 0.5 ? 1 : 0, g: Math.random() < 0.3 ? 1 : 0, b: 1, emissive: true, drag: 1 });
          break;
        case 'crit':
        case 'magic_crit':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: ox * 0.3, vy: 0.1 + Math.random() * 0.1, vz: oz * 0.3, maxLife: 15, size: 0.1, r: kind === 'crit' ? 0.9 : 0.4, g: kind === 'crit' ? 0.9 : 0.9, b: kind === 'crit' ? 0.7 : 1, gravity: 0.02, emissive: true });
          break;
        case 'happy':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.02, maxLife: 25, size: 0.1, r: 0.3, g: 1, b: 0.4, emissive: true });
          break;
        case 'heart':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.03, maxLife: 30, size: 0.18, r: 1, g: 0.2, b: 0.3, emissive: true });
          break;
        case 'note':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.03, maxLife: 20, size: 0.18, r: Math.random(), g: 1, b: Math.random(), emissive: true });
          break;
        case 'splash':
        case 'bubble':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: ox * 0.1, vy: kind === 'bubble' ? 0.05 : 0.15, vz: oz * 0.1, maxLife: 15, size: 0.08, r: 0.6, g: 0.75, b: 1, gravity: kind === 'splash' ? 0.04 : -0.002, collide: true });
          break;
        case 'lava_drip':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.2, vx: ox * 0.05, vz: oz * 0.05, maxLife: 30, size: 0.1, r: 1, g: 0.5, b: 0.1, gravity: 0.03, emissive: true, collide: true });
          break;
        case 'ash':
        case 'white_ash':
        case 'crimson_spore':
        case 'warped_spore':
        case 'ember':
        case 'static': {
          const col = kind === 'ash' ? [0.25, 0.22, 0.22] : kind === 'white_ash' ? [0.85, 0.85, 0.85] : kind === 'crimson_spore' ? [0.8, 0.2, 0.2] : kind === 'warped_spore' ? [0.2, 0.8, 0.7] : kind === 'ember' ? [1, 0.5, 0.1] : [0.8, 0.8, 0.8];
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.01, vy: kind === 'ember' ? 0.01 : -0.005, vz: (Math.random() - 0.5) * 0.01, maxLife: 80 + Math.random() * 80, size: 0.05, r: col[0]!, g: col[1]!, b: col[2]!, emissive: kind === 'ember', drag: 0.99 });
          break;
        }
        case 'item_break':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: ox * 0.2, vy: 0.15, vz: oz * 0.2, maxLife: 20, size: 0.1, r: 0.8, g: 0.8, b: 0.8, gravity: 0.04 });
          break;
        case 'damage':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.08, maxLife: 18, size: 0.12, r: 0.4, g: 0.05, b: 0.05, gravity: 0.01 });
          break;
        case 'dragon_breath':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: ox * 0.02, vy: 0.01, vz: oz * 0.02, maxLife: 60, size: 0.25, r: 0.8, g: 0.3, b: 0.9, a: 0.7, emissive: true, fade: true });
          break;
        case 'composter':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.03, maxLife: 15, size: 0.08, r: 0.4, g: 0.7, b: 0.2 });
          break;
        case 'firework': {
          // Burst: sparks on a sphere, coloured by hue (data) with white highlights
          const u = Math.random() * 2 - 1;
          const th = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(1 - u * u);
          const sp = 0.22 + Math.random() * 0.06;
          const [cr, cg, cb] = Math.random() < 0.15 ? [1, 1, 1] : hueRgb(data ?? Math.random() * 360);
          this.add({ x, y, z, vx: rr * Math.cos(th) * sp, vy: u * sp, vz: rr * Math.sin(th) * sp, maxLife: 30 + Math.random() * 18, size: 0.14, r: cr, g: cg, b: cb, gravity: 0.004, drag: 0.92, emissive: true, fade: true });
          break;
        }
        case 'firework_trail':
          this.add({ x: x + ox * 0.2, y: y + oy * 0.2, z: z + oz * 0.2, vx: ox * 0.01, vy: -0.02, vz: oz * 0.01, maxLife: 10 + Math.random() * 6, size: 0.08, r: 1, g: 0.9, b: 0.6, emissive: true, fade: true });
          break;
        case 'shriek': {
          // Rings of sound rising off a shrieker
          const a = (i / n) * Math.PI * 2;
          this.add({ x: x + Math.cos(a) * 0.3, y: y + (i % 3) * 0.3, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * 0.06, vy: 0.05, vz: Math.sin(a) * 0.06, maxLife: 30, size: 0.18, r: 0.35, g: 0.95, b: 1, emissive: true, fade: true, drag: 0.95 });
          break;
        }
        case 'spore_cloud':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: ox * 0.03, vy: 0.01, vz: oz * 0.03, maxLife: 50 + Math.random() * 30, size: 0.3, grow: 0.01, r: 0.55, g: 0.9, b: 0.85, a: 0.7, fade: true, drag: 0.94 });
          break;
        case 'sculk_soul':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.03, vx: ox * 0.01, vz: oz * 0.01, maxLife: 40 + Math.random() * 20, size: 0.14, r: 0.3, g: 0.9, b: 1, emissive: true, fade: true, drag: 0.98 });
          break;
        case 'sculk_charge':
          this.add({ x: x + ox, y: y + oy * 0.3, z: z + oz, vy: 0.01, maxLife: 25 + Math.random() * 15, size: 0.08, r: 0.1, g: 0.8, b: 0.85, emissive: true, fade: true });
          break;
        case 'spore':
          // Lush caves: slow greenish pollen drifting down
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.008, vy: -0.004, vz: (Math.random() - 0.5) * 0.008, maxLife: 90 + Math.random() * 60, size: 0.05, r: 0.6, g: 0.85, b: 0.35, drag: 0.99, fade: true });
          break;
        case 'spore_glow':
          // Mushroom grottos: faint blue motes rising and bobbing
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.01, vy: 0.006, vz: (Math.random() - 0.5) * 0.01, maxLife: 70 + Math.random() * 50, size: 0.06, r: 0.4, g: 0.75, b: 1, emissive: true, fade: true, drag: 0.99 });
          break;
        case 'crystal_glint':
          // Crystal hollows: short sparkles that barely move
          this.add({ x: x + ox, y: y + oy, z: z + oz, maxLife: 12 + Math.random() * 10, size: 0.07, r: 0.85, g: 0.7, b: 1, emissive: true, fade: true, grow: -0.003, drag: 1 });
          break;
        case 'dust':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.004, vy: -0.002, vz: (Math.random() - 0.5) * 0.004, maxLife: 100 + Math.random() * 60, size: 0.035, r: 0.62, g: 0.52, b: 0.42, drag: 0.99, fade: true });
          break;
        case 'snowflake':
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.012, vy: -0.012, vz: (Math.random() - 0.5) * 0.012, maxLife: 80 + Math.random() * 40, size: 0.05, r: 0.92, g: 0.96, b: 1, drag: 0.99, collide: true, fade: true });
          break;
        case 'end_mote_rise':
        case 'end_mote_fall':
        case 'end_mote_float': {
          // V6: the Expanded End's ambient motes (colour in data, glowing when its top bit is set)
          const c = data ?? 0xffffff;
          const glow = (c & 0x1000000) !== 0;
          const vy = kind === 'end_mote_rise' ? 0.008 + Math.random() * 0.006 : kind === 'end_mote_fall' ? -0.01 - Math.random() * 0.006 : (Math.random() - 0.5) * 0.004;
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.01, vy, vz: (Math.random() - 0.5) * 0.01, maxLife: 80 + Math.random() * 70, size: 0.05 + Math.random() * 0.03, r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255, emissive: glow, fade: true, drag: 0.99 });
          break;
        }
        case 'void_aura':
          // Voidbound Endermen: dark violet and black motes drifting up
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.01, vy: 0.012 + Math.random() * 0.01, vz: (Math.random() - 0.5) * 0.01, maxLife: 30 + Math.random() * 30, size: 0.07, r: Math.random() < 0.4 ? 0.05 : 0.55, g: 0.05, b: Math.random() < 0.4 ? 0.08 : 0.9, emissive: true, fade: true, drag: 0.98 });
          break;
        case 'void_burst': {
          // A burst of violet shards and square black flecks thrown outwards
          const a = Math.random() * Math.PI * 2;
          const u = Math.random() * 2 - 1;
          const rr = Math.sqrt(1 - u * u);
          const sp = 0.12 + Math.random() * 0.12;
          const dark = Math.random() < 0.35;
          this.add({ x: x + ox * 0.3, y: y + oy * 0.3, z: z + oz * 0.3, vx: rr * Math.cos(a) * sp, vy: u * sp, vz: rr * Math.sin(a) * sp, maxLife: 18 + Math.random() * 16, size: dark ? 0.12 : 0.09, r: dark ? 0.02 : 0.75, g: dark ? 0.0 : 0.2, b: dark ? 0.04 : 1, emissive: !dark, fade: true, drag: 0.9 });
          break;
        }
        case 'rain_splash':
          this.add({ x, y, z, vx: ox * 0.05, vy: 0.06, vz: oz * 0.05, maxLife: 6, size: 0.05, r: 0.6, g: 0.7, b: 1, gravity: 0.02 });
          break;
        case 'malware': {
          // V5.5: square flecks of corrupted data, green and black, jerking about
          const dark = Math.random() < 0.4;
          const bright = !dark && Math.random() < 0.3;
          this.add({ x: x + ox, y: y + oy, z: z + oz, vx: (Math.random() - 0.5) * 0.03, vy: 0.008 + Math.random() * 0.02, vz: (Math.random() - 0.5) * 0.03, maxLife: 25 + Math.random() * 35, size: dark ? 0.12 : 0.08 + Math.random() * 0.06, r: dark ? 0.01 : bright ? 0.75 : 0.1, g: dark ? 0.05 : 1, b: dark ? 0.02 : bright ? 0.8 : 0.35, emissive: !dark, fade: true, drag: 0.97 });
          break;
        }
        case 'electric': {
          // Sparks: white-blue, fast and short
          const a = Math.random() * Math.PI * 2;
          const sp = 0.08 + Math.random() * 0.12;
          this.add({ x: x + ox * 0.3, y: y + oy * 0.3, z: z + oz * 0.3, vx: Math.cos(a) * sp, vy: (Math.random() - 0.3) * sp, vz: Math.sin(a) * sp, maxLife: 6 + Math.random() * 8, size: 0.06, r: 0.75, g: 0.95, b: 1, emissive: true, fade: true, drag: 0.85 });
          break;
        }
        default:
          this.add({ x: x + ox, y: y + oy, z: z + oz, vy: 0.02, maxLife: 20, size: 0.1 });
      }
    }
  }

  /**
   * A particle that travels from one point to another in `ticks` ticks:
   * vibrations flying to a sculk sensor, the Warden's sonic boom.
   */
  trail(kind: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ticks: number): void {
    const t = Math.max(1, ticks);
    const vx = (x1 - x0) / t;
    const vy = (y1 - y0) / t;
    const vz = (z1 - z0) / t;
    if (kind === 'sonic_boom') {
      // A string of expanding rings along the whole path at once
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const n = Math.max(2, Math.round(len * 1.2));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        this.add({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, z: z0 + (z1 - z0) * f, maxLife: 10 + i * 0.6, size: 0.5, grow: 0.07, r: 0.45, g: 0.95, b: 1, a: 0.9, emissive: true, fade: true, drag: 1 });
      }
      return;
    }
    this.add({ x: x0, y: y0, z: z0, vx, vy, vz, maxLife: t, size: 0.16, r: 0.2, g: 0.95, b: 1, emissive: true, drag: 1 });
  }

  tick(): void {
    const w = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.life++;
      if (p.life >= p.maxLife) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity;
      let nx = p.x + p.vx;
      let ny = p.y + p.vy;
      let nz = p.z + p.vz;
      if (p.collide && STATE_SOLID[w.getState(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) {
        if (STATE_SOLID[w.getState(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))]) {
          p.vy = 0;
          ny = p.y;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
        if (STATE_SOLID[w.getState(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))]) {
          p.vx = 0;
          nx = p.x;
        }
        if (STATE_SOLID[w.getState(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))]) {
          p.vz = 0;
          nz = p.z;
        }
      }
      p.x = nx;
      p.y = ny;
      p.z = nz;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
      p.size += p.grow;
    }
  }

  /** Uploads instance data; lightAt returns brightness for non-emissive particles. */
  update(lightAt: (x: number, y: number, z: number) => number): void {
    const n = Math.min(this.list.length, MAX);
    for (let i = 0; i < n; i++) {
      const p = this.list[i]!;
      this.center[i * 3] = p.x;
      this.center[i * 3 + 1] = p.y;
      this.center[i * 3 + 2] = p.z;
      this.uvRect[i * 4] = p.u0;
      this.uvRect[i * 4 + 1] = p.v0;
      this.uvRect[i * 4 + 2] = p.du;
      this.uvRect[i * 4 + 3] = p.dv;
      const l = p.emissive ? 1 : lightAt(p.x, p.y, p.z);
      const fade = p.fade ? 1 - p.life / p.maxLife : 1;
      this.color[i * 4] = p.r * l;
      this.color[i * 4 + 1] = p.g * l;
      this.color[i * 4 + 2] = p.b * l;
      this.color[i * 4 + 3] = p.a * fade;
      this.sizeTex[i * 2] = p.size;
      this.sizeTex[i * 2 + 1] = p.textured ? 1 : 0;
    }
    this.geo.instanceCount = n;
    // Upload only the live particles (nothing at all when there are none)
    if (n === 0) return;
    for (const [name, size] of PARTICLE_ATTRIBUTES) {
      const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** Saturated colour for a hue in degrees. */
function hueRgb(h: number): [number, number, number] {
  const k = (n: number): number => (n + h / 60) % 6;
  const f = (n: number): number => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}
